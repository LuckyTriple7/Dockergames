import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { Session, PHASE } from '../static/js/game/session.js';
import { record } from '../static/js/game/coreActions.js';
import { pack, apply } from '../static/js/net/persist.js';
import { TUTORIAL_STEPS } from '../static/js/game/tutorial.js';

const def = JSON.parse(readFileSync(new URL('../static/data/scenarios/rbmk_startup_tutorial.json', import.meta.url)));
function start(cold = true) {
  const engine = createEngine(getPlant('rbmk'), { cold, n: cold ? 1e-6 : 1, seed: def.seed });
  const session = new Session(engine, def);
  session.start();
  return { engine, session };
}
function tick({ engine, session }) {
  engine.step(0.05);
  session.step(0.05, engine.trips.tiles(), engine.trips.unacknowledgedSeconds());
}
function operate({ engine: e, session }, i) {
  const { state: s, ctx: c } = e;
  if (session.tutorial.inspectReady) assert.equal(session.tutorial.confirmInspect(), true);
  const stage = session.tutorial.index;
  if (stage === 1) c.mcp.forEach((p, j) => { if (!p.running) record(e, 'pump_toggle', j); });
  if (stage >= 2 && !c.govCtl.auto) record(e, 'gov_auto', true);
  // Nur VOR dem Umschalten auf Automatik jogged -- rod_jog schaltet
  // rodAutoCtl.auto selbst auf false (siehe coreActions.js: manuelles
  // Eingreifen beendet die Automatik). Ein Gate ueber `stage` allein
  // reicht nicht: sobald 'stable' erreicht ist, laesst die normale, dort
  // dokumentierte axiale Xenon-Schwingung n auch mal wieder unter 0,30
  // sacken -- ohne das `!c.powerCtl.auto`-Gate wuerde das hier faelschlich
  // erneut jog ausloesen und die gerade erst eingeschaltete Automatik
  // sofort wieder abwuergen.
  if (stage >= 2 && !c.powerCtl.auto && s.n < 0.30 && i % 20 === 0
    && s.rod.every((v, j) => Math.abs(v - s.rodDmd[j]) < 0.005)) {
    const rho = e.derive().rho_pcm;
    if (rho < 50) record(e, 'rod_jog', -1);
    else if (rho > 100) record(e, 'rod_jog', 1);
  }
  if (s.n >= 0.30 && !c.powerCtl.auto) {
    record(e, 'rod_auto', true);
    // rod_auto uebernimmt stossfrei das n von genau diesem Takt als
    // Sollwert (siehe coreActions.js) -- ein Bediener trimmt danach auf die
    // Bandmitte nach, statt auf einem Zufallswert nahe der 0,30-Schwelle
    // stehenzubleiben.
    c.powerCtl.setpoint = 0.30;
  }
}

test('RBMK starts hot and subcritical with inserted rods, stopped pumps and closed turbine', () => {
  const { engine: e, session } = start();
  assert.ok(e.derive().rho_pcm < 0);
  assert.deepEqual([...e.state.rod], [1, 1, 1]);
  assert.equal(e.derive().orm, 211);
  assert.ok(e.ctx.mcp.every(p => !p.running && p.speed === 0));
  assert.equal(e.ctx.govValve.pos, 0);
  assert.equal(e.ctx.powerCtl.auto, false);
  assert.equal(e.state.P_e, 0);
  assert.equal(session.tutorial.conditions()[0], true);
  assert.equal(session.tutorial.view().values.pumps, 0);
});

test('RBMK instructions complete using normal controls; saved stability interval resumes identically', () => {
  const run = start();
  let restored;
  for (let i = 0; i < 72000 && run.session.phase === PHASE.RUNNING; i++) {
    operate(run, i); tick(run);
    if (restored) { operate(restored, i); tick(restored); }
    if (!restored && run.session.tutorial.index === 4 && run.session.tutorial.held >= 10) {
      const save = JSON.parse(JSON.stringify(pack(run.engine, def.id, run.session.run, run.session)));
      restored = start(false);
      assert.equal(apply(save, restored.engine, restored.session.run, restored.session), null);
    }
  }
  assert.equal(run.session.result?.summary.completed, true,
    JSON.stringify({ result: run.session.result?.summary, progress: run.session.tutorial.view(), rods: run.engine.state.rod }));
  assert.ok(restored);
  assert.equal(run.session.result.score, null);
  assert.deepEqual(run.session.tutorial.completed.map(e => e.id), TUTORIAL_STEPS);
  assert.deepEqual(restored.session.result, run.session.result);
  assert.deepEqual(pack(restored.engine).state, pack(run.engine).state);
  // A previously stable plant must stop earning hold time as soon as actual
  // circulation or shutdown reserve is lost, even with all automatics enabled.
  const { engine: e, session } = run;
  const tut = session.tutorial;
  tut.index = 4;
  tut.held = 10;
  record(e, 'pump_toggle', 0);
  tut.step(0.05);
  assert.equal(tut.held, 0);
  assert.equal(tut.hint(), 'tut_rbmk_hint_pumps');
  record(e, 'pump_toggle', 0);
  e.state.rod.fill(0.1);
  assert.equal(tut.conditions()[4], false);
  assert.equal(tut.hint(), 'tut_rbmk_hint_orm');
});

test('pump command is not flow; idle timeout and AZ-5 never complete the RBMK tutorial', () => {
  const run = start();
  for (let i = 0; i < 100; i++) tick(run);
  assert.equal(run.session.tutorial.confirmInspect(), true);
  assert.equal(run.session.tutorial.index, 1);
  operate(run, 100);
  tick(run);
  assert.equal(run.session.tutorial.held, 0);
  assert.equal(run.session.tutorial.index, 1);
  record(run.engine, 'scram');
  tick(run);
  assert.equal(run.session.result.summary.completed, false);
  assert.equal(run.session.result.summary.failed, 'fail_scram');
  assert.equal(run.session.result.tutorial.completed.length, 1);
  const idle = start();
  for (let i = 0; i < 72001 && idle.session.phase === PHASE.RUNNING; i++) tick(idle);
  assert.equal(idle.session.result.summary.completed, false);
  assert.equal(idle.session.result.summary.failed, 'tut_timeout');
  assert.equal(idle.session.tutorial.index, 0);
  assert.deepEqual(idle.session.tutorial.completed, []);
});

test('RBMK inspection requires five consecutive seconds and current conditions before explicit confirmation', () => {
  const { engine, session } = start();
  const tut = session.tutorial;
  // Isolate the hold clock from physics; use the real prepared RBMK conditions.
  const advance = dt => { engine.state.t_sim += dt; tut.step(dt); };
  assert.equal(tut.conditions()[0], true);
  assert.equal(tut.inspectReady, false);
  assert.equal(tut.confirmInspect(), false);
  advance(4.75);
  assert.equal(tut.inspectReady, false);
  assert.equal(tut.confirmInspect(), false);
  assert.equal(tut.held, 4.75);
  advance(0.25);
  assert.equal(tut.inspectReady, true);
  advance(10);
  assert.equal(tut.index, 0, 'inspection never completes automatically');
  assert.equal(tut.held, 5);
  assert.deepEqual(tut.completed, []);

  const level = engine.state.L_drum;
  engine.state.L_drum = 0.2;
  assert.equal(tut.conditions()[0], false);
  assert.equal(tut.inspectReady, false, 'live drum level invalidates readiness without a tick');
  const elapsed = tut.elapsed;
  assert.equal(tut.confirmInspect(), false);
  assert.equal(tut.held, 0);
  assert.equal(tut.elapsed, elapsed);
  engine.state.L_drum = level;
  assert.equal(tut.inspectReady, false);
  advance(4.75);
  assert.equal(tut.confirmInspect(), false);
  engine.state.L_drum = 0.2;
  advance(0.25);
  assert.equal(tut.held, 0, 'simulation steps also invalidate partial holds');
  engine.state.L_drum = level;
  advance(4.75);
  assert.equal(tut.inspectReady, false);
  assert.equal(tut.confirmInspect(), false);
  advance(0.25);
  assert.equal(tut.inspectReady, true);
  assert.equal(tut.confirmInspect(), true);
  assert.deepEqual(tut.snapshot(), { index: 1, held: 0, elapsed: 0,
    completed: [{ id: 'inspect', t: engine.state.t_sim }], reactor: 'rbmk' });
  const confirmed = tut.snapshot();
  assert.equal(tut.inspectReady, false);
  assert.equal(tut.confirmInspect(), false);
  assert.deepEqual(tut.snapshot(), confirmed);
});

test('RBMK saves retain partial and pending inspection, explicit confirmation and legacy completion', () => {
  for (const mode of ['partial', 'pending', 'confirmed', 'legacy']) {
    const run = start();
    const tut = run.session.tutorial;
    const duration = mode === 'partial' ? 2.5 : 7;
    run.engine.state.t_sim = duration;
    tut.step(duration);
    if (mode === 'confirmed') assert.equal(tut.confirmInspect(), true);
    const save = JSON.parse(JSON.stringify(pack(run.engine, def.id, run.session.run, run.session)));
    const expected = mode === 'legacy'
      ? { index: 1, held: 0, elapsed: 2, completed: [{ id: 'inspect', t: 5 }], reactor: 'rbmk' }
      : { index: mode === 'confirmed' ? 1 : 0,
        held: mode === 'confirmed' ? 0 : Math.min(duration, 5),
        elapsed: mode === 'confirmed' ? 0 : duration,
        completed: mode === 'confirmed' ? [{ id: 'inspect', t: duration }] : [], reactor: 'rbmk' };
    if (mode === 'legacy') save.session.tutorial = expected;
    assert.deepEqual(save.session.tutorial, expected, 'RBMK save format remains unchanged');
    const restored = start(false);
    assert.equal(apply(save, restored.engine, restored.session.run, restored.session), null);
    const loaded = restored.session.tutorial;
    assert.deepEqual(loaded.snapshot(), expected);
    assert.equal(loaded.inspectReady, mode === 'pending');
    if (mode === 'partial' || mode === 'pending') {
      if (mode === 'partial') {
        assert.equal(loaded.confirmInspect(), false);
        restored.engine.state.t_sim += 2.5;
        loaded.step(2.5);
      }
      restored.engine.state.t_sim += 1;
      loaded.step(1);
      assert.equal(loaded.index, 0);
      assert.equal(loaded.inspectReady, true);
      assert.equal(loaded.confirmInspect(), true);
      assert.deepEqual(loaded.completed, [{ id: 'inspect', t: restored.engine.state.t_sim }]);
    } else {
      assert.equal(loaded.confirmInspect(), false);
      assert.deepEqual(loaded.snapshot(), expected);
    }
  }
});
