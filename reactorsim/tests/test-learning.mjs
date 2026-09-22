import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { record } from '../static/js/game/coreActions.js';
import { noteAction, observeAlarms, learningReport } from '../static/js/game/learning.js';
import { Session } from '../static/js/game/session.js';
import { pack, apply } from '../static/js/net/persist.js';

// Lightweight DOM boundary: render real localized text, not a mocked renderer.
globalThis.window = { RS_I18N: JSON.parse(readFileSync(new URL('../locales/de.json', import.meta.url))), RS_CFG: { lang: 'de' } };
class Node {
  constructor() { this.children = []; this.textContent = ''; }
  append(...children) { this.children.push(...children); }
  setAttribute() {}
}
globalThis.document = { createElement: () => new Node(), createTextNode: text => ({ textContent: text }) };
const { diagnosticData, buildDiagnostics } = await import('../static/js/ui/diagnostics.js');
const { renderLearning, actionText } = await import('../static/js/ui/debrief.js');
const content = n => [n.textContent, ...(n.children || []).map(content)].join(' ');
const engine = (id = 'pwr') => createEngine(getPlant(id));
const alarm = { id: 'flow', key: 'trip_flow_low', tile: 'new', severity: 3 };

test('pump trip distinguishes drive off from coasting flow for all plants', () => {
  for (const id of ['pwr', 'bwr', 'rbmk']) {
    const e = engine(id);
    e.ctx.pumpList[0].trip();
    let row = diagnosticData(e)[0];
    assert.equal(row.requested, false);
    assert.ok(row.flow > 0);
    e.ctx.pumpList[0].step(1000);
    row = diagnosticData(e)[0];
    assert.equal(row.flow, 0);
    assert.ok(e.ctx.pumpList[0].flow() > 0, 'natural circulation is not labelled pump contribution');
  }
});

test('valve command and actual opening remain distinct during travel', () => {
  const e = engine();
  e.ctx.govValve.demand = 0;
  const row = diagnosticData(e).find(r => r.label === 'ctl_gov_valve');
  assert.equal(row.requested, 0);
  assert.ok(row.actual > 0);
  assert.match(content(buildDiagnostics(e).node), /tatsächliche Öffnung/);
});

test('BWR feedback loss hides actual IC position; diesel request does not promise injection', () => {
  const e = engine('bwr');
  e.state.dcPower = false;
  e.state.icDemand = 1;
  e.state.icOpen = false;
  e.state.acPower = false;
  e.state.fireInjOn = true;
  e.step(0.05);
  const rows = diagnosticData(e);
  assert.equal(rows.find(r => r.label === 'ctl_ic').actual, null);
  assert.equal(rows.find(r => r.kind === 'measurement').available, false);
  assert.equal(rows.find(r => r.kind === 'injection').flow, 0);
  assert.match(content(buildDiagnostics(e).node), /Messung ausgefallen/);
  e.state.dcPower = true;
  assert.equal(diagnosticData(e).find(r => r.kind === 'measurement').available, true);
});

test('a boiled-out reference leg is reported as unreliable, not as available', () => {
  const e = engine('bwr');
  assert.equal(diagnosticData(e).find(r => r.kind === 'measurement').biased, false);
  e.state.refLegFill = 0.2;
  assert.equal(diagnosticData(e).find(r => r.kind === 'measurement').biased, true);
  assert.match(content(buildDiagnostics(e).node), /Referenzschenkel/);
});

test('journal survives restore without replay recorder and does not repeat acknowledged alarms', () => {
  const e = engine();
  observeAlarms(e, [alarm]);
  record(e, 'gov_write', 20);
  const restored = engine();
  assert.equal(apply(JSON.parse(JSON.stringify(pack(e))), restored), null);
  observeAlarms(restored, [{ ...alarm, tile: 'ack' }]);
  record(restored, 'gov_write', 30);
  observeAlarms(restored, []);
  assert.deepEqual(learningReport(restored).entries.map(e => e.kind), ['on', 'action', 'off']);
  assert.equal(learningReport(e).entries.at(-1).value, 20, 'snapshot owns its entries');
});

test('opposite rod commands and repeated discrete switches are retained', () => {
  const e = engine();
  for (const v of [1, 1, -1]) noteAction(e, 'rod_jog', v);
  for (const v of [0, 0]) noteAction(e, 'pump_toggle', v);
  assert.equal(learningReport(e).entries.length, 4);
});

test('scenario records actual fired events and final warning without a render tick', () => {
  const e = engine();
  const session = new Session(e, { id: 'test', reactor: 'pwr', duration_s: 1,
    events: [{ id: 'rcp_trip', at: 0, args: { loop: 0 } }] });
  session.start();
  e.state.t_sim = 1;
  session.step(1, [alarm], 0);
  assert.ok(session.result.learning.entries.some(e => e.kind === 'on'));
  assert.ok(session.result.learning.entries.some(e => e.kind === 'event'));
  assert.equal(session.result.summary.learning, undefined);
});

test('debrief shows actions, recovery and timing caveat, with bounded history', () => {
  const e = engine();
  observeAlarms(e, [alarm]);
  record(e, 'scram', null);
  e.state.t_sim = 30;
  observeAlarms(e, []);
  const root = new Node();
  renderLearning(root, learningReport(e));
  const text = content(root);
  assert.match(text, /Erstes aufgezeichnetes Warn-/);
  assert.match(text, /Meldung erloschen/);
  assert.match(text, /30 s zuvor/);
  assert.match(text, /beweist keine Ursache/);
  assert.match(actionText({ id: 'btn:ctl_boron', value: '-1' }), /Verdünnen/);
  assert.match(actionText({ id: 'helper:helper_action_recirc_set', value: { v: 70 } }), /70/);
  for (let i = 0; i < 650; i++) noteAction(e, 'pump_toggle', i % 4);
  assert.equal(learningReport(e).entries.length, 600);
  assert.equal(learningReport(e).truncated, true);
});

test('legacy saves explicitly mark missing journal history', () => {
  const e = engine();
  e.step(1);
  const save = pack(e);
  delete save.learning;
  const target = engine();
  assert.equal(apply(save, target), null);
  assert.equal(learningReport(target).truncated, true);
});
