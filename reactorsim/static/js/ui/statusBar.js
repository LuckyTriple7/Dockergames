// Die waehlbare Kopfzeile des Leitstands.
//
// Eigene Datei, weil sie zwei Einstiege hat: den Leitstand selbst (main.js)
// und den Zweitbildschirm (monitor.js). Beide bauen dieselben Kacheln aus
// demselben Katalog, und beide MUESSEN das tun, bevor buildPanels() laeuft --
// dessen Wertebindungen sammelt es per querySelectorAll('[data-v]') genau
// einmal, aus dem, was zu dem Zeitpunkt im DOM steht.

import { $, el, setText } from './dom.js';
import { t } from './i18n.js';
import { STATUS_STATS } from './statusStats.js';

// Kachel je Katalogeintrag, ueber Rundenstarts hinweg gemerkt: applyStatus-
// Selection() knipst nur hidden um, baut aber nichts neu. Das ist der Grund,
// warum die Einstellungen-Kachel sofort wirkt, ganz ohne Rundenneustart --
// panels.js sammelt seine data-v-Bindungen einmal beim Rundenstart aus dem
// DOM und haette bei neu gebauten Knoten nur die alten weiterbeschrieben,
// unsichtbar, waehrend die neuen fuer immer auf "—" stehen (dieselbe Klasse
// Fehler wie die doppelten Rundinstrumente aus 0.0.30).
let statusTiles = null;

/** Alle 47 moeglichen Kacheln einmal bauen (verdeckt) -- einmal je
 *  Rundenstart, weil buildPanels() gleich danach seine Wertebindungen aus
 *  genau diesem DOM einsammelt. */
export function buildStatusBar() {
  // data-key: haelt fest, welche Kachel welcher Statuswert ist -- die
  // Zeigergesten-Umsortierung (enableDragReorder in initControls()) liest
  // die neue Reihenfolge nur aus dem DOM zurueck, ohne die Map hier zu kennen.
  statusTiles = new Map(STATUS_STATS.map(({ key, labelKey }) => [key,
    el('div.rs-stat', { hidden: true, 'data-key': key }, [
      el('span.rs-stat-k', { text: t(labelKey) }),
      el('span.rs-stat-v', { 'data-v': key, text: '—' }),
    ])]));
  $('#rs-status-scroll').replaceChildren(...statusTiles.values());
}

/** Auswahl anzeigen: nur hidden/Reihenfolge aendern, nie Knoten ersetzen --
 *  wirkt deshalb auch mitten in einer laufenden Runde sofort. */
export function applyStatusSelection(keys) {
  if (!statusTiles) return;
  for (const node of statusTiles.values()) node.hidden = true;
  const scroll = $('#rs-status-scroll');
  keys.forEach((key, i) => {
    const node = statusTiles.get(key);
    if (!node) return;
    node.hidden = false;
    node.classList.toggle('rs-stat-lead', i < 2);
    scroll.append(node); // an den Schluss, in Auswahlreihenfolge
  });
}

/** Eine einzelne Kachel, fuer die Faelle, in denen ihre Aufschrift vom
 *  Reaktortyp abhaengt: DNBR/CPR ist derselbe Wert, er heisst nur je nach
 *  Kern anders (siehe spec.marginKey). */
export function statusTile(key) {
  return statusTiles ? statusTiles.get(key) : null;
}

/** Aufschrift einer Kachel nachziehen, ohne ihren Knoten zu ersetzen. */
export function setStatusTileLabel(key, text) {
  const tile = statusTile(key);
  if (tile) setText($('.rs-stat-k', tile), text);
}
