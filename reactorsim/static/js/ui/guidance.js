import { el } from './dom.js';
import { t } from './i18n.js';
import { renderObjectives } from './objectives.js';

export function renderGuidance(host, def, openBriefing, { objectives = null, render = null, localOnly = false } = {}) {
  host.replaceChildren();
  const guidance = def?.guidance;
  host.hidden = !guidance;
  if (!guidance) return;
  host.append(el('h2', { text: `${t('scn_guidance_title')}: ${t('scn_level_' + def.difficulty)}` }));
  renderObjectives(host, def, objectives, render);
  const hint = el('p', { text: t(guidance.hint_key) });
  host.append(def.objectives ? el('details', null, [
    el('summary', { text: t('scn_guidance_title') }), hint,
  ]) : hint,
    el('p.rs-tutorial-hint', { text: [
      t(guidance.event_alerts === false ? 'scn_alerts_off' : 'scn_alerts_on'),
      t(guidance.auto_helper === false ? 'scn_helper_off' : 'scn_helper_on'),
    ].join(' / ') }),
  );
  if (localOnly) host.append(el('p.rs-tutorial-hint', { text: t('incident_local_only') }));
  if (openBriefing) {
    const button = el('button.rs-btn', { type: 'button', text: t('scn_guidance_open') });
    button.addEventListener('click', openBriefing);
    host.append(button);
  }
  host.scrollTop = 0;
}
