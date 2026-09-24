import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ScenarioObjectives } from '../static/js/game/objectives.js';
import { Scenario } from '../static/js/game/scenario.js';
import { Session, PHASE } from '../static/js/game/session.js';
import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { pack, apply } from '../static/js/net/persist.js';

const DT = 0.05;
const plant = getPlant('pwr');
const definitions = await Promise.all(['pwr_feedwater_loss', 'pwr_sg_tube_leak', 'pwr_combined_faults']
  .map(async (id) => JSON.parse(await readFile(new URL(
    `../static/data/scenarios/${id}.json`, import.meta.url), 'utf8'))));
const json = (data) => JSON.parse(JSON.stringify(data));

function fixture(index = 0) {
  const scenario = new Scenario(definitions[index]);
  const state = { t_sim: 0, W_fw: 100, W_steam: 100, M_sg: 45000, L_sg: 0.5,
    pzr_L: 0.5, pzr_p: 158, p_sg: 64, W_core: 20000, T_cl: 600,
    P_th: 100, T_ci: 560, T_co: 580, destroyed: false, fault: null };
  const derived = { dnbr: 2, subcooling: 20 };
  const engine = { state, spec: plant.spec, ctx: { fwCtl: { auto: false } }, derive: () => derived };
  return { engine, scenario, derived, objectives: new ScenarioObjectives(engine, scenario) };
}

function tick(f, dt = DT) {
  f.engine.state.t_sim = Math.round((f.engine.state.t_sim + dt) * 1e8) / 1e8;
  f.scenario.due(f.engine.state.t_sim);
  f.objectives.step(dt);
}

function hold(f, seconds) {
  for (let n = 0; n < Math.round(seconds / DT); n++) tick(f);
}

function activate(f) {
  f.engine.state.t_sim = Math.max(...f.scenario.events.map((ev) => ev.t));
  f.scenario.due(f.engine.state.t_sim);
  f.objectives.step(DT);
}

test('public view is an array of current goals; early healthy state gives no credit', () => {
  const f = fixture();
  hold(f, 179.95);
  assert.deepEqual(f.objectives.view(), [
    { id: 'supply', type: 'pwr_feedwater', held: 0, required: 15, active: false, met: false, achievedAt: null },
    { id: 'stable', type: 'pwr_heat_removal', held: 0, required: 120, active: false, met: false, achievedAt: null },
  ]);
  assert.equal(f.objectives.done, false);
  tick(f); // Event fires after this tick's physics; these flows predate it.
  assert.ok(f.objectives.view().every((entry) => entry.held === 0 && !entry.active));
  f.objectives.step(DT); // No intervening physics.
  assert.ok(f.objectives.view().every((entry) => entry.held === 0));
  tick(f);
  assert.ok(f.objectives.view().every((entry) => entry.active && entry.held === DT));
});

test('combined goals require both events, not just the turbine trip', () => {
  const f = fixture(2);
  hold(f, 239.95);
  assert.equal(f.scenario.events[0].fired, true);
  assert.equal(f.scenario.events[1].fired, false);
  assert.ok(f.objectives.view().every((entry) => !entry.active && entry.held === 0));
  tick(f);
  assert.ok(f.objectives.view().every((entry) => entry.held === 0));
  tick(f);
  assert.ok(f.objectives.view().every((entry) => entry.held === DT));
});

test('119.95 seconds is not 120; completed holds remain capped and monitored', () => {
  const f = fixture();
  activate(f);
  hold(f, 119.95);
  assert.equal(f.objectives.view()[0].met, true);
  assert.equal(f.objectives.view()[1].met, false);
  assert.equal(f.objectives.view()[1].achievedAt, null);
  assert.equal(f.objectives.done, false);
  const edge = json(f.objectives.snapshot());
  f.objectives.restore(edge);
  f.objectives.step(DT);
  assert.deepEqual(f.objectives.snapshot(), edge, 'restore and a repeated tick cannot finish a hold');
  tick(f);
  assert.equal(f.objectives.done, true);
  const completed = f.objectives.view();
  hold(f, 400);
  assert.deepEqual(f.objectives.view(), completed);
  f.engine.state.W_fw = 0;
  tick(f);
  assert.equal(f.objectives.done, false);
  assert.ok(f.objectives.view().every((entry) => !entry.met && entry.held === 0));
  assert.deepEqual(f.objectives.view().map((entry) => entry.achievedAt), completed.map((entry) => entry.achievedAt));
  f.engine.state.W_fw = 100;
  hold(f, 120);
  assert.deepEqual(f.objectives.view(), completed, 'regaining goals preserves first achievement');
});

test('auto restoration alone gives no credit; actual manual supply is equally valid', () => {
  const f = fixture();
  activate(f);
  f.engine.ctx.fwCtl.auto = true;
  f.engine.state.W_fw = 0;
  hold(f, 20);
  assert.ok(f.objectives.view().every((entry) => entry.held === 0));
  f.engine.ctx.fwCtl.auto = false;
  f.engine.state.W_fw = 100;
  hold(f, 120);
  assert.equal(f.objectives.done, true);
});

test('interrupted holds restart from zero rather than accumulating safe fragments', () => {
  const f = fixture();
  activate(f);
  hold(f, 14.95);
  f.engine.state.M_sg = 35999;
  tick(f);
  assert.ok(f.objectives.view().every((entry) => entry.held === 0));
  f.engine.state.M_sg = 36000;
  hold(f, 14.95);
  assert.equal(f.objectives.view()[0].met, false);
  tick(f);
  assert.equal(f.objectives.view()[0].met, true);
});

test('heat removal requires mass balance including the ongoing SGTR leak', () => {
  const f = fixture(1);
  activate(f);
  f.engine.ctx.sgLeak = 8;
  f.engine.state.W_fw = 92;
  hold(f, 120);
  assert.equal(f.objectives.done, true);
  assert.equal(f.engine.ctx.sgLeak, 8, 'no objective repairs the leak');
  f.engine.state.W_fw = 103;
  tick(f);
  assert.equal(f.objectives.view()[0].met, true);
  assert.equal(f.objectives.view()[1].held, 0, '11 kg/s exceeds the 10 kg/s tolerance');
  f.engine.state.W_steam = 20;
  f.engine.state.W_fw = 17;
  hold(f, 120); // Difference of exactly 5 kg/s is allowed at low steam flow.
  assert.equal(f.objectives.done, true);
  f.engine.state.W_fw = 17.01;
  tick(f);
  assert.equal(f.objectives.view()[1].held, 0);
});

test('heat window resets on level span or warming, even after achievement', () => {
  const f = fixture();
  activate(f);
  hold(f, 120);
  f.engine.state.L_sg = 0.52;
  tick(f);
  assert.equal(f.objectives.done, true);
  f.engine.state.L_sg = 0.5201;
  tick(f);
  assert.equal(f.objectives.view()[1].held, 0);
  assert.equal(f.objectives.view()[0].met, true);
  hold(f, 120);
  f.engine.state.T_ci += 1;
  f.engine.state.T_co += 1;
  tick(f);
  assert.equal(f.objectives.done, true);
  f.engine.state.T_ci += 0.01;
  tick(f);
  assert.equal(f.objectives.view()[1].held, 0);
  hold(f, 120);
  assert.equal(f.objectives.done, true, 'a fresh stable window can qualify');
});

test('power goal uses actual thermal power and intact state, not a SCRAM flag', () => {
  const f = fixture(1);
  activate(f);
  f.engine.state.scram = { active: true };
  f.engine.state.P_th = 0.1 * plant.spec.P0_th + 0.01;
  hold(f, 120);
  assert.ok(f.objectives.view().every((entry) => entry.held === 0));
  f.engine.state.scram.active = false;
  f.engine.state.P_th = 0.1 * plant.spec.P0_th;
  hold(f, 15);
  assert.equal(f.objectives.view()[0].met, true);
  f.engine.state.pzr_L = 0.169;
  tick(f);
  assert.ok(f.objectives.view().every((entry) => entry.held === 0));
});

test('all safety thresholds and finite inputs are enforced', () => {
  const violations = { W_fw: 1, W_steam: 1, M_sg: 35999, L_sg: 0.3999,
    pzr_L: 0.1699, pzr_p: 139.99, p_sg: 84, W_core: 17999, T_cl: 700,
    P_th: -1, T_ci: NaN, T_co: Infinity };
  for (const [field, value] of Object.entries(violations)) {
    const f = fixture();
    activate(f);
    hold(f, 120);
    f.engine.state[field] = value;
    tick(f);
    assert.equal(f.objectives.done, false, field);
    assert.ok(f.objectives.view().every((entry) => entry.held === 0), field);
  }
  for (const field of Object.keys(violations)) {
    for (const value of [NaN, Infinity, undefined]) {
      const f = fixture();
      activate(f);
      f.engine.state[field] = value;
      tick(f);
      assert.ok(f.objectives.view().every((entry) => entry.held === 0), `${field}: ${value}`);
    }
  }
  for (const [field, value] of [['dnbr', 1.2999], ['subcooling', 9.999], ['dnbr', NaN], ['subcooling', Infinity]]) {
    const f = fixture();
    activate(f);
    f.derived[field] = value;
    tick(f);
    assert.ok(f.objectives.view().every((entry) => entry.held === 0), field);
  }
  for (const patch of [{ pzr_p: 164.01 }, { L_sg: 0.6001 }, { destroyed: true }, { fault: 'bad' }]) {
    const f = fixture();
    activate(f);
    Object.assign(f.engine.state, patch);
    tick(f);
    assert.ok(f.objectives.view().every((entry) => entry.held === 0));
  }
  const f = fixture();
  activate(f);
  Object.assign(f.engine.state, { M_sg: 36000, L_sg: 0.4, pzr_L: 0.17, pzr_p: 140, W_core: 18000 });
  Object.assign(f.derived, { dnbr: 1.3, subcooling: 10 });
  hold(f, 120);
  assert.equal(f.objectives.done, true, 'inclusive lower limits');
});

test('non-finite leak cannot qualify heat removal', () => {
  for (const leak of [NaN, Infinity, null, -1]) {
    const f = fixture(1);
    activate(f);
    f.engine.ctx.sgLeak = leak;
    hold(f, 120);
    assert.equal(f.objectives.view()[1].held, 0);
  }
});

test('snapshot is detached, versioned, scenario-bound and preserves an interrupted hold', () => {
  const live = fixture();
  activate(live);
  hold(live, 60);
  live.engine.state.L_sg = 0.51;
  tick(live);
  const snapshot = json(live.objectives.snapshot());
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.scenario, definitions[0].id);
  assert.equal(snapshot.state.length, 2);
  const restored = fixture();
  Object.assign(restored.engine.state, live.engine.state);
  // Persistence restores physics before the caller catches up scheduled events.
  restored.objectives.restore(snapshot);
  restored.scenario.catchUp(restored.engine.state.t_sim);
  assert.deepEqual(restored.objectives.snapshot(), snapshot);
  snapshot.state[1].held = 0;
  assert.notEqual(restored.objectives.view()[1].held, 0);
  for (let n = 0; n < 8000; n++) {
    tick(live);
    tick(restored);
    assert.deepEqual(restored.objectives.view(), live.objectives.view());
  }
  const capped = json(live.objectives.snapshot());
  restored.objectives.restore(capped);
  assert.deepEqual(restored.objectives.snapshot(), capped, 'capped held is not equal to elapsed time');
});

test('bad snapshot blocks reset every goal, including malformed times and window bounds', () => {
  const f = fixture();
  activate(f);
  hold(f, 200);
  const valid = json(f.objectives.snapshot());
  const corruptions = [
    (d) => { d.version = 2; }, (d) => { d.scenario = definitions[2].id; },
    (d) => { d.state.pop(); }, (d) => { d.state.push(d.state[0]); },
    (d) => { d.state[1].id = 'unknown'; }, (d) => { d.state[1].id = 'supply'; },
    (d) => { d.state[1] = null; }, (d) => { d.state[1].held = 121; },
    (d) => { delete d.state[1]; },
    (d) => { d.state[1].held = -1; }, (d) => { d.state[1].held = NaN; },
    (d) => { d.state[1].activatedAt = 179; }, (d) => { d.state[1].activatedAt = null; },
    (d) => { d.state[1].startedAt = 100; }, (d) => { d.state[1].startedAt = 379; },
    (d) => { d.state[1].achievedAt = 299; }, (d) => { d.state[1].achievedAt = 381; },
    (d) => { d.state[1].achievedAt = null; }, (d) => { d.state[1].levelMin = 0.3; },
    (d) => { d.state[1].levelMax = 0.7; }, (d) => { d.state[1].levelMin = 0.51; },
    (d) => { d.state[1].levelMax = 0.49; }, (d) => { d.state[1].levelMax = 0.53; },
    (d) => { d.state[1].tempBaseline = Infinity; }, (d) => { d.state[1].tempBaseline = 1000; },
    (d) => { d.state[1].tempBaseline = 568; }, (d) => { delete d.state[1].startedAt; },
    (d) => { d.state[0].levelMin = 0.5; },
  ];
  for (const corrupt of corruptions) {
    const data = structuredClone(valid);
    corrupt(data);
    f.objectives.restore(valid);
    assert.equal(f.objectives.done, true);
    f.objectives.restore(data);
    assert.ok(f.objectives.view().every((entry) => entry.held === 0 && entry.achievedAt === null), String(corrupt));
  }
});

test('restore validates current physics and missing old data starts with zero progress', () => {
  const f = fixture();
  activate(f);
  hold(f, 120);
  const data = json(f.objectives.snapshot());
  f.engine.state.W_fw = 0;
  f.objectives.restore(data);
  assert.ok(f.objectives.view().every((entry) => entry.held === 0 && entry.achievedAt === null));
  f.engine.state.W_fw = 100;
  f.objectives.restore(data);
  assert.equal(f.objectives.done, true);
  for (const missing of [undefined, null, {}]) {
    f.objectives.restore(missing);
    assert.ok(f.objectives.view().every((entry) => entry.held === 0 && !entry.active));
  }
  tick(f);
  assert.ok(f.objectives.view().every((entry) => entry.held === 0));
  tick(f);
  assert.ok(f.objectives.view().every((entry) => entry.held === DT));
});

test('restore preserves revoked achievements without claiming current success', () => {
  const f = fixture();
  activate(f);
  hold(f, 120);
  f.engine.state.W_fw = 0;
  tick(f);
  const data = json(f.objectives.snapshot());
  f.objectives.restore(data);
  assert.deepEqual(f.objectives.snapshot(), data);
  assert.equal(f.objectives.done, false);
  assert.ok(f.objectives.view().every((entry) => entry.achievedAt !== null && !entry.met));
});

test('legacy and free sessions have no objectives or incident summary fields', () => {
  for (const def of [null, { ...definitions[0], score_mode: undefined, objectives: undefined }]) {
    const engine = createEngine(plant);
    const session = new Session(engine, def);
    assert.equal(session.objectives, null);
    session.start();
    session._finish(true, null);
    if (def) {
      assert.equal('score_mode' in session.result.summary, false);
      assert.equal('objectives' in session.result.summary, false);
      assert.equal('objectives' in session.result, false);
    }
  }
});

test('session checks goals after events but fails take precedence over success at duration', () => {
  const engine = createEngine(plant);
  const def = { ...definitions[0], duration_s: 1, events: [{ t: DT, id: 'feedwater_loss' }] };
  const session = new Session(engine, def);
  session.start();
  engine.step(DT);
  session.step(DT, [], 0);
  assert.ok(session.objectives.view().every((entry) => entry.held === 0));
  assert.equal(engine.ctx.fwCtl.auto, false);
  engine.state.t_sim = 1;
  engine.state.destroyed = true;
  // Both paths would finish; the physical failure must win even if goals report done.
  session.objectives.step = () => {};
  Object.defineProperty(session.objectives, 'done', { get: () => true });
  session.step(DT, [], 0);
  assert.equal(session.result.summary.failed, 'fail_fuel_damage');
  assert.equal(session.result.summary.completed, false);
});

test('session waits for original duration, requiring goals still met on the final tick', () => {
  for (const lose of [false, true]) {
    const f = fixture();
    const engine = createEngine(plant);
    const def = { ...definitions[0], duration_s: 301 };
    const session = new Session(engine, def);
    session.start();
    activate(f);
    hold(f, 120);
    session.objectives = f.objectives;
    engine.state.t_sim = 300;
    session.scenario.catchUp(300);
    session.step(DT, [], 0);
    assert.equal(session.phase, PHASE.RUNNING, 'no early success');
    engine.state.t_sim = 301;
    f.engine.state.t_sim = 301;
    if (lose) f.engine.state.W_fw = 0;
    session.step(DT, [], 0);
    assert.equal(session.phase, PHASE.DEBRIEF);
    assert.equal(session.result.summary.completed, !lose);
    assert.equal(session.result.summary.failed, lose ? 'fail_objectives_unmet' : null);
    assert.equal(session.result.summary.score_mode, 'incident_v1');
    assert.deepEqual(session.result.summary.objectives, f.objectives.view().map(({ id, met }) => ({ id, met })));
    assert.deepEqual(session.result.objectives, f.objectives.view());
  }
});

test('pack/apply restores objective state after physics; old session blocks grant no progress', () => {
  const def = definitions[0];
  const source = createEngine(plant);
  const session = new Session(source, def);
  session.start();
  const f = fixture();
  activate(f);
  hold(f, 60);
  Object.assign(source.state, f.engine.state);
  session.objectives.restore(f.objectives.snapshot());
  assert.ok(session.objectives.view()[1].held > 0);
  const blob = json(pack(source, def.id, session.run, session));
  for (const old of [false, true, 'no-session']) {
    const target = createEngine(plant);
    const restored = new Session(target, def);
    restored.start();
    const data = json(blob);
    if (old === true) data.session = {};
    if (old === 'no-session') delete data.session;
    assert.equal(apply(data, target, restored.run, restored), null);
    if (!old) assert.deepEqual(restored.objectives.snapshot(), session.objectives.snapshot());
    else assert.ok(restored.objectives.view().every((entry) => entry.held === 0 && entry.achievedAt === null));
  }
  session.restore({});
  assert.ok(session.objectives.view().every((entry) => entry.held === 0));
});
