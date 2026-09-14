import { $, el, setText } from './dom.js';
import { t, num, clock } from './i18n.js';
import { TUTORIAL_STEPS } from '../game/tutorial.js';

const PANELS = ['prim', 'prim', 'core', 'sec', 'trend'];

export function buildTutorial(session, render) {
  // #rs-tutorial-status and #rs-tutorial-modal are static markup in
  // index.html, not rebuilt per round -- they used to be a full-width
  // banner above the workspace (#rs-tutorial), which even trimmed down
  // still cost a fixed slice of every screen. Now it's a small clickable
  // status text next to the Speichern button; the rest (task text, why,
  // Lernziele, jump-to-panel) only shows in the modal it opens. Buttons are
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
  status.hidden = !session.tutorial;
  if (!session.tutorial) return;
  const tutorial = session.tutorial;
  const checklist = TUTORIAL_STEPS.map(() => el('li'));
  modalSteps.replaceChildren(...checklist);
  status.onclick = () => { modal.hidden = false; };
  modalPanelBtn.onclick = () => {
    modal.hidden = true;
    const name = PANELS[Math.min(tutorial.index, PANELS.length - 1)];
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
    if (v.done) { setText(status, t('tut_completed')); return; }
    const title = t('tut_' + v.id + '_title');
    const heading = t('tut_heading', { n: v.index + 1, total: TUTORIAL_STEPS.length, title });
    const hold = t('tut_hold_compact', { held: Math.floor(v.held), required: v.required });
    const vars = Object.fromEntries(Object.entries(v.values).map(([k, x]) => [k, num(x, k === 'neutron' ? 4 : 1)]));
    const values = t('tut_' + v.id + '_values', vars);
    // Two lines in one small button, see .rs-tutorial-status (white-space: pre-line).
    setText(status, `${heading} · ${hold}\n${values}`);
    setText(modalTitle, heading);
    setText(modalInstruction, t('tut_' + v.id + '_instruction'));
    setText(modalHold, t('tut_hold', { held: Math.floor(v.held), required: v.required }));
    setText(modalHint, t(v.hint));
    setText(modalWhy, t('tut_' + v.id + '_why'));
    TUTORIAL_STEPS.forEach((id, i) => setText(checklist[i], `${t(i < v.index ? 'tut_done' : i === v.index ? 'tut_current' : 'tut_pending')} · ${t('tut_' + id + '_title')}`));
  };
  update();
  render.add('text', update);
}

export function renderTutorialResult(parent, result) {
  if (!result?.tutorial) return;
  parent.append(el('h3', { text: t('tut_steps') }), el('p', { text: t('tut_unranked') }),
    el('ol', null, TUTORIAL_STEPS.map(id => {
      const entry = result.tutorial.completed.find(e => e.id === id);
      return el('li', { text: `${t('tut_' + id + '_title')} · ${entry ? t('tut_done') + ' ' + clock(entry.t) : t('tut_pending')}` });
    })));
}
