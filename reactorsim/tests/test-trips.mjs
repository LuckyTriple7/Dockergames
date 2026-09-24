// Meldetafel (sim/trips.js): Ringback-Folge nach ISA-18.2.
//
// Regressionstest fuer einen echten Fehler: die Hupe (TripSystem.horn) lief
// nur bei 'new', nicht bei 'clear' -- eine Stoerung, die von selbst wieder
// verschwand, BEVOR jemand quittierte, liess die Hupe schon verstummen.
// Fuer den zweistufigen Alarmton (annunciator.js Horn: Sirene einmal, dann
// Dauerton bis zum Quittieren) hiess das: die Sirene wurde mitten im Ton
// abgewuergt, sobald die Ursache weg war, und der Dauerton kam praktisch nie
// an, weil die meisten Stoerungen kuerzer stehen als die Sirene selbst laeuft.

import test from 'node:test';
import assert from 'node:assert/strict';

import { TripSystem, SEVERITY } from '../static/js/sim/trips.js';

function makeSystem(hold_s = 1) {
  let active = true;
  const defs = [{ id: 'x', key: 'trip_x', severity: SEVERITY.WARN, test: () => active, delay_s: 0, hold_s }];
  return { ts: new TripSystem(defs), setActive: (v) => { active = v; } };
}

test('Hupe bleibt an in "new"', () => {
  const { ts } = makeSystem();
  ts.step({}, {}, 0.1);
  assert.equal(ts.tiles()[0].tile, 'new');
  assert.equal(ts.horn, true);
});

test('Bedingung geht sofort weg: Kachel bleibt "new", bis hold_s erreicht ist', () => {
  const { ts, setActive } = makeSystem(1);
  ts.step({}, {}, 0.1);
  setActive(false);
  ts.step({}, {}, 0.5); // tOff = 0.5s, hold_s = 1s -- noch nicht genug
  assert.equal(ts.tiles()[0].tile, 'new');
  assert.equal(ts.horn, true);
});

test('"clear" (Ursache weg, nicht quittiert): Hupe UND Kachel-Blinken laufen weiter', () => {
  const { ts, setActive } = makeSystem(1);
  ts.step({}, {}, 0.1);          // -> 'new'
  setActive(false);
  ts.step({}, {}, 1.5);          // tOff > hold_s -> 'clear'
  assert.equal(ts.tiles()[0].tile, 'clear');
  // Das ist der eigentliche Fehler gewesen: horn wurde hier faelschlich false.
  assert.equal(ts.horn, true, 'unquittiert ist unquittiert -- "clear" darf die Hupe nicht abstellen');
  assert.ok(ts.unacknowledgedSeconds() > 0);
});

test('Erst Quittieren stellt Hupe und Kachel ab', () => {
  const { ts, setActive } = makeSystem(1);
  ts.step({}, {}, 0.1);
  setActive(false);
  ts.step({}, {}, 1.5); // -> 'clear', Hupe noch an
  assert.equal(ts.horn, true);
  ts.ack();
  ts.step({}, {}, 0.1);
  assert.equal(ts.tiles()[0].tile, 'normal');
  assert.equal(ts.horn, false);
});

test('Bleibt die Bedingung dauerhaft an, blinkt/hupt es ununterbrochen weiter', () => {
  const { ts } = makeSystem();
  for (let i = 0; i < 50; i++) {
    ts.step({}, {}, 0.1);
    assert.equal(ts.tiles()[0].tile, 'new', `Schritt ${i}`);
    assert.equal(ts.horn, true, `Schritt ${i}`);
  }
});


// ── Netzabwurf ───────────────────────────────────────────────────────────────
//
// Ein echter Befund aus dem freien Spiel, gemeldet als "kam einfach so, kein
// Alarm nix": loss_of_load oeffnet NUR s.breaker, nicht s.turbineTripped.
// alarm_turbine_trip haengt aber an turbineTripped, also meldete gar nichts --
// waehrend die Generatorleistung auf null fiel und dort blieb, weil auch
// resumeTurbine() nur auf turbineTripped prueft und damit sofort heraus fiel.
// Zwei Fehler in einem Zustand: unsichtbar UND unaufloesbar.

import { createEngine as makeEngineForGrid } from '../static/js/sim/engine.js';
import { getPlant as plantForGrid } from '../static/js/plants/index.js';
import { getEvent as eventForGrid } from '../static/js/game/events.js';

/** Eingeschwungene Anlage, dann Netzabwurf, dann ein paar Sekunden. */
function afterLoadRejection(id, seconds = 20) {
  const e = makeEngineForGrid(plantForGrid(id), { n: 1.0 });
  for (let i = 0; i < 8000; i++) e.step(0.05);
  eventForGrid('loss_of_load').apply(e, {});
  for (let i = 0, n = Math.round(seconds / 0.05); i < n; i++) e.step(0.05);
  return e;
}

const standing = (e) => e.trips.tiles()
  .filter((t) => t.tile === 'new' || t.tile === 'ack').map((t) => t.key);

for (const id of ['pwr', 'bwr', 'rbmk']) {
  test(`${id}: Netzabwurf meldet sich und ist nicht endgueltig`, () => {
    const e = afterLoadRejection(id);
    assert.equal(e.state.breaker, false);
    assert.equal(e.state.turbineTripped, false, 'Netzabwurf wirft die Turbine nicht ab');
    assert.equal(e.state.P_e, 0, 'ohne Netz keine Generatorleistung');

    // Sichtbar: eigene Kachel UND Hupe. Eine Protokollzeile allein scrollt
    // vorbei, und genau das war der gemeldete Fehler.
    assert.ok(standing(e).includes('alarm_grid_lost'), `keine Meldung: ${standing(e)}`);
    assert.equal(e.trips.horn, true, 'keine Hupe');

    // Aufloesbar: derselbe Knopf wie beim Turbinenschnellschluss.
    assert.equal(e.resumeTurbine(), true, 'Schalter laesst sich nicht wieder einlegen');
    assert.equal(e.state.breaker, true);
    for (let i = 0; i < 400; i++) e.step(0.05);
    assert.ok(e.state.P_e > 0, `Generator bleibt bei ${e.state.P_e}`);
    assert.ok(!standing(e).includes('alarm_grid_lost'), 'Meldung bleibt stehen');
  });
}

test('Nach einer Schnellabschaltung meldet nur der Turbinenschnellschluss', () => {
  // onScram() oeffnet den Schalter mit. Zwei Kacheln fuer dieselbe Ursache
  // waeren eine zu viel -- deshalb schliesst grid_lost turbineTripped aus.
  const e = makeEngineForGrid(plantForGrid('pwr'), { n: 1.0 });
  for (let i = 0; i < 8000; i++) e.step(0.05);
  e.scram('test');
  for (let i = 0; i < 400; i++) e.step(0.05);
  assert.equal(e.state.breaker, false);
  assert.ok(standing(e).includes('alarm_turbine_trip'));
  assert.ok(!standing(e).includes('alarm_grid_lost'), 'doppelte Meldung fuer dieselbe Ursache');
});
