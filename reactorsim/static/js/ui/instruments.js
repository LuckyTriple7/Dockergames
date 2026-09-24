// Instrumentenuebersicht (Taste O).
//
// Eigene Datei, weil sie zwei Einstiege hat: den Leitstand (main.js) und den
// Zweitbildschirm (monitor.js). Auf dem zweiten Schirm ist sie sogar der
// Hauptgrund, ihn aufzustellen -- alle Rundinstrumente nebeneinander, ohne
// Reiterwechsel und ohne dass dafuer im Leitstand etwas passieren muss.

import { $, el } from './dom.js';
import { t } from './i18n.js';

/**
 * Das Fenster einmal verdrahten.
 *
 * @param {() => boolean} isReady Gibt es ueberhaupt schon etwas zu zeigen?
 *   Vor dem ersten Rundenstart -- auf dem Monitor: vor dem ersten Bild --
 *   stehen die Zielknoten leer, und ein leeres Fenster waere nur verwirrend.
 * @param {() => void} [onOpen] Was vor dem Oeffnen noch weichen muss. Im
 *   Leitstand ist das das Panel-Fenster, das sich Knoten aus denselben
 *   Kacheln holt; auf dem Monitor gibt es das gar nicht.
 * @returns {{open: () => void, close: () => void, isOpen: () => boolean}}
 */
export function initInstrumentsWindow(isReady, onOpen = () => {}) {
  // Instrumentenübersicht (Taste O): buendelt die Rundinstrumente
  // (#rs-*-gauges) und alle Stellteile (Staebe, Pumpen, Speisewasser,
  // Sicherheitssysteme, Bor, Netz) aus allen acht Reitern auf einer
  // Flaeche. Dieselbe Verschieben-statt-Kopieren-Regel wie bei
  // openPanelWindow() oben -- jede Karte hier ist der echte Knoten aus
  // seinem Reiter (Wertebindungen aus buildPanels() laufen genau EINMAL
  // gegen diese Knoten, ein Klon liefe stumm mit toten Anzeigen). Anders
  // als openPanelWindow() bewusst NICHT auf Desktop beschraenkt: auf dem
  // Handy zeigt sonst kein Reiter mehrere Kacheln gleichzeitig, dort ist
  // die Buendelung sogar der einzige Weg, Staebe und Pumpen ohne Wechseln
  // nebeneinander zu sehen.
  const instrumentsModal = $('#rs-instruments-modal');
  const instrumentsGrid = $('#rs-instruments-grid');
  // Nur die Gruppen-Optik (Kopfzeile, Innenabstand) wiederverwenden, siehe
  // .rs-group > h3 in panels.css -- eigene Ueberschrift statt der echten
  // <h3> aus dem Reiter, weil mehrere Ziele (Stab-Bedienung, Speisewasser,
  // Sicherheitssysteme) ihre Ueberschrift mit Messwertzeilen teilen, die
  // hier NICHT mitkommen (nur Rundinstrumente + Stellteile, keine reinen
  // Zahlenzeilen, siehe Aufgabenstellung).
  const INSTRUMENT_SECTIONS = [
    [['rs-core-gauges'], 'panel_core'],
    [['rs-prim-gauges'], 'panel_primary'],
    [['rs-sec-gauges'], 'panel_secondary'],
    // Die Stabstellung (rs-rods, dieselben Balken wie im Reiter, inklusive
    // ihrer eigenen %-Anzeige je Bank aus bar() in gauges.js) gehoert mit in
    // dieselbe Karte wie die Stab-Bedienung -- ohne sie liesse sich "Ziehen"/
    // "Einfahren" nur blind bedienen.
    [['rs-rods', 'rs-rod-ctl'], 'panel_core_rods'],
    [['rs-pumps'], 'panel_primary_pumps'],
    [['rs-sec-ctl'], 'panel_secondary_feed'],
    [['rs-safety-ctl'], 'panel_safety'],
    [['rs-chem-ctl'], 'panel_chemistry'],
    [['rs-grid-ctl'], 'panel_grid'],
  ];
  let openInstruments = null; // Array aus { node, placeholder } waehrend das Fenster offen ist

  const close = () => {
    if (!openInstruments) return;
    for (const { node, placeholder } of openInstruments) placeholder.replaceWith(node);
    openInstruments = null;
    instrumentsModal.hidden = true;
    instrumentsGrid.replaceChildren();
  };

  const open = () => {
    // Zweiter Druck auf O schliesst wieder -- ohne Maus die einzige
    // Rueckmeldung darauf, dass die Taste ueberhaupt etwas tut.
    if (openInstruments) { close(); return; }
    // Vor dem ersten Rundenstart stehen die Zielknoten leer (buildPanels()
    // hat sie noch nie gefuellt) -- ein leeres Fenster waere nur verwirrend.
    if (!isReady()) return;
    onOpen();
    openInstruments = [];
    for (const [ids, labelKey] of INSTRUMENT_SECTIONS) {
      // Nicht jeder Typ fuellt jedes Stellteil: RBMK/SWR kennen keine Bor-
      // dosierung (#rs-chem-ctl bleibt leer), der DWR keine Sicherheits-
      // systeme unter #rs-safety-ctl (siehe hooks.uiControls() je Typ in
      // plants/*.js, mount-Namen). Ein leerer Knoten kommt gar nicht erst
      // mit -- eine Karte ganz ohne Inhalt (alle Knoten leer) faellt danach
      // aus wie bisher.
      const nodes = ids.map((id) => $('#' + id)).filter((n) => n && n.childElementCount);
      if (!nodes.length) continue;
      for (const node of nodes) {
        const placeholder = document.createComment('rs-instruments-slot');
        node.before(placeholder);
        openInstruments.push({ node, placeholder });
      }
      instrumentsGrid.append(el('div.rs-group.rs-instruments-section', null, [
        el('h3', { text: t(labelKey) }),
        ...nodes,
      ]));
    }
    instrumentsModal.hidden = false;
  };

  $('#rs-instruments-close').addEventListener('click', close);
  instrumentsModal.addEventListener('click', (ev) => { if (ev.target === instrumentsModal) close(); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !instrumentsModal.hidden) close();
  });

  return { open, close, isOpen: () => !!openInstruments };
}
