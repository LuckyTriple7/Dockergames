// Re-derive the RbmkChernobylTutorial.prepare() fixed state after the
// rod-worth/ORM recalibration (rbmk.js: _rodReactivity/_orm, rodBanks worth).
// Reproduces the historical pre-history: 100% -> 50% -> 9h hold -> 7% -> 60min
// hold, exactly as described in chernobylTutorial.js's own comments.
import { createEngine } from '../static/js/sim/engine.js';
import * as rbmk from '../static/js/plants/rbmk.js';

const DT = 0.05;
const e = createEngine(rbmk, { n: 1.0 });
const s = e.state;
const c = e.ctx;

// Historical normal for the reduced-power stretch: six of eight MCPs running.
for (let i = 0; i < 2; i++) c.mcp[i].trip();

function run(sec) { for (let i = 0, n = Math.round(sec / DT); i < n; i++) e.step(DT); }
function ramp(from, to, sec) {
  const n = Math.round(sec / DT);
  for (let i = 0; i < n; i++) {
    c.powerCtl.setpoint = from + (to - from) * (i / n);
    e.step(DT);
  }
  c.powerCtl.setpoint = to;
}

run(600);                 // settle at 100%
ramp(s.n, 0.5, 20 * 60);  // down to 50% over 20 min
run(9 * 3600);            // hold 9h
ramp(s.n, 0.07, 20 * 60); // down to 7% over 20 min
run(60 * 60);             // hold 60 min

const d = e.derive();
console.log('n=', s.n, 'orm=', d.orm, 'rho_pcm=', d.rho_pcm, 'P_th=', s.P_th);
console.log(JSON.stringify({
  n: s.n, c: Array.from(s.c), D: Array.from(s.D),
  rod: Array.from(s.rod), rodDmd: Array.from(s.rodDmd),
  T_f: s.T_f, T_cl: s.T_cl, T_ci: s.T_ci, T_co: s.T_co, T_mod: s.T_mod, T_gr: s.T_gr,
  alphaBar: s.alphaBar, I: s.I, X: s.X, Pm: s.Pm, Sm: s.Sm,
  zTop: s.zTop, zBot: s.zBot, ao: s.ao, C_B: s.C_B,
  P_th: s.P_th, P_e: s.P_e, P_demand: s.P_demand,
  p_drum: s.p_drum, p_prim: s.p_prim, L_drum: s.L_drum, M_drum: s.M_drum,
  x_e: s.x_e, dTsub: s.dTsub, W_steam: s.W_steam,
  W_fw: s.W_fw, W_fwDemand: s.W_fwDemand, W_fwMain: s.W_fwMain,
  gov: s.gov, mcpDmd: s.mcpDmd,
  voidLagV: c.voidLag.v, aoLagV: c.aoLag.v, dpLagV: c.dpLag.v, pPrev: c.pPrev,
}, null, 2));
