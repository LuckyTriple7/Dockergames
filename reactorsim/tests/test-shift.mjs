// Schichtbericht: alle acht Stunden eine Bilanz, auch im freien Spiel.
//
// Bis 0.6.6 bekam eine Runde ohne Szenario gar keine RunState und damit keine
// einzige Kennzahl -- gerechnet wurde dieselbe Physik, nur sah sie niemand.
// Geprueft wird hier deshalb beides: dass die Kennzahlen im freien Spiel
// ueberhaupt entstehen, und dass der Bericht Zuwaechse meldet statt Summen.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { Session } from '../static/js/game/session.js';
import { getEvent } from '../static/js/game/events.js';
import { ShiftLog, SHIFT_SECONDS } from '../static/js/game/shift.js';
import { pack, apply } from '../static/js/net/persist.js';

/** Freie Runde ohne Stoerungen -- die Bilanz soll hier gemessen werden, nicht
 *  der Zufall. */
function freeSession(reactor = 'pwr', opts = {}) {
  const engine = createEngine(getPlant(reactor), { n: 1.0 });
  const session = new Session(engine, null, { faults: 'off', faultSeed: 1, ...opts });
  session.start();
  const reports = [];
  session.onShift = (r) => reports.push(r);
  return { engine, session, reports };
}

/** Spielschicht weiterdrehen OHNE Physik: die Bilanz liest nur den Zustand,
 *  und ein echter Lauf ueber 16 Stunden waere im Test Minuten statt
 *  Millisekunden. `tiles` ist die Meldetafel dieses Takts -- eine stehende
 *  Kachel darin ist genau das, was als Alarmzeit gezaehlt wird. */
function advance(engine, session, seconds, { step = 60, tiles = [] } = {}) {
  for (let done = 0; done < seconds; done += step) {
    engine.state.t_sim += step;
    session.step(step, tiles, 0);
  }
}

const ALARM = [{ id: 'test', tile: 'new', key: 'alarm_test', severity: 2 }];

/** Eine Pumpe ausfallen lassen und den Trupp sie fertig zuruecksetzen lassen.
 *  Ohne Physik, wie advance(): der Trupp liest nur die Simulationszeit. */
function repairOnePump(engine, session, loop = 0) {
  getEvent('rcp_trip').apply(engine, { loop });
  assert.equal(session.repairs.order(`pump:${loop}`), 'ordered');
  advance(engine, session, 13 * 60, { step: 30 });
}

test('Freies Spiel sammelt Kennzahlen -- vor 0.6.7 gab es dort gar keine', () => {
  const { engine, session } = freeSession();
  assert.ok(session.run, 'freies Spiel ohne RunState');
  advance(engine, session, 3600);
  assert.ok(session.run.energyDelivered > 0, 'keine gelieferte Energie gezaehlt');
  assert.ok(session.run.energyDemanded > 0, 'keine angeforderte Energie gezaehlt');
});

test('Nach acht Stunden kommt ein Bericht, und vorher keiner', () => {
  const { engine, session, reports } = freeSession();
  advance(engine, session, SHIFT_SECONDS - 600);
  assert.equal(reports.length, 0, 'Bericht zu frueh');
  advance(engine, session, 1200);
  assert.equal(reports.length, 1);
  const r = reports[0];
  assert.equal(r.n, 1);
  assert.equal(r.t, SHIFT_SECONDS);
  assert.ok(r.delivered_mwh > 0, 'Schicht ohne gelieferte Energie');
  assert.ok(r.demanded_mwh > 0);
  assert.equal(r.scram_count, 0);
  assert.equal(r.alarm_seconds, 0);
  // Und er steht als Protokollzeile bereit, nicht als Dialog.
  const line = engine.ctx.log.find((e) => e.key === 'log_shift_report');
  assert.ok(line, 'kein Protokolleintrag');
  assert.equal(line.params.n, 1);
  assert.equal(line.params.mwh, Math.round(r.delivered_mwh));
});

test('Die zweite Schicht meldet ihren Zuwachs, nicht die Summe', () => {
  const { engine, session, reports } = freeSession();
  advance(engine, session, SHIFT_SECONDS);
  // Zweite Schicht: durchgehend eine stehende Meldung und eine Abschaltung.
  // Beides darf NUR in der zweiten Bilanz auftauchen.
  advance(engine, session, SHIFT_SECONDS / 2, { tiles: ALARM });
  engine.state.scram.active = true;
  advance(engine, session, SHIFT_SECONDS / 2, { tiles: ALARM });
  assert.equal(reports.length, 2);
  const [first, second] = reports;
  assert.equal(first.alarm_seconds, 0);
  assert.equal(first.scram_count, 0);
  assert.equal(second.scram_count, 1);
  assert.ok(Math.abs(second.alarm_seconds - SHIFT_SECONDS) < 120,
    `Alarmzeit ${second.alarm_seconds} statt rund ${SHIFT_SECONDS}`);
  // Der springende Punkt: die Summe seit Rundenbeginn waere hier groesser.
  assert.ok(session.run.violationSeconds[2] > second.alarm_seconds - 1e-6);
  assert.equal(session.run.scramCount, 1);
});

test('Die Bilanz überlebt Speichern und Laden ohne Doppelzählung', () => {
  const { engine, session, reports } = freeSession();
  advance(engine, session, SHIFT_SECONDS + 3600);
  assert.equal(reports.length, 1);
  const blob = JSON.parse(JSON.stringify(pack(engine, null, session.run, session)));

  const engine2 = createEngine(getPlant('pwr'), { n: 1.0 });
  const session2 = new Session(engine2, null, { faults: 'off', faultSeed: 1 });
  session2.start();
  const reports2 = [];
  session2.onShift = (r) => reports2.push(r);
  assert.equal(apply(blob, engine2, session2.run, session2), null);

  // Der Stand steht mitten in der zweiten Schicht: eine Stunde ist gelaufen,
  // sieben fehlen. Ohne die wiederhergestellte Bezugslinie haette der naechste
  // Bericht die erste Schicht noch einmal mitgezaehlt.
  assert.equal(session2.shift.count, 1);
  assert.equal(session2.shift.nextAt, 2 * SHIFT_SECONDS);
  advance(engine2, session2, SHIFT_SECONDS - 3600 + 600);
  assert.equal(reports2.length, 1);
  assert.equal(reports2[0].n, 2);
  assert.ok(reports2[0].delivered_mwh < session2.run.energyDelivered,
    'zweite Schicht meldet die ganze Runde');
});

test('Ein großer Zeitsprung lässt keine Schicht verschwinden', () => {
  // Der Xenon-Vorlauf springt in sehr grossen Schritten durch die Zeit. Eine
  // dabei uebersprungene Schicht ist trotzdem vergangen.
  const { engine, session, reports } = freeSession();
  advance(engine, session, 3 * SHIFT_SECONDS, { step: 3 * SHIFT_SECONDS });
  assert.equal(reports.length, 3);
  assert.deepEqual(reports.map((r) => r.n), [1, 2, 3]);
});

test('Ohne Szenario gibt es kein Ergebnis -- gesammelt wird trotzdem', () => {
  // Eine Runde ohne vorgesehenes Ende darf keine Punktzahl erzeugen: summary()
  // haette weder Szenariokennung noch Schwierigkeit.
  const { engine, session } = freeSession();
  advance(engine, session, 600);
  let ended = 0;
  session.onEnd = (result) => { ended++; assert.equal(result, null); };
  engine.state.destroyed = true;
  advance(engine, session, 60);
  assert.equal(ended, 1);
  assert.equal(session.result, null);
  assert.ok(session.run.energyDelivered > 0);
});

test('ShiftLog nimmt keinen kaputten Stand an', () => {
  const run = { energyDelivered: 5, energyDemanded: 6, deviationMWh: 1,
    violationSeconds: { 1: 0, 2: 0, 3: 0 }, scramCount: 0 };
  const log = new ShiftLog(run);
  log.restore(null);
  log.restore({ count: -3, nextAt: 0, base: { delivered: 'viel' } });
  assert.equal(log.count, 0);
  assert.equal(log.nextAt, SHIFT_SECONDS);
  assert.equal(log.base.delivered, 5);
  // Und eine Zeit, die keine ist, dreht die Schleife nicht.
  log.step(NaN);
  assert.equal(log.count, 0);
});

test('Eine Schicht ohne fertige Reparatur bekommt gar keine zweite Zeile', () => {
  // Nicht "Instandhaltung 0": wer ohne Trupp oder ohne Stoerung spielt, soll
  // nicht jede Schicht dieselbe Null lesen muessen.
  const { engine, session, reports } = freeSession('pwr', { repairs: 'normal' });
  advance(engine, session, SHIFT_SECONDS + 600);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].repairs_done, 0);
  assert.equal(ShiftLog.repairLogEntry(reports[0]), null);
  assert.equal(engine.ctx.log.filter((e) => e.key === 'log_shift_repairs').length, 0);
});

test('Fertige Arbeiten stehen als eigene Zeile im Bericht -- und nur in ihrer Schicht', () => {
  const { engine, session, reports } = freeSession('pwr', { repairs: 'normal' });
  repairOnePump(engine, session, 0);
  assert.equal(session.repairs.done, 1);
  advance(engine, session, SHIFT_SECONDS);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].repairs_done, 1);
  const line = engine.ctx.log.find((e) => e.key === 'log_shift_repairs');
  assert.ok(line, 'keine Reparaturzeile');
  assert.deepEqual(line.params, { n: 1, done: 1 });
  // Beide Zeilen tragen denselben Zeitpunkt, sonst reisst die Zeitleiste sie
  // auseinander.
  const report = engine.ctx.log.find((e) => e.key === 'log_shift_report');
  assert.equal(line.t, report.t);

  // Zweite Schicht ohne Arbeit: ein Zuwachs von null, und keine zweite Zeile.
  advance(engine, session, SHIFT_SECONDS);
  assert.equal(reports.length, 2);
  assert.equal(reports[1].repairs_done, 0);
  assert.equal(engine.ctx.log.filter((e) => e.key === 'log_shift_repairs').length, 1);
});

test('Ein Stand ohne Reparatur-Bezugslinie schreibt der naechsten Schicht nichts gut', () => {
  // Staende von vor 0.6.21 kennen base.repairs nicht. Stuende die Bezugslinie
  // dann auf null, zaehlte die erste Schicht nach dem Laden alles mit, was
  // vor dem Speichern schon fertig war.
  const { engine, session } = freeSession('pwr', { repairs: 'normal' });
  repairOnePump(engine, session, 0);
  repairOnePump(engine, session, 1);
  advance(engine, session, 3600);
  const blob = JSON.parse(JSON.stringify(pack(engine, null, session.run, session)));
  // Nur die Bezugslinie faellt weg, nicht der Zaehler des Trupps: genau so
  // sieht ein Stand aus, der vor dieser Groesse geschrieben wurde.
  assert.ok(Object.hasOwn(blob.session.shift.base, 'repairs'));
  delete blob.session.shift.base.repairs;

  const engine2 = createEngine(getPlant('pwr'), { n: 1.0 });
  const session2 = new Session(engine2, null, { faults: 'off', faultSeed: 1, repairs: 'normal' });
  session2.start();
  const reports2 = [];
  session2.onShift = (r) => reports2.push(r);
  assert.equal(apply(blob, engine2, session2.run, session2), null);
  assert.equal(session2.repairs.done, 2, 'Trupp-Zaehler nicht wiederhergestellt');

  advance(engine2, session2, SHIFT_SECONDS);
  assert.equal(reports2.length, 1);
  assert.equal(reports2[0].repairs_done, 0);
});

test('Ein Stand MIT Bezugslinie behaelt die Reparaturen der laufenden Schicht', () => {
  // Die Gegenprobe zum Stand ohne base.repairs: hier ist die Bezugslinie da
  // (null, die Schicht laeuft ja noch), und die beiden fertigen Arbeiten
  // gehoeren in den ersten Bericht nach dem Laden.
  const { engine, session } = freeSession('pwr', { repairs: 'normal' });
  repairOnePump(engine, session, 0);
  repairOnePump(engine, session, 1);
  advance(engine, session, 3600);
  const blob = JSON.parse(JSON.stringify(pack(engine, null, session.run, session)));

  const engine2 = createEngine(getPlant('pwr'), { n: 1.0 });
  const session2 = new Session(engine2, null, { faults: 'off', faultSeed: 1, repairs: 'normal' });
  session2.start();
  const reports2 = [];
  session2.onShift = (r) => reports2.push(r);
  assert.equal(apply(blob, engine2, session2.run, session2), null);
  assert.equal(session2.repairs.done, 2, 'Trupp-Zaehler nicht wiederhergestellt');

  advance(engine2, session2, SHIFT_SECONDS);
  assert.equal(reports2.length, 1);
  assert.equal(reports2[0].repairs_done, 2);
});
