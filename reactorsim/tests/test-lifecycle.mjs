// Real main.js lifecycle functions, with DOM/audio/RAF replaced at the boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { Session, PHASE } from '../static/js/game/session.js';
import { gridDeviationTrips } from '../static/js/game/scenario.js';
import { pack, apply } from '../static/js/net/persist.js';
import { attachRecorder } from '../static/js/game/recorder.js';
import { TrendHistory } from '../static/js/game/trendHistory.js';
import { Loop } from '../static/js/loop.js';

const source = readFileSync(new URL('../static/js/main.js', import.meta.url), 'utf8');
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
function harness(readSave = async () => ({ ok: false })) {
  const nodes = new Map();
  const $ = (key) => {
    if (!nodes.has(key)) nodes.set(key, { hidden: true, children: [], textContent: '',
      append() {}, replaceChildren() {} });
    return nodes.get(key);
  };
  const counters = { starts: 0, autosaves: 0, samples: 0, panels: 0 };
  const music = () => ({ start() {}, stop() {} });
  const app = { prefs: {}, prefsPromise: Promise.resolve({}),
    introMusic: music(), bgMusic: music(), render: { clear() {}, tick() {} } };
  const ctx = vm.createContext({ app, $, PHASE, getPlant, createEngine, Session,
    gridDeviationTrips, attachRecorder, applySave: apply,
    api: { readSave },
    t: (key) => key, clock: String,
    setText: (node, text) => { node.textContent = text; }, setAttr() {}, el: () => ({}),
    buildStatusBar() {}, statusTiles: new Map(), applyStatusSelection() {},
    sanitizeStatusKeys: () => [], applyAudioPrefs() {}, initControls() {},
    scramLabel: () => 'SCRAM', refreshResumeList() {}, playClip() {},
    showFault() {}, AUTOSAVE_INTERVAL_MS: 60000, XENON_SKIP_TARGET: 1,
    window: { clearInterval() {}, setInterval() { counters.autosaves++; return 1; } },
    buildPanels(engine, render, helperEnabled) {
      counters.panels++;
      counters.helperEnabled = helperEnabled;
      return { horn: { silence() {}, meltdown() {} }, annun: { log() {} },
        sampleTrends() { counters.samples++; } };
    },
    Loop: class {
      constructor(engine, render) { this.engine = engine; this.render = render; }
      stop() {} start() { counters.starts++; } setSpeed(v) { this.speed = v; }
    },
    setSpeed(v) { app.loop.setSpeed(v); },
    loadScores() {}, renderLearning() {}, buildTutorial() {}, renderTutorialResult() {}, renderObjectiveResult() {},
    closeSaveSlots() {}, resetSaveStatus() {},
    renderGuidance(host, def) { host.hidden = !def?.guidance; },
  });
  for (const name of ['cancelScenarioLoad', 'clearEndDialogs', 'toMenu', 'showBriefing', 'showDebrief', 'showDestroyed', 'boot']) {
    const fn = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
    assert.ok(fn, name);
    vm.runInContext(fn[0], ctx);
  }
  return { app, ctx, $, counters };
}

test('free play -> menu -> briefing offers Start and new scenario can run', async () => {
  const h = harness();
  await h.ctx.boot('pwr', null);
  h.ctx.toMenu();
  assert.equal(h.app.session, null);
  h.ctx.showBriefing({ duration_s: 60 });
  assert.equal(h.$('#rs-brief-go').textContent, 'brief_start');
  await h.ctx.boot('bwr', { id: 'test', reactor: 'bwr', duration_s: 60 });
  assert.equal(h.app.session.free, false);
  assert.equal(h.app.session.phase, PHASE.RUNNING);
});

test('pending save never starts simulation or autosave; late response cannot replace new run', async () => {
  const request = deferred();
  const h = harness(() => request.promise);
  const pending = h.ctx.boot('pwr', null, 'slot');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.counters.starts, 0);
  assert.equal(h.counters.autosaves, 0);
  assert.equal(h.counters.panels, 0);
  h.ctx.toMenu();
  await h.ctx.boot('rbmk', null);
  const current = h.app.engine;
  const recorder = current.recorder;
  request.resolve({ ok: true, data: pack(createEngine(getPlant('pwr'))) });
  await pending;
  assert.equal(h.app.engine, current);
  assert.equal(current.recorder, recorder);
  assert.equal(h.counters.starts, 1);
});

test('load error stays in menu with persistent feedback and no autosave', async () => {
  const h = harness();
  await h.ctx.boot('pwr', null, 'missing');
  assert.equal(h.counters.starts, 0);
  assert.equal(h.counters.autosaves, 0);
  assert.equal(h.$('#rs-start').hidden, false);
  assert.equal(h.$('#rs-start-message').textContent, 'load_failed');
});

test('changing selection cancels a pending save restore even before another run starts', async () => {
  const request = deferred();
  const h = harness(() => request.promise);
  const pending = h.ctx.boot('pwr', null, 'slot');
  await Promise.resolve(); await Promise.resolve();
  h.ctx.cancelScenarioLoad();
  request.resolve({ ok: true, data: pack(createEngine(getPlant('pwr'))) });
  await pending;
  assert.equal(h.counters.starts, 0);
  assert.equal(h.counters.autosaves, 0);
  assert.equal(h.app.session, null);
  assert.equal(h.$('#rs-start').hidden, false);
});

test('loaded state is applied before panels and first simulation step', async () => {
  const saved = createEngine(getPlant('pwr'));
  for (let i = 0; i < 50; i++) saved.step(0.05);
  const h = harness(async () => ({ ok: true, data: pack(saved) }));
  await h.ctx.boot('pwr', null, 'slot');
  assert.equal(h.app.engine.state.t_sim, saved.state.t_sim);
  assert.equal(h.app.engine.recorder, null);
  assert.equal(h.counters.starts, 1);
  assert.equal(h.counters.samples, 1);
});

test('loss leaves only one end dialog; menu and restart clear both', async () => {
  const h = harness();
  await h.ctx.boot('pwr', null);
  h.app.engine.state.destroyed = true;
  h.app.session.step(0.05, [], 0);
  h.app.loop.render(h.app.engine.state, 0);
  assert.equal(h.$('#rs-debrief').hidden, true);
  assert.equal(h.$('#rs-destroyed').hidden, false);
  h.ctx.toMenu();
  assert.equal(h.$('#rs-debrief').hidden, true);
  assert.equal(h.$('#rs-destroyed').hidden, true);
  h.$('#rs-debrief').hidden = false;
  await h.ctx.boot('pwr', null);
  assert.equal(h.$('#rs-debrief').hidden, true);
  assert.equal(h.$('#rs-destroyed').hidden, true);
});

test('scenario loss retains score submission in a single debrief', async () => {
  const h = harness();
  await h.ctx.boot('pwr', { id: 'test', reactor: 'pwr', duration_s: 60,
    demand: [{ t: 0, mw: 1400 }], fail: [{ type: 'fuel_damage' }] });
  h.app.engine.state.destroyed = true;
  h.app.session.step(0.05, [], 0);
  h.app.loop.render(h.app.engine.state, 0);
  assert.equal(h.$('#rs-debrief').hidden, false);
  assert.equal(h.$('#rs-debrief-submit').hidden, false);
  assert.ok(h.app.pendingResult);
  assert.equal(h.$('#rs-destroyed').hidden, true);
});

test('trend sampling captures the same second-long pulse at 1x and 60x', () => {
  const previousRAF = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => {};
  const capture = (speed) => {
    const state = { t_sim: 0, P_e: 0 };
    const engine = { state, spec: { id: 'pwr', P0_e: 100 }, ctx: {}, step(dt) {
      state.t_sim += dt; state.P_e = state.t_sim >= 2 && state.t_sim < 4 ? 100 : 0;
    } };
    const trend = new TrendHistory(engine);
    const loop = new Loop(engine, () => {});
    trend.sample(state, {});
    loop.afterStep = () => trend.sample(state, {});
    loop.running = true; loop.speed = speed; loop.last = 0;
    for (let now = 20; state.t_sim < 59.99; now += 20) loop._frame(now);
    return [...trend.data.pe.slice(0, 60)];
  };
  try {
    const normal = capture(1), fast = capture(60);
    assert.equal(Math.max(...fast), 100);
    assert.deepEqual(fast, normal);
  } finally { globalThis.requestAnimationFrame = previousRAF; }
});

test('tutorial resumes its objective, stays unranked and restarts from preparation', async () => {
  const def = JSON.parse(readFileSync(new URL('../static/data/scenarios/pwr_startup_tutorial.json', import.meta.url)));
  const h = harness();
  await h.ctx.boot('pwr', def);
  for (let i = 0; i < 100; i++) {
    h.app.engine.step(0.05);
    h.app.session.step(0.05, h.app.engine.trips.tiles(), 0);
  }
  assert.equal(h.app.session.tutorial.index, 1);
  const saved = JSON.parse(JSON.stringify(pack(h.app.engine, def.id, h.app.session.run, h.app.session)));
  const resumed = harness(async () => ({ ok: true, data: saved }));
  await resumed.ctx.boot('pwr', def, 'slot');
  assert.equal(resumed.app.session.tutorial.index, 1);
  resumed.app.engine.state.t_sim = 3600;
  resumed.app.session.step(0.05, [], 0);
  assert.equal(resumed.$('#rs-debrief').hidden, false);
  assert.equal(resumed.$('#rs-debrief-submit').hidden, true);
  assert.equal(resumed.$('#rs-debrief-score').textContent, 'tut_unranked_short');
  assert.equal(resumed.app.pendingResult, null);
  await resumed.ctx.boot(resumed.app.lastReactor, resumed.app.lastScenarioDef);
  assert.equal(resumed.app.session.tutorial.index, 0);
  assert.equal(resumed.app.engine.state.rod[0], 1);
  assert.equal(resumed.$('#rs-debrief').hidden, true);
});

test('scenario assistance survives resume and never changes the global helper preference', async () => {
  const defs = ['pwr_feedwater_loss', 'pwr_sg_tube_leak', 'pwr_combined_faults'].map(id =>
    JSON.parse(readFileSync(new URL(`../static/data/scenarios/${id}.json`, import.meta.url))));
  const h = harness();
  h.app.prefs.helper = true;
  for (const def of defs) {
    await h.ctx.boot('pwr', def);
    assert.equal(h.counters.helperEnabled, def.difficulty === 1);
    h.$('#rs-brief .rs-modal-box').scrollTop = 350;
    h.ctx.showBriefing(def);
    assert.equal(h.$('#rs-brief .rs-modal-box').scrollTop, 0);
    assert.equal(h.$('#rs-brief-guidance').hidden, false);
    assert.equal(h.app.session.tutorial, null, 'ordinary scenarios remain ranked');
    assert.equal(h.app.prefs.helper, true);
  }
  const def = defs[2];
  const saved = JSON.parse(JSON.stringify(pack(h.app.engine, def.id, h.app.session.run, h.app.session)));
  const resumed = harness(async () => ({ ok: true, data: saved }));
  await resumed.ctx.boot('pwr', def, 'slot');
  assert.equal(resumed.counters.helperEnabled, false);
  await resumed.ctx.boot('pwr', null);
  assert.equal(resumed.counters.helperEnabled, true);
  h.app.prefs.helper = false;
  await h.ctx.boot('pwr', defs[0]);
  assert.equal(h.counters.helperEnabled, false, 'guided play still respects user preference');
});

test('incident saves keep local evaluation but cannot submit without a complete recorder', async () => {
  const def = JSON.parse(readFileSync(new URL('../static/data/scenarios/pwr_feedwater_loss.json', import.meta.url)));
  const live = harness();
  await live.ctx.boot('pwr', def);
  const saved = JSON.parse(JSON.stringify(pack(live.app.engine, def.id, live.app.session.run, live.app.session)));
  live.$('#rs-debrief .rs-modal-box').scrollTop = 500;
  live.app.session._finish(false, 'fail_objectives_unmet');
  assert.equal(live.$('#rs-debrief .rs-modal-box').scrollTop, 0);
  assert.equal(live.$('#rs-debrief-submit').hidden, false, 'new runs can submit replay-verified results');
  const resumed = harness(async () => ({ ok: true, data: saved }));
  await resumed.ctx.boot('pwr', def, 'slot');
  resumed.app.session._finish(false, 'fail_objectives_unmet');
  assert.equal(resumed.$('#rs-debrief-submit').hidden, true);
  assert.equal(resumed.$('#rs-debrief-msg').textContent, 'incident_local_only');
  assert.ok(resumed.app.pendingResult, 'local score and goals remain available');
});

test('score response updates the displayed result, but cannot replace a later session', async () => {
  const match = source.match(/\$\('#rs-debrief-send'\).addEventListener\('click', \(\) => \{([^]*?)\n  \}\);/);
  assert.ok(match);
  const h = harness();
  const def = JSON.parse(readFileSync(new URL('../static/data/scenarios/pwr_feedwater_loss.json', import.meta.url)));
  await h.ctx.boot('pwr', def);
  h.app.session._finish(false, 'fail_objectives_unmet');
  const result = h.app.pendingResult;
  h.$('#rs-debrief-name').value = 'Test';
  let request = deferred();
  let calls = 0;
  h.ctx.api.submitScore = () => { calls++; return request.promise; };
  vm.runInContext(`function submitTest() {${match[1]}\n}`, h.ctx);
  h.ctx.submitTest();
  const authoritative = { ...result.summary, objectives: result.summary.objectives.map(v => ({ ...v, met: true })),
    completed: true, failed: null };
  request.resolve({ ok: true, data: { summary: authoritative, score: 3250, parts: { ...result.parts, objectives: 2000 } } });
  await Promise.resolve();
  assert.equal(result.score, 3250);
  assert.equal(h.$('#rs-debrief-score').textContent, '3250');
  assert.equal(h.$('#rs-debrief-msg').textContent, 'debrief_sent');
  assert.ok(result.objectives.every(v => v.met && v.achievedAt === null));
  assert.equal(h.$('#rs-debrief-submit').hidden, true);
  request = deferred();
  h.ctx.submitTest();
  await h.ctx.boot('pwr', null);
  request.resolve({ ok: true, data: { summary: authoritative, score: 9999, parts: result.parts } });
  await Promise.resolve();
  assert.equal(result.score, 3250, 'late response cannot overwrite a new run');
  assert.equal(calls, 2);
  h.app.pendingResult = result;
  h.app.engine.recorder = null;
  h.ctx.submitTest();
  assert.equal(calls, 2, 'hidden submission cannot bypass the recorder requirement');
});
