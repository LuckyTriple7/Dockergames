import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { Session, PHASE } from '../static/js/game/session.js';
import { record } from '../static/js/game/coreActions.js';
import { pack, apply } from '../static/js/net/persist.js';
import { TUTORIAL_STEPS } from '../static/js/game/tutorial.js';

const def = JSON.parse(readFileSync(new URL('../static/data/scenarios/pwr_startup_tutorial.json', import.meta.url)));
function start(cold = true) {
  const engine = createEngine(getPlant('pwr'), { cold, n: cold ? 1e-6 : 1, seed: def.seed });
  const session = new Session(engine, def);
  session.start();
  return { engine, session };
}
function tick({ engine, session }) {
  engine.step(0.05);
  session.step(0.05, engine.trips.tiles(), engine.trips.unacknowledgedSeconds());
}
// Follow exactly the UI advice: spin up pumps, small rod pulses with actual
// position caught up, then hand over to the three ordinary controllers.
function operate({ engine: e, session }, i) {
  const { state: s, ctx: c } = e;
  const stage = session.tutorial.index;
  if (stage === 1) for (let j = 0; j < 4; j++) if (!c.pumps[j].running) record(e, 'pump_toggle', j);
  if (stage === 2 && i % 10 === 0 && Math.abs(s.rodDmd[0] - s.rod[0]) < 0.005) {
    const rho = e.derive().rho_pcm;
    if (rho < 50) record(e, 'rod_jog', -1);
    else if (rho > 100) record(e, 'rod_jog', 1);
  }
  if (stage >= 3) {
    if (!c.rodCtl.auto) record(e, 'rod_auto', true);
    if (!c.govCtl.auto) record(e, 'gov_auto', true);
  }
}

test('prepared hot startup is subcritical, pumps stopped and turbine closed', () => {
  const { engine: e, session } = start();
  assert.ok(Math.abs(e.derive().rho_pcm + 500) < 0.01);
  assert.equal(e.state.rod[0], 1);
  assert.equal(e.state.rod[1], 0);
  assert.equal(e.ctx.govValve.pos, 0);
  assert.equal(e.ctx.govCtl.auto, false);
  assert.ok(e.ctx.pumps.every(p => !p.running && p.speed === 0));
  assert.equal(e.state.P_demand, 0);
  assert.equal(session.tutorial.index, 0);
});

test('pump commands alone do not complete circulation; interrupted hold resets', () => {
  const run = start();
  for (let i = 0; i < 100; i++) tick(run);
  assert.equal(run.session.tutorial.index, 1);
  for (let j = 0; j < 4; j++) record(run.engine, 'pump_toggle', j);
  tick(run);
  assert.equal(run.session.tutorial.index, 1);
  assert.equal(run.session.tutorial.held, 0);
  for (let i = 0; i < 220; i++) tick(run);
  assert.ok(run.session.tutorial.held > 0);
  record(run.engine, 'pump_toggle', 0);
  tick(run);
  assert.equal(run.session.tutorial.held, 0);
  assert.equal(run.session.tutorial.index, 1);
});

test('displayed instructions can complete all objectives; saved hold resumes identically', () => {
  const run = start();
  let restored = null;
  for (let i = 0; i < 72000 && run.session.phase === PHASE.RUNNING; i++) {
    operate(run, i);
    tick(run);
    if (restored) { operate(restored, i); tick(restored); }
    if (!restored && run.session.tutorial.index === 4 && run.session.tutorial.held >= 10) {
      const save = JSON.parse(JSON.stringify(pack(run.engine, def.id, run.session.run, run.session)));
      restored = start(false); // same initial engine as the real load path
      assert.equal(apply(save, restored.engine, restored.session.run, restored.session), null);
      assert.deepEqual(restored.session.tutorial.snapshot(), run.session.tutorial.snapshot());
    }
  }
  assert.ok(restored, 'must reach a stable interval worth saving');
  assert.equal(run.session.result.summary.completed, true);
  assert.equal(run.session.result.score, null);
  assert.deepEqual(run.session.tutorial.completed.map(e => e.id), TUTORIAL_STEPS);
  assert.deepEqual(restored.session.result, run.session.result);
  assert.deepEqual(pack(restored.engine).state, pack(run.engine).state);
  assert.ok(run.engine.state.P_e >= 140 && run.engine.state.P_e <= 160);
  assert.ok(run.engine.state.t_sim < 3600);
});

test('timeout never grants success; scram ends the attempt with completed objectives retained', () => {
  const timed = start();
  timed.engine.state.t_sim = 3600;
  timed.session.step(0.05, [], 0);
  assert.equal(timed.session.result.summary.completed, false);
  assert.equal(timed.session.result.summary.failed, 'tut_timeout');
  const stopped = start();
  for (let i = 0; i < 100; i++) tick(stopped);
  record(stopped.engine, 'scram', null);
  tick(stopped);
  assert.equal(stopped.session.result.summary.failed, 'fail_scram');
  assert.equal(stopped.session.result.tutorial.completed.length, 1);
});

test('invalid tutorial progress does not skip objectives', () => {
  const { session } = start();
  session.restore({ tutorial: { index: 5, held: Infinity, completed: [] } });
  assert.equal(session.tutorial.index, 0);
  session.restore({ tutorial: { index: 1, completed: [{ id: 'inspect', t: 999 }] } });
  assert.equal(session.tutorial.index, 0);
});

test('guidance responds to rod travel, excessive reactivity and missing automatic control', () => {
  const { session, engine: e } = start();
  const tut = session.tutorial;
  tut.index = 2;
  for (const p of e.ctx.pumps) { p.start(); p.speed = 1; }
  e.state.rodDmd[0] = 0.8;
  assert.equal(tut.hint(), 'tut_hint_travel');
  e.state.rod[0] = e.state.rodDmd[0] = 0;
  e.reactivity.compute(e.state, e.spec);
  assert.equal(tut.hint(), 'tut_hint_fast');
  tut.index = 3;
  assert.equal(tut.hint(), 'tut_hint_auto');
});

// Exercise the actual localized card and result renderer at the DOM boundary.
globalThis.window = { RS_I18N: JSON.parse(readFileSync(new URL('../locales/de.json', import.meta.url))), RS_CFG: { lang: 'de' } };
class Node {
  constructor() { this.children = []; this.textContent = ''; this.listeners = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute() {}
  addEventListener(name, fn) { this.listeners[name] = fn; }
  querySelector() { return null; }
  scrollIntoView() { this.scrolled = true; }
}
const nodes = new Map();
const get = key => { if (!nodes.has(key)) nodes.set(key, new Node()); return nodes.get(key); };
globalThis.document = { querySelector: get, createElement: () => new Node(), createTextNode: text => ({ textContent: text }) };
const { buildTutorial, renderTutorialResult } = await import('../static/js/ui/tutorial.js');
const text = node => [node.textContent, ...(node.children || []).map(text)].join(' ');

test('tutorial card shows localized task, switches mobile panel and disappears in ordinary play', () => {
  const { session } = start();
  let update;
  buildTutorial(session, { add(group, callback) { update = callback; } });
  const host = get('#rs-tutorial');
  assert.equal(host.hidden, false);
  assert.match(text(host), /Schritt 1\/5/);
  // Static per-step instruction now lives in the Anleitung modal, not the
  // always-visible status bar -- see buildTutorial() in tutorial.js.
  assert.match(get('#rs-tutorial-modal-instruction').textContent, /140–164 bar/);
  const panelButton = host.children.find(n => n.textContent === window.RS_I18N.tut_show_panel);
  panelButton.listeners.click();
  assert.equal(get('#rs-tab-prim').checked, true);
  assert.equal(get('#rs-p-prim').scrolled, true);
  session.tutorial.index = 1;
  update();
  assert.match(text(host), /Schritt 2\/5/);
  const resultNode = new Node();
  renderTutorialResult(resultNode, { tutorial: { completed: [{ id: 'inspect', t: 5 }] } });
  assert.match(text(resultNode), /Erreicht 00:00:05/);
  assert.match(text(resultNode), /ohne Punkte/);
  buildTutorial({ tutorial: null }, { add() {} });
  assert.equal(host.hidden, true);
  assert.equal(host.children.length, 0);
});
