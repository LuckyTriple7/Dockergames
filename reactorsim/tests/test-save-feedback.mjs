// Exercise the actual main.js save region, not a second implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { pack } from '../static/js/net/persist.js';
import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { Session } from '../static/js/game/session.js';

const source = readFileSync(new URL('../static/js/main.js', import.meta.url), 'utf8');
const region = source.slice(source.indexOf('function saveSlotName('), source.indexOf('\nfunction showFault('));
assert.ok(region.includes('function resetSaveStatus('));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class Node {
  constructor(children = []) {
    this.children = children;
    this.hidden = true;
    this.disabled = false;
    this.textContent = children.filter(x => typeof x === 'string').join('');
    this.attrs = {};
    this.listeners = {};
  }
  replaceChildren(...children) { this.children = children; }
  append(child) { this.children.push(child); }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  click() { return this.disabled ? undefined : this.listeners.click?.(); }
}

function harness() {
  const nodes = new Map();
  const $ = key => {
    if (!nodes.has(key)) nodes.set(key, new Node());
    return nodes.get(key);
  };
  const writes = [], lists = [], deletes = [], packs = [];
  let refreshes = 0;
  let now = 1700000000000;
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const app = { engine: null, session: null, bootId: 0, lastReactor: null,
    scenarios: [{ id: 'test', title_key: 'scn_test' }], scenariosPromise: Promise.resolve() };
  let timerSeq = 0;
  const timers = new Map();
  const win = {
    setTimeout(fn) { const id = ++timerSeq; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const api = {
    writeSave(slot, snapshot) {
      const request = { ...deferred(), slot, snapshot };
      writes.push(request);
      return request.promise;
    },
    listSaves() {
      const request = deferred();
      lists.push(request);
      return request.promise;
    },
  };
  const ctx = vm.createContext({ app, api, $, Date: FakeDate, window: win,
    packSave(...args) { packs.push(args); return pack(...args); },
    t: (key, params) => params ? key + ':' + JSON.stringify(params) : key,
    setText: (node, text) => { if (node) node.textContent = text; },
    setAttr: (node, name, value) => { if (node) node.attrs[name] = value; },
    el: (spec, attrs, children) => new Node(children),
    refreshResumeList() { refreshes++; },
    makeDeleteSaveButton(slot, callback) {
      deletes.push({ slot, callback });
      return new Node();
    },
  });
  vm.runInContext(region, ctx);
  function round(reactor = 'pwr') {
    app.bootId++;
    app.lastReactor = reactor;
    app.engine = createEngine(getPlant(reactor));
    app.session = new Session(app.engine, null);
    ctx.resetSaveStatus();
  }
  round();
  return { ctx, app, api, $, writes, lists, deletes, packs, round,
    tick: () => { now += 10000; },
    get refreshes() { return refreshes; },
    state: () => vm.runInContext('saveStatus', ctx),
    queueSize: () => vm.runInContext('[...saveWriteQueues.values()].reduce((n, q) => n + q.length, 0)', ctx),
    last: () => $('#rs-save-last').textContent,
    status: () => $('#rs-save-state').textContent,
    message: () => $('#rs-save-slots-message').textContent,
    buttons: () => $('#rs-slot-list').children.map(row => row.children[0]),
    saveBtn: () => $('#rs-save').attrs,
    pendingTimers: () => timers.size,
    runTimers: () => { const fns = [...timers.values()]; timers.clear(); for (const fn of fns) fn(); },
  };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const listResult = saves => ({ ok: true, data: { saves } });
async function showSlots(h, saves = []) {
  const pending = h.ctx.openSaveSlots();
  h.lists.at(-1).resolve(listResult(saves));
  assert.equal(await pending, true);
}

test('success/failure/success keeps last backup and persistent error until recovery', async () => {
  const h = harness();
  assert.equal(h.last(), 'save_none');
  const first = h.ctx.saveCurrentGame();
  assert.equal(h.status(), 'save_pending');
  assert.equal(h.last(), 'save_none');
  await flush();
  h.writes[0].resolve({ ok: true });
  assert.equal(await first, true);
  assert.match(h.last(), /save_kind_auto/);
  assert.equal(h.saveBtn()['data-flash-ok'], 'true', 'success flashes the button green');
  assert.equal(h.saveBtn()['data-error'], 'false');
  h.runTimers();
  assert.equal(h.saveBtn()['data-flash-ok'], 'false', 'flash clears itself again');
  const last = h.last();
  const failed = h.ctx.saveManualGame('manual-pwr-slot1');
  assert.equal(h.last(), last);
  await flush();
  h.writes[1].resolve({ ok: false });
  assert.equal(await failed, false);
  h.tick();
  h.ctx.renderSaveStatus();
  assert.equal(h.last(), last);
  assert.equal(h.status(), 'save_failed');
  assert.equal(h.$('#rs-save-status').attrs['data-error'], 'true');
  assert.equal(h.saveBtn()['data-error'], 'true', 'button stays red on failure, no timer needed');
  const recovered = h.ctx.saveManualGame('manual-pwr-slot1');
  assert.equal(h.last(), last);
  assert.match(h.status(), /save_failed/, 'failure remains explicit while retry is pending');
  assert.equal(h.$('#rs-save-status').attrs['data-error'], 'true');
  await flush();
  h.writes[2].resolve({ ok: true });
  assert.equal(await recovered, true);
  assert.equal(h.status(), '');
  assert.match(h.last(), /save_kind_manual/);
  assert.equal(h.$('#rs-save-status').attrs['data-error'], 'false');
  assert.equal(h.saveBtn()['data-error'], 'false', 'recovery clears the red state');
  assert.equal(h.saveBtn()['data-flash-ok'], 'true', 'recovery flashes green again');
});

test('rapid consecutive successes restart the green flash timer instead of stacking it', async () => {
  const h = harness();
  const first = h.ctx.saveCurrentGame();
  await flush();
  h.writes[0].resolve({ ok: true });
  await first;
  assert.equal(h.pendingTimers(), 1);
  const second = h.ctx.saveManualGame('manual-pwr-slot1');
  await flush();
  h.writes[1].resolve({ ok: true });
  await second;
  assert.equal(h.pendingTimers(), 1, 'the earlier flash timer was cancelled, not left running alongside a new one');
  h.runTimers();
  assert.equal(h.saveBtn()['data-flash-ok'], 'false');
});

test('reset only accepts dated save metadata; no invented save on restore', () => {
  const h = harness();
  for (const meta of [null, {}, { slot: 'auto-pwr-free' },
    { slot: 'manual-pwr-slot1', saved_at: '1700000000' },
    { slot: 'auto', saved_at: -1 }, { slot: 'auto', saved_at: Infinity },
    { slot: 'auto', saved_at: 1.5 }, { slot: 'auto', saved_at: 1e20 },
    { slot: 'unrecognized', saved_at: 1700000000 }]) {
    const before = h.state();
    h.ctx.resetSaveStatus(meta);
    assert.notEqual(h.state(), before);
    assert.equal(h.last(), 'save_none');
  }
  for (const slot of ['auto', 'auto-pwr-free', 'manual-pwr-slot2', 'manual-pwr-legacy']) {
    h.ctx.resetSaveStatus({ slot, saved_at: 1600000000 });
    const params = JSON.parse(h.last().slice('save_last_success:'.length));
    assert.equal(params.when, new Date(1600000000000).toLocaleString());
    assert.equal(params.kind, slot.startsWith('auto') ? 'save_kind_auto' : 'save_kind_manual');
  }
});

test('reset isolates pending completions even with the same engine and boot id', async () => {
  const h = harness();
  const old = h.ctx.saveCurrentGame();
  await flush();
  h.ctx.resetSaveStatus();
  const current = h.state();
  const next = h.ctx.saveManualGame('manual-pwr-slot1');
  await flush();
  h.writes[0].resolve({ ok: false });
  assert.equal(await old, false);
  assert.equal(h.state(), current);
  assert.equal(current.pending, true);
  assert.equal(current.failed, false);
  assert.equal(h.last(), 'save_none');
  h.writes[1].resolve({ ok: true });
  assert.equal(await next, true);
});

test('per-slot FIFO survives round changes and snapshots capture trigger-time engine/session/scenario', async () => {
  const h = harness();
  const slot = 'manual-pwr-slot1';
  const first = h.ctx.saveManualGame(slot);
  const oldEngine = h.app.engine;
  const oldSession = h.app.session;
  oldSession.scenario = { id: 'test' };
  oldEngine.state.t_sim = 25;
  oldEngine.ctx.history.push({ t: 25, key: 'old' });
  const second = h.ctx.saveManualGame(slot);
  oldEngine.state.t_sim = 99;
  oldEngine.ctx.history[0].key = 'mutated';
  h.round();
  h.app.engine.state.t_sim = 7;
  const third = h.ctx.saveManualGame(slot);
  const current = h.state();
  await flush();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].snapshot.t_sim, 0);
  assert.equal(h.packs[1][0], oldEngine);
  assert.equal(h.packs[1][1], 'test');
  assert.equal(h.packs[1][3], oldSession);
  h.writes[0].resolve({ ok: true });
  await first; await flush();
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].snapshot.t_sim, 25);
  assert.equal(h.writes[1].snapshot.scenario, 'test');
  assert.equal(h.writes[1].snapshot.history[0].key, 'old');
  assert.equal(h.last(), 'save_none');
  assert.equal(current.pending, true);
  h.writes[1].reject(new Error('offline'));
  assert.equal(await second, false);
  await flush();
  assert.equal(h.writes.length, 3);
  assert.equal(h.writes[2].snapshot.t_sim, 7);
  assert.equal(current.pending, true);
  assert.equal(current.failed, false);
  h.writes[2].resolve({ ok: true });
  assert.equal(await third, true);
  assert.equal(h.queueSize(), 0);
});

test('autosave pending deduplication and queue limits bound stalled writes across rounds', async () => {
  const h = harness();
  const first = h.ctx.saveCurrentGame();
  for (let n = 0; n < 100; n++) assert.equal(h.ctx.saveCurrentGame(), first);
  assert.equal(h.packs.length, 1);
  assert.equal(h.queueSize(), 1);
  const pending = [first];
  const limit = vm.runInContext('SAVE_SLOT_QUEUE_LIMIT', h.ctx);
  for (let n = 1; n < limit; n++) {
    h.round();
    pending.push(h.ctx.saveCurrentGame());
  }
  h.round();
  assert.equal(await h.ctx.saveCurrentGame(), false);
  assert.equal(h.status(), 'save_failed');
  assert.equal(h.queueSize(), limit);
  for (let n = 0; n < limit; n++) {
    await flush();
    assert.equal(h.writes.length, n + 1);
    h.writes[n].resolve({ ok: true });
    await pending[n];
  }
  assert.equal(h.queueSize(), 0);
  assert.equal(h.status(), 'save_failed');
  const recovery = h.ctx.saveCurrentGame();
  await flush();
  h.writes.at(-1).resolve({ ok: true });
  assert.equal(await recovery, true);
});

test('new failure survives older cross-slot success; older success never replaces newer success', async () => {
  const h = harness();
  const older = h.ctx.saveCurrentGame();
  const newer = h.ctx.saveManualGame('manual-pwr-slot1');
  await flush();
  assert.equal(h.writes.length, 2, 'different slots may write concurrently');
  h.writes[1].resolve({ ok: false });
  await newer;
  h.writes[0].resolve({ ok: true });
  await older;
  assert.equal(h.status(), 'save_failed');
  assert.match(h.last(), /save_kind_auto/);
  const slow = h.ctx.saveCurrentGame();
  const fast = h.ctx.saveManualGame('manual-pwr-slot1');
  await flush();
  h.writes[3].resolve({ ok: true });
  await fast;
  const last = h.last();
  h.tick();
  h.writes[2].resolve({ ok: true });
  await slow;
  assert.equal(h.last(), last);
  assert.equal(h.status(), '');
});

test('older failure cannot disturb a newer pending request or successful result', async () => {
  const h = harness();
  const first = h.ctx.saveCurrentGame();
  const second = h.ctx.saveManualGame('manual-pwr-slot1');
  await flush();
  h.writes[0].resolve({ ok: false });
  await first;
  assert.equal(h.status(), 'save_pending');
  h.writes[1].resolve({ ok: true });
  await second;
  const third = h.ctx.saveCurrentGame();
  const fourth = h.ctx.saveManualGame('manual-pwr-slot1');
  await flush();
  h.writes[3].resolve({ ok: true });
  await fourth;
  const last = h.last();
  h.writes[2].resolve({ ok: false });
  await third;
  assert.equal(h.status(), '');
  assert.equal(h.last(), last);
});

test('pack/serialization/write throws and refused saves resolve false without poisoning the queue', async () => {
  const h = harness();
  const originalPack = h.ctx.packSave;
  h.ctx.packSave = () => { throw new Error('pack'); };
  assert.equal(await h.ctx.saveCurrentGame(), false);
  assert.equal(h.status(), 'save_failed');
  h.ctx.packSave = () => { const cycle = {}; cycle.self = cycle; return cycle; };
  assert.equal(await h.ctx.saveCurrentGame(), false);
  assert.equal(h.writes.length, 0);
  h.ctx.packSave = originalPack;
  const originalWrite = h.api.writeSave;
  h.api.writeSave = () => { throw new Error('write'); };
  const first = h.ctx.saveManualGame('manual-pwr-slot1');
  const second = h.ctx.saveManualGame('manual-pwr-slot1');
  assert.equal(await first, false);
  assert.equal(await second, false);
  h.api.writeSave = originalWrite;
  const final = h.ctx.saveManualGame('manual-pwr-slot1');
  await flush();
  h.writes[0].resolve({ ok: true });
  assert.equal(await final, true);
  const last = h.last();
  h.app.engine = null;
  assert.equal(await h.ctx.saveCurrentGame(), false);
  assert.equal(h.status(), 'save_failed');
  assert.equal(h.last(), last);
  assert.equal(h.queueSize(), 0);
});

test('slot list opens with loading, shows failures without invented slots, and permits retry', async () => {
  const h = harness();
  const first = h.ctx.openSaveSlots();
  assert.equal(h.$('#rs-save-slots').hidden, false);
  assert.equal(h.message(), 'save_list_loading');
  h.lists[0].resolve({ ok: false });
  assert.equal(await first, false);
  assert.equal(h.message(), 'save_list_failed');
  assert.equal(h.buttons().length, 0);
  assert.equal(h.$('#rs-save-slots-retry').hidden, false);
  assert.equal(h.$('#rs-save-slots-retry').textContent, 'btn_retry');
  const retry = h.ctx.openSaveSlots();
  assert.equal(h.$('#rs-save-slots-retry').hidden, true);
  h.lists[1].reject(new Error('offline'));
  assert.equal(await retry, false);
  await showSlots(h, [{ slot: 'manual-pwr-slot2', saved_at: 1600000000, scenario: 'test' }]);
  assert.equal(h.buttons().length, 10);
  assert.match(h.buttons()[0].textContent, /save_slot_free/);
  assert.match(h.buttons()[1].textContent, /save_slot_used.*scn_test/);
  assert.equal(h.message(), '');
});

test('stale list responses cannot reopen closed dialogs or overwrite a newer view', async () => {
  const h = harness();
  const first = h.ctx.openSaveSlots();
  h.ctx.closeSaveSlots();
  h.lists[0].resolve(listResult([]));
  assert.equal(await first, false);
  assert.equal(h.$('#rs-save-slots').hidden, true);
  const old = h.ctx.openSaveSlots();
  await showSlots(h);
  const button = h.buttons()[0];
  h.lists[1].resolve({ ok: false });
  assert.equal(await old, false);
  assert.equal(h.buttons()[0], button);
  assert.equal(h.message(), '');
  const staleRound = h.ctx.openSaveSlots();
  h.round('bwr');
  h.lists.at(-1).resolve(listResult([]));
  assert.equal(await staleRound, false);
  assert.equal(h.$('#rs-save-slots').hidden, true);
});

test('manual failure leaves buttons available for retry; success closes and refreshes only its view', async () => {
  const h = harness();
  await showSlots(h, [{ slot: 'manual-pwr-slot1', saved_at: 1600000000 }]);
  const button = h.buttons()[0];
  const failed = button.click();
  assert.equal(h.message(), 'save_pending');
  assert.ok(h.$('#rs-slot-list').children.every(row => row.children.every(btn => btn.disabled)));
  button.listeners.click(); // Even programmatic rapid clicks are guarded.
  await flush();
  assert.equal(h.writes.length, 1);
  h.writes[0].resolve({ ok: false });
  await failed;
  assert.equal(h.message(), 'save_failed');
  assert.equal(h.$('#rs-save-slots').hidden, false);
  assert.ok(h.buttons().every(btn => !btn.disabled));
  const success = button.click();
  await flush();
  h.writes[1].resolve({ ok: true });
  await success;
  assert.equal(h.$('#rs-save-slots').hidden, true);
  assert.equal(h.refreshes, 1);
});

test('wrong-reactor/session/boot/view buttons cannot write or refresh another round', async () => {
  for (const change of [h => h.round('bwr'), h => { h.app.bootId++; },
    h => { h.app.session = {}; }, h => { h.app.lastReactor = 'bwr'; },
    h => { h.app.engine = createEngine(getPlant('pwr')); },
    h => h.ctx.closeSaveSlots()]) {
    const h = harness();
    await showSlots(h, [{ slot: 'manual-pwr-slot1', saved_at: 1600000000 }]);
    const button = h.buttons()[0];
    change(h);
    await button.click();
    h.deletes[0].callback();
    await flush();
    assert.equal(h.writes.length, 0);
    assert.equal(h.lists.length, 1, 'stale delete callback must not refresh');
  }
  for (const change of [h => h.round('bwr'), h => h.ctx.closeSaveSlots(), h => showSlots(h)]) {
    const h = harness();
    await showSlots(h);
    const pending = h.buttons()[0].click();
    await flush();
    await change(h);
    const hidden = h.$('#rs-save-slots').hidden;
    const message = h.message();
    h.writes[0].resolve({ ok: true });
    await pending;
    assert.equal(h.$('#rs-save-slots').hidden, hidden);
    assert.equal(h.message(), message);
    assert.equal(h.refreshes, 0);
  }
});

test('current delete callback refreshes the list; synchronous list failure is retryable', async () => {
  const h = harness();
  await showSlots(h, [{ slot: 'manual-pwr-slot1', saved_at: 1600000000 }]);
  h.deletes[0].callback();
  assert.equal(h.lists.length, 2);
  assert.equal(h.message(), 'save_list_loading');
  h.lists[1].resolve(listResult([]));
  await flush();
  assert.equal(h.buttons().length, 10);
  h.api.listSaves = () => { throw new Error('list'); };
  assert.equal(await h.ctx.openSaveSlots(), false);
  assert.equal(h.message(), 'save_list_failed');
  assert.equal(h.buttons().length, 0);
  assert.equal(h.$('#rs-save-slots-retry').hidden, false);
});
