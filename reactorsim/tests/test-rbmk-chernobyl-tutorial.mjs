// "Block 4 -- die Nacht des 26. April": gefuehrter historischer Nachbau.
//
// Der wichtigste Test hier ist der letzte: AZ-5 aus dem historisch
// nachgestellten Zustand heraus muss ueber den ECHTEN prepare()-Pfad zur
// Zerstoerung fuehren -- sonst waere die ganze Uebung ein Zwischenfilm ohne
// Physik dahinter (siehe Machbarkeitspruefung, BACKLOG.md).
import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngine } from '../static/js/sim/engine.js';
import * as rbmk from '../static/js/plants/rbmk.js';
import { Session, PHASE } from '../static/js/game/session.js';
import { RbmkChernobylTutorial, RBMK_CHERNOBYL_TUTORIAL } from '../static/js/game/chernobylTutorial.js';
import { stepEvents } from '../static/js/game/events.js';

const DT = 0.05;
const DEF = {
  id: 'rbmk_chernobyl', reactor: 'rbmk', tutorial: RBMK_CHERNOBYL_TUTORIAL,
  difficulty: 3, title_key: 'x', brief_key: 'x', duration_s: 7200, seed: 26041986,
  demand: [{ t: 0, mw: 0 }, { t: 7200, mw: 0 }], events: [], fail: [{ type: 'fuel_damage' }],
};

function boot() {
  const engine = createEngine(rbmk, { seed: DEF.seed });
  const session = new Session(engine, DEF);
  session.start();
  return { engine, session };
}

function step(f, n = 1) {
  for (let i = 0; i < n && f.session.phase === PHASE.RUNNING; i++) {
    f.engine.step(DT);
    f.session.step(DT, f.engine.trips.tiles(), 0);
  }
}

test('prepare() sets a hot, self-consistent low-margin state -- no phantom excursion', () => {
  const { engine } = boot();
  const s = engine.state;
  const d = engine.derive();
  assert.ok(Math.abs(d.rho_pcm) < 1, `rho = ${d.rho_pcm}`);
  assert.ok(s.n > 0.055 && s.n < 0.08, `n = ${(s.n * 100).toFixed(2)}%`);
  assert.ok(d.orm > 15 && d.orm < 35, `orm = ${d.orm.toFixed(1)}`);
  assert.equal(s.destroyed, false);
  assert.equal(s.fault, null);
});

test('a single step does not blow up -- ctx lag filters were synced to the prepared state', () => {
  const { engine, session } = boot();
  const n0 = engine.state.n;
  step({ engine, session }, 20);
  // Grober Drift ist erwartet (kein Autopilot mehr, siehe 'dip'/'recover'),
  // eine Verzehnfachung waere ein Zeichen fuer unsynchronisierte Lag-Filter.
  assert.ok(engine.state.n < n0 * 3, `n sprang auf ${(engine.state.n * 100).toFixed(1)}%`);
});

test('full guided sequence: handover, dip, hand-held recovery, pumps, coastdown, AZ-5', t => {
  const { engine, session } = boot();
  const s = engine.state;
  const c = engine.ctx;
  const tut = session.tutorial;

  // 0 handover
  step({ engine, session }, Math.round(6 / DT));
  assert.equal(tut.index, 0);
  assert.ok(tut.confirmInspect());
  assert.equal(tut.index, 1);

  // 1 dip -- reine historische Einordnung im Text, keine mechanische
  // Simulation (siehe _triggerDip: ein echter Einbruch riss im Test mehr
  // Xenon auf, als sich je zurueckholen liess). Schliesst fast sofort.
  step({ engine, session }, Math.round(5 / DT));
  assert.equal(tut.index, 2, 'dip step did not complete');

  // 2 recover -- powerCtl haelt automatisch (siehe prepare()/_triggerDip:
  // das ist der validierte Pfad, kein manuelles Stabziehen als zusaetzliche
  // Fehlerquelle). Die 19 Minuten laufen einfach ab.
  step({ engine, session }, Math.round(1160 / DT));
  assert.equal(tut.index, 3, `recover step did not complete (n=${(s.n * 100).toFixed(2)}%, orm=${engine.derive().orm.toFixed(1)})`);

  // 3 pumps
  for (const p of c.mcp) if (!p.running) p.start();
  let pumpGuard = 0;
  while (tut.index === 3 && pumpGuard < Math.round(30 / DT)) { step({ engine, session }, 1); pumpGuard++; }
  assert.equal(tut.index, 4, 'pumps step did not complete');
  // Sofort pruefen, BEVOR der (durch completeStep('pumps') ausgeloeste)
  // Kuehlmittelauslauf die Drehzahl schon wieder zurueckgenommen hat.
  assert.equal(c.mcp.filter(p => p.running && p.speed >= 0.9).length, 8);

  // 4 test -- completeStep('pumps') muss den Auslauf gestartet haben. Der
  // Schritt selbst schliesst schnell (AZ-5 wird frei, sobald der Auslauf
  // sichtbar begonnen hat) -- die eigentliche Gefahr haengt davon ab, WANN
  // AZ-5 gedrueckt wird: ab rund 27s nach Ausloesen des Auslaufs wird die
  // Kombination gefaehrlich (siehe Kalibrierung, BACKLOG.md). Hier wartet
  // der "Spieler" bewusst laenger, wie es historisch (Testbeginn 01:23:04,
  // AZ-5 01:23:40, 36s spaeter) auch der Fall war.
  assert.ok(c.mcpRunback, 'coastdown was not triggered when pumps step completed');
  step({ engine, session }, Math.round(10 / DT));
  assert.equal(tut.index, 5, 'test step did not complete');
  step({ engine, session }, Math.round(18 / DT));

  // 5 az5 -- die historische Handlung. Ob das gutgeht, entscheidet die
  // Physik (RunState.checkFail() laeuft VOR tutorial.done, siehe session.js).
  engine.scram('az5');
  step({ engine, session }, Math.round(10 / DT));

  assert.equal(session.phase, PHASE.DEBRIEF);
  assert.equal(s.destroyed, true, 'AZ-5 in the historical low-margin, coasted-down state must destroy the core');
  assert.equal(session.result.summary.completed, false);
  assert.equal(session.result.summary.failed, 'fail_fuel_damage');
  t.diagnostic(`n peaked and destroyed at t_sim=${s.t_sim.toFixed(2)}s`);
});

test('pressing AZ-5 too early (no coastdown) does not destroy the core -- the combination matters', () => {
  const { engine, session } = boot();
  const s = engine.state;
  const tut = session.tutorial;
  step({ engine, session }, Math.round(6 / DT));
  tut.confirmInspect();
  step({ engine, session }, Math.round(5 / DT));
  assert.equal(tut.index, 2);

  step({ engine, session }, Math.round(1160 / DT));
  assert.equal(tut.index, 3);

  // AZ-5 sofort, OHNE Pumpen/Auslauf -- die Kombination aus niedriger ORM
  // UND sinkendem Durchsatz war entscheidend, nicht ORM allein.
  engine.scram('az5');
  for (let i = 0, n = Math.round(30 / DT); i < n; i++) { engine.step(DT); stepEvents(engine, DT); }
  assert.equal(s.destroyed, false, 'AZ-5 without the coastdown should NOT reproduce the excursion');
});

test('AZ-5 keeps the tutorial running while the shutdown consequences unfold', () => {
  const { engine, session } = boot();
  const tut = session.tutorial;
  // Isolate the final objective: the regression is that scram.active used to
  // finish it after only one simulated second and immediately open debrief.
  tut.index = tut.steps.indexOf('az5');
  engine.scram('az5');
  step({ engine, session }, Math.round(2 / DT));

  assert.equal(session.phase, PHASE.RUNNING);
  assert.equal(tut.done, false);
  assert.ok(tut.held >= 1.9 && tut.held < tut.holdSeconds[tut.index]);
});

test('snapshot/restore round-trips through a save (own steps survive persist.js)', async () => {
  const { pack, apply } = await import('../static/js/net/persist.js');
  const { engine, session } = boot();
  step({ engine, session }, Math.round(6 / DT));
  session.tutorial.confirmInspect();
  step({ engine, session }, Math.round(3 / DT));

  const blob = JSON.parse(JSON.stringify(pack(engine, DEF.id, session.run, session)));
  const restoredEngine = createEngine(rbmk, { seed: DEF.seed });
  const restored = new Session(restoredEngine, DEF);
  restored.start();
  assert.equal(apply(blob, restoredEngine, restored.run, restored), null);
  assert.deepEqual(restored.tutorial.snapshot(), session.tutorial.snapshot());
  assert.equal(restored.tutorial.index, session.tutorial.index);
});
