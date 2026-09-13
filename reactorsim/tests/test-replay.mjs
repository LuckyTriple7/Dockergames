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
import { recordingKit } from '../static/js/game/replayKit.js';
import { replayRun } from '../static/js/game/replay.js';

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
