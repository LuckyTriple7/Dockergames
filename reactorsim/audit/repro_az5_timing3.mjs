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
  return { engine, session };
}

for (const pressDelay of [10, 28]) {
  const { engine, session } = reachTestStep();
  const s = engine.state;
  const t0 = s.t_sim;
  while (s.t_sim - t0 < pressDelay && session.phase === PHASE.RUNNING) {
    engine.step(DT); stepEvents(engine, DT); session.step(DT, engine.trips.tiles(), 0);
  }
  console.log(`\n=== AZ-5 pressed at delay=${pressDelay}s ===`);
  if (session.phase === PHASE.RUNNING) engine.scram('az5');
  const tPress = s.t_sim;
  console.log('t_since_press  n[%]   P_th   rho_pcm  promptCrit  tip_pcm  destroyedKey');
  for (let i = 0, n = Math.round(15 / DT); i < n; i++) {
    engine.step(DT); stepEvents(engine, DT); session.step(DT, engine.trips.tiles(), 0);
    const tsp = s.t_sim - tPress;
    if (Math.abs(tsp * 20 - Math.round(tsp * 20)) < 1e-6 && Math.round(tsp*4)%1===0) {
      // print every 0.25s
    }
    if (i % 5 === 0) {
      const d = engine.derive();
      console.log(`${tsp.toFixed(2).padStart(6)}  ${(s.n*100).toFixed(2).padStart(7)} ${s.P_th.toFixed(0).padStart(6)} ${d.rho_pcm.toFixed(0).padStart(7)} ${String(s.promptCritical).padStart(6)} ${d.tip_pcm.toFixed(0).padStart(6)}  ${s.destroyedKey||''}`);
    }
    if (s.destroyed) { console.log('DESTROYED key=', s.destroyedKey, 'dt=', tsp.toFixed(2)); break; }
  }
  if (!s.destroyed) console.log('not destroyed within 15s window, n=', (s.n*100).toFixed(1));
}
