// Debug-Protokoll einer Schicht (game/debugTape.js).
//
// Der Zweck der Datei ist, eine Frage beantwortbar zu machen, die sonst nur
// zu erraten war -- deshalb prueft dieser Test vor allem, dass die Antworten
// wirklich drinstehen: Kopfdaten, Spaltennamen zu den Zahlenreihen, dichte
// Abtastung dort wo es darauf ankommt, Ereignisse, Bildraten und die
// Hashkette, an der eine Nachrechnung ihre Abweichung findet.

import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';

import { createEngine } from '../static/js/sim/engine.js';
import { getPlant, PLANT_IDS } from '../static/js/plants/index.js';
import * as rbmk from '../static/js/plants/rbmk.js';
import { numbers, numberLabels, hash } from '../static/js/sim/state.js';
import { Session, PHASE } from '../static/js/game/session.js';
import { RBMK_CHERNOBYL_TUTORIAL } from '../static/js/game/chernobylTutorial.js';
import { DebugTape } from '../static/js/game/debugTape.js';

const DT = 0.05;
const DEF = {
  id: 'rbmk_chernobyl', reactor: 'rbmk', tutorial: RBMK_CHERNOBYL_TUTORIAL,
  difficulty: 3, title_key: 'x', brief_key: 'x', duration_s: 7200, seed: 26041986,
  demand: [{ t: 0, mw: 0 }, { t: 7200, mw: 0 }], events: [], fail: [{ type: 'fuel_damage' }],
};

const parse = (tape) => tape.toNdjson().trimEnd().split('\n').map((l) => JSON.parse(l));

test('numbers() and numberLabels() stay the same length for every plant', () => {
  // Die Spaltennamen im Protokoll kommen aus numberLabels(), die Werte aus
  // numbers(). Laufen die beiden auseinander, ist jede Zahlenreihe in der
  // Datei um eine Spalte verschoben -- und das faellt beim Lesen erst auf,
  // wenn man der falschen Groesse hinterhergesucht hat.
  for (const id of PLANT_IDS) {
    const e = createEngine(getPlant(id), { n: 1.0 });
    assert.equal(numberLabels(e.state).length, numbers(e.state).length, id);
    assert.equal(new Set(numberLabels(e.state)).size, numberLabels(e.state).length,
      `${id}: labels must be unique`);
  }
});

test('the tape records header, columns, samples, hashes and events', (t) => {
  const engine = createEngine(rbmk, { seed: DEF.seed });
  const session = new Session(engine, DEF);
  session.start();
  const tape = new DebugTape({ version: '0.0.0-test', reactor: 'rbmk', scenario: DEF.id });

  const tut = session.tutorial;
  let confirmed = false;
  for (let i = 0; i < Math.round(4000 / DT) && session.phase === PHASE.RUNNING; i++) {
    engine.step(DT);
    session.step(DT, engine.trips.tiles(), 0);
    tape.step(engine, session);
    if (!confirmed && tut.index === 0 && tut.inspectReady) confirmed = tut.confirmInspect();
    // Ein Bild je 20 Schritte, damit auch die Bildraten-Koerbe etwas sehen.
    if (i % 20 === 0) tape.frame(i * 50, { steps: 20, slip: false, speed: 60 });
  }
  tape.finish({ tape: engine.recorder ? engine.recorder.serialize() : [], result: { failed: 'x' } });

  const rows = parse(tape);
  const head = rows[0];
  assert.equal(head.k, 'meta');
  assert.equal(head.version, '0.0.0-test');
  assert.ok(head.steps > 60000, `the run should be recorded whole, got ${head.steps} steps`);
  assert.equal(head.truncated, false);

  const byKind = (k) => rows.filter((r) => r.k === k);
  const fields = byKind('fields');
  assert.equal(fields.length, 1, 'the column names belong in exactly once');
  const samples = byKind('sample');
  assert.ok(samples.length > 3000, `expected one sample per second, got ${samples.length}`);
  for (const row of samples) {
    assert.equal(row.v.length, fields[0].v.length, 'every sample must match the column names');
  }
  // Die Hashkette: alle 200 Schritte, und der letzte muss zum Endzustand
  // passen -- sonst schreibt das Protokoll etwas anderes mit, als die Anlage
  // gerechnet hat.
  const hashes = byKind('hash');
  assert.ok(hashes.length > 300, `expected a hash every 10 s, got ${hashes.length}`);
  assert.ok(hashes.every((h) => /^[0-9a-f]{8}$/.test(h.h)), 'hashes must be the state hash');

  const events = byKind('event');
  assert.ok(events.some((e) => e.key === 'event_chernobyl_orm_printout'),
    'the timeline entries must be in the tape');
  assert.ok(events.some((e) => e.src === 'journal'), 'the learning journal must be in too');
  assert.ok(byKind('frame').length > 100, 'the frame buckets are missing');
  assert.ok(byKind('phase').some((p) => p.v === PHASE.DEBRIEF), 'the phase change is missing');
  assert.ok(byKind('result').length === 1 && byKind('tape').length === 1,
    'finish() must append the recorder tape and the verdict');

  const text = tape.toNdjson();
  t.diagnostic(`${rows.length} Zeilen, ${(text.length / 1024).toFixed(0)} KB roh, `
    + `${(gzipSync(Buffer.from(text)).length / 1024).toFixed(0)} KB gepackt`);
});

test('sampling gets dense once the scram is in -- that is where the seconds matter', () => {
  const engine = createEngine(rbmk, { n: 1.0 });
  for (let i = 0; i < 200; i++) engine.step(DT);
  const tape = new DebugTape({});
  // Ruhiger Betrieb: eine Abtastung je Sekunde.
  for (let i = 0; i < 200; i++) { engine.step(DT); tape.step(engine, null); }
  const calm = tape.rows.filter((r) => r.k === 'sample').length;
  engine.scram('test');
  for (let i = 0; i < 200; i++) { engine.step(DT); tape.step(engine, null); }
  const dense = tape.rows.filter((r) => r.k === 'sample').length - calm;
  assert.equal(calm, 10, `10 samples for 200 quiet steps, got ${calm}`);
  assert.equal(dense, 200, `every step once the scram is in, got ${dense}`);
});

test('the tape stops growing instead of eating the browser', () => {
  const engine = createEngine(rbmk, { n: 1.0 });
  const tape = new DebugTape({});
  // Von aussen an die Obergrenze fahren, ohne 400.000 Schritte zu rechnen.
  for (let i = 0; i < 400100; i++) tape.note('filler', null);
  assert.equal(tape.truncated, true, 'the cap must be reported, not silently applied');
  assert.equal(tape.rows.length, 400000);
  const head = JSON.parse(tape.toNdjson().split('\n')[0]);
  assert.equal(head.truncated, true, 'and it must be visible in the header');
});

test('a hash in the tape is the real state hash at that step', () => {
  const engine = createEngine(rbmk, { n: 1.0 });
  const tape = new DebugTape({});
  let expected = null;
  for (let i = 1; i <= 200; i++) {
    engine.step(DT);
    tape.step(engine, null);
    if (i === 200) expected = hash(engine.state);
  }
  const row = tape.rows.find((r) => r.k === 'hash');
  assert.ok(row, 'no hash was written');
  assert.equal(row.n, 200);
  assert.equal(row.h, expected);
});
