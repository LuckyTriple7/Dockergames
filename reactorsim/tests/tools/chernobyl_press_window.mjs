// Untersuchung, keine Zusicherung: in welchen Sekunden nach Auslaufbeginn
// zerstoert AZ-5 den Kern -- gemessen ueber den ECHTEN prepare()-Pfad des
// Tutorials, nicht ueber einen nachgebauten Zustand.
//
// Neu zu messen, seit der Turbinenauslauf eine echte Rotordrehzahl ist
// (rbmk.js sp.turbogen) statt einer linearen Rampe des Pumpen-Sollwerts auf
// null: die alten Fenster (8-21 s und 39-43 s) waren unter der alten Kurve
// kalibriert.
//
// Aufruf: node tests/tools/chernobyl_press_window.mjs [vonS] [bisS]

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

function boot() {
  const engine = createEngine(rbmk, { seed: DEF.seed });
  const session = new Session(engine, DEF);
  session.start();
  return { engine, session };
}

function one(f) {
  if (f.session.phase !== PHASE.RUNNING) return;
  f.engine.step(DT);
  f.session.step(DT, f.engine.trips.tiles(), 0);
}

/**
 * @param {number|null} pressAt  Sekunden nach Auslaufbeginn, zu denen AZ-5
 *   gedrueckt wird; null = gar nicht.
 * @param {boolean} dropTrim  den schmalen AR-Trimm wegnehmen.
 */
function run(pressAt, { dropTrim = false, watchS = 120 } = {}) {
  const f = boot();
  const { engine, session } = f;
  const s = engine.state;
  const c = engine.ctx;
  const tut = session.tutorial;

  // Das Drehbuch selbst darf hier nicht druecken -- diese Messung bestimmt
  // den Zeitpunkt.
  const realScram = engine.scram.bind(engine);
  let pressed = false;
  engine.scram = () => {};

  for (let i = 0; i < Math.round(6 / DT); i++) one(f);
  tut.confirmInspect();
  for (let i = 0; i < Math.round(5 / DT); i++) one(f);
  tut.confirmInspect();

  let peak = s.n;
  let tPeak = null;
  let tgAtPress = null;
  // 2500 s reichten bis 0.6.3; seit 0.6.4 laeuft die Erholung nach dem
  // Einbruch wirklich ab (kein Uhrensprung mehr), und der Auslauf beginnt
  // erst nach rund 3360 s. Mit dem alten Budget brach die Messung ab, BEVOR
  // ueberhaupt etwas zu messen war -- jeder Lauf meldete dann brav
  // "nicht zerstoert".
  const limit = Math.round(4200 / DT);
  for (let i = 0; i < limit && session.phase === PHASE.RUNNING; i++) {
    one(f);
    if (dropTrim && c.arTrim) { c.arTrim = null; s.rho_ext = 0; }
    if (tut._runbackT0 == null) continue;
    const since = s.t_sim - tut._runbackT0;
    if (!pressed && pressAt !== null && since >= pressAt) {
      realScram('az5');
      pressed = true;
      tgAtPress = s.tgSpeed;
    }
    if (s.n > peak) { peak = s.n; tPeak = since; }
    if (since > watchS) break;
  }
  return { peak, tPeak, destroyed: s.destroyed, tgAtPress,
    since: tut._runbackT0 == null ? null : s.t_sim - tut._runbackT0 };
}

const from = Number(process.argv[2] ?? 0);
const to = Number(process.argv[3] ?? 60);

console.log('AZ-5-Zeitpunkt -> Ausgang (echter prepare()-Pfad, neuer Rotorauslauf)');
console.log('  s   Drehzahl   Spitze n     bei      zerstoert');
const destroying = [];
for (let tPress = from; tPress <= to; tPress++) {
  const r = run(tPress);
  if (r.destroyed) destroying.push(tPress);
  console.log(`${String(tPress).padStart(3)}   ${(r.tgAtPress * 100).toFixed(0).padStart(6)} %`
    + `   ${(r.peak * 100).toFixed(1).padStart(7)} %`
    + `   t+${(r.tPeak ?? 0).toFixed(1).padStart(5)}s   ${r.destroyed ? 'JA' : '-'}`);
}

// Fenster zusammenfassen
const windows = [];
for (const t of destroying) {
  const last = windows[windows.length - 1];
  if (last && t === last[1] + 1) last[1] = t; else windows.push([t, t]);
}
console.log('\nZerstoerungsfenster:', JSON.stringify(windows));

const none = run(null);
console.log(`\nOHNE AZ-5:            Spitze ${(none.peak * 100).toFixed(1)} % `
  + `bei t+${(none.tPeak ?? 0).toFixed(1)}s, zerstoert=${none.destroyed}`);
const bare = run(null, { dropTrim: true });
console.log(`OHNE AZ-5, ohne Trimm: Spitze ${(bare.peak * 100).toFixed(1)} % `
  + `bei t+${(bare.tPeak ?? 0).toFixed(1)}s, zerstoert=${bare.destroyed}`);
