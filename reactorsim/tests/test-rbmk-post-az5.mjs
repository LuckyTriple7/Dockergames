import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import rbmk from '../static/js/plants/rbmk.js';
import { getPlant } from '../static/js/plants/index.js';
import { createEngine } from '../static/js/sim/engine.js';
import { Session, PHASE } from '../static/js/game/session.js';
import { attachRecorder } from '../static/js/game/recorder.js';
import { record } from '../static/js/game/coreActions.js';
import { captureKit, recordingKit } from '../static/js/game/replayKit.js';
import { noteAction } from '../static/js/game/learning.js';
import { replayRun } from '../static/js/game/replay.js';
import { score } from '../static/js/game/scoring.js';
import { pack, apply } from '../static/js/net/persist.js';

const def = JSON.parse(await readFile(new URL('../static/data/scenarios/rbmk_post_az5.json', import.meta.url), 'utf8'));
const DT = 0.05;
const json = v => JSON.parse(JSON.stringify(v));
const FEW = new Map([[240, 50], [360, 40], [600, 30], [900, 25], [1200, 22], [1500, 18]]);

function create() {
  const engine = createEngine(rbmk, { seed: def.seed });
  attachRecorder(engine);
  const map = {};
  engine.hooks.uiControls(engine.state, engine.spec, engine.ctx,
    recordingKit(captureKit(map), (id, value) => {
      engine.recorder.record(id, value);
      noteAction(engine, id, value);
    }));
  const session = new Session(engine, def);
  session.onAlert = () => assert.fail('this scenario disables event pre-alerts');
  session.start();
  engine.drainLog();
  return { engine, session, map };
}

function actions(f, n, mode) {
  const { engine: e, map } = f;
  if (mode === 'az5' && n % 600 === 0) record(e, 'scram');
  if (mode === 'auto' && n >= 4800 && n % 600 === 0) {
    record(e, 'fw_auto', false);
    record(e, 'fw_auto', true);
  }
  if (mode === 'idle' || mode === 'az5' || mode === 'auto' || n < 4800) return;
  if (n === 4800) map['btn:ctl_rbmk_aux_feed']('1');
  let value;
  if (mode === 'good' && n % 600 === 0) {
    // Only measured steam flow and actual inventory, in whole UI percent.
    value = Math.round(Math.max(0, Math.min(100,
      (e.state.W_steam - e.state.fwSupplyMax + (e.spec.drum.mass - e.state.M_drum) / 180) / 2.2)));
  } else if (mode === 'few') value = FEW.get(n * DT);
  else if (typeof mode === 'number' && n === 4800) value = mode;
  if (value !== undefined) map['write:ctl_rbmk_aux_flow'](value);
}

function step(f) {
  f.engine.step(DT);
  assert.equal(f.engine.state.fault, null);
  f.session.step(DT, f.engine.trips.tiles(), f.engine.trips.unacknowledgedSeconds());
  f.engine.drainLog();
}

function run(mode, checkpoints = []) {
  const live = create();
  const copies = [];
  const saved = [];
  for (let n = 0; live.session.phase === PHASE.RUNNING; n++) {
    actions(live, n, mode);
    for (const copy of copies) actions(copy, n, mode);
    if (checkpoints.includes(n * DT)) {
      const blob = json(pack(live.engine, def.id, live.session.run, live.session));
      const copy = create();
      let scrams = 0;
      const rawScram = copy.engine.scram;
      copy.engine.scram = (...args) => { scrams++; return rawScram(...args); };
      assert.equal(apply(blob, copy.engine, copy.session.run, copy.session), null);
      copy.session.scenario.catchUp(copy.engine.state.t_sim);
      copy.engine.recorder.stepCount = n;
      assert.equal(scrams, 0, 'restoring must not prepare or SCRAM again');
      assert.deepEqual(copy.engine.state, live.engine.state);
      assert.deepEqual(copy.session.snapshot(), live.session.snapshot());
      assert.deepEqual(json(pack(copy.engine, def.id, copy.session.run, copy.session)), blob);
      copies.push(copy);
      saved.push(blob);
    }
    step(live);
    for (const copy of copies) {
      // Extra renderer reads must not change the resumed physics or history.
      copy.engine.derive();
      copy.engine.derive();
      copy.session.objectives.view();
      step(copy);
      assert.deepEqual(copy.engine.state, live.engine.state, `physics at step ${n + 1}`);
      assert.deepEqual(copy.session.snapshot(), live.session.snapshot(), `goals at step ${n + 1}`);
      if (n % 600 === 0) {
        assert.deepEqual(json(pack(copy.engine, def.id, copy.session.run, copy.session)),
          json(pack(live.engine, def.id, live.session.run, live.session)));
      }
    }
  }
  for (const copy of copies) {
    assert.deepEqual(copy.session.result, live.session.result);
    assert.deepEqual(copy.engine.ctx.trends.snapshot(), live.engine.ctx.trends.snapshot());
  }
  return { ...live, saved };
}

function finalConstraints(f) {
  const s = f.engine.state;
  assert.equal(f.session.result.summary.completed, true);
  assert.equal(f.session.result.summary.failed, null);
  assert.equal(f.session.result.summary.duration_s, 1800);
  assert.equal(f.session.result.summary.scram_count, 1);
  assert.equal(s.destroyed, false);
  assert.equal(s.scram.active, true);
  assert.ok(s.rod.every(v => v >= 0.99));
  assert.ok(s.n <= 0.01 && s.P_th <= 0.1 * rbmk.spec.P0_th);
  assert.ok(s.W_core >= 5000 && s.p_drum >= 55 && s.p_drum <= 75);
  assert.ok(s.T_cl < 700 && s.T_gr <= 900);
  assert.ok(s.M_drum >= 0.9 * rbmk.spec.drum.mass && s.L_drum >= 0.35 && s.L_drum <= 0.7);
  assert.ok(s.W_fwAux > 1 && s.W_fwMain <= 15);
  assert.ok(Math.abs(s.W_fw - s.W_steam) <= Math.max(5, 0.1 * s.W_steam));
  assert.ok(s.auxWaterKg >= Math.max(10000, s.W_fwAux * 300));
  const window = f.session.objectives.snapshot().state[1];
  assert.ok(window.levelMax - window.levelMin <= 0.02 + 1e-8);
  assert.ok((s.T_ci + s.T_co) / 2 <= window.tempBaseline + 1 + 1e-8);
  assert.ok(s.T_gr <= window.graphiteBaseline + 1 + 1e-8);
  assert.deepEqual(f.session.result.summary.objectives, [{ id: 'supply', met: true }, { id: 'stable', met: true }]);
}

test('scenario contract has only real preparation, three physical events and two incident goals', () => {
  assert.equal(def.id, 'rbmk_post_az5');
  assert.equal(def.reactor, 'rbmk');
  assert.equal(def.difficulty, 3);
  assert.equal(def.score_mode, 'incident_v1');
  assert.equal(def.preparation, 'rbmk_post_az5_v1');
  assert.equal(def.cold, undefined);
  assert.equal(def.start_overrides, undefined);
  assert.deepEqual(def.guidance, { hint_key: 'scn_rbmk_post_az5_hint', auto_helper: false, event_alerts: false });
  assert.deepEqual(def.events, [{ t: 90, id: 'mcp_trip', args: { count: 4 } },
    { t: 180, id: 'rbmk_feed_supply_limit', args: { max_kgs: 15 } },
    { t: 240, id: 'rbmk_aux_feed_ready' }]);
  assert.deepEqual(def.fail, [{ type: 'fuel_damage' }]);
  assert.deepEqual(def.objectives.map(g => [g.id, g.type, g.hold_s]),
    [['supply', 'rbmk_inventory', 30], ['stable', 'rbmk_heat_removal', 120]]);
});

test('profile uses normal warm start and actual SCRAM before first trend sample, with rods still travelling', () => {
  const e = createEngine(rbmk, { seed: def.seed });
  const before = structuredClone(e.state);
  const session = new Session(e, { ...def, start_overrides: { mcpDmd: 0.95 } });
  const scram = e.scram;
  let calls = 0;
  e.scram = cause => {
    calls++;
    assert.equal(cause, 'scenario');
    assert.equal(e.state.auxFeedInstalled, true);
    assert.equal(e.state.mcpDmd, 0.95);
    assert.equal(e.state.P_demand, 0);
    assert.equal(e.ctx.trends.count, 0);
    return scram(cause);
  };
  session.start();
  assert.equal(calls, 1);
  for (const key of ['n', 'D', 'T_f', 'T_gr', 'T_cl', 'T_ci', 'T_co', 'rod']) assert.deepEqual(e.state[key], before[key], key);
  assert.ok(e.state.rod.some(v => v < 0.99));
  assert.equal(e.state.scram.t, 0);
  assert.equal(e.state.scram.active, true);
  assert.equal(e.state.auxFeedAvailable, false);
  assert.equal(e.state.auxFeedOn, false);
  assert.equal(e.state.auxWaterKg, 160000);
  assert.equal(e.ctx.trends.count, 1);
  assert.equal(e.ctx.trends.latestTime, 0);
  assert.deepEqual(e.ctx.trends.markers, [{ t: 0, kind: 'scram', key: 'event_scram', severity: 3 }]);
  e.step(DT);
  assert.ok(e.state.rod[0] > before.rod[0] && e.state.rod[0] < 0.99);
});

test('unknown or foreign explicit profiles throw before mutations; absent profiles keep old starts', () => {
  for (const preparation of [null, '', false, {}, 'unknown', 'rbmk_post_az5_v2']) {
    const e = createEngine(rbmk);
    const session = new Session(e, { ...def, preparation });
    const before = structuredClone(e.state);
    assert.throws(() => session.start(), /Invalid scenario preparation/);
    assert.deepEqual(e.state, before);
    assert.equal(session.phase, PHASE.BRIEFING);
  }
  for (const id of ['pwr', 'bwr']) {
    const e = createEngine(getPlant(id));
    assert.throws(() => new Session(e, def).start(), /Invalid scenario preparation/);
    assert.throws(() => new Session(createEngine(rbmk), { ...def, reactor: id }).start(), /Invalid scenario preparation/);
  }
  for (const id of ['pwr', 'bwr', 'rbmk']) {
    const e = createEngine(getPlant(id));
    new Session(e, { reactor: id, demand: [{ t: 0, mw: 10 }] }).start();
    assert.equal(e.state.scram.active, false);
    assert.equal(e.state.P_demand, 10);
    if (id === 'rbmk') assert.equal(e.state.auxFeedInstalled, false);
  }
});

test('resume replaces startup log buffers while preserving undrawn events exactly once', () => {
  for (const drained of [false, true]) {
    const source = createEngine(rbmk);
    const session = new Session(source, def);
    session.start();
    for (let i = 0; i < 200; i++) {
      source.step(DT);
      session.step(DT, source.trips.tiles(), 0);
    }
    if (drained) source.drainLog();
    const snapshot = json(pack(source, def.id, session.run, session));
    const expectedPending = json([...source.ctx.log, ...source.trips.events]);
    const target = createEngine(rbmk);
    const restored = new Session(target, def);
    restored.start();
    assert.equal(target.ctx.log[0].key, 'event_scram');
    assert.equal(apply(snapshot, target, restored.run, restored), null);
    assert.deepEqual(json(target.drainLog()), expectedPending);
    source.drainLog();
    assert.deepEqual(target.ctx.history, source.ctx.history);
    assert.equal(target.ctx.history.filter(e => e.key === 'event_scram').length, 1);
    assert.deepEqual(target.drainLog(), []);
    assert.deepEqual(target.state, source.state);
    assert.deepEqual(restored.snapshot(), session.snapshot());
    if (drained) {
      delete snapshot.pendingLog;
      const legacy = createEngine(rbmk);
      const legacySession = new Session(legacy, def);
      legacySession.start();
      assert.equal(apply(snapshot, legacy, legacySession.run, legacySession), null);
      assert.deepEqual(legacy.drainLog(), [], 'old saves never inherit fresh-start announcements');
      assert.equal(legacy.ctx.history.filter(e => e.key === 'event_scram').length, 1);
    }
  }
});

test('GOOD measured 30s manual policy wins with real final constraints and exact recorded replay', t => {
  const f = run('good');
  finalConstraints(f);
  assert.ok(f.engine.state.auxWaterKg > 69000);
  const log = json(f.engine.recorder.serialize());
  assert.ok(new Set(log.filter(a => a.id === 'write:ctl_rbmk_aux_flow').map(a => a.value)).size > 10);
  assert.deepEqual(replayRun(rbmk, def, log), f.session.result.summary);
  assert.deepEqual(score(f.session.result.summary), { score: f.session.result.score, parts: f.session.result.parts });
  assert.equal(f.session.result.score, 3650);
  t.diagnostic(JSON.stringify({ policy: 'good', reserveKg: f.engine.state.auxWaterKg,
    score: f.session.result.score, goals: f.session.objectives.view() }));
});

test('six practical settings win; saves before faults, on aux, inside hold and late continue bit-exactly', t => {
  const f = run('few', [60, 300, 960, 1740]);
  finalConstraints(f);
  assert.equal(f.saved.length, 4);
  assert.equal(f.saved[0].state.auxFeedAvailable, false);
  assert.ok(f.saved[1].state.W_fwAux > 0);
  assert.ok(f.saved[2].session.objectives.state[1].held > 0 && f.saved[2].session.objectives.state[1].held < 120);
  assert.ok(f.saved[3].state.auxWaterKg < 160000);
  assert.ok(f.engine.state.auxWaterKg > 62000);
  const log = json(f.engine.recorder.serialize());
  assert.deepEqual(log.filter(a => a.id === 'write:ctl_rbmk_aux_flow').map(a => [a.n * DT, a.value]), [...FEW]);
  assert.deepEqual(replayRun(rbmk, def, log), f.session.result.summary);
  t.diagnostic(JSON.stringify({ policy: 'few', settings: [...FEW], score: f.session.result.score,
    final: Object.fromEntries(['M_drum', 'L_drum', 'p_drum', 'T_cl', 'T_gr', 'W_core',
      'W_fwMain', 'W_fwAux', 'W_steam', 'auxWaterKg', 'coolantHeatMW'].map(k => [k, f.engine.state[k]])),
    goals: f.session.objectives.view() }));
});

for (const mode of ['idle', 'az5', 'auto', 100]) {
  test(`${mode}: waiting, repeat AZ-5, feed-auto toggles or full aux cannot win`, () => {
    const f = run(mode);
    assert.equal(f.session.result.summary.completed, false);
    assert.equal(f.session.result.summary.failed, 'fail_objectives_unmet');
    assert.equal(f.session.result.summary.duration_s, 1800);
    assert.equal(f.engine.state.fwSupplyMax, 15);
    assert.equal(f.engine.ctx.pumpsStuck.size, 4);
    if (mode === 100) {
      assert.equal(f.engine.state.auxWaterKg, 0);
      assert.equal(f.engine.state.W_fwAux, 0);
      assert.ok(f.engine.state.L_drum > 0.7);
    } else assert.equal(f.engine.state.auxWaterKg, 160000);
  });
}

test('fixed-once settings across the viable flow band cannot replace declining-heat adjustments', () => {
  // Cover every whole-percent UI position and finer steps in the viable band.
  const settings = new Set([...Array.from({ length: 101 }, (_, i) => i),
    ...Array.from({ length: 21 }, (_, i) => 20 + i / 2)]);
  for (const percent of settings) {
    const f = run(percent);
    assert.equal(f.session.result.summary.completed, false, `fixed ${percent}%`);
  }
});

test('physical fuel failure has precedence; a lost final goal fails despite historical achievement', () => {
  for (const destroyed of [false, true]) {
    const f = create();
    f.engine.state.t_sim = def.duration_s;
    f.session.scenario.catchUp(def.duration_s);
    f.engine.state.destroyed = destroyed;
    for (const goal of f.session.objectives.state) {
      goal.held = 120;
      goal.activatedAt = 240;
      goal.achievedAt = 500;
    }
    f.engine.state.W_fw = 0;
    f.session.step(DT, [], 0);
    assert.equal(f.session.result.summary.completed, false);
    assert.equal(f.session.result.summary.failed, destroyed ? 'fail_fuel_damage' : 'fail_objectives_unmet');
    assert.ok(f.session.objectives.view().every(g => !g.met && g.achievedAt === 500));
  }
});
