// Audit probes: assertions confirm the observed bugs, not desired behavior.
// Run from any directory: node reactorsim/audit/reproduce.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { pack, apply } from '../static/js/net/persist.js';
import { Session, PHASE } from '../static/js/game/session.js';
import { Scenario, RunState } from '../static/js/game/scenario.js';
import { Render } from '../static/js/ui/render.js';
import { TrendRecorder } from '../static/js/ui/trend.js';

for (const id of ['pwr', 'bwr', 'rbmk']) {
  const live = createEngine(getPlant(id));
  live.scram('audit');
  for (let i = 0; i < 1200; i++) live.step(0.05);
  const loaded = createEngine(getPlant(id));
  assert.equal(apply(JSON.parse(JSON.stringify(pack(live))), loaded), null);
  live.step(0.05);
  loaded.step(0.05);
  assert.ok(Math.abs(live.state.P_th - loaded.state.P_th) > 100);
  const values = { thermalMW: [live.state.P_th, loaded.state.P_th] };
  if (id === 'pwr') {
    values.pressureBar = [live.state.pzr_p, loaded.state.pzr_p];
    values.level = [live.state.pzr_L, loaded.state.pzr_L];
    assert.equal(loaded.state.pzr_L, 0);
    assert.ok(live.state.pzr_L > 0.2);
  }
  console.log('SAVE', id, JSON.stringify(values), '(continuous, loaded)');
}

// Execute the actual menu/briefing functions with minimal DOM stand-ins.
const source = readFileSync(new URL('../static/js/main.js', import.meta.url), 'utf8');
const nodes = new Map();
const $ = (id) => {
  if (!nodes.has(id)) nodes.set(id, { hidden: true, replaceChildren() {} });
  return nodes.get(id);
};
const app = {
  session: new Session(createEngine(getPlant('pwr')), null),
  loop: { stop() {} }, bgMusic: { stop() {} }, introMusic: { start() {} },
};
const context = vm.createContext({ app, $, PHASE,
  setText: (n, text) => { n.text = text; }, t: (key) => key,
  el: () => ({}), refreshResumeList() {},
});
for (const name of ['toMenu', 'showBriefing']) {
  const fn = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
  assert.ok(fn, name);
  vm.runInContext(fn[0], context);
}
vm.runInContext('toMenu(); showBriefing({duration_s: 3600});', context);
assert.equal($('#rs-start').hidden, false);
assert.equal(app.session.phase, PHASE.RUNNING);
assert.equal($('#rs-brief-go').text, 'btn_close');
assert.ok(source.includes('if (app.session && app.session.phase === PHASE.RUNNING) return;'));
console.log('MENU: free session remains running; new scenario briefing offers Close.');

// Use the real sampler and render throttle, without constructing a canvas.
const trend = Object.assign(Object.create(TrendRecorder.prototype), {
  channels: [{ get: (s) => s.value }], data: [new Float32Array(28800)],
  time: new Float64Array(28800), count: 0, head: 0, nextSample: 0,
});
const render = new Render();
render.add('trend', (s) => trend.sample(s, {}));
for (let ms = 0; ms <= 1000; ms += 10) {
  const t = ms * 0.06;
  render.tick({ t_sim: t, value: t >= 2 && t <= 4 ? 100 : 0 }, ms);
}
assert.equal(trend.count, 11);
assert.equal(Math.max(...trend.data[0]), 0);
console.log('TREND: 60 simulated seconds, 11 samples; pulse at seconds 2-4 completely absent.');

const scenario = new Scenario({id: 'audit', reactor: 'pwr', demand: [{t: 0, mw: 1400}]});
const run = new RunState(scenario, getPlant('pwr').spec);
run.causeSeconds.set('alarm_test', 600);
run.violationSeconds[3] = 600;
const restored = new RunState(scenario, getPlant('pwr').spec);
restored.restore(JSON.parse(JSON.stringify(run.snapshot())));
assert.equal(restored.violationSeconds[3], 600);
assert.deepEqual(restored.topCauses(), []);
console.log('DEBRIEF: 600 violation seconds retained; associated cause lost after save/load.');
