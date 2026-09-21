// Netzleitstelle: Aufträge mit Frist und Haltefenster.
//
// Die Tageslastkurve des freien Spiels (siehe session.js: freeDemandFrac) ist
// ein Fahrplan, den niemand ausspricht. Sie wandert, man fährt hinterher, und
// am Ende weiss man nicht, ob das gut war -- die einzige Rückmeldung war bis
// hierher der Schichtbericht alle acht Stunden.
//
// Ein Auftrag macht daraus eine Zusage: "auf 600 MW bis 14:20, dann 30
// Minuten halten". Erfüllt oder gescheitert, sichtbar, gezählt.
//
// ── Warum die Leitstelle den Sollwert selbst fährt ──────────────────────────
//
// Der naheliegende Aufbau wäre, dem Auftrag einen zweiten Schreiber auf
// s.P_demand zu geben, der gegen die Kurve antritt. Das wäre falsch
// herum gedacht: eine echte Netzleitstelle kämpft nicht gegen einen
// Fahrplan, SIE IST die Quelle des Sollwerts. Die Tageskurve ist nur, was sie
// fährt, wenn nichts Besonderes ist.
//
// Deshalb bleibt es bei genau einem Schreiber (_stepFreeDemand), der seine
// Zielvorgabe entweder aus der Kurve oder aus dem laufenden Auftrag nimmt.
// Beides durchläuft dieselbe Rampengrenze, also springt an keinem Übergang
// etwas. Bewertet wird nicht, ob der Spieler den Sollwert KENNT -- er steht
// ja da --, sondern ob seine Anlage ihn HALTEN konnte. Da beissen Xenon,
// Kernalter und Jahreszeit.
//
// ── Warum die Rampe viel langsamer ist als erlaubt ──────────────────────────
//
// FREE_DEMAND_RAMP_FRAC_PER_S (session.js) erlaubt 0,2 % der Nennleistung je
// Sekunde, beim Druckwasserreaktor also 168 MW/min. Ein wirklicher
// Druckwasserreaktor folgt 3 bis 5 % je MINUTE, also 42 bis 70 MW/min -- die
// bestehende Grenze ist drei- bis viermal schneller, als irgendeine Anlage
// folgen kann. Bei der Tageskurve fällt das nicht auf, die ist ohnehin
// langsam. Ein Auftrag, der die Grenze ausschöpfte, wäre unfahrbar. Deshalb
// rechnet er mit einem Viertel davon.
//
// ── Warum die Rückfahrt zum Auftrag gehört ─────────────────────────────────
//
// Nach dem Haltefenster muss die Anforderung zurück auf den Fahrplan, der
// inzwischen weitergelaufen ist. Liesse man das die Kurve allein machen,
// bekäme der Spieler eine Rampe aufgeladen, die er nicht verursacht hat --
// und sie ginge über RunState.accumulate() voll in seinen Lastfolgefehler
// ein, weil der im freien Spiel gegen s.P_demand misst. Die Rückfahrt ist
// deshalb eine eigene Phase des Auftrags, mit derselben sanften Rampe.

import { Rng } from '../rng.js';

/**
 * Die Stufen, die der Spieler vor dem Start wählt -- eigenes Auswahlfeld,
 * nicht an die Störungsstufe gekoppelt: eine ruhige Schicht MIT Aufträgen
 * (reines Lastfolgen) und eine wilde Schicht OHNE (Störungen abarbeiten, ohne
 * gleichzeitig eine Zusage zu halten) sind beide sinnvoll, und wer die
 * Störungen abschaltet, will nicht stillschweigend auch die Aufträge
 * verlieren.
 *
 * `interval` ist der Abstand zwischen dem Ende eines Auftrags und der
 * Ankündigung des nächsten, `grace` hält den Rundenanfang frei -- dieselbe
 * Überlegung wie bei FAULT_LEVELS in freeEvents.js.
 */
export const DISPATCH_LEVELS = {
  off: null,
  rare: { interval: [4500, 7200], grace: 1800 },
  normal: { interval: [2400, 4500], grace: 1200 },
};

export const DISPATCH_LEVEL_IDS = Object.keys(DISPATCH_LEVELS);

// Rampe des Auftrags: 3 % der Nennleistung je Minute, ein Viertel dessen, was
// die Anforderung selbst dürfte (siehe Kopfkommentar).
const RAMP_FRAC_PER_S = 0.03 / 60;
// Nie höher als das: sonst macht die Jahreszeit Aufträge unerfüllbar. Im
// Sommer fehlen dem SWR und dem RBMK rund 3 % der Nennleistung (siehe
// game/season.js) -- die saisonale Härte gehört in die Abendspitze des
// Fahrplans, wo sie eine Aufgabe ist, nicht in einen Auftrag, den die Physik
// verbietet.
const MAX_FRAC = 0.92;
// Und nie tiefer: darunter wird die Anlage zum Sonderfall (Xenon, Stabilität,
// bei tiefer Leistung ist Lastfolgen keine Übung mehr, sondern ein Anfahren).
const MIN_FRAC = 0.40;
// Ein Auftrag über 20 MW Unterschied ist kein Auftrag, sondern Rauschen.
const MIN_STEP_FRAC = 0.08;
// Toleranzband, in dem die Haltezeit läuft -- 3 % der Nennleistung, dieselbe
// Größenordnung wie FREE_TOLERANCE_MW der Lastfolgebewertung.
const TOL_FRAC = 0.03;
// Haltezeit und Vorlauf zwischen Ankündigung und Rampenbeginn. Der Vorlauf
// ist der Sinn der Ankündigung: Zeit, sich auf die Rampe vorzubereiten.
const HOLD_S = [900, 2700];
const LEAD_S = [180, 420];
// Nachfrist auf das Haltefenster. Gefordert ist die UNGEBROCHENE Haltezeit
// (eine Bandverletzung setzt sie auf null, wie bei den Szenariozielen in
// objectives.js) -- ohne Nachfrist wäre damit die erste Unachtsamkeit im
// Fenster automatisch das Ende. Mit 25 % kostet eine Verletzung Nachfrist,
// zwei grössere kosten den Auftrag.
const GRACE_FRAC = 0.25;
// Unter dieser Neutronenleistung kommt kein Auftrag -- dieselbe Zahl und
// dieselbe Begründung wie in freeEvents.js.
const MIN_POWER_FRAC = 0.15;

/** Tageszeit als hh:mm für den Protokolltext. Bewusst NICHT aus ui/i18n.js
 *  geholt: die Spielschicht kennt die Oberfläche nicht, und ein
 *  Doppelpunkt zwischen zwei aufgefüllten Zahlen ist kein Sprachformat,
 *  sondern eine Uhr. */
function hhmm(seconds) {
  const s = Math.max(0, Math.floor(seconds)) % 86400;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}`;
}

/** Gibt es die Stufe? Alles andere gilt als "aus" -- ein unbekannter Wert aus
 *  einer alten Einstellung soll das freie Spiel nicht verweigern. */
export function dispatchLevel(id) {
  return Object.hasOwn(DISPATCH_LEVELS, id) ? DISPATCH_LEVELS[id] : null;
}

export class Dispatch {
  /**
   * @param {object} engine
   * @param {string} levelId  Schlüssel aus DISPATCH_LEVELS
   * @param {number} seed     eigener Würfel, nicht derselbe wie fürs
   *   Lastrauschen oder für die Störungen: sonst haengt der Zeitpunkt des
   *   nächsten Auftrags davon ab, wie oft die anderen zwei zwischendurch
   *   gewürfelt haben, und eine Änderung an der einen Mechanik verschöbe
   *   lautlos die andere.
   * @param {object} run      RunState -- dort stehen die Zähler, die der
   *   Schichtbericht alle acht Stunden bilanziert (siehe game/shift.js).
   */
  constructor(engine, levelId, seed, run) {
    this.engine = engine;
    this.run = run;
    this.levelId = Object.hasOwn(DISPATCH_LEVELS, levelId) ? levelId : 'off';
    this.level = DISPATCH_LEVELS[this.levelId] || null;
    this.rng = new Rng(seed >>> 0);
    this.nextT = 0;
    this.count = 0;
    this.order = null;
    this.lastT = 0;
  }

  get active() { return !!this.level; }

  /** Ersten Zeitpunkt setzen. Getrennt von new, wie bei FreeFaults: die
   *  Sitzung weiss erst in start(), ob sie überhaupt läuft. */
  begin(t) {
    this.lastT = t;
    if (!this.active) return;
    this.nextT = t + this.level.grace + this.rng.range(0, this.level.interval[0]);
  }

  /**
   * Ein Rechenschritt. MUSS vor _stepFreeDemand() laufen: erst die
   * Zustandswechsel dieses Takts, dann die Zielvorgabe, die sich daraus
   * ergibt.
   */
  step() {
    if (!this.active) return;
    const s = this.engine.state;
    const t = s.t_sim;
    // Wie objectives.js: die verstrichene Zeit aus der Simulationszeit
    // ableiten statt dem dt zu glauben. Der Xenon-Vorlauf springt in sehr
    // grossen Schritten, und eine Haltezeit, die sich ihr eigenes dt
    // ausdenkt, ist keine Zeit.
    const elapsed = t - this.lastT;
    this.lastT = t;
    if (!Number.isFinite(elapsed) || elapsed <= 0) return;

    if (this._blocked()) {
      // Ein laufender Auftrag wird ABGEBROCHEN, nicht als gescheitert
      // gezählt. Dieselbe Ausnahme wie bei der Fehlbedingung
      // grid_deviation (siehe game/scenario.js checkFail): wer auf eine
      // Auslösemeldung hin richtig abschaltet, kann danach keine Leistung
      // mehr liefern -- ihn dafür den Auftrag zu verlieren, bestraft genau
      // die Handlung, zu der jeder Hilfetext auffordert.
      if (this.order) {
        this._log('log_order_cancelled', { id: this.order.id });
        this.order = null;
      }
      // Wie bei den Störungen: während des Stillstands staut sich nichts auf,
      // und nach dem Wiederanfahren gibt es dieselbe Ruhe wie zu Rundenbeginn.
      this.nextT = Math.max(this.nextT, t + this.level.grace);
      return;
    }

    if (!this.order) {
      if (t >= this.nextT) this._announce(t);
      return;
    }

    const o = this.order;
    if (o.state === 'lead' && t >= o.rampStartT) {
      // Der Ausgangswert wird ERST JETZT eingefangen, nicht bei der
      // Ankündigung: der Fahrplan ist seither weitergelaufen, und eine
      // Rampe, die von einem veralteten Wert aus rechnet, setzt mit einem
      // Sprung ein.
      o.fromMw = s.P_demand;
      o.state = 'ramping';
    }
    if (o.state === 'ramping' && t >= o.atT) o.state = 'holding';
    if (o.state === 'holding') {
      const inBand = Math.abs(s.P_e - o.mw) <= o.tolMw;
      o.held = inBand ? Math.min(o.holdS, o.held + elapsed) : 0;
      if (o.held >= o.holdS - 1e-9) this._settle('met', t);
      else if (t >= o.atT + o.windowS) this._settle('failed', t);
    }
    if (o.state === 'releasing' && t >= o.releaseStartT + o.releaseS) {
      this.order = null;
      const [lo, hi] = this.level.interval;
      this.nextT = t + this.rng.range(lo, hi);
    }
  }

  /**
   * Zielvorgabe dieses Takts.
   * @param {number} scheduleMw  was der Fahrplan gerade wollte
   * @returns {?number} MW, die die Anforderung anstreben soll, oder null,
   *   wenn der Fahrplan führt
   */
  targetMw(scheduleMw) {
    const o = this.order;
    if (!o) return null;
    const t = this.engine.state.t_sim;
    if (o.state === 'lead') return null;
    if (o.state === 'ramping') {
      const span = o.atT - o.rampStartT;
      const f = span > 0 ? Math.min(1, Math.max(0, (t - o.rampStartT) / span)) : 1;
      return o.fromMw + (o.mw - o.fromMw) * f;
    }
    if (o.state === 'holding') return o.mw;
    // Rückfahrt: das Ziel ist der LEBENDE Fahrplanwert, nicht der von damals.
    // Damit landet die Rampe am Ende genau auf ihm, auch wenn er sich
    // während des Haltefensters weit bewegt hat -- kein Sprung beim
    // Zurückgeben.
    const f = o.releaseS > 0
      ? Math.min(1, Math.max(0, (t - o.releaseStartT) / o.releaseS)) : 1;
    return o.mw + (scheduleMw - o.mw) * f;
  }

  /** Was die Anzeige braucht. null, wenn gerade kein Auftrag ansteht. */
  view() {
    const o = this.order;
    if (!o) return null;
    return {
      id: o.id, mw: o.mw, tolMw: o.tolMw, state: o.state,
      atT: o.atT, wallAtT: o.atT + this._wallOffset(),
      holdS: o.holdS, held: o.held, windowS: o.windowS,
      deadlineT: o.atT + o.windowS,
    };
  }

  /** Darf jetzt überhaupt ein Auftrag laufen? */
  _blocked() {
    const s = this.engine.state;
    return !!s.destroyed || !!s.scram.active || !s.breaker || !(s.n >= MIN_POWER_FRAC);
  }

  _wallOffset() {
    const w = this.engine.ctx.wallClock;
    return Number.isFinite(w) ? w : 0;
  }

  _announce(t) {
    const s = this.engine.state;
    const p0 = this.engine.spec.P0_e;
    const nowFrac = p0 > 0 ? s.P_demand / p0 : 0;
    const targetFrac = this._pickFrac(nowFrac);
    if (targetFrac === null) {
      // Gerade lässt sich kein Auftrag bilden, der weit genug vom aktuellen
      // Wert entfernt UND im zulässigen Band liegt. Bald wieder nachsehen
      // statt das ganze Intervall zu verschenken -- wie FreeFaults._fire().
      this.nextT = t + this.rng.range(...this.level.interval) * 0.25;
      return;
    }
    const mw = targetFrac * p0;
    const rampS = Math.max(120, Math.abs(mw - s.P_demand) / (RAMP_FRAC_PER_S * p0));
    const holdS = Math.round(this.rng.range(...HOLD_S) / 60) * 60;
    const rampStartT = t + this.rng.range(...LEAD_S);
    this.count++;
    this.order = {
      id: this.count,
      mw,
      tolMw: TOL_FRAC * p0,
      fromMw: s.P_demand,
      rampStartT,
      atT: rampStartT + rampS,
      holdS,
      windowS: holdS * (1 + GRACE_FRAC),
      // Gleiche Dauer wie die Anfahrrampe. Das Ziel ist ohnehin der lebende
      // Fahrplanwert (siehe targetMw), die Dauer legt nur fest, wie sanft
      // zurückgegeben wird.
      releaseS: rampS,
      releaseStartT: 0,
      held: 0,
      state: 'lead',
    };
    this._log('log_order_new', {
      id: this.count,
      mw: Math.round(mw),
      time: hhmm(rampStartT + rampS + this._wallOffset()),
      min: Math.round(holdS / 60),
    });
  }

  /** Zielanteil würfeln: im Band, und weit genug vom aktuellen Wert weg. */
  _pickFrac(nowFrac) {
    for (let tries = 0; tries < 12; tries++) {
      const frac = this.rng.range(MIN_FRAC, MAX_FRAC);
      if (Math.abs(frac - nowFrac) >= MIN_STEP_FRAC) return frac;
    }
    // Der Fahrplan steht offenbar mitten im Band. Dann den weiter entfernten
    // Rand nehmen, statt gar keinen Auftrag zu geben.
    const low = nowFrac - MIN_FRAC;
    const high = MAX_FRAC - nowFrac;
    if (Math.max(low, high) < MIN_STEP_FRAC) return null;
    return low > high ? MIN_FRAC : MAX_FRAC;
  }

  _settle(kind, t) {
    const o = this.order;
    if (kind === 'met') this.run.ordersMet++;
    else this.run.ordersFailed++;
    this._log('log_order_' + kind, { id: o.id, mw: Math.round(o.mw) });
    o.state = 'releasing';
    o.releaseStartT = t;
  }

  /** Gleicher Protokolleintrag wie bei Störung und Schichtbericht: die
   *  Zeitleiste unterscheidet nicht, woher eine Zeile kommt. */
  _log(key, params) {
    this.engine.ctx.log.push({ t: this.engine.state.t_sim, key, severity: 1, params });
  }

  snapshot() {
    return {
      level: this.levelId, nextT: this.nextT, count: this.count,
      lastT: this.lastT, rng: this.rng.snapshot(),
      order: this.order ? { ...this.order } : null,
    };
  }

  restore(data) {
    if (!data || typeof data !== 'object') return;
    // Die Stufe kommt NICHT aus dem Spielstand zurück -- sie wurde beim Start
    // dieser Runde gewählt, und wer einen Stand mit einer anderen Einstellung
    // fortsetzt, meint die neue. Gleiche Regel wie bei FreeFaults.restore().
    if (Number.isFinite(data.nextT)) this.nextT = data.nextT;
    if (Number.isFinite(data.count) && data.count >= 0) this.count = data.count;
    if (Number.isFinite(data.lastT) && data.lastT >= 0) this.lastT = data.lastT;
    this.rng.restore(data.rng);
    this.order = this._restoreOrder(data.order);
  }

  /** Ein Auftrag aus dem Spielstand muss vollständig und in sich schlüssig
   *  sein. Ein halb gelesener Auftrag wäre schlimmer als keiner: er fährt die
   *  Netzanforderung. */
  _restoreOrder(d) {
    if (!this.active || !d || typeof d !== 'object') return null;
    const numbers = ['id', 'mw', 'tolMw', 'fromMw', 'rampStartT', 'atT', 'holdS',
      'windowS', 'releaseS', 'releaseStartT', 'held'];
    if (numbers.some((k) => !Number.isFinite(d[k]) || d[k] < 0)) return null;
    if (!['lead', 'ramping', 'holding', 'releasing'].includes(d.state)) return null;
    if (d.atT < d.rampStartT || d.held > d.holdS || d.holdS <= 0) return null;
    return { ...Object.fromEntries(numbers.map((k) => [k, d[k]])), state: d.state };
  }
}
