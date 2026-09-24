// Untersuchung, keine Zusicherung: was taete der Speisewasserschwall von
// 01:19, wenn die Uebung ihn faehrt?
//
// Hintergrund: BACKLOG.md, "Nicht nachgebildet: Speisewasserschwall um
// 01:19". Historisch hob die Mannschaft den Speisewasserstrom stark an, weil
// der Trommelwasserstand zu tief stand, und nahm ihn kurz vor dem Versuch
// wieder zurueck. Die Wirkkette dafuer steckt in rbmk.js bereits vollstaendig
// drin: mehr kaltes Speisewasser -> hoehere Unterkuehlung (_subcooling) ->
// weniger Dampfblasen (_void) -> negative Reaktivitaet ueber den positiven
// Blasenkoeffizienten -> die Leistungsregelung zieht die Staebe weiter.
//
// Gemessen wurde damit nicht, OB das geht, sondern wie kraeftig es sein darf:
// der Zustand beim Auslaufbeginn ist die Grundlage, auf die die AZ-5-Wirkung
// kalibriert ist. Herausgekommen sind die 15 % / 30 s, die seit 0.6.4 in
// chernobylTutorial.js stehen (_stepFeedSurge).
//
// Das Werkzeug bleibt, weil die Frage wiederkommt, sobald jemand an Trommel,
// Speisewasser oder Blasenmodell arbeitet. Der eigene Schwall des Drehbuchs
// wird dafuer stillgelegt (tut._feedSurgeDone) und durch den hier gemessenen
// ersetzt -- der Fall "ohne Schwall" ist damit wirklich ohne.
//
// Aufruf: node tests/tools/chernobyl_feed_surge.mjs

import { createEngine } from '../../static/js/sim/engine.js';
import * as rbmk from '../../static/js/plants/rbmk.js';
import { Session, PHASE } from '../../static/js/game/session.js';
import { RBMK_CHERNOBYL_TUTORIAL } from '../../static/js/game/chernobylTutorial.js';

const DT = 0.05;
const DEF = {
  id: 'rbmk_chernobyl', reactor: 'rbmk', tutorial: RBMK_CHERNOBYL_TUTORIAL,
  difficulty: 3, title_key: 'x', brief_key: 'x', duration_s: 7200, seed: 26041986,
  demand: [{ t: 0, mw: 0 }, { t: 7200, mw: 0 }], events: [], fail: [{ type: 'fuel_damage' }],
};

const WALL_SURGE_S = 1 * 3600 + 19 * 60;        // 01:19:00
const WALL_COAST_S = 1 * 3600 + 23 * 60 + 4;    // 01:23:04

const hms = (sec) => new Date(Math.round(sec) * 1000).toISOString().slice(11, 19);

function boot() {
  const engine = createEngine(rbmk, { seed: DEF.seed });
  const session = new Session(engine, DEF);
  session.start();
  return { engine, session };
}

/**
 * @param {number|null} manual  Speisewasser-Handstellwert waehrend des
 *   Schwalls, als Anteil des Nennstroms (fwCtl.manual). null = kein Schwall.
 */
function run(manual, durS) {
  const f = boot();
  const { engine, session } = f;
  const s = engine.state;
  const c = engine.ctx;
  const tut = session.tutorial;
  const wall = () => s.t_sim + (engine.ctx.wallClock || 0);

  // Den eingebauten Schwall stilllegen: gemessen wird der aus dieser Datei.
  tut._feedSurgeDone = true;
  let confirmed = false;
  let surging = false;
  let back = false;
  let az5 = null;
  let ruin = null;
  let peak = s.n;
  const marks = [];
  let atCoast = null;
  let nMin = 1;
  let subMax = 0;
  let lMax = 0;

  for (let i = 0; i < Math.round(4000 / DT) && session.phase === PHASE.RUNNING; i++) {
    engine.step(DT);
    session.step(DT, engine.trips.tiles(), 0);
    if (!confirmed && tut.index === 0 && tut.inspectReady) confirmed = tut.confirmInspect();
    const w = wall();

    if (manual !== null && !surging && w >= WALL_SURGE_S && tut.steps[tut.index] === 'hold') {
      c.fwCtl.auto = false;
      c.fwCtl.manual = manual;
      surging = true;
    }
    if (surging && !back && w >= WALL_SURGE_S + durS) {
      c.fwCtl.auto = true;
      back = true;
    }
    if (surging && !s.scram.active) {
      nMin = Math.min(nMin, s.n);
      subMax = Math.max(subMax, s.dTsub);
      lMax = Math.max(lMax, s.L_drum);
    }
    // Eine Marke je halbe Minute zwischen Schwall und Auslauf.
    if (w >= WALL_SURGE_S - 60 && w <= WALL_COAST_S + 5
        && marks.length < 40 && w >= (marks.length ? marks[marks.length - 1].w + 30 : 0)) {
      const d = engine.derive();
      marks.push({ w, n: s.n, fw: s.W_fw, sub: s.dTsub, void: s.alphaBar,
        L: s.L_drum, rod: s.rod[0], orm: d.orm });
    }
    if (tut._runbackT0 != null && atCoast === null) {
      const d = engine.derive();
      atCoast = { n: s.n, sub: s.dTsub, void: s.alphaBar, L: s.L_drum,
        orm: d.orm, M: s.M_drum };
    }
    peak = Math.max(peak, s.n);
    if (az5 === null && s.scram.active) az5 = w;
    if (ruin === null && s.destroyed) ruin = w;
  }
  return { marks, atCoast, az5, ruin, peak, destroyed: s.destroyed, nMin, subMax, lMax };
}

// Der Trommelwasserstand ist bei 1,00 m abgeschnitten (rbmk.js: clamp) und
// meldet ab 0,78 m "hoch". Ein Schwall, der ihn dort hineinfaehrt, ist in
// diesem Modell nicht mehr darstellbar -- gemessen werden deshalb kurze,
// massvolle Schwalle, und ausdruecklich auch, was danach beim Auslaufbeginn
// steht: darauf ist die AZ-5-Wirkung kalibriert.
const cases = [
  ['ohne Schwall', null, 0],
  ['Hand 12 %, 30 s', 0.12, 30],
  ['Hand 15 %, 30 s (wie gebaut)', 0.15, 30],
  ['Hand 15 %, 60 s', 0.15, 60],
  ['Hand 20 %, 45 s', 0.20, 45],
  ['Hand 15 %, 120 s', 0.15, 120],
];

for (const [label, manual, durS] of cases) {
  const r = run(manual, durS);
  console.log(`\n== ${label} ==`);
  console.log('   Uhr        n        W_fw     dTsub    Blasen   Pegel    Stab     ORM');
  for (const m of r.marks) {
    console.log(`   ${hms(m.w)}  ${(m.n * 100).toFixed(2).padStart(6)}%`
      + ` ${m.fw.toFixed(0).padStart(7)} kg/s ${m.sub.toFixed(1).padStart(6)} K`
      + ` ${(m.void * 100).toFixed(2).padStart(7)}% ${m.L.toFixed(2).padStart(7)} m`
      + ` ${m.rod.toFixed(3).padStart(7)} ${m.orm.toFixed(1).padStart(7)}`);
  }
  const c = r.atCoast;
  console.log(`   beim Auslaufbeginn: n=${(c.n * 100).toFixed(2)}%  dTsub=${c.sub.toFixed(1)} K`
    + `  Blasen=${(c.void * 100).toFixed(2)}%  Pegel=${c.L.toFixed(2)} m  ORM=${c.orm.toFixed(1)}`);
  console.log(`   waehrend des Schwalls: n min ${(r.nMin * 100).toFixed(2)}%,`
    + ` dTsub max ${r.subMax.toFixed(1)} K, Pegel max ${r.lMax.toFixed(2)} m`
    + ` (Meldung "hoch" ab 0,78 m)`);
  console.log(`   AZ-5 ${r.az5 === null ? '-' : hms(r.az5)}`
    + `   Zerstoerung ${r.ruin === null ? 'KEINE' : hms(r.ruin)}`
    + `   Spitze ${(r.peak * 100).toFixed(0)} %`);
}
