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

// Override the runback target AFTER completeStep('pumps') has fired (to: 0 from the tutorial),
// by patching ctx.mcpRunback.to just after it's set, to test alternate floors without editing source.
const FLOOR = Number(process.argv[2] || 0.5);

{
  const { engine, session } = reachTestStep();
  const s = engine.state;
  const c = engine.ctx;
  if (c.mcpRunback) c.mcpRunback.to = FLOOR;
  const t0 = s.t_sim;
  console.log(`--- floor=${FLOOR}, NO AZ-5 ---`);
  console.log('t   n[%]    P_th   rho_pcm  promptCrit  mcpDmd  destroyedKey');
  let lastT = -1;
  for (let i = 0, n = Math.round(60 / DT); i < n && session.phase === PHASE.RUNNING; i++) {
    engine.step(DT); stepEvents(engine, DT); session.step(DT, engine.trips.tiles(), 0);
    const t = s.t_sim - t0;
    if (Math.floor(t) !== lastT) {
      lastT = Math.floor(t);
      const d = engine.derive();
      console.log(`${t.toFixed(0).padStart(3)} ${(s.n*100).toFixed(2).padStart(7)} ${s.P_th.toFixed(0).padStart(6)} ${d.rho_pcm.toFixed(0).padStart(7)} ${String(s.promptCritical).padStart(6)} ${s.mcpDmd.toFixed(3)}  ${s.destroyedKey||''}`);
    }
    if (s.destroyed) { console.log('DESTROYED at', t.toFixed(2)); break; }
  }
  if (!s.destroyed) console.log('survived 60s without AZ-5. final n=', (s.n*100).toFixed(1), '%');
}

// Now: press AZ-5 at t=36s (historical) with this floor, check for prompt-critical destruction.
{
  const { engine, session } = reachTestStep();
  const s = engine.state;
  const c = engine.ctx;
  if (c.mcpRunback) c.mcpRunback.to = FLOOR;
  const t0 = s.t_sim;
  while (s.t_sim - t0 < 36 && session.phase === PHASE.RUNNING) {
    engine.step(DT); stepEvents(engine, DT); session.step(DT, engine.trips.tiles(), 0);
  }
  console.log(`\n--- floor=${FLOOR}, AZ-5 at t=36s ---`);
  console.log('n at press:', (s.n*100).toFixed(2), '%');
  if (session.phase === PHASE.RUNNING) engine.scram('az5');
  const tPress = s.t_sim;
  let maxRho = -1e9, maxRhoT = 0, pcTrue = false, pcT = null;
  for (let i = 0, n = Math.round(15 / DT); i < n; i++) {
    engine.step(DT); stepEvents(engine, DT); session.step(DT, engine.trips.tiles(), 0);
    const d = engine.derive();
    if (d.rho_pcm > maxRho) { maxRho = d.rho_pcm; maxRhoT = s.t_sim - tPress; }
    if (s.promptCritical && !pcTrue) { pcTrue = true; pcT = s.t_sim - tPress; }
    if (s.destroyed) { console.log('DESTROYED key=', s.destroyedKey, 'dt=', (s.t_sim - tPress).toFixed(2)); break; }
  }
  console.log('max rho_pcm=', maxRho.toFixed(0), 'at dt=', maxRhoT.toFixed(2), '| promptCritical reached:', pcTrue, pcT);
  if (!s.destroyed) console.log('NOT destroyed within 15s of AZ-5. final n=', (s.n*100).toFixed(1));
}
