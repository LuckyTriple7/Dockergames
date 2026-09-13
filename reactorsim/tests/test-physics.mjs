import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../static/js/sim/engine.js';
import * as pwr from '../static/js/plants/pwr.js';
import * as bwr from '../static/js/plants/bwr.js';
import * as rbmk from '../static/js/plants/rbmk.js';
import { surfaceTension, tsat, hf, hfg } from '../static/js/sim/steam.js';
import { availableFlow, availableSteam, saturatedPressure, transferFraction } from '../static/js/sim/thermal.js';
import { equilibriumDecay, stepDecay } from '../static/js/sim/decayheat.js';
import { pack, apply } from '../static/js/net/persist.js';
import { captureKit } from '../static/js/game/replayKit.js';
import { Session, PHASE } from '../static/js/game/session.js';
import { readFile } from 'node:fs/promises';

test('IAPWS surface tension: boiling water, operating pressure, critical point', () => {
  assert.ok(Math.abs(surfaceTension(373.15) - 0.0589119) < 1e-6);
  assert.ok(Math.abs(surfaceTension(559.03) - 0.0176214) < 1e-6);
  assert.equal(surfaceTension(647.096), 0);
});

test('outflow cannot exceed current inventory plus incoming water', () => {
  assert.equal(availableFlow(10, 2, 100, 5), 4);
  assert.equal(availableFlow(0, 0, 100, 0.05), 0);
});

test('steam requires energy even when a vessel still contains water', () => {
  const params = { mass: 10000, feed: 0, requested: 100, dt: 1,
    pressure: 1, cp: 5, metalCapacity: 1000, heat: 0, feedEnthalpy: 0 };
  assert.equal(availableSteam(params), 0);
  const flow = availableSteam({ ...params, heat: hfg(1) * 2 });
  assert.equal(flow, 2);
});

test('saturated energy balance includes feed sensible heat and steam latent heat', () => {
  const p = 70, feed = 3, steam = 2, hin = 840;
  const heat = steam * hfg(p) + feed * (hf(p) - hin);
  const result = saturatedPressure({ pressure: p, mass: 10000, cp: 5,
    metalCapacity: 1000, heat, feed, feedEnthalpy: hin, steam, dt: 1 });
  assert.equal(result.pressure, p);
  assert.equal(result.rejectedKJ, 0);
});

for (const [plant, mass, level] of [[pwr, 'M_sg', 'L_sg'], [bwr, 'M_rpv', 'L_rpv'], [rbmk, 'M_drum', 'L_drum']]) {
  test(`${plant.spec.id}: empty inventory gives no steam, electricity or false swell level`, () => {
    const e = createEngine(plant), s = e.state;
    s[mass] = 0; s.W_fw = 0;
    plant.hooks.stepLoop(s, e.spec, e.ctx, 0.05);
    assert.equal(s[mass], 0);
    assert.equal(s.W_steam, 0);
    assert.equal(s.P_e, 0);
    assert.equal(s[level], 0);
    assert.equal(s.fault, null);
  });
  test(`${plant.spec.id}: finite inventory follows actual steam/feed mass balance`, () => {
    const e = createEngine(plant), s = e.state;
    s[mass] = 20; s.W_fw = 2;
    plant.hooks.stepLoop(s, e.spec, e.ctx, 0.05);
    assert.ok(Math.abs(s[mass] - (20 + (s.W_fw - s.W_steam) * 0.05)) < 1e-8);
    assert.ok(s[mass] >= 0);
  });
}

test('uncovered BWR coolant cannot heat itself above saturation without input energy', () => {
  const e = createEngine(bwr), s = e.state;
  s.M_rpv = 25000; s.P_th = 0;
  s.T_co = s.T_mod = s.T_ci = tsat(s.p_dome);
  const before = s.T_co;
  for (let i = 0; i < 1200; i++) bwr.hooks.coreCoolant(s, e.spec, e.ctx, 0, 0.05);
  assert.equal(s.T_co, before);
});

test('dryout and low critical heat-flux margin reduce heat transfer continuously', () => {
  assert.equal(transferFraction(2, 1), 1);
  assert.ok(transferFraction(0.5, 1) < 0.1);
  assert.ok(transferFraction(2, 0) < 0.01);
  assert.ok(Math.abs(transferFraction(0.999999, 1) - transferFraction(1, 1)) < 1e-5);
});

test('fire-water pump needs depressurization, and actual injection consumes finite supply', () => {
  const e = createEngine(bwr), s = e.state;
  s.acPower = false; s.fireInjOn = true;
  for (const pressure of [12, 70.7, 100]) {
    s.p_dome = pressure;
    assert.equal(bwr.fireInjectionFlow(s, e.spec), 0);
  }
  s.p_dome = 6;
  assert.ok(bwr.fireInjectionFlow(s, e.spec) > 0);
  s.fireWaterKg = 0.1;
  bwr.hooks.stepLoop(s, e.spec, e.ctx, 0.05);
  assert.equal(s.W_fw, 2);
  assert.equal(s.fireWaterKg, 0);
  assert.equal(bwr.fireInjectionFlow(s, e.spec), 0);
});

test('manual depressurization valve needs DC, mechanical overpressure protection does not', () => {
  const e = createEngine(bwr), s = e.state;
  s.depressurize = true; s.dcPower = false;
  bwr.hooks.stepLoop(s, e.spec, e.ctx, 0.05);
  assert.equal(s.srv, 0);
  s.dcPower = true;
  bwr.hooks.stepLoop(s, e.spec, e.ctx, 0.05);
  assert.equal(s.srv, 1);
  s.dcPower = false; s.p_dome = 85;
  bwr.hooks.stepLoop(s, e.spec, e.ctx, 0.05);
  assert.equal(s.srv, 1);
});

test('vent removes containment hydrogen; it does not itself trigger an explosion', () => {
  const e = createEngine(bwr), s = e.state;
  s.h2Mass = 45; s.contVentOpen = true;
  bwr.hooks.stepLoop(s, e.spec, e.ctx, 1);
  assert.ok(s.h2Mass < 45);
  assert.equal(s.h2BuildingMass, 0);
  assert.equal(s.h2Exploded, false);
  // Leakage into an air-filled building can be hazardous with the vent shut.
  s.contVentOpen = false; s.h2BuildingMass = 40;
  bwr.hooks.stepLoop(s, e.spec, e.ctx, 1);
  assert.equal(s.h2Exploded, true);
});

test('RBMK: AZ-5 command alone cannot change reactivity at fixed geometry', () => {
  const e = createEngine(rbmk), s = e.state;
  s.rod.fill(0.05); s.rodDmd.fill(0.05);
  const before = e.reactivity.compute(s, e.spec);
  const tip = e.derive().tip_pcm;
  e.scram('test');
  assert.equal(e.reactivity.compute(s, e.spec), before);
  assert.equal(e.derive().tip_pcm, tip);
  assert.ok(tip > 0);
});

test('graphite heat storage and coolant release balance its deposited energy', () => {
  const e = createEngine(rbmk), s = e.state;
  const c = e.spec.graphite.mass_t * e.spec.graphite.cp;
  const before = s.T_gr, dt = 0.05, input = 1000;
  const output = rbmk.hooks.directHeat(s, e.spec, e.ctx, input, dt);
  assert.ok(Math.abs((s.T_gr - before) * c + output * dt - input * dt) < 1e-7);
});

test('decay heat remains significant after a day and a week of shutdown', () => {
  const day = stepDecay(equilibriumDecay(1), 0, 86400);
  const week = stepDecay(equilibriumDecay(1), 0, 7 * 86400);
  assert.ok(day > 0.004 && day < 0.008);
  assert.ok(week > 0.002 && week < day);
});

test('legacy four-group save preserves total decay power when migrated', () => {
  const e = createEngine(pwr);
  const blob = pack(e);
  blob.state.D = [0, 0.001, 0.002, 0.003];
  assert.equal(apply(blob, e), null);
  assert.equal(e.state.D.length, equilibriumDecay(1).length);
  assert.ok(Math.abs(e.state.D.reduce((a, b) => a + b) - 0.006) < 1e-12);
});

test('BWR emergency controls survive a save and remain callable through replay kit', () => {
  const e = createEngine(bwr), actions = {};
  bwr.hooks.uiControls(e.state, e.spec, e.ctx, captureKit(actions));
  actions['btn:ctl_emergency_dc']('0');
  actions['btn:ctl_depressurize']('1');
  actions['btn:ctl_fire_inj']('1');
  e.state.fireWaterKg = 456789;
  e.state.h2BuildingMass = 12;
  const loaded = createEngine(bwr);
  assert.equal(apply(pack(e), loaded), null);
  for (const k of ['dcPower', 'depressurize', 'fireInjOn', 'fireWaterKg', 'h2BuildingMass']) {
    assert.equal(loaded.state[k], e.state[k], k);
  }
});

test('six-hour blackout scenario remains survivable with restored IC and managed venting', async () => {
  const def = JSON.parse(await readFile(new URL('../static/data/scenarios/bwr_fukushima.json', import.meta.url), 'utf8'));
  const e = createEngine(bwr, { seed: def.seed }), s = e.state, actions = {};
  bwr.hooks.uiControls(s, e.spec, e.ctx, captureKit(actions));
  const session = new Session(e, def);
  session.start();
  while (session.phase === PHASE.RUNNING) {
    // Portable batteries arrive one minute after the DC failure. The test
    // uses the actual UI actions and the original earthquake/blackout events.
    if (s.t_sim >= 3060 && !s.dcPower) actions['btn:ctl_emergency_dc']('1');
    if (s.pCont > 3) actions['btn:ctl_cont_vent']('1');
    e.step(0.05);
    e.trips.ack();
    session.step(0.05, e.trips.tiles(), e.trips.unacknowledgedSeconds());
  }
  assert.equal(s.fault, null);
  assert.equal(s.destroyed, false, s.destroyedKey);
  assert.equal(session.run.completed, true, session.run.failed);
  assert.ok(s.icWater > 0);
});

test('blackout without restored cooling has a physical failure consequence', async () => {
  const def = JSON.parse(await readFile(new URL('../static/data/scenarios/bwr_fukushima.json', import.meta.url), 'utf8'));
  const e = createEngine(bwr, { seed: def.seed });
  const session = new Session(e, def);
  session.start();
  while (session.phase === PHASE.RUNNING) {
    e.step(0.05);
    session.step(0.05, e.trips.tiles(), e.trips.unacknowledgedSeconds());
  }
  assert.equal(e.state.fault, null);
  assert.equal(e.state.destroyed, true);
  assert.equal(session.run.completed, false);
});
