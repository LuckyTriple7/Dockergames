// Shared simulation-time history. No rendering, replay or scoring dependencies.
export const TREND_CHANNEL_IDS = Object.freeze([
  'pth', 'pe', 'dem', 'thot', 'tavg', 'tcold', 'pprim', 'psg', 'rho', 'xe',
  'level', 'pzrlevel', 'coreflow', 'feedflow', 'steamflow',
]);

const CAPACITY = 28800;
const MARKER_CAP = 600;
const EPS = 1e-6;
const KINDS = new Set(['action', 'event', 'on', 'off', 'scram',
  'goal_start', 'goal_reset', 'goal_met', 'goal_lost']);
const FIELDS = new Set(['t', 'kind', 'key', 'id', 'value', 'params', 'severity']);
const plain = (v) => v !== null && typeof v === 'object'
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const scalar = (v) => v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))
  || (typeof v === 'string' && v.length <= 64);

function markerCopy(entry, strict = false) {
  if (!plain(entry) || !Number.isFinite(entry.t) || entry.t < 0 || !KINDS.has(entry.kind)
    || Object.keys(entry).some(k => !FIELDS.has(k))) return null;
  const out = { t: entry.t, kind: entry.kind };
  let parameterCount = 0;
  for (const k of ['key', 'id', 'value', 'severity', 'params']) {
    if (!(k in entry)) continue;
    const v = entry[k];
    if (v === undefined && !strict) continue;
    if (k === 'params' || (k === 'value' && plain(v))) {
      if (!plain(v)) return null;
      const pairs = Object.entries(v);
      parameterCount += pairs.length;
      if (parameterCount > 8) return null;
      if (pairs.some(([key, value]) => !key.length || key.length > 32
        || ['__proto__', 'prototype', 'constructor'].includes(key) || !scalar(value))) return null;
      out[k] = Object.fromEntries(pairs);
    } else if (k === 'severity') {
      if (!Number.isInteger(v) || v < 0 || v > 3) return null;
      out[k] = v;
    } else if (k === 'key' || k === 'id') {
      if (typeof v !== 'string' || !v.length || (strict && v.length > 96)) return null;
      out[k] = v.slice(0, 96);
    } else {
      if (!scalar(v)) return null;
      out[k] = v;
    }
  }
  return out;
}

function encode(bytes) {
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 0x6000) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 0x6000))));
  }
  return chunks.join('');
}

function validBinary(text, bytes) {
  if (typeof text !== 'string' || text.length !== 4 * Math.ceil(bytes / 3)) return false;
  const padding = (3 - bytes % 3) % 3;
  return /^[A-Za-z0-9+/]*={0,2}$/.test(text)
    && (padding ? text.endsWith('='.repeat(padding)) && text[text.length - padding - 1] !== '='
      : !text.endsWith('='));
}

function decode(text, bytes) {
  const out = new Uint8Array(bytes);
  for (let i = 0, offset = 0; i < text.length; i += 0x8000) {
    const chunk = atob(text.slice(i, i + 0x8000));
    for (let j = 0; j < chunk.length; j++) out[offset++] = chunk.charCodeAt(j);
  }
  return new DataView(out.buffer);
}

export class TrendHistory {
  constructor(engine) {
    this.engine = engine;
    this.capacity = CAPACITY;
    this.data = Object.fromEntries(TREND_CHANNEL_IDS.map(id => [id, new Float32Array(CAPACITY)]));
    this.time = new Float64Array(CAPACITY);
    this.head = 0; // Next write position, not the newest sample.
    this.count = 0;
    this.nextSample = engine.state.t_sim;
    this.markers = [];
    this.markerTruncated = false;
    this.missingBefore = engine.state.t_sim > 0;
    engine.ctx.trends = this;
  }

  get latestTime() {
    return this.count ? this.time[(this.head + CAPACITY - 1) % CAPACITY] : this.engine.state.t_sim;
  }

  indices(rangeS, endTime = this.latestTime) {
    if (!(rangeS >= 0) || !Number.isFinite(endTime)) return [];
    const out = [];
    const start = endTime - Math.min(rangeS, CAPACITY);
    for (let n = 0; n < this.count; n++) {
      const i = (this.head - this.count + CAPACITY + n) % CAPACITY;
      if (this.time[i] > endTime) break;
      if (this.time[i] >= start) out.push(i);
    }
    return out;
  }

  sample(s = this.engine.state, d, force = false) {
    const t = s.t_sim;
    // Check before derive(): some plant-derived displays retain context.
    if (!Number.isFinite(t) || t < 0 || (this.count && t <= this.latestTime)
      || (!force && t + EPS < this.nextSample)) return false;
    d ??= this.engine.derive();
    if (!this.count && t > EPS) this.missingBefore = true;
    const values = [d.power_th_pct, 100 * s.P_e / this.engine.spec.P0_e,
      100 * s.P_demand / this.engine.spec.P0_e, s.T_co - 273.15, d.T_avg - 273.15,
      s.T_ci - 273.15, s.p_prim, d.p_sg, d.rho_pcm, s.X * 100,
      this.engine.spec.id === 'bwr' && s.dcPower === false ? NaN : d.L_sg * 100,
      s.pzr_L == null ? NaN : s.pzr_L * 100, s.W_core, s.W_fw, s.W_steam];
    for (let n = 0; n < TREND_CHANNEL_IDS.length; n++) {
      const v = values[n];
      this.data[TREND_CHANNEL_IDS[n]][this.head] = Number.isFinite(v)
        && Number.isFinite(Math.fround(v)) ? v : NaN;
    }
    this.time[this.head] = t;
    this.head = (this.head + 1) % CAPACITY;
    this.count = Math.min(this.count + 1, CAPACITY);
    while (this.count && this.time[(this.head - this.count + CAPACITY) % CAPACITY] < t - CAPACITY) {
      this.count--;
    }
    // Integer deadlines avoid accumulating floating-point drift across saves.
    this.nextSample = Math.floor(t + EPS) + 1;
    this._pruneMarkers(t);
    return true;
  }

  _pruneMarkers(t) {
    let drop = 0;
    while (drop < this.markers.length && this.markers[drop].t < t - CAPACITY) drop++;
    drop = Math.max(drop, this.markers.length - MARKER_CAP);
    if (drop > 0) {
      this.markers.splice(0, drop);
      this.markerTruncated = true;
    }
  }

  mark(entry) {
    const m = markerCopy(entry);
    const now = this.engine.state.t_sim;
    if (!m || m.t > now) return false;
    this._pruneMarkers(now);
    if (m.t < now - CAPACITY) { this.markerTruncated = true; return false; }
    const last = this.markers.at(-1);
    const id = m.id || m.key || '';
    const continuous = typeof m.value === 'number' && typeof last?.value === 'number'
      && (id.startsWith('write:') || id.endsWith('_write') || id === 'demand_set'
        || (id === 'rod_jog' && m.value !== 0 && Math.sign(m.value) === Math.sign(last.value)));
    if (continuous && m.kind === 'action' && last?.kind === 'action'
      && last.id === m.id && last.key === m.key && m.t >= last.t && m.t - last.t <= 2
      && JSON.stringify(last.params) === JSON.stringify(m.params)) {
      this.markers[this.markers.length - 1] = m;
    } else {
      let i = this.markers.length;
      while (i > 0 && this.markers[i - 1].t > m.t) i--;
      this.markers.splice(i, 0, m);
    }
    this._pruneMarkers(now);
    return true;
  }

  snapshot() {
    this._pruneMarkers(this.engine.state.t_sim);
    const times = new DataView(new ArrayBuffer(this.count * 8));
    const values = new DataView(new ArrayBuffer(this.count * TREND_CHANNEL_IDS.length * 4));
    for (let n = 0; n < this.count; n++) {
      const i = (this.head - this.count + CAPACITY + n) % CAPACITY;
      times.setFloat64(n * 8, this.time[i], true);
      TREND_CHANNEL_IDS.forEach((id, c) => values.setFloat32((n * 15 + c) * 4, this.data[id][i], true));
    }
    return { v: 1, channels: [...TREND_CHANNEL_IDS], count: this.count,
      time: encode(new Uint8Array(times.buffer)), values: encode(new Uint8Array(values.buffer)),
      nextSample: this.nextSample, markers: this.markers.map(m => markerCopy(m, true)),
      markerTruncated: this.markerTruncated, missingBefore: this.missingBefore };
  }

  restore(block, tNow = this.engine.state.t_sim) {
    try {
      if (!plain(block) || block.v !== 1 || !Number.isFinite(tNow) || tNow < 0
        || !Array.isArray(block.channels) || block.channels.length !== 15
        || block.channels.some((id, i) => id !== TREND_CHANNEL_IDS[i])
        || !Number.isInteger(block.count) || block.count < 0 || block.count > CAPACITY
        || !Number.isFinite(block.nextSample) || block.nextSample < 0
        || block.nextSample > tNow + 1 + EPS
        || typeof block.markerTruncated !== 'boolean' || typeof block.missingBefore !== 'boolean'
        || !Array.isArray(block.markers) || block.markers.length > MARKER_CAP
        || !validBinary(block.time, block.count * 8)
        || !validBinary(block.values, block.count * 15 * 4)) throw new Error('shape');
      const markers = block.markers.map(m => markerCopy(m, true));
      if (markers.some((m, i) => !m || m.t > tNow || m.t < tNow - CAPACITY
        || (i && m.t < markers[i - 1].t))) throw new Error('markers');
      // All byte/count bounds are checked before allocating decoded buffers.
      const times = decode(block.time, block.count * 8);
      const values = decode(block.values, block.count * 15 * 4);
      let previous = -1;
      for (let n = 0; n < block.count; n++) {
        const t = times.getFloat64(n * 8, true);
        if (!Number.isFinite(t) || t < 0 || t <= previous || t > tNow
          || t < tNow - CAPACITY) throw new Error('time');
        previous = t;
        for (let c = 0; c < 15; c++) {
          const v = values.getFloat32((n * 15 + c) * 4, true);
          if (!Number.isFinite(v) && !Number.isNaN(v)) throw new Error('value');
        }
      }
      if (block.count && (block.nextSample <= previous
        || block.nextSample !== Math.floor(previous + EPS) + 1)) throw new Error('deadline');
      this.time.fill(0);
      for (const id of TREND_CHANNEL_IDS) this.data[id].fill(0);
      for (let n = 0; n < block.count; n++) {
        this.time[n] = times.getFloat64(n * 8, true);
        TREND_CHANNEL_IDS.forEach((id, c) => { this.data[id][n] = values.getFloat32((n * 15 + c) * 4, true); });
      }
      this.count = block.count;
      this.head = block.count % CAPACITY;
      this.nextSample = block.nextSample;
      this.markers = markers;
      this.markerTruncated = block.markerTruncated;
      this.missingBefore = block.missingBefore || (block.count === 0 && tNow > 0);
      return true;
    } catch {
      this.count = this.head = 0;
      this.time.fill(0);
      for (const id of TREND_CHANNEL_IDS) this.data[id].fill(0);
      this.nextSample = Number.isFinite(tNow) && tNow >= 0 ? tNow : 0;
      this.markers = [];
      this.markerTruncated = false;
      this.missingBefore = true;
      return false;
    }
  }
}
