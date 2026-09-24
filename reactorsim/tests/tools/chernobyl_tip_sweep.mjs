// Untersuchung, keine Zusicherung: wie haengt der Ausgang der Uebung an der
// Gesamtwirksamkeit der Graphitverdraenger (rbmk.js tip.worth_pcm_total)?
//
// Gebraucht fuer die Kalibrierung in 0.6.11. Bis dahin stand die Zahl bei
// 2 x 320 pcm, und die Reaktivitaet erreichte damit gerade eben beta -- die
// Zerstoerung haing an rund zehn pcm. Diese Messung zeigt, wo die Kante liegt
// und wie weit man von ihr weg ist.
//
// Gemessen wird ueber den ECHTEN prepare()-Pfad und zusaetzlich fuer
// verschiedene Druckzeitpunkte, weil bis 0.6.10 genau dieser Zeitpunkt ueber
// Zerstoerung oder Ueberleben entschied.
//
// Aufruf: node tests/tools/chernobyl_tip_sweep.mjs

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

/** @param {number|null} pressAt Sekunden nach Auslaufbeginn; null = Drehbuch. */
function run(pressAt) {
  const engine = createEngine(rbmk, { seed: DEF.seed });
  const session = new Session(engine, DEF);
  session.start();
  const s = engine.state;
  const tut = session.tutorial;
  const real = engine.scram.bind(engine);
  if (pressAt !== null) engine.scram = () => {};
  const one = () => {
    if (session.phase !== PHASE.RUNNING) return;
    engine.step(DT);
    session.step(DT, engine.trips.tiles(), 0);
  };
  for (let i = 0; i < Math.round(6 / DT); i++) one();
  tut.confirmInspect();
  for (let i = 0; i < Math.round(5 / DT); i++) one();
  tut.confirmInspect();

  let pressed = false;
  let peak = s.n;
  let rhoMax = -Infinity;
  let orm = null;
  let tDestroy = null;
  for (let i = 0; i < Math.round(4200 / DT) && session.phase === PHASE.RUNNING; i++) {
    one();
    if (tut._runbackT0 == null) continue;
    const since = s.t_sim - tut._runbackT0;
    if (orm == null) orm = engine.derive().orm;
    if (pressAt !== null && !pressed && since >= pressAt) { real('az5'); pressed = true; }
    peak = Math.max(peak, s.n);
    if (s.scram.active) rhoMax = Math.max(rhoMax, engine.derive().rho_pcm);
    if (tDestroy == null && s.destroyed) tDestroy = s.t_sim + engine.ctx.wallClock;
    if (since > 90) break;
  }
  return { peak, rhoMax, orm, destroyed: s.destroyed, tDestroy };
}

const hms = (x) => new Date(Math.round(x * 1000)).toISOString().slice(11, 23);
const keep = rbmk.spec.tip.worth_pcm_total;
const beta = rbmk.spec.beta.boc * 1e5;

console.log(`beta = ${beta} pcm, Abschaltreserve beim Test in Stabaequivalenten\n`);
console.log('tip_pcm   ORM   rho_max   Spitze  zerstoert  Zerstoerung');
for (const w of [640, 800, 900, 1000, 1050, 1100, 1150, 1200, 1400]) {
  rbmk.spec.tip.worth_pcm_total = w;
  const r = run(null);
  console.log(`${String(w).padStart(7)} ${(r.orm ?? NaN).toFixed(1).padStart(5)}`
    + ` ${r.rhoMax.toFixed(0).padStart(9)} ${(r.peak * 100).toFixed(0).padStart(7)} %`
    + ` ${(r.destroyed ? 'JA' : '-').padStart(9)}  ${r.tDestroy ? hms(r.tDestroy) : '-'}`);
}

console.log('\nAbhaengigkeit vom Druckzeitpunkt (Sekunden nach Auslaufbeginn):');
console.log('tip_pcm   t+0        t+5        t+15       t+36');
for (const w of [640, 900, 1000, 1050, 1150]) {
  rbmk.spec.tip.worth_pcm_total = w;
  const cells = [0, 5, 15, 36].map((p) => {
    const r = run(p);
    return `${(r.peak * 100).toFixed(0).padStart(5)}%${r.destroyed ? ' ZER' : '  - '}`;
  });
  console.log(String(w).padStart(7) + '  ' + cells.join(' '));
}
rbmk.spec.tip.worth_pcm_total = keep;
