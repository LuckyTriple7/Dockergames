import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { pack, apply } from '../static/js/net/persist.js';
import { Session } from '../static/js/game/session.js';
import { Scenario, RunState } from '../static/js/game/scenario.js';

const json = (value) => JSON.parse(JSON.stringify(value));
for (const id of ['pwr', 'bwr', 'rbmk']) {
  test(`${id}: saved transient continues identically, including controller phase and RNG`, () => {
    const live = createEngine(getPlant(id));
    live.scram('test');
    for (let i = 0; i < 1203; i++) live.step(0.05);
    const restored = createEngine(getPlant(id));
    assert.equal(apply(json(pack(live)), restored), null);
    for (let i = 0; i < 400; i++) {
      live.step(0.05);
      restored.step(0.05);
      assert.deepEqual(restored.state, live.state, `step ${i}`);
    }
  });
}

test('RBMK zonal poisons and AZ-5 history survive JSON save/load', () => {
  const a = createEngine(getPlant('rbmk'));
  a.state.zTop.X = 1.4;
  a.state.zBot.I = 0.7;
  a.state.rod.fill(0.05);
  a.scram('test');
  const b = createEngine(getPlant('rbmk'));
  apply(json(pack(a)), b);
  assert.deepEqual(b.state, a.state);
  a.step(0.05); b.step(0.05);
  assert.deepEqual(b.state, a.state);
});

test('legacy DWR snapshot reconstructs pressure surge and decay history', () => {
  const a = createEngine(getPlant('pwr'));
  a.scram('test');
  for (let i = 0; i < 1200; i++) a.step(0.05);
  const blob = json(pack(a));
  delete blob.context; delete blob.rng;
  const b = createEngine(getPlant('pwr'));
  apply(blob, b);
  a.step(0.05); b.step(0.05);
  // Old saves cannot recover the exact historical sample; <0.01 percentage
  // points is acceptable, a collapse to zero is not.
  assert.ok(Math.abs(a.state.pzr_L - b.state.pzr_L) < 0.0001);
  assert.equal(a.state.P_th, b.state.P_th);
});

test('free demand retains target, change time and random sequence', () => {
  const a = createEngine(getPlant('bwr'));
  const sa = new Session(a, null); sa.start();
  sa.demandNextChangeT = 0;
  sa.step(0.05, [], 0);
  const b = createEngine(getPlant('bwr'));
  const sb = new Session(b, null); sb.start();
  apply(json(pack(a, null, null, sa)), b, null, sb);
  assert.deepEqual(sb.snapshot(), sa.snapshot());
  sa.demandNextChangeT = sb.demandNextChangeT = 0;
  sa.step(0.05, [], 0); sb.step(0.05, [], 0);
  assert.equal(a.state.P_demand, b.state.P_demand);
  assert.deepEqual(sb.snapshot(), sa.snapshot());
});

test('debrief retains ranked causes as well as violation totals', () => {
  const scenario = new Scenario({ id: 'test', reactor: 'pwr' });
  const a = new RunState(scenario, getPlant('pwr').spec);
  a.causeSeconds.set('pressure', 600);
  a.causeSeconds.set('flow', 40);
  a.violationSeconds[3] = 600;
  const b = new RunState(scenario, getPlant('pwr').spec);
  b.restore(json(a.snapshot()));
  assert.deepEqual(b.topCauses(), a.topCauses());
  assert.deepEqual(b.violationSeconds, a.violationSeconds);
});
