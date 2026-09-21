// Freies Spiel: Tageslastkurve, Zufallsstörungen, Kernalter.
//
// Die drei Stücke hängen zusammen: sie sind das, was eine Runde ohne
// Szenario überhaupt zu einer Aufgabe macht. Vor 0.6.6 gab es dort nur einen
// Zufallsspaziergang der Netzanforderung.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { Session, freeDemandFrac } from '../static/js/game/session.js';
import { FAULT_LEVELS, FreeFaults } from '../static/js/game/freeEvents.js';
import { coreAgeBurnup, CORE_AGE_IDS } from '../static/js/game/coreAge.js';

const DT = 0.05;

/** Runde ohne Szenario, mit gewählter Störungsstufe. Der Würfel ist hier
 *  IMMER gesät: im Spiel kommt er aus der Uhr, damit jede Runde anders
 *  verläuft -- ein Test, der das übernimmt, schlägt irgendwann zufällig
 *  fehl, und zwar auf einem anderen Rechner als dem, auf dem er geschrieben
 *  wurde. Genau das ist bei 0.6.6 einmal passiert. */
function freeRun(reactor, faults = 'off', { seed = 1234, ...opts } = {}) {
  const engine = createEngine(getPlant(reactor), { n: 1.0, ...opts });
  const session = new Session(engine, null, { faults, faultSeed: seed });
  session.start();
  return { engine, session };
}

/** Nur die Störungen weiterdrehen, ohne Physik: der Auswahl ist egal, wie oft
 *  dazwischen gerechnet wurde, sie liest nur die Simulationszeit. Das spart
 *  im Test Stunden Sim-Zeit auf ein paar tausend Schritte ein. */
function advanceFaults(engine, faults, untilT, stepS = 5) {
  for (let t = engine.state.t_sim; t <= untilT; t += stepS) {
    engine.state.t_sim = t;
    faults.step();
  }
}

function eventLog(engine) {
  return engine.ctx.log.filter((x) => x.kind === 'on' && String(x.key).startsWith('ev_'));
}

test('Tageslastkurve: Nachttal, Abendspitze, kein Sprung um Mitternacht', () => {
  assert.equal(freeDemandFrac(0), freeDemandFrac(86400));
  // Das Tal liegt nachts, die Spitze am Abend -- andersherum waere es keine
  // Netzlast, sondern ein Zufallszahlengenerator mit Uhrzeit.
  const night = freeDemandFrac(3 * 3600);
  const evening = freeDemandFrac(19 * 3600);
  assert.ok(night < 0.6, `Nachttal zu hoch: ${night}`);
  assert.equal(evening, 1);
  assert.ok(evening - night > 0.35);
  // Stetig: zwischen zwei Minuten darf sich nichts sprunghaft aendern, sonst
  // koennte die Rampengrenze im Spiel sie nie einholen.
  let prev = freeDemandFrac(0);
  for (let t = 60; t <= 86400; t += 60) {
    const now = freeDemandFrac(t);
    assert.ok(Math.abs(now - prev) < 0.02, `Sprung bei ${t}s: ${prev} -> ${now}`);
    assert.ok(now > 0.4 && now <= 1.0, `ausserhalb des Bandes bei ${t}s: ${now}`);
    prev = now;
  }
});

test('Freies Spiel folgt der Kurve, nicht dem Zufall', () => {
  const { engine, session } = freeRun('pwr');
  const p0 = engine.spec.P0_e;
  // Der Uebernahmewert ist die Kurve zur Schichtzeit, kein Volllastsollwert.
  assert.ok(Math.abs(engine.state.P_demand / p0 - freeDemandFrac(22 * 3600)) < 1e-9);
  // Sechs Stunden ohne Physik: nur der Sollwert wird gefuehrt. Er muss der
  // Kurve folgen -- das Rauschen darf ihn nicht davontragen.
  const s = engine.state;
  for (let i = 0; i < 6 * 3600; i++) {
    s.t_sim += 1;
    session._stepFreeDemand(s, 1);
  }
  const want = freeDemandFrac((22 + 6) * 3600);
  assert.ok(Math.abs(s.P_demand / p0 - want) < 0.06,
    `nach sechs Stunden ${(s.P_demand / p0).toFixed(3)} statt etwa ${want.toFixed(3)}`);
  // Und die Uhr der Schicht steht, sonst waere die Kurve nicht zu lesen.
  assert.equal(engine.ctx.wallClock, 22 * 3600);
});

test('Ohne Störungsstufe passiert nichts -- wie vor 0.6.6', () => {
  const { engine, session } = freeRun('pwr', 'off');
  assert.equal(session.faults.active, false);
  advanceFaults(engine, session.faults, 20000);
  assert.deepEqual(eventLog(engine), []);
});

test('Störungen halten die Einfahrzeit ein und kommen dann', () => {
  for (const reactor of ['pwr', 'bwr', 'rbmk']) {
    const { engine, session } = freeRun(reactor, 'hard');
    assert.equal(session.faults.active, true);
    advanceFaults(engine, session.faults, FAULT_LEVELS.hard.grace - 5);
    assert.deepEqual(eventLog(engine), [], `${reactor}: Stoerung in der Einfahrzeit`);
    advanceFaults(engine, session.faults, 20000);
    assert.ok(eventLog(engine).length > 0, `${reactor}: gar keine Stoerung`);
  }
});

test('Die seltene Stufe bleibt mild und kündigt sich an', () => {
  const { engine, session } = freeRun('pwr', 'rare');
  for (const c of session.faults.pool) {
    assert.ok(!c.heavy, `${c.id} gehoert nicht auf die seltene Stufe`);
  }
  let alerts = 0;
  session.onAlert = () => { alerts++; };
  advanceFaults(engine, session.faults, 40000, 10);
  const log = eventLog(engine);
  assert.ok(log.length > 0);
  assert.ok(alerts > 0, 'Vorwarnung fehlt');
  // Alle Störungen dieser Stufe sind vom milden Schweregrad.
  for (const entry of log) assert.ok(entry.severity <= FAULT_LEVELS.rare.maxSeverity);
});

test('Die stehende Anlage bekommt keine Störung aufgeladen', () => {
  const { engine, session } = freeRun('pwr', 'hard');
  engine.scram('test');
  advanceFaults(engine, session.faults, 40000);
  assert.deepEqual(eventLog(engine), [], 'Stoerung bei stehender Anlage');
  // Und der Wiederanlauf bleibt frei: was waehrend des Stillstands faellig
  // gewesen waere, ist verfallen, und die Einfahrzeit beginnt von vorn.
  // Vorher schlug die naechste Stoerung wenige Sekunden nach dem
  // Wiederanfahren ein -- ihr Zeitpunkt war noch waehrend der Abschaltung
  // gezogen worden.
  engine.state.scram.active = false;
  const back = engine.state.t_sim;
  advanceFaults(engine, session.faults, back + FAULT_LEVELS.hard.grace - 5);
  assert.deepEqual(eventLog(engine), [], 'Stoerung direkt nach dem Wiederanlauf');
  advanceFaults(engine, session.faults, back + 20000);
  assert.ok(eventLog(engine).length > 0, 'danach aber schon');
});

test('Störungen überleben das Speichern -- ohne sich zu wiederholen', () => {
  const a = freeRun('pwr', 'normal');
  advanceFaults(a.engine, a.session.faults, 8000);
  const blob = a.session.snapshot();
  assert.ok(Number.isFinite(blob.faults.nextT));

  const b = freeRun('pwr', 'normal');
  b.session.restore(blob);
  assert.equal(b.session.faults.nextT, a.session.faults.nextT);
  assert.deepEqual(b.session.faults.rng.snapshot(), a.session.faults.rng.snapshot());
  // Die Stufe kommt bewusst NICHT aus dem Stand zurueck: sie gehoert der
  // aktuellen Auswahl, nicht dem gespeicherten Lauf.
  const c = freeRun('pwr', 'off');
  c.session.restore(blob);
  assert.equal(c.session.faults.active, false);
});

test('Störungen wählen nur, was der Zustand hergibt', () => {
  const engine = createEngine(getPlant('bwr'), { n: 1.0 });
  const faults = new FreeFaults(engine, 'hard', 7);
  // Frischer Volllastzustand: alles im Vorrat ist anwendbar.
  assert.ok(faults.pool.every((c) => typeof c.when === 'function'));
  engine.ctx.msivStuck = true;
  engine.state.msiv = 0;
  assert.ok(!faults.pool.find((c) => c.id === 'msiv_close').when(engine),
    'eine bereits geschlossene Absperrung darf nicht noch einmal schliessen');
  engine.state.turbineTripped = true;
  assert.ok(!faults.pool.find((c) => c.id === 'turbine_trip').when(engine));
});

test('Kernalter: drei Stufen, und alle drei bleiben fahrbar', () => {
  for (const reactor of ['pwr', 'bwr', 'rbmk']) {
    const spec = getPlant(reactor).spec;
    const values = CORE_AGE_IDS.map((id) => coreAgeBurnup(spec, id));
    assert.equal(values[0], 0);
    assert.ok(values[1] > values[0] && values[2] > values[1], `${reactor}: Stufen nicht geordnet`);
    assert.ok(values[2] < spec.cycleEFPD, `${reactor}: ueber die Zykluslaenge hinaus`);
    // Der springende Punkt: auch der aelteste angebotene Kern muss sich noch
    // auf Nennleistung bringen lassen. Sonst ist die Stufe kein
    // Schwierigkeitsgrad, sondern ein kaputter Start -- die
    // Ueberschussreaktivitaet reicht dann nicht mehr fuer Kritikalitaet.
    const e = createEngine(getPlant(reactor), { n: 1.0, burnup: values[2] });
    for (let i = 0; i < 20000; i++) e.step(DT);
    assert.ok(e.state.n > 0.98, `${reactor}: nur ${e.state.n.toFixed(3)} bei Zyklusende`);
  }
});

test('Unbekannte Stufen fallen sauber zurück', () => {
  const engine = createEngine(getPlant('pwr'), { n: 1.0 });
  assert.equal(new FreeFaults(engine, 'gibtsnicht', 1).active, false);
  assert.equal(coreAgeBurnup(getPlant('pwr').spec, 'gibtsnicht'), 0);
  assert.equal(coreAgeBurnup(null, 'late'), 0);
});
