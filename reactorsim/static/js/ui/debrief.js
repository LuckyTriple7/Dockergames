import { el } from './dom.js';
import { t, num, clock, has } from './i18n.js';

export function actionText(e) {
  const labels = { rod_auto: 'ctl_rod_auto', gov_auto: 'ctl_turbine', fw_auto: 'ctl_feedwater',
    demand_set: 'ctl_demand', gov_write: 'ctl_gov_valve', fw_write: 'ctl_fw_flow',
    scram: 'btn_scram', reset: 'ctl_scram_reset', turbine_resume: 'btn_turbine_resume' };
  if (e.id === 'rod_jog') return `${t('ctl_rods')} · ${t(e.value > 0 ? 'ctl_rod_in' : 'ctl_rod_out')}`;
  if (e.id === 'pump_toggle') return `${t('ctl_pump', { n: Number(e.value) + 1 })} · ${t('learn_toggle')}`;
  const [prefix, key] = e.id.split(':');
  if (prefix === 'helper') return t(key, e.value);
  const label = t(labels[e.id] || (has(key) ? key : 'learn_action'));
  if (prefix === 'auto' || e.id.endsWith('_auto')) return `${label} · ${t(e.value ? 'state_auto' : 'state_manual')}`;
  if (e.id === 'demand_set') return `${label} · ${num(e.value, 0)} ${t('unit_mwe')}`;
  if (prefix === 'write' || e.id.endsWith('_write')) return `${label} · ${num(Number(e.value), 0)} %`;
  if (prefix === 'btn') {
    if (key === 'ctl_boron') return `${label} · ${t(Number(e.value) > 0 ? 'ctl_boron_add' : Number(e.value) < 0 ? 'ctl_boron_dilute' : 'ctl_boron_stop')}`;
    const valve = ['ctl_ic', 'ctl_msiv', 'ctl_porv_block', 'ctl_cont_vent', 'ctl_depressurize'].includes(key);
    return `${label} · ${t(Number(e.value) ? (valve ? 'state_open' : 'state_on') : (valve ? 'state_closed' : 'state_off'))}`;
  }
  return label;
}

export function renderLearning(parent, report) {
  parent.append(el('h3', { text: t('learn_title') }));
  if (!report?.entries?.length) {
    parent.append(el('p', { text: t('learn_empty') }));
    return;
  }
  parent.append(el('p', { text: t('learn_note') }));
  if (report.truncated) parent.append(el('p', { text: t('learn_truncated') }));
  const first = report.entries.find(e => e.kind === 'on' && e.severity >= 2);
  if (first) parent.append(el('p', { text: t('learn_first', { time: clock(first.t), alarm: t(first.key) }) }));
  let lastAction = null;
  const items = report.entries.map(e => {
    if (e.kind === 'action') lastAction = e;
    let text = e.kind === 'action' ? actionText(e) : t(e.key);
    text = `${clock(e.t)} · ${t('learn_' + e.kind)} · ${text}`;
    if (e.kind === 'off' && lastAction && e.t - lastAction.t <= 120) {
      text += ` · ${t('learn_after', { action: actionText(lastAction), seconds: Math.round(e.t - lastAction.t) })}`;
    }
    return el('li', { text });
  });
  parent.append(el('ol.rs-log.rs-learning-log', null, items));
}
