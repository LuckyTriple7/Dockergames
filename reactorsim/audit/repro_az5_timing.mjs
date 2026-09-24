import { createEngine } from '../static/js/sim/engine.js';
import * as rbmk from '../static/js/plants/rbmk.js';
import { Session, PHASE } from '../static/js/game/session.js';
import { RBMK_CHERNOBYL_TUTORIAL } from '../static/js/game/chernobylTutorial.js';
import { stepEvents } from '../static/js/game/events.js';

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

function step(f, n = 1) {
  for (let i = 0; i < n && f.session.phase === PHASE.RUNNING; i++) {
    f.engine.step(DT);
    f.session.step(DT, f.engine.trips.tiles(), 0);
  }
}

function reachTestStep() {
  const { engine, session } = boot();
  const s = engine.state;
  const c = engine.ctx;
  const tut = session.tutorial;

  step({ engine, session }, Math.round(6 / DT));
  tut.confirmInspect();
  step({ engine, session }, Math.round(5 / DT));
  step({ engine, session }, Math.round(1160 / DT));
  for (const p of c.mcp) if (!p.running) p.start();
  let guard = 0;
  while (tut.index === 3 && guard < Math.round(30 / DT)) { step({ engine, session }, 1); guard++; }
  // coastdown just triggered here (completeStep('pumps') fired inside step())
  return { engine, session };
}

// Log the trajectory from coastdown-trigger, no AZ-5 pressed.
{
  const { engine, session } = reachTestStep();
  const s = engine.state;
  const t0 = s.t_sim;
  console.log('--- trajectory after coastdown trigger, NO AZ-5 ---');
  console.log('t_since_coastdown  n[%]  P_th[MWth]  orm  voidCoeff  mcpDmd');
  for (let t = 0; t <= 40; t += 1) {
    while (s.t_sim - t0 < t && session.phase === PHASE.RUNNING) {
      engine.step(DT); stepEvents(engine, DT); session.step(DT, engine.trips.tiles(), 0);
    }
    const d = engine.derive();
    console.log(`${t.toFixed(0).padStart(3)}  ${(s.n*100).toFixed(2).padStart(6)}  ${s.P_th.toFixed(1).padStart(8)}  ${d.orm.toFixed(1).padStart(5)}  ${d.voidCoeff.toFixed(2).padStart(6)}  ${s.mcpDmd.toFixed(3)}`);
    if (s.destroyed) { console.log('DESTROYED at', (s.t_sim - t0).toFixed(2)); break; }
  }
}

// Now scan: at which delay does pressing AZ-5 first destroy the core?
console.log('\n--- scanning AZ-5 press delay -> destroyed? ---');
for (const delay of [1,2,3,4,5,6,7,8,9,10,12,14,16,18,20,22,24,26,28,30,32,35]) {
  const { engine, session } = reachTestStep();
  const s = engine.state;
  const t0 = s.t_sim;
  while (s.t_sim - t0 < delay && session.phase === PHASE.RUNNING) {
    engine.step(DT); stepEvents(engine, DT); session.step(DT, engine.trips.tiles(), 0);
  }
  const nAtPress = s.n;
  if (session.phase === PHASE.RUNNING) engine.scram('az5');
  for (let i = 0, n = Math.round(15 / DT); i < n && session.phase === PHASE.RUNNING; i++) {
    engine.step(DT); stepEvents(engine, DT); session.step(DT, engine.trips.tiles(), 0);
  }
  console.log(`delay=${String(delay).padStart(2)}s  n_at_press=${(nAtPress*100).toFixed(2)}%  destroyed=${s.destroyed}`);
}
