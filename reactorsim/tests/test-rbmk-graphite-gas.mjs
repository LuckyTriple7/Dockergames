// Der Gaskreislauf des Graphitstapels.
//
// Bis 0.6.29 war alarm_graphite_hot eine Kachel, die nie aufleuchten konnte:
// 760 C haetten bei intaktem Waermedurchgang 166 % Nennleistung gebraucht,
// power_high steht bei 112 % (gemessen mit tests/tools/rbmk_alarm_reach.mjs).
// Der Weg dorthin ist nicht mehr Leistung, sondern der Waermedurchgang selbst.
// Diese Tests halten beide Seiten fest: dass er ohne Stoerung unveraendert
// bleibt, und wohin er mit ihr laeuft.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { getEvent, stepEvents } from '../static/js/game/events.js';
import { pack, apply } from '../static/js/net/persist.js';

const DT = 0.1;
const C = (T) => T - 273.15;

function boot() {
  const e = createEngine(getPlant('rbmk'), { seed: 1, n: 1.0 });
  const plain = e.step.bind(e);
  e.step = (dt) => { plain(dt); stepEvents(e, dt); };
  return e;
}
function run(e, seconds) {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) e.step(DT);
}
const standing = (e) => e.trips.tiles()
  .filter((x) => x.tile === 'new' || x.tile === 'ack').map((x) => x.id);

test('ohne Stoerung bleibt der Waermedurchgang der Auslegungswert', () => {
  const e = boot();
  run(e, 3600);
  assert.equal(e.ctx.graphiteUA.v, e.spec.graphite.UA);
  const T = C(e.state.T_gr);
  assert.ok(T > 565 && T < 580, `T_gr ${T.toFixed(1)} C`);
  assert.ok(!standing(e).includes('graphite_gas_lost'));
  assert.ok(!standing(e).includes('graphite_hot'));
});

test('ohne Gas faellt der Durchgang auf den Stickstoffwert und die Kachel steht sofort', () => {
  const e = boot();
  getEvent('rbmk_graphite_gas_loss').apply(e, {});
  run(e, 1);
  assert.ok(standing(e).includes('graphite_gas_lost'), 'Ursache wird nicht gemeldet');
  // gasTau = 900 s: nach einer Stunde ist der Austausch zu 98 % durch, nach
  // zweien praktisch vollstaendig.
  run(e, 3600);
  assert.ok(e.ctx.graphiteUA.v < 310, `nach 1 h noch ${e.ctx.graphiteUA.v.toFixed(1)} kW/K`);
  run(e, 3600);
  const UA = e.ctx.graphiteUA.v;
  assert.ok(Math.abs(UA - e.spec.graphite.UA_noGas) < 0.5, `UA ${UA.toFixed(2)} kW/K`);
});

test('bei Nennleistung laeuft die Graphittemperatur ueber die Meldeschwelle', () => {
  const e = boot();
  getEvent('rbmk_graphite_gas_loss').apply(e, {});
  run(e, 2 * 3600);
  // Die Schwelle liegt bei 760 C; nach zwei Stunden ist sie gerade genommen.
  assert.ok(C(e.state.T_gr) > 760, `nach 2 h erst ${C(e.state.T_gr).toFixed(1)} C`);
  run(e, 2 * 3600);
  const T = C(e.state.T_gr);
  assert.ok(T > 795 && T < 820, `Endlage ${T.toFixed(1)} C`);
  assert.ok(standing(e).includes('graphite_hot'), `stehende Meldungen: ${standing(e).join(',')}`);
  assert.ok(!e.state.destroyed && !e.state.scram.active, 'das ist eine Materialgrenze, kein Transient');
});

test('unter 89 % Nennleistung bleibt sie darunter', () => {
  const e = boot();
  getEvent('rbmk_graphite_gas_loss').apply(e, {});
  e.ctx.powerCtl.setpoint = 0.87;
  run(e, 4 * 3600);
  const T = C(e.state.T_gr);
  assert.ok(T > 720 && T < 760, `bei 87 % Leistung ${T.toFixed(1)} C`);
  assert.ok(!standing(e).includes('graphite_hot'));
});

test('der Waermestrom in der Diagnose folgt dem wirklichen Durchgang', () => {
  const e = boot();
  const before = e.derive();
  assert.ok(Math.abs(before.graphiteUA - e.spec.graphite.UA) < 1e-9);
  getEvent('rbmk_graphite_gas_loss').apply(e, {});
  run(e, 60);
  const after = e.derive();
  assert.ok(after.graphiteUA < before.graphiteUA, 'UA unveraendert trotz Ausfall');
  assert.ok(after.graphiteGasLost === true);
  // Im Augenblick des Ausfalls ist die Temperatur noch die alte, der
  // Durchgang schon schlechter -- also fliesst weniger Waerme ab.
  assert.ok(after.graphiteHeatMW < before.graphiteHeatMW,
    `${after.graphiteHeatMW.toFixed(0)} statt unter ${before.graphiteHeatMW.toFixed(0)} MW`);
});

test('Spielstand: Merker und Zwischenwert des Durchgangs kommen mit', () => {
  const live = boot();
  getEvent('rbmk_graphite_gas_loss').apply(live, {});
  run(live, 300);   // mitten im Uebergang, nicht am Ende
  const UA = live.ctx.graphiteUA.v;
  assert.ok(UA < live.spec.graphite.UA && UA > live.spec.graphite.UA_noGas, `UA ${UA.toFixed(1)}`);

  const restored = createEngine(getPlant('rbmk'), { seed: 1, n: 1.0 });
  assert.equal(apply(JSON.parse(JSON.stringify(pack(live))), restored), null);
  assert.equal(restored.ctx.graphiteGasLost, true, 'der Merker fehlt nach dem Laden');
  assert.ok(Math.abs(restored.ctx.graphiteUA.v - UA) < 1e-9, 'der Zwischenwert fehlt nach dem Laden');

  // Und er laeuft weiter nach unten statt zurueck auf den Auslegungswert.
  const plain = restored.step.bind(restored);
  restored.step = (dt) => { plain(dt); stepEvents(restored, dt); };
  run(restored, 300);
  assert.ok(restored.ctx.graphiteUA.v < UA, 'der Durchgang klettert nach dem Laden zurueck');
});
