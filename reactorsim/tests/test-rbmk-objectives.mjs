import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import rbmk from '../static/js/plants/rbmk.js';
import { Scenario } from '../static/js/game/scenario.js';
import { ScenarioObjectives } from '../static/js/game/objectives.js';

const def = JSON.parse(await readFile(new URL('../static/data/scenarios/rbmk_post_az5.json', import.meta.url), 'utf8'));
const DT = 0.05;
const json = v => JSON.parse(JSON.stringify(v));
function fixture() {
  const scenario = new Scenario(structuredClone(def));
  const state = { reactor: 'rbmk', t_sim: 0, W_fw: 100, W_fwMain: 15, W_fwAux: 85,
    W_steam: 100, fwSupplyMax: 15, M_drum: 160000, L_drum: 0.5, p_drum: 69,
    W_core: 5565, T_cl: 570, T_gr: 800, T_ci: 550, T_co: 560, P_th: 100,
    n: 0.001, coolantHeatMW: 200, auxWaterKg: 100000, auxFeedInstalled: true,
    auxFeedAvailable: true, auxFeedOn: true, scram: { active: true },
    rod: new Float64Array([1, 1]), destroyed: false, fault: null };
  const markers = [];
  const engine = { state, spec: rbmk.spec, ctx: { trends: { mark: m => markers.push(m) } },
    derive: () => ({ L_sg: 0.5, dnbr: NaN, subcooling: NaN }) };
  return { engine, scenario, markers, objectives: new ScenarioObjectives(engine, scenario) };
}
function tick(f, dt = DT) {
  f.engine.state.t_sim = Math.round((f.engine.state.t_sim + dt) * 1e8) / 1e8;
  f.scenario.due(f.engine.state.t_sim);
  f.objectives.step(dt);
}
function hold(f, seconds) { for (let n = 0; n < Math.round(seconds / DT); n++) tick(f); }
function activate(f) {
  f.engine.state.t_sim = 240;
  f.scenario.due(240);
  f.objectives.step(DT);
}

test('RBMK goals activate only after all three faults and a subsequent physics tick', () => {
  const f = fixture();
  hold(f, 239.95);
  assert.ok(f.objectives.view().every(g => !g.active && g.held === 0));
  tick(f);
  f.objectives.step(DT);
  assert.ok(f.objectives.view().every(g => !g.active && g.held === 0));
  tick(f);
  assert.ok(f.objectives.view().every(g => g.active && g.held === DT));
  for (const missing of def.events.map(e => e.id)) {
    const g = fixture();
    g.engine.state.t_sim = 300;
    for (const ev of g.scenario.events) ev.fired = ev.id !== missing;
    g.objectives.step(DT);
    assert.ok(g.objectives.view().every(x => !x.active));
  }
});

test('30s and 120s holds cap, revoke, and preserve historical first achievements and markers', () => {
  const f = fixture();
  activate(f);
  hold(f, 29.95);
  assert.equal(f.objectives.view()[0].met, false);
  tick(f);
  assert.equal(f.objectives.view()[0].met, true);
  hold(f, 89.95);
  assert.equal(f.objectives.done, false);
  tick(f);
  assert.equal(f.objectives.done, true);
  const first = f.objectives.view();
  hold(f, 100);
  assert.deepEqual(f.objectives.view(), first);
  f.engine.state.W_fw = 0;
  tick(f);
  assert.equal(f.objectives.done, false);
  assert.ok(f.objectives.view().every(g => g.held === 0 && g.achievedAt !== null));
  const lost = json(f.objectives.snapshot());
  f.objectives.restore(lost);
  assert.deepEqual(f.objectives.snapshot(), lost);
  f.engine.state.W_fw = 100;
  hold(f, 120);
  assert.deepEqual(f.objectives.view(), first);
  for (const type of ['rbmk_inventory', 'rbmk_heat_removal']) {
    for (const kind of ['goal_start', 'goal_met', 'goal_lost']) {
      assert.ok(f.markers.some(m => m.kind === kind && m.key === `obj_${type}_title`));
    }
  }
});

test('RBMK actual safety, inventory and flow fields reject nonfinite values, types and ranges', () => {
  const fields = ['W_fw', 'W_fwMain', 'W_fwAux', 'W_steam', 'fwSupplyMax', 'M_drum',
    'L_drum', 'p_drum', 'W_core', 'T_cl', 'T_gr', 'T_ci', 'T_co', 'P_th', 'n',
    'coolantHeatMW', 'auxWaterKg'];
  for (const field of fields) for (const value of [NaN, Infinity, -Infinity, null, undefined, '100', true]) {
    const f = fixture();
    activate(f);
    f.engine.state[field] = value;
    tick(f);
    assert.ok(f.objectives.view().every(g => g.held === 0), `${field}=${value}`);
  }
  const patches = [{ W_fw: 1 }, { W_steam: 1 }, { W_fwMain: -1 }, { W_fwAux: -1 },
    { W_fwMain: 16, W_fw: 101 }, { W_fwAux: 221, W_fw: 236 },
    { fwSupplyMax: -1 }, { fwSupplyMax: 2000 },
    { M_drum: 143999 }, { M_drum: 176001 }, { L_drum: 0.3499 }, { L_drum: 0.7001 },
    { p_drum: 54.99 }, { p_drum: 75.01 }, { W_core: 4999 }, { T_cl: 700 },
    { T_gr: 900.01 }, { T_ci: 0 }, { T_co: 700 }, { P_th: -1 }, { P_th: 321 },
    { n: -1 }, { n: 0.0101 }, { coolantHeatMW: 0 }, { coolantHeatMW: -1 },
    { auxWaterKg: -1 }, { auxWaterKg: 160001 }, { auxFeedInstalled: false },
    { auxFeedAvailable: false }, { scram: { active: false } }, { scram: { active: 1 } },
    { rod: null }, { rod: [1, 1] }, { rod: new Float64Array([1]) },
    { rod: new Float64Array([1, NaN]) }, { rod: new Float64Array([1, 0.989]) },
    { rod: new Float64Array([1, 1.01]) }, { destroyed: true }, { fault: 'bad' }, { reactor: 'pwr' }];
  for (const patch of patches) {
    const f = fixture();
    activate(f);
    Object.assign(f.engine.state, patch);
    tick(f);
    assert.ok(f.objectives.view().every(g => g.held === 0), JSON.stringify(patch));
  }
  const f = fixture();
  activate(f);
  f.engine.spec = { ...rbmk.spec, id: 'pwr' };
  tick(f);
  assert.equal(f.objectives.done, false);
  assert.ok(f.objectives.view().every(g => g.held === 0));
});

test('displayed filling, AZ-5, automatic mode and spurious cooling cannot replace real supply', () => {
  const f = fixture();
  activate(f);
  f.engine.ctx.fwCtl = { auto: true };
  f.engine.state.L_sg = 0.5;
  f.engine.state.M_drum = 100000;
  hold(f, 120);
  assert.equal(f.objectives.done, false);
  f.engine.state.M_drum = 160000;
  f.engine.state.L_drum = 0.1;
  hold(f, 120);
  assert.equal(f.objectives.done, false);
  f.engine.state.L_drum = 0.5;
  f.engine.state.W_fw = f.engine.state.W_fwMain = f.engine.state.W_fwAux = 0;
  hold(f, 120);
  assert.equal(f.objectives.done, false);
  Object.assign(f.engine.state, { W_fw: 100, W_fwMain: 15, W_fwAux: 85, auxFeedOn: false });
  f.engine.ctx.fwCtl.auto = false;
  hold(f, 120);
  assert.equal(f.objectives.done, true, 'last measured flow, not a button or controller flag');
});

test('heat removal requires water balance and five minutes of current auxiliary draw or 10t', () => {
  const f = fixture();
  activate(f);
  hold(f, 120);
  f.engine.state.auxWaterKg = 85 * 300 - 0.01;
  tick(f);
  assert.equal(f.objectives.view()[0].met, true);
  assert.equal(f.objectives.view()[1].held, 0);
  f.engine.state.auxWaterKg = 85 * 300;
  hold(f, 120);
  assert.equal(f.objectives.done, true);
  Object.assign(f.engine.state, { W_fw: 35, W_fwMain: 15, W_fwAux: 20, W_steam: 35, auxWaterKg: 9999 });
  tick(f);
  assert.equal(f.objectives.view()[1].held, 0);
  f.engine.state.auxWaterKg = 10000;
  hold(f, 120);
  assert.equal(f.objectives.done, true);
  Object.assign(f.engine.state, { W_fw: 40, W_fwAux: 25 });
  tick(f);
  assert.equal(f.objectives.done, true, '5 kg/s low-flow tolerance is inclusive');
  Object.assign(f.engine.state, { W_fw: 40.01, W_fwAux: 25.01 });
  tick(f);
  assert.equal(f.objectives.view()[1].held, 0);
  assert.equal(f.objectives.view()[0].met, true);
});

test('RBMK level span and coolant/graphite warming reset only the stability window', () => {
  for (const field of ['L_drum', 'T_ci', 'T_gr']) {
    const f = fixture();
    activate(f);
    hold(f, 120);
    const amount = field === 'L_drum' ? 0.02 : field === 'T_ci' ? 2 : 1;
    f.engine.state[field] += amount;
    tick(f);
    assert.equal(f.objectives.done, true, field);
    f.engine.state[field] += 0.001;
    tick(f);
    assert.equal(f.objectives.view()[0].met, true);
    assert.equal(f.objectives.view()[1].held, 0);
    hold(f, 120);
    assert.equal(f.objectives.done, true);
  }
});

test('optional power fraction is finite and bounded; unrelated PWR display fields are ignored', () => {
  for (const value of [NaN, Infinity, null, '0.1', -1, 0.1001]) {
    const f = fixture();
    activate(f);
    f.scenario.def.objectives[1].max_power_fraction = value;
    tick(f);
    assert.equal(f.objectives.view()[1].held, 0);
  }
  const f = fixture();
  delete f.scenario.def.objectives[1].max_power_fraction;
  activate(f);
  Object.assign(f.engine.state, { L_sg: NaN, M_sg: NaN, pzr_p: NaN, pzr_L: NaN });
  Object.defineProperty(f.engine.state, 'L_sg', { get() { assert.fail('RBMK must read L_drum, not L_sg'); } });
  hold(f, 120);
  assert.equal(f.objectives.done, true);
});

test('RBMK snapshots preserve partial holds, additive graphite baseline and exact continuation', () => {
  const live = fixture();
  activate(live);
  hold(live, 60);
  live.engine.state.L_drum = 0.51;
  live.engine.state.T_gr = 799;
  tick(live);
  const snapshot = json(live.objectives.snapshot());
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.state[1].graphiteBaseline, 800);
  assert.equal('graphiteBaseline' in snapshot.state[0], false);
  const resumed = fixture();
  Object.assign(resumed.engine.state, structuredClone(live.engine.state));
  resumed.objectives.restore(snapshot);
  resumed.scenario.catchUp(resumed.engine.state.t_sim);
  assert.deepEqual(resumed.objectives.snapshot(), snapshot);
  resumed.objectives.step(DT);
  assert.deepEqual(resumed.objectives.snapshot(), snapshot);
  snapshot.state[1].graphiteBaseline = 0;
  assert.equal(resumed.objectives.snapshot().state[1].graphiteBaseline, 800);
  for (let i = 0; i < 3000; i++) {
    tick(live); tick(resumed);
    assert.deepEqual(resumed.objectives.snapshot(), live.objectives.snapshot());
  }
});

test('malformed RBMK snapshot blocks reject atomically, including type-specific window bounds', () => {
  const f = fixture();
  activate(f);
  hold(f, 200);
  const valid = json(f.objectives.snapshot());
  const corruptions = [
    d => { d.version = 2; }, d => { d.scenario = 'pwr_feedwater_loss'; },
    d => { d.state.pop(); }, d => { delete d.state[1]; },
    ...Object.entries({ id: 'supply', held: 121, activatedAt: 239, startedAt: 441,
      achievedAt: 359, levelMin: 0.34, levelMax: 0.71, tempBaseline: 553,
      graphiteBaseline: 798 }).map(([k, v]) => d => { d.state[1][k] = v; }),
    ...['held', 'activatedAt', 'startedAt', 'achievedAt', 'levelMin', 'levelMax',
      'tempBaseline', 'graphiteBaseline'].flatMap(k => [NaN, Infinity, undefined, '400']
      .map(v => d => { d.state[1][k] = v; })),
    d => { d.state[1].levelMin = 0.51; }, d => { d.state[1].levelMax = 0.49; },
    d => { d.state[1].levelMax = 0.53; }, d => { d.state[1].tempBaseline = 700; },
    d => { d.state[1].graphiteBaseline = 901; }, d => { d.state[0].levelMin = 0.5; },
  ];
  for (const corrupt of corruptions) {
    f.objectives.restore(valid);
    assert.equal(f.objectives.done, true);
    const data = structuredClone(valid);
    corrupt(data);
    f.objectives.restore(data);
    assert.ok(f.objectives.view().every(g => g.held === 0 && g.achievedAt === null), String(corrupt));
  }
  f.engine.state.auxWaterKg = 0;
  f.objectives.restore(valid);
  assert.ok(f.objectives.view().every(g => g.held === 0));
  for (const missing of [null, undefined, {}]) {
    f.objectives.restore(missing);
    assert.ok(f.objectives.view().every(g => !g.active));
  }
});
