// Stabstellungs-Balken: zeichnet jeder in die Richtung, in die seine Gruppe
// wirklich faehrt?
//
// Anlass: die verkuerzten RBMK-Staebe (USP) fahren als einzige von UNTEN ein
// (plants/rbmk.js: rodBanks, fromBelow). Der Balken zeichnete sie trotzdem
// von oben und trug den Zusatz "von unten" in der Beschriftung -- das Bild
// widersprach also dem Text direkt darunter, und die Beschriftung brauchte
// drei Zeilen, was die Schiene daneben aus der Flucht schob.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const locales = Object.fromEntries(['de', 'en'].map((lang) => [lang,
  JSON.parse(readFileSync(new URL(`../locales/${lang}.json`, import.meta.url)))]));

class ClassList {
  constructor(node) { this.node = node; }
  add(...names) {
    const set = new Set(String(this.node.className).split(' ').filter(Boolean));
    for (const n of names) set.add(n);
    this.node.className = [...set].join(' ');
  }
  contains(name) { return String(this.node.className).split(' ').includes(name); }
}

class Node {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.className = '';
    this.vars = {};
    this._text = '';
    this.classList = new ClassList(this);
    this.style = { setProperty: (k, v) => { this.vars[k] = v; } };
  }
  get textContent() { return this._text + this.children.map((n) => n.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return Object.hasOwn(this.attributes, key) ? this.attributes[key] : null; }
  /** Nur was dieser Test braucht: den ersten Knoten mit dieser Klasse. */
  find(cls) {
    if (this.classList.contains(cls)) return this;
    for (const c of this.children) {
      const hit = c.find ? c.find(cls) : null;
      if (hit) return hit;
    }
    return null;
  }
}

globalThis.window = { RS_I18N: locales.de, RS_CFG: { lang: 'de' } };
globalThis.document = {
  createElement: (tag) => new Node(tag),
  createTextNode: (text) => { const n = new Node('#text'); n.textContent = text; return n; },
};

const { bar } = await import('../static/js/ui/gauges.js');
const { getPlant } = await import('../static/js/plants/index.js');

test('von oben einfahrende Gruppen zeichnen wie bisher', () => {
  const b = bar({ label: 'Regelgruppe' });
  b.set(0.59, 0.6);
  const track = b.node.find('rs-bar-track');
  assert.equal(track.classList.contains('rs-bar-up'), false);
  assert.equal(b.node.find('rs-bar-fill').vars['--rs-f'], 0.59);
  assert.equal(b.node.find('rs-bar-v').textContent, '59 %');
});

test('eine von unten einfahrende Gruppe wird auch von unten gezeichnet', () => {
  const b = bar({ label: 'Verkürzte Gruppe', fromBelow: true });
  b.set(0.43, 0.43);
  // Die Umkehr steckt in der Klasse, nicht im Wert: --rs-f bleibt die
  // Einfahrtiefe, nur der Anker wandert (siehe .rs-bar-up in gauges.css).
  // Waere stattdessen der Wert gespiegelt worden, stuende unter dem Balken
  // "57 %" -- eine Zahl, die es in der Anlage nicht gibt.
  assert.equal(b.node.find('rs-bar-track').classList.contains('rs-bar-up'), true);
  assert.equal(b.node.find('rs-bar-fill').vars['--rs-f'], 0.43);
  assert.equal(b.node.find('rs-bar-v').textContent, '43 %');
});

test('ein Titel haengt am Balken, eine lange Erklaerung nicht an der Beschriftung', () => {
  const b = bar({ label: 'Verkürzte Gruppe', fromBelow: true, title: 'Erklärung' });
  assert.equal(b.node.getAttribute('title'), 'Erklärung');
  assert.equal(b.node.find('rs-bar-k').textContent, 'Verkürzte Gruppe');
  assert.equal(bar({ label: 'X' }).node.getAttribute('title'), null);
});

test('genau eine RBMK-Gruppe faehrt von unten, und die Beschriftungen bleiben kurz', () => {
  const banks = getPlant('rbmk').spec.rodBanks;
  const below = banks.filter((b) => b.fromBelow);
  assert.equal(below.length, 1);
  assert.equal(below[0].id, 'usp');
  assert.equal(below[0].rods, 24);
  // Der Rest kommt von oben -- zusammen die 211 Staebe des RBMK-1000.
  assert.equal(banks.reduce((a, b) => a + b.rods, 0), 211);
  assert.equal(banks.filter((b) => !b.fromBelow).reduce((a, b) => a + b.rods, 0), 187);

  // Die Beschriftung steht unter einer Schiene von rund fuenfzig Pixeln.
  // Was laenger ist, gehoert in den Titel, nicht darunter.
  for (const lang of ['de', 'en']) {
    for (const b of banks) {
      const label = locales[lang]['ctl_rod_bank_' + b.id];
      assert.ok(label, `${lang}: ctl_rod_bank_${b.id} fehlt`);
      assert.ok(label.length <= 20, `${lang}/${b.id}: "${label}" ist zu lang fuer den Balken`);
      assert.ok(locales[lang]['ctl_rod_bank_' + b.id + '_title'],
        `${lang}: ctl_rod_bank_${b.id}_title fehlt`);
    }
  }
});

test('die Erklaerung der verkuerzten Gruppe nennt beide Zahlen', () => {
  for (const lang of ['de', 'en']) {
    const text = locales[lang].ctl_rod_bank_usp_title;
    assert.ok(text.includes('24'), lang);
    assert.ok(text.includes('187'), lang);
  }
});
