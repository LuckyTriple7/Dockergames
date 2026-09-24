// Das Szenario "Ausfall von Hauptkuehlmittelpumpen" haelt nur, solange die
// gemessenen Stufen halten: eine Pumpe kostet Sicherheitsabstand, ohne eine
// Ausloesung zu setzen -- zwei setzen sie. Faellt eine der beiden Zahlen
// weg, ist es kein Szenario mehr, sondern ein Klick ins Leere.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { Session, PHASE } from '../static/js/game/session.js';
import { gridDeviationTrips } from '../static/js/game/scenario.js';
import { getEvent, stepEvents } from '../static/js/game/events.js';

const DT = 0.05;
const def = JSON.parse(await readFile(
  new URL('../static/data/scenarios/pwr_rcp_trip.json', import.meta.url), 'utf8'));

function boot() {
  const e = createEngine(getPlant('pwr'), { seed: def.seed });
  const plain = e.step.bind(e);
  e.step = (dt) => { plain(dt); stepEvents(e, dt); };
  for (let i = 0, n = Math.round(240 / DT); i < n; i++) e.step(DT);
  return e;
}
function run(e, seconds) {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) e.step(DT);
}
// 'new' und 'ack' sind die beiden Kachelzustaende einer ANSTEHENDEN Meldung
// (siehe sim/trips.js); 'clear' ist eine gegangene, 'normal' gar keine.
const standing = (e) => e.trips.tiles()
  .filter((x) => (x.tile === 'new' || x.tile === 'ack') && x.severity >= 3).map((x) => x.id);

test('eine Pumpe: Durchsatz und Abstand sinken, es loest nichts aus', () => {
  const e = boot();
  assert.ok(Math.abs(e.state.W_core - 20000) < 50, `vorher ${e.state.W_core.toFixed(0)} kg/s`);
  getEvent('rcp_trip').apply(e, { loop: 0 });
  run(e, 120);
  const flow = e.state.W_core / 20000;
  assert.ok(flow > 0.7 && flow < 0.8, `Kernstrom ${(100 * flow).toFixed(0)} %`);
  const d = e.derive();
  assert.ok(d.dnbr > 1.6 && d.dnbr < 2.0, `DNBR ${d.dnbr.toFixed(2)}`);
  assert.ok(e.state.n > 0.98, `Leistung ${(100 * e.state.n).toFixed(1)} %`);
  assert.deepEqual(standing(e), [], 'eine Pumpe darf noch keine Ausloesung setzen');
});

test('zweite Pumpe: Kuehlmitteldurchsatz und DNBR loesen gemeinsam aus', () => {
  const e = boot();
  getEvent('rcp_trip').apply(e, { loop: 0 });
  run(e, 360);
  getEvent('rcp_trip').apply(e, { loop: 1 });
  run(e, 120);
  const flow = e.state.W_core / 20000;
  assert.ok(flow > 0.48 && flow < 0.56, `Kernstrom ${(100 * flow).toFixed(0)} %`);
  const d = e.derive();
  assert.ok(d.dnbr < 1.3, `DNBR ${d.dnbr.toFixed(2)} -- unter der Ausloesung 1,3`);
  const ids = standing(e);
  assert.ok(ids.includes('rcp_lost'), `stehende Ausloesungen: ${ids.join(',') || 'keine'}`);
  assert.ok(ids.includes('dnbr_low'), `stehende Ausloesungen: ${ids.join(',') || 'keine'}`);
});

test('ausgefallene Pumpen lassen sich nicht wieder anwerfen', () => {
  const e = boot();
  getEvent('rcp_trip').apply(e, { loop: 0 });
  run(e, 60);
  e.hooks.togglePump(e.state, e.spec, e.ctx, 0);
  run(e, 60);
  assert.equal(e.ctx.pumps[0].state, 'tripped', 'Knopf hat die ausgefallene Pumpe wieder angeworfen');
  assert.ok(e.derive().pumpStuckList[0], 'Pumpe meldet sich nicht als ausgefallen');
});

function drive(scramAt) {
  const engine = createEngine(getPlant('pwr'), { seed: def.seed, extraTrips: gridDeviationTrips(def) });
  const session = new Session(engine, def);
  session.start();
  let done = false;
  while (session.phase === PHASE.RUNNING) {
    engine.step(DT);
    session.step(DT, engine.trips.tiles(), engine.trips.unacknowledgedSeconds());
    if (!done && scramAt !== null && engine.state.t_sim >= scramAt) { engine.scram('test'); done = true; }
  }
  return { engine, session, summary: session.result.summary };
}

test('wer die stehende Ausloesung aussitzt, verliert den Lauf', () => {
  const { summary, engine } = drive(null);
  assert.equal(summary.failed, 'fail_trip_ignored');
  assert.ok(!engine.state.destroyed, 'die Physik zerstoert hier nichts -- die Frist tut es');
});

test('Abschalten auf die zweite Meldung hin besteht die Schicht', () => {
  const second = Math.max(...new Session(createEngine(getPlant('pwr'), { seed: def.seed }), def)
    .scenario.events.map((ev) => ev.t));
  assert.ok(second > 600 && second < 840, `zweiter Ausfall bei ${second.toFixed(0)} s`);
  const { summary } = drive(second + 30);
  assert.equal(summary.failed, null);
  assert.equal(summary.completed, true);
});
