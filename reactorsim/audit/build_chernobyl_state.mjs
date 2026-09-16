// Build & validate a new self-consistent prepare() state for
// RbmkChernobylTutorial after the rod-curve/ORM fix. Same macroscopic
// picture as the original (T_f, void, doppler, samarium, ao unchanged),
// only the rod position and xenon level are re-solved for criticality with
// the corrected curve. Then run it through the 'recover' hold (1140s) and
// the pumps+coastdown+AZ-5 steps to check it survives/behaves as intended.
import { createEngine } from '../static/js/sim/engine.js';
import * as rbmk from '../static/js/plants/rbmk.js';
import { Session, PHASE } from '../static/js/game/session.js';
import { RBMK_CHERNOBYL_TUTORIAL, RbmkChernobylTutorial } from '../static/js/game/chernobylTutorial.js';
import { stepEvents } from '../static/js/game/events.js';

const DT = 0.05;
const ROD = Number(process.argv[2] || 0.40);
const XVAL = Number(process.argv[3] || 1.0035);

const DEF = {
  id: 'rbmk_chernobyl', reactor: 'rbmk', tutorial: RBMK_CHERNOBYL_TUTORIAL,
  difficulty: 3, title_key: 'x', brief_key: 'x', duration_s: 7200, seed: 26041986,
  demand: [{ t: 0, mw: 0 }, { t: 7200, mw: 0 }], events: [], fail: [{ type: 'fuel_damage' }],
};

const engine = createEngine(rbmk, { seed: DEF.seed });
const session = new Session(engine, DEF);
session.start();
const s = engine.state, c = engine.ctx;

// Same as RbmkChernobylTutorial.prepare(), but rod/X overridden.
s.n = 0.06638556453081638;
s.c[0] = 0.8494278718822719; s.c[1] = 2.286348890593593;
s.c[2] = 0.5613875575936552; s.c[3] = 0.41703172612494116;
s.c[4] = 0.03212239311895662; s.c[5] = 0.00444378096738251;
s.D[0] = 0.0015897458084510614; s.D[1] = 0.0012601264003539218;
s.D[2] = 0.0007968142393641646; s.D[3] = 0.001524650577173896;
s.D[4] = 0.0031171451536580507; s.D[5] = 0.0024607092868473377;
s.D[6] = 0.0014993178908948082;
s.rod[0] = s.rod[1] = ROD;
s.rodDmd[0] = s.rodDmd[1] = ROD;
s.T_f = 585.7547959561184;
s.T_cl = 558.7573570680994;
s.T_ci = 556.7348461520972;
s.T_co = 558.0251027025131;
s.T_mod = 558.0251027025131;
s.T_gr = 590.2992690043193;
s.alphaBar = 0.05437736108274518;
s.I = 0.5931298469040777;
s.X = XVAL;
s.Pm = 0.9227506372313031;
s.Sm = 1.0253115326317221;
s.zTop = { I: 0.5701612430885139, X: 1.3819164026422766 * (XVAL/1.366547661120293), Pm: 0.9177148539236004, Sm: 1.026975160511478 };
s.zBot = { I: 0.6160984507196482, X: 1.353411736633394 * (XVAL/1.366547661120293), Pm: 0.927786420539006, Sm: 1.0236510174987252 };
s.ao = 0.051032455524760566;
s.C_B = 0;
s.P_th = 236.7584178907257;
s.P_e = 77.0953354021486;
s.P_demand = 0;
s.p_drum = s.p_prim = 68.99911481375386;
s.L_drum = 0.5000089737503258;
s.M_drum = 159999.76885224957;
s.x_e = 0.011104025370192403;
s.dTsub = 1.288828965210931;
s.W_steam = 116.54178618353212;
s.W_fw = s.W_fwDemand = s.W_fwMain = 116.5;
s.gov = 0.053213531642249595;
s.mcpDmd = 1;
for (let i = 0; i < 2; i++) c.mcp[i].trip();
c.voidLag.set(s.alphaBar);
c.aoLag.set(s.ao);
c.dpLag.set(0);
c.pPrev = s.p_drum;
c.powerCtl.auto = true;
c.powerCtl.setpoint = s.n;

const d0 = engine.derive();
console.log(`ROD=${ROD} X=${XVAL} -> rho0=${d0.rho_pcm.toFixed(2)} orm0=${d0.orm.toFixed(2)}`);

function step(n = 1) {
  for (let i = 0; i < n && session.phase === PHASE.RUNNING; i++) {
    engine.step(DT); stepEvents(engine, DT); session.step(DT, engine.trips.tiles(), 0);
  }
}

// 'recover' hold: 1140s at setpoint.
step(Math.round(1140 / DT));
console.log(`after 1140s hold: n=${(s.n*100).toFixed(2)}% orm=${engine.derive().orm.toFixed(2)} destroyed=${s.destroyed} key=${s.destroyedKey||''}`);
if (s.destroyed) process.exit(0);

// pumps: start remaining 2, then coastdown triggers automatically via tutorial.
const tut = session.tutorial;
for (const p of c.mcp) if (!p.running) p.start();
let guard = 0;
while (tut.index === 3 && guard < Math.round(30/DT) && session.phase === PHASE.RUNNING) { step(1); guard++; }
console.log(`after pumps: index=${tut.index} destroyed=${s.destroyed}`);
if (s.destroyed || session.phase !== PHASE.RUNNING) process.exit(0);

// Let the coastdown run, scan AZ-5 press delay like before.
const t0 = s.t_sim;
console.log('--- no AZ-5 trajectory ---');
for (let t = 0; t <= 40; t += 2) {
  while (s.t_sim - t0 < t && session.phase === PHASE.RUNNING) { engine.step(DT); stepEvents(engine, DT); session.step(DT, engine.trips.tiles(), 0); }
  const d = engine.derive();
  console.log(`t=${t}s n=${(s.n*100).toFixed(1)}% orm=${d.orm.toFixed(1)} rho=${d.rho_pcm.toFixed(0)} destroyed=${s.destroyed}`);
  if (s.destroyed) break;
}
