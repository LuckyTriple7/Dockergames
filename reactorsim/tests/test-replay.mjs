// Server-Nachrechnung (game/replay.js): ein Protokoll aufgezeichneter
// Bedienhandlungen muss, noch einmal durchgerechnet, exakt dieselbe Wertung
// ergeben wie der Live-Lauf, aus dem es stammt -- das ist der ganze Sinn der
// Sache (Backlog "Serverseitige Nachrechnung statt Plausibilitätsprüfung").

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { Session, PHASE } from '../static/js/game/session.js';
import { gridDeviationTrips } from '../static/js/game/scenario.js';
import { attachRecorder } from '../static/js/game/recorder.js';
import { record } from '../static/js/game/coreActions.js';
import { recordingKit, captureKit } from '../static/js/game/replayKit.js';
import { replayRun } from '../static/js/game/replay.js';
import { runHelper } from '../static/js/game/helper.js';
import { score } from '../static/js/game/scoring.js';

const DT = 0.05;
const SCN_DIR = new URL('../static/data/scenarios/', import.meta.url);

async function loadScenario(name) {
  return JSON.parse(await readFile(new URL(name, SCN_DIR), 'utf8'));
}

/** Treibt eine Session bis zum Ende, wie main.js' Loop/afterStep es tun --
 *  `onStep(n)` darf vor dem naechsten engine.step() Handlungen ausloesen.
 *  @returns {Session} die fertige Session (.result.summary steht danach) */
function driveToEnd(engine, scenarioDef, onStep) {
  const session = new Session(engine, scenarioDef);
  session.start();
  let n = 0;
  if (onStep) onStep(n);
  while (session.phase === PHASE.RUNNING) {
    engine.step(DT);
    n++;
    session.step(DT, engine.trips.tiles(), engine.trips.unacknowledgedSeconds());
    if (onStep) onStep(n);
  }
  return session;
}

test('replayRun reproduziert einen Live-Lauf ohne jede Bedienhandlung', async () => {
  const plant = getPlant('pwr');
  const scenarioDef = await loadScenario('pwr_turbine_trip.json');
  const engine = createEngine(plant, { seed: scenarioDef.seed, extraTrips: gridDeviationTrips(scenarioDef) });
  const session = driveToEnd(engine, scenarioDef);
  assert.ok(session.result, 'Live-Lauf muss zu Ende kommen');

  const replayed = replayRun(plant, scenarioDef, []);
  assert.deepEqual(replayed, session.result.summary);
});

test('guided feedwater: recorded RESA at 191s and helper at 195s replay exactly', async () => {
  const plant = getPlant('pwr');
  const def = await loadScenario('pwr_feedwater_loss.json');
  const engine = createEngine(plant, { seed: def.seed, extraTrips: gridDeviationTrips(def) });
  attachRecorder(engine);
  const session = driveToEnd(engine, def, (n) => {
    if (n === Math.round(191 / DT)) record(engine, 'scram');
    if (n === Math.round(195 / DT)) {
      assert.equal(engine.ctx.fwCtl.auto, false);
      assert.equal(runHelper(engine, plant.spec.id, 'sg_level_low').status, 'fixed');
      assert.equal(engine.ctx.fwCtl.auto, true);
    }
  });
  const log = engine.recorder.serialize();
  assert.deepEqual(log, [
    { n: 3820, id: 'scram', value: undefined },
    { n: 3900, id: 'helper', value: 'sg_level_low' },
  ]);
  const replayed = replayRun(plant, def, JSON.parse(JSON.stringify(log)));
  assert.deepEqual(replayed, session.result.summary);
  assert.equal(replayed.completed, true);
  assert.equal(replayed.failed, null);
  assert.equal(replayed.duration_s, def.duration_s);
  assert.deepEqual(replayed.objectives, [{ id: 'supply', met: true }, { id: 'stable', met: true }]);
  assert.deepEqual(score(replayed), { score: session.result.score, parts: session.result.parts });
  assert.equal(score(replayed).parts.objectives, 2000);
  assert.equal(score(replayed).parts.mission, 1000);
  assert.equal(score(replayed).parts.bonus, 250);
  assert.equal(replayRun(plant, def, log.filter(a => a.id !== 'helper')).completed, false);
});

test('helper records only own known reactor and trip IDs, including valid no-ops', () => {
  const engine = createEngine(getPlant('pwr'));
  attachRecorder(engine);
  engine.ctx.fwCtl.auto = false;
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'unknown', null, {}, ['pwr']]) {
    assert.equal(runHelper(engine, id, 'sg_level_low').status, 'unfixable');
  }
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'unknown', null, {}, ['sg_level_low']]) {
    assert.equal(runHelper(engine, 'pwr', id).status, 'unfixable');
  }
  assert.deepEqual(engine.recorder.serialize(), []);
  assert.equal(engine.ctx.fwCtl.auto, false);
  assert.equal(runHelper(engine, 'pwr', 'sg_level_low').status, 'fixed');
  assert.equal(runHelper(engine, 'pwr', 'sg_level_low').status, 'none');
  assert.equal(runHelper(engine, 'pwr', 'power_high').status, 'unfixable');
  assert.deepEqual(engine.recorder.serialize(), ['sg_level_low', 'sg_level_low', 'power_high']
    .map(value => ({ n: 0, id: 'helper', value })));
});

for (const scenario of ['pwr_sg_tube_leak', 'pwr_combined_faults']) {
  test(`${scenario}: forbidden helper rejects the incident log, even beyond run end`, async () => {
    const def = await loadScenario(`${scenario}.json`);
    for (const n of [0, 3900, 100000]) {
      assert.equal(replayRun(getPlant('pwr'), def, [{ n, id: 'helper', value: 'sg_level_low' }]), null);
    }
  });
}

test('incident replay rejects invalid helper IDs, shapes and inherited event properties', async () => {
  const def = await loadScenario('pwr_feedwater_loss.json');
  const event = { n: 3900, id: 'helper', value: 'sg_level_low' };
  const invalid = [
    ...['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'unknown', null, {}, ['sg_level_low']]
      .map(value => ({ ...event, value })),
    ...[-1, 1.5, '3900', null, Number.MAX_SAFE_INTEGER].map(n => ({ ...event, n })),
    { id: 'helper', value: 'sg_level_low' }, { n: 0, id: 'helper' },
    Object.assign(Object.create({ id: 'helper' }), { n: 0, value: 'sg_level_low' }),
    Object.assign(Object.create({ n: 0 }), { id: 'helper', value: 'sg_level_low' }),
    Object.assign(Object.create({ value: 'sg_level_low' }), { n: 0, id: 'helper' }),
    { n: 100000, id: 'helper', value: 'unknown' },
  ];
  for (const action of invalid) assert.equal(replayRun(getPlant('pwr'), def, [action]), null);
});

test('legacy scenarios without guidance replay valid helpers and ignore invalid ones', async () => {
  const plant = getPlant('pwr');
  const def = await loadScenario('pwr_porv_stuck.json');
  const engine = createEngine(plant, { seed: def.seed, extraTrips: gridDeviationTrips(def) });
  attachRecorder(engine);
  const session = driveToEnd(engine, def, (n) => {
    if (n === 5000) runHelper(engine, 'pwr', 'porv_stuck');
  });
  const log = engine.recorder.serialize();
  assert.equal(log.length, 1);
  assert.deepEqual(replayRun(plant, def, [...log, { n: 0, id: 'helper', value: '__proto__' }]),
    session.result.summary);
});

test('BWR emergency power, depressurization and injection replay exactly', async () => {
  const plant = getPlant('bwr');
  const original = await loadScenario('bwr_fukushima.json');
  const def = { ...original, duration_s: 600,
    events: [{ t: 30, id: 'earthquake_scram' }, { t: 60, id: 'station_blackout' }] };
  const engine = createEngine(plant, { seed: def.seed, extraTrips: gridDeviationTrips(def) });
  attachRecorder(engine);
  const map = {};
  const kit = recordingKit(captureKit(map), (id, value) => engine.recorder.record(id, value));
  plant.hooks.uiControls(engine.state, engine.spec, engine.ctx, kit);
  const session = driveToEnd(engine, def, (n) => {
    if (n === 1800) map['btn:ctl_emergency_dc']('1');
    if (n === 1900) map['btn:ctl_depressurize']('1');
    if (n === 2000) map['btn:ctl_fire_inj']('1');
    if (n === 2100) map['btn:ctl_cont_vent']('1');
  });
  const log = engine.recorder.serialize();
  assert.equal(log.length, 4);
  assert.deepEqual(replayRun(plant, def, log), session.result.summary);
});

test('replayRun reproduziert einen Live-Lauf MIT Kernaktionen (Regler, Last, Pumpe, Stäbe)', async () => {
  const plant = getPlant('pwr');
  const scenarioDef = await loadScenario('pwr_turbine_trip.json');
  const engine = createEngine(plant, { seed: scenarioDef.seed, extraTrips: gridDeviationTrips(scenarioDef) });
  attachRecorder(engine);

  const session = driveToEnd(engine, scenarioDef, (n) => {
    // Ein paar handfeste Eingriffe an verschiedenen Punkten -- Regler auf
    // Hand und zurück, Lastanforderung, Pumpe aus und wieder an, Stäbe
    // gezupft. Nichts davon muss sinnvoll sein, nur reproduzierbar.
    if (n === 100) { record(engine, 'gov_auto', false); record(engine, 'gov_write', 60); }
    if (n === 400) record(engine, 'gov_auto', true);
    if (n === 800) record(engine, 'demand_set', 900);
    if (n === 1200) record(engine, 'pump_toggle', 1);
    if (n === 1600) record(engine, 'pump_toggle', 1);
    if (n === 2000) record(engine, 'rod_jog', -1);
    if (n === 2001) record(engine, 'rod_jog', -1);
  });
  assert.ok(session.result, 'Live-Lauf muss zu Ende kommen');
  const log = engine.recorder.serialize();
  assert.ok(log.length >= 8, `zu wenig aufgezeichnet: ${log.length}`);

  const replayed = replayRun(plant, scenarioDef, log);
  assert.deepEqual(replayed, session.result.summary);
});

test('replayRun: typspezifische Bedienung über hooks.uiControls() (PWR-Blockventil, Borsäure)', async () => {
  const plant = getPlant('pwr');
  const scenarioDef = await loadScenario('pwr_porv_stuck.json');
  const engine = createEngine(plant, { seed: scenarioDef.seed, extraTrips: gridDeviationTrips(scenarioDef) });
  attachRecorder(engine);

  // Derselbe Kit-Tausch wie panels.js beim echten Rundenstart, nur mit einem
  // Fake-Kit, der wie ui/controls.js aussieht, aber kein DOM baut. pwr.js
  // uiControls() reicht das `node`-Feld jedes Widgets nach außen durch --
  // hier steckt deshalb die Callback-Funktion selbst dahinter, aufrufbar
  // wie ein Klick auf den echten Knopf.
  const fakeKit = {
    autoSwitch: (labelKey, initial, onChange) => ({ node: onChange, set() {} }),
    station: (o) => ({ node: o.write, set() {} }),
    slider: (o) => ({ node: o.onInput, set() {} }),
    buttonGroup: (labelKey, options, initial, onChange) => ({ node: onChange, set() {} }),
  };
  const calls = [];
  const kit = recordingKit(fakeKit, (id, v) => { calls.push([id, v]); engine.recorder.record(id, v); });
  const widgets = plant.hooks.uiControls(engine.state, engine.spec, engine.ctx, kit);
  // porvBlock und boron sind beim PWR die ersten beiden Eintraege, siehe
  // pwr.js uiControls() -- ueber ihren Mount-Namen zu finden, nicht ueber
  // die Reihenfolge, falls sich die je aendert.
  const clickPorvBlock = widgets.find((w) => w.mount === 'primary').node;
  const clickBoron = widgets.find((w) => w.mount === 'chem').node;

  const session = driveToEnd(engine, scenarioDef, (n) => {
    if (n === 200) clickPorvBlock('0');   // Blockventil zu
    if (n === 5000) clickBoron('1');      // Aufborieren
    if (n === 6000) clickBoron('0');      // Stopp
  });
  assert.ok(session.result, 'Live-Lauf muss zu Ende kommen');
  assert.deepEqual(calls.map((c) => c[0]), ['btn:ctl_porv_block', 'btn:ctl_boron', 'btn:ctl_boron']);

  const replayed = replayRun(plant, scenarioDef, engine.recorder.serialize());
  assert.deepEqual(replayed, session.result.summary);
});
