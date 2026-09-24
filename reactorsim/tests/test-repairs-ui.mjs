// Die Anzeige des Instandhaltungstrupps (ui/repairs.js).
//
// Gebaut wie test-objectives-ui.mjs: ein winziges DOM, damit die Verdrahtung
// wirklich laeuft statt nur gelesen zu werden. Geprueft wird vor allem das
// eine, was diese Anzeige von jeder anderen unterscheidet -- sie baut Knoepfe
// nach, waehrend die Runde laeuft. Ein Knopf, der viermal je Sekunde durch
// einen neuen ersetzt wird, laesst sich nicht druecken, und das sieht man
// einem Bildschirmfoto nicht an.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const locale = JSON.parse(readFileSync(new URL('../locales/de.json', import.meta.url)));
globalThis.window = { RS_I18N: locale, RS_CFG: { lang: 'de' } };

class Node {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = []; this.textContent = ''; this.attributes = {};
    this.className = ''; this.hidden = false; this.disabled = false; this.onclick = null;
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener() {}
  click() { if (!this.disabled && this.onclick) this.onclick(); }
}

const nodes = {};
for (const id of ['rs-repairs', 'rs-repair-help', 'rs-repair-current',
  'rs-repair-cancel', 'rs-repair-list', 'rs-repair-hint']) nodes[id] = new Node();
globalThis.document = {
  createElement: (tag) => new Node(tag),
  createTextNode: (text) => { const n = new Node('#text'); n.textContent = text; return n; },
  querySelector: (sel) => nodes[sel.slice(1)] || null,
};

const { createEngine } = await import('../static/js/sim/engine.js');
const { getPlant } = await import('../static/js/plants/index.js');
const { Session } = await import('../static/js/game/session.js');
const { getEvent } = await import('../static/js/game/events.js');
const { buildRepairs } = await import('../static/js/ui/repairs.js');

const text = (node) => [node.textContent, ...node.children.map(text)].join(' ');

function setup(reactor = 'pwr', level = 'normal') {
  for (const node of Object.values(nodes)) {
    node.children = []; node.textContent = ''; node.hidden = false;
    node.disabled = false; node.onclick = null;
  }
  const engine = createEngine(getPlant(reactor), { n: 1.0 });
  const session = new Session(engine, null, { faults: 'off', dispatch: 'off', repairs: level });
  session.start();
  let update = null;
  let registrations = 0;
  const render = { add(group, fn) { assert.equal(group, 'text'); registrations++; update = fn; } };
  const help = [];
  buildRepairs(session, render, (...args) => help.push(args));
  return { engine, session, update: () => update?.(), help, widgets: () => registrations };
}

function fire(engine, id, args = {}) { getEvent(id).apply(engine, args); }
const rows = () => nodes['rs-repair-list'].children;

test('Ohne Stufe bleibt die Gruppe weg, und es wird nichts verdrahtet', () => {
  const { widgets } = setup('pwr', 'off');
  assert.equal(nodes['rs-repairs'].hidden, true);
  // Kein Widget im Renderlauf: eine ausgeblendete Gruppe viermal je Sekunde
  // neu zu beschriften waere Arbeit fuer niemanden.
  assert.equal(widgets(), 0);
  assert.equal(nodes['rs-repair-current'].textContent, '');
});

test('Ohne offene Arbeit steht da, dass es nichts zu tun gibt', () => {
  const { update } = setup();
  assert.equal(nodes['rs-repairs'].hidden, false);
  assert.equal(nodes['rs-repair-current'].textContent, locale.repair_idle);
  assert.equal(nodes['rs-repair-cancel'].hidden, true);
  assert.deepEqual(rows(), []);
  update();
  assert.deepEqual(rows(), []);
});

test('Je offene Arbeit eine Zeile mit Dauer und Knopf', () => {
  const { engine, update } = setup();
  fire(engine, 'rcp_trip', { loop: 0 });
  fire(engine, 'boron_dilution');
  update();
  assert.equal(rows().length, 2);
  assert.ok(text(rows()[0]).includes('Kühlmittelpumpe 1'));
  assert.ok(text(rows()[0]).includes('12 min'));
  assert.ok(text(rows()[1]).includes(locale.repair_job_boron));
  assert.ok(text(rows()[1]).includes('6 min'));
  assert.ok(nodes['rs-repair-current'].textContent.includes('2'));
  assert.equal(nodes['rs-repair-hint'].textContent, '');
});

test('Die Liste wird nur nachgebaut, wenn sie sich geaendert hat', () => {
  const { engine, update } = setup();
  fire(engine, 'rcp_trip', { loop: 0 });
  update();
  const first = rows()[0];
  for (let i = 0; i < 20; i++) update();
  assert.equal(rows()[0], first, 'Knopf unter dem Mauszeiger ausgetauscht');
  // Kommt eine Arbeit dazu, muss sie erscheinen.
  fire(engine, 'boron_dilution');
  update();
  assert.equal(rows().length, 2);
});

test('Ein gesperrter Knopf nennt seinen Grund und geht wieder auf', () => {
  const { engine, update } = setup('bwr');
  fire(engine, 'station_blackout');
  update();
  assert.equal(rows().length, 1);
  const btn = rows()[0].children[1].children[1];
  assert.equal(btn.disabled, true);
  assert.equal(nodes['rs-repair-hint'].textContent, locale.repair_block_grid);
  // Der gesperrte Knopf tut auch dann nichts, wenn er doch gedrueckt wird.
  btn.click();
  assert.equal(nodes['rs-repair-cancel'].hidden, true);

  engine.state.gridPower = true;
  engine.state.acPower = true;
  update();
  assert.equal(rows()[0].children[1].children[1].disabled, false);
  assert.equal(nodes['rs-repair-hint'].textContent, '');
});

test('Der Knopf schickt den Trupp los, der zweite holt ihn zurueck', () => {
  const { engine, session, update } = setup();
  fire(engine, 'rcp_trip', { loop: 1 });
  update();
  rows()[0].children[1].children[1].click();

  assert.ok(session.repairs.view(), 'kein Trupp unterwegs');
  assert.ok(nodes['rs-repair-current'].textContent.includes('Kühlmittelpumpe 2'));
  assert.ok(nodes['rs-repair-current'].textContent.includes('00:12:00'));
  assert.equal(nodes['rs-repair-cancel'].hidden, false);
  // Waehrend ein Trupp laeuft, steht die Liste still: es gibt nur einen, und
  // ein zweiter Knopf koennte nur "belegt" antworten.
  assert.deepEqual(rows(), []);

  // Die Restzeit laeuft mit der Simulationszeit.
  engine.state.t_sim += 300;
  update();
  assert.ok(nodes['rs-repair-current'].textContent.includes('00:07:00'));

  nodes['rs-repair-cancel'].click();
  assert.equal(session.repairs.view(), null);
  assert.equal(nodes['rs-repair-cancel'].hidden, true);
  assert.equal(rows().length, 1, 'die Arbeit steht wieder zur Wahl');
});

test('Die Ueberschrift oeffnet das Hilfefenster', () => {
  const { help } = setup();
  nodes['rs-repair-help'].click();
  assert.deepEqual(help, [[locale.repair_title, 'repair_help']]);
});
