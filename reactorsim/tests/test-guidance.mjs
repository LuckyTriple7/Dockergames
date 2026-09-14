import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Scenario } from '../static/js/game/scenario.js';
import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { Session } from '../static/js/game/session.js';

const defs = ['pwr_feedwater_loss', 'pwr_sg_tube_leak', 'pwr_combined_faults'].map(id =>
  JSON.parse(readFileSync(new URL(`../static/data/scenarios/${id}.json`, import.meta.url))));

test('advance warnings follow assistance, without changing seeded faults or plant physics', () => {
  for (const def of defs) {
    const scn = new Scenario(def);
    const legacy = structuredClone(def);
    delete legacy.guidance;
    assert.deepEqual(scn.events, new Scenario(legacy).events);
    assert.equal(scn.dueAlerts(def.duration_s).length, def.difficulty === 1 ? def.events.length : 0);
    assert.equal(scn.dueAlerts(def.duration_s).length, 0);
    assert.equal(scn.due(def.duration_s).length, def.events.length);
    const restored = new Scenario(def);
    restored.catchUp(def.duration_s);
    assert.deepEqual(restored.dueAlerts(def.duration_s), []);
    assert.deepEqual(restored.due(def.duration_s), []);

    const runs = [def, legacy].map(d => {
      const engine = createEngine(getPlant('pwr'), { seed: d.seed });
      const session = new Session(engine, d);
      let alerts = 0;
      session.onAlert = () => alerts++;
      session.start();
      for (let i = 0; i < 5000; i++) {
        engine.step(0.05);
        session.step(0.05, engine.trips.tiles(), 0);
      }
      return { engine, alerts };
    });
    assert.deepEqual(runs[0].engine.state, runs[1].engine.state);
    assert.equal(runs[0].alerts, def.difficulty === 1 ? runs[1].alerts : 0);
    assert.ok(runs[1].alerts > 0, 'existing scenarios retain their warnings');
  }
});

class Node {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = []; this.textContent = ''; this.listeners = {}; this.dataset = {};
    this.attributes = {}; this.open = false;
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  dispatchEvent(event) { this.listeners[event.type]?.(event); }
  toggle() { this.open = !this.open; this.dispatchEvent({ type: 'toggle' }); }
}
globalThis.window = { RS_I18N: JSON.parse(readFileSync(new URL('../locales/de.json', import.meta.url))), RS_CFG: { lang: 'de' } };
globalThis.document = { createElement: tag => new Node(tag) };
const { renderGuidance } = await import('../static/js/ui/guidance.js');
const text = node => [node.textContent, ...node.children.map(text)].join(' ');
const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);

test('localized guidance is available in briefing and play, then clears on ordinary play', () => {
  const host = new Node();
  let opened = 0;
  for (const def of defs) {
    host.scrollTop = 100;
    renderGuidance(host, def, () => opened++);
    assert.equal(host.scrollTop, 0);
    assert.equal(host.hidden, false);
    assert.ok(text(host).includes(window.RS_I18N[def.guidance.hint_key]));
    assert.ok(text(host).includes(window.RS_I18N['scn_level_' + def.difficulty]));
    assert.ok(text(host).includes(window.RS_I18N[def.guidance.auto_helper ? 'scn_helper_on' : 'scn_helper_off']));
    descendants(host).find(n => n.tagName === 'BUTTON').dispatchEvent({ type: 'click' });
    host.scrollTop = 150;
    renderGuidance(host, def);
    assert.equal(host.scrollTop, 0);
    assert.equal(descendants(host).some(n => n.listeners.click), false);
  }
  assert.equal(opened, 3);
  renderGuidance(host, { id: 'pwr_load_follow' });
  assert.equal(host.hidden, true);
  assert.equal(host.children.length, 0);
  renderGuidance(host, null);
  assert.equal(host.hidden, true);
});

test('runtime wraps all guidance in native details; briefing keeps only the inner folds', async () => {
  let reads = 0;
  let writes = 0;
  window.localStorage = { getItem() { reads++; return null; }, setItem() { writes++; } };
  const { renderGuidance: render } = await import('../static/js/ui/guidance.js?structure');
  const host = new Node();
  render(host, defs[0], null, { localOnly: true });
  assert.equal(reads, 0, 'briefing does not load the runtime preference');
  assert.equal(host.children[0].tagName, 'H2');
  assert.equal(descendants(host).filter(n => n.tagName === 'DETAILS').length, 2);
  render(host, defs[0], () => {}, { localOnly: true });
  assert.equal(host.children.length, 1);
  const fold = host.children[0];
  assert.equal(fold.tagName, 'DETAILS');
  assert.equal(fold.className, 'rs-guidance-fold');
  assert.equal(fold.open, true, 'first use stays open');
  assert.equal(fold.children[0].tagName, 'SUMMARY');
  assert.equal(fold.children[0].children[0].tagName, 'H2');
  assert.equal(text(fold.children[0]).trim(), `${window.RS_I18N.scn_guidance_title}: ${window.RS_I18N.scn_level_1}`);
  assert.deepEqual(fold.children[0].listeners, {}, 'summary uses native mouse and keyboard behavior');
  assert.ok(descendants(fold).some(n => n.tagName === 'SECTION'));
  assert.ok(descendants(fold).some(n => n.tagName === 'BUTTON'));
  assert.ok(text(fold).includes(window.RS_I18N.incident_local_only));
  const inner = descendants(fold).filter(n => n.tagName === 'DETAILS');
  assert.equal(inner.length, 2);
  assert.ok(inner.every(n => !n.open));
  inner[0].toggle();
  fold.dispatchEvent({ type: 'toggle' });
  assert.equal(writes, 0, 'inner and initial toggles do not store a choice');
  fold.toggle();
  render(host, defs[0]);
  assert.equal(host.children[0].tagName, 'H2', 'collapsed runtime does not collapse briefing');
  assert.equal(reads, 1);
});

test('toggle choice survives scenario rebuilds, ordinary play and a module reload', async () => {
  const stored = new Map();
  const writes = [];
  let reads = 0;
  window.localStorage = {
    getItem(key) { reads++; return stored.get(key) ?? null; },
    setItem(key, value) { writes.push([key, value]); stored.set(key, value); },
  };
  const { renderGuidance: render } = await import('../static/js/ui/guidance.js?persistence');
  const host = new Node();
  render(host, defs[0], () => {});
  host.children[0].toggle();
  assert.deepEqual(writes, [['rs-guidance-open', 'false']]);
  for (const def of defs) {
    host.scrollTop = 100;
    render(host, def, () => {});
    assert.equal(host.children[0].open, false);
    assert.equal(host.scrollTop, 0, 'rebuild resets reading position');
  }
  render(host, null);
  render(host, defs[0], () => {});
  assert.equal(host.children[0].open, false);
  assert.equal(reads, 1, 'rebuilds use the in-memory choice');
  const { renderGuidance: reloaded } = await import('../static/js/ui/guidance.js?persistence-reload');
  const freshHost = new Node();
  reloaded(freshHost, defs[1], () => {});
  assert.equal(freshHost.children[0].open, false);
  freshHost.children[0].toggle();
  assert.deepEqual(writes[1], ['rs-guidance-open', 'true']);
  const { renderGuidance: reopened } = await import('../static/js/ui/guidance.js?persistence-reopen');
  reopened(new Node(), defs[0]);
  reopened(host, defs[2], () => {});
  assert.equal(host.children[0].open, true);
});

test('queued toggle from a replaced fold cannot overwrite the current choice', async () => {
  const writes = [];
  window.localStorage = { getItem: () => null, setItem: (...args) => writes.push(args) };
  const { renderGuidance: render } = await import('../static/js/ui/guidance.js?queued-toggle');
  const host = new Node();
  render(host, defs[0], () => {});
  const oldFold = host.children[0];
  render(host, defs[1], () => {});
  host.children[0].toggle();
  oldFold.dispatchEvent({ type: 'toggle' });
  assert.deepEqual(writes, [['rs-guidance-open', 'false']]);
  render(host, defs[2], () => {});
  assert.equal(host.children[0].open, false);
});

test('unavailable storage keeps native toggling and the in-memory choice working', async t => {
  for (const mode of ['missing', 'blocked', 'read-fails', 'write-fails']) {
    await t.test(mode, async () => {
      Object.defineProperty(window, 'localStorage', { configurable: true, get() {
        if (mode === 'blocked') throw new Error('SecurityError');
        if (mode === 'missing') return undefined;
        return {
          getItem() { if (mode === 'read-fails') throw new Error('SecurityError'); return 'true'; },
          setItem() { throw new Error('QuotaExceededError'); },
        };
      } });
      try {
        const { renderGuidance: render } = await import(`../static/js/ui/guidance.js?storage-${mode}`);
        const host = new Node();
        render(host, defs[0], () => {});
        assert.equal(host.children[0].open, true);
        host.children[0].toggle();
        assert.equal(host.children[0].open, false);
        render(host, defs[1], () => {});
        assert.equal(host.children[0].open, false);
        host.children[0].toggle();
        render(host, defs[2], () => {});
        assert.equal(host.children[0].open, true);
      } finally {
        delete window.localStorage;
      }
    });
  }
});

test('disabled automatic fixes cannot be triggered through the hidden button', () => {
  const source = readFileSync(new URL('../static/js/ui/panels.js', import.meta.url), 'utf8');
  const handler = source.match(/fixBtn.addEventListener\('click', \(\) => \{([^]*?)\n  \}\);/);
  assert.ok(handler);
  let calls = 0;
  const context = { helperEnabled: false, helpDef: { id: 'test' },
    runHelper() { calls++; throw new Error('helper must not run'); } };
  vm.runInNewContext(`(() => {${handler[1]}\n})()`, context);
  assert.equal(calls, 0);
});

test('space continues to pause after toolbar clicks and closed dialogs', () => {
  const main = readFileSync(new URL('../static/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /!ev\.target\.closest\?\.\('\.rs-status-controls'\)/);
  assert.match(main, /!nativeControl\.closest\?\.\('\[hidden\]'\)/);
});
