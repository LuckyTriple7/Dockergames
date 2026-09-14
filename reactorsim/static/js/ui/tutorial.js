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
  const heading = el('h2', { 'aria-live': 'polite' });
  const instruction = el('p');
  const why = el('p');
  const values = el('p.rs-tutorial-values');
  const hold = el('p');
  const hint = el('p.rs-tutorial-hint');
  const checklist = TUTORIAL_STEPS.map(() => el('li'));
  const button = el('button.rs-btn', { type: 'button', text: t('tut_show_panel') });
  button.addEventListener('click', () => {
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
  host.append(heading, instruction, values, hold, hint, button,
    el('details', null, [el('summary', { text: t('tut_why') }), why]),
    el('details', null, [el('summary', { text: t('tut_steps') }), el('ol', null, checklist)]));
  const update = () => {
    const v = tutorial.view();
    if (v.done) { setText(heading, t('tut_completed')); return; }
    setText(heading, t('tut_heading', { n: v.index + 1, total: TUTORIAL_STEPS.length,
      title: t('tut_' + v.id + '_title') }));
    setText(instruction, t('tut_' + v.id + '_instruction'));
    setText(why, t('tut_' + v.id + '_why'));
    const vars = Object.fromEntries(Object.entries(v.values).map(([k, x]) => [k, num(x, k === 'neutron' ? 4 : 1)]));
    setText(values, t('tut_' + v.id + '_values', vars));
    setText(hold, t('tut_hold', { held: Math.floor(v.held), required: v.required }));
    setText(hint, t(v.hint));
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
