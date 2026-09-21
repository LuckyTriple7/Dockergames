// Jahreszeit: das Kühlwasser als einzige Randbedingung, die sich ändert.
//
// Der Weg ist immer derselbe -- Kühlwassertemperatur, Grädigkeit des
// Kondensators, Turbinengegendruck, nutzbares Enthalpiegefälle. Wo er
// herauskommt, hängt aber am Regelkonzept des jeweiligen Typs, und genau das
// wird hier je Typ geprüft statt über einen Kamm geschoren.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngine } from '../static/js/sim/engine.js';
import { getPlant, PLANT_IDS } from '../static/js/plants/index.js';
import { SEASON_IDS, DEFAULT_SEASON, seasonCoolingWater } from '../static/js/game/season.js';
import { pack, apply } from '../static/js/net/persist.js';

const DT = 0.05;

/** Eingeschwungene Volllast bei gegebener Kühlwassertemperatur. */
function steady(reactor, season) {
  const plant = getPlant(reactor);
  const e = createEngine(plant, { n: 1.0, T_cw: seasonCoolingWater(plant.spec, season) });
  for (let i = 0; i < 24000; i++) e.step(DT);
  return { e, s: e.state, d: e.derive(), spec: plant.spec };
}

test('Vier Jahreszeiten, geordnet -- und das Wasser hinkt dem Kalender nach', () => {
  const spec = getPlant('pwr').spec;
  const T = Object.fromEntries(SEASON_IDS.map((id) => [id, seasonCoolingWater(spec, id)]));
  assert.ok(T.winter < T.spring, 'Winter nicht am kaeltesten');
  assert.ok(T.spring < T.autumn, 'Herbst nicht waermer als das Fruehjahr');
  assert.ok(T.autumn < T.summer, 'Sommer nicht am waermsten');
  // Der Herbst WÄRMER als das Frühjahr ist kein Tippfehler: ein Fluss traegt
  // die Waerme des Sommers in den Herbst und die Kaelte des Winters ins
  // Fruehjahr. Das ist die Waermekapazitaet des Wassers, nicht die Lufttemperatur.
  assert.ok(T.autumn - T.spring > 3, 'die Traegheit des Wassers fehlt');
  // Jede Stufe in einem Bereich, den ein Kuehlwasser wirklich annimmt.
  for (const [id, value] of Object.entries(T)) {
    assert.ok(value > 273.15 && value < 313.15, `${id}: ${value} K ist kein Kuehlwasser`);
  }
});

test('Unbekannte Jahreszeit fällt auf den Auslegungspunkt zurück', () => {
  for (const id of PLANT_IDS) {
    const spec = getPlant(id).spec;
    assert.equal(seasonCoolingWater(spec, 'gibtsnicht'), spec.condenser.T_cw);
  }
  assert.ok(Number.isFinite(seasonCoolingWater(null, 'gibtsnicht')));
  assert.ok(SEASON_IDS.includes(DEFAULT_SEASON));
});

test('Ohne Angabe bleibt alles am Auslegungspunkt der Anlagendatei', () => {
  // Ein Szenario waehlt nie eine Jahreszeit: sein Zeitplan und seine Wertung
  // sind auf genau diese eine Zahl abgestimmt.
  for (const id of PLANT_IDS) {
    const plant = getPlant(id);
    const e = createEngine(plant, { n: 1.0 });
    assert.equal(e.state.T_cw, plant.spec.condenser.T_cw, id);
  }
});

test('Warmes Kühlwasser hebt den Kondensatordruck -- bei jedem Typ', () => {
  for (const id of PLANT_IDS) {
    const cold = steady(id, 'winter');
    const warm = steady(id, 'summer');
    assert.ok(warm.s.p_cond > cold.s.p_cond * 2,
      `${id}: ${cold.s.p_cond.toFixed(4)} -> ${warm.s.p_cond.toFixed(4)} bar`);
  }
});

test('SWR und RBMK: der Sommer kostet Megawatt, Volllast wird knapp', () => {
  // Beide fahren die Reaktorleistung nicht der Netzanforderung nach, sondern
  // halten sie -- das schlechtere Vakuum schlaegt deshalb direkt auf die
  // Klemmenleistung durch. Genau das ist die Aufgabe: die Abendspitze der
  // Tageslastkurve (voller Anteil der Nennleistung) ist im Sommer mit dieser
  // Anlage nicht mehr zu decken.
  for (const id of ['bwr', 'rbmk']) {
    const cold = steady(id, 'winter');
    const warm = steady(id, 'summer');
    assert.ok(warm.s.P_e < cold.s.P_e, `${id}: Sommer nicht schwaecher`);
    const loss = (cold.s.P_e - warm.s.P_e) / cold.spec.P0_e;
    assert.ok(loss > 0.02 && loss < 0.08,
      `${id}: ${(loss * 100).toFixed(1)} % Verlust ist keine glaubhafte Groessenordnung`);
    assert.ok(warm.s.P_e < warm.spec.P0_e, `${id}: Volllast im Sommer noch erreichbar`);
    assert.ok(cold.s.P_e > cold.spec.P0_e, `${id}: Volllast im Winter nicht erreichbar`);
    // Die thermische Leistung bleibt, wo sie war -- verloren geht sie im
    // Wasser-Dampf-Kreislauf, nicht im Kern.
    assert.ok(Math.abs(warm.s.P_th - cold.s.P_th) < 0.01 * cold.s.P_th, `${id}: Kern reagiert`);
  }
});

test('DWR: der Sommer kostet erst Reserve, dann Leistung', () => {
  // Der Druckwasserreaktor faehrt turbinengefuehrt: das Regelventil holt sich
  // den fehlenden Dampf, und der Kern zieht nach. Bis 0.6.7 bezahlte der
  // Sommer damit AUSSCHLIESSLICH im Kern -- 101,9 % der thermischen
  // Nennleistung bei unveraenderter Klemmenleistung, lautlos, weil die
  // Leistungsausloesung erst bei 112 % greift. Seit 0.6.8 haelt der
  // Leistungsbegrenzer (plants/pwr.js _limitedDemand) den Kern bei 101 %, und
  // was darueber hinaus fehlt, fehlt an der Klemme.
  //
  // Der Sommer kostet hier also BEIDES, nur in dieser Reihenfolge: zuerst das
  // eine Prozent Kernreserve bis zur Schwelle, danach Megawatt. Bei SWR und
  // RBMK fehlen die Megawatt von der ersten Kilowattstunde an, weil ihr Kern
  // der Anforderung gar nicht nachzieht.
  const cold = steady('pwr', 'winter');
  const warm = steady('pwr', 'summer');
  // Erst die Reserve: mehr thermische Leistung, heisserer Brennstoff, weniger
  // Abstand zur Siedekrise.
  assert.ok(warm.s.P_th > cold.s.P_th, 'Kern zieht nicht nach');
  assert.ok(warm.d.dnbr < cold.d.dnbr, 'Abstand zur Siedekrise unveraendert');
  assert.ok(warm.s.T_f > cold.s.T_f, 'Brennstoff nicht heisser');
  // Aber nur bis zur Schwelle des Begrenzers, nicht bis zur Ausloesung.
  assert.ok(warm.s.P_th / warm.spec.P0_th < 1.011,
    `Kern steht bei ${(warm.s.P_th / warm.spec.P0_th * 100).toFixed(2)} % -- Begrenzer greift nicht`);
  assert.ok(warm.s.n < 1.12, `Sommer allein loest aus: n = ${warm.s.n.toFixed(3)}`);
  // Und dann die Megawatt. Weniger als beim SWR und RBMK (dort ueber 2 %),
  // weil der Kern das erste Prozent abfaengt -- aber die Volllast ist auch
  // hier nicht mehr zu halten.
  assert.ok(warm.s.P_e < cold.s.P_e, 'Sommer gibt keine Leistung ab');
  assert.ok(warm.s.P_e < warm.spec.P0_e, 'Volllast im Sommer noch erreichbar');
  const loss = (cold.s.P_e - warm.s.P_e) / cold.spec.P0_e;
  assert.ok(loss > 0.003 && loss < 0.02,
    `${(loss * 100).toFixed(2)} % Verlust ist keine glaubhafte Groessenordnung`);
});

test('Die gewählte Jahreszeit überlebt den Spielstand', () => {
  const plant = getPlant('rbmk');
  const summer = seasonCoolingWater(plant.spec, 'summer');
  const e = createEngine(plant, { n: 1.0, T_cw: summer });
  for (let i = 0; i < 200; i++) e.step(DT);
  const blob = JSON.parse(JSON.stringify(pack(e, null, null, null)));

  // Der zweite Motor startet am Auslegungspunkt -- ohne den Spielstand waere
  // der Sommer nach dem Laden lautlos verschwunden.
  const e2 = createEngine(plant, { n: 1.0 });
  assert.equal(e2.state.T_cw, plant.spec.condenser.T_cw);
  assert.equal(apply(blob, e2, null, null), null);
  assert.equal(e2.state.T_cw, summer);
});

test('Ein Spielstand ohne Kühlwasser bleibt ladbar', () => {
  // Staende von vor 0.6.7 kennen s.T_cw nicht. Sie muessen laden und dabei
  // auf dem Auslegungspunkt stehen bleiben, nicht auf NaN.
  const plant = getPlant('bwr');
  const e = createEngine(plant, { n: 1.0 });
  for (let i = 0; i < 200; i++) e.step(DT);
  const blob = JSON.parse(JSON.stringify(pack(e, null, null, null)));
  delete blob.state.T_cw;

  const e2 = createEngine(plant, { n: 1.0 });
  assert.equal(apply(blob, e2, null, null), null);
  assert.equal(e2.state.T_cw, plant.spec.condenser.T_cw);
  e2.step(DT);
  assert.ok(Number.isFinite(e2.state.p_cond));
});
