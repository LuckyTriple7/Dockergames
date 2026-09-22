// Instandhaltungstrupp (game/repairs.js).
//
// Der Kern dieser Datei ist eine einzige Frage, und sie laesst sich nicht am
// Merker allein pruefen: nach der Reparatur muss die Anlage die Stoerung
// wirklich vergessen haben. Solange ctx.pumpsStuck steht, wirft stepEvents()
// die Pumpe in JEDEM Rechenschritt erneut aus -- ein Test, der nur das
// geloeschte Feld prueft, wuerde einen Trupp durchgehen lassen, dessen Arbeit
// der naechste Takt wieder zunichte macht. Deshalb wird hier durchgerechnet
// und danach der Knopf gedrueckt, den auch der Spieler druecken wuerde.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { Session } from '../static/js/game/session.js';
import { getEvent } from '../static/js/game/events.js';
import { REPAIR_LEVELS, REPAIR_LEVEL_IDS, Repairs, openRepairs, repairLevel }
  from '../static/js/game/repairs.js';

const DT = 0.05;

/** Runde ohne Szenario, mit gewaehlter Reparaturstufe. Stoerungen sind dabei
 *  ABGESCHALTET: diese Datei loest ihre Defekte selbst aus, damit kein
 *  Wuerfel mitredet. */
function freeRun(reactor, repairs = 'normal') {
  const engine = createEngine(getPlant(reactor), { n: 1.0 });
  const session = new Session(engine, null, { faults: 'off', dispatch: 'off', repairs });
  session.start();
  return { engine, session };
}

/** Eine Stoerung aus der Bibliothek ausloesen, wie es FreeFaults taete. */
function fire(engine, id, args = {}) {
  const def = getEvent(id);
  assert.ok(def, id);
  def.apply(engine, args);
}

/** Runde weiterrechnen -- Physik UND Sitzung, in derselben Reihenfolge wie
 *  die Schleife im Browser (siehe loop.js). */
function run(engine, session, seconds) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    engine.step(DT);
    session.step(DT, engine.trips.tiles(), engine.trips.unacknowledgedSeconds());
  }
}

/** Nur die Sitzung weiterdrehen, ohne Physik: dem Trupp ist egal, wie oft
 *  dazwischen gerechnet wurde, er liest die Simulationszeit. Das spart im
 *  Test Stunden Sim-Zeit auf ein paar Schritte ein -- dieselbe Abkuerzung wie
 *  advanceFaults() in test-free-play.mjs. */
function advance(engine, repairs, seconds, stepS = 5) {
  const end = engine.state.t_sim + seconds;
  while (engine.state.t_sim < end) {
    engine.state.t_sim = Math.min(end, engine.state.t_sim + stepS);
    repairs.step();
  }
}

function jobIds(repairs) { return repairs.jobs().map((j) => j.id); }

test('Ohne Stufe gibt es keinen Trupp -- wie vor 0.6.18', () => {
  const { engine, session } = freeRun('pwr', 'off');
  assert.equal(session.repairs.active, false);
  fire(engine, 'rcp_trip', { loop: 1 });
  assert.deepEqual(session.repairs.jobs(), []);
  assert.equal(session.repairs.order('pump:1'), 'unknown');
  // Und der Merker bleibt, egal wie lange gerechnet wird.
  advance(engine, session.repairs, 20000);
  assert.ok(engine.ctx.pumpsStuck.has(1));
});

test('Ein Szenario bekommt gar keinen Trupp', () => {
  const engine = createEngine(getPlant('pwr'), { n: 1.0 });
  const session = new Session(engine, {
    id: 'x', reactor: 'pwr', duration_s: 600, demand: [[0, 1000]],
  }, { repairs: 'normal' });
  assert.equal(session.repairs, null);
});

test('Eine ausgefallene Pumpe wird zur Arbeit, und die Arbeit hilft wirklich', () => {
  const { engine, session } = freeRun('pwr');
  const r = session.repairs;
  assert.deepEqual(jobIds(r), []);

  fire(engine, 'rcp_trip', { loop: 2 });
  assert.deepEqual(jobIds(r), ['pump:2']);
  const job = r.jobs()[0];
  assert.equal(job.ready, true);
  assert.equal(job.minutes, 12);
  assert.deepEqual(job.params, { n: 3 });   // am Knopf 1-basiert beschriftet

  assert.equal(r.order('pump:2'), 'ordered');
  assert.ok(r.view());

  // Kurz vor Schluss ist nichts fertig -- die Dauer ist keine Zierde.
  advance(engine, r, 12 * 60 - 30);
  assert.ok(engine.ctx.pumpsStuck.has(2), 'zu frueh freigegeben');
  assert.ok(r.view());

  advance(engine, r, 60);
  assert.equal(r.view(), null);
  assert.equal(engine.ctx.pumpsStuck, null);
  assert.deepEqual(jobIds(r), []);

  // Der Trupp wirft die Pumpe NICHT an -- er gibt sie nur frei.
  assert.equal(engine.ctx.pumps[2].running, false);
  // Und jetzt haelt der Knopf auch: vorher hat stepEvents() ihn in jedem
  // Takt wieder ausgeworfen.
  engine.ctx.pumps[2].start();
  run(engine, session, 5);
  assert.equal(engine.ctx.pumps[2].running, true);
  assert.equal(engine.ctx.pumps[2].tripped, false);
});

test('Die langsame Stufe streckt jede Dauer, sonst nichts', () => {
  const { engine, session } = freeRun('pwr', 'slow');
  fire(engine, 'rcp_trip', { loop: 0 });
  assert.equal(session.repairs.jobs()[0].minutes, 24);
  session.repairs.order('pump:0');
  advance(engine, session.repairs, 12 * 60 + 60);
  assert.ok(engine.ctx.pumpsStuck.has(0), 'Nachtschicht war zu schnell fertig');
  advance(engine, session.repairs, 12 * 60);
  assert.equal(engine.ctx.pumpsStuck, null);
});

test('Es gibt genau einen Trupp', () => {
  const { engine, session } = freeRun('rbmk');
  const r = session.repairs;
  fire(engine, 'mcp_trip', { count: 2 });
  assert.deepEqual(jobIds(r), ['pump:0', 'pump:1']);
  assert.equal(r.order('pump:0'), 'ordered');
  assert.equal(r.order('pump:1'), 'busy');
  // Die zweite Pumpe bleibt also liegen, bis die erste fertig ist.
  advance(engine, r, 13 * 60);
  assert.deepEqual(jobIds(r), ['pump:1']);
  assert.equal(r.order('pump:1'), 'ordered');
  advance(engine, r, 13 * 60);
  assert.deepEqual(jobIds(r), []);
});

test('Zurueckrufen kostet den Fortschritt', () => {
  const { engine, session } = freeRun('pwr');
  const r = session.repairs;
  fire(engine, 'rcp_trip', { loop: 1 });
  r.order('pump:1');
  advance(engine, r, 11 * 60);
  assert.equal(r.cancel(), true);
  assert.equal(r.view(), null);
  assert.equal(r.cancel(), false);
  // Neu angefordert faengt der Trupp von vorne an: nach einer Minute ist er
  // nicht fertig, obwohl beim ersten Anlauf schon elf vorbei waren.
  r.order('pump:1');
  advance(engine, r, 60);
  assert.ok(engine.ctx.pumpsStuck.has(1));
  advance(engine, r, 12 * 60);
  assert.equal(engine.ctx.pumpsStuck, null);
});

test('Was der Trupp nicht erreicht, steht gar nicht erst auf der Liste', () => {
  const { engine, session } = freeRun('pwr');
  const r = session.repairs;
  fire(engine, 'rod_stuck', { bank: 0 });
  fire(engine, 'sg_tube_leak', { kgs: 8 });
  fire(engine, 'porv_stuck');
  fire(engine, 'feedwater_loss');
  assert.deepEqual(jobIds(r), []);
  // Und keine dieser Kennungen laesst sich von Hand unterschieben.
  for (const id of ['rod', 'rod:0', 'leak', 'porv', 'pump:0', 'pump:-1', '', 'msiv']) {
    assert.equal(r.order(id), 'unknown', id);
  }
  // Die Merker stehen unveraendert weiter.
  advance(engine, r, 20000);
  assert.deepEqual(Object.keys(engine.ctx.stuckRods), ['0']);
  assert.equal(engine.ctx.porvStuck, true);
  assert.equal(engine.ctx.sgLeak, 8);
});

test('Ohne Motorstrom gibt es am Motorschutz nichts zurueckzustellen', () => {
  const { engine, session } = freeRun('bwr');
  const r = session.repairs;
  fire(engine, 'station_blackout');
  assert.deepEqual(jobIds(r), ['recirc']);
  assert.equal(r.jobs()[0].ready, false);
  assert.equal(r.jobs()[0].blockKey, 'repair_block_power');
  assert.equal(r.order('recirc'), 'blocked');

  // Kommt der Strom wieder, geht die Arbeit.
  engine.state.acPower = true;
  assert.equal(r.jobs()[0].ready, true);
  assert.equal(r.order('recirc'), 'ordered');
  advance(engine, r, 16 * 60);
  assert.equal(engine.ctx.recircPumpStuck, false);
});

test('Faellt die Voraussetzung waehrend der Arbeit weg, bricht der Trupp ab', () => {
  const { engine, session } = freeRun('bwr');
  const r = session.repairs;
  fire(engine, 'rcp_trip');           // SWR: faellt auf die Umwaelzpumpe zurueck
  assert.deepEqual(jobIds(r), ['recirc']);
  r.order('recirc');
  advance(engine, r, 10 * 60);
  fire(engine, 'station_blackout');
  advance(engine, r, 5);
  assert.equal(r.view(), null, 'Trupp arbeitet ohne Strom weiter');
  assert.equal(engine.ctx.recircPumpStuck, true);
  const log = engine.ctx.log.filter((e) => e.kind === 'repair_aborted');
  assert.equal(log.length, 1);
  assert.equal(log[0].key, 'repair_job_recirc');
});

test('Die Frischdampf-Absperrung wird frei, aber nicht geoeffnet', () => {
  const { engine, session } = freeRun('bwr');
  const r = session.repairs;
  fire(engine, 'msiv_close');
  assert.deepEqual(jobIds(r), ['msiv']);
  assert.equal(r.jobs()[0].minutes, 40);
  r.order('msiv');
  advance(engine, r, 41 * 60);
  assert.equal(engine.ctx.msivStuck, false);
  assert.equal(engine.state.msiv, 0, 'der Trupp hat sie selbst geoeffnet');
  // Jetzt haelt das Oeffnen -- vorher drueckte stepEvents() sie sofort zu.
  engine.state.msiv = 1;
  run(engine, session, 5);
  assert.ok(engine.state.msiv > 0.5);
});

test('Die abgesperrte Zuspeisung verduennt nicht weiter', () => {
  const { engine, session } = freeRun('pwr');
  const r = session.repairs;
  fire(engine, 'boron_dilution');
  assert.equal(engine.state.boronFlow, -1);
  assert.deepEqual(jobIds(r), ['boron']);
  r.order('boron');
  advance(engine, r, 7 * 60);
  assert.equal(engine.ctx.boronRunaway, false);
  // Der Stellwert selbst muss mit: sonst verduennte der naechste Takt weiter,
  // ohne dass noch eine Stoerung anlaege.
  assert.equal(engine.state.boronFlow, 0);
  const before = engine.state.C_B;
  run(engine, session, 30);
  assert.ok(engine.state.C_B >= before - 1e-9,
    `Bor sinkt weiter: ${before} -> ${engine.state.C_B}`);
});

test('Jeder Vorgang steht in der Zeitleiste, mit der Arbeit als Schluessel', () => {
  const { engine, session } = freeRun('pwr');
  const r = session.repairs;
  fire(engine, 'rcp_trip', { loop: 0 });
  r.order('pump:0');
  r.cancel();
  r.order('pump:0');
  advance(engine, r, 13 * 60);
  const kinds = engine.ctx.log.filter((e) => String(e.kind || '').startsWith('repair_'));
  assert.deepEqual(kinds.map((e) => e.kind),
    ['repair_ordered', 'repair_cancelled', 'repair_ordered', 'repair_done']);
  // Der Schluessel ist die ARBEIT, der Vorgang steht in kind -- annunciator.js
  // haengt daran von sich aus ein uebersetztes "— <Vorgang>".
  for (const e of kinds) {
    assert.equal(e.key, 'repair_job_pump');
    assert.deepEqual(e.params, { n: 1 });
  }
  assert.equal(r.done, 1);
});

test('Der Trupp ueberlebt das Speichern -- und faengt nicht von vorne an', () => {
  const a = freeRun('pwr');
  fire(a.engine, 'rcp_trip', { loop: 1 });
  a.session.repairs.order('pump:1');
  advance(a.engine, a.session.repairs, 10 * 60);
  const blob = a.session.snapshot();
  assert.equal(blob.repairs.job.id, 'pump:1');

  const b = freeRun('pwr');
  fire(b.engine, 'rcp_trip', { loop: 1 });
  b.engine.state.t_sim = a.engine.state.t_sim;
  b.session.restore(blob);
  assert.ok(b.session.repairs.view());
  // Es fehlen noch zwei Minuten, nicht zwoelf.
  advance(b.engine, b.session.repairs, 60);
  assert.ok(b.engine.ctx.pumpsStuck.has(1));
  advance(b.engine, b.session.repairs, 90);
  assert.equal(b.engine.ctx.pumpsStuck, null);
});

test('Die Stufe kommt nicht aus dem Spielstand zurueck', () => {
  const a = freeRun('pwr', 'slow');
  const b = freeRun('pwr', 'normal');
  b.session.restore(a.session.snapshot());
  assert.equal(b.session.repairs.levelId, 'normal');
  assert.equal(b.session.repairs.factor, 1);
});

test('Ein unschluessiger Trupp aus dem Spielstand wird verworfen, nicht geglaubt', () => {
  const { session } = freeRun('pwr');
  const r = session.repairs;
  const good = { id: 'pump:1', kind: 'pump', key: 'repair_job_pump', params: { n: 2 },
    startT: 100, endT: 820 };
  for (const bad of [
    null, 'x', {}, { ...good, id: 'nope' }, { ...good, kind: 'msiv' },
    { ...good, startT: -1 }, { ...good, endT: 100 }, { ...good, endT: 'bald' },
    { ...good, key: 7 }, { ...good, id: 'pump:x' },
  ]) {
    r.job = null;
    r.restore({ job: bad });
    assert.equal(r.job, null, JSON.stringify(bad));
  }
  r.restore({ job: good });
  assert.ok(r.job);
  assert.equal(r.job.n, 1);
});

test('Ein zerstoerter Kern beendet auch die Instandhaltung', () => {
  const { engine, session } = freeRun('pwr');
  fire(engine, 'rcp_trip', { loop: 0 });
  session.repairs.order('pump:0');
  engine.state.destroyed = true;
  advance(engine, session.repairs, 5);
  assert.equal(session.repairs.view(), null);
  assert.ok(engine.ctx.pumpsStuck.has(0));
});

test('Die Stufen sind die drei, die der Startbildschirm anbietet', () => {
  assert.deepEqual(REPAIR_LEVEL_IDS, ['off', 'normal', 'slow']);
  assert.equal(repairLevel('normal').factor, 1);
  assert.equal(repairLevel('slow').factor, 2);
  // Ein unbekannter Wert aus einer alten Einstellung darf das freie Spiel
  // nicht verweigern -- er gilt als "aus", wie bei faultLevel().
  assert.equal(repairLevel('gestern'), null);
  assert.equal(REPAIR_LEVELS.off, null);
  const engine = createEngine(getPlant('pwr'), { n: 1.0 });
  assert.equal(new Repairs(engine, 'gestern').levelId, 'off');
});

test('openRepairs() liest den Zustand, nicht die Vorgeschichte', () => {
  const engine = createEngine(getPlant('pwr'), { n: 1.0 });
  // Von Hand gesetzte Merker, ohne dass je ein Ereignis gelaufen waere --
  // genau die Lage nach dem Laden eines Spielstands (siehe net/persist.js).
  engine.ctx.pumpsStuck = new Set([3, 0]);
  engine.ctx.porvStuck = true;
  assert.deepEqual(openRepairs(engine).map((j) => j.id), ['pump:0', 'pump:3']);
  // Eine Pumpe, die es an diesem Reaktortyp gar nicht gibt, wird nicht
  // angeboten -- sonst haette der Trupp etwas freigegeben, das nirgends haengt.
  engine.ctx.pumpsStuck = new Set([9]);
  assert.deepEqual(openRepairs(engine), []);
});
