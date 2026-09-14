import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const en = JSON.parse(readFileSync(new URL('../locales/en.json', import.meta.url)));
const de = JSON.parse(readFileSync(new URL('../locales/de.json', import.meta.url)));
globalThis.window = { RS_I18N: en, RS_CFG: { lang: 'en' }, devicePixelRatio: 2 };

class Context {
  constructor() { this.paths = []; this.labels = []; this.dots = []; this.dash = []; }
  setTransform(...args) { this.transform = args; }
  clearRect() { this.paths = []; this.labels = []; this.dots = []; }
  beginPath() { this.path = []; }
  moveTo(x, y) { this.path.push(['M', x, y]); }
  lineTo(x, y) { this.path.push(['L', x, y]); }
  stroke() { this.paths.push({ color: this.strokeStyle, dash: [...this.dash], points: this.path }); }
  fillText(text, x, y) { this.labels.push({ text, x, y }); }
  fillRect(...args) { this.dots.push({ color: this.fillStyle, args }); }
  setLineDash(dash) { this.dash = dash; }
}

let contextMode = 'normal';
class Node {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {};
    this.listeners = {}; this.className = ''; this.parent = null; this.open = false;
    this._text = ''; this._width = 492; this._height = 112; this.replacements = 0;
    this.style = { setProperty() {} };
    this.classList = { toggle: (name, enabled) => {
      const classes = new Set(this.className.split(' ').filter(Boolean));
      if (enabled) classes.add(name); else classes.delete(name);
      this.className = [...classes].join(' ');
    } };
    this.g = contextMode === 'normal' ? new Context() : null;
    this.contextMode = contextMode;
  }
  get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
  set textContent(text) { this._text = String(text); this.children = []; }
  get clientWidth() {
    for (let n = this.parent; n; n = n.parent) if (n.tagName === 'DETAILS' && !n.open) return 0;
    return this._width;
  }
  get clientHeight() { return this.clientWidth ? this._height : 0; }
  getContext() { if (this.contextMode === 'throw') throw new Error('No canvas'); return this.g; }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parent) node.parent.children = node.parent.children.filter(n => n !== node);
      node.parent = this; this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.replacements++;
    for (const node of this.children) node.parent = null;
    this.children = []; this._text = ''; this.append(...nodes);
  }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(event, fn) { this.listeners[event] = fn; }
  click() { this.listeners.click?.({ type: 'click' }); }
  toggle() { this.open = !this.open; this.listeners.toggle?.({ type: 'toggle' }); }
}
let mounts;
globalThis.document = {
  createElement: tag => new Node(tag),
  createTextNode: text => { const n = new Node('#text'); n.textContent = text; return n; },
  querySelector: selector => mounts[selector],
};
const { buildTrends } = await import('../static/js/ui/trend.js');
const { TrendHistory, TREND_CHANNEL_IDS } = await import('../static/js/game/trendHistory.js');
const { actionText } = await import('../static/js/ui/debrief.js');
const all = (node, predicate) => [node, ...node.children.flatMap(n => all(n, () => true))].filter(predicate);
const byClass = (node, cls) => all(node, n => n.className.split(' ').includes(cls));

function fixture({ times = [0, 1, 2], id = 'pwr', end = times.at(-1) ?? 0, mode = 'normal' } = {}) {
  contextMode = mode;
  mounts = { '#rs-trends': new Node(), '#rs-trend-range': new Node() };
  const engine = { state: { t_sim: end, P_e: 50, P_demand: 60, T_co: 580, T_ci: 550,
    p_prim: 155, X: 1, pzr_L: 0.5, W_core: 20000, W_fw: 1000, W_steam: 1000, dcPower: true },
  spec: { id, P0_e: 100 }, ctx: {}, derive() {
    return { power_th_pct: 50, T_avg: 565, p_sg: 70, rho_pcm: 0, L_sg: 0.5 };
  } };
  const history = new TrendHistory(engine);
  history.count = times.length; history.head = times.length;
  history.nextSample = times.length ? end + 1 : end;
  history.time.set(times);
  for (const id of TREND_CHANNEL_IDS) history.data[id].fill(50);
  let draw, registrations = 0;
  const view = buildTrends(engine, { add(group, fn) {
    assert.equal(group, 'trend'); registrations++; draw = fn;
  } });
  const root = mounts['#rs-trends'];
  const charts = byClass(root, 'rs-trend');
  const canvases = byClass(root, 'rs-trend-canvas');
  const buttons = mounts['#rs-trend-range'].children;
  const list = byClass(root, 'rs-trend-events')[0];
  const extra = byClass(root, 'rs-trend-details')[0];
  return { engine, history, view, draw: () => draw(), root, charts, canvases, buttons, list, extra,
    events: () => byClass(root, 'rs-trend-event'), registrations };
}
const axis = cv => cv.g.labels.filter(l => /^\d+:\d\d:\d\d$/.test(l.text));
const channel = (cv, color = '#64d8ff') => cv.g.paths.find(p => p.color === color && !p.dash.length);
const cursors = f => f.canvases.map(cv => cv.g.paths.find(p => p.color === '#ffffff')?.points);

test('four primary charts, four folded charts, correct units and reactor naming', () => {
  for (const id of ['pwr', 'bwr', 'rbmk']) {
    const f = fixture({ id });
    assert.equal(f.charts.length, 8);
    assert.equal(f.root.children.filter(n => n.tagName === 'SECTION').length, 4);
    assert.equal(f.extra.open, false);
    const titles = f.charts.map(c => byClass(c, 'rs-trend-title')[0].textContent);
    assert.deepEqual(titles, ['Power [%]', 'Pressures [bar]', 'Levels [%]', 'Feedwater and steam flow [kg/s]',
      'Temperatures [\u00b0C]', 'Reactivity [pcm]', 'Xenon [%]', 'Core flow [kg/s]']);
    assert.ok(f.charts[2].textContent.includes(en[id === 'pwr' ? 'trend_level_sg' : id === 'bwr' ? 'val_rpv_level' : 'val_drum_level']));
    assert.equal(byClass(f.charts[2], 'rs-trend-key').length, id === 'pwr' ? 2 : 1);
    assert.equal(byClass(f.charts[1], 'rs-trend-key').length, id === 'pwr' ? 2 : 1);
    assert.equal(f.registrations, 1);
    f.extra.toggle();
    for (const cv of f.canvases) {
      assert.deepEqual(axis(cv), axis(f.canvases[0]));
      assert.deepEqual(cv.g.transform, [2, 0, 0, 2, 0, 0]);
      assert.equal(cv.width, 984);
    }
  }
});

test('real renderer breaks lines at NaN and time gaps without fabricating history', () => {
  const f = fixture({ times: [100, 101, 102, 103, 110, 111] });
  f.history.data.pth.set([10, 20, NaN, 30, 40, 50]); f.draw();
  const points = channel(f.canvases[0]).points;
  assert.deepEqual(points.map(p => p[0]), ['M', 'L', 'M', 'M', 'L']);
  assert.ok(points[0][1] > 12, 'no line before first retained measurement');
  const saved = f.history.data.pth.slice(0, 6);
  f.buttons[2].click(); f.draw();
  assert.deepEqual(f.history.data.pth.slice(0, 6), saved, 'drawing never changes history');
  f.history.data.pth.fill(NaN); f.history.data.pe.fill(NaN); f.history.data.dem.fill(NaN); f.draw();
  assert.equal(channel(f.canvases[0]).points.length, 0);
  assert.ok(f.canvases[0].g.labels.some(l => l.text === en.trend_no_data));
});

test('pixel reduction retains both extrema and bounds dense line work', () => {
  const f = fixture({ times: Array.from({ length: 28800 }, (_, i) => i) });
  f.history.data.pth.fill(50); f.history.data.pth[100] = -100; f.history.data.pth[101] = 300;
  f.buttons[2].click();
  const points = channel(f.canvases[0]).points;
  assert.ok(points.length < 4 * 402, `bounded pixel work: ${points.length}`);
  const ys = points.map(p => p[2]);
  assert.ok(Math.min(...ys) < 20, 'positive peak retained');
  assert.ok(Math.max(...ys) > 78, 'negative peak retained');
  f.history.data.pth[102] = NaN; f.draw();
  assert.equal(channel(f.canvases[0]).points.filter(p => p[0] === 'M').length, 2,
    'NaN inside a crowded pixel still separates segments');
});

test('shared exact marker cursor, held time, all ranges, Live, and stable native buttons', () => {
  const f = fixture({ times: [3998, 3999, 4000] }); f.extra.toggle();
  const action = { t: 3900.25, kind: 'action', id: 'demand_set', value: 70 };
  f.history.markers = [action, { t: 3910, kind: 'scram', key: 'event_scram' },
    { t: 5000, kind: 'event', key: 'event_turbine_resume' }];
  f.draw();
  assert.equal(f.events().length, 2, 'future markers excluded');
  assert.ok(f.events()[0].textContent.includes(actionText(action)));
  assert.ok(f.events()[0].textContent.includes(en.trend_kind_action));
  assert.ok(f.events()[1].textContent.includes(en.trend_kind_scram));
  const original = f.events()[0], replacements = f.list.replacements;
  for (let n = 0; n < 20; n++) f.draw();
  assert.equal(f.list.replacements, replacements);
  assert.equal(f.events()[0], original);
  assert.equal(original.tagName, 'BUTTON');
  assert.equal(original.getAttribute('type'), 'button', 'native keyboard/touch activation');
  for (const node of [original, ...f.buttons, ...byClass(f.root, 'rs-trend-details').map(n => n.children[0])]) {
    for (const key of [' ', 'Enter']) {
      let stopped = false;
      node.listeners.keydown({ key, stopPropagation() { stopped = true; },
        preventDefault() { assert.fail('native activation must not be prevented'); } });
      assert.equal(stopped, true, 'activation cannot reach global pause shortcut');
    }
  }
  f.engine.state.t_sim = 4010; f.draw(); original.click();
  assert.equal(original.getAttribute('aria-pressed'), 'true');
  assert.ok(f.root.textContent.includes('3,900.3 s'), 'subsecond selection caption');
  const held = axis(f.canvases[0]);
  assert.equal(held.at(-1).text, '01:06:50', 'hold click time, not button creation time');
  const cursor = cursors(f)[0];
  for (const p of cursors(f)) assert.deepEqual(p, cursor);
  for (const cv of f.canvases) {
    const marker = cv.g.paths.find(p => p.dash.join() === '2,4');
    assert.equal(marker.points[0][1], cursor[0][1]);
  }
  f.engine.state.t_sim = 4020; f.draw();
  assert.deepEqual(axis(f.canvases[0]), held);
  for (const [n, span] of [[1, 3600], [2, 28800], [0, 600]]) {
    f.buttons[n].click();
    assert.equal(f.buttons[n].getAttribute('aria-pressed'), 'true');
    assert.equal(f.events()[0], original, 'range does not replace unchanged marker buttons');
    for (const cv of f.canvases) assert.deepEqual(axis(cv), axis(f.canvases[0]));
    const expected = 12 + (3900.25 - Math.max(0, 4010 - span)) / Math.min(4010, span) * 400;
    assert.equal(cursors(f)[0][0][1], expected);
  }
  f.buttons[3].click();
  assert.ok(cursors(f).every(p => p === undefined));
  assert.equal(axis(f.canvases[0]).at(-1).text, '01:07:00');
});

test('coalesced commands, helper parameters, goal captions and ring rotation refresh the list', () => {
  const f = fixture({ end: 100 });
  f.history.markers = [{ t: 10, kind: 'action', id: 'demand_set', value: 20 }]; f.draw();
  f.events()[0].click();
  f.history.markers[0] = { t: 10.5, kind: 'action', id: 'demand_set', value: 30 }; f.draw();
  assert.ok(f.events()[0].textContent.includes('30 MWe'));
  assert.equal(f.buttons[3].getAttribute('aria-pressed'), 'true', 'stale selection cleared');
  const helper = { t: 20, kind: 'action', id: 'helper:helper_action_pump_start', value: { n: 2 } };
  f.history.markers = [helper, { t: 30, kind: 'goal_met', key: 'tut_pumps_title' },
    { t: 40, kind: 'goal_start', key: 'obj_pwr_power_limited_title' }]; f.draw();
  assert.ok(f.events()[0].textContent.includes(actionText(helper)));
  assert.ok(f.events()[0].textContent.includes('Pump 2 restarted.'));
  helper.value.n = 3; f.draw();
  assert.ok(f.events()[0].textContent.includes('Pump 3 restarted.'), 'same-time parameter changes refresh captions');
  assert.ok(f.events()[1].textContent.includes(en.tut_pumps_title));
  assert.ok(f.events()[2].textContent.includes(en.obj_pwr_power_limited_title));
  f.history.markers = Array.from({ length: 600 }, (_, n) => ({ t: n / 10, kind: 'event', key: 'event_scram' }));
  f.draw(); const first = f.events()[0]; first.click();
  f.history.markers.shift(); f.history.markers.push({ t: 60, kind: 'off', key: 'trip_power_high' });
  f.history.markerTruncated = true; f.draw();
  assert.equal(f.events().length, 600);
  assert.notEqual(f.events()[0], first);
  assert.ok(f.root.textContent.includes(en.trend_truncated));
  assert.equal(f.buttons[3].getAttribute('aria-pressed'), 'true');
});

test('empty, unavailable context, resized/hidden charts and missing history remain safe', () => {
  for (const mode of ['normal', 'null', 'throw']) {
    const f = fixture({ times: [], end: 100, mode });
    assert.doesNotThrow(f.draw);
    assert.ok(f.root.textContent.includes(en.trend_no_data));
    assert.ok(f.root.textContent.includes(en.trend_missing));
    if (mode !== 'normal') assert.ok(f.root.textContent.includes(en.trend_canvas_unavailable));
    else {
      assert.equal(f.canvases[4].g.paths.length, 0);
      f.extra.toggle(); assert.ok(f.canvases[4].g.paths.length > 0);
      f.canvases[0]._width = 0; f.draw();
      f.canvases[0]._width = 300; f.draw(); assert.equal(f.canvases[0].width, 600);
      assert.equal(axis(f.canvases[0]).at(-1).x, 220);
      f.canvases[0]._height = 0; assert.doesNotThrow(f.draw);
    }
  }
  contextMode = 'normal';
});

test('shared history wrapper is idempotent, fallback works and BWR DC loss stays NaN', () => {
  const f = fixture({ times: [], id: 'bwr' });
  f.view.sampleTrends(); f.view.sampleTrends(); assert.equal(f.history.count, 1);
  f.engine.state.t_sim = 1; f.engine.state.dcPower = false; f.view.sampleTrends();
  f.engine.state.t_sim = 2; f.engine.state.dcPower = true; f.view.sampleTrends(); f.draw();
  assert.ok(Number.isNaN(f.history.data.level[1]));
  assert.deepEqual(channel(f.canvases[2]).points.map(p => p[0]), ['M', 'M']);
  delete f.engine.ctx.trends;
  const fallback = buildTrends(f.engine, { add() {} });
  assert.ok(f.engine.ctx.trends instanceof TrendHistory);
  fallback.sampleTrends(); assert.equal(f.engine.ctx.trends.count, 1);
});

test('wrapped chronological history renders in ascending time, no future samples', () => {
  const f = fixture({ times: [], end: 102 });
  const h = f.history;
  h.head = 2; h.count = 4;
  for (const [i, time] of [[28798, 100], [28799, 101], [0, 102], [1, 103]]) h.time[i] = time;
  assert.deepEqual(h.indices(600, 102), [28798, 28799, 0]);
  f.draw();
  const points = channel(f.canvases[0]).points;
  assert.equal(points.length, 3);
  assert.ok(points.every((p, i) => !i || p[1] > points[i - 1][1]));
  assert.equal(points.at(-1)[1], 412);
});

test('all trend locale keys and interpolation variables match in German and English', () => {
  const keys = Object.keys(en).filter(k => k.startsWith('trend_')).sort();
  assert.deepEqual(Object.keys(de).filter(k => k.startsWith('trend_')).sort(), keys);
  for (const key of keys) {
    assert.ok(de[key] && en[key]);
    assert.deepEqual(de[key].match(/\{\w+\}/g)?.sort(), en[key].match(/\{\w+\}/g)?.sort());
  }
  const source = readFileSync(new URL('../static/js/ui/trend.js', import.meta.url), 'utf8');
  for (const [, key] of source.matchAll(/'((?:trend|unit|val)_[a-z0-9_]+)'/g)) {
    if (key === 'trend_kind_') continue;
    assert.ok(en[key] && de[key], key);
  }
  for (const kind of ['action', 'event', 'on', 'off', 'scram', 'goal_start', 'goal_reset', 'goal_met', 'goal_lost']) {
    assert.ok(en['trend_kind_' + kind] && de['trend_kind_' + kind]);
  }
});
