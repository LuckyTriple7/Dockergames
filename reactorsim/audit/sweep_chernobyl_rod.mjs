import { createEngine } from '../static/js/sim/engine.js';
import * as rbmk from '../static/js/plants/rbmk.js';
import { Session, PHASE } from '../static/js/game/session.js';
import { RBMK_CHERNOBYL_TUTORIAL } from '../static/js/game/chernobylTutorial.js';

const DT = 0.05;
const DEF = {
  id: 'rbmk_chernobyl', reactor: 'rbmk', tutorial: RBMK_CHERNOBYL_TUTORIAL,
  difficulty: 3, title_key: 'x', brief_key: 'x', duration_s: 7200, seed: 26041986,
  demand: [{ t: 0, mw: 0 }, { t: 7200, mw: 0 }], events: [], fail: [{ type: 'fuel_damage' }],
};

function testRod(rodVal, xVal) {
  const engine = createEngine(rbmk, { seed: DEF.seed });
  const session = new Session(engine, DEF);
  session.start();
  const s = engine.state, c = engine.ctx;
  s.rod[0] = s.rod[1] = rodVal;
  s.rodDmd[0] = s.rodDmd[1] = rodVal;
  s.X = xVal;
  const scale = xVal / 1.366547661120293;
  s.zTop.X = 1.3819164026422766 * scale;
  s.zBot.X = 1.353411736633394 * scale;
  c.powerCtl.setpoint = s.n;

  function step(n = 1) { for (let i = 0; i < n && session.phase === PHASE.RUNNING; i++) { engine.step(DT); session.step(DT, engine.trips.tiles(), 0); } }
  step(Math.round(6 / DT));
  session.tutorial.confirmInspect();
  step(Math.round(5 / DT));
  let minN = 1, maxN = 0;
  for (let i = 0, N = Math.round(1140 / DT); i < N && session.phase === PHASE.RUNNING; i++) {
    engine.step(DT); session.step(DT, engine.trips.tiles(), 0);
    minN = Math.min(minN, s.n); maxN = Math.max(maxN, s.n);
  }
  const survived = session.tutorial.index === 3;
  return { survived, minN, maxN, held: session.tutorial.held, destroyed: s.destroyed };
}

for (const [rodVal, xVal] of [
  [0.05, 1.2444236206521953], [0.08, 1.2928939193622921], [0.10, 1.2919076431791403],
  [0.12, 1.2639337905867376], [0.14, 1.212400061654875], [0.16, 1.1436210019282844],
  [0.1786, 1.0716589431973094],
]) {
  const r = testRod(rodVal, xVal);
  console.log(`rod=${rodVal} survived=${r.survived} minN=${(r.minN*100).toFixed(3)}% maxN=${(r.maxN*100).toFixed(3)}% held=${r.held.toFixed(1)} destroyed=${r.destroyed}`);
}
