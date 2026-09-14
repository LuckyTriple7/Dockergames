// Read-only plots of the session history; sampling belongs to TrendHistory.
import { $, el, setText, setAttr } from './dom.js';
import { t, num, clock } from './i18n.js';
import { actionText } from './debrief.js';
import { TrendHistory } from '../game/trendHistory.js';

const LEFT = 12, RIGHT = 80, TOP = 10, BOTTOM = 22;
const COLORS = { action: '#ffb020', event: '#ff7a3d', on: '#ff4d4d', off: '#3fd67f',
  scram: '#ff4d4d', goal_start: '#b489ff', goal_reset: '#ffb020',
  goal_met: '#3fd67f', goal_lost: '#ff7a3d' };

class TrendRecorder {
  constructor(channels, titleKey, unitKey, fmt = 1) {
    this.channels = channels;
    this.fmt = fmt;
    const title = `${t(titleKey)} [${t(unitKey)}]`;
    this.canvas = el('canvas.rs-trend-canvas', { role: 'img', 'aria-label': title });
    this.node = el('section.rs-trend', null, [
      el('div.rs-trend-head', null, [
        el('h3.rs-trend-title', { text: title }),
        el('div.rs-trend-legend', null, channels.map(([id, key, color]) =>
          el('span.rs-trend-key', { '--rs-c': color, 'data-channel': id }, [el('i'), t(key)]))),
      ]), this.canvas,
    ]);
    try { this.ctx = this.canvas.getContext('2d'); } catch { this.ctx = null; }
    if (!this.ctx) this.node.append(el('p.rs-trend-note', { text: t('trend_canvas_unavailable') }));
  }

  draw(history, frame) {
    const cv = this.canvas, g = this.ctx;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!g || w <= LEFT + RIGHT || h <= TOP + BOTTOM) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(w * dpr), height = Math.round(h * dpr);
    if (cv.width !== width || cv.height !== height) { cv.width = width; cv.height = height; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const { indices, start, end, markers, selectedTime } = frame;
    const x = time => LEFT + (time - start) / Math.max(1, end - start) * (w - LEFT - RIGHT);
    let lo = Infinity, hi = -Infinity;
    for (const [id] of this.channels) for (const i of indices) {
      const v = history.data[id][i];
      if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    const hasData = Number.isFinite(lo);
    if (!hasData) { lo = 0; hi = 1; }
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.12;
    lo -= pad; hi += pad;
    const y = v => h - BOTTOM - (v - lo) / (hi - lo) * (h - TOP - BOTTOM);
    g.lineWidth = 1;
    g.strokeStyle = '#1b2430';
    g.beginPath();
    for (let n = 0; n <= 4; n++) {
      const yy = y(lo + (hi - lo) * n / 4);
      g.moveTo(LEFT, yy); g.lineTo(w - RIGHT, yy);
    }
    g.stroke();
    g.fillStyle = '#8b98a4';
    g.font = '10px ui-monospace, monospace';
    g.textAlign = 'left';
    if (hasData) {
      g.fillText(num(hi, this.fmt), w - RIGHT + 6, TOP + 8, RIGHT - 8);
      g.fillText(num(lo, this.fmt), w - RIGHT + 6, h - BOTTOM, RIGHT - 8);
    } else {
      g.fillText(t('trend_no_data'), LEFT, TOP + 16, w - LEFT - RIGHT);
    }
    const ticks = Math.max(1, Math.min(4, Math.floor((w - LEFT - RIGHT) / 90)));
    for (let n = 0; n <= ticks; n++) {
      const time = start + (end - start) * n / ticks;
      g.textAlign = n === 0 ? 'left' : n === ticks ? 'right' : 'center';
      g.fillText(clock(time), x(time), h - 5);
    }

    for (const [id, , color] of this.channels) {
      g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 1.4;
      g.beginPath();
      let bucket = null, connected = false, previousTime = -Infinity;
      // One pass per channel. Keep first/min/max/last in time order per pixel,
      // but flush BEFORE every missing value or time gap, even within a pixel.
      const flush = () => {
        if (!bucket) return;
        const points = [...new Set([bucket.first, bucket.min, bucket.max, bucket.last])]
          .sort((a, b) => history.time[a] - history.time[b]);
        for (const i of points) {
          const px = x(history.time[i]), py = y(history.data[id][i]);
          if (connected) g.lineTo(px, py);
          else { g.moveTo(px, py); g.fillRect(px - 0.7, py - 0.7, 1.4, 1.4); }
          connected = true;
        }
        bucket = null;
      };
      for (const i of indices) {
        const time = history.time[i], v = history.data[id][i];
        if (!Number.isFinite(v) || time - previousTime > 1.5) { flush(); connected = false; }
        previousTime = time;
        if (!Number.isFinite(v)) continue;
        const col = Math.floor(x(time));
        if (bucket && bucket.col !== col) flush();
        if (!bucket) bucket = { col, first: i, last: i, min: i, max: i };
        else {
          bucket.last = i;
          if (v < history.data[id][bucket.min]) bucket.min = i;
          if (v > history.data[id][bucket.max]) bucket.max = i;
        }
      }
      flush(); g.stroke();
    }
    for (const m of markers) {
      g.strokeStyle = COLORS[m.kind] || '#8b98a4';
      g.lineWidth = 1;
      g.setLineDash(m.kind === 'action' ? [2, 4] : [5, 3]);
      g.beginPath(); g.moveTo(x(m.t), TOP); g.lineTo(x(m.t), h - BOTTOM); g.stroke();
    }
    g.setLineDash([]);
    if (selectedTime !== null) {
      g.strokeStyle = '#ffffff'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x(selectedTime), TOP); g.lineTo(x(selectedTime), h - BOTTOM); g.stroke();
    }
  }
}

export function buildTrends(engine, render) {
  const ctx = engine.ctx;
  if (!ctx.trends) ctx.trends = new TrendHistory(engine);
  const pwr = engine.spec.id === 'pwr', bwr = engine.spec.id === 'bwr';
  const pressure = pwr ? 'trend_ch_pprim' : bwr ? 'val_dome_press' : 'val_drum_press';
  const level = pwr ? 'trend_level_sg' : bwr ? 'val_rpv_level' : 'val_drum_level';
  const charts = [
    new TrendRecorder([['pth', 'trend_ch_pth', '#64d8ff'], ['pe', 'trend_ch_pe', '#3fd67f'],
      ['dem', 'trend_ch_demand', '#ffb020']], 'trend_power', 'unit_percent'),
    new TrendRecorder([['pprim', pressure, '#64d8ff'],
      ...(pwr ? [['psg', 'trend_ch_psg', '#cfd9e2']] : [])], 'trend_pressure', 'unit_bar'),
    new TrendRecorder([['level', level, '#64d8ff'],
      ...(pwr ? [['pzrlevel', 'val_pzr_level', '#ffb020']] : [])], 'trend_level', 'unit_percent'),
    new TrendRecorder([['feedflow', 'val_feed_flow', '#64d8ff'], ['steamflow', 'val_steam_flow', '#ffb020']],
      'trend_flow', 'unit_kgs', 0),
    new TrendRecorder([['thot', 'trend_ch_thot', '#ff7a3d'], ['tavg', 'trend_ch_tavg', '#ffd27a'],
      ['tcold', 'trend_ch_tcold', '#4b8fd6']], 'trend_temp', 'unit_celsius'),
    new TrendRecorder([['rho', 'trend_ch_rho', '#ff4d4d']], 'trend_reactivity', 'unit_pcm', 0),
    new TrendRecorder([['xe', 'trend_ch_xenon', '#b489ff']], 'trend_xenon', 'unit_percent'),
    new TrendRecorder([['coreflow', 'val_flow_core', '#64d8ff']], 'trend_coreflow', 'unit_kgs', 0),
  ];
  let rangeS = 600, heldEnd = null, selectedKey = null, selectedTime = null;
  let fingerprint = '', markerButtons = new Map();
  const info = el('p.rs-trend-note');
  const list = el('ol.rs-trend-events');
  const summary = el('summary');
  const events = el('details.rs-trend-details', null, [summary, list]);
  const extra = el('details.rs-trend-details', null, [
    el('summary', { text: t('trend_extra') }), ...charts.slice(4).map(c => c.node),
  ]);
  const live = el('button.rs-gbtn', { type: 'button', text: t('trend_live') });
  const reset = () => { heldEnd = selectedKey = selectedTime = null; };
  // Keep native button/summary activation out of the global pause shortcut.
  const nativeActivation = ev => {
    if (ev.key === ' ' || ev.key === 'Enter') ev.stopPropagation();
  };
  const ranges = [['trend_10min', 600], ['trend_1h', 3600], ['trend_8h', 28800]];
  const buttons = ranges.map(([key, seconds]) => {
    const button = el('button.rs-gbtn', { type: 'button', text: t(key) });
    button.addEventListener('click', () => { rangeS = seconds; draw(); });
    return button;
  });
  live.addEventListener('click', () => { reset(); draw(); });
  for (const node of [...buttons, live, summary, extra.children[0]]) {
    node.addEventListener('keydown', nativeActivation);
  }
  $('#rs-trend-range').replaceChildren(...buttons, live);
  $('#rs-trend-range').setAttribute('aria-label', t('trend_range'));
  $('#rs-trends').replaceChildren(
    info,
    ...charts.slice(0, 4).map(c => c.node), extra, events,
    el('p.rs-trend-note', { text: t('trend_retention') }),
  );

  function draw() {
    const history = ctx.trends;
    const now = Math.max(0, engine.state.t_sim);
    // Fingerprints include values and parameters: continuous commands may be
    // replaced in-place, and a full marker ring can rotate without growing.
    const available = history.markers.filter(m => m.t <= now);
    if (selectedKey !== null && (!available.some(m => JSON.stringify(m) === selectedKey)
      || selectedTime < Math.max(0, heldEnd - rangeS) || selectedTime > now)) reset();
    const end = heldEnd ?? now, start = Math.max(0, end - rangeS);
    const markers = available.filter(m => m.t >= start && m.t <= end);
    const nextFingerprint = JSON.stringify(markers);
    if (fingerprint !== nextFingerprint) {
      const nextButtons = new Map();
      const nodes = markers.map((m, n) => {
        const key = JSON.stringify(m), identity = key + ':' + n;
        let item = markerButtons.get(identity);
        if (!item) {
          const label = m.kind === 'action' ? actionText({ ...m, id: m.id || '' })
            : m.key ? t(m.key, m.params) : t('trend_kind_' + m.kind);
          const button = el('button.rs-trend-event', { type: 'button',
            'data-kind': m.kind, text: `${clock(m.t)} / ${num(m.t, 1)} ${t('unit_seconds')} | ${t('trend_kind_' + m.kind)} | ${label}` });
          button.addEventListener('keydown', nativeActivation);
          button.addEventListener('click', () => {
            if (m.t > engine.state.t_sim || !ctx.trends.markers.some(e => JSON.stringify(e) === key)) return;
            selectedKey = key; selectedTime = m.t; heldEnd ??= engine.state.t_sim; draw();
          });
          item = { node: el('li', null, [button]), button, key };
        }
        nextButtons.set(identity, item);
        return item.node;
      });
      list.replaceChildren(...nodes);
      markerButtons = nextButtons;
      fingerprint = nextFingerprint;
    }
    for (const item of markerButtons.values()) setAttr(item.button, 'aria-pressed', item.key === selectedKey);
    setText(summary, t('trend_events', { n: markers.length }));
    const indices = history.indices(end - start, end);
    setText(info, [!indices.length ? t('trend_no_data') : '',
      history.missingBefore ? t('trend_missing') : '',
      history.markerTruncated ? t('trend_truncated') : '',
      !markers.length ? t('trend_no_events') : ''].filter(Boolean).join(' '));
    for (let n = 0; n < buttons.length; n++) {
      setAttr(buttons[n], 'aria-pressed', ranges[n][1] === rangeS);
      buttons[n].classList.toggle('rs-on', ranges[n][1] === rangeS);
    }
    setAttr(live, 'aria-pressed', selectedTime === null);
    const frame = { start, end, indices, markers, selectedTime };
    for (const chart of charts) chart.draw(history, frame);
  }
  // The render tick also catches resized/reopened panels without observers
  // that would outlive a session. Details redraw immediately when opened.
  extra.addEventListener('toggle', draw);
  render.add('trend', draw);
  draw();
  return { sampleTrends() { ctx.trends.sample(); } };
}
