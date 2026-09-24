import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { TrendHistory, TREND_CHANNEL_IDS } from '../static/js/game/trendHistory.js';
import { Session, PHASE } from '../static/js/game/session.js';
import { pack, apply } from '../static/js/net/persist.js';

const json = v => JSON.parse(JSON.stringify(v));
const engine = (id = 'pwr') => createEngine(getPlant(id), { seed: 123 });
const times = h => h.indices(28800).map(i => h.time[i]);
const step = (e, session) => {
  e.step(0.05);
  session.step(0.05, e.trips.tiles(), e.trips.unacknowledgedSeconds());
};

test('public contract, due check before derive, no invented samples or duplicates', () => {
  assert.deepEqual(TREND_CHANNEL_IDS, ['pth', 'pe', 'dem', 'thot', 'tavg', 'tcold',
    'pprim', 'psg', 'rho', 'xe', 'level', 'pzrlevel', 'coreflow', 'feedflow', 'steamflow']);
  const e = engine();
  let derives = 0;
  const original = e.derive;
  e.derive = () => { derives++; return original(); };
  const h = new TrendHistory(e);
  assert.equal(e.ctx.trends, h);
  assert.equal(h.capacity, 28800);
  assert.ok(h.time instanceof Float64Array);
  assert.deepEqual(Object.keys(h.data), TREND_CHANNEL_IDS);
  for (const id of TREND_CHANNEL_IDS) assert.ok(h.data[id] instanceof Float32Array);
  assert.equal(h.sample(), true);
  assert.equal(derives, 1);
  assert.equal(h.sample(e.state, undefined, true), false);
  e.state.t_sim = 0.9;
  assert.equal(h.sample(), false);
  assert.equal(derives, 1);
  e.state.t_sim = 1;
  h.sample(e.state, original());
  assert.equal(derives, 1, 'provided derived values reused');
  e.state.t_sim = 90;
  h.sample();
  assert.deepEqual(times(h), [0, 1, 90]);
  assert.deepEqual(h.indices(2).map(i => h.time[i]), [90]);
  assert.deepEqual(h.indices(1, 1).map(i => h.time[i]), [0, 1]);
  assert.deepEqual(h.indices(-1), []);
  assert.deepEqual(h.indices(1, NaN), []);
});

for (const id of ['pwr', 'bwr', 'rbmk']) {
  test(`${id}: exact channel units, missing values and Float32 overflow`, () => {
    const e = engine(id);
    const h = new TrendHistory(e);
    const s = e.state;
    const d = e.derive();
    const expected = [d.power_th_pct, 100 * s.P_e / e.spec.P0_e,
      100 * s.P_demand / e.spec.P0_e, s.T_co - 273.15, d.T_avg - 273.15,
      s.T_ci - 273.15, s.p_prim, d.p_sg, d.rho_pcm, s.X * 100,
      d.L_sg * 100, s.pzr_L == null ? NaN : s.pzr_L * 100, s.W_core, s.W_fw, s.W_steam];
    h.sample(s, d);
    TREND_CHANNEL_IDS.forEach((channel, i) => assert.equal(h.data[channel][0], Math.fround(expected[i])));
    s.t_sim = 1;
    s.W_core = 1e100;
    s.W_fw = Infinity;
    s.W_steam = undefined;
    s.dcPower = false;
    h.sample(s, d);
    for (const channel of ['coreflow', 'feedflow', 'steamflow']) assert.ok(Number.isNaN(h.data[channel][1]));
    if (id === 'bwr') assert.ok(Number.isNaN(h.data.level[1]), 'lost DC is not a frozen measurement');
    const loaded = new TrendHistory(e);
    assert.equal(loaded.restore(json(h.snapshot())), true);
    assert.deepEqual(loaded.snapshot(), h.snapshot());
  });

  for (const mode of ['free', 'scenario']) {
    test(`${id}/${mode}: 1x/60x, render reads and save/resume have identical physics and binary history`, () => {
      const def = mode === 'free' ? null : { id: 'trend_test', reactor: id, duration_s: 61.3,
        demand: [{ t: 0, mw: 0.8 * getPlant(id).spec.P0_e }], events: [] };
      const a = engine(id), b = engine(id), c = engine(id);
      const sa = new Session(a, def), sb = new Session(b, def), sc = new Session(c, def);
      sa.start(); sb.start(); sc.start();
      assert.equal(apply(json(pack(a, def?.id, sa.run, sa)), b, sb.run, sb), null);
      assert.equal(apply(json(pack(a, def?.id, sa.run, sa)), c, sc.run, sc), null);
      for (let frame = 0; frame < 20; frame++) {
        for (let n = 0; n < 60; n++) {
          step(a, sa);
          // Rendering consumes derive()/indices(), never owns sampling.
          a.derive();
          a.ctx.trends.indices(600);
        }
        for (let n = 0; n < 60; n++) step(b, sb);
        for (let n = 0; n < 60; n++) step(c, sc);
        if (frame === 9) {
          const before = JSON.stringify(pack(c, def?.id, sc.run, sc));
          assert.equal(apply(JSON.parse(before), c, sc.run, sc), null);
          assert.equal(JSON.stringify(pack(c, def?.id, sc.run, sc)), before);
          assert.equal(c.ctx.trends.sample(), false);
        }
      }
      assert.deepEqual(b.state, a.state);
      assert.deepEqual(c.state, a.state);
      assert.equal(JSON.stringify(pack(b, def?.id, sb.run, sb)), JSON.stringify(pack(a, def?.id, sa.run, sa)));
      assert.equal(JSON.stringify(pack(c, def?.id, sc.run, sc)), JSON.stringify(pack(a, def?.id, sa.run, sa)));
      assert.equal(a.ctx.trends.count, 61);
    });
  }
}

test('terminal sample precedes callback, including free destruction and fractional scenario end', () => {
  for (const free of [false, true]) {
    const e = engine();
    const session = new Session(e, free ? null : { id: 'end', reactor: 'pwr', duration_s: 0.15 });
    session.start();
    let called = false;
    session.onEnd = () => {
      called = true;
      assert.equal(e.ctx.trends.latestTime, e.state.t_sim);
      assert.equal(e.ctx.trends.count, 2);
    };
    if (free) e.state.destroyed = true;
    for (let n = 0; n < 4 && session.phase === PHASE.RUNNING; n++) step(e, session);
    assert.equal(called, true);
    assert.equal(e.ctx.trends.sample(e.state, undefined, true), false);
  }
});

test('ring wraps chronologically, retains eight hours exactly and removes old gaps', () => {
  const e = engine();
  const h = new TrendHistory(e);
  const d = e.derive();
  for (let t = 0; t < 28817; t++) { e.state.t_sim = t; h.sample(e.state, d); }
  assert.equal(h.count, 28800);
  assert.equal(h.head, 17);
  assert.equal(times(h)[0], 17);
  assert.equal(times(h).at(-1), 28816);
  const snapshot = h.snapshot();
  const restored = new TrendHistory(e);
  assert.equal(restored.restore(snapshot), true);
  assert.deepEqual(restored.snapshot(), snapshot);
  h.data.pth[h.head] = 999;
  h.markers.push({ t: e.state.t_sim, kind: 'event', key: 'detached' });
  assert.deepEqual(restored.snapshot(), snapshot, 'snapshot has no live buffers or marker references');
  e.state.t_sim += 28801;
  restored.sample(e.state, d);
  assert.deepEqual(times(restored), [e.state.t_sim]);
});

test('markers are detached, stable sorted, strictly shaped and coalesce only continuous actions', () => {
  const e = engine();
  e.state.t_sim = 100;
  const h = new TrendHistory(e);
  const entry = { t: 1, kind: 'action', id: 'rod_jog', value: 1, params: { bank: 'A' } };
  assert.equal(h.mark(entry), true);
  entry.params.bank = 'B';
  assert.equal(h.markers[0].params.bank, 'A');
  h.mark({ ...entry, t: 2, params: { bank: 'A' } });
  assert.equal(h.markers.length, 1);
  h.mark({ ...entry, t: 3, value: -1 });
  h.mark({ t: 4, kind: 'action', id: 'fw_write', value: 10 });
  h.mark({ t: 6, kind: 'action', id: 'fw_write', value: 20 });
  assert.equal(h.markers.length, 3);
  for (const kind of ['on', 'off', 'on', 'scram', 'goal_start', 'goal_reset', 'goal_met', 'goal_lost']) {
    h.mark({ t: 6, kind, key: 'same' });
  }
  h.mark({ t: 7, kind: 'action', id: 'fw_auto', value: true });
  h.mark({ t: 8, kind: 'action', id: 'fw_auto', value: true });
  assert.equal(h.markers.length, 13, 'real transitions and repeated discrete commands stay');
  h.mark({ t: 0, kind: 'event', key: 'late-arrival' });
  assert.deepEqual(h.markers.map(m => m.t), [0, 2, 3, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 8]);
  assert.equal(h.mark({ t: 99, kind: 'event', key: 'x'.repeat(1000) }), true);
  assert.equal(h.markers.at(-1).key.length, 96);
  for (const bad of [null, { t: 1, kind: 'bad' }, { t: 101, kind: 'on' },
    { t: 1, kind: 'on', params: { deep: {} } }, { t: 1, kind: 'on', value: Infinity },
    { t: 1, kind: 'on', params: json({ ['__proto__']: 'bad' }) },
    { t: 1, kind: 'on', severity: 4 }, { t: 1, kind: 'on', arbitrary: true }]) {
    assert.equal(h.mark(bad), false);
  }
  for (let t = 100; t <= 800; t++) { e.state.t_sim = t; h.mark({ t, kind: 'event', key: 'e' }); }
  assert.equal(h.markers.length, 600);
  assert.equal(h.markerTruncated, true);
  e.state.t_sim = 29601;
  h.sample();
  assert.equal(h.markers.length, 0);
});

test('malformed snapshots reject atomically; byte bounds and marker shapes checked before decode', () => {
  const e = engine();
  const h = new TrendHistory(e);
  h.sample();
  e.state.t_sim = 1;
  h.sample();
  const good = h.snapshot();
  const malformed = [null, { ...good, v: 2 }, { ...good, channels: [...good.channels, 'unknown'] },
    { ...good, channels: good.channels.map(() => 'pth') }, { ...good, count: 28801 },
    { ...good, count: -1 }, { ...good, count: 1.5 }, { ...good, count: Infinity },
    { ...good, time: good.time + 'AAAA' }, { ...good, values: '='.repeat(good.values.length) },
    { ...good, values: { buffer: [] } }, { ...good, nextSample: Infinity },
    { ...good, markers: Array(601).fill({ t: 0, kind: 'event' }) },
    { ...good, markers: [{ t: 0, kind: 'event', params: { nested: [] } }] },
    { ...good, markers: [{ t: 0, kind: 'event', key: 'x'.repeat(97) }] }];
  const atobOriginal = globalThis.atob;
  globalThis.atob = () => { assert.fail('invalid shape must never reach decode'); };
  try {
    for (const block of malformed) {
      assert.equal(h.restore(block), false);
      assert.equal(h.count, 0);
      assert.equal(h.missingBefore, true);
      assert.equal(h.latestTime, 1);
    }
  } finally { globalThis.atob = atobOriginal; }
  const binary = (block, field, offset, value, width) => {
    const bytes = Uint8Array.from(atob(block[field]), c => c.charCodeAt(0));
    new DataView(bytes.buffer)[width === 8 ? 'setFloat64' : 'setFloat32'](offset, value, true);
    return { ...block, [field]: btoa(String.fromCharCode(...bytes)) };
  };
  for (const block of [binary(good, 'time', 8, 0, 8), binary(good, 'time', 8, 2, 8),
    binary(good, 'time', 0, -1, 8), binary(good, 'time', 0, NaN, 8),
    binary(good, 'time', 0, Infinity, 8), binary(good, 'values', 0, Infinity, 4),
    binary(good, 'values', 0, -Infinity, 4), { ...good, nextSample: 1 },
    { ...good, markers: [{ t: 1, kind: 'on' }, { t: 0, kind: 'off' }] }]) {
    assert.equal(h.restore(good), true);
    assert.equal(h.restore(block), false);
    assert.equal(h.count, 0);
    assert.equal(h.markers.length, 0);
  }
  assert.equal(h.restore(binary(good, 'values', 0, NaN, 4)), true);
  assert.ok(Number.isNaN(h.data.pth[0]));
});

test('no-argument UI commands retain null values through snapshot and restore', () => {
  const e = engine();
  const h = new TrendHistory(e);
  h.sample();
  for (const id of ['scram', 'reset', 'turbine_resume']) {
    assert.equal(h.mark({ t: 0, kind: 'action', id, value: null }), true);
  }
  const snapshot = json(h.snapshot());
  assert.equal(h.restore(snapshot), true);
  assert.deepEqual(h.markers, snapshot.markers);
  assert.deepEqual(h.markers.map(m => m.value), [null, null, null]);
});

test('helper value objects have bounded detached scalar leaves, including after restore', () => {
  const e = engine();
  const h = new TrendHistory(e);
  const entry = { t: 0, kind: 'action', id: 'helper:helper_action_pump_start', value: { n: 1 } };
  assert.equal(h.mark(entry), true);
  entry.value.n = 2;
  assert.equal(h.markers[0].value.n, 1);
  const snapshot = h.snapshot();
  assert.equal(h.restore(snapshot), true);
  snapshot.markers[0].value.n = 3;
  assert.equal(h.markers[0].value.n, 1);
  assert.equal(h.mark({ ...entry, value: { deep: { n: 1 } } }), false);
  assert.equal(h.mark({ ...entry, value: { bad: Infinity } }), false);
  assert.equal(h.mark({ ...entry, value: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, 1])),
    params: { ninth: 1 } }), false);
});

test('eight hours of fractional simulation ticks keep exact deadlines and resume through ring wrap', () => {
  const a = engine(), b = engine();
  const ha = new TrendHistory(a), hb = new TrendHistory(b);
  const d = a.derive();
  ha.sample(a.state, d);
  for (let n = 1; n <= 576040; n++) {
    a.state.t_sim += 0.05;
    ha.sample(a.state, d);
    if (n === 575997) {
      b.state.t_sim = a.state.t_sim;
      assert.equal(hb.restore(json(ha.snapshot())), true);
      assert.equal(JSON.stringify(hb.snapshot()), JSON.stringify(ha.snapshot()));
    } else if (n > 575997) {
      b.state.t_sim += 0.05;
      hb.sample(b.state, d);
    }
  }
  assert.equal(ha.nextSample, 28803);
  assert.equal(ha.count, 28800);
  assert.equal(JSON.stringify(hb.snapshot()), JSON.stringify(ha.snapshot()));
});

test('old/invalid saves never affect simulation load; empty histories invent no past; no-session restore', () => {
  const a = engine();
  for (let n = 0; n < 300; n++) a.step(0.05);
  const blob = json(pack(a));
  assert.equal('trends' in blob, false);
  for (const trends of [undefined, { v: 100 }, null]) {
    const b = engine();
    const session = new Session(b, null); session.start();
    assert.equal(apply({ ...blob, trends }, b, null, session), null);
    assert.deepEqual(b.state, a.state);
    assert.equal(b.ctx.trends.count, 0);
    assert.equal(b.ctx.trends.latestTime, a.state.t_sim);
    assert.equal(b.ctx.trends.missingBefore, true);
    assert.equal(b.ctx.trends.sample(), true);
    assert.deepEqual(times(b.ctx.trends), [a.state.t_sim]);
  }
  const h = new TrendHistory(a);
  assert.equal(h.count, 0);
  const b = engine();
  assert.equal(apply(json(pack(a)), b), null);
  assert.equal(b.ctx.trends.count, 0);
  assert.equal(b.ctx.trends.missingBefore, true);
  h.sample();
  assert.equal(apply(json(pack(a)), b), null);
  assert.deepEqual(b.ctx.trends.snapshot(), h.snapshot());
  assert.equal(b.ctx.trends.sample(), false);
});

// Also consumed by the API tests: measure and store an actual JS-produced save,
// with maximally bounded marker strings/params and a full learning journal.
export function fullTrendSave(id = 'rbmk') {
  const e = engine(id);
  const session = new Session(e, null);
  session.demandRng.restore([1, 2, 3, 4]);
  session.start();
  const h = e.ctx.trends, d = e.derive();
  for (let t = 1; t <= 28800; t++) { e.state.t_sim = t; h.sample(e.state, d); }
  for (let n = 0; n < 600; n++) {
    h.mark({ t: 28201 + n, kind: 'goal_reset', id: 'i'.repeat(96), key: 'k'.repeat(96),
      value: 'v'.repeat(64), severity: 3,
      params: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`p${i}`.padEnd(32, 'p'), 's'.repeat(64)])) });
  }
  e.ctx.learning = { entries: h.markers.map(m => ({ ...m, kind: 'event' })), active: {}, truncated: true };
  return pack(e, null, null, session);
}

test('full eight-hour snapshot plus 600 maximal markers and learning entries fits 4 MiB', t => {
  for (const id of ['pwr', 'bwr', 'rbmk']) {
    const blob = fullTrendSave(id);
    const bytes = new TextEncoder().encode(JSON.stringify(blob)).length;
    assert.equal(blob.trends.count, 28800);
    assert.equal(blob.trends.time.length + blob.trends.values.length, 2611200);
    assert.ok(bytes < 4 * 1024 * 1024, `${bytes} bytes`);
    const e = engine(id);
    assert.equal(apply(json(blob), e), null);
    assert.deepEqual(e.ctx.trends.snapshot(), blob.trends);
    t.diagnostic(`${id} full save: ${bytes} bytes; binary: 1958400 bytes; base64: 2611200 bytes`);
  }
});
