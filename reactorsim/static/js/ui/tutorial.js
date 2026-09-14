import { $, el, setText } from './dom.js';
import { t, num, clock } from './i18n.js';
import { TUTORIAL_STEPS } from '../game/tutorial.js';

const PANELS = ['prim', 'prim', 'core', 'sec', 'trend'];

export function buildTutorial(session, render) {
  const host = $('#rs-tutorial');
  host.replaceChildren();
  host.hidden = !session.tutorial;
  if (!session.tutorial) return;
  const tutorial = session.tutorial;
  // Status bar: step heading, live values and the state-dependent hint stay
  // visible at all times -- they change as the player acts. The static
  // per-step instruction, the "why" explanation and the Lernziele checklist
  // only change five times over a whole run, so they move into
  // #rs-tutorial-modal (see below) instead of taking permanent space.
  const heading = el('h2', { 'aria-live': 'polite' });
  const values = el('p.rs-tutorial-values');
  const hold = el('p.rs-tutorial-hint');
  const hint = el('p.rs-tutorial-hint');
  const modal = $('#rs-tutorial-modal');
  const modalTitle = $('#rs-tutorial-modal-title');
  const modalInstruction = $('#rs-tutorial-modal-instruction');
  const modalHold = $('#rs-tutorial-modal-hold');
  const modalWhy = $('#rs-tutorial-modal-why');
  const modalSteps = $('#rs-tutorial-modal-steps');
  const checklist = TUTORIAL_STEPS.map(() => el('li'));
  modalSteps.replaceChildren(...checklist);
  const guideButton = el('button.rs-btn', { type: 'button', text: t('tut_instructions') });
  guideButton.addEventListener('click', () => { modal.hidden = false; });
  const panelButton = el('button.rs-btn', { type: 'button', text: t('tut_show_panel') });
  panelButton.addEventListener('click', () => {
    const name = PANELS[Math.min(tutorial.index, PANELS.length - 1)];
    const radio = $('#rs-tab-' + name);
    if (radio) radio.checked = true;
    const panel = $('#rs-p-' + name);
    if (panel) {
      panel.scrollIntoView({ block: 'nearest' });
      const title = panel.querySelector('h2');
      if (title) { title.setAttribute('tabindex', '-1'); title.focus({ preventScroll: true }); }
    }
  });
  host.append(heading, values, hold, hint, guideButton, panelButton);
  const update = () => {
    const v = tutorial.view();
    if (v.done) { setText(heading, t('tut_completed')); return; }
    const title = t('tut_' + v.id + '_title');
    setText(heading, t('tut_heading', { n: v.index + 1, total: TUTORIAL_STEPS.length, title }));
    const vars = Object.fromEntries(Object.entries(v.values).map(([k, x]) => [k, num(x, k === 'neutron' ? 4 : 1)]));
    setText(values, t('tut_' + v.id + '_values', vars));
    setText(hold, t('tut_hold_compact', { held: Math.floor(v.held), required: v.required }));
    setText(hint, t(v.hint));
    setText(modalTitle, t('tut_heading', { n: v.index + 1, total: TUTORIAL_STEPS.length, title }));
    setText(modalInstruction, t('tut_' + v.id + '_instruction'));
    setText(modalHold, t('tut_hold', { held: Math.floor(v.held), required: v.required }));
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
