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
