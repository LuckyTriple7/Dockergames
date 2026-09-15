import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { equilibriumPoisons } from '../static/js/sim/poisons.js';
import { Session, PHASE } from '../static/js/game/session.js';
import { record } from '../static/js/game/coreActions.js';
import { pack, apply } from '../static/js/net/persist.js';
import { StartupTutorial, TUTORIAL_STEPS } from '../static/js/game/tutorial.js';
import { BwrStartupTutorial, BWR_STARTUP_TUTORIAL } from '../static/js/game/bwrTutorial.js';

const def = JSON.parse(readFileSync(new URL('../static/data/scenarios/bwr_startup_tutorial.json', import.meta.url)));
const json = value => JSON.parse(JSON.stringify(value));
function start(cold = true) {
  const engine = createEngine(getPlant('bwr'), { cold, n: cold ? 1e-6 : 1, seed: def.seed });
  const session = new Session(engine, def);
  session.start();
  return { engine, session };
}
function tick({ engine, session }) {
  engine.step(0.05);
  const tiles = engine.trips.tiles();
  assert.ok(!tiles.some(t => t.tile === 'new' || t.tile === 'ack'), JSON.stringify(tiles));
  assert.equal(engine.state.scram.active, false);
  assert.equal(engine.state.destroyed, false);
  assert.equal(engine.state.fault, null);
  assert.equal(engine.ctx.rodCtl.auto, false);
  session.step(0.05, tiles, engine.trips.unacknowledgedSeconds());
}
// Only ordinary controls, with one small jog every two seconds after travel.
function operate({ engine: e, session }, i) {
  const { state: s, ctx: c } = e;
  if (session.tutorial.inspectReady) assert.equal(session.tutorial.confirmInspect(), true);
  const stage = session.tutorial.index;
  if (stage === 1 && !c.recircPump.running) record(e, 'pump_toggle', 0);
  if (stage >= 2 && !c.govCtl.auto) record(e, 'gov_auto', true);
  if (stage >= 2 && i % 40 === 0 && Math.abs(s.rodDmd[0] - s.rod[0]) < 0.001) {
    const target = Math.max(-30, Math.min(80, (0.225 - s.n) * 1500));
    const rho = e.derive().rho_pcm;
    if (rho < target - 10) record(e, 'rod_jog', -1);
    else if (rho > target + 10) record(e, 'rod_jog', 1);
  }
}

test('BWR scenario prepares a hot subcritical plant without changing model coefficients or another engine', () => {
  assert.equal(def.id, 'bwr_startup_tutorial');
  assert.equal(def.reactor, 'bwr');
  assert.equal(def.tutorial, BWR_STARTUP_TUTORIAL);
  assert.equal(BWR_STARTUP_TUTORIAL, 'bwr_startup');
  assert.equal(def.seed, 920);
  assert.equal(def.duration_s, 3600);
  assert.equal(def.cold, true);
  const other = createEngine(getPlant('bwr'));
  const before = json(pack(other));
  const coefficients = json(other.spec);
  const { engine: e, session } = start();
  const { state: s, ctx: c } = e;
  assert.ok(session.tutorial instanceof BwrStartupTutorial);
  assert.ok(session.tutorial instanceof StartupTutorial);
  assert.equal(session.tutorial.prefix, 'tut_bwr_');
  assert.deepEqual(session.tutorial.snapshot(), { reactor: 'bwr', index: 0, held: 0, elapsed: 0, completed: [] });
  for (const [key, value] of Object.entries(equilibriumPoisons(0.2))) assert.equal(s[key], value, key);
  assert.ok(Math.abs(e.derive().rho_pcm + 500) < 0.01);
  assert.equal(s.rod[0], 1);
  assert.equal(s.rodDmd[0], 1);
  assert.ok(s.rod[1] > 0 && s.rod[1] < 1);
  assert.equal(s.rod[1], s.rodDmd[1]);
  for (const key of ['alphaBar', 'x_e', 'gov', 'W_fw', 'W_steam', 'P_e', 'P_demand']) assert.equal(s[key], 0, key);
  assert.equal(c.voidLag.v, 0);
  assert.equal(c.recircPump.running, false);
  assert.equal(c.recircPump.speed, 0);
  assert.equal(s.W_rec, 0.12 * 13000);
  assert.equal(s.W_core, s.W_rec);
  assert.equal(c.rodCtl.auto, false);
  assert.equal(c.govCtl.auto, false);
  assert.equal(c.govCtl.manual, 0);
  assert.deepEqual(c.govCtl.pi.snapshot(), { i: 0, out: 0 });
  assert.equal(c.govValve.pos, 0);
  assert.equal(c.govValve.demand, 0);
  assert.equal(c.fwCtl.auto, true);
  assert.equal(c.fwCtl.rate.v, 0);
  assert.deepEqual(c.fwCtl.pi.snapshot(), { i: 0, out: 0 });
  assert.equal(session.tutorial.conditions()[0], true);
  for (const key of ['UA_fc', 'UA_cc', 'C_f', 'C_cl', 'C_cool']) assert.equal(c[key], other.ctx[key], key);
  assert.deepEqual(json(e.spec), coefficients);
  assert.deepEqual(json(getPlant('bwr').spec), coefficients);
  assert.deepEqual(json(pack(other)), before);
  assert.deepEqual(json(pack(createEngine(getPlant('bwr')))), before);
});

for (const delay of [0, 300]) {
  test(delay ? 'BWR normal controls complete after 300s idle without unsolicited power or inspection'
    : 'BWR normal controls complete; partial stability save continues identically', () => {
    const run = start();
    const shutdown = run.engine.state.rod[1];
    const coefficients = json(run.engine.spec);
    let restored;
    for (let i = 0; i < delay * 20; i++) {
      tick(run);
      assert.equal(run.session.tutorial.index, 0, 'idle never confirms inspection');
      assert.ok(run.engine.state.n < 0.001, 'no unsolicited power excursion');
      assert.ok(run.engine.derive().rho_pcm < 0);
      assert.equal(run.engine.state.P_e, 0);
      assert.equal(run.engine.state.P_demand, 0);
      assert.equal(run.engine.state.rod[0], 1);
      assert.equal(run.engine.state.rod[1], shutdown);
    }
    if (delay) {
      assert.equal(run.session.tutorial.inspectReady, true);
      assert.equal(run.session.tutorial.held, 5);
      assert.deepEqual(run.session.tutorial.completed, []);
    }
    for (let i = delay * 20; i < 72000 && run.session.phase === PHASE.RUNNING; i++) {
      operate(run, i); tick(run);
      assert.equal(run.engine.state.rod[1], shutdown);
      assert.equal(run.engine.state.rodDmd[1], shutdown);
      if (restored) {
        operate(restored, i); tick(restored);
        assert.deepEqual(restored.session.tutorial.snapshot(), run.session.tutorial.snapshot());
      }
      if (!delay && !restored && run.session.tutorial.index === 4 && run.session.tutorial.held >= 10) {
        const save = json(pack(run.engine, def.id, run.session.run, run.session));
        restored = start(false);
        assert.equal(apply(save, restored.engine, restored.session.run, restored.session), null);
        assert.deepEqual(restored.session.tutorial.snapshot(), run.session.tutorial.snapshot());
      }
    }
    assert.equal(run.session.result?.summary.completed, true, JSON.stringify(run.session.tutorial.view()));
    assert.equal(run.session.result.score, null);
    assert.equal(run.session.result.tutorial.reactor, 'bwr');
    assert.deepEqual(run.session.tutorial.completed.map(e => e.id), TUTORIAL_STEPS);
    assert.ok(run.engine.state.P_e >= 280 && run.engine.state.P_e <= 320);
    assert.ok(run.engine.state.t_sim < 3600);
    assert.deepEqual(json(run.engine.spec), coefficients);
    if (!delay) {
      assert.ok(restored, 'must reach and save a partial stable hold');
      assert.deepEqual(restored.session.result, run.session.result);
      assert.deepEqual(pack(restored.engine).state, pack(run.engine).state);
      assert.deepEqual(pack(restored.engine).components, pack(run.engine).components);
      assert.deepEqual(restored.engine.ctx.rng.snapshot(), run.engine.ctx.rng.snapshot());
    }
  });
}

test('BWR pump commands need actual speed and flow; interruption restarts the three-second hold', () => {
  const run = start();
  for (let i = 0; i < 100; i++) tick(run);
  const tut = run.session.tutorial;
  assert.equal(tut.confirmInspect(), true);
  record(run.engine, 'pump_toggle', 0);
  tick(run);
  assert.equal(tut.index, 1);
  assert.equal(tut.held, 0);
  for (let i = 0; i < 1000 && tut.held === 0; i++) tick(run);
  assert.ok(tut.held > 0 && tut.held < 3);
  record(run.engine, 'pump_toggle', 0);
  tick(run);
  assert.equal(tut.held, 0);
  assert.equal(tut.index, 1);
  record(run.engine, 'pump_toggle', 0);
  for (let i = 0; i < 1000 && tut.index === 1; i++) tick(run);
  assert.equal(tut.index, 2);
});

test('BWR objective thresholds reject unsafe readings and reset a partial hold', () => {
  const { engine: e, session } = start();
  const { state: s, ctx: c } = e;
  const tut = session.tutorial;
  // Isolated predicate tests, not the physical operating path above.
  const d = { ...e.derive(), rho_pcm: -1, T_avg: 553.15, period: 60, decayRatio: 0.8, dnbr: 1.3 };
  e.derive = () => d;
  for (const [object, key, values] of [
    [s, 'p_dome', [66.99, 73.01]], [s, 'L_rpv', [0.3499, 0.6501]],
    [s, 'n', [0.001]], [d, 'rho_pcm', [0]], [d, 'T_avg', [543.14, 568.16]],
    [s, 'acPower', [false]], [s, 'dcPower', [false]], [s, 'destroyed', [true]],
    [s, 'fault', ['test']], [s.scram, 'active', [true]],
  ]) {
    const original = object[key];
    for (const value of values) {
      object[key] = value;
      assert.equal(tut.conditions()[0], false, `${key}=${value}`);
    }
    object[key] = original;
  }
  for (const [p, level, temperature] of [[67, 0.35, 543.15], [73, 0.65, 568.15]]) {
    s.p_dome = p; s.L_rpv = level; d.T_avg = temperature;
    assert.equal(tut.conditions()[0], true, 'inspection includes its endpoints');
  }
  s.p_dome = 70; s.L_rpv = 0.5; s.n = 0.225;
  s.P_e = 300; s.P_th = 0.225 * e.spec.P0_th; s.W_core = 11000;
  c.recircPump.start(); c.recircPump.speed = 0.9; c.govCtl.auto = true;
  assert.deepEqual(tut.conditions().slice(1), [true, true, true, true]);
  for (const [object, key, value, index] of [
    [c.recircPump, 'speed', 0.8999, 1], [s, 'W_core', 10999, 1],
    [s, 'n', 0.1999, 2], [s, 'n', 0.2501, 2], [s, 'p_dome', 73.01, 2],
    [s, 'L_rpv', 0.3499, 2], [c.govCtl, 'auto', false, 2], [c.fwCtl, 'auto', false, 2],
    [s, 'msiv', 0.9899, 2], [s, 'breaker', false, 2], [s, 'turbineTripped', true, 2],
    [d, 'decayRatio', 0.8001, 2], [d, 'period', 19.99, 2],
    [s, 'P_e', 279.99, 3], [s, 'P_e', 320.01, 3],
    [s, 'P_th', 0.1999 * e.spec.P0_th, 3], [s, 'P_th', 0.2501 * e.spec.P0_th, 3],
    [d, 'dnbr', 1.2999, 3], [d, 'rho_pcm', -30.01, 4], [d, 'rho_pcm', 30.01, 4],
    [d, 'period', 59.99, 4], [s, 'acPower', false, 4], [s, 'dcPower', false, 4],
  ]) {
    const original = object[key];
    object[key] = value;
    tut.index = index; tut.held = 1;
    assert.equal(tut.conditions()[index], false, `${key}=${value}, step ${index}`);
    tut.step(0.05);
    assert.equal(tut.held, 0, `${key}: invalid conditions reset hold`);
    object[key] = original;
    assert.equal(tut.conditions()[index], true, `${key}: restored condition qualifies`);
  }
  for (const [n, pe, period, rho] of [[0.2, 280, 60, -30], [0.25, 320, -10, 30]]) {
    s.n = n; s.P_th = n * e.spec.P0_th; s.P_e = pe; s.msiv = 0.99;
    d.period = period; d.rho_pcm = rho;
    assert.equal(tut.conditions()[4], true, 'inclusive limits and falling power qualify');
  }
  d.period = 20;
  assert.equal(tut.conditions()[2], true);
  assert.equal(tut.conditions()[4], false);
});

test('BWR demand and live view use reactor readings and a clamped dynamic reactivity target', () => {
  const { engine: e, session } = start();
  const tut = session.tutorial;
  for (let index = 0; index < 5; index++) {
    tut.index = index;
    assert.equal(tut.demand, index >= 2 ? 300 : 0);
    session.step(0, [], 0);
    assert.equal(e.state.P_demand, tut.demand);
  }
  e.state.p_prim = 155; // Must not accidentally read the PWR alias.
  e.state.p_dome = 69; e.state.L_rpv = 0.47;
  e.state.recircDmd = 0.93; e.state.alphaBar = 0.12;
  for (const [n, target] of [[0, 80], [0.21, 22.5], [0.225, 0], [0.3, -30]]) {
    e.state.n = n;
    assert.ok(Math.abs(tut.rhoTarget - target) < 1e-10);
    const v = tut.view().values;
    assert.ok(Math.abs(v.rhoLow - (target - 10)) < 1e-10);
    assert.ok(Math.abs(v.rhoHigh - (target + 10)) < 1e-10);
    assert.equal(v.pressure, 69);
    assert.equal(v.level, 47);
    assert.equal(v.recirc, 93);
    assert.equal(v.void, 12);
    assert.equal(v.stability, e.derive().decayRatio);
    assert.equal(v.margin, e.derive().dnbr);
  }
});

test('BWR timeout and SCRAM fail without discarding completed objectives', () => {
  const timed = start();
  timed.engine.state.t_sim = 3600;
  timed.session.step(0.05, [], 0);
  assert.equal(timed.session.result.summary.completed, false);
  assert.equal(timed.session.result.summary.failed, 'tut_timeout');
  assert.deepEqual(timed.session.result.tutorial.completed, []);
  const stopped = start();
  for (let i = 0; i < 100; i++) tick(stopped);
  assert.equal(stopped.session.tutorial.confirmInspect(), true);
  record(stopped.engine, 'scram', null);
  stopped.engine.step(0.05);
  stopped.session.step(0.05, stopped.engine.trips.tiles(), stopped.engine.trips.unacknowledgedSeconds());
  assert.equal(stopped.session.result.summary.completed, false);
  assert.equal(stopped.session.result.summary.failed, 'fail_scram');
  assert.equal(stopped.session.result.tutorial.reactor, 'bwr');
  assert.deepEqual(stopped.session.result.tutorial.completed.map(e => e.id), ['inspect']);
});
