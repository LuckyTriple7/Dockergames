// Untersuchung, keine Zusicherung: laesst sich der historische
// Leistungseinbruch der Nacht (Leistung faellt gegen null, Mannschaft holt
// sie auf ~200 MWth zurueck) in DIESEM Modell nachfahren?
//
// Hintergrund: BACKLOG.md, "Leistungseinbruch nicht mechanisch simuliert".
// Die Aussage dort stammt aus der Zeit vor der Trennung von Absorber- und
// Spitzenwirkung in rbmk.js -- sie gehoert nachgemessen, nicht geglaubt.
//
// Gefahren wird der Einbruch ueber die Staebe (der einzige Weg, der ohne neue
// Mechanik auskommt), danach bekommt die Leistungsregelung so lange Zeit, wie
// die Uebung ohnehin haette.
//
// Aufruf: node tests/tools/chernobyl_dip.mjs

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
 * @param {number} depth   auf welchen Bruchteil die Leistung einbrechen soll
 * @param {number} holdS   wie lange sie dort bleibt
 * @param {number} recoverS  wie lange die Regelung danach Zeit bekommt
 */
function dip(depth, holdS, recoverS) {
  const f = boot();
  const { engine, session } = f;
  const s = engine.state;
  const c = engine.ctx;

  // Schichtuebernahme abwarten, damit der Zustand derselbe ist wie in der
  // Uebung.
  for (let i = 0; i < Math.round(11 / DT); i++) one(f);
  const n0 = s.n;
  const rod0 = s.rod[0];

  // Einbruch: Regler auf Hand, Staebe einfahren, bis die Leistung unten ist.
  c.powerCtl.auto = false;
  let guard = 0;
  while (s.n > depth && guard < Math.round(600 / DT) && session.phase === PHASE.RUNNING) {
    s.rodDmd[0] = s.rodDmd[1] = Math.min(1, s.rodDmd[0] + 0.0006);
    one(f); guard++;
  }
  const rodAtBottom = s.rod[0];
  const nAtBottom = s.n;
  const xAtBottom = s.X;

  for (let i = 0; i < Math.round(holdS / DT) && session.phase === PHASE.RUNNING; i++) one(f);

  // Erholung: NUR der Regelung die Fuehrung geben. Die Staebe selbst in einem
  // Zug herauszuziehen waere ein Reaktivitaetssprung von mehreren tausend pcm
  // -- damit schiesst die Leistung ueber 300 %, und gemessen waere dann die
  // Handbedienung, nicht die Erholbarkeit des Zustands.
  c.powerCtl.auto = true;
  c.powerCtl.setpoint = n0;
  let best = 0;
  for (let i = 0; i < Math.round(recoverS / DT) && session.phase === PHASE.RUNNING; i++) {
    one(f);
    best = Math.max(best, s.n);
  }

  return { n0, rod0, rodAtBottom, nAtBottom, xAtBottom, best,
    nEnd: s.n, xEnd: s.X, rodEnd: s.rod[0], orm: engine.derive().orm,
    rho: engine.derive().rho_pcm, phase: session.phase };
}

const pct = (x) => (x * 100).toFixed(2) + ' %';

console.log('Ausgangsleistung der Uebung: ~6,6 % (Zielband 5,5-9 %)\n');
for (const [depth, holdS, recoverS] of [
  [0.017, 17, 1200],   // moderat, wie der frueher dokumentierte Versuch
  [0.017, 60, 1200],
  [0.005, 30, 1200],   // "nahezu null", wie historisch beschrieben
  [0.0005, 30, 1800],
]) {
  const r = dip(depth, holdS, recoverS);
  console.log(`Einbruch auf ${pct(depth)}, ${holdS}s gehalten, ${recoverS}s Erholung:`);
  console.log(`  unten: n=${pct(r.nAtBottom)} rod=${r.rodAtBottom.toFixed(3)} X=${r.xAtBottom.toFixed(3)}`);
  console.log(`  danach: beste Leistung ${pct(r.best)}, am Ende ${pct(r.nEnd)}`
    + `  rod=${r.rodEnd.toFixed(3)}  X=${r.xEnd.toFixed(3)}  ORM=${r.orm.toFixed(1)}`
    + `  rho=${r.rho.toFixed(0)} pcm`);
  const ok = r.best >= 0.055 && r.best <= 0.09;
  console.log(`  -> Zielband 5,5-9 % ${ok ? 'ERREICHT' : 'VERFEHLT'}  (phase=${r.phase})\n`);
}
