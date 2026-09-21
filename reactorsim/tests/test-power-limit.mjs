// Leistungsbegrenzer des Druckwasserreaktors.
//
// Dieser Reaktortyp fährt turbinengeführt: das Regelventil holt sich den
// Dampf, den die Lastanforderung verlangt, der Kern zieht nach. Ohne Begrenzer
// hatte das eine Lücke, die erst mit der Jahreszeit (0.6.7) sichtbar wurde --
// im Sommer stand die Anlage bei 101,9 % der thermischen Nennleistung und
// lieferte unverändert volle Klemmenleistung. Der Sommer kostete also nicht
// Leistung, sondern Kernreserve, und zwar lautlos: die Leistungsauslösung
// greift erst bei 112 %.
//
// Geprüft wird beides, und das zweite ist das Wichtigere: dass er im Sommer
// greift, UND dass er im Auslegungspunkt nichts anfasst. Ein Begrenzer, der
// sich in jede Lastrampe einmischt, wäre schlimmer als keiner -- jedes
// Szenario beruht auf dem Auslegungspunkt.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { seasonCoolingWater } from '../static/js/game/season.js';
import { pack, apply } from '../static/js/net/persist.js';

const DT = 0.05;
const LIMIT_FRAC = 1.01;

function steady(season, steps = 40000) {
  const plant = getPlant('pwr');
  const T = season ? seasonCoolingWater(plant.spec, season) : undefined;
  const e = createEngine(plant, { n: 1.0, ...(T ? { T_cw: T } : {}) });
  for (let i = 0; i < steps; i++) e.step(DT);
  return { e, s: e.state, spec: plant.spec };
}

test('Im Auslegungspunkt greift er nicht -- sonst wäre jedes Szenario betroffen', () => {
  // Bei 15 °C Kühlwasser steht die Anlage bei voller Klemmenleistung auf
  // 100,02 % der thermischen Nennleistung: die beiden Nennwerte sind genau
  // aufeinander abgestimmt. Genau darum liegt die Schwelle bei 101 % und
  // nicht bei 100 %.
  const { e, s, spec } = steady(null);
  assert.equal(s.T_cw, spec.condenser.T_cw);
  const frac = s.P_th / spec.P0_th;
  assert.ok(frac > 0.999 && frac < LIMIT_FRAC,
    `Auslegungspunkt liegt bei ${(frac * 100).toFixed(2)} % -- die Schwelle taugt nicht mehr`);
  assert.equal(e.ctx.powerLimitMw, 0, 'Begrenzer greift im Auslegungspunkt ein');
  assert.ok(s.P_e >= spec.P0_e, `nur ${s.P_e.toFixed(0)} MW im Auslegungspunkt`);
});

test('Winter, Frühjahr und Herbst bleiben unberührt', () => {
  for (const season of ['winter', 'spring', 'autumn']) {
    const { e, s, spec } = steady(season);
    assert.equal(e.ctx.powerLimitMw, 0, `${season}: Begrenzer greift ein`);
    assert.ok(s.P_e >= spec.P0_e, `${season}: nur ${s.P_e.toFixed(0)} MW`);
    assert.ok(s.P_th / spec.P0_th < LIMIT_FRAC, `${season}: über der Schwelle`);
  }
});

test('Im Sommer greift er und hält den Kern auf der Schwelle', () => {
  const { e, s, spec } = steady('summer');
  assert.ok(e.ctx.powerLimitMw > 5, `Begrenzer nimmt nur ${e.ctx.powerLimitMw.toFixed(1)} MW weg`);
  const frac = s.P_th / spec.P0_th;
  assert.ok(Math.abs(frac - LIMIT_FRAC) < 0.001,
    `Kern steht bei ${(frac * 100).toFixed(2)} % statt auf der Schwelle`);
  // Und JETZT kostet der Sommer Megawatt statt Kernreserve -- dasselbe, was er
  // beim SWR und RBMK schon immer kostete (siehe test-season.mjs).
  assert.ok(s.P_e < spec.P0_e, `Sommer liefert noch ${s.P_e.toFixed(0)} MW`);
  assert.ok(spec.P0_e - s.P_e > 5 && spec.P0_e - s.P_e < 40,
    `${(spec.P0_e - s.P_e).toFixed(0)} MW Verlust ist keine glaubhafte Groessenordnung`);
});

test('Er pendelt nicht', () => {
  // Der erste Entwurf war rein proportional und ergab einen Grenzzyklus von
  // 22 MW mit etwa 2000 s Periode -- die Strecke vom Ventil in die thermische
  // Leistung hat mehrere hundert Sekunden Totzeit.
  const { e } = steady('summer');
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 40000; i++) {
    e.step(DT);
    lo = Math.min(lo, e.ctx.powerLimitMw);
    hi = Math.max(hi, e.ctx.powerLimitMw);
  }
  assert.ok(hi - lo < 1, `Begrenzer schwankt um ${(hi - lo).toFixed(2)} MW`);
});

test('Ein Lastwechsel zieht ihn nicht hoch, und er gibt wieder alles her', () => {
  // Der zweite Entwurf war ein Integrator ohne Obergrenze: bei 60 auf 100 %
  // im Auslegungspunkt schwingt die thermische Leistung kurz über die
  // Schwelle, und er zog sich auf 99 MW hoch -- 7 % der Nennleistung, mit
  // denen er anschliessend minutenlang jede Rampe verbog.
  const { e, spec } = steady(null, 24000);
  let worst = 0;
  for (const frac of [0.6, 1.0, 0.7, 1.0]) {
    e.state.P_demand = frac * spec.P0_e;
    for (let i = 0; i < 40000; i++) {
      e.step(DT);
      worst = Math.max(worst, e.ctx.powerLimitMw);
    }
  }
  // Die Obergrenze von 2 % bleibt unter dem Toleranzband der
  // Lastfolgebewertung (50 MW, siehe game/scenario.js).
  assert.ok(worst <= 0.02 * spec.P0_e + 1e-6, `Begrenzer zog sich auf ${worst.toFixed(1)} MW hoch`);
  assert.ok(worst < 50, 'Eingriff groesser als das Toleranzband der Lastfolge');
  // Und am Ende steht die Anlage wieder voll da: der Eingriff war der
  // Ueberschwinger, nicht ein Gedaechtnis davon.
  assert.equal(e.ctx.powerLimitMw, 0, 'Begrenzer bleibt nach dem Lastwechsel stehen');
  assert.ok(e.state.P_e >= spec.P0_e, `nur ${e.state.P_e.toFixed(0)} MW nach dem Lastwechsel`);
  assert.equal(e.state.scram.active, false);
});

test('Nur der Druckwasserreaktor hat einen -- die anderen brauchen keinen', () => {
  // SWR und RBMK halten ihre Reaktorleistung; die Lastanforderung treibt den
  // Kern dort gar nicht, es gibt also nichts zu begrenzen.
  for (const id of ['bwr', 'rbmk']) {
    const e = createEngine(getPlant(id), { n: 1.0, T_cw: seasonCoolingWater(getPlant(id).spec, 'summer') });
    for (let i = 0; i < 24000; i++) e.step(DT);
    assert.equal(e.ctx.powerLimitMw, undefined, `${id} hat einen Begrenzer`);
    assert.ok(Number.isFinite(e.state.P_e));
  }
});

test('Der Begrenzerstand überlebt den Spielstand', () => {
  // Ohne das begänne er nach jedem Laden bei null und liesse die Anlage kurz
  // über die Schwelle laufen.
  const { e } = steady('summer');
  const before = e.ctx.powerLimitMw;
  assert.ok(before > 5);
  const blob = JSON.parse(JSON.stringify(pack(e, null, null, null)));
  assert.ok(Math.abs(blob.context.powerLimitMw - before) < 1e-9, 'nicht im Spielstand');

  const e2 = createEngine(getPlant('pwr'), { n: 1.0 });
  assert.equal(e2.ctx.powerLimitMw, 0);
  assert.equal(apply(blob, e2, null, null), null);
  assert.ok(Math.abs(e2.ctx.powerLimitMw - before) < 1e-9, 'nach dem Laden verloren');
});

test('Ein Spielstand ohne Begrenzerstand bleibt ladbar', () => {
  const { e } = steady('summer');
  const blob = JSON.parse(JSON.stringify(pack(e, null, null, null)));
  delete blob.context.powerLimitMw;
  const e2 = createEngine(getPlant('pwr'), { n: 1.0 });
  assert.equal(apply(blob, e2, null, null), null);
  assert.equal(e2.ctx.powerLimitMw, 0);
  e2.step(DT);
  assert.ok(Number.isFinite(e2.state.P_e));
});
