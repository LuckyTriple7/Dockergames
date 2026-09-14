// Execute the owned main.js functions unchanged; timers advance only on demand.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { Session, PHASE } from '../static/js/game/session.js';
import { record } from '../static/js/game/coreActions.js';
import { attachRecorder } from '../static/js/game/recorder.js';

const source = readFileSync(new URL('../static/js/main.js', import.meta.url), 'utf8');
function harness(cap) {
  const classes = () => ({ values: new Set(), toggle(key, on) {
    if (on) this.values.add(key); else this.values.delete(key);
  } });
  const nodes = new Map();
  const $ = (key) => {
    if (!nodes.has(key)) nodes.set(key, { hidden: true, disabled: false,
      textContent: '', attrs: {}, classList: classes() });
    return nodes.get(key);
  };
  const buttons = [0, 1, 4, 16, 60].map(speed => ({ dataset: { speed: String(speed) }, classList: classes() }));
  const timers = [];
  const calls = { steps: 0, sessions: 0, samples: 0, renders: 0, destroyed: 0,
    speeds: [], dt: [], faults: [], records: [], marks: [], paused: false };
  const s = { t_sim: 42, X: 2, scram: { active: true }, destroyed: false, fault: null };
  const engine = { state: s, ctx: { log: [], trends: { mark(e) { calls.marks.push(e); } } },
    trips: { tiles: () => [], unacknowledgedSeconds: () => 7 },
    step(dt) { calls.steps++; calls.dt.push(dt); s.t_sim += dt; h.onStep?.(); } };
  const session = { free: true, phase: PHASE.RUNNING,
    step(dt, tiles, unacked) {
      assert.equal(dt, 0.05); assert.deepEqual(tiles, []); assert.equal(unacked, 7);
      calls.sessions++; h.onSession?.();
    },
    abort() { assert.fail('skip must not abort the session'); },
    start() { assert.fail('skip must not restart the session'); } };
  const app = { engine, session, bootId: 1, xenonSkip: null, xenonSkipping: false,
    loop: { speed: 4, setSpeed(v) { this.speed = v; calls.speeds.push(v); } },
    render: { tick(state) { assert.equal(state, app.engine.state); calls.renders++; h.onRender?.(); } },
    sampleTrends() { calls.samples++; h.onSample?.(); } };
  const body = { classList: classes() };
  const ctx = vm.createContext({ app, $, $$: () => buttons, PHASE, document: { body },
    performance: { now: () => 123 },
    setControlsPaused(v) { calls.paused = v; },
    setText(node, text) { if (node) node.textContent = text; },
    setAttr(node, key, value) { if (node) node.attrs[key] = value; },
    t: (key, params) => key + (params ? ':' + JSON.stringify(params) : ''),
    window: { setTimeout(resolve, ms) { assert.equal(ms, 0); timers.push(resolve); } },
    record(e, id, value) { calls.records.push({ engine: e, id, value }); },
    showFault(detail) {
      assert.equal(app.xenonSkip, null, 'fault is shown after cleanup');
      assert.equal(app.xenonSkipping, false);
      calls.faults.push(detail);
    },
    showDestroyed() { calls.destroyed++; app.endShown = true; },
  });
  for (let declaration of source.matchAll(/^const XENON_SKIP_\w+ = .*?;/gm)) {
    let text = declaration[0];
    // Only shorten the safety horizon for cap tests; use production dt/chunks.
    if (cap !== undefined && text.startsWith('const XENON_SKIP_CAP_S')) text = `const XENON_SKIP_CAP_S = ${cap};`;
    vm.runInContext(text, ctx);
  }
  for (const name of ['setSpeed', 'cancelXenonSkip', 'fastForwardXenon', 'triggerScram']) {
    const fn = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
    assert.ok(fn, name);
    vm.runInContext(fn[0], ctx);
  }
  $('#rs-xenon-skip').textContent = 'original skip label';
  const h = { app, ctx, $, calls, timers, buttons, body,
    async chunk() {
      assert.ok(timers.length, 'a deferred chunk exists');
      timers.shift()();
      await Promise.resolve();
    } };
  return h;
}

function cleaned(h, status, speed = 0) {
  assert.equal(h.app.xenonSkip, null);
  assert.equal(h.app.xenonSkipping, false);
  assert.equal(h.$('#rs-xenon-skip').disabled, false);
  assert.equal(h.$('#rs-xenon-skip').textContent, 'original skip label');
  assert.equal(h.$('#rs-xenon-skip-cancel').hidden, true);
  assert.equal(h.$('#rs-xenon-skip-cancel').disabled, false);
  assert.equal(h.$('#rs-xenon-skip-message').textContent, status);
  assert.equal(h.app.loop.speed, speed);
  assert.equal(h.calls.paused, speed === 0);
  assert.equal(h.body.classList.values.has('rs-ctl-paused'), speed === 0);
  if (speed === 0) {
    assert.equal(h.app.engine.ctx.log.length, 0, 'no partial-success event');
    assert.equal(h.calls.marks.length, 0, 'no partial-success timeline marker');
  }
}

test('first yield paints cancellation UI; cancel is immediate and preserves state', async () => {
  const h = harness();
  const { engine, session } = h.app;
  const pending = h.ctx.fastForwardXenon();
  const token = h.app.xenonSkip;
  assert.equal(token.engine, engine);
  assert.equal(token.session, session);
  assert.equal(token.bootId, 1);
  assert.equal(token.cancelled, false, 'initial pause must not self-cancel');
  assert.equal(h.calls.steps, 0);
  assert.equal(h.app.loop.speed, 0);
  assert.equal(h.$('#rs-xenon-skip').disabled, true);
  assert.equal(h.$('#rs-xenon-skip-cancel').hidden, false);
  assert.equal(h.$('#rs-xenon-skip-cancel').textContent, 'btn_xenon_skip_cancel');
  assert.equal(h.$('#rs-xenon-skip-message').attrs.role, 'status');
  assert.equal(h.$('#rs-xenon-skip-message').textContent, 'xenon_skip_running');
  assert.equal(h.ctx.cancelXenonSkip(), true);
  assert.equal(token.cancelled, true);
  assert.equal(h.app.xenonSkip, token, 'lock persists until the continuation exits');
  h.ctx.setSpeed(60);
  assert.equal(h.app.loop.speed, 0);
  await h.chunk();
  await pending;
  assert.equal(h.app.engine, engine);
  assert.equal(h.app.session, session);
  assert.equal(engine.state.t_sim, 42);
  assert.equal(h.calls.steps, 0);
  assert.equal(h.calls.renders, 1);
  cleaned(h, 'xenon_skip_cancelled');
  assert.equal(h.ctx.cancelXenonSkip(), false);
  h.ctx.setSpeed(4);
  assert.equal(h.app.loop.speed, 4, 'explicit resume works after cancellation');
});

test('positive speeds are ignored; Space/pause via setSpeed(0) cancels after a chunk', async () => {
  const h = harness();
  const pending = h.ctx.fastForwardXenon();
  for (const v of [1, 4, 16, 60]) h.ctx.setSpeed(v);
  assert.deepEqual(h.calls.speeds, [0]);
  assert.equal(h.buttons[0].classList.values.has('rs-on'), true);
  await h.chunk();
  assert.equal(h.calls.steps, 2000);
  assert.equal(h.calls.sessions, 2000);
  assert.equal(h.calls.samples, 2000);
  assert.ok(h.calls.dt.every(dt => dt === 0.05));
  assert.ok(Math.abs(h.app.engine.state.t_sim - 142) < 1e-8);
  assert.match(h.$('#rs-xenon-skip').textContent, /^btn_xenon_skip_progress:/);
  const time = h.app.engine.state.t_sim;
  h.ctx.setSpeed(0);
  assert.equal(h.app.xenonSkip.cancelled, true);
  await h.chunk();
  await pending;
  assert.equal(h.app.engine.state.t_sim, time);
  assert.equal(h.calls.renders, 1);
  cleaned(h, 'xenon_skip_cancelled');
});

test('SCRAM records the action but cancels and never resumes an active skip', async () => {
  const h = harness();
  const pending = h.ctx.fastForwardXenon();
  h.ctx.triggerScram();
  assert.equal(h.app.xenonSkip.cancelled, true);
  assert.equal(h.calls.records.length, 1);
  assert.equal(h.calls.records[0].engine, h.app.engine);
  assert.equal(h.calls.records[0].id, 'scram');
  assert.equal(h.calls.records[0].value, null);
  assert.ok(h.calls.speeds.every(v => v === 0));
  await h.chunk();
  await pending;
  cleaned(h, 'xenon_skip_cancelled');
  h.ctx.triggerScram();
  assert.equal(h.app.loop.speed, 1, 'ordinary SCRAM retains existing behavior');
});

test('invalid starts and reentrant calls are no-ops', async () => {
  for (const change of [
    h => { h.app.engine = null; }, h => { h.app.session = null; },
    h => { h.app.loop = null; }, h => { h.app.session.free = false; },
    h => { h.app.session.phase = PHASE.BRIEFING; }, h => { h.app.session.phase = PHASE.DEBRIEF; },
    h => { h.app.engine.state.scram.active = false; }, h => { h.app.engine.state.X = 1; },
    h => { h.app.engine.state.X = NaN; }, h => { h.app.engine.state.destroyed = true; },
    h => { h.app.engine.state.fault = 'fault'; }, h => { h.app.xenonSkipping = true; },
    h => { h.app.xenonSkip = {}; },
  ]) {
    const h = harness(); change(h);
    await h.ctx.fastForwardXenon();
    assert.equal(h.calls.steps, 0);
    assert.equal(h.timers.length, 0);
    assert.equal(h.calls.speeds.length, 0);
    assert.equal(h.$('#rs-xenon-skip').disabled, false);
  }
  const h = harness();
  const pending = h.ctx.fastForwardXenon();
  const token = h.app.xenonSkip;
  await h.ctx.fastForwardXenon();
  assert.equal(h.app.xenonSkip, token);
  assert.equal(h.timers.length, 1);
  h.ctx.cancelXenonSkip();
  await h.chunk(); await pending;
});

test('every identity guard protects replacement UI, including a cancelled old-token snapshot', async () => {
  for (const replacement of ['bootId', 'engine', 'session', 'operation', 'cleared']) {
    const h = harness();
    const pending = h.ctx.fastForwardXenon();
    const old = h.app.xenonSkip;
    if (replacement === 'bootId') h.app.bootId++;
    if (replacement === 'engine') h.app.engine = { ...h.app.engine };
    if (replacement === 'session') h.app.session = { ...h.app.session };
    if (replacement === 'operation') h.app.xenonSkip = { ...old };
    if (replacement === 'cleared') {
      old.cancelled = true;
      h.app.bootId++;
      h.app.session = { ...h.app.session };
      h.app.xenonSkip = null;
    }
    h.app.xenonSkipping = false;
    h.app.loop.speed = 16;
    h.$('#rs-xenon-skip').textContent = 'new round';
    h.$('#rs-xenon-skip').disabled = true;
    h.$('#rs-xenon-skip-cancel').hidden = false;
    h.$('#rs-xenon-skip-message').textContent = 'new message';
    const current = h.app.xenonSkip;
    await h.chunk(); await pending;
    assert.equal(h.calls.steps, 0, replacement);
    assert.equal(h.calls.renders, 0, replacement);
    assert.equal(h.app.xenonSkip, current, replacement);
    assert.equal(h.app.xenonSkipping, false, replacement);
    assert.equal(h.app.loop.speed, 16, replacement);
    assert.equal(h.$('#rs-xenon-skip').textContent, 'new round', replacement);
    assert.equal(h.$('#rs-xenon-skip').disabled, true, replacement);
    assert.equal(h.$('#rs-xenon-skip-cancel').hidden, false, replacement);
    assert.equal(h.$('#rs-xenon-skip-message').textContent, 'new message', replacement);
    assert.equal(h.calls.faults.length, 0);
  }
});

test('goal stops at the exact inner tick and logs/marks only actual completion', async () => {
  const h = harness();
  h.onStep = () => { if (h.calls.steps === 3) h.app.engine.state.X = 1; };
  const pending = h.ctx.fastForwardXenon();
  await h.chunk(); await pending;
  assert.equal(h.calls.steps, 3);
  assert.equal(h.calls.sessions, 3);
  assert.equal(h.calls.renders, 1);
  cleaned(h, 'xenon_skip_complete', 1);
  assert.equal(h.app.engine.ctx.log.length, 1);
  assert.equal(h.calls.marks.length, 1);
  const event = h.app.engine.ctx.log[0];
  assert.equal(event.key, 'event_time_skip');
  assert.equal(event.t, h.app.engine.state.t_sim);
  assert.equal(h.calls.marks[0].t, event.t);
  assert.equal(h.calls.marks[0].kind, 'event');
});

test('cap stops exactly within a chunk, stays paused, and is not a success', async () => {
  const h = harness(0.5);
  const pending = h.ctx.fastForwardXenon();
  await h.chunk(); await pending;
  assert.equal(h.calls.steps, 10);
  assert.equal(h.calls.dt.reduce((a, b) => a + b, 0).toFixed(2), '0.50');
  assert.equal(h.calls.renders, 1);
  cleaned(h, 'xenon_skip_limit');
});

test('goal on the last permitted tick is a success, not a limit failure', async () => {
  const h = harness(0.5);
  h.onStep = () => { if (h.calls.steps === 10) h.app.engine.state.X = 1; };
  const pending = h.ctx.fastForwardXenon();
  await h.chunk(); await pending;
  assert.equal(h.calls.steps, 10);
  cleaned(h, 'xenon_skip_complete', 1);
});

test('phase, fault, destruction and cancellation stop with elevated xenon, at yield and inner tick', async () => {
  for (const where of ['yield', 'step']) {
    for (const reason of ['phase', 'fault', 'destroyed', 'cancel']) {
      const h = harness();
      const end = () => {
        if (reason === 'phase') h.app.session.phase = PHASE.DEBRIEF;
        if (reason === 'fault') h.app.engine.state.fault = 'simulation fault';
        if (reason === 'destroyed') h.app.engine.state.destroyed = true;
        if (reason === 'cancel') h.ctx.cancelXenonSkip();
      };
      const pending = h.ctx.fastForwardXenon();
      if (where === 'yield') end(); else h.onSession = end;
      await h.chunk(); await pending;
      assert.equal(h.calls.steps, where === 'yield' ? 0 : 1);
      assert.equal(h.app.engine.state.X, 2);
      assert.equal(h.calls.renders, 1);
      cleaned(h, reason === 'phase' || reason === 'cancel' ? 'xenon_skip_cancelled' : '');
    }
  }
});

test('phase, fault, destruction and cancellation beat a coincident goal, at yield and inner tick', async () => {
  for (const where of ['yield', 'step']) {
    for (const reason of ['phase', 'fault', 'destroyed', 'already-shown', 'cancel']) {
      const h = harness();
      const end = () => {
        h.app.engine.state.X = 1;
        if (reason === 'phase') h.app.session.phase = PHASE.DEBRIEF;
        if (reason === 'fault') h.app.engine.state.fault = 'simulation fault';
        if (reason === 'destroyed' || reason === 'already-shown') {
          h.app.engine.state.destroyed = true;
          h.app.session.phase = PHASE.DEBRIEF;
          h.app.endShown = reason === 'already-shown';
        }
        if (reason === 'cancel') h.ctx.cancelXenonSkip();
      };
      const pending = h.ctx.fastForwardXenon();
      if (where === 'yield') end(); else h.onSession = end;
      await h.chunk(); await pending;
      assert.equal(h.calls.steps, where === 'yield' ? 0 : 1);
      assert.equal(h.calls.renders, 1);
      cleaned(h, reason === 'phase' || reason === 'cancel' ? 'xenon_skip_cancelled' : '');
      assert.deepEqual(h.calls.faults, reason === 'fault' ? ['simulation fault'] : []);
      assert.equal(h.calls.destroyed, reason === 'destroyed' ? 1 : 0);
    }
  }
});

test('exceptions resolve without rejection, clean flags/buttons and show the crash after cleanup', async () => {
  for (const boundary of ['onStep', 'onSession', 'onSample', 'onRender']) {
    const h = harness();
    h[boundary] = () => { throw new Error(boundary); };
    // Reach the final render without completing a whole chunk.
    if (boundary === 'onRender') h.onStep = () => { h.app.engine.state.X = 1; };
    const pending = h.ctx.fastForwardXenon();
    await h.chunk();
    await assert.doesNotReject(pending);
    cleaned(h, '');
    assert.equal(h.calls.faults.length, 1);
    assert.match(h.calls.faults[0], /^fault_crash_detail:/);
    assert.ok(h.calls.faults[0].includes(boundary));
    assert.ok(h.calls.steps <= 1);
    assert.equal(h.calls.renders, boundary === 'onRender' ? 1 : 0);
  }
});

test('old operation throwing after a new boot cannot clean or fault the new round', async () => {
  const h = harness();
  h.onSession = () => {
    h.app.xenonSkip.cancelled = true;
    h.app.xenonSkip = null;
    h.app.xenonSkipping = false;
    h.app.bootId++;
    h.$('#rs-xenon-skip').textContent = 'new round';
    throw new Error('old session');
  };
  const pending = h.ctx.fastForwardXenon();
  await h.chunk(); await assert.doesNotReject(pending);
  assert.equal(h.calls.faults.length, 0);
  assert.equal(h.calls.renders, 0);
  assert.equal(h.$('#rs-xenon-skip').textContent, 'new round');
});

test('real DWR engine and free session run two chunks, then SCRAM cancels without state loss', async () => {
  const h = harness();
  const engine = createEngine(getPlant('pwr'), { seed: 1 });
  attachRecorder(engine);
  const session = new Session(engine, null);
  session.start();
  record(engine, 'scram', null);
  engine.state.X = 1.5;
  h.app.engine = engine;
  h.app.session = session;
  h.ctx.record = record;
  h.app.sampleTrends = () => engine.ctx.trends.sample();
  const pending = h.ctx.fastForwardXenon();
  await h.chunk(); await h.chunk();
  const time = engine.state.t_sim;
  assert.ok(Math.abs(time - 200) < 1e-7);
  assert.equal(engine.state.fault, null);
  assert.equal(engine.state.destroyed, false);
  assert.equal(session.phase, PHASE.RUNNING);
  assert.ok(engine.ctx.trends.count >= 200);
  h.ctx.triggerScram();
  assert.equal(h.app.xenonSkip.cancelled, true);
  await h.chunk(); await pending;
  assert.equal(h.app.engine, engine);
  assert.equal(h.app.session, session);
  assert.equal(engine.state.t_sim, time);
  assert.equal(h.app.loop.speed, 0);
  assert.equal(h.$('#rs-xenon-skip-message').textContent, 'xenon_skip_cancelled');
  assert.equal(h.app.xenonSkip, null);
  assert.equal(h.calls.renders, 1);
  assert.equal(engine.ctx.log.some(e => e.key === 'event_time_skip'), false);
  assert.equal(engine.ctx.trends.markers.some(e => e.key === 'event_time_skip'), false);
  assert.ok(engine.ctx.trends.markers.some(e => e.id === 'scram' && e.t === time));
});
