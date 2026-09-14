import { el, setText } from './dom.js';
import { t, clock } from './i18n.js';

export function renderObjectives(parent, def, tracker = null, render = null) {
  if (!def?.objectives?.length) return;
  const host = el('section.rs-objectives', { 'aria-label': t('obj_title') });
  const summary = el('p', { 'aria-live': 'polite' });
  const rows = def.objectives.map(goal => ({ goal, node: el('li'), status: el('span'), first: el('small') }));
  for (const { goal, node, status, first } of rows) {
    node.append(el('strong', { text: t('obj_' + goal.type + '_title') }), status, first);
  }
  host.append(el('h3', { text: t('obj_title') }), summary, el('ol', null, rows.map(row => row.node)),
    el('details', null, [el('summary', { text: t('obj_criteria') }),
      el('p', { text: t('obj_rules') }),
      ...def.objectives.map(goal => el('p', { text: t('obj_' + goal.type + '_help') })),
      ...(def.objectives.some(goal => goal.max_power_fraction !== undefined)
        ? [el('p', { text: t('obj_leak_limit') })] : []),
    ]));
  parent.append(host);
  const update = () => {
    const views = tracker ? tracker.view() : def.objectives.map(goal => ({
      id: goal.id, held: 0, required: goal.hold_s, active: false, met: false, achievedAt: null,
    }));
    setText(summary, t('obj_summary', { met: views.filter(v => v.met).length, total: views.length }));
    rows.forEach(({ node, status, first }, i) => {
      const v = views[i];
      node.dataset.met = String(v.met);
      const state = v.met ? t('obj_met') : !v.active ? t('obj_waiting')
        : (v.achievedAt !== null ? t('obj_lost') + ' ' : '')
          + t('obj_holding', { held: Math.floor(v.held + 1e-8), required: v.required });
      setText(status, state);
      setText(first, v.achievedAt !== null ? t('obj_first', { time: clock(v.achievedAt) }) : '');
      first.hidden = v.achievedAt === null;
    });
  };
  update();
  if (tracker && render) render.add('text', update);
}

export function renderObjectiveResult(parent, result) {
  if (!result?.objectives) return;
  renderObjectives(parent, { objectives: result.objectives.map(v => ({
    id: v.id, type: v.type, hold_s: v.required,
    ...(result.summary.scenario === 'pwr_sg_tube_leak' ? { max_power_fraction: 0.1 } : {}),
  })) }, { view: () => result.objectives });
}
