import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createEngine } from '../static/js/sim/engine.js';
import rbmk from '../static/js/plants/rbmk.js';
import { getPlant } from '../static/js/plants/index.js';
import { getEvent } from '../static/js/game/events.js';
import { CORE_ACTIONS } from '../static/js/game/coreActions.js';
import { runHelper } from '../static/js/game/helper.js';
import { captureKit, recordingKit } from '../static/js/game/replayKit.js';
import { Scenario } from '../static/js/game/scenario.js';
import { score } from '../static/js/game/scoring.js';
import { pack, apply } from '../static/js/net/persist.js';
import { numbers, sanitize, hash } from '../static/js/sim/state.js';
import { dpdT, hf, hfg, tsat } from '../static/js/sim/steam.js';

const DT = 0.05;
const NORMAL = 1.3 * rbmk.spec.drum.W_steam0;
const FIELDS = ['auxFeedInstalled', 'auxFeedAvailable', 'auxFeedOn', 'auxFeedDmd',
  'auxWaterKg', 'W_fwDemand', 'W_fwMain', 'W_fwAux', 'fwSupplyMax', 'coolantHeatMW'];
const json = value => JSON.parse(JSON.stringify(value));
const near = (a, b, tol = 1e-7) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const fire = (e, id, args) => getEvent(id).apply(e, args);
const run = (e, n) => { for (let i = 0; i < n; i++) e.step(DT); };
function equipped() {
  const e = createEngine(rbmk);
  e.state.auxFeedInstalled = true;
  return e;
}
function controls(e, kit) {
  const map = {};
  const widgets = e.hooks.uiControls(e.state, e.spec, e.ctx, kit || captureKit(map));
  return { map, widgets };
}
function enable(e, percent = 100) {
  fire(e, 'rbmk_aux_feed_ready');
  const { map } = controls(e);
  map['write:ctl_rbmk_aux_flow'](percent);
  map['btn:ctl_rbmk_aux_feed']('1');
}

test('neutral flat finite feed contract, including cold and low-power trim', () => {
  for (const opts of [{}, { n: 0.07 }, { n: 1e-8, cold: true }]) {
    const e = createEngine(rbmk, opts);
    const s = e.state;
    assert.equal(s.auxFeedInstalled, false);
    assert.equal(s.auxFeedAvailable, false);
    assert.equal(s.auxFeedOn, false);
    assert.equal(s.auxFeedDmd, 0);
    assert.equal(s.auxWaterKg, 160000);
    assert.equal(s.fwSupplyMax, NORMAL);
    assert.equal(s.W_fwDemand, s.W_fw);
    assert.equal(s.W_fwMain, s.W_fw);
    assert.equal(s.W_fwAux, 0);
    for (const key of FIELDS) assert.ok(typeof s[key] === 'boolean' || Number.isFinite(s[key]), key);
  }
});

test('unequipped RBMK retains exact pre-change physics and controller timing', () => {
  // SHA-256 of the entire original state, captured before implementing feed.
  const baseline = {
    0: '7a62dbc742eb390e7f3ec95f4b1e8d6dae4bfc3230f4444a5ca3c12b0135b8f0',
    1: '90dae8c1d269c246bd55f5846f98de97340da096d09055e2afe0a6c97bda93aa',
    4: '41c4eced7595fe7ea570b0a982c1ffb317939f5ba98924b0b0c00e699f789dc9',
    17: '4a91ed2d5547d8ba656277ab56a1e93375632b1f7ccec7c293d01b7f2e1c197f',
    200: '407596f89b71c584f8d0fbe0f3d56c0946e0d3d7de8c45061a746ce2143c9488',
    600: '6ee86c0e223021d97bfbacc975ce258965d6d9131c79e57d127da48a59438e79',
    1200: '1325f3a512a99bf36a67e8ea05aeeb6965b187c9acbb50cf8883443373d72bcc',
  };
  const e = createEngine(rbmk);
  for (let i = 0; i <= 1200; i++) {
    if (baseline[i]) {
      const old = Object.fromEntries(Object.entries(e.state).filter(([k]) => !FIELDS.includes(k)));
      if (i === 0) delete old.srv; // Previously initialized only on the first step.
      assert.equal(createHash('sha256').update(JSON.stringify(old)).digest('hex'), baseline[i], `step ${i}`);
    }
    if (i === 37) { e.ctx.fwCtl.auto = false; e.ctx.fwCtl.manual = 0.6; }
    if (i === 230) e.ctx.fwCtl.auto = true;
    if (i === 300) e.state.mcpDmd = 0.8;
    if (i === 600) e.scram('baseline');
    e.step(DT);
  }
});

test('kit registers hidden replay handlers and only mounts installed equipment', () => {
  const e = createEngine(rbmk);
  const { map, widgets } = controls(e);
  assert.deepEqual(widgets.map(w => w.mount), ['primary']);
  assert.equal(typeof map['btn:ctl_rbmk_aux_feed'], 'function');
  assert.equal(typeof map['write:ctl_rbmk_aux_flow'], 'function');
  map['write:ctl_rbmk_aux_flow'](100);
  map['btn:ctl_rbmk_aux_feed']('1');
  assert.equal(e.state.auxFeedDmd, 0);
  assert.equal(e.state.auxFeedOn, false);
  // Same closures after session initialization, no recapture needed.
  e.state.auxFeedInstalled = true;
  map['write:ctl_rbmk_aux_flow'](75);
  map['btn:ctl_rbmk_aux_feed']('1');
  assert.equal(e.state.auxFeedDmd, 0.75);
  assert.equal(e.state.auxFeedOn, false);
  assert.deepEqual(controls(e).widgets.map(w => w.mount), ['primary', 'safety', 'secondary']);
  fire(e, 'rbmk_aux_feed_ready');
  assert.equal(e.state.auxFeedOn, false);
  map['btn:ctl_rbmk_aux_feed']('1');
  assert.equal(e.state.auxFeedOn, true);
  map['btn:ctl_rbmk_aux_feed'](0);
  assert.equal(e.state.auxFeedOn, false);
});

test('aux callbacks reject invalid types and bounds without mutation', () => {
  const e = equipped();
  enable(e, 50);
  const { map } = controls(e);
  for (const value of [null, undefined, true, false, {}, [], [1], NaN, Infinity, -1, 101, '50']) {
    const before = json(pack(e));
    map['write:ctl_rbmk_aux_flow'](value);
    assert.deepEqual(json(pack(e)), before);
  }
  for (const value of [null, undefined, true, false, {}, [], [1], NaN, Infinity, -1, 2, 'true', '01']) {
    const before = json(pack(e));
    map['btn:ctl_rbmk_aux_feed'](value);
    assert.deepEqual(json(pack(e)), before);
  }
});

test('feed events reject foreign plants and malformed args without mutation', () => {
  for (const id of ['pwr', 'bwr']) {
    const e = createEngine(getPlant(id));
    const before = json(pack(e));
    fire(e, 'rbmk_feed_supply_limit', { max_kgs: 0 });
    fire(e, 'rbmk_aux_feed_ready');
    assert.deepEqual(json(pack(e)), before);
  }
  const e = equipped();
  for (const args of [undefined, null, 0, '0', [], {}, { max_kgs: -1 }, { max_kgs: NaN },
    { max_kgs: Infinity }, { max_kgs: '20' }, { max_kgs: null }, Object.create({ max_kgs: 20 })]) {
    const before = json(pack(e));
    fire(e, 'rbmk_feed_supply_limit', args);
    assert.deepEqual(json(pack(e)), before);
  }
  for (const args of [null, 0, true, 'ready', [], { water_kgs: 100 }, { extra: 1 }]) {
    const before = json(pack(e));
    fire(e, 'rbmk_aux_feed_ready', args);
    assert.deepEqual(json(pack(e)), before);
  }
  fire(e, 'rbmk_feed_supply_limit', { max_kgs: 1e9 });
  assert.equal(e.state.fwSupplyMax, NORMAL);
  fire(e, 'rbmk_feed_supply_limit', { max_kgs: 0 });
  assert.equal(e.state.fwSupplyMax, 0);
  const bare = createEngine(rbmk);
  fire(bare, 'rbmk_aux_feed_ready');
  assert.equal(bare.state.auxFeedAvailable, false);
});

test('readiness is idempotent, never refills or starts auxiliary feed', () => {
  const e = equipped();
  e.state.auxWaterKg = 2;
  e.state.auxFeedDmd = 1;
  fire(e, 'rbmk_aux_feed_ready', {});
  fire(e, 'rbmk_aux_feed_ready');
  run(e, 10);
  assert.equal(e.state.auxWaterKg, 2);
  assert.equal(e.state.W_fwAux, 0);
  assert.equal(e.state.auxFeedOn, false);
});

test('main plus auxiliary flow enters the existing mass and energy balance exactly once', () => {
  const e = equipped();
  const s = e.state;
  fire(e, 'rbmk_feed_supply_limit', { max_kgs: 100 });
  enable(e, 50);
  for (let i = 0; i < 40; i++) {
    const { M_drum: mass, p_drum: pressure, auxWaterKg: tank } = s;
    e.step(DT);
    assert.equal(s.W_fwMain, 100);
    assert.equal(s.W_fwAux, 110);
    assert.equal(s.W_fw, 210);
    near(s.M_drum - mass, (210 - s.W_steam) * DT);
    near(tank - s.auxWaterKg, 110 * DT);
    const capacity = (mass * e.spec.drum.cp + e.spec.drum.mass * e.spec.drum.cp * 0.05) / dpdT(pressure);
    const net = s.coolantHeatKJ + (210 * (4.2 * 165 - hf(pressure)) - s.W_steam * hfg(pressure)) * DT;
    near((s.p_drum - pressure) * capacity + s.pressureClipKJ, net, 1e-6);
    const d = e.derive();
    assert.equal(d.inventoryRateKgS, 210 - s.W_steam);
    assert.equal(d.coolantHeatMW, s.coolantHeatKJ / DT / 1000);
    assert.equal(d.graphiteHeatMW, e.spec.graphite.UA * (s.T_gr - tsat(s.p_drum)) / 1000);
  }
});

test('graphite deposit remains stored, with only released heat entering coolant', () => {
  const e = equipped();
  const s = e.state;
  const before = s.T_gr;
  const deposited = s.P_th * 1000 * (1 - e.spec.fuel.depositFraction);
  const out = e.hooks.directHeat(s, e.spec, e.ctx, deposited, DT);
  const capacity = e.spec.graphite.mass_t * e.spec.graphite.cp;
  near(out * DT + capacity * (s.T_gr - before), deposited * DT);
});

for (const dt of [0.05, 0.07, 0.2]) {
  test(`finite tank supplies exact last partial step at dt=${dt}`, () => {
    const e = equipped();
    enable(e);
    e.state.auxWaterKg = 220 * dt + 0.123456789;
    const initial = e.state.auxWaterKg;
    let delivered = 0;
    for (let i = 0; i < 3; i++) {
      e.hooks.stepLoop(e.state, e.spec, e.ctx, dt);
      delivered += e.state.W_fwAux * dt;
      if (i === 0) assert.equal(e.state.W_fwAux, 220);
      if (i === 1) {
        assert.ok(e.state.W_fwAux > 0 && e.state.W_fwAux < 220);
        assert.equal(e.state.auxWaterKg, 0);
      }
    }
    assert.equal(e.state.W_fwAux, 0);
    assert.equal(e.state.auxWaterKg, 0);
    near(delivered, initial, 1e-12);
  });
}

test('all three aux gates and zero demand physically prevent flow', () => {
  for (const key of ['auxFeedInstalled', 'auxFeedAvailable', 'auxFeedOn', 'auxFeedDmd']) {
    const e = equipped();
    enable(e);
    e.state[key] = key === 'auxFeedDmd' ? 0 : false;
    const tank = e.state.auxWaterKg;
    e.step(DT);
    assert.equal(e.state.W_fwAux, 0, key);
    assert.equal(e.state.auxWaterKg, tank, key);
  }
});

test('invalid local dt is rejected before pumps, tank or physics mutate', () => {
  const e = equipped();
  enable(e);
  const before = json(pack(e));
  for (const dt of [0, -1, NaN, Infinity, '0.05', null, undefined]) {
    e.hooks.stepLoop(e.state, e.spec, e.ctx, dt);
    assert.deepEqual(json(pack(e)), before);
  }
});

test('main cap survives auto/manual/helper/AZ-5 and never recycles the W_fw alias', () => {
  const e = equipped();
  const s = e.state;
  fire(e, 'rbmk_feed_supply_limit', { max_kgs: 80 });
  const initialDemand = s.W_fwDemand;
  enable(e);
  run(e, 3);
  assert.equal(s.W_fwDemand, initialDemand);
  assert.equal(s.W_fw, 300);
  e.step(DT); // Controller writes a new request, not actual flow.
  assert.ok(s.W_fwDemand > 300);
  assert.equal(s.W_fw, 300);
  const request = s.W_fwDemand;
  run(e, 3);
  assert.equal(s.W_fwDemand, request);
  for (const action of [
    () => { CORE_ACTIONS.fw_auto(e, false); CORE_ACTIONS.fw_write(e, 130); },
    () => runHelper(e, 'rbmk', 'drum_level_low'),
    () => CORE_ACTIONS.scram(e),
    () => CORE_ACTIONS.fw_auto(e, true),
  ]) {
    action();
    for (let i = 0; i < 20; i++) {
      e.step(DT);
      assert.equal(s.fwSupplyMax, 80);
      assert.ok(s.W_fwMain <= 80);
      assert.equal(s.W_fw, s.W_fwMain + s.W_fwAux);
    }
  }
});

test('supply cap also acts on unequipped RBMK; legacy feedwater_loss is unchanged', () => {
  const e = createEngine(rbmk);
  fire(e, 'rbmk_feed_supply_limit', { max_kgs: 30 });
  run(e, 5);
  assert.equal(e.state.W_fwMain, 30);
  assert.equal(e.state.W_fw, 30);
  fire(e, 'feedwater_loss');
  assert.equal(e.ctx.fwCtl.auto, false);
  assert.equal(e.ctx.fwCtl.manual, 0);
});

test('failed MCP cannot restart for a physical tick through toggles, helpers or direct calls', () => {
  const e = equipped();
  fire(e, 'mcp_trip', { count: 2 });
  run(e, 60);
  const saved = json(pack(e));
  for (const restart of [
    () => CORE_ACTIONS.pump_toggle(e, 0),
    () => runHelper(e, 'rbmk', 'clad_temp'),
    () => e.ctx.mcp[0].start(),
  ]) {
    assert.equal(apply(saved, e), null);
    const reference = equipped();
    assert.equal(apply(saved, reference), null);
    restart();
    e.step(DT); reference.step(DT);
    assert.equal(e.ctx.mcp[0].running, false);
    assert.equal(e.state.W_core, reference.state.W_core);
    assert.deepEqual(e.ctx.mcp[0].snapshot(), reference.ctx.mcp[0].snapshot());
  }
});

test('feed alarms reuse drum, readiness is INFO and incident violations cost zero', () => {
  const e = equipped();
  fire(e, 'rbmk_feed_supply_limit', { max_kgs: 80 });
  fire(e, 'rbmk_aux_feed_ready');
  e.state.auxWaterKg = 0;
  e.step(DT);
  for (const suffix of ['feed_limited', 'aux_ready', 'aux_low', 'aux_empty']) {
    const id = `rbmk_${suffix}`;
    const tile = e.trips.tiles().find(t => t.id === id);
    assert.equal(tile.key, `alarm_${id}`);
    assert.equal(tile.tile, 'new');
    assert.equal(e.spec.alarmComponents[id], 'drum');
  }
  assert.equal(e.trips.tiles().find(t => t.id === 'rbmk_aux_ready').severity, 1);
  const result = score({ score_mode: 'incident_v1', duration_s: 100,
    violation_seconds: { 1: 100, 2: 100, 3: 100 } });
  for (const severity of ['info', 'warn', 'trip']) assert.equal(result.parts[`violations_${severity}`], 0);
  const bare = createEngine(rbmk);
  bare.step(DT);
  assert.ok(bare.trips.tiles().filter(t => t.id.startsWith('rbmk_')).every(t => t.tile === 'normal'));
});

test('legacy save resets equipment to neutral even over an equipped live target', () => {
  const source = createEngine(rbmk);
  run(source, 17);
  const blob = json(pack(source));
  for (const key of FIELDS) delete blob.state[key];
  const e = equipped();
  enable(e);
  e.state.auxWaterKg = 0;
  assert.equal(apply(blob, e), null);
  assert.equal(e.state.auxFeedInstalled, false);
  assert.equal(e.state.auxFeedAvailable, false);
  assert.equal(e.state.auxFeedOn, false);
  assert.equal(e.state.auxFeedDmd, 0);
  assert.equal(e.state.auxWaterKg, e.spec.auxFeed.capacityKg);
  assert.equal(e.state.fwSupplyMax, NORMAL);
  assert.equal(e.state.W_fwDemand, blob.state.W_fw);
  run(source, 1); run(e, 1);
  assert.deepEqual(e.state, source.state);
});

test('malformed RBMK feed saves reject before state or components mutate', () => {
  const source = equipped();
  enable(source);
  run(source, 7);
  const valid = json(pack(source));
  const target = equipped();
  const before = json(pack(target));
  const invalid = [
    ['auxFeedInstalled', 1], ['auxFeedAvailable', 'true'], ['auxFeedOn', null],
    ['auxFeedDmd', -0.1], ['auxFeedDmd', 1.1], ['auxFeedDmd', '1'],
    ['auxWaterKg', -1], ['auxWaterKg', 160001], ['auxWaterKg', {}],
    ['W_fwDemand', -1], ['W_fwMain', []], ['W_fwAux', 221],
    ['fwSupplyMax', -1], ['fwSupplyMax', NORMAL + 1], ['coolantHeatMW', Infinity],
    ['auxFeedInstalled', false], ['auxFeedAvailable', false], ['W_fw', 0],
  ];
  for (const [key, value] of invalid) {
    const blob = json(valid);
    blob.state[key] = value;
    assert.ok(apply(blob, target), key);
    assert.deepEqual(json(pack(target)), before, key);
  }
  for (const key of FIELDS.filter(k => k !== 'coolantHeatMW')) {
    const blob = json(valid);
    delete blob.state[key];
    assert.ok(apply(blob, target), key);
    assert.deepEqual(json(pack(target)), before, key);
  }
});

test('unequipped saves may reconstruct only missing demand, not partial equipment state', () => {
  const source = createEngine(rbmk);
  run(source, 4);
  const blob = json(pack(source));
  delete blob.state.W_fwDemand;
  const target = createEngine(rbmk);
  assert.equal(apply(blob, target), null);
  assert.equal(target.state.W_fwDemand, blob.state.W_fw);
  delete blob.state.auxFeedInstalled;
  const before = json(pack(target));
  assert.ok(apply(blob, target));
  assert.deepEqual(json(pack(target)), before);
});

for (const tank of [160000, 0.123456789, 0]) {
  test(`live aux save/load preserves exact state and continuation, tank=${tank}`, () => {
    const live = equipped();
    fire(live, 'rbmk_feed_supply_limit', { max_kgs: 80 });
    enable(live, 71);
    live.scram('test');
    run(live, 17);
    live.state.auxWaterKg = tank;
    const restored = createEngine(rbmk);
    assert.equal(apply(json(pack(live)), restored), null);
    assert.deepEqual(restored.state, live.state);
    for (let i = 0; i < 100; i++) {
      live.step(DT); restored.step(DT);
      assert.deepEqual(restored.state, live.state, `step ${i}`);
      assert.deepEqual(json(pack(restored)), json(pack(live)), `pack ${i}`);
    }
  });
}

test('save after last partial draw or off-command keeps last physical flow sample', () => {
  const live = equipped();
  enable(live);
  live.state.auxWaterKg = 1;
  live.step(DT);
  assert.equal(live.state.auxWaterKg, 0);
  assert.equal(live.state.W_fwAux, 20);
  controls(live).map['btn:ctl_rbmk_aux_feed']('0');
  const restored = createEngine(rbmk);
  assert.equal(apply(json(pack(live)), restored), null);
  assert.deepEqual(restored.state, live.state);
  live.step(DT); restored.step(DT);
  assert.deepEqual(restored.state, live.state);
});

test('recorded kit callbacks replay identically with readiness at 240s and later player start', () => {
  const live = createEngine(rbmk);
  const replay = createEngine(rbmk);
  // Replay captures before installation; live builds after installation.
  const replayMap = controls(replay).map;
  live.state.auxFeedInstalled = replay.state.auxFeedInstalled = true;
  const log = [];
  const liveMap = {};
  controls(live, recordingKit(captureKit(liveMap), (id, value) => log.push({ id, value })));
  const def = { events: [{ t: 240, id: 'rbmk_aux_feed_ready' }] };
  const scenario = new Scenario(def);
  for (const e of [live, replay]) {
    fire(e, 'rbmk_feed_supply_limit', { max_kgs: 80 });
    e.scram('test');
  }
  for (let n = 0; n < 5100; n++) {
    for (const ev of scenario.due(n * DT)) {
      fire(live, ev.id); fire(replay, ev.id);
      assert.equal(live.state.auxFeedOn, false);
    }
    if (n === 0) liveMap['write:ctl_rbmk_aux_flow'](80);
    if (n === 1) liveMap['btn:ctl_rbmk_aux_feed']('1'); // Not ready: no-op.
    if (n === 4900) liveMap['btn:ctl_rbmk_aux_feed']('1');
    if (n === 5000) liveMap['write:ctl_rbmk_aux_flow'](25);
    for (const action of json(log.splice(0))) replayMap[action.id](action.value);
    live.step(DT); replay.step(DT);
    assert.deepEqual(replay.state, live.state, `step ${n}`);
    if (n < 4900) assert.equal(live.state.W_fwAux, 0);
  }
  assert.ok(live.state.auxWaterKg < 160000);
  assert.equal(live.state.W_fwAux, 55);
  assert.equal(live.state.fault, null);
});

test('new numeric state fields participate in finite checks and hashing', () => {
  for (const key of FIELDS.filter(k => typeof equipped().state[k] === 'number')) {
    const e = equipped();
    const before = hash(e.state);
    e.state[key] += 0.001;
    assert.notEqual(hash(e.state), before, key);
    e.state[key] = NaN;
    assert.ok(numbers(e.state).some(x => !Number.isFinite(x)), key);
    assert.equal(sanitize(e.state), false, key);
  }
});

for (const id of ['pwr', 'bwr', 'rbmk']) {
  test(`${id}: post-SCRAM regression has no new nonfinite physics state`, () => {
    const e = createEngine(getPlant(id));
    if (id === 'rbmk') {
      e.state.auxFeedInstalled = true;
      fire(e, 'rbmk_feed_supply_limit', { max_kgs: 0 });
      enable(e);
    }
    e.scram('test');
    for (let i = 0; i < 16000; i++) {
      e.step(DT);
      assert.equal(e.state.fault, null);
      for (const [key, value] of Object.entries(e.state)) {
        if (typeof value === 'number') assert.ok(Number.isFinite(value), key);
      }
    }
    if (id === 'rbmk') {
      assert.equal(e.state.auxWaterKg, 0);
      assert.equal(e.state.W_fwAux, 0);
    }
  });
}
