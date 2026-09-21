// Zufallsstörungen im freien Spiel.
//
// Die Störungsbibliothek (events.js) gibt es seit langem, aber nur ein
// Szenario hat sie je aufgerufen: im freien Spiel lief stepEvents() jeden
// Takt über einen leeren Satz Merker. Damit war das freie Spiel die einzige
// Betriebsart ohne Störung -- wer ohne Szenario spielte, sah nie etwas
// anderes als die wandernde Netzanforderung, und genau das war auf Dauer
// langweilig.
//
// Hier steht NUR die Auswahl: wann etwas passiert, und was davon zum
// aktuellen Anlagenzustand überhaupt passt. Die Wirkung selbst bleibt in
// events.js, und was danach geschieht, bleibt Physik -- dieselbe Trennung
// wie beim Szenario, nur dass der Zeitplan nicht aus einer JSON-Datei kommt,
// sondern aus einem gesäten Würfel.

import { Rng } from '../rng.js';
import { getEvent, eventKey, eventSeverity } from './events.js';
import { noteEvent } from './learning.js';

/**
 * Die vier Stufen, die der Spieler vor dem Start wählt.
 *
 * `interval` ist der Abstand zwischen zwei Störungen in Simulationssekunden,
 * gleichverteilt zwischen beiden Werten. `grace` hält den Anfang frei: wer
 * gerade erst übernommen (oder kalt angefahren) hat, soll die Anlage erst
 * einmal in den Beharrungszustand bringen dürfen.
 *
 * `maxSeverity` schneidet den Vorrat zu, statt eigene Listen je Stufe zu
 * führen: die Schweregrade stehen ohnehin schon an jeder Störung in
 * events.js. Schwer (3) heisst dort durchweg "die Anlage verliert etwas, das
 * sie zum Betrieb braucht"; auf der seltenen Stufe bleibt es deshalb bei 2.
 *
 * `heavy` markiert die beiden Störungen, die nicht EINE Hilfe wegnehmen,
 * sondern die Grundlage des ganzen Betriebs (Erdbeben, Notstromfall). Sie
 * gehören nur auf die härteste Stufe -- sonst endet das freie Spiel reihum
 * mit derselben Beherrschungsübung.
 *
 * `warnS` ist die akustische Vorwarnung in Sekunden, wie sie das Szenario
 * über dueAlerts() kennt. Nur die seltene Stufe bekommt sie: dort ist die
 * Störung ein angekündigter Übungsfall, auf den härteren Stufen ist genau
 * die Überraschung der Punkt.
 */
export const FAULT_LEVELS = {
  off: null,
  rare: { interval: [2700, 5400], grace: 1800, maxSeverity: 2, heavy: false, warnS: 120 },
  normal: { interval: [1200, 2400], grace: 900, maxSeverity: 3, heavy: false, warnS: 0 },
  hard: { interval: [600, 1200], grace: 600, maxSeverity: 3, heavy: true, warnS: 0 },
};

export const FAULT_LEVEL_IDS = Object.keys(FAULT_LEVELS);

// Unter dieser Neutronenleistung passiert nichts. Das deckt zwei Fälle mit
// derselben Zahl ab: den Kaltstart, bei dem der Spieler ohnehin schon alle
// Hände voll hat, und die Zeit nach einer Schnellabschaltung, in der eine
// zweite Störung nur auf eine bereits stehende Anlage einschlagen würde.
const MIN_POWER_FRAC = 0.15;

/** Störungen, die jeder Typ kennt. `when` prüft, ob sie im aktuellen Zustand
 *  überhaupt etwas bewirkt -- ein zweites Mal "Turbine ausgefallen" auf eine
 *  schon abgeworfene Turbine wäre eine Meldung ohne Ereignis. */
const COMMON = [
  {
    id: 'rod_stuck',
    when: (e) => !e.ctx.stuckRods || Object.keys(e.ctx.stuckRods).length === 0,
    args: (e, rng) => ({ bank: rng.int(0, Math.max(0, e.state.rod.length - 1)) }),
  },
  { id: 'turbine_trip', when: (e) => e.state.breaker && !e.state.turbineTripped },
  { id: 'loss_of_load', when: (e) => e.state.breaker && !e.state.turbineTripped },
  { id: 'earthquake_scram', heavy: true, when: (e) => !e.state.scram.active },
];

/** Typeigene Störungen. Was hier NICHT steht, steht auch nicht zufällig an:
 *  station_blackout etwa rechnet nur der SWR wirklich durch (s.acPower, siehe
 *  bwr.js), bei den anderen beiden wäre es eine Meldung ohne Wirkung. */
const BY_REACTOR = {
  pwr: [
    {
      id: 'rcp_trip',
      // Nicht die letzte laufende Schleife: vier ausgefallene Hauptkühlmittel-
      // pumpen sind kein Zwischenfall mehr, sondern das Ende der Runde.
      when: (e) => runningPumps(e.ctx.pumps) > 1,
      args: (e, rng) => ({ loop: pickRunningPump(e.ctx.pumps, rng) }),
    },
    { id: 'porv_stuck', when: (e) => !e.ctx.porvStuck },
    { id: 'feedwater_loss', when: (e) => !!e.ctx.fwCtl && e.ctx.fwCtl.auto },
    { id: 'sg_tube_leak', when: (e) => !e.ctx.sgLeak, args: (e, rng) => ({ kgs: rng.range(6, 14) }) },
    { id: 'boron_dilution', when: (e) => !e.ctx.boronRunaway && e.state.C_B_cmd !== undefined },
  ],
  bwr: [
    { id: 'msiv_close', when: (e) => !e.ctx.msivStuck && e.state.msiv > 0 },
    {
      id: 'recirc_runback',
      when: (e) => !e.ctx.recircRunback && e.state.recircDmd > 0.6,
      args: (e, rng) => ({ to: rng.range(0.4, 0.6), over_s: rng.range(120, 300) }),
    },
    { id: 'rcp_trip', when: (e) => !!e.ctx.recircPump && !e.ctx.recircPumpStuck },
    { id: 'feedwater_loss', when: (e) => !!e.ctx.fwCtl && e.ctx.fwCtl.auto },
    { id: 'station_blackout', heavy: true, when: (e) => e.state.acPower !== false },
  ],
  rbmk: [
    {
      id: 'mcp_trip',
      // Gleiche Überlegung wie beim DWR, nur mit acht Pumpen: was übrig
      // bleibt, muss den Kern noch kühlen können.
      when: (e) => runningPumps(e.ctx.mcp) > 4,
      args: (e, rng) => ({ count: rng.int(1, 2) }),
    },
    { id: 'power_regulator_off', when: (e) => !!e.ctx.powerCtl && e.ctx.powerCtl.auto },
    {
      id: 'rbmk_feed_supply_limit',
      when: (e) => e.state.fwSupplyMax >= 1.3 * e.spec.drum.W_steam0,
      args: (e, rng) => ({ max_kgs: rng.range(0.45, 0.75) * e.spec.drum.W_steam0 }),
    },
  ],
};

function runningPumps(pumps) {
  if (!Array.isArray(pumps)) return 0;
  let n = 0;
  for (const p of pumps) if (p && p.running && !p.tripped) n++;
  return n;
}

/** Index einer laufenden Pumpe -- eine schon ausgefallene noch einmal
 *  auszuwerfen wäre eine Meldung ohne Wirkung. */
function pickRunningPump(pumps, rng) {
  const live = [];
  for (let i = 0; i < pumps.length; i++) {
    if (pumps[i] && pumps[i].running && !pumps[i].tripped) live.push(i);
  }
  return live.length ? live[rng.int(0, live.length - 1)] : 0;
}

/** Gibt es die Stufe? Alles andere gilt als "aus" -- ein unbekannter Wert aus
 *  einer alten Einstellung soll das freie Spiel nicht verweigern. */
export function faultLevel(id) {
  return Object.hasOwn(FAULT_LEVELS, id) ? FAULT_LEVELS[id] : null;
}

export class FreeFaults {
  /**
   * @param {object} engine
   * @param {string} levelId  Schlüssel aus FAULT_LEVELS
   * @param {number} seed     kein fester Startwert wie beim Szenario: im
   *   freien Spiel gibt es keine Wertung, die eine Wiedergabe nachrechnen
   *   müsste. Der Spielstand sichert den Würfelzustand trotzdem (snapshot()),
   *   sonst käme nach jedem Laden dieselbe Störung noch einmal.
   */
  constructor(engine, levelId, seed) {
    this.engine = engine;
    this.levelId = Object.hasOwn(FAULT_LEVELS, levelId) ? levelId : 'off';
    this.level = FAULT_LEVELS[this.levelId] || null;
    this.rng = new Rng(seed >>> 0);
    this.nextT = 0;
    this.alerted = false;
    this.onAlert = null;
    // Vorrat einmal zusammenstellen: die Liste hängt am Reaktortyp, der sich
    // während einer Runde nicht ändert.
    this.pool = this.level
      ? [...COMMON, ...(BY_REACTOR[engine.state.reactor] || [])].filter((c) => {
        if (c.heavy && !this.level.heavy) return false;
        return eventSeverity(c.id) <= this.level.maxSeverity;
      })
      : [];
  }

  get active() { return !!this.level && this.pool.length > 0; }

  /** Ersten Zeitpunkt setzen. Getrennt von new, weil die Sitzung erst in
   *  start() weiss, ob sie überhaupt läuft. */
  begin(t) {
    if (!this.active) return;
    this.nextT = t + this.level.grace + this.rng.range(0, this.level.interval[0]);
    this.alerted = false;
  }

  /** Ein Rechenschritt. Wird aus Session.step() gerufen, nach stepEvents(). */
  step() {
    if (!this.active) return;
    const s = this.engine.state;
    const t = s.t_sim;
    if (this.level.warnS > 0 && !this.alerted && t >= this.nextT - this.level.warnS
      && t < this.nextT && this._ready()) {
      this.alerted = true;
      if (this.onAlert) this.onAlert();
    }
    if (t < this.nextT) return;
    // Nicht fällig heisst nicht verfallen: solange die Anlage steht oder
    // gerade abgeschaltet ist, wird der Zeitpunkt nur nach hinten geschoben.
    // Sonst prasselte nach jeder Schnellabschaltung alles auf einmal herein,
    // was während des Stillstands aufgelaufen ist.
    if (!this._ready()) { this._reschedule(t, 0.5); return; }
    const fired = this._fire();
    this._reschedule(t, fired ? 1 : 0.25);
  }

  /** Darf jetzt überhaupt etwas passieren? */
  _ready() {
    const s = this.engine.state;
    return !s.destroyed && !s.scram.active && s.n >= MIN_POWER_FRAC;
  }

  _reschedule(t, factor) {
    const [lo, hi] = this.level.interval;
    this.nextT = t + this.rng.range(lo, hi) * factor;
    this.alerted = false;
  }

  /** Eine passende Störung auslösen. @returns {boolean} ob etwas passiert ist */
  _fire() {
    const e = this.engine;
    // Kandidaten jedes Mal neu prüfen: was vor einer Stunde noch gepasst
    // hätte, ist jetzt vielleicht schon eingetreten (siehe `when`).
    const options = this.pool.filter((c) => {
      try { return c.when(e); } catch { return false; }
    });
    if (!options.length) return false;
    const choice = options[this.rng.int(0, options.length - 1)];
    const def = getEvent(choice.id);
    if (!def) return false;
    const args = choice.args ? choice.args(e, this.rng) : {};
    def.apply(e, args);
    noteEvent(e, eventKey(choice.id));
    // Gleicher Eintrag wie beim Szenario (siehe session.js): das
    // Ereignisprotokoll unterscheidet nicht, woher die Störung kam.
    e.ctx.log.push({
      t: e.state.t_sim, key: eventKey(choice.id), severity: eventSeverity(choice.id), kind: 'on',
    });
    return true;
  }

  snapshot() {
    return { level: this.levelId, nextT: this.nextT, alerted: this.alerted, rng: this.rng.snapshot() };
  }

  restore(data) {
    if (!data || typeof data !== 'object') return;
    // Die Stufe selbst kommt NICHT aus dem Spielstand zurück: sie wurde beim
    // Start dieser Runde gewählt, und wer einen Stand mit einer anderen
    // Einstellung fortsetzt, meint die neue. Nur der Zeitpunkt und der Würfel
    // werden übernommen, damit die Reihe weiterläuft statt neu zu beginnen.
    if (Number.isFinite(data.nextT)) this.nextT = data.nextT;
    this.alerted = !!data.alerted;
    this.rng.restore(data.rng);
  }
}
