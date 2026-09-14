// Ablauf eines Laufs: Auswahl → Einweisung → Betrieb → Auswertung.
//
// Die Sitzung kennt die Oberfläche nicht. Sie meldet Zustandswechsel über
// Rückrufe, damit main.js entscheidet, was angezeigt wird.

import { Scenario, RunState } from './scenario.js';
import { getEvent, eventKey, eventSeverity, stepEvents } from './events.js';
import { score } from './scoring.js';
import { Rng } from '../rng.js';
import { StartupTutorial, STARTUP_TUTORIAL } from './tutorial.js';
import { noteEvent, observeAlarms, learningReport } from './learning.js';
import { ScenarioObjectives } from './objectives.js';
import { TrendHistory } from './trendHistory.js';

// Freies Spiel ohne Bedarfskurve hiesse: "folge der Netzanforderung" waere
// nichts als "lass die Anforderung, wie sie ist" -- kein Unterschied zum
// Nichtstun. Ein Szenario hat feste Kennpunkte in der JSON-Datei; das freie
// Spiel bekommt stattdessen einen Zufallsspaziergang, neu gesät bei jedem
// Start (kein fester Seed wie im Szenario -- hier zaehlt keine Wertung, die
// Wiedergabe reproduzieren muesste).
const FREE_DEMAND_MIN_FRAC = 0.5;   // Untergrenze der Anforderung, Anteil P0_e
const FREE_DEMAND_MAX_FRAC = 1.0;   // Obergrenze
const FREE_DEMAND_INTERVAL_S = [300, 900];   // Abstand zwischen neuen Zielwerten
const FREE_DEMAND_RAMP_FRAC_PER_S = 0.002;   // maximale Aenderung je Sekunde, Anteil P0_e

export const PHASE = {
  BRIEFING: 'briefing',
  RUNNING: 'running',
  DEBRIEF: 'debrief',
};

export class Session {
  /**
   * @param {object} engine
   * @param {object} scenarioDef  geladene JSON-Definition, oder null für freies Spiel
   */
  constructor(engine, scenarioDef) {
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
      ? new StartupTutorial(engine) : null;
    this.demandRng = this.free ? new Rng(Date.now() >>> 0) : null;
    this.demandTarget = null;
    this.demandNextChangeT = 0;
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
      // Erstes Ziel erst ein Stueck nach dem Start waehlen -- sonst zerrt die
      // Anforderung schon in der ersten Minute an einer Anlage, die gerade
      // erst in den Beharrungszustand gefahren ist.
      this.demandTarget = this.engine.state.P_demand;
      this.demandNextChangeT = this.demandRng.range(...FREE_DEMAND_INTERVAL_S);
    }
    this.engine.ctx.trends.sample();
  }

  snapshot() {
    if (this.tutorial) return { tutorial: this.tutorial.snapshot() };
    if (this.objectives) return { objectives: this.objectives.snapshot() };
    return this.free ? { demandTarget: this.demandTarget,
      demandNextChangeT: this.demandNextChangeT, rng: this.demandRng.snapshot() } : {};
  }

  restore(data) {
    if (this.tutorial) { this.tutorial.restore(data?.tutorial); return; }
    if (this.objectives) { this.objectives.restore(data?.objectives); return; }
    if (!this.free || !data) return;
    if (Number.isFinite(data.demandTarget)) this.demandTarget = data.demandTarget;
    if (Number.isFinite(data.demandNextChangeT)) this.demandNextChangeT = data.demandNextChangeT;
    this.demandRng.restore(data.rng);
  }

  /** Freies Spiel: die Anforderung wandert langsam zu einem neuen Zufallsziel,
   *  nie sprunghaft -- ein realer Netzbetreiber ruft auch keine Stufenfunktion
   *  ab. */
  _stepFreeDemand(s, dt) {
    const p0 = this.engine.spec.P0_e;
    if (s.t_sim >= this.demandNextChangeT) {
      this.demandTarget = this.demandRng.range(FREE_DEMAND_MIN_FRAC, FREE_DEMAND_MAX_FRAC) * p0;
      this.demandNextChangeT = s.t_sim + this.demandRng.range(...FREE_DEMAND_INTERVAL_S);
    }
    const maxStep = FREE_DEMAND_RAMP_FRAC_PER_S * p0 * dt;
    const diff = this.demandTarget - s.P_demand;
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
        this.result.tutorial = this.tutorial.snapshot();
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
