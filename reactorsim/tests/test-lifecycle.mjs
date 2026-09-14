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
import { TrendRecorder } from '../static/js/ui/trend.js';
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
    buildPanels() {
      counters.panels++;
      return { horn: { silence() {}, meltdown() {} }, annun: { log() {} },
        sampleTrends() { counters.samples++; } };
    },
    Loop: class {
      constructor(engine, render) { this.engine = engine; this.render = render; }
      stop() {} start() { counters.starts++; } setSpeed(v) { this.speed = v; }
    },
    setSpeed(v) { app.loop.setSpeed(v); },
    loadScores() {}, renderLearning() {},
  });
  for (const name of ['clearEndDialogs', 'toMenu', 'showBriefing', 'showDebrief', 'showDestroyed', 'boot']) {
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
    const trend = Object.assign(Object.create(TrendRecorder.prototype), {
      channels: [{ get: (s) => s.value }], data: [new Float32Array(28800)],
      time: new Float64Array(28800), count: 0, head: 0, nextSample: 0,
    });
    const state = { t_sim: 0, value: 0 };
    const engine = { state, step(dt) {
      state.t_sim += dt; state.value = state.t_sim >= 2 && state.t_sim < 4 ? 100 : 0;
    } };
    const loop = new Loop(engine, () => {});
    trend.sample(state, {});
    loop.afterStep = () => trend.sample(state, {});
    loop.running = true; loop.speed = speed; loop.last = 0;
    for (let now = 20; state.t_sim < 59.99; now += 20) loop._frame(now);
    return [...trend.data[0].slice(0, 60)];
  };
  try {
    const normal = capture(1), fast = capture(60);
    assert.equal(Math.max(...fast), 100);
    assert.deepEqual(fast, normal);
  } finally { globalThis.requestAnimationFrame = previousRAF; }
});
