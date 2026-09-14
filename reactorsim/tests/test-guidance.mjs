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
  constructor() { this.children = []; this.textContent = ''; this.listeners = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute() {}
  addEventListener(name, fn) { this.listeners[name] = fn; }
}
globalThis.window = { RS_I18N: JSON.parse(readFileSync(new URL('../locales/de.json', import.meta.url))), RS_CFG: { lang: 'de' } };
globalThis.document = { createElement: () => new Node() };
const { renderGuidance } = await import('../static/js/ui/guidance.js');
const text = node => [node.textContent, ...node.children.map(text)].join(' ');

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
    host.children.find(n => n.listeners.click).listeners.click();
    host.scrollTop = 150;
    renderGuidance(host, def);
    assert.equal(host.scrollTop, 0);
    assert.equal(host.children.some(n => n.listeners.click), false);
  }
  assert.equal(opened, 3);
  renderGuidance(host, { id: 'pwr_load_follow' });
  assert.equal(host.hidden, true);
  assert.equal(host.children.length, 0);
  renderGuidance(host, null);
  assert.equal(host.hidden, true);
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
