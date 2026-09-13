// Diagnostic measurements, not acceptance tests or a plant validation.
// node reactorsim/audit/physics-probes.mjs
import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { equilibriumDecay, stepDecay } from '../static/js/sim/decayheat.js';
import { tsat, psat } from '../static/js/sim/steam.js';
const DT = 0.05;
const results = {};

results.nominal = ['pwr', 'bwr', 'rbmk'].map((id) => {
  const e = createEngine(getPlant(id));
  for (let i = 0; i < 12000; i++) e.step(DT);
  return { id, thermalMW: e.state.P_th, electricMW: e.state.P_e,
    pressureBar: e.state.p_prim, inletC: e.state.T_ci - 273.15,
    outletC: e.state.T_co - 273.15, destroyed: e.state.destroyed };
});

results.noFeedwater = ['pwr', 'rbmk'].map((id) => {
  const e = createEngine(getPlant(id));
  e.ctx.fwCtl.auto = false;
  e.ctx.fwCtl.manual = 0;
  for (let i = 0; i < 72000 && !e.state.destroyed && !e.state.fault; i++) e.step(DT);
  const s = e.state;
  return { id, timeS: s.t_sim, massKg: s.M_sg ?? s.M_drum,
    level: s.L_sg ?? s.L_drum, feedKgS: s.W_fw, steamKgS: s.W_steam,
    thermalMW: s.P_th, electricMW: s.P_e, cladC: s.T_cl - 273.15,
    destroyed: s.destroyed, fault: s.fault };
});

// Isolate the coolant hook: zero transferred heat, fixed pressure and low inventory.
// There is deliberately no full-engine evolution in this diagnostic.
{
  const e = createEngine(getPlant('bwr'));
  const s = e.state;
  s.M_rpv = e.spec.vessel.mUncoverFloor;
  const initialC = s.T_co - 273.15;
  for (let i = 0; i < 3600; i++) e.hooks.coreCoolant(s, e.spec, e.ctx, 0, DT);
  results.zeroHeatCoolantHook = { timeS: 180, heatInputKW: 0, initialC, finalC: s.T_co - 273.15 };
}

results.fireInjection = [70.7, 100].map((pressureBar) => {
  const e = createEngine(getPlant('bwr'));
  e.state.p_dome = pressureBar;
  e.state.acPower = false;
  e.state.fireInjOn = true;
  e.hooks.stepControls(e.state, e.spec, e.ctx, 0.2);
  return { pressureBar, feedKgS: e.state.W_fw };
});

{
  const e = createEngine(getPlant('rbmk'));
  e.state.rod.fill(0.1);
  e.state.rodDmd.fill(0.1);
  e.reactivity.compute(e.state, e.spec);
  const manualPcm = e.reactivity.breakdown.tip * 1e5;
  e.scram('audit');
  e.reactivity.compute(e.state, e.spec);
  results.rbmkSameGeometry = { insertion: 0.1, manualPcm,
    immediatelyAfterAz5Pcm: e.reactivity.breakdown.tip * 1e5 };
}

results.decay = [1, 60, 3600, 86400, 172800, 604800].map((timeS) => ({
  timeS, percentNominal: 100 * stepDecay(equilibriumDecay(1), 0, timeS),
}));

results.coldPresets = ['pwr', 'bwr', 'rbmk'].map((id) => {
  const e = createEngine(getPlant(id), { n: 1e-6, cold: true });
  return { id, inletC: e.state.T_ci - 273.15, pressureBar: e.state.p_prim };
});

results.surfaceTension = [100, 285.88].map((celsius) => {
  const T = celsius + 273.15;
  const tau = 1 - T / 647.096;
  return { celsius,
    modelMilliNm: 1000 * Math.max(0.0588 * (1 - T / 647.1) ** 1.2, 1e-4),
    iapwsMilliNm: 235.8 * tau ** 1.256 * (1 - 0.625 * tau) };
});
results.condenser = { modelTsatAt0035BarC: tsat(0.035) - 273.15,
  modelPsatAt25CBar: psat(298.15) };
console.log(JSON.stringify(results, null, 2));
