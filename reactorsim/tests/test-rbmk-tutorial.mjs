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
  const stage = session.tutorial.index;
  if (stage === 1) c.mcp.forEach((p, j) => { if (!p.running) record(e, 'pump_toggle', j); });
  if (stage >= 2 && !c.govCtl.auto) record(e, 'gov_auto', true);
  if (stage === 2 && s.n < 0.30 && i % 20 === 0
    && s.rod.every((v, j) => Math.abs(v - s.rodDmd[j]) < 0.005)) {
    const rho = e.derive().rho_pcm;
    if (rho < 50) record(e, 'rod_jog', -1);
    else if (rho > 100) record(e, 'rod_jog', 1);
  }
  if ((stage === 2 && s.n >= 0.30 || stage >= 3) && !c.powerCtl.auto) record(e, 'rod_auto', true);
}

test('RBMK starts hot and subcritical with inserted rods, stopped pumps and closed turbine', () => {
  const { engine: e, session } = start();
  assert.ok(e.derive().rho_pcm < 0);
  assert.deepEqual([...e.state.rod], [1, 1]);
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
  assert.equal(idle.session.tutorial.index, 1);
});
