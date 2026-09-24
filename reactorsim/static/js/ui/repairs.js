// Der Instandhaltungstrupp in der Meldetafel.
//
// Gebaut wie buildDispatch() (ui/dispatch.js): das feste Markup steht in
// index.html, diese Funktion haengt sich nur daran und blendet die Gruppe ein
// oder aus. Neu ist gegenueber dem Netzauftrag nur eines -- die Liste der
// offenen Arbeiten aendert sich waehrend des Laufs, sie muss also doch
// gebaut werden. Sie wird deshalb nur dann neu gebaut, wenn sich ihre
// ZUSAMMENSETZUNG geaendert hat (siehe signature unten), nicht viermal je
// Sekunde: ein Knopf, der unter dem Mauszeiger verschwindet und als neuer
// Knopf wiederkommt, laesst sich nicht druecken.
//
// Warum in der Meldetafel und nicht im Primaerkreis-Panel neben der Diagnose:
// eine Reparatur ist die Antwort auf eine Stoerung, und anstehende Stoerungen
// stehen hier. Die Diagnose sagt "Pumpe gesperrt" -- der Knopf, der etwas
// dagegen tut, soll nicht in einem anderen Panel stehen als die Meldung, die
// dazu blinkt.

import { $, el, setText } from './dom.js';
import { t, clock } from './i18n.js';

export function buildRepairs(session, render, showHelp = null) {
  const host = $('#rs-repairs');
  if (!host) return;
  const repairs = session.repairs;
  host.hidden = !(repairs && repairs.active);
  if (host.hidden) return;

  // .onclick statt addEventListener, wie in ui/dispatch.js: diese Funktion
  // laeuft je Runde erneut auf denselben festen Knoten, eine Zuweisung
  // ersetzt den Handler der Vorrunde statt einen zweiten daraufzustapeln.
  const helpBtn = $('#rs-repair-help');
  if (helpBtn) {
    helpBtn.onclick = showHelp ? () => showHelp(t('repair_title'), 'repair_help') : null;
    helpBtn.disabled = !showHelp;
  }

  const current = $('#rs-repair-current');
  const cancelBtn = $('#rs-repair-cancel');
  const list = $('#rs-repair-list');
  const hint = $('#rs-repair-hint');

  cancelBtn.onclick = () => { repairs.cancel(); update(); };

  // Woran die Liste erkennt, dass sie sich geaendert hat. Die Bereitschaft
  // gehoert mit hinein: eine Pumpe, die gerade keinen Strom hat, bekommt
  // einen gesperrten Knopf, und der muss aufgehen, sobald der Strom
  // wiederkommt.
  let built = null;
  const signature = (jobs) => jobs.map((j) => `${j.id}:${j.ready ? 1 : 0}`).join('|');

  const renderList = (jobs) => {
    const sig = signature(jobs);
    if (sig === built) return;
    built = sig;
    list.replaceChildren(...jobs.map((j) => {
      const btn = el('button.rs-btn.rs-btn-sm', { type: 'button' },
        [t('btn_repair_order')]);
      btn.disabled = !j.ready;
      btn.onclick = () => { repairs.order(j.id); update(); };
      return el('div.rs-row', null, [
        el('span', { text: t(j.key, j.params) }),
        el('span.rs-repair-actions', null, [
          el('small', { text: t('repair_duration', { min: Math.round(j.minutes) }) }),
          btn,
        ]),
      ]);
    }));
  };

  const update = () => {
    const v = repairs.view();
    const jobs = repairs.jobs();
    if (v) {
      // Waehrend ein Trupp unterwegs ist, steht die Liste still: es gibt nur
      // einen, und ein zweiter Knopf, der nur "belegt" antworten kann, ist
      // kein Angebot, sondern eine Falle.
      setText(current, t('repair_running', {
        job: t(v.key, v.params), rest: clock(v.remainS),
      }));
      cancelBtn.hidden = false;
      built = null;
      list.replaceChildren();
      setText(hint, '');
      return;
    }
    cancelBtn.hidden = true;
    if (!jobs.length) {
      setText(current, t('repair_idle'));
      built = null;
      list.replaceChildren();
      setText(hint, '');
      return;
    }
    setText(current, t('repair_open', { n: jobs.length }));
    renderList(jobs);
    // Ein gesperrter Knopf ohne Begruendung sieht aus wie ein Fehler. Genannt
    // wird der Grund der ERSTEN gesperrten Arbeit -- heute gibt es ohnehin
    // nur einen (kein Motorstrom), und eine Liste von Gruenden neben einer
    // Liste von Knoepfen liest niemand.
    const blocked = jobs.find((j) => !j.ready && j.blockKey);
    setText(hint, blocked ? t(blocked.blockKey) : '');
  };

  update();
  render.add('text', update);
}
