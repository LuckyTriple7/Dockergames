import { $, el, setText } from './dom.js';
import { t, has, num, clock } from './i18n.js';
import { TUTORIAL_STEPS } from '../game/tutorial.js';
import { PHASE } from '../game/session.js';

const PANELS = ['prim', 'prim', 'core', 'sec', 'trend'];

export function buildTutorial(session, render) {
  // #rs-tutorial-status and #rs-tutorial-modal are static markup in
  // index.html, not rebuilt per round -- they used to be a full-width
  // banner above the workspace (#rs-tutorial), which even trimmed down
  // still cost a fixed slice of every screen. Now it's a small clickable
  // status text next to the Speichern button; the rest (task text, why,
  // Lernziele, jump-to-panel) shows in the modal, opened for inspection at
  // startup and otherwise through the status button. Buttons are
  // set via .onclick (not addEventListener) because this function reruns
  // every round on the same persistent elements -- a plain assignment
  // replaces the previous round's handler instead of stacking another one.
  const status = $('#rs-tutorial-status');
  const modal = $('#rs-tutorial-modal');
  const modalTitle = $('#rs-tutorial-modal-title');
  const modalInstruction = $('#rs-tutorial-modal-instruction');
  const modalHold = $('#rs-tutorial-modal-hold');
  const modalHint = $('#rs-tutorial-modal-hint');
  const modalWhy = $('#rs-tutorial-modal-why');
  const modalSteps = $('#rs-tutorial-modal-steps');
  const modalPanelBtn = $('#rs-tutorial-modal-panel');
  const modalInspection = $('#rs-tutorial-modal-inspection');
  const modalInspectStatus = $('#rs-tutorial-modal-inspect-status');
  const modalConfirm = $('#rs-tutorial-modal-confirm');
  status.hidden = !session.tutorial;
  modal.hidden = !session.tutorial || session.tutorial.index !== 0;
  if (!session.tutorial) return;
  const tutorial = session.tutorial;
  const prefix = tutorial.prefix;
  const steps = tutorial.steps;
  const checklist = steps.map(() => el('li'));
  modalSteps.replaceChildren(...checklist);
  const inspection = t(prefix + 'inspect_checks').split('\n').map(() => el('li'));
  modalInspection.replaceChildren(...inspection);
  status.onclick = () => { modal.hidden = false; modalTitle.focus(); };
  modalConfirm.onclick = () => {
    if (session.phase !== PHASE.RUNNING) return;
    const confirmed = tutorial.confirmInspect();
    update();
    if (confirmed) modalTitle.focus();
  };
  modalPanelBtn.onclick = () => {
    modal.hidden = true;
    const name = tutorial.engine.spec.id === 'bwr' && tutorial.index === 3
      ? 'prim' : PANELS[Math.min(tutorial.index, PANELS.length - 1)];
    const radio = $('#rs-tab-' + name);
    if (radio) radio.checked = true;
    const panel = $('#rs-p-' + name);
    if (panel) {
      panel.scrollIntoView({ block: 'nearest' });
      const title = panel.querySelector('h2');
      if (title) {
        title.setAttribute('tabindex', '-1');
        title.focus({ preventScroll: true });
        // On a wide desktop grid every panel is already visible and
        // scrollIntoView/focus alone can be too subtle to notice, especially
        // right after the modal that had the button just closed -- flash the
        // header so the jump is actually seen. Restart cleanly on a repeat
        // click within the animation's second.
        title.classList.remove('rs-panel-jump');
        void title.offsetWidth;
        title.classList.add('rs-panel-jump');
        setTimeout(() => title.classList.remove('rs-panel-jump'), 1000);
      }
    }
  };
  const update = () => {
    const v = tutorial.view();
    // Der Bestaetigen-Button gilt fuer jeden confirmIndices-Schritt (die
    // Chernobyl-Uebung nutzt ihn auch fuer 'dip', nicht nur Schritt 0) --
    // die Pruef-Checkliste selbst bleibt an Schritt 0 gebunden, da nur dort
    // 'inspect_checks'/inspectIntact ueberhaupt befuellt sind.
    modalConfirm.hidden = !(tutorial.confirmIndices?.includes(v.index) ?? (v.index === 0));
    modalInspection.hidden = modalInspectStatus.hidden = v.index !== 0;
    modalConfirm.disabled = !v.inspectReady || session.phase !== PHASE.RUNNING;
    if (v.done) {
      // "Anfahren-Tutorial abgeschlossen" (tut_completed) stammt aus der
      // Zeit, als es nur die drei Anfahrtutorials gab -- fuer die
      // Chernobyl-Uebung (kein Anfahren, siehe chernobylTutorial.js) ist das
      // schlicht falsch. Ein eigener, per-prefix ueberschreibbarer Schluessel
      // (siehe tut_chernobyl_completed) faellt sonst auf den alten zurueck.
      setText(status, t(has(prefix + 'completed') ? prefix + 'completed' : 'tut_completed'));
      return;
    }
    const title = t(prefix + v.id + '_title');
    const heading = t('tut_heading', { n: v.index + 1, total: steps.length, title });
    const held = Math.floor(v.held + 1e-8);
    const hold = v.inspectReady ? t('tut_inspect_pending') : t('tut_hold_compact', { held, required: v.required });
    const vars = Object.fromEntries(Object.entries(v.values).map(([k, x]) => [k, num(x, k === 'neutron' ? 4 : 1)]));
    const values = t(prefix + v.id + '_values', vars);
    // Two lines in one small button, see .rs-tutorial-status (white-space: pre-line).
    setText(status, `${heading} · ${hold}\n${values}`);
    setText(modalTitle, heading);
    setText(modalInstruction, t(prefix + v.id + '_instruction'));
    setText(modalHold, t('tut_hold', { held, required: v.required }));
    if (v.index === 0) {
      const lines = t(prefix + 'inspect_checks', { ...vars,
        integrity: t(v.inspectIntact ? 'tut_inspect_intact' : 'tut_inspect_not_intact') }).split('\n');
      inspection.forEach((row, i) => setText(row, lines[i]));
      setText(modalInspectStatus, t(v.inspectReady ? 'tut_inspect_ready'
        : v.inspectValid ? 'tut_inspect_checking' : 'tut_inspect_invalid'));
    }
    setText(modalHint, t(v.hint, vars));
    setText(modalWhy, t(prefix + v.id + '_why'));
    steps.forEach((id, i) => setText(checklist[i], `${t(i < v.index ? 'tut_done' : i === v.index ? 'tut_current' : 'tut_pending')} · ${t(prefix + id + '_title')}`));
  };
  update();
  if (!modal.hidden) modalTitle.focus();
  render.add('text', update);
}

export function renderTutorialResult(parent, result) {
  if (!result?.tutorial) return;
  // `steps`/`prefix` kommen aus session.js -- nur dort ans (ansonsten
  // unveraenderte) Speicherformat von snapshot() angehaengt, siehe
  // tutorial.js. `reactor` allein reicht seit dem Chernobyl-Tutorial nicht
  // mehr: das ist auch ein RBMK-Tutorial, aber mit eigenem Text-Praefix.
  // Fallback auf die alte reactor-Ableitung bzw. die fuenf Anfahrschritte,
  // falls (wie in aelteren Tests) nur ein schlankes Objekt hereinkommt.
  const prefix = result.tutorial.prefix ?? (result.tutorial.reactor === 'rbmk' ? 'tut_rbmk_'
    : result.tutorial.reactor === 'bwr' ? 'tut_bwr_' : 'tut_');
  const steps = result.tutorial.steps ?? TUTORIAL_STEPS;
  parent.append(el('h3', { text: t('tut_steps') }), el('p', { text: t('tut_unranked') }),
    el('ol', null, steps.map(id => {
      const entry = result.tutorial.completed.find(e => e.id === id);
      return el('li', { text: `${t(prefix + id + '_title')} · ${entry ? t('tut_done') + ' ' + clock(entry.t) : t('tut_pending')}` });
    })));
}
