// Educational journal, independent of the replay recorder and render cadence.
const CAP = 600;
export function journal(engine) {
  return engine.ctx.learning ||= { entries: [], active: {}, truncated: false };
}

function append(engine, entry) {
  const j = journal(engine);
  j.entries.push({ t: engine.state.t_sim, ...entry });
  engine.ctx.trends?.mark({ t: engine.state.t_sim, ...entry });
  if (j.entries.length > CAP) { j.entries.shift(); j.truncated = true; }
}

export function noteAction(engine, id, value) {
  if (id === 'ack') return;
  const j = journal(engine);
  const last = j.entries.at(-1);
  // Coalesce a continuous slider/rod gesture, keeping its final request.
  const continuous = id.startsWith('write:') || id.endsWith('_write') || id === 'demand_set'
    || (id === 'rod_jog' && last?.value === value);
  if (continuous && last?.kind === 'action' && last.id === id && engine.state.t_sim - last.t < 2) {
    last.value = value;
    last.t = engine.state.t_sim;
    // Trend history coalesces independently of the journal.
    engine.ctx.trends?.mark({ t: engine.state.t_sim, kind: 'action', id, value });
  } else append(engine, { kind: 'action', id, value });
}

export function noteEvent(engine, key) { append(engine, { kind: 'event', key }); }

export function observeAlarms(engine, tiles) {
  const j = journal(engine);
  const active = {};
  for (const tile of tiles) {
    if (tile.tile !== 'new' && tile.tile !== 'ack') continue;
    active[tile.id] = tile.key;
    if (!(tile.id in j.active)) append(engine, { kind: 'on', key: tile.key, severity: tile.severity });
  }
  for (const [id, key] of Object.entries(j.active)) {
    if (!(id in active)) append(engine, { kind: 'off', key });
  }
  j.active = active;
}

export function restoreJournal(engine, data) {
  if (!data || !Array.isArray(data.entries)) {
    engine.ctx.learning = { entries: [], active: {}, truncated: engine.state.t_sim > 0 };
    return;
  }
  const entries = data.entries.filter(e => e && Number.isFinite(e.t) && e.t >= 0
    && e.t <= engine.state.t_sim && ['action', 'event', 'on', 'off'].includes(e.kind)
    && (e.kind === 'action' ? typeof e.id === 'string' : typeof e.key === 'string'));
  engine.ctx.learning = {
    entries: entries.slice(-CAP).map(e => ({ ...e })),
    active: Object.fromEntries(Object.entries(data.active || {}).filter(([, v]) => typeof v === 'string')),
    truncated: !!data.truncated || entries.length > CAP,
  };
}

export function learningReport(engine) {
  const j = journal(engine);
  return { ...j, entries: j.entries.map(e => ({ ...e })) };
}
