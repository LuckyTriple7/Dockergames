import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { record } from '../static/js/game/coreActions.js';
import { recordingKit, captureKit } from '../static/js/game/replayKit.js';
import { attachRecorder } from '../static/js/game/recorder.js';
import { noteAction, noteEvent, observeAlarms, learningReport, restoreJournal } from '../static/js/game/learning.js';
import { runHelper } from '../static/js/game/helper.js';
import { Session } from '../static/js/game/session.js';
import { Scenario } from '../static/js/game/scenario.js';
import { ScenarioObjectives } from '../static/js/game/objectives.js';
import { StartupTutorial, TUTORIAL_STEPS } from '../static/js/game/tutorial.js';
import { RbmkStartupTutorial } from '../static/js/game/rbmkTutorial.js';
import { BwrStartupTutorial } from '../static/js/game/bwrTutorial.js';
import { eventKey, getEvent } from '../static/js/game/events.js';
import { pack, apply } from '../static/js/net/persist.js';

const { TrendHistory } = await import('../static/js/game/trendHistory.js');
const makeEngine = (id = 'pwr', opts = {}) => createEngine(getPlant(id), { seed: 1, ...opts });
const alarm = { id: 'flow', key: 'trip_rcp_lost', severity: 3, tile: 'new' };
function capture(engine) {
  const markers = [];
  // Preserve any Session-owned sampler; only replace the marker sink.
  const history = engine.ctx.trends || new TrendHistory(engine);
  const mark = history.mark.bind(history);
  history.mark = entry => { markers.push(structuredClone(entry)); return mark(entry); };
  return markers;
}

for (const id of ['pwr', 'bwr', 'rbmk']) {
  test(`${id}: actual SCRAM, reset and turbine resume mark only guarded transitions`, () => {
    const e = makeEngine(id);
    const markers = capture(e);
    e.state.t_sim = 12.5;
    assert.equal(e.resetScram(), false);
    assert.equal(e.resumeTurbine(), false);
    assert.deepEqual(markers, []);
    record(e, 'scram', null); // Same no-argument payload as the actual UI.
    assert.deepEqual(markers, [
      { t: 12.5, kind: 'action', id: 'scram', value: null },
      { t: 12.5, kind: 'scram', key: 'event_scram', severity: 3 },
    ]);
    assert.deepEqual(e.ctx.trends.markers, markers, 'the validated history must retain the UI command');
    e.scram('again');
    assert.equal(e.resumeTurbine(), false);
    const trip = [...e.trips.states.values()].find(st => st.def.action === 'scram');
    trip.latched = true;
    assert.equal(e.resetScram(), false);
    assert.equal(markers.length, 2);
    trip.latched = false;
    e.state.t_sim = 20;
    assert.equal(e.resetScram(), true);
    assert.equal(e.resetScram(), false);
    assert.equal(e.resumeTurbine(), true);
    assert.equal(e.resumeTurbine(), false);
    assert.deepEqual(markers.slice(2), [
      { t: 20, kind: 'event', key: 'event_scram_reset', severity: 1 },
      { t: 20, kind: 'event', key: 'event_turbine_resume', severity: 1 },
    ]);
  });

  test(`${id}: scenario earthquake records actual SCRAM without a manual action`, () => {
    const e = makeEngine(id);
    const session = new Session(e, { id: 'quake', reactor: id, duration_s: 100,
      events: [{ id: 'earthquake_scram', t: 10 }] });
    const markers = capture(e);
    session.start();
    e.state.t_sim = 9;
    session.step(0.05, [], 0);
    assert.deepEqual(markers, []);
    e.state.t_sim = 10.025;
    session.step(0.05, [], 0);
    assert.equal(e.state.scram.cause, 'earthquake');
    assert.deepEqual(markers, [
      { t: 10.025, kind: 'scram', key: 'event_scram', severity: 3 },
      { t: 10.025, kind: 'event', key: 'ev_earthquake_scram' },
    ]);
    session.step(0.05, [], 0);
    assert.equal(markers.length, 2);
  });

  test(`${id}: free-play alarm transitions are renderer-independent`, () => {
    const e = makeEngine(id);
    const session = new Session(e, null);
    const markers = capture(e);
    session.start();
    e.state.t_sim = 3;
    session.step(0.05, [alarm], 0);
    e.state.t_sim = 4;
    session.step(0.05, [{ ...alarm, tile: 'ack' }], 0);
    e.state.t_sim = 5;
    session.step(0.05, [{ ...alarm, tile: 'return' }], 0);
    session.step(0.05, [], 0);
    assert.deepEqual(markers, [
      { t: 3, kind: 'on', key: alarm.key, severity: 3 },
      { t: 5, kind: 'off', key: alarm.key },
    ]);
    assert.deepEqual(learningReport(e).entries, markers);
  });

  test(`${id}: recordingKit and core writes forward every request despite journal coalescing`, () => {
    const e = makeEngine(id);
    const markers = capture(e);
    attachRecorder(e);
    const controls = {};
    e.hooks.uiControls(e.state, e.spec, e.ctx, recordingKit(captureKit(controls), (key, value) => {
      noteAction(e, key, value);
      e.recorder.record(key, value);
    }));
    const typedWrite = Object.keys(controls).find(key => key.startsWith('write:'));
    assert.ok(typedWrite);
    for (const action of ['gov_write', 'fw_write', 'demand_set', typedWrite]) {
      const before = markers.length;
      const journalBefore = learningReport(e).entries.length;
      for (const value of [20, 30, 40]) {
        e.state.t_sim += 0.25;
        if (action === typedWrite) controls[action](value);
        else record(e, action, value);
      }
      assert.deepEqual(markers.slice(before).map(m => [m.kind, m.id, m.value]),
        [20, 30, 40].map(value => ['action', action, value]));
      assert.equal(learningReport(e).entries.length, journalBefore + 1);
      assert.deepEqual(learningReport(e).entries.at(-1), markers.at(-1));
      assert.equal(markers.at(-1).t - markers.at(-3).t, 0.5);
    }
    assert.equal(e.recorder.serialize().length, 12, 'replay requests are not coalesced');
    const before = markers.length;
    record(e, 'ack');
    assert.equal(markers.length, before);
  });

  test(`${id}: headless helper journals each fixed action once and preserves recorder no-ops`, () => {
    const trip = { pwr: 'sg_level_low', bwr: 'level_high', rbmk: 'drum_level_low' }[id];
    for (const recording of [false, true]) {
      const e = makeEngine(id);
      const markers = capture(e);
      if (recording) attachRecorder(e);
      e.ctx.fwCtl.auto = false;
      e.state.t_sim = 7;
      assert.equal(runHelper(e, id, trip).status, 'fixed');
      assert.equal(e.ctx.fwCtl.auto, true);
      assert.deepEqual(markers, [{ t: 7, kind: 'action', id: 'helper:helper_action_fw_auto', value: undefined }]);
      assert.deepEqual(learningReport(e).entries, markers);
      assert.equal(runHelper(e, id, trip).status, 'none');
      assert.equal(runHelper(e, id, 'power_high').status, 'unfixable');
      assert.equal(runHelper(e, id, 'unknown').status, 'unfixable');
      assert.equal(markers.length, 1);
      assert.equal(learningReport(e).entries.length, 1);
      if (recording) assert.deepEqual(e.recorder.serialize(), [trip, trip, 'power_high']
        .map(value => ({ n: 0, id: 'helper', value })));
    }
  });

  test(`${id}: optional markers leave physics, component state and replay recording unchanged`, () => {
    const plain = makeEngine(id), marked = makeEngine(id);
    const markers = capture(marked);
    for (const e of [plain, marked]) {
      attachRecorder(e);
      for (let n = 0; n < 200; n++) {
        if (n === 5) record(e, 'gov_write', 30);
        if (n === 10) { e.ctx.fwCtl.auto = false; runHelper(e, id,
          { pwr: 'sg_level_low', bwr: 'level_high', rbmk: 'drum_level_low' }[id]); }
        if (n === 100) record(e, 'scram');
        if (n === 150) record(e, 'reset');
        e.step(0.05);
      }
    }
    assert.ok(markers.some(m => m.kind === 'scram'));
    assert.equal(plain.ctx.trends, undefined, 'pure engine does not acquire a trend dependency');
    assert.deepEqual(marked.state, plain.state);
    assert.deepEqual(marked.derive(), plain.derive());
    assert.deepEqual(pack(marked).components, pack(plain).components);
    assert.deepEqual(marked.ctx.rng.snapshot(), plain.ctx.rng.snapshot());
    assert.deepEqual(marked.recorder.serialize(), plain.recorder.serialize());
  });
}

const scenarioDir = new URL('../static/data/scenarios/', import.meta.url);
for (const file of readdirSync(scenarioDir).filter(file => file.endsWith('.json'))) {
  const def = JSON.parse(readFileSync(new URL(file, scenarioDir)));
  test(`${def.id}: only fired disturbances emit localized event keys`, () => {
    const schedule = new Scenario(def);
    for (const t of [0, ...schedule.events.map(ev => ev.t + 0.025)]) {
      const e = makeEngine(def.reactor, { seed: def.seed, cold: !!def.cold });
      const session = new Session(e, def);
      const markers = capture(e);
      session.start();
      assert.deepEqual(markers, def.preparation === 'rbmk_post_az5_v1'
        ? [{ t: 0, kind: 'scram', key: 'event_scram', severity: 3 }] : [],
      'only an actual prepared shutdown emits a start marker');
      markers.length = 0;
      e.state.t_sim = t;
      session.step(0.05, [], 0);
      const expected = schedule.events.filter(ev => ev.t <= t && getEvent(ev.id)).map(ev => eventKey(ev.id));
      assert.deepEqual(markers.filter(m => m.kind === 'event' && m.key.startsWith('ev_')).map(m => m.key), expected);
      assert.ok(markers.every(m => m.t === t), 'capture current simulation time, never scheduled/future time');
    }
  });
}

test('discrete requests, opposite rod gestures and alarm reactivation remain distinct', () => {
  const e = makeEngine();
  const markers = capture(e);
  for (const value of [1, 1, -1]) noteAction(e, 'rod_jog', value);
  for (const value of [0, 0]) noteAction(e, 'pump_toggle', value);
  assert.equal(markers.length, 5);
  assert.equal(learningReport(e).entries.length, 4);
  observeAlarms(e, [alarm]);
  observeAlarms(e, []);
  observeAlarms(e, [alarm]);
  assert.deepEqual(markers.slice(5).map(m => m.kind), ['on', 'off', 'on']);
});

test('real history coalesces continuous writes independently of the journal', () => {
  const e = makeEngine();
  const history = new TrendHistory(e);
  noteAction(e, 'gov_write', 20);
  e.state.t_sim = 0.5;
  noteAction(e, 'gov_write', 30);
  assert.deepEqual(history.markers, [{ t: 0.5, kind: 'action', id: 'gov_write', value: 30 }]);
  e.state.t_sim = 1;
  e.scram('manual'); // Actual outcomes are not journal actions.
  e.state.t_sim = 1.5;
  noteAction(e, 'gov_write', 40);
  assert.deepEqual(history.markers.map(m => [m.t, m.kind, m.value]),
    [[0.5, 'action', 30], [1, 'scram', undefined], [1.5, 'action', 40]]);
  assert.deepEqual(learningReport(e).entries, [{ t: 1.5, kind: 'action', id: 'gov_write', value: 40 }]);
  e.state.t_sim = 4;
  noteAction(e, 'gov_write', 50);
  assert.equal(history.markers.length, 4, 'separate gestures remain separate');
});

test('parameterized helper action retains its value in real history', () => {
  const e = makeEngine();
  const history = new TrendHistory(e);
  e.ctx.pumpList[0].trip();
  assert.equal(runHelper(e, 'pwr', 'dnbr_low').status, 'fixed');
  assert.deepEqual(history.markers, [
    { t: 0, kind: 'action', id: 'helper:helper_action_pump_start', value: { n: 1 } },
  ]);
});

test('unsuccessful operator requests are actions, not successful reset/resume events', () => {
  const e = makeEngine();
  const markers = capture(e);
  record(e, 'reset');
  record(e, 'turbine_resume');
  assert.deepEqual(markers.map(m => [m.kind, m.id]), [['action', 'reset'], ['action', 'turbine_resume']]);
});

test('actual plant loss emits one event at the existing engine capture time', () => {
  const plant = getPlant('pwr');
  const e = createEngine({ ...plant, hooks: { ...plant.hooks, lossCriteria: () => 'event_clad_failure' } });
  const markers = capture(e);
  e.step(0.05);
  e.step(0.05);
  assert.equal(e.state.destroyed, true);
  assert.deepEqual(markers, [{ t: 0, kind: 'event', key: 'event_clad_failure', severity: 3 }]);
});

function objectiveFixture(type) {
  const scenario = new Scenario({ id: 'incident', events: [{ id: 'feedwater_loss', t: 1 }],
    objectives: [{ id: 'recovery', type, after_events: ['feedwater_loss'], hold_s: 2 }] });
  const state = { t_sim: 0, W_fw: 100, W_steam: 100, M_sg: 45000, L_sg: 0.5,
    pzr_L: 0.5, pzr_p: 158, p_sg: 64, W_core: 20000, T_cl: 600,
    P_th: 100, T_ci: 560, T_co: 580, destroyed: false, fault: null };
  const engine = { state, spec: getPlant('pwr').spec, ctx: {}, derive: () => ({ dnbr: 2, subcooling: 20 }) };
  const markers = capture(engine);
  const objectives = new ScenarioObjectives(engine, scenario);
  const tick = () => { state.t_sim++; scenario.due(state.t_sim); objectives.step(1); };
  return { engine, objectives, markers, tick };
}

for (const type of ['pwr_feedwater', 'pwr_heat_removal', 'pwr_power_limited']) {
  test(`${type}: goal start/reset/met/lost/regain are transitions, preserving first achievement`, () => {
    const { engine: e, objectives: goals, markers, tick } = objectiveFixture(type);
    const key = `obj_${type}_title`;
    tick();
    assert.deepEqual(markers, [], 'activation is not yet a qualifying hold');
    tick(); // start at 2
    e.state.pzr_p = 130;
    tick(); // partial reset at 3
    tick(); // still false
    e.state.pzr_p = 158;
    tick(); // restart at 5
    tick(); // met at 6
    const snapshot = goals.snapshot();
    tick(); // still met
    goals.restore(snapshot);
    assert.deepEqual(goals.snapshot(), snapshot);
    assert.equal(markers.length, 4, 'restore emits no markers');
    e.state.pzr_p = 130;
    tick(); // lost at 8
    tick(); // still false
    e.state.pzr_p = 158;
    tick(); // restart at 10
    tick(); // met again at 11
    tick(); // still met
    assert.deepEqual(markers, [[2, 'goal_start'], [3, 'goal_reset'], [5, 'goal_start'],
      [6, 'goal_met'], [8, 'goal_lost'], [10, 'goal_start'], [11, 'goal_met']]
      .map(([t, kind]) => ({ t, kind, key, id: 'recovery' })));
    assert.equal(goals.view()[0].achievedAt, 6);
    assert.equal(goals.done, true);
    goals.restore(null);
    assert.equal(markers.length, 7, 'invalid/missing restore also emits nothing');
  });
}

for (const reactor of ['pwr', 'rbmk', 'bwr']) {
  test(`${reactor}: inspection marks completion only on confirmation; later holds still advance automatically`, () => {
    const e = makeEngine(reactor, { cold: true, n: 1e-6 });
    const markers = capture(e);
    const Tutorial = { pwr: StartupTutorial, rbmk: RbmkStartupTutorial, bwr: BwrStartupTutorial }[reactor];
    const tutorial = new Tutorial(e);
    tutorial.prepare();
    assert.deepEqual(markers, []);
    assert.equal(tutorial.confirmInspect(), false);
    const tick = dt => { e.state.t_sim += dt; tutorial.step(dt); };
    tick(1);
    assert.equal(tutorial.confirmInspect(), false);
    tick(1);
    e.state[{ pwr: 'p_prim', rbmk: 'p_drum', bwr: 'p_dome' }[reactor]] = 100;
    e.state.t_sim = 3;
    assert.equal(tutorial.confirmInspect(), false, 'invalid click uses the zero-time reset path');
    assert.equal(tutorial.held, 0);
    assert.equal(tutorial.elapsed, 2);
    assert.equal(tutorial.confirmInspect(), false);
    tick(1);
    assert.deepEqual(markers, [
      { t: 1, kind: 'goal_start', key: `${tutorial.prefix}inspect_title` },
      { t: 3, kind: 'goal_reset', key: `${tutorial.prefix}inspect_title` },
    ]);
    // Conditions are isolated here; full physical startup has its own regression suite.
    tutorial.conditions = () => TUTORIAL_STEPS.map(() => true);
    for (const hold of [5, 3, 2, 15, 120]) {
      const index = tutorial.index;
      const key = `${tutorial.prefix}${TUTORIAL_STEPS[index]}_title`;
      tick(1);
      const startedAt = e.state.t_sim;
      const snapshot = tutorial.snapshot();
      const count = markers.length;
      tutorial.restore(snapshot);
      assert.equal(markers.length, count);
      if (index >= 3) {
        tick(5);
        const laterHold = tutorial.snapshot();
        assert.equal(tutorial.held, 6);
        assert.equal(tutorial.inspectReady, false, 'five held seconds in a later step are not inspection readiness');
        assert.equal(tutorial.confirmInspect(), false);
        assert.deepEqual(tutorial.snapshot(), laterHold, 'confirmation cannot alter a later hold');
        assert.equal(markers.length, count);
        tick(hold - 6);
      } else tick(hold - 1);
      if (index === 0) {
        tick(2);
        assert.equal(tutorial.index, 0);
        assert.equal(tutorial.held, 5);
        assert.equal(tutorial.inspectReady, true);
        assert.equal(markers.length, count, 'ready and still waiting emits no goal_met');
        const pending = tutorial.snapshot();
        tutorial.restore(pending);
        assert.deepEqual(tutorial.snapshot(), pending);
        assert.equal(markers.length, count, 'restoring pending confirmation emits nothing');
        assert.equal(tutorial.confirmInspect(), true);
        assert.deepEqual(tutorial.completed, [{ id: 'inspect', t: e.state.t_sim }]);
        assert.equal(tutorial.confirmInspect(), false);
        assert.equal(markers.length, count + 1, 'confirmation emits exactly one goal_met');
      }
      assert.equal(tutorial.index, index + 1);
      assert.deepEqual(markers.slice(-2), [
        { t: startedAt, kind: 'goal_start', key },
        { t: e.state.t_sim, kind: 'goal_met', key },
      ]);
    }
    const count = markers.length;
    tick(1);
    tutorial.restore(tutorial.snapshot());
    assert.equal(tutorial.inspectReady, false);
    assert.equal(tutorial.confirmInspect(), false);
    assert.equal(markers.length, count);
    assert.equal(tutorial.done, true);
  });
}

test('journal and physical restore replay neither actions nor active alarm/SCRAM markers', () => {
  const source = makeEngine();
  source.state.t_sim = 10;
  record(source, 'scram');
  observeAlarms(source, [alarm]);
  noteEvent(source, 'ev_feedwater_loss');
  const target = makeEngine();
  const markers = capture(target);
  assert.equal(apply(JSON.parse(JSON.stringify(pack(source))), target), null);
  assert.deepEqual(markers, []);
  observeAlarms(target, [{ ...alarm, tile: 'ack' }]);
  target.scram('already restored');
  assert.deepEqual(markers, []);
  restoreJournal(target, learningReport(source));
  restoreJournal(target, null);
  assert.deepEqual(markers, []);
});
