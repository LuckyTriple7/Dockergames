import { el, setText } from './dom.js';
import { t, num } from './i18n.js';

// Values come from the same components as the simulation. Pump contribution
// excludes the natural-circulation floor; W_core below includes all flow.
export function diagnosticData(engine) {
  const { state: s, ctx, spec } = engine;
  const rows = (ctx.pumpList || []).map((p, i) => ({
    label: 'ctl_pump', n: i + 1, kind: 'pump',
    requested: p.running, speed: p.speed * 100, flow: p.W0 * p.speed,
    blocked: !!(ctx.pumpsStuck?.has(i) || ctx.recircPumpStuck),
  }));
  for (const [key, label] of [['govValve', 'ctl_gov_valve'], ['bypassValve', 'ctl_bypass']]) {
    const v = ctx[key];
    if (v) rows.push({ label, kind: 'valve', requested: v.demand * 100, actual: v.pos * 100 });
  }
  rows.push({ label: 'val_flow_core', kind: 'flow', flow: s.W_core });
  rows.push({ label: 'val_feed_flow', kind: 'flow', flow: s.W_fw });
  if (spec.id === 'bwr') {
    rows.push({ label: 'ctl_ic', kind: 'switch', requested: !!s.icDemand,
      actual: s.dcPower ? !!s.icOpen : null });
    rows.push({ label: 'val_sg_level', kind: 'measurement', available: s.dcPower });
    rows.push({ label: 'ctl_fire_inj', kind: 'injection', requested: s.fireInjOn,
      flow: s.acPower ? 0 : s.W_fw });
  }
  return rows;
}

export function diagnosticText(r) {
  const on = v => t(v ? 'state_on' : 'state_off');
  const flow = v => `${num(v, 0)} ${t('unit_kgs')}`;
  if (r.kind === 'pump') return t('diag_pump', { request: on(r.requested),
    speed: num(r.speed, 0), flow: flow(r.flow) }) + (r.blocked ? ` · ${t('diag_blocked')}` : '');
  if (r.kind === 'valve') return t('diag_valve', { request: num(r.requested, 0), actual: num(r.actual, 0) });
  if (r.kind === 'switch') return t('diag_switch', { request: on(r.requested),
    actual: r.actual === null ? t('diag_unavailable') : t(r.actual ? 'state_open' : 'state_closed') });
  if (r.kind === 'measurement') return t(r.available ? 'diag_available' : 'diag_frozen');
  if (r.kind === 'injection') return t('diag_injection', { request: on(r.requested), flow: flow(r.flow) });
  return flow(r.flow);
}

export function buildDiagnostics(engine) {
  const rows = diagnosticData(engine);
  const values = rows.map(() => el('span'));
  const node = el('details.rs-diagnostics', { open: true }, [
    el('summary', { text: t('diag_title') }),
    ...rows.map((r, i) => el('div.rs-ctl-block', null, [
      el('b', { text: t(r.label, { n: r.n }) }), el('div', null, [values[i]]),
    ])),
    el('p.rs-ctl-hint', { text: t('diag_flow_note') }),
  ]);
  const set = () => diagnosticData(engine).forEach((r, i) => setText(values[i], diagnosticText(r)));
  set();
  return { node, set };
}

export function buildRbmkFeedDiagnostics(engine) {
  if (!engine.state.auxFeedInstalled) return null;
  const flow = v => `${num(v, 1)} ${t('unit_kgs')}`;
  const mass = v => `${num(v / 1000, 2)} ${t('unit_t')}`;
  const heat = v => `${num(v, 1)} ${t('unit_mwth')}`;
  const rows = [
    ['diag_rbmk_main', s => t('diag_rbmk_main_text', {
      request: flow(s.W_fwDemand), actual: flow(s.W_fwMain), cap: flow(s.fwSupplyMax),
    })],
    ['ctl_rbmk_aux_feed', s => t('diag_rbmk_aux_text', {
      availability: t(s.auxFeedAvailable ? 'diag_rbmk_ready' : 'diag_rbmk_waiting'),
      on: t(s.auxFeedOn ? 'state_on' : 'state_off'),
      request: num(s.auxFeedDmd * 100, 0), actual: flow(s.W_fwAux),
    })],
    ['diag_rbmk_tank', s => t('diag_rbmk_tank_text', {
      remaining: mass(s.auxWaterKg), required: mass(Math.max(10000, s.W_fwAux * 300)),
      runtime: s.W_fwAux === 0 ? t('diag_rbmk_no_flow')
        : `${num(s.auxWaterKg / s.W_fwAux, 0)} ${t('unit_seconds')}`,
    })],
    ['diag_rbmk_inventory', s => mass(s.M_drum)],
    ['diag_rbmk_balance', s => t('diag_rbmk_balance_text', {
      feed: flow(s.W_fw), steam: flow(s.W_steam), balance: flow(s.W_fw - s.W_steam),
    })],
    ['diag_rbmk_coolant_heat', (s, d) => heat(d.coolantHeatMW)],
    ['diag_rbmk_graphite_heat', (s, d) => heat(d.graphiteHeatMW)],
    ['val_graphite_temp', (s, d) => `${num(d.T_gr - 273.15, 1)} ${t('unit_celsius')}`],
  ];
  const values = rows.map(() => el('span'));
  const node = el('details.rs-diagnostics', { open: true }, [
    el('summary', { text: t('diag_rbmk_feed_title') }),
    ...rows.map(([label], i) => el('div.rs-ctl-block', null, [
      el('b', { text: t(label) }), el('div', null, [values[i]]),
    ])),
    el('p.rs-ctl-hint', { text: t('diag_rbmk_feed_note') }),
  ]);
  const set = (d = engine.derive()) => rows.forEach(([, text], i) =>
    setText(values[i], text(engine.state, d)));
  set();
  return { node, set };
}
