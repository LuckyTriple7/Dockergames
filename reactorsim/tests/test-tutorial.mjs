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
  if (session.tutorial.inspectReady) assert.equal(session.tutorial.confirmInspect(), true);
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
  assert.equal(run.session.tutorial.confirmInspect(), true);
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
  assert.equal(stopped.session.tutorial.confirmInspect(), true);
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

test('inspection requires five consecutive seconds and one explicit confirmation of current conditions', () => {
  const { engine, session } = start();
  const tut = session.tutorial;
  // Isolate the hold clock from physics; use the real prepared plant conditions.
  const advance = dt => { engine.state.t_sim += dt; tut.step(dt); };
  assert.equal(tut.conditions()[0], true);
  assert.equal(tut.inspectReady, false);
  assert.equal(tut.confirmInspect(), false);
  advance(4.75);
  assert.equal(tut.inspectReady, false);
  assert.equal(tut.confirmInspect(), false);
  assert.equal(tut.held, 4.75, 'an early click must not discard a valid partial hold');
  advance(0.25);
  assert.equal(tut.inspectReady, true);
  advance(10);
  assert.equal(tut.index, 0, 'waiting beyond five seconds never confirms inspection');
  assert.equal(tut.held, 5, 'pending hold is capped');
  assert.deepEqual(tut.completed, []);

  const pressure = engine.state.p_prim;
  engine.state.p_prim = 100;
  assert.equal(tut.conditions()[0], false);
  assert.equal(tut.inspectReady, false, 'readiness checks current conditions without a tick');
  const elapsed = tut.elapsed;
  assert.equal(tut.confirmInspect(), false);
  assert.equal(tut.held, 0, 'invalid click resets the hold even without a tick');
  assert.equal(tut.elapsed, elapsed, 'confirmation does not advance simulation time');
  engine.state.p_prim = pressure;
  assert.equal(tut.inspectReady, false);
  advance(4.75);
  assert.equal(tut.confirmInspect(), false, 'a new full hold is required');
  engine.state.p_prim = 100;
  advance(0.25);
  assert.equal(tut.held, 0, 'ordinary simulation steps also invalidate a partial hold');
  engine.state.p_prim = pressure;
  advance(4.75);
  assert.equal(tut.inspectReady, false);
  assert.equal(tut.confirmInspect(), false);
  advance(0.25);
  assert.equal(tut.inspectReady, true);
  assert.equal(tut.confirmInspect(), true);
  assert.deepEqual(tut.snapshot(), { index: 1, held: 0, elapsed: 0,
    completed: [{ id: 'inspect', t: engine.state.t_sim }] });
  const confirmed = tut.snapshot();
  assert.equal(tut.inspectReady, false);
  assert.equal(tut.confirmInspect(), false);
  assert.deepEqual(tut.snapshot(), confirmed, 'repeated confirmation has no effect');
});

test('inspection saves preserve partial and pending holds, confirmed progress and legacy completions', () => {
  for (const mode of ['partial', 'pending', 'confirmed', 'legacy']) {
    const run = start();
    const tut = run.session.tutorial;
    const duration = mode === 'partial' ? 2.5 : 7;
    run.engine.state.t_sim = duration;
    tut.step(duration);
    if (mode === 'confirmed') assert.equal(tut.confirmInspect(), true);
    const save = JSON.parse(JSON.stringify(pack(run.engine, def.id, run.session.run, run.session)));
    const expected = mode === 'legacy'
      ? { index: 1, held: 0, elapsed: 2, completed: [{ id: 'inspect', t: 5 }] }
      : { index: mode === 'confirmed' ? 1 : 0,
        held: mode === 'confirmed' ? 0 : Math.min(duration, 5),
        elapsed: mode === 'confirmed' ? 0 : duration,
        completed: mode === 'confirmed' ? [{ id: 'inspect', t: duration }] : [] };
    if (mode === 'legacy') save.session.tutorial = expected;
    assert.deepEqual(save.session.tutorial, expected, 'save format remains unchanged');
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
      assert.equal(loaded.index, 0, 'loading or waiting cannot confirm a pending inspection');
      assert.equal(loaded.inspectReady, true);
      assert.equal(loaded.confirmInspect(), true);
      assert.deepEqual(loaded.completed, [{ id: 'inspect', t: restored.engine.state.t_sim }]);
    } else {
      assert.equal(loaded.confirmInspect(), false);
      assert.deepEqual(loaded.snapshot(), expected);
    }
  }
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
  constructor() { this.children = []; this.textContent = ''; this.listeners = {}; this.hidden = true; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute() {}
  addEventListener(name, fn) { this.listeners[name] = fn; }
  querySelector() { return null; }
  scrollIntoView() { this.scrolled = true; }
  focus() { this.focusCount = (this.focusCount || 0) + 1; }
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
  // #rs-tutorial-status is the small clickable status text in the toolbar
  // (heading + live values); it opens #rs-tutorial-modal for the static
  // instruction, why-explanation and Lernziele -- see buildTutorial() in
  // tutorial.js. Buttons use .onclick (single-slot, safe to reassign each
  // round on these persistent elements), not addEventListener/.listeners.
  const status = get('#rs-tutorial-status');
  const modal = get('#rs-tutorial-modal');
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /Schritt 1\/5/);
  assert.match(get('#rs-tutorial-modal-instruction').textContent, /140–164 bar/);
  assert.equal(modal.hidden, false, 'inspection opens automatically');
  const title = get('#rs-tutorial-modal-title');
  assert.ok(title.focusCount > 0);
  const focused = title.focusCount;
  modal.hidden = true;
  status.onclick();
  assert.equal(modal.hidden, false);
  assert.ok(title.focusCount > focused, 'opening from the toolbar focuses the title');
  get('#rs-tutorial-modal-panel').onclick();
  assert.equal(modal.hidden, true, 'jumping to the panel also closes the dialog');
  assert.equal(get('#rs-tab-prim').checked, true);
  assert.equal(get('#rs-p-prim').scrolled, true);
  session.tutorial.index = 1;
  update();
  assert.match(status.textContent, /Schritt 2\/5/);
  const resultNode = new Node();
  renderTutorialResult(resultNode, { tutorial: { completed: [{ id: 'inspect', t: 5 }] } });
  assert.match(text(resultNode), /Erreicht 00:00:05/);
  assert.match(text(resultNode), /ohne Punkte/);
  buildTutorial({ tutorial: null }, { add() {} });
  assert.equal(status.hidden, true);
  assert.equal(modal.hidden, true);
});

test("chernobyl tutorial's window/az5 steps show the live hint, not a misleading hold countdown", async () => {
  nodes.clear();
  const { RBMK_CHERNOBYL_TUTORIAL } = await import('../static/js/game/chernobylTutorial.js');
  const scenario = JSON.parse(readFileSync(new URL('../static/data/scenarios/rbmk_chernobyl.json', import.meta.url)));
  const engine = createEngine(getPlant('rbmk'), { seed: scenario.seed });
  const session = new Session(engine, { ...scenario, tutorial: RBMK_CHERNOBYL_TUTORIAL });
  session.start();
  const tut = session.tutorial;
  let update;
  buildTutorial(session, { add(group, callback) { update = callback; } });
  const status = get('#rs-tutorial-status');

  // 'window' holds internally for only HOLD[5]=0.2s (a debounce for the
  // fast transition to 'az5', see chernobylTutorial.js), not a real wait --
  // showing "0/0.2s" while the script is still counting down to AZ-5 looked
  // like "almost done" (Nutzerrueckmeldung). Force onto 'window' and check
  // the compact status shows the live hint instead of a "0/0.2" countdown.
  tut.index = 5;
  tut._runbackT0 = engine.state.t_sim;
  update();
  assert.doesNotMatch(status.textContent, /0[.,]?\/0[.,]2/);
  assert.match(status.textContent, /beobachten/i);

  // Nach dem (vom Drehbuch ausgeloesten) AZ-5 haengt der Hinweis allein am
  // Scram-Zustand, nicht mehr an einem Zeitfenster -- es gibt seither kein
  // "zu spaet" mehr, das der Spieler verpassen koennte.
  engine.scram('az5');
  update();
  assert.match(status.textContent, /ausgelöst/i);
  assert.doesNotMatch(status.textContent, /0[.,]?\/0[.,]2/);

  // Die Uhr der Nacht haengt an der Wertezeile, nicht in den *_values-Texten
  // der einzelnen Schritte (siehe ui/tutorial.js) -- sie darf deshalb in
  // JEDEM Schritt erscheinen, ohne dass einer davon sie nennen muss.
  tut._setWallOffset(3848 - engine.state.t_sim); // 01:04:08
  update();
  assert.match(status.textContent, /Uhrzeit 01:04:08/);

  // Schlussbefund im Debrief: Dass der Kern auch ohne AZ-5 am Durchgehen war,
  // steht in keinem einzelnen Schritt und nur dieses Tutorial hat den
  // Schluessel dafuer -- die drei Anfahrtutorials duerfen davon nichts sehen.
  // Dasselbe gilt fuer die Uhrzeiten der erledigten Schritte (entry.w).
  const chernobylResult = new Node();
  renderTutorialResult(chernobylResult, { tutorial: { prefix: 'tut_chernobyl_',
    steps: tut.steps, completed: [{ id: 'handover', t: 5, w: 5 }, { id: 'az5', t: 1183, w: 5020 }] } });
  assert.match(text(chernobylResult), /Schlussbefund/);
  assert.match(text(chernobylResult), /Erreicht 00:19:43 · Uhrzeit 01:23:40/);
  const startupResult = new Node();
  renderTutorialResult(startupResult, { tutorial: { completed: [{ id: 'inspect', t: 5 }] } });
  assert.doesNotMatch(text(startupResult), /Schlussbefund/);
  assert.doesNotMatch(text(startupResult), /Uhrzeit/);
});

for (const reactor of ['pwr', 'rbmk', 'bwr']) {
  test(`${reactor}: inspection dialog validates live readings and confirms through its actual click handler`, () => {
    nodes.clear();
    const scenario = JSON.parse(readFileSync(new URL(`../static/data/scenarios/${reactor}_startup_tutorial.json`, import.meta.url)));
    const engine = createEngine(getPlant(reactor), { cold: true, n: 1e-6, seed: scenario.seed });
    const session = new Session(engine, scenario);
    session.start();
    const tut = session.tutorial;
    const advance = dt => { engine.state.t_sim += dt; tut.step(dt); };
    let update;
    const render = { add(group, callback) { update = callback; } };
    buildTutorial(session, render);
    const modal = get('#rs-tutorial-modal');
    const title = get('#rs-tutorial-modal-title');
    const confirm = get('#rs-tutorial-modal-confirm');
    const inspection = get('#rs-tutorial-modal-inspection');
    const status = get('#rs-tutorial-modal-inspect-status');
    assert.equal(modal.hidden, false);
    assert.ok(title.focusCount > 0);
    assert.equal(confirm.hidden, false);
    assert.equal(confirm.disabled, true);
    assert.equal(inspection.hidden, false);
    assert.equal(status.hidden, false);
    const running = status.textContent;
    assert.match(running, /Prüf|prüf|Sekunden|läuft|Haltezeit/);
    assert.doesNotMatch(running, /tut_|Ausgangszustand im Soll/);
    const readings = text(inspection);
    assert.ok(inspection.children.length >= ({ pwr: 4, rbmk: 6, bwr: 5 }[reactor]));
    assert.match(readings, { pwr: /140–164\s*bar/, rbmk: /65–73\s*bar/, bwr: /67–73\s*bar/ }[reactor]);
    assert.match(readings, reactor === 'pwr' ? /270–305\s*°C/ : /270–295\s*°C/);
    assert.match(readings, /Neutron/);
    assert.match(readings, /(?:<|unter|weniger als)\s*0,1\s*%/);
    assert.match(readings, /Reaktivität/);
    assert.match(readings, /(?:<\s*0|unter\s*0|negativ)/);
    const values = tut.view().values;
    for (const key of ['pressure', 'temperature', 'rho', 'neutron']) {
      const digits = key === 'neutron' ? 4 : 1;
      const value = new Intl.NumberFormat('de', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(values[key]);
      assert.ok(readings.includes(value), `${key}: localized live value ${value}`);
    }
    if (reactor === 'rbmk') {
      assert.match(readings, /Trommel/);
      assert.match(readings, /35–65\s*%/);
      assert.match(readings, /ORM/);
      assert.match(readings, /(?:>=|≥|mindestens)\s*30/);
      assert.ok(readings.includes(values.level.toFixed(1).replace('.', ',')));
      assert.match(readings, /211/);
      assert.doesNotMatch(readings, /140–164|Dampferzeuger|Borkonzentration/);
    }
    if (reactor === 'bwr') {
      assert.match(readings, /Domdruck/);
      assert.match(readings, /35–65\s*%/);
      assert.ok(readings.includes(values.level.toFixed(1).replace('.', ',')));
      assert.doesNotMatch(readings, /140–164|Dampferzeuger|Borkonzentration|Trommel|ORM|DWR|RBMK/);
    }
    assert.doesNotMatch(readings, /tut_|\{\w+\}/);
    confirm.onclick();
    assert.equal(tut.index, 0, 'early clicks cannot skip inspection');
    advance(4);
    update();
    assert.equal(confirm.disabled, true);
    assert.match(get('#rs-tutorial-modal-hold').textContent, /4\/5/);
    advance(1);
    update();
    assert.equal(confirm.disabled, false);
    assert.match(status.textContent, /Ausgangszustand im Soll/);

    const neutron = engine.state.n;
    engine.state.n = 0.01;
    // The plant can become invalid between render and click.
    confirm.onclick();
    assert.equal(tut.index, 0);
    assert.equal(tut.held, 0);
    assert.equal(confirm.disabled, true, 'failed click refreshes the UI immediately');
    assert.notEqual(status.textContent, running);
    assert.match(status.textContent, /Abweich|abweich|ungültig|nicht.*Soll|nicht erfüllt|außerhalb/);
    assert.doesNotMatch(status.textContent, /Ausgangszustand im Soll|tut_/);
    assert.match(text(inspection), /1,0000/, 'inspection readings refresh after the invalid click');
    engine.state.n = neutron;
    advance(5);
    update();
    for (const phase of [PHASE.BRIEFING, PHASE.DEBRIEF]) {
      session.phase = phase;
      update();
      assert.equal(confirm.disabled, true, 'confirmation requires a running session');
      confirm.onclick();
      assert.equal(tut.index, 0);
    }
    session.phase = PHASE.RUNNING;
    update();
    assert.equal(confirm.disabled, false);

    const pending = JSON.parse(JSON.stringify(pack(engine, scenario.id, session.run, session)));
    const restoredEngine = createEngine(getPlant(reactor));
    const restored = new Session(restoredEngine, scenario);
    restored.start();
    assert.equal(apply(pending, restoredEngine, restored.run, restored), null);
    modal.hidden = true;
    buildTutorial(restored, render);
    assert.equal(modal.hidden, false, 'pending save reopens inspection automatically');
    assert.equal(restored.tutorial.index, 0);
    assert.deepEqual(restored.tutorial.completed, []);
    assert.equal(confirm.disabled, false);
    assert.match(status.textContent, /Ausgangszustand im Soll/);
    const focused = title.focusCount;
    confirm.onclick();
    assert.equal(restored.tutorial.index, 1);
    assert.equal(tut.index, 0, 'rebuilding replaces the previous session click handler');
    assert.equal(confirm.hidden, true, 'confirmation is hidden in step 2 without a render tick');
    assert.equal(inspection.hidden, true);
    assert.equal(status.hidden, true);
    assert.match(title.textContent, /Schritt 2\/5/);
    assert.ok(title.focusCount > focused, 'step change focuses the updated title');
    assert.deepEqual(restored.tutorial.completed, [{ id: 'inspect', t: restoredEngine.state.t_sim }]);
    confirm.onclick();
    assert.equal(restored.tutorial.completed.length, 1);
    modal.hidden = true;
    buildTutorial(restored, render);
    assert.equal(modal.hidden, true, 'later steps do not open the dialog on build');
    get('#rs-tutorial-status').onclick();
    assert.equal(modal.hidden, false);
    buildTutorial(new Session(restoredEngine, null), { add() {} });
    assert.equal(modal.hidden, true, 'ordinary sessions hide a previously open tutorial dialog');
    assert.equal(get('#rs-tutorial-status').hidden, true);
  });
}

test('RBMK tutorial renders its own instructions, live drum readings and debrief labels', () => {
  const rbmkDef = JSON.parse(readFileSync(new URL('../static/data/scenarios/rbmk_startup_tutorial.json', import.meta.url)));
  const engine = createEngine(getPlant('rbmk'), { cold: true, n: 1e-6, seed: rbmkDef.seed });
  const session = new Session(engine, rbmkDef);
  session.start();
  let update;
  buildTutorial(session, { add(group, callback) { update = callback; } });
  assert.match(get('#rs-tutorial-modal-instruction').textContent, /65–73 bar Trommeldruck/);
  assert.match(get('#rs-tutorial-status').textContent, /ORM 211/);
  for (let i = 0; i < TUTORIAL_STEPS.length; i++) {
    session.tutorial.index = i;
    update();
    const instruction = get('#rs-tutorial-modal-instruction').textContent;
    assert.ok(instruction.length > 80);
    assert.doesNotMatch(instruction, /tut_|Dampferzeuger|Borkonzentration/);
    if (i === 1) assert.match(get('#rs-tutorial-status').textContent, /0,0\/8/);
  }
  const resultNode = new Node();
  renderTutorialResult(resultNode, { tutorial: { reactor: 'rbmk', completed: [{ id: 'inspect', t: 5 }] } });
  assert.match(text(resultNode), /Heißen RBMK-Ausgangszustand/);
  assert.match(text(resultNode), /Erreicht 00:00:05/);
});

test('BWR renders all five own steps, interpolated hints, restored panel jump and debrief labels', () => {
  nodes.clear();
  const scenario = JSON.parse(readFileSync(new URL('../static/data/scenarios/bwr_startup_tutorial.json', import.meta.url)));
  const engine = createEngine(getPlant('bwr'), { cold: true, n: 1e-6, seed: scenario.seed });
  const session = new Session(engine, scenario);
  session.start();
  let update;
  const render = { add(group, callback) { update = callback; } };
  buildTutorial(session, render);
  const labels = [];
  for (let index = 0; index < TUTORIAL_STEPS.length; index++) {
    session.tutorial.index = index;
    update();
    const id = TUTORIAL_STEPS[index];
    const label = window.RS_I18N[`tut_bwr_${id}_title`];
    assert.ok(label, `BWR label for ${id}`);
    labels.push(label);
    assert.ok(get('#rs-tutorial-modal-title').textContent.includes(label));
    assert.equal(get('#rs-tutorial-modal-instruction').textContent, window.RS_I18N[`tut_bwr_${id}_instruction`]);
    for (const selector of ['title', 'instruction', 'why', 'hint', 'steps']) {
      const rendered = text(get(`#rs-tutorial-modal-${selector}`));
      assert.ok(rendered.trim().length > 0);
      assert.doesNotMatch(rendered, /tut_|\{\w+\}|Dampferzeuger|Borkonzentration|Trommel|ORM|RBMK/);
    }
    assert.doesNotMatch(get('#rs-tutorial-status').textContent, /tut_|\{\w+\}/);
  }

  // Exercise both sides of the moving target through the real hint renderer.
  session.tutorial.index = 2;
  engine.ctx.recircPump.start();
  engine.ctx.recircPump.speed = 1;
  engine.ctx.govCtl.auto = true;
  engine.state.W_core = 13000;
  const derived = { ...engine.derive(), rho_pcm: 0, period: 100 };
  engine.derive = () => derived;
  const hintKeys = new Set();
  for (const n of [0.21, 0.24]) {
    engine.state.n = n;
    update();
    const view = session.tutorial.view();
    hintKeys.add(view.hint);
    const template = window.RS_I18N[view.hint];
    assert.match(template, /\{rho(?:Low|High)\}/, 'rod advice displays the current target band');
    const hint = get('#rs-tutorial-modal-hint').textContent;
    for (const [, key] of template.matchAll(/\{(\w+)\}/g)) {
      const value = new Intl.NumberFormat('de', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(view.values[key]);
      assert.ok(hint.includes(value), `${key}: hint interpolates ${value}`);
    }
    assert.doesNotMatch(hint, /tut_|\{\w+\}/);
  }
  assert.equal(hintKeys.size, 2, 'the moving target changes rod advice at unchanged reactivity');

  // A saved load objective must jump to BWR recirculation, not PWR secondary.
  engine.state.t_sim = 30;
  session.tutorial.index = 3;
  session.tutorial.completed = TUTORIAL_STEPS.slice(0, 3).map((id, i) => ({ id, t: 5 + i * 5 }));
  const save = JSON.parse(JSON.stringify(pack(engine, scenario.id, session.run, session)));
  const restoredEngine = createEngine(getPlant('bwr'));
  const restored = new Session(restoredEngine, scenario);
  restored.start();
  assert.equal(apply(save, restoredEngine, restored.run, restored), null);
  buildTutorial(restored, render);
  get('#rs-tab-prim').checked = false;
  get('#rs-tab-sec').checked = false;
  get('#rs-tutorial-status').onclick();
  get('#rs-tutorial-modal-panel').onclick();
  assert.equal(get('#rs-tab-prim').checked, true);
  assert.equal(get('#rs-tab-sec').checked, false);
  assert.equal(get('#rs-p-prim').scrolled, true);
  assert.equal(get('#rs-tutorial-modal').hidden, true);

  const resultNode = new Node();
  renderTutorialResult(resultNode, { tutorial: { reactor: 'bwr',
    completed: TUTORIAL_STEPS.map((id, i) => ({ id, t: 5 + i * 5 })) } });
  for (const label of labels) assert.ok(text(resultNode).includes(label));
  assert.match(text(resultNode), /SWR/);
  assert.match(text(resultNode), /Erreicht 00:00:05/);
  assert.doesNotMatch(text(resultNode), /tut_|DWR|RBMK/);
});
