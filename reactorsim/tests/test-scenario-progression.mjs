import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { Session, PHASE } from '../static/js/game/session.js';
import { gridDeviationTrips } from '../static/js/game/scenario.js';
import { getEvent, stepEvents } from '../static/js/game/events.js';
import { record } from '../static/js/game/coreActions.js';
import { attachRecorder } from '../static/js/game/recorder.js';
import { replayRun } from '../static/js/game/replay.js';
import { pack, apply } from '../static/js/net/persist.js';

const DT = 0.05;
const plant = getPlant('pwr');
const ids = ['pwr_feedwater_loss', 'pwr_sg_tube_leak', 'pwr_combined_faults'];
const definitions = await Promise.all(ids.map(async (id) => JSON.parse(await readFile(
  new URL(`../static/data/scenarios/${id}.json`, import.meta.url), 'utf8'))));
const locales = await Promise.all(['de', 'en'].map(async (lang) => JSON.parse(await readFile(
  new URL(`../locales/${lang}.json`, import.meta.url), 'utf8'))));
const json = (value) => JSON.parse(JSON.stringify(value));

// Deliberate human-scale delays, not a helper or direct state repairs.
const actions = {
  pwr_feedwater_loss: [[190, 'ack'], [191, 'scram'], [195, 'fw_auto', true], [240, 'ack']],
  pwr_sg_tube_leak: [[235, 'ack'], [240, 'scram'], [270, 'ack']],
  pwr_combined_faults: [[190, 'ack'], [210, 'scram'], [250, 'ack'], [255, 'fw_auto', true], [300, 'ack']],
};

function boot(def) {
  const engine = createEngine(plant, { seed: def.seed, extraTrips: gridDeviationTrips(def) });
  attachRecorder(engine);
  const session = new Session(engine, def);
  session.start();
  return { engine, session };
}

function drive(def, plan = [], saveAt = null) {
  const live = boot(def);
  let restored = null;
  const metrics = { minSg: 1, minPzr: 1, maxPrimary: 0, minMass: Infinity };
  let n = 0;
  while (live.session.phase === PHASE.RUNNING) {
    assert.ok(n < Math.ceil(def.duration_s / DT) + 2, 'session must terminate');
    n++;
    for (const run of [live, restored].filter(Boolean)) {
      const { engine, session } = run;
      engine.step(DT);
      session.step(DT, engine.trips.tiles(), engine.trips.unacknowledgedSeconds());
      for (const [time, id, value] of plan) {
        if (n === Math.round(time / DT)) record(engine, id, value);
      }
      assert.equal(engine.state.fault, null);
      for (const key of ['L_sg', 'M_sg', 'pzr_L', 'pzr_p', 'p_sg', 'P_th', 'T_cl']) {
        assert.ok(Number.isFinite(engine.state[key]), `${def.id}: non-finite ${key}`);
      }
    }
    const s = live.engine.state;
    metrics.minSg = Math.min(metrics.minSg, s.L_sg);
    metrics.minPzr = Math.min(metrics.minPzr, s.pzr_L);
    metrics.maxPrimary = Math.max(metrics.maxPrimary, s.pzr_p);
    metrics.minMass = Math.min(metrics.minMass, s.M_sg);
    if (restored) {
      assert.deepEqual(restored.engine.state, s, `restored physics at step ${n}`);
      assert.equal(restored.session.phase, live.session.phase);
      assert.deepEqual(restored.session.objectives.view(), live.session.objectives.view());
    }
    if (saveAt !== null && n === Math.round(saveAt / DT)) {
      const blob = json(pack(live.engine, def.id, live.session.run, live.session));
      assert.equal(blob.scenario, def.id);
      restored = boot(def);
      assert.equal(apply(blob, restored.engine, restored.session.run, restored.session), null);
      restored.session.scenario.catchUp(restored.engine.state.t_sim);
      assert.deepEqual(restored.session.scenario.events.map((ev) => ev.fired),
        live.session.scenario.events.map((ev) => ev.fired));
      assert.deepEqual(restored.engine.ctx.fwCtl.snapshot(), live.engine.ctx.fwCtl.snapshot());
      assert.equal(restored.engine.ctx.sgLeak, live.engine.ctx.sgLeak);
    }
  }
  if (saveAt !== null) {
    assert.ok(restored, 'save point reached');
    assert.deepEqual(restored.session.result.summary, live.session.result.summary);
    // JSON saves omit undefined action values in the learning journal.
    assert.deepEqual(json(restored.session.result), json(live.session.result));
    assert.deepEqual(json(pack(restored.engine, def.id, restored.session.run, restored.session)),
      json(pack(live.engine, def.id, live.session.run, live.session)));
  }
  return { ...live, metrics, log: live.engine.recorder.serialize() };
}

test('progression definitions have separate identities and translated guidance contracts', () => {
  const uiKeys = ['scn_guidance_title', 'scn_level_1', 'scn_level_2', 'scn_level_3',
    'scn_alerts_on', 'scn_alerts_off', 'scn_helper_on', 'scn_helper_off', 'scn_guidance_open'];
  assert.equal(new Set(definitions.map((def) => def.id)).size, 3);
  assert.deepEqual(Object.keys(locales[0]).sort(), Object.keys(locales[1]).sort());
  for (const [i, def] of definitions.entries()) {
    assert.equal(def.id, ids[i]);
    assert.equal(def.reactor, 'pwr');
    assert.equal(def.score_mode, 'incident_v1');
    assert.deepEqual(def.objectives, [
      { id: i === 1 ? 'power' : 'supply', type: i === 1 ? 'pwr_power_limited' : 'pwr_feedwater',
        after_events: def.events.map((ev) => ev.id), hold_s: 15, ...(i === 1 ? { max_power_fraction: 0.1 } : {}) },
      { id: 'stable', type: 'pwr_heat_removal', after_events: def.events.map((ev) => ev.id),
        hold_s: 120, ...(i === 1 ? { max_power_fraction: 0.1 } : {}) },
    ]);
    assert.equal(def.difficulty, i + 1);
    assert.deepEqual(def.guidance, { hint_key: `scn_${def.id}_hint`,
      event_alerts: i === 0, auto_helper: i === 0 });
    assert.ok(def.duration_s >= 900 && def.duration_s <= 1200);
    assert.deepEqual(def.events.map((ev) => ev.id), i === 0 ? ['feedwater_loss']
      : i === 1 ? ['sg_tube_leak'] : ['turbine_trip', 'feedwater_loss']);
    for (const ev of def.events) {
      assert.ok(getEvent(ev.id));
      assert.ok(ev.t > 0 && ev.t < def.duration_s);
    }
    for (const locale of locales) {
      for (const key of [...uiKeys, def.title_key, def.brief_key, def.guidance.hint_key]) {
        assert.equal(typeof locale[key], 'string', key);
        assert.ok(locale[key].trim().length > 0, key);
      }
    }
  }
  assert.equal(definitions[1].events[0].args.kgs, 8, 'balanced leak rate, not an unchecked default');
});

test('feedwater event is recoverable control loss, not a permanently failed pump', () => {
  const { engine } = boot(definitions[0]);
  getEvent('feedwater_loss').apply(engine);
  assert.equal(engine.ctx.fwCtl.auto, false);
  assert.equal(engine.ctx.fwCtl.manual, 0);
  record(engine, 'fw_auto', true);
  stepEvents(engine, DT);
  assert.equal(engine.ctx.fwCtl.auto, true);
  assert.equal(engine.ctx.pumpsStuck, undefined);
});

test('tube leak only adds secondary mass and subtracts pressuriser level per event step', () => {
  const { engine } = boot(definitions[1]);
  getEvent('sg_tube_leak').apply(engine, definitions[1].events[0].args);
  const before = structuredClone(engine.state);
  stepEvents(engine, DT);
  before.M_sg += 8 * DT;
  before.pzr_L -= 8 * 1.2e-5 * DT;
  assert.deepEqual(engine.state, before);
  record(engine, 'scram');
  assert.equal(engine.ctx.sgLeak, 8, 'shutdown does not repair the leak');
});

for (const def of definitions) {
  test(`${def.id}: non-intervention versus recorded operation, save/restore and replay`, (t) => {
    // Save after the first fault, before intervention; in the combined case
    // the second fault must still fire normally on both continuation paths.
    const idle = drive(def, [], 185);
    const operated = drive(def, actions[def.id], 185);
    const savedAfterActions = drive(def, actions[def.id], 300);
    assert.deepEqual(savedAfterActions.session.result, operated.session.result);
    const savedAfterAchievement = drive(def, actions[def.id], 600);
    assert.deepEqual(savedAfterAchievement.session.result, operated.session.result);
    assert.equal(operated.session.result.summary.completed, true);
    assert.equal(operated.session.result.summary.failed, null);
    assert.equal(operated.engine.state.destroyed, false);
    assert.equal(operated.session.result.summary.scenario, def.id);
    assert.equal(operated.session.result.summary.difficulty, def.difficulty);
    assert.equal(operated.session.result.summary.score_mode, 'incident_v1');
    assert.deepEqual(operated.session.result.summary.objectives,
      def.objectives.map(({ id }) => ({ id, met: true })));
    assert.deepEqual(operated.session.result.objectives, operated.session.objectives.view());
    assert.ok(Math.abs(operated.engine.state.t_sim - def.duration_s) <= DT + 1e-6);
    assert.ok(operated.metrics.maxPrimary < plant.spec.pressurizer.safety);
    assert.ok(operated.metrics.minMass > 0);
    assert.deepEqual(operated.log.map(({ id }) => id), actions[def.id].map((a) => a[1]));
    assert.deepEqual(replayRun(plant, def, idle.log), idle.session.result.summary);
    assert.deepEqual(replayRun(plant, def, operated.log), operated.session.result.summary);
    if (def.id === 'pwr_sg_tube_leak') {
      assert.equal(idle.session.result.summary.completed, false);
      assert.equal(idle.session.result.summary.failed, 'fail_objectives_unmet');
      assert.equal(idle.session.result.summary.scram_count, 0);
      assert.equal(operated.engine.ctx.sgLeak, 8);
      assert.ok(operated.engine.state.P_th < idle.engine.state.P_th * 0.03);
      assert.ok(operated.metrics.minPzr > 0.17);
      assert.ok(operated.engine.state.pzr_L < idle.engine.state.pzr_L,
        'cooldown contraction plus ongoing leak lowers level even after shutdown');
    } else {
      assert.equal(idle.session.result.summary.completed, false);
      assert.equal(idle.session.result.summary.failed, 'fail_trip_ignored');
      assert.ok(operated.session.result.summary.violation_seconds[3]
        < idle.session.result.summary.violation_seconds[3]);
      assert.equal(operated.engine.ctx.fwCtl.auto, true);
      assert.ok(Math.abs(operated.engine.state.L_sg - 0.5) < 0.01);
      assert.ok(operated.metrics.minPzr > 0.24);
      if (def.difficulty === 3) {
        assert.ok(operated.metrics.minSg > 0.35);
        assert.ok(operated.metrics.maxPrimary < 162);
      }
    }
    t.diagnostic(JSON.stringify({ id: def.id, idle: idle.session.result.summary,
      operated: operated.session.result.summary, limits: operated.metrics,
      finalPzr: operated.engine.state.pzr_L, objectives: operated.session.result.objectives }));
  });
}

test('guided control restoration within two seconds avoids the low-level trip', () => {
  const run = drive(definitions[0], [[182, 'fw_auto', true]]);
  assert.equal(run.session.result.summary.completed, true);
  assert.equal(run.session.result.summary.scram_count, 0);
  assert.equal(run.session.result.summary.violation_seconds[3], 0);
  assert.ok(run.metrics.minSg > 0.25);
});

test('guided three-second response already crosses low level but can still recover', () => {
  const run = drive(definitions[0], [[183, 'fw_auto', true], [210, 'ack']]);
  assert.equal(run.session.result.summary.completed, true);
  assert.equal(run.engine.state.destroyed, false);
  assert.ok(run.metrics.minSg < 0.25);
  assert.ok(run.session.result.summary.violation_seconds[3] > 0);
  assert.ok(Math.abs(run.engine.state.L_sg - 0.5) < 0.01);
});

for (const def of [definitions[0], definitions[2]]) {
  test(`${def.id}: SCRAM without restoring feedwater cannot complete the goals`, () => {
    const plan = actions[def.id].filter((action) => action[1] !== 'fw_auto');
    const run = drive(def, plan);
    assert.equal(run.session.result.summary.completed, false);
    assert.equal(run.session.result.summary.scram_count, 1);
    assert.ok(run.session.result.summary.objectives.every((entry) => !entry.met));
    assert.ok(['fail_objectives_unmet', 'fail_fuel_damage'].includes(run.session.result.summary.failed));
  });
}
