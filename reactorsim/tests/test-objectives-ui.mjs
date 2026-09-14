import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const locale = JSON.parse(readFileSync(new URL('../locales/de.json', import.meta.url)));
const def = JSON.parse(readFileSync(new URL('../static/data/scenarios/pwr_feedwater_loss.json', import.meta.url)));
globalThis.window = { RS_I18N: locale, RS_CFG: { lang: 'de' } };
class Node {
  constructor() { this.children = []; this.textContent = ''; this.dataset = {}; this.listeners = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute() {}
  addEventListener(name, fn) { this.listeners[name] = fn; }
}
globalThis.document = { createElement: () => new Node() };
const { renderGuidance } = await import('../static/js/ui/guidance.js');
const { renderObjectiveResult } = await import('../static/js/ui/objectives.js');
const text = node => [node.textContent, ...node.children.map(text)].join(' ');

test('goals show waiting, holds, achievement and revocation without rebuilding the card', () => {
  const host = new Node();
  let views = def.objectives.map(goal => ({ id: goal.id, type: goal.type, held: 0, required: goal.hold_s,
    active: false, met: false, achievedAt: null }));
  let update;
  renderGuidance(host, def, () => {}, { objectives: { view: () => views },
    render: { add(group, fn) { assert.equal(group, 'text'); update = fn; } } });
  assert.ok(text(host).includes(locale.obj_waiting));
  assert.ok(text(host).includes(locale.obj_pwr_feedwater_help));
  const originalNodes = [...host.children];
  host.scrollTop = 80;
  views = views.map(v => ({ ...v, held: 10, active: true }));
  update();
  assert.ok(text(host).includes('10/120'));
  views = views.map(v => ({ ...v, held: v.required, met: true, achievedAt: 300 }));
  update();
  assert.ok(text(host).includes(locale.obj_met));
  assert.ok(text(host).includes('00:05:00'));
  views = views.map(v => ({ ...v, held: 0, met: false }));
  update();
  assert.ok(text(host).includes(locale.obj_lost));
  assert.deepEqual(host.children, originalNodes);
  assert.equal(host.scrollTop, 80, 'progress ticks do not reset reading position');
});

test('briefing, saved-run notice, leak limitations and end results remain explicit', () => {
  const host = new Node();
  renderGuidance(host, def, null, { localOnly: true });
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
