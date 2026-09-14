import { el } from './dom.js';
import { t } from './i18n.js';
import { renderObjectives } from './objectives.js';

const openKey = 'rs-guidance-open';
let guidanceOpen;

export function renderGuidance(host, def, openBriefing, { objectives = null, render = null, localOnly = false } = {}) {
  host.replaceChildren();
  const guidance = def?.guidance;
  host.hidden = !guidance;
  if (!guidance) return;
  const heading = el('h2', { text: `${t('scn_guidance_title')}: ${t('scn_level_' + def.difficulty)}` });
  let content = host;
  if (openBriefing) {
    const fold = el('details.rs-guidance-fold', null, [el('summary', null, [heading])]);
    if (guidanceOpen === undefined) {
      guidanceOpen = true;
      try {
        guidanceOpen = window.localStorage.getItem(openKey) !== 'false';
      } catch { /* Keep the default when storage is unavailable. */ }
    }
    fold.open = guidanceOpen;
    fold.addEventListener('toggle', () => {
      // Initial or detached details can also deliver a queued toggle event.
      if (host.children[0] !== fold || fold.open === guidanceOpen) return;
      guidanceOpen = fold.open;
      try { window.localStorage.setItem(openKey, String(guidanceOpen)); } catch { /* Storage is optional. */ }
    });
    host.append(fold);
    content = fold;
  } else {
    host.append(heading);
  }
  renderObjectives(content, def, objectives, render);
  const hint = el('p', { text: t(guidance.hint_key) });
  content.append(def.objectives ? el('details', null, [
    el('summary', { text: t('scn_guidance_title') }), hint,
  ]) : hint,
    el('p.rs-tutorial-hint', { text: [
      t(guidance.event_alerts === false ? 'scn_alerts_off' : 'scn_alerts_on'),
      t(guidance.auto_helper === false ? 'scn_helper_off' : 'scn_helper_on'),
    ].join(' / ') }),
  );
  if (localOnly) content.append(el('p.rs-tutorial-hint', { text: t('incident_local_only') }));
  if (openBriefing) {
    const button = el('button.rs-btn', { type: 'button', text: t('scn_guidance_open') });
    button.addEventListener('click', openBriefing);
    content.append(button);
  }
  host.scrollTop = 0;
}
