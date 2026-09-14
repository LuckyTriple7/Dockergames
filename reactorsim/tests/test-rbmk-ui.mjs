import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { Session } from '../static/js/game/session.js';
import { captureKit } from '../static/js/game/replayKit.js';

const locales = Object.fromEntries(['de', 'en'].map(lang => [lang,
  JSON.parse(readFileSync(new URL(`../locales/${lang}.json`, import.meta.url)))]));
const table = { ...locales.en };
globalThis.window = { RS_I18N: table, RS_CFG: { lang: 'en' } };
let builds = 0;
class Node {
  constructor(tag = 'div') {
    builds++;
    this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {};
    this.className = ''; this._text = ''; this.open = false;
  }
  get textContent() { return this._text + this.children.map(n => n.textContent).join(' '); }
  set textContent(value) { this._text = String(value); this.children = []; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(key, value) {
    this.attributes[key] = value;
    if (key === 'open') this.open = true;
  }
}
globalThis.document = { createElement: tag => new Node(tag) };
const { buildRbmkFeedDiagnostics, buildDiagnostics, diagnosticData } = await import('../static/js/ui/diagnostics.js');
const { actionText } = await import('../static/js/ui/debrief.js');
const { t, num } = await import('../static/js/ui/i18n.js');
const def = JSON.parse(readFileSync(new URL('../static/data/scenarios/rbmk_post_az5.json', import.meta.url)));
const flow = v => `${num(v, 1)} ${t('unit_kgs')}`;
const mass = v => `${num(v / 1000, 2)} ${t('unit_t')}`;
const row = (view, key) => view.node.children.find(n => n.children[0]?.textContent === t(key)).textContent;

test('feed diagnostics only build for installed equipment; primary diagnostics remain unchanged', () => {
  for (const id of ['pwr', 'bwr', 'rbmk']) {
    const engine = createEngine(getPlant(id));
    const before = builds;
    assert.equal(buildRbmkFeedDiagnostics(engine), null);
    assert.equal(builds, before);
    const primary = buildDiagnostics(engine);
    assert.equal(primary.node.children.filter(n => n.className === 'rs-ctl-block').length, diagnosticData(engine).length);
    assert.ok(!primary.node.textContent.includes(t('diag_rbmk_feed_title')));
  }
});

for (const lang of ['de', 'en']) test(`${lang}: real feed renderer follows requests, availability and physical flows without mutation`, () => {
  Object.assign(table, locales[lang]);
  const engine = createEngine(getPlant('rbmk'), { seed: def.seed });
  assert.equal(buildRbmkFeedDiagnostics(engine), null);
  const session = new Session(engine, def);
  session.start();
  const view = buildRbmkFeedDiagnostics(engine);
  assert.equal(view.node.tagName, 'DETAILS');
  assert.equal(view.node.className, 'rs-diagnostics');
  assert.equal(view.node.open, true);
  assert.ok(row(view, 'ctl_rbmk_aux_feed').includes(t('diag_rbmk_waiting')));
  assert.ok(row(view, 'diag_rbmk_tank').includes(mass(engine.state.auxWaterKg)));
  const map = {};
  const widgets = engine.hooks.uiControls(engine.state, engine.spec, engine.ctx, captureKit(map));
  assert.deepEqual(widgets.map(w => w.mount), ['primary', 'safety', 'secondary']);
  map['write:ctl_rbmk_aux_flow'](50);
  map['btn:ctl_rbmk_aux_feed']('1');
  view.set();
  assert.equal(engine.state.auxFeedOn, false);
  assert.ok(row(view, 'ctl_rbmk_aux_feed').includes(t('diag_rbmk_aux_text', {
    availability: t('diag_rbmk_waiting'), on: t('state_off'), request: '50', actual: flow(0),
  })));
  const step = () => {
    engine.step(0.05);
    session.step(0.05, engine.trips.tiles(), engine.trips.unacknowledgedSeconds());
    engine.drainLog();
  };
  while (engine.state.t_sim < 240.1) step();
  const s = engine.state;
  assert.equal(s.auxFeedAvailable, true);
  assert.equal(s.auxFeedOn, false, 'availability must not turn the feed on');
  view.set();
  assert.ok(row(view, 'ctl_rbmk_aux_feed').includes(t('diag_rbmk_ready')));
  assert.ok(row(view, 'ctl_rbmk_aux_feed').includes(flow(0)));
  assert.equal(s.fwSupplyMax, 15);
  assert.ok(s.W_fwDemand > s.W_fwMain);
  assert.ok(row(view, 'diag_rbmk_main').includes(t('diag_rbmk_main_text', {
    request: flow(s.W_fwDemand), actual: flow(s.W_fwMain), cap: flow(15),
  })));
  map['btn:ctl_rbmk_aux_feed']('1');
  step();
  view.set();
  assert.equal(s.W_fwAux, 110);
  assert.ok(row(view, 'diag_rbmk_tank').includes(t('diag_rbmk_tank_text', {
    remaining: mass(s.auxWaterKg), required: mass(33000),
    runtime: `${num(s.auxWaterKg / s.W_fwAux, 0)} ${t('unit_seconds')}`,
  })));
  assert.ok(row(view, 'diag_rbmk_inventory').includes(mass(s.M_drum)));
  assert.ok(row(view, 'diag_rbmk_balance').includes(t('diag_rbmk_balance_text', {
    feed: flow(s.W_fw), steam: flow(s.W_steam), balance: flow(s.W_fw - s.W_steam),
  })));
  const d = engine.derive();
  assert.ok(row(view, 'diag_rbmk_coolant_heat').includes(`${num(d.coolantHeatMW, 1)} ${t('unit_mwth')}`));
  assert.ok(row(view, 'diag_rbmk_graphite_heat').includes(`${num(d.graphiteHeatMW, 1)} ${t('unit_mwth')}`));
  assert.ok(row(view, 'val_graphite_temp').includes(`${num(d.T_gr - 273.15, 1)} ${t('unit_celsius')}`));
  const heatBefore = row(view, 'diag_rbmk_graphite_heat');
  s.T_gr -= 10;
  view.set();
  assert.notEqual(row(view, 'diag_rbmk_graphite_heat'), heatBefore);
  s.auxWaterKg = 1;
  step();
  step();
  view.set();
  assert.equal(s.auxWaterKg, 0);
  assert.equal(s.W_fwAux, 0);
  assert.equal(s.auxFeedOn, true);
  assert.equal(s.auxFeedDmd, 0.5);
  assert.ok(row(view, 'ctl_rbmk_aux_feed').includes(t('diag_rbmk_aux_text', {
    availability: t('diag_rbmk_ready'), on: t('state_on'), request: '50', actual: flow(0),
  })));
  assert.ok(row(view, 'diag_rbmk_tank').includes(t('diag_rbmk_tank_text', {
    remaining: mass(0), required: mass(10000), runtime: t('diag_rbmk_no_flow'),
  })));
  const stateBefore = structuredClone(s);
  const nodes = [...view.node.children];
  const buildsBefore = builds;
  view.node.open = false;
  for (let i = 0; i < 10; i++) view.set();
  assert.equal(builds, buildsBefore, 'ticks do not build DOM nodes');
  assert.deepEqual(view.node.children, nodes);
  assert.equal(view.node.open, false, 'ticks preserve the fold state');
  assert.deepEqual(s, stateBefore, 'diagnostics do not change physical or requested state');
  assert.equal(s.fwSupplyMax, 15, 'auxiliary feed and rendering do not lift the normal cap');
  for (const value of ['0', '1']) assert.equal(actionText({ id: 'btn:ctl_rbmk_aux_feed', value }),
    `${t('ctl_rbmk_aux_feed')} · ${t(value === '1' ? 'state_on' : 'state_off')}`);
  assert.equal(actionText({ id: 'write:ctl_rbmk_aux_flow', value: 50 }), `${t('ctl_rbmk_aux_flow')} · 50 %`);
  assert.doesNotMatch(view.node.textContent, /\b(?:diag_|ctl_|val_)\w+|\{\w+\}/);
});

test('locales have matching keys and parameters and cover scenario, alarms and objectives', () => {
  assert.deepEqual(Object.keys(locales.de).sort(), Object.keys(locales.en).sort());
  for (const key of Object.keys(locales.en)) {
    assert.deepEqual([...locales.de[key].matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort(),
      [...locales.en[key].matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort(), key);
    assert.ok(locales.de[key].trim() && locales.en[key].trim(), key);
  }
  const keys = [def.title_key, def.brief_key, def.guidance.hint_key,
    ...def.objectives.flatMap(g => [`obj_${g.type}_title`, `obj_${g.type}_help`]),
    ...['feed_limited', 'aux_ready', 'aux_low', 'aux_empty'].flatMap(id =>
      [`alarm_rbmk_${id}`, `alarm_rbmk_${id}_help`]),
    'ev_rbmk_feed_supply_limit', 'ev_rbmk_aux_feed_ready'];
  for (const key of keys) for (const locale of Object.values(locales)) assert.ok(locale[key], key);
});
