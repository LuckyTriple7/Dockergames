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

{
  const { engine, session } = reachTestStep();
  const s = engine.state;
  const t0 = s.t_sim;
  console.log('--- trajectory after coastdown trigger, NO AZ-5 ---');
  console.log('t   n[%]    P_th   T_f[K]  T_cl[K]  rho_pcm  promptCrit  voidFrac  destroyedKey');
  for (let t = 0; t <= 30; t += 0.5) {
    while (s.t_sim - t0 < t && session.phase === PHASE.RUNNING) {
      engine.step(DT); stepEvents(engine, DT); session.step(DT, engine.trips.tiles(), 0);
    }
    const d = engine.derive();
    console.log(`${t.toFixed(1).padStart(4)} ${(s.n*100).toFixed(2).padStart(7)} ${s.P_th.toFixed(0).padStart(6)} ${s.T_f.toFixed(0).padStart(6)} ${s.T_cl.toFixed(0).padStart(6)} ${d.rho_pcm.toFixed(0).padStart(7)} ${String(s.promptCritical).padStart(6)} ${d.voidFrac.toFixed(3)}  ${s.destroyedKey||''}`);
    if (s.destroyed) { console.log('DESTROYED, key=', s.destroyedKey, 'at t=', (s.t_sim - t0).toFixed(2)); break; }
  }
}
