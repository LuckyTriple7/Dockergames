// Anzeige der Haltezeit im Uebungsstatus.
//
// Grund fuer diese Datei: die Haltezeit ist nicht bei jedem Schritt eine
// runde Zahl. 'recover' und 'hold' der Chernobyl-Uebung zielen auf eine
// UHRZEIT und rechnen ihre Dauer in jedem Takt neu aus (chernobylTutorial.js:
// holdSeconds) -- roh angezeigt stand da "0/2289,9500000034 s".

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const locales = JSON.parse(readFileSync(new URL('../locales/de.json', import.meta.url)));
globalThis.window = { RS_I18N: locales, RS_CFG: { lang: 'de' } };

class Node {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.className = '';
    this.hidden = false;
    this.onclick = null;
    this._text = '';
  }
  get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
  append(...nodes) { this.children.push(...nodes.map(n => (typeof n === 'string' ? text(n) : n))); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(k, v) { this.attributes[k] = v; }
  focus() {}
  addEventListener() {}
  removeEventListener() {}
  scrollTo() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
const text = (s) => { const n = new Node('#text'); n.textContent = s; return n; };

// Jede id, die ui/tutorial.js nachschlaegt, bekommt einen eigenen Knoten.
const nodes = new Map();
globalThis.document = {
  createElement: (tag) => new Node(tag),
  createTextNode: text,
  querySelector: (sel) => {
    if (!nodes.has(sel)) nodes.set(sel, new Node('div'));
    return nodes.get(sel);
  },
};

const { createEngine } = await import('../static/js/sim/engine.js');
const rbmk = await import('../static/js/plants/rbmk.js');
const { Session, PHASE } = await import('../static/js/game/session.js');
const { RBMK_CHERNOBYL_TUTORIAL } = await import('../static/js/game/chernobylTutorial.js');
const { buildTutorial } = await import('../static/js/ui/tutorial.js');

const DT = 0.05;
const DEF = {
  id: 'rbmk_chernobyl', reactor: 'rbmk', tutorial: RBMK_CHERNOBYL_TUTORIAL,
  difficulty: 3, title_key: 'x', brief_key: 'x', duration_s: 7200, seed: 26041986,
  demand: [{ t: 0, mw: 0 }, { t: 7200, mw: 0 }], events: [], fail: [{ type: 'fuel_damage' }],
};

test('the hold time is shown in whole seconds, however it was computed', () => {
  const engine = createEngine(rbmk, { seed: DEF.seed });
  const session = new Session(engine, DEF);
  session.start();
  const tut = session.tutorial;
  // buildTutorial() liefert nichts zurueck, es haengt seine Aktualisierung
  // an den Render-Takt (render.add). Hier wird sie abgefangen, damit der
  // Test sie nach dem Vorlauf selbst aufrufen kann.
  let update = null;
  buildTutorial(session, { add: (_kind, fn) => { update = fn; }, panel: () => {} });
  assert.ok(update, 'buildTutorial did not register its update');

  // Bis zum Schritt 'recover' -- dem ersten, dessen Haltezeit aus der Uhr
  // kommt und deshalb krumm ist.
  const target = tut.steps.indexOf('recover');
  for (let i = 0; i < Math.round(3000 / DT); i++) {
    if (session.phase !== PHASE.RUNNING || tut.index >= target) break;
    engine.step(DT);
    session.step(DT, engine.trips.tiles(), 0);
    if (tut.index === 0 && tut.inspectReady) tut.confirmInspect();
  }
  assert.equal(tut.index, target, 'the clock-driven step was not reached');
  // Die Haltezeit selbst ist krumm -- genau deshalb gibt es diese Pruefung.
  const required = tut.view().required;
  assert.ok(!Number.isInteger(required),
    `this step should have a computed, non-integer hold time, got ${required}`);

  update();
  const shown = document.querySelector('#rs-tutorial-status').textContent;
  const compact = shown.match(/(\d+)\/(\d[\d.,]*) s/);
  assert.ok(compact, `no "held/required s" in the status line: ${shown}`);
  for (const part of [compact[1], compact[2]]) {
    assert.ok(/^\d+$/.test(part), `hold time must be whole seconds, got "${part}" in: ${shown}`);
  }
  const modalHold = document.querySelector('#rs-tutorial-modal-hold').textContent;
  assert.ok(!/\d\.\d{3,}|\d,\d{3,}/.test(modalHold),
    `the modal must not show raw fractions either: ${modalHold}`);
});
