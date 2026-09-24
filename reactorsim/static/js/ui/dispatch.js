// Der laufende Netzauftrag im Netz-Panel.
//
// Gebaut wie buildTutorial() (ui/tutorial.js): das Markup steht fest in
// index.html und wird nicht je Runde neu erzeugt, diese Funktion hängt sich
// nur an die vorhandenen Knoten und blendet die Gruppe ein oder aus.
//
// Warum hier und nicht im Zielpanel der Szenarien (ui/objectives.js): dessen
// Anzeige lebt in der Einweisung, also in einem Fenster, das das freie Spiel
// nie öffnet (#rs-briefing-btn ist dort ausgeblendet). Ein Auftrag muss
// dauerhaft im Leitstand stehen, und zwar im Netz-Panel -- da stehen
// Klemmenleistung, Anforderung und Abweichung schon, also genau die drei
// Zahlen, gegen die ein Auftrag gelesen wird. Übernommen ist von den
// Szenariozielen die Mechanik, nicht die Darstellung: die Haltezeit läuft
// nach derselben Regel und fällt bei einer Bandverletzung auf null
// (siehe game/dispatch.js).

import { $, setText } from './dom.js';
import { t, num, clock, clockOfDay } from './i18n.js';

export function buildDispatch(session, render, showHelp = null) {
  const host = $('#rs-dispatch');
  if (!host) return;
  const dispatch = session.dispatch;
  host.hidden = !(dispatch && dispatch.active);
  if (host.hidden) return;

  // Die Ueberschrift ist ein Knopf: sie oeffnet dasselbe Hilfefenster wie ein
  // Rundinstrument (buildPanels() gibt showGaugeHelp dafuer heraus). Der Text
  // hat zwei Teile -- die Mechanik des Auftrags, die fuer alle gilt, und was
  // an DIESEM Reaktortyp zu tun ist. Das ist der wichtigere Teil: beim SWR
  // etwa genuegt der Umwaelzstrom nicht, solange die Stabregelung auf
  // Automatik gegenhaelt, und darauf kommt von allein niemand.
  //
  // .onclick statt addEventListener, wie in ui/tutorial.js: diese Funktion
  // laeuft je Runde erneut auf denselben festen Knoten, eine Zuweisung
  // ersetzt den Handler der Vorrunde statt einen zweiten daraufzustapeln.
  const helpBtn = $('#rs-order-help');
  if (helpBtn) {
    helpBtn.onclick = showHelp
      ? () => showHelp(t('order_title'), 'order_help', 'order_help_' + session.engine.spec.id)
      : null;
    helpBtn.disabled = !showHelp;
  }

  const target = $('#rs-order-target');
  const deadline = $('#rs-order-deadline');
  const hold = $('#rs-order-hold');
  const state = $('#rs-order-state');
  const mw = (v) => num(v, 0) + ' ' + t('unit_mwe');

  const update = () => {
    const v = dispatch.view();
    if (!v) {
      // Zwischen zwei Aufträgen: Striche, wie jede andere Kachel ohne Wert.
      setText(target, t('state_none'));
      setText(deadline, t('state_none'));
      setText(hold, t('state_none'));
      setText(state, t('order_none'));
      return;
    }
    setText(target, `${mw(v.mw)} ± ${mw(v.tolMw)}`);
    setText(deadline, clockOfDay(v.wallAtT));
    // Gehaltene gegen geforderte Zeit. Die Nachfrist steht NICHT daneben:
    // sie ist Reserve, keine Vorgabe -- wer sie als zweite Zahl liest, fährt
    // auf sie hin statt auf die Forderung.
    setText(hold, `${clock(v.held)} / ${clock(v.holdS)}`);
    setText(state, t('order_state_' + v.state, { mw: Math.round(v.mw) }));
  };

  update();
  render.add('text', update);
}
