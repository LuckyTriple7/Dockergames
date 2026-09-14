import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';

const source = readFileSync(new URL('../static/js/main.js', import.meta.url), 'utf8');
const directory = new URL('../static/data/scenarios/', import.meta.url);
const definitions = readdirSync(directory).filter(name => name.endsWith('.json')).map(file => ({
  file, def: JSON.parse(readFileSync(new URL(file, directory))),
}));
const first = definitions.find(x => x.def.id === 'pwr_feedwater_loss');
const second = definitions.find(x => x.def.id === 'pwr_sg_tube_leak');
const meta = x => ({ id: x.def.id, reactor: x.def.reactor, file: x.file, difficulty: x.def.difficulty,
  title_key: x.def.title_key, duration_s: x.def.duration_s });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const nodes = new Map();
  const node = () => ({ hidden: true, disabled: false, textContent: '', children: [], attrs: {}, listeners: {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(key, value) { this.attrs[key] = value; },
    addEventListener(key, fn) { this.listeners[key] = fn; } });
  const $ = key => { if (!nodes.has(key)) nodes.set(key, node()); return nodes.get(key); };
  const requests = [], catalogs = [], boots = [], briefs = [];
  const app = { bootId: 1, reactor: 'pwr', scenarios: definitions.map(meta) };
  const ctx = vm.createContext({ app, $, window: { RS_CFG: { version: 'test' } },
    t: key => key, setText: (n, v) => { n.textContent = v; },
    setAttr: (n, k, v) => { n.attrs[k] = v; }, el: () => node(),
    fetch(url) { const request = { url, ...deferred() }; requests.push(request); return request.promise; },
    api: { meta() { const request = deferred(); catalogs.push(request); return request.promise; } },
    showBriefing(def) { briefs.push(def); $('#rs-brief').hidden = false; },
    async boot(...args) { boots.push(args); ctx.cancelScenarioLoad(); app.bootId++; },
  });
  for (const name of ['cancelScenarioLoad', 'loadScenario', 'renderScenarios']) {
    const fn = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
    assert.ok(fn, name);
    vm.runInContext(fn[0], ctx);
  }
  const deliver = (request, def) => request.resolve({ ok: true, json: async () => def });
  return { ctx, app, $, requests, catalogs, boots, briefs, deliver };
}

test('all shipped definitions load a briefing without starting a run', async () => {
  const h = harness();
  for (const entry of definitions) {
    const pending = h.ctx.loadScenario(meta(entry));
    assert.equal(h.$('#rs-start-message').textContent, 'scenario_loading');
    h.deliver(h.requests.at(-1), entry.def);
    await pending;
    assert.equal(h.app.briefDef, entry.def);
    assert.equal(h.briefs.at(-1), entry.def);
    assert.equal(h.$('#rs-start-retry').hidden, true);
  }
  assert.equal(h.boots.length, 0);
});

test('HTTP, network and JSON failures stay visible and retry the same scenario', async () => {
  for (const failure of ['http', 'network', 'json']) {
    const h = harness();
    const pending = h.ctx.loadScenario(meta(first));
    const request = h.requests[0];
    if (failure === 'network') request.reject(new Error('offline'));
    else request.resolve({ ok: failure !== 'http', json: async () => { throw new Error('json'); } });
    await pending;
    assert.equal(h.boots.length, 0);
    assert.equal(h.briefs.length, 0);
    assert.equal(h.$('#rs-start-message').textContent, 'scenario_load_failed');
    assert.equal(h.$('#rs-start-retry').hidden, false);
    assert.equal(h.$('#rs-start-retry').disabled, false);
    const intent = h.app.scenarioLoad;
    const retry = h.ctx.loadScenario(intent.scn, intent.savedMeta);
    assert.equal(h.requests[1].url, request.url);
    h.deliver(h.requests[1], first.def);
    await retry;
    assert.equal(h.app.briefDef, first.def);
    assert.equal(h.$('#rs-start-message').textContent, '');
    assert.equal(h.$('#rs-start-retry').hidden, true);
  }
});

test('malformed definitions and wrong identities cannot open a briefing', async () => {
  const invalid = [null, [], {}, { ...first.def, id: second.def.id }, { ...first.def, reactor: 'bwr' },
    { ...first.def, duration_s: 0 }, { ...first.def, demand: [null] }, { ...first.def, events: [null] },
    { ...first.def, fail: [null] }, { ...first.def, objectives: undefined },
    { ...first.def, objectives: [{}, {}] }];
  for (const def of invalid) {
    const h = harness();
    const pending = h.ctx.loadScenario(meta(first));
    h.deliver(h.requests[0], def);
    await pending;
    assert.equal(h.app.briefDef, null);
    assert.equal(h.boots.length, 0);
    assert.equal(h.briefs.length, 0);
    assert.equal(h.$('#rs-start-retry').hidden, false);
  }
});

test('late success, late failure and late JSON cannot replace a new selection or boot', async () => {
  for (const late of ['success', 'error', 'json']) {
    const h = harness();
    const old = h.ctx.loadScenario(meta(first));
    const json = deferred();
    if (late === 'json') { h.requests[0].resolve({ ok: true, json: () => json.promise }); await flush(); }
    const current = h.ctx.loadScenario(meta(second));
    h.deliver(h.requests[1], second.def);
    await current;
    if (late === 'error') h.requests[0].reject(new Error('late'));
    else if (late === 'json') json.resolve(first.def);
    else h.deliver(h.requests[0], first.def);
    await old;
    assert.equal(h.app.briefDef, second.def);
    assert.equal(h.briefs.length, 1);
    assert.equal(h.$('#rs-start-message').textContent, '');
    assert.equal(h.$('#rs-start-retry').hidden, true);
  }
  const h = harness();
  const pending = h.ctx.loadScenario(meta(first));
  await h.ctx.boot('rbmk', null);
  h.deliver(h.requests[0], first.def);
  await pending;
  assert.equal(h.briefs.length, 0);
  assert.equal(h.boots.length, 1);
});

test('changing a reactor or scenario selection cancels outstanding intent', async () => {
  const h = harness();
  h.ctx.renderScenarios('pwr');
  const pending = h.ctx.loadScenario(meta(first));
  h.$('#rs-scn-list').children[0].listeners.click(); // Explicit free-play selection.
  assert.equal(h.app.scenarioLoad, null);
  h.deliver(h.requests[0], first.def);
  await pending;
  assert.equal(h.briefs.length, 0);
  const other = h.ctx.loadScenario(meta(first));
  h.ctx.renderScenarios('bwr');
  h.requests[1].reject(new Error('late'));
  await other;
  assert.equal(h.$('#rs-start-retry').hidden, true);
  assert.equal(h.$('#rs-start-message').textContent, '');
});

test('resume retains exact scenario, reactor, slot and metadata through retry', async () => {
  const h = harness();
  const savedMeta = { slot: 'manual-pwr-slot3', reactor: 'pwr', scenario: first.def.id, saved_at: 1700000000 };
  const pending = h.ctx.loadScenario(meta(first), savedMeta);
  savedMeta.slot = 'wrong';
  h.requests[0].resolve({ ok: false });
  await pending;
  assert.equal(h.boots.length, 0);
  const intent = h.app.scenarioLoad;
  const retry = h.ctx.loadScenario(intent.scn, intent.savedMeta);
  h.deliver(h.requests[1], first.def);
  await retry;
  assert.equal(h.briefs.length, 0);
  assert.equal(h.boots.length, 1);
  assert.deepEqual(h.boots[0].slice(0, 4), ['pwr', first.def, 'manual-pwr-slot3', false]);
  assert.equal(h.boots[0][4].saved_at, 1700000000);
});

test('missing resume metadata reloads the catalog on retry and never falls back to free play', async () => {
  const h = harness();
  const savedMeta = { slot: 'auto-pwr-test', reactor: 'pwr', scenario: first.def.id };
  const scn = { id: first.def.id, reactor: 'pwr' };
  const pending = h.ctx.loadScenario(scn, savedMeta);
  h.catalogs[0].resolve({ ok: true, data: { scenarios: [] } });
  await pending;
  assert.equal(h.$('#rs-start-message').textContent, 'scenario_unavailable');
  assert.equal(h.requests.length, 0);
  assert.equal(h.boots.length, 0);
  const retry = h.ctx.loadScenario(h.app.scenarioLoad.scn, h.app.scenarioLoad.savedMeta);
  h.catalogs[1].resolve({ ok: true, data: { scenarios: [meta(first)] } });
  await flush();
  h.deliver(h.requests[0], first.def);
  await retry;
  assert.equal(h.boots[0][2], savedMeta.slot);
});
