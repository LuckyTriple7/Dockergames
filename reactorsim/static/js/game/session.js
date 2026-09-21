// Ablauf eines Laufs: Auswahl → Einweisung → Betrieb → Auswertung.
//
// Die Sitzung kennt die Oberfläche nicht. Sie meldet Zustandswechsel über
// Rückrufe, damit main.js entscheidet, was angezeigt wird.

import { Scenario, RunState } from './scenario.js';
import { getEvent, eventKey, eventSeverity, stepEvents } from './events.js';
import { score } from './scoring.js';
import { Rng } from '../rng.js';
import { StartupTutorial, STARTUP_TUTORIAL } from './tutorial.js';
import { RbmkStartupTutorial, RBMK_STARTUP_TUTORIAL } from './rbmkTutorial.js';
import { BwrStartupTutorial, BWR_STARTUP_TUTORIAL } from './bwrTutorial.js';
import { RbmkChernobylTutorial, RBMK_CHERNOBYL_TUTORIAL } from './chernobylTutorial.js';
import { noteEvent, observeAlarms, learningReport } from './learning.js';
import { ScenarioObjectives } from './objectives.js';
import { TrendHistory } from './trendHistory.js';
import { FreeFaults } from './freeEvents.js';

// Freies Spiel ohne Bedarfskurve hiesse: "folge der Netzanforderung" waere
// nichts als "lass die Anforderung, wie sie ist" -- kein Unterschied zum
// Nichtstun. Ein Szenario hat feste Kennpunkte in der JSON-Datei; das freie
// Spiel bekam stattdessen lange einen reinen Zufallsspaziergang.
//
// Der war zwar nie in Ruhe, aber auch nie vorhersehbar: jeder neue Zielwert
// kam aus dem Nichts, kein Punkt des Tages sagte etwas ueber den naechsten.
// Damit liess sich nichts planen, und ohne Planung bleibt vom Lastfolgen nur
// Hinterherfahren. Seit 0.6.6 fuehrt deshalb eine Tageslastkurve, wie sie
// ein Netz wirklich hat -- Nachttal, Morgenrampe, Abendspitze. Erst das
// macht die Xenon-Vergiftung zu einem Gegner, den man kommen sieht: wer
// nachts weit heruntergefahren ist, muss die Morgenrampe gegen das
// aufgebaute Xenon fahren.
//
// Anteile der elektrischen Nennleistung ueber der Tageszeit. Zwischen den
// Kennpunkten wird linear interpoliert; 24:00 wiederholt 00:00, damit die
// Kurve am Tageswechsel keinen Sprung hat.
const FREE_DEMAND_CURVE = [
  { h: 0, f: 0.62 }, { h: 3, f: 0.55 }, { h: 5, f: 0.58 }, { h: 7, f: 0.78 },
  { h: 9, f: 0.92 }, { h: 12, f: 0.95 }, { h: 14, f: 0.88 }, { h: 17, f: 0.93 },
  { h: 19, f: 1.00 }, { h: 21, f: 0.88 }, { h: 24, f: 0.62 },
];
// Die Schicht beginnt um 22:00 -- Nachtschicht. Das ist kein Schmuck: so
// liegen Nachttal und Morgenrampe in den ersten Stunden, also genau dort,
// wo der Spieler noch zuschaut. Bei 60x ist ein ganzer Tag 24 Minuten lang.
const FREE_SHIFT_START_S = 22 * 3600;
// Rauschen auf der Kurve: ein Netz ist nie genau die Prognose. Klein genug,
// um die Form nicht zu verwischen, gross genug, damit zwei Naechte sich
// nicht gleich anfuehlen.
const FREE_DEMAND_NOISE_FRAC = 0.04;
const FREE_DEMAND_NOISE_INTERVAL_S = [300, 900];
const FREE_DEMAND_RAMP_FRAC_PER_S = 0.002;   // maximale Aenderung je Sekunde, Anteil P0_e

/** Anteil der Nennleistung, den das Netz zur Tageszeit `sec` abruft.
 *  Exportiert fuer den Test -- die Kurve ist die halbe Spielmechanik des
 *  freien Spiels, sie soll nicht nur indirekt geprueft werden. */
export function freeDemandFrac(sec) {
  const h = (((sec % 86400) + 86400) % 86400) / 3600;
  for (let i = 1; i < FREE_DEMAND_CURVE.length; i++) {
    const a = FREE_DEMAND_CURVE[i - 1];
    const b = FREE_DEMAND_CURVE[i];
    if (h <= b.h) return a.f + (b.f - a.f) * ((h - a.h) / (b.h - a.h));
  }
  return FREE_DEMAND_CURVE[FREE_DEMAND_CURVE.length - 1].f;
}

export const PHASE = {
  BRIEFING: 'briefing',
  RUNNING: 'running',
  DEBRIEF: 'debrief',
};

export class Session {
  /**
   * @param {object} engine
   * @param {object} scenarioDef  geladene JSON-Definition, oder null für freies Spiel
   * @param {object} [opts]  nur fürs freie Spiel: `faults` ist die Stufe der
   *   Zufallsstörungen (siehe freeEvents.js FAULT_LEVELS). Vorgabe ist 'off',
   *   damit ein Aufruf ohne Angabe -- Tests, Wiedergabe -- dieselbe
   *   störungsfreie Runde bekommt wie vor 0.6.6. `faultSeed` setzt den
   *   Würfel fest; im Spiel bleibt er ungesetzt (jede Runde soll anders
   *   verlaufen), ein Test braucht dagegen eine Folge, die sich wiederholt.
   */
  constructor(engine, scenarioDef, opts = {}) {
    this.engine = engine;
    new TrendHistory(engine);
    this.free = !scenarioDef;
    this.scenario = scenarioDef ? new Scenario(scenarioDef) : null;
    this.run = this.scenario ? new RunState(this.scenario, engine.spec) : null;
    this.objectives = scenarioDef?.score_mode === 'incident_v1'
      ? new ScenarioObjectives(engine, this.scenario) : null;
    this.phase = this.scenario ? PHASE.BRIEFING : PHASE.RUNNING;
    this.onEnd = null;
    this.onAlert = null;
    this.result = null;
    this.tutorial = scenarioDef?.tutorial === STARTUP_TUTORIAL && engine.spec.id === 'pwr'
      ? new StartupTutorial(engine)
      : scenarioDef?.tutorial === RBMK_STARTUP_TUTORIAL && engine.spec.id === 'rbmk'
        ? new RbmkStartupTutorial(engine)
        : scenarioDef?.tutorial === BWR_STARTUP_TUTORIAL && engine.spec.id === 'bwr'
          ? new BwrStartupTutorial(engine)
          : scenarioDef?.tutorial === RBMK_CHERNOBYL_TUTORIAL && engine.spec.id === 'rbmk'
            ? new RbmkChernobylTutorial(engine) : null;
    this.demandRng = this.free ? new Rng(Date.now() >>> 0) : null;
    this.demandNoise = 0;
    this.demandNextChangeT = 0;
    // Eigener Würfel, nicht derselbe wie fürs Rauschen: sonst haengt der
    // Zeitpunkt der naechsten Stoerung davon ab, wie oft die Lastkurve
    // zwischendurch gewuerfelt hat, und eine Aenderung an der einen Mechanik
    // verschoebe lautlos die andere.
    this.faults = this.free
      ? new FreeFaults(engine, opts.faults || 'off', Number.isFinite(opts.faultSeed)
        ? opts.faultSeed : ((Date.now() >>> 0) ^ 0x9e3779b9)) : null;
  }

  start() {
    const preparation = this.scenario?.def.preparation;
    if (preparation !== undefined && (preparation !== 'rbmk_post_az5_v1'
      || this.engine.spec.id !== 'rbmk' || this.scenario.reactor !== 'rbmk')) {
      throw new Error('Invalid scenario preparation');
    }
    this.phase = PHASE.RUNNING;
    if (this.tutorial) this.tutorial.prepare();
    if (this.scenario) {
      const st = this.scenario.def.start_overrides || {};
      for (const [k, v] of Object.entries(st)) this.engine.state[k] = v;
      this.engine.state.P_demand = this.scenario.demandAt(0);
      if (preparation === 'rbmk_post_az5_v1') {
        this.engine.state.auxFeedInstalled = true;
        this.engine.scram('scenario');
      }
    } else {
      // Die Uhr der Schicht. ctx.wallClock ist der Versatz zu t_sim, den die
      // Statuskachel "Uhrzeit" schon fuer das Tschernobyl-Tutorial las
      // (siehe ui/panels.js) -- das freie Spiel hatte bisher als einziges
      // keine, und ohne sichtbare Uhrzeit waere eine Tageslastkurve nicht zu
      // lesen, nur zu erleiden.
      this.engine.ctx.wallClock = FREE_SHIFT_START_S;
      const s = this.engine.state;
      // Der Sollwert steht beim Uebernehmen dort, wo das Netz ihn gerade
      // haben will -- ein Sprung ist das nicht, es gibt ja noch keinen
      // vorherigen Wert, gegen den er springen koennte. Die Anlage selbst
      // steht auf Volllast: dass die Nachtschicht mit einem Rueckfahrauftrag
      // beginnt, ist die erste Aufgabe, nicht ein Fehler.
      s.P_demand = freeDemandFrac(FREE_SHIFT_START_S) * this.engine.spec.P0_e;
      this.demandNoise = 0;
      this.demandNextChangeT = s.t_sim + this.demandRng.range(...FREE_DEMAND_NOISE_INTERVAL_S);
      if (this.faults) {
        this.faults.onAlert = () => { if (this.onAlert) this.onAlert(); };
        this.faults.begin(s.t_sim);
      }
    }
    this.engine.ctx.trends.sample();
  }

  snapshot() {
    if (this.tutorial) return { tutorial: this.tutorial.snapshot() };
    if (this.objectives) return { objectives: this.objectives.snapshot() };
    return this.free ? { demandNoise: this.demandNoise,
      demandNextChangeT: this.demandNextChangeT, rng: this.demandRng.snapshot(),
      faults: this.faults ? this.faults.snapshot() : undefined } : {};
  }

  restore(data) {
    if (this.tutorial) { this.tutorial.restore(data?.tutorial); return; }
    if (this.objectives) { this.objectives.restore(data?.objectives); return; }
    if (!this.free || !data) return;
    // demandTarget aus Staenden vor 0.6.6 faellt weg: dort war es ein
    // absoluter Zielwert des Zufallsspaziergangs, hier ist es ein Zuschlag
    // auf die Tageskurve -- dieselbe Zahl haette eine andere Bedeutung.
    if (Number.isFinite(data.demandNoise)) this.demandNoise = data.demandNoise;
    if (Number.isFinite(data.demandNextChangeT)) this.demandNextChangeT = data.demandNextChangeT;
    this.demandRng.restore(data.rng);
    if (this.faults) this.faults.restore(data.faults);
  }

  /** Freies Spiel: die Anforderung folgt der Tageslastkurve, nie sprunghaft --
   *  ein realer Netzbetreiber ruft auch keine Stufenfunktion ab. Die
   *  Rampengrenze bleibt deshalb auch dann stehen, wenn die Kurve selbst
   *  schneller waere (sie ist es nirgends) oder das Rauschen neu wuerfelt. */
  _stepFreeDemand(s, dt) {
    const p0 = this.engine.spec.P0_e;
    if (s.t_sim >= this.demandNextChangeT) {
      this.demandNoise = this.demandRng.range(-FREE_DEMAND_NOISE_FRAC, FREE_DEMAND_NOISE_FRAC);
      this.demandNextChangeT = s.t_sim + this.demandRng.range(...FREE_DEMAND_NOISE_INTERVAL_S);
    }
    const frac = freeDemandFrac(FREE_SHIFT_START_S + s.t_sim) + this.demandNoise;
    const target = Math.max(0, frac) * p0;
    const maxStep = FREE_DEMAND_RAMP_FRAC_PER_S * p0 * dt;
    const diff = target - s.P_demand;
    s.P_demand += Math.max(-maxStep, Math.min(maxStep, diff));
  }

  /** Ein Rechenschritt. Wird aus der Schleife gerufen, nach engine.step().
   *  @param {Array} tiles engine.trips.tiles() dieses Takts -- worstSeverity
   *  wird daraus abgeleitet (dieselbe Reduktion wie vorher in main.js), UND
   *  die volle Liste geht an run.accumulate() weiter (Ursachen-Zeiten). */
  step(dt, tiles, unackedSeconds) {
    if (this.phase !== PHASE.RUNNING) return;
    let worstSeverity = 0;
    for (const tile of tiles) {
      if ((tile.tile === 'new' || tile.tile === 'ack') && tile.severity > worstSeverity) {
        worstSeverity = tile.severity;
      }
    }
    const s = this.engine.state;
    observeAlarms(this.engine, tiles);
    stepEvents(this.engine, dt);

    if (!this.scenario) {
      this._stepFreeDemand(s, dt);
      // Nach stepEvents(): eine Stoerung soll in demselben Takt wirken, in
      // dem sie ausgeloest wird, nicht erst im naechsten ueber die laufenden
      // Merker.
      if (this.faults) this.faults.step();
      this.engine.ctx.trends.sample(s);
      if (s.destroyed) this._finish(false, 'fail_fuel_damage');
      return;
    }

    // Bedarfskurve führt die Lastanforderung.
    s.P_demand = this.tutorial ? this.tutorial.demand : this.scenario.demandAt(s.t_sim);

    // Akustische Vorwarnung, 2-5 Minuten vor dem eigentlichen Ereignis --
    // main.js entscheidet, welcher Klang das ist.
    if (this.scenario.dueAlerts(s.t_sim).length && this.onAlert) this.onAlert();

    for (const ev of this.scenario.due(s.t_sim)) {
      const def = getEvent(ev.id);
      if (def) {
        def.apply(this.engine, ev.args || {});
        noteEvent(this.engine, eventKey(ev.id));
        this.engine.ctx.log.push({
          t: s.t_sim, key: eventKey(ev.id), severity: eventSeverity(ev.id), kind: 'on',
        });
      }
    }

    if (this.objectives) this.objectives.step(dt);
    const d = this.engine.derive();
    this.run.accumulate(s, d, worstSeverity, tiles, dt);
    this.unacked = unackedSeconds;

    const failed = this.run.checkFail(s, d, dt, worstSeverity);
    if (failed) { this._finish(false, failed, d); return; }
    if (this.tutorial) {
      this.tutorial.step(dt);
      s.P_demand = this.tutorial.demand;
    }
    this.engine.ctx.trends.sample(s, d);
    if (this.tutorial) {
      if (this.tutorial.done) this._finish(true, null, d);
      else if (s.t_sim >= this.scenario.duration) this._finish(false, 'tut_timeout', d);
    } else if (s.t_sim >= this.scenario.duration) {
      const completed = !this.objectives || this.objectives.done;
      this._finish(completed, completed ? null : 'fail_objectives_unmet', d);
    }
  }

  _finish(completed, failed, d) {
    if (this.phase === PHASE.DEBRIEF) return;
    this.engine.ctx.trends.sample(this.engine.state, d, true);
    this.phase = PHASE.DEBRIEF;
    if (this.run) {
      this.run.completed = completed;
      this.run.failed = failed;
      const sum = this.run.summary(this.engine.state);
      sum.alarm_seconds_unacked = Math.round(this.unacked || 0);
      if (this.objectives) {
        sum.score_mode = 'incident_v1';
        sum.objectives = this.objectives.view().map(({ id, met }) => ({ id, met }));
      }
      // causes liegt als Geschwister von summary, NICHT darin -- summary()
      // ist unveraendert das, was api.submitScore() als Server-Payload
      // verschickt (siehe main.js), Diagnosedaten bleiben aussen vor.
      this.result = { summary: sum, causes: this.run.topCauses(), learning: learningReport(this.engine), ...score(sum) };
      if (this.objectives) this.result.objectives = this.objectives.view();
      if (this.tutorial) {
        // `steps`/`prefix` NICHT Teil von snapshot() (das ist das
        // Speicherformat) -- nur hier fuer die einmalige Debrief-Anzeige
        // angehaengt, damit renderTutorialResult() (ui/tutorial.js) auch ein
        // Tutorial mit ANDEREN Schritten als den fuenf Anfahrschritten und
        // eigenem Text-Praefix korrekt auflistet.
        this.result.tutorial = { ...this.tutorial.snapshot(),
          steps: this.tutorial.steps, prefix: this.tutorial.prefix };
        this.result.score = null;
        this.result.parts = {};
      }
    }
    if (this.onEnd) this.onEnd(this.result, failed);
  }

  /** Vorzeitiger Abbruch durch den Spieler -- ohne Wertung. */
  abort() {
    this.phase = PHASE.DEBRIEF;
    this.result = null;
    if (this.onEnd) this.onEnd(null, 'aborted');
  }
}
