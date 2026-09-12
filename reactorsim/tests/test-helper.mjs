// Automatischer Helfer (game/helper.js): jede Handlung muss ueber echte
// Stellglieder laufen, nicht ueber eine erfundene Abkuerzung -- und die eine
// Regel, die dieses Spiel ausmacht, darf der Helfer nie brechen: die
// Schnellabschaltung selbst (SCRAM/RESA/AZ-5) loest er in KEINEM Fall aus,
// bei keinem der drei Typen -- das bleibt immer Sache des Bedieners (siehe
// sim/trips.js). Beim RBMK ist das zugleich sicherheitsrelevant: AZ-5 fuehrt
// bei weit gezogenen Staeben erst positive Reaktivitaet ein (Graphitspitzen,
// siehe plants/rbmk.js).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { runHelper } from '../static/js/game/helper.js';

function makeEngine(id, opts) {
  return createEngine(getPlant(id), { seed: 1, ...opts });
}

test('unbekannter Reaktortyp oder unbekannte Meldung: unfixable, kein Absturz', () => {
  const e = makeEngine('pwr');
  assert.deepEqual(runHelper(e, 'unbekannt', 'power_high'), { status: 'unfixable', actions: [] });
  assert.deepEqual(runHelper(e, 'pwr', 'unbekannt'), { status: 'unfixable', actions: [] });
});

test('DWR: reine Leistungsausloesung ist unfixable -- nur RESA wuerde helfen, und die druecke der Helfer nie', () => {
  const e = makeEngine('pwr');
  const r = runHelper(e, 'pwr', 'power_high');
  assert.deepEqual(r, { status: 'unfixable', actions: [] });
  assert.equal(e.state.scram.active, false);
});

test('DWR: klemmendes Abblaseventil -- Blockventil zu, Druckhalter auf Automatik, KEIN RESA', () => {
  const e = makeEngine('pwr');
  e.ctx.porvStuck = true;
  e.ctx.pzrCtl.auto = false;
  const r = runHelper(e, 'pwr', 'porv_stuck');
  assert.equal(r.status, 'fixed');
  assert.equal(e.state.porvBlock, 0);
  assert.equal(e.ctx.pzrCtl.auto, true);
  assert.equal(e.state.scram.active, false);
  const keys = r.actions.map((a) => a.key);
  assert.deepEqual(keys, ['helper_action_porv_block_close', 'helper_action_pzr_auto']);
});

test('DWR: zweiter Aufruf auf ein bereits behobenes Ventil meldet none', () => {
  const e = makeEngine('pwr');
  e.ctx.porvStuck = true;
  runHelper(e, 'pwr', 'porv_stuck');
  const r = runHelper(e, 'pwr', 'porv_stuck');
  assert.deepEqual(r, { status: 'none', actions: [] });
});

test('DWR: ausgefallene Hauptkuehlmittelpumpe wird wieder zugeschaltet', () => {
  const e = makeEngine('pwr');
  e.ctx.pumps[1].trip();
  const r = runHelper(e, 'pwr', 'dnbr_low');
  assert.equal(r.status, 'fixed');
  assert.equal(e.ctx.pumps[1].state, 'run');
  assert.ok(r.actions.some((a) => a.key === 'helper_action_pump_start' && a.params.n === 2));
});

test('DWR: klemmende Stabgruppe ist nicht automatisch behebbar', () => {
  const e = makeEngine('pwr');
  assert.deepEqual(runHelper(e, 'pwr', 'rod_stuck'), { status: 'unfixable', actions: [] });
});

test('SWR: Frischdampf-Absperrung zu, aber NICHT geklemmt -- oeffnet wieder, kein SCRAM', () => {
  const e = makeEngine('bwr');
  e.state.msiv = 0;
  const r = runHelper(e, 'bwr', 'msiv');
  assert.equal(r.status, 'fixed');
  assert.equal(e.state.msiv, 1);
  assert.equal(e.state.scram.active, false);
  assert.deepEqual(r.actions, [{ key: 'helper_action_msiv_open', params: undefined }]);
});

test('SWR: Frischdampf-Absperrung klemmt -- oeffnet NICHT, Notkondensator wird nur angefordert (kein RESA)', () => {
  const e = makeEngine('bwr');
  e.ctx.msivStuck = true;
  e.state.msiv = 0;
  e.state.icDemand = 0;
  const r = runHelper(e, 'bwr', 'msiv_stuck');
  assert.equal(r.status, 'fixed');
  assert.equal(e.state.msiv, 0, 'klemmt weiterhin -- ein Kommando aendert daran nichts');
  assert.equal(e.state.scram.active, false);
  assert.equal(e.state.icDemand, 1, 'schon angefordert, damit der Notkondensator sofort greift, sobald der Bediener selbst abschaltet');
});

test('SWR: Wasserstoff kritisch bleibt IMMER unfixable -- Venten wuerde die Explosion selbst ausloesen', () => {
  const e = makeEngine('bwr');
  e.state.h2Mass = 45;
  e.state.contVentOpen = false;
  const r = runHelper(e, 'bwr', 'h2_critical');
  assert.deepEqual(r, { status: 'unfixable', actions: [] });
  assert.equal(e.state.contVentOpen, false, 'der Helfer darf hier nichts anfassen');
});

test('RBMK: ORM kritisch faehrt die Staebe von Hand ein -- NIE automatisch AZ-5', () => {
  const e = makeEngine('rbmk');
  e.state.rod[0] = 0.05; e.state.rod[1] = 0.05;
  e.state.rodDmd[0] = 0.05; e.state.rodDmd[1] = 0.05;
  e.ctx.powerCtl.auto = true;
  const r = runHelper(e, 'rbmk', 'orm_critical');
  assert.equal(r.status, 'fixed');
  assert.equal(e.state.scram.active, false, 'AZ-5 haette bei weit gezogenen Staeben positive Reaktivitaet eingefuehrt');
  assert.equal(e.ctx.powerCtl.auto, false);
  assert.deepEqual([e.state.rodDmd[0], e.state.rodDmd[1]], [1, 1]);
  assert.ok(r.actions.some((a) => a.key === 'helper_action_rods_insert'));
});

test('RBMK: axiale Schieflage ist nicht automatisch behebbar', () => {
  const e = makeEngine('rbmk');
  assert.deepEqual(runHelper(e, 'rbmk', 'axial_tilt'), { status: 'unfixable', actions: [] });
});

test('reine Kinetik-Ausloesungen sind bei allen drei Typen unfixable, nie ein automatisches SCRAM/RESA/AZ-5', () => {
  const cases = [['pwr', 'power_high'], ['pwr', 'period_short'],
    ['bwr', 'power_high'], ['bwr', 'period_short'], ['bwr', 'oprm'],
    ['rbmk', 'power_high'], ['rbmk', 'period_short'], ['rbmk', 'drum_press_high']];
  for (const [id, tripId] of cases) {
    const e = makeEngine(id);
    const r = runHelper(e, id, tripId);
    assert.deepEqual(r, { status: 'unfixable', actions: [] }, `${id}/${tripId}`);
    assert.equal(e.state.scram.active, false, `${id}/${tripId}`);
  }
});

test('Turbinenschnellschluss (typunabhaengig): zuschalten, wenn kein SCRAM ansteht', () => {
  for (const id of ['pwr', 'bwr', 'rbmk']) {
    const e = makeEngine(id);
    e.state.turbineTripped = true;
    const r = runHelper(e, id, 'turbine_trip');
    assert.equal(r.status, 'fixed', id);
    assert.equal(e.state.turbineTripped, false, id);
    assert.deepEqual(r.actions, [{ key: 'helper_action_turbine_resume', params: undefined }], id);
  }
});

test('Turbinenschnellschluss nach SCRAM: erst zurueckstellen, dann zuschalten', () => {
  const e = makeEngine('pwr');
  e.scram('manual');   // setzt turbineTripped ueber onScram()
  assert.equal(e.state.turbineTripped, true);
  const r = runHelper(e, 'pwr', 'turbine_trip');
  assert.equal(r.status, 'fixed');
  assert.equal(e.state.scram.active, false);
  assert.equal(e.state.turbineTripped, false);
  assert.deepEqual(r.actions.map((a) => a.key), ['helper_action_scram_reset', 'helper_action_turbine_resume']);
});

test('jede bekannte Meldung jedes Typs laeuft ohne Ausnahme durch', () => {
  for (const id of ['pwr', 'bwr', 'rbmk']) {
    const plant = getPlant(id);
    for (const def of plant.spec.trips) {
      const e = makeEngine(id);
      const r = runHelper(e, id, def.id);
      assert.ok(['fixed', 'none', 'unfixable'].includes(r.status), `${id}/${def.id}: ${r.status}`);
      assert.ok(Array.isArray(r.actions), `${id}/${def.id}: actions ist kein Array`);
    }
  }
});
