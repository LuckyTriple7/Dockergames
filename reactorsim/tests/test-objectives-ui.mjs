import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const locale = JSON.parse(readFileSync(new URL('../locales/de.json', import.meta.url)));
const def = JSON.parse(readFileSync(new URL('../static/data/scenarios/pwr_feedwater_loss.json', import.meta.url)));
globalThis.window = { RS_I18N: locale, RS_CFG: { lang: 'de' } };
class Node {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = []; this.textContent = ''; this.dataset = {}; this.listeners = {};
    this.attributes = {}; this.open = false;
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  dispatchEvent(event) { this.listeners[event.type]?.(event); }
  toggle() { this.open = !this.open; this.dispatchEvent({ type: 'toggle' }); }
}
globalThis.document = { createElement: tag => new Node(tag) };
const { renderGuidance } = await import('../static/js/ui/guidance.js');
const { renderObjectives, renderObjectiveResult } = await import('../static/js/ui/objectives.js');
const text = node => [node.textContent, ...node.children.map(text)].join(' ');

test('folded goals track holds, achievement and revocation without rebuilding or resetting scroll', () => {
  const host = new Node();
  const writes = [];
  let reads = 0;
  window.localStorage = {
    getItem() { reads++; return 'false'; },
    setItem(...args) { writes.push(args); },
  };
  let views = def.objectives.map(goal => ({ id: goal.id, type: goal.type, held: 0, required: goal.hold_s,
    active: false, met: false, achievedAt: null }));
  let update;
  let registrations = 0;
  renderGuidance(host, def, () => {}, { objectives: { view: () => views },
    render: { add(group, fn) { assert.equal(group, 'text'); registrations++; update = fn; } } });
  const fold = host.children[0];
  assert.equal(fold.tagName, 'DETAILS');
  assert.equal(fold.open, false);
  assert.ok(text(host).includes(locale.obj_waiting));
  assert.ok(text(host).includes(locale.obj_pwr_feedwater_help));
  const originalNodes = [...host.children];
  const originalContent = [...fold.children];
  const criteria = fold.children.find(n => n.tagName === 'SECTION').children.find(n => n.tagName === 'DETAILS');
  criteria.toggle();
  host.scrollTop = 80;
  views = views.map(v => ({ ...v, held: 10, active: true }));
  update();
  assert.ok(text(host).includes('10/120'));
  views = views.map(v => ({ ...v, held: v.required, met: true, achievedAt: 300 }));
  update();
  assert.ok(text(host).includes(locale.obj_met));
  assert.ok(text(host).includes('00:05:00'));
  assert.equal(fold.open, false, 'achievement does not force the fold open');
  fold.toggle();
  assert.ok(text(host).includes(locale.obj_met), 'opening immediately shows current progress');
  assert.ok(text(host).includes('00:05:00'));
  fold.toggle();
  views = views.map(v => ({ ...v, held: 0, met: false }));
  update();
  assert.ok(text(host).includes(locale.obj_lost));
  fold.toggle();
  assert.ok(text(host).includes(locale.obj_lost), 'revocation remains visible after reopening');
  assert.ok(text(host).includes('00:05:00'), 'first achievement is retained');
  for (let i = 0; i < 20; i++) update();
  assert.deepEqual(host.children, originalNodes);
  assert.deepEqual(fold.children, originalContent);
  assert.equal(criteria.open, true, 'inner fold state is retained');
  assert.equal(registrations, 1, 'toggles and ticks do not register another renderer');
  assert.equal(reads, 1);
  assert.deepEqual(writes, [
    ['rs-guidance-open', 'true'], ['rs-guidance-open', 'false'], ['rs-guidance-open', 'true'],
  ], 'only user toggles write storage');
  assert.equal(host.scrollTop, 80, 'progress ticks do not reset reading position');
});

test('briefing, saved-run notice, leak limitations and end results remain explicit', () => {
  const host = new Node();
  renderGuidance(host, def, null, { localOnly: true });
  assert.equal(host.children[0].tagName, 'H2', 'briefing has no outer fold');
  assert.ok(text(host).includes(locale.incident_local_only));
  assert.ok(text(host).includes(locale.obj_rules));
  const leak = JSON.parse(readFileSync(new URL('../static/data/scenarios/pwr_sg_tube_leak.json', import.meta.url)));
  const result = { summary: { scenario: leak.id }, objectives: leak.objectives.map(goal => ({
    id: goal.id, type: goal.type, held: goal.hold_s, required: goal.hold_s, active: true,
    met: true, achievedAt: 400,
  })) };
  const end = new Node();
  renderObjectiveResult(end, result);
  assert.ok(text(end).includes(locale.obj_leak_limit));
  assert.ok(text(end).includes(locale.obj_pwr_power_limited_title));
  assert.ok(text(end).includes('00:06:40'));
  renderGuidance(host, null);
  assert.equal(host.hidden, true);
  assert.equal(host.children.length, 0);
  const legacy = new Node();
  renderObjectiveResult(legacy, { summary: {} });
  assert.equal(legacy.children.length, 0);
});

for (const lang of ['de', 'en']) test(`${lang}: RBMK briefing and results use RBMK criteria without PWR leak text`, () => {
  const translations = JSON.parse(readFileSync(new URL(`../locales/${lang}.json`, import.meta.url)));
  Object.assign(locale, translations);
  const rbmk = JSON.parse(readFileSync(new URL('../static/data/scenarios/rbmk_post_az5.json', import.meta.url)));
  const briefing = new Node();
  renderGuidance(briefing, rbmk, null, { localOnly: true });
  const end = new Node();
  renderObjectiveResult(end, { summary: { scenario: rbmk.id }, objectives: rbmk.objectives.map(g => ({
    id: g.id, type: g.type, held: g.hold_s, required: g.hold_s, active: true, met: true, achievedAt: 1700,
  })) });
  for (const host of [briefing, end]) {
    const content = text(host);
    assert.ok(content.includes(locale.obj_rules));
    assert.ok(content.includes(locale.obj_rbmk_inventory_help));
    assert.ok(content.includes(locale.obj_rbmk_heat_removal_help));
    assert.ok(!content.includes(locale.obj_leak_limit));
    assert.doesNotMatch(content, /Rohrleck|tube leak|DE-|SG |DNBR|140 bis 164|140 to 164|900 s|1080 s/i);
    assert.doesNotMatch(content, /\bobj_\w+|\{\w+\}/);
    assert.match(content, /10\s*%/);
    assert.match(content, /1800 s/);
  }
  assert.ok(text(briefing).includes(locale.incident_local_only));
  assert.ok(text(end).includes('00:28:20'));
  assert.doesNotMatch(locale.obj_rules, /\d|\{\w+\}/, 'no-argument rules work for every duration');

  for (const scenario of ['pwr_feedwater_loss', 'pwr_sg_tube_leak']) {
    const pwr = JSON.parse(readFileSync(new URL(`../static/data/scenarios/${scenario}.json`, import.meta.url)));
    const start = new Node();
    renderObjectives(start, pwr);
    const result = new Node();
    renderObjectiveResult(result, { summary: { scenario }, objectives: pwr.objectives.map(g => ({
      id: g.id, type: g.type, required: g.hold_s, held: 0, active: false, met: false, achievedAt: null,
    })) });
    for (const host of [start, result]) {
      for (const g of pwr.objectives) assert.ok(text(host).includes(locale[`obj_${g.type}_help`]));
      assert.equal(text(host).includes(locale.obj_leak_limit), scenario === 'pwr_sg_tube_leak');
      assert.ok(!text(host).includes(locale.obj_rbmk_inventory_help));
    }
  }
});
