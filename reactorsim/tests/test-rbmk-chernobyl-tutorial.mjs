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
import { pack, apply } from '../static/js/net/persist.js';

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

/**
 * Bis zum Beginn von Schritt `index` laufen lassen, hoechstens `maxS` Sekunden.
 * Ein einfaches step(n) taugt seit dem Vorfuehrmodus nicht mehr: das Drehbuch
 * erledigt Schritte von selbst (Pumpen, AZ-5), ein Block von 1160 s lief
 * deshalb glatt ueber den Pumpenschritt UND den ausgeloesten Auslauf hinweg.
 */
function advanceTo(f, index, maxS) {
  for (let i = 0, n = Math.round(maxS / DT); i < n; i++) {
    if (f.session.phase !== PHASE.RUNNING || f.session.tutorial.index >= index) break;
    step(f, 1);
  }
}

test('prepare() sets a hot, self-consistent low-margin state -- no phantom excursion', () => {
  const { engine } = boot();
  const s = engine.state;
  const d = engine.derive();
  assert.ok(Math.abs(d.rho_pcm) < 1, `rho = ${d.rho_pcm}`);
  assert.ok(s.n > 0.055 && s.n < 0.08, `n = ${(s.n * 100).toFixed(2)}%`);
  // ORM waehrend 'recover' liegt bei ~80 -- deutlich ueber dem historischen
  // Nachtwert, aber noetig, damit der 19-Minuten-Haltevorgang bei dieser
  // (vereinfachten, 2-Bank-) Physik ueberhaupt stabil bleibt. Die historisch
  // dokumentierten 6-8 Stab-Aequivalente werden erst unmittelbar vor dem Test
  // erreicht, durch den gezielten letzten Stabzug in _withdrawToTipSpan().
  assert.ok(d.orm > 60 && d.orm < 100, `orm = ${d.orm.toFixed(1)}`);
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

test('full guided sequence runs itself: handover, dip, recovery, pumps, coastdown, AZ-5', t => {
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
  // Xenon auf, als sich je zurueckholen liess). Braucht wie 'handover' eine
  // explizite Bestaetigung (siehe confirmIndices), sonst waere der Text weg,
  // bevor er gelesen ist.
  step({ engine, session }, Math.round(5 / DT));
  assert.ok(tut.confirmInspect());
  assert.equal(tut.index, 2, 'dip step did not complete');

  // 2 recover -- powerCtl haelt automatisch (siehe prepare()/_triggerDip:
  // das ist der validierte Pfad, kein manuelles Stabziehen als zusaetzliche
  // Fehlerquelle -- ein schmaler Trimm allein driftet hier nicht genug, um
  // ohne Spielereingriff denselben Endzustand zu treffen, und aendert damit
  // den spaeteren AZ-5-Ausgang). Die 19 Minuten laufen einfach ab.
  advanceTo({ engine, session }, 3, 1200);
  assert.equal(tut.index, 3, `recover step did not complete (n=${(s.n * 100).toFixed(2)}%, orm=${engine.derive().orm.toFixed(1)})`);

  // 3 pumps -- KEIN Handgriff mehr: seit dem Vorfuehrmodus schaltet das
  // Drehbuch die beiden zusaetzlichen Pumpen selbst zu (AUTO_PUMPS_S). Dass
  // hier nichts gestartet wird, IST der Test.
  assert.equal(c.mcp.filter(p => p.running).length, 6, 'six pumps before the script acts');
  let pumpGuard = 0;
  while (tut.index === 3 && pumpGuard < Math.round(30 / DT)) { step({ engine, session }, 1); pumpGuard++; }
  assert.equal(tut.index, 4, 'pumps step did not complete');
  // Sofort pruefen, BEVOR der (durch completeStep('pumps') ausgeloeste)
  // Kuehlmittelauslauf die Drehzahl schon wieder zurueckgenommen hat.
  assert.equal(c.mcp.filter(p => p.running && p.speed >= 0.9).length, 8);

  // 4 test -- completeStep('pumps') muss den Auslauf gestartet haben. Der
  // Schritt selbst schliesst, sobald der Durchsatz 5s ununterbrochen unter
  // 90% liegt (HOLD[4]=5, siehe chernobylTutorial.js).
  assert.ok(c.mcpRunback, 'coastdown was not triggered when pumps step completed');
  let testGuard = 0;
  while (tut.index === 4 && testGuard < Math.round(20 / DT)) { step({ engine, session }, 1); testGuard++; }
  assert.equal(tut.index, 5, 'test step did not complete');

  // 5 window -- reine Anzeige, bis das Drehbuch drueckt (AUTO_SCRAM_S = 14,5 s
  // seit Auslaufbeginn, Mitte von PRESS_WINDOW). Kurz davor, bei t+12s, darf
  // noch nichts ausgeloest haben.
  let preGuard = 0;
  while (tut.view().values.sinceRunback < 12 && preGuard < Math.round(20 / DT)) {
    step({ engine, session }, 1); preGuard++;
  }
  assert.equal(s.scram.active, false, 'script must not have pressed AZ-5 before PRESS_WINDOW mid-point');
  assert.equal(tut.index, 5, 'window step should still be waiting at t+12s');
  assert.equal(tut.hint(), 'tut_chernobyl_hint_window_wait');

  // Weiter, bis das Drehbuch AZ-5 ausloest.
  let windowGuard = 0;
  while (tut.index === 5 && windowGuard < Math.round(30 / DT)) { step({ engine, session }, 1); windowGuard++; }
  assert.equal(tut.index, 6, 'script did not press AZ-5');
  const since = tut.view().values.sinceRunback;
  // PRESS_WINDOW ist 8-21 s; gedrueckt wird in dessen Mitte. Der Test haelt
  // BEIDES fest -- den konkreten Zeitpunkt und dass er im Wirkfenster liegt,
  // denn nur dann ist AZ-5 hier wirklich die Ursache (siehe DESTROY_WINDOWS
  // und tut_chernobyl_debrief_note).
  assert.ok(since >= 14.5 && since < 15,
    `script should press AZ-5 at t+14.5s, got sinceRunback=${since}`);
  assert.ok(since >= 8 && since <= 21, `press must fall inside PRESS_WINDOW, got ${since}`);
  assert.equal(s.scram.active, true);

  // 6 az5 -- ob das gutgeht, entscheidet danach die Physik
  // (RunState.checkFail() laeuft VOR tutorial.done, siehe session.js). Die
  // Leistungsspitze kommt ERST jetzt: vor dem Druecken haelt der schmale
  // AR-Trimm die Anlage noch nahe am Sollwert.
  assert.equal(tut.hint(), 'tut_chernobyl_hint_window_now');
  let peak = s.n;
  for (let i = 0, n = Math.round(20 / DT); i < n && session.phase === PHASE.RUNNING; i++) {
    step({ engine, session }, 1);
    peak = Math.max(peak, s.n);
  }
  assert.ok(peak > 0.15, `AZ-5 should drive a visible excursion, peak n=${(peak * 100).toFixed(1)}%`);

  assert.equal(session.phase, PHASE.DEBRIEF);
  assert.equal(s.destroyed, true, 'AZ-5 in the historical low-margin, coasted-down state must destroy the core');
  assert.equal(session.result.summary.completed, false);
  assert.equal(session.result.summary.failed, 'fail_fuel_damage');
  t.diagnostic(`n peaked and destroyed at t_sim=${s.t_sim.toFixed(2)}s`);
});

// Die zweite Zeitanzeige (siehe chernobylTutorial.js: WALL_DIP_S). Sie ist
// eine Behauptung ueber die Nacht -- "AZ-5 um 01:23:40" steht sogar im
// Schritttext (tut_chernobyl_az5_instruction) -- und gehoert deshalb
// nachgemessen, nicht nur hingeschrieben. Aendert sich eine der Drehbuchzeiten
// (Haltephase, Pumpenhochlauf, AUTO_SCRAM_S), faellt dieser Test um, nicht die
// Glaubwuerdigkeit der Anzeige.
const WALL_DIP = 1 * 3600 + 4 * 60 + 8;   // 01:04:08
const WALL_AZ5 = 1 * 3600 + 23 * 60 + 40; // 01:23:40
test('the clock hits the historical marks: one jump in the dip step, AZ-5 at 01:23:40', t => {
  const { engine, session } = boot();
  const s = engine.state;
  const tut = session.tutorial;
  const hms = (sec) => new Date(Math.round(sec) * 1000).toISOString().slice(11, 19);

  // 0 handover -- vor dem Sprung laeuft die Uhr deckungsgleich mit der
  // Betriebszeit: Schichtuebernahme kurz nach Mitternacht.
  step({ engine, session }, Math.round(6 / DT));
  assert.equal(tut.view().wall, s.t_sim);
  assert.equal(engine.ctx.wallClock, 0);
  assert.ok(tut.confirmInspect());

  // 1 dip -- der einzige Sprung, genau ueber die Stunde, die diese Uebung
  // offen auslaesst (Einbruch um 00:28 plus Erholung).
  step({ engine, session }, Math.round(5 / DT));
  const beforeJump = tut.view().wall;
  assert.ok(beforeJump < 60, `still just past midnight before the jump, got ${hms(beforeJump)}`);
  assert.ok(tut.confirmInspect());
  const afterJump = tut.view().wall;
  assert.equal(afterJump, WALL_DIP, `dip must end on 01:04:08, got ${hms(afterJump)}`);
  assert.equal(tut.completed.at(-1).w, WALL_DIP,
    'the dip entry carries the time AFTER the jump -- that step IS the missing hour');
  assert.equal(tut.completed[0].w, tut.completed[0].t,
    'handover was stamped before the jump and must still read as run time');

  // Speichern/Laden: ohne den Versatz im Snapshot liefe die Uhr nach dem Laden
  // wieder ab Mitternacht, waehrend die Schrittliste schon 01:04 zeigt.
  const blob = JSON.parse(JSON.stringify(pack(engine, DEF.id, session.run, session)));
  const reEngine = createEngine(rbmk, { seed: DEF.seed });
  const reSession = new Session(reEngine, DEF);
  reSession.start();
  assert.equal(apply(blob, reEngine, reSession.run, reSession), null);
  assert.equal(reSession.tutorial.view().wall, tut.view().wall, 'the jump must survive a save/reload');
  assert.equal(reEngine.ctx.wallClock, engine.ctx.wallClock,
    'the status-tile channel (ctx.wallClock) must be republished after a load');

  // Ab hier laeuft die Uhr 1:1 mit -- durch die Haltephase, die Pumpen und
  // den Auslauf bis zum Knopfdruck.
  let guard = 0;
  const limit = Math.round(1400 / DT);
  while (!s.scram.active && guard < limit) { step({ engine, session }, 1); guard++; }
  assert.equal(s.scram.active, true, 'script never pressed AZ-5');
  const az5 = tut.view().wall;
  assert.ok(Math.abs(az5 - WALL_AZ5) <= 3, `AZ-5 should fall on 01:23:40, got ${hms(az5)}`);

  while (session.phase === PHASE.RUNNING && guard < limit) { step({ engine, session }, 1); guard++; }
  assert.equal(s.destroyed, true);
  const end = s.t_sim + engine.ctx.wallClock;
  assert.ok(Math.abs(end - (WALL_AZ5 + 4)) <= 5, `destruction should fall near 01:23:44, got ${hms(end)}`);
  // Das Ergebnis traegt die Uhrzeiten mit -- die Schrittliste im Debrief
  // zeigt sie neben der Betriebszeit (siehe ui/tutorial.js).
  const az5Entry = session.result.tutorial.completed.find(e => e.id === 'az5');
  assert.ok(!az5Entry || Math.abs(az5Entry.w - WALL_AZ5) <= 3);
  assert.equal(session.result.tutorial.wallOffset, engine.ctx.wallClock);
  t.diagnostic(`dip ${hms(afterJump)} · AZ-5 ${hms(az5)} · destroyed ${hms(end)}`);
});

// Der zweite Befund, den der Abschlusstext dem Spieler als Tatsache hinstellt
// (tut_chernobyl_debrief_note): Der Ausbruch laeuft schon VOR dem Knopfdruck,
// die Anlage haengt allein am schmalen AR-Trimm. Beide Zahlen daraus gehoeren
// in einen Test, sonst veraltet der Text stillschweigend.
test('the debrief note must stay true: excursion without AZ-5, destroyed without the trim', t => {
  // Bis zum Beginn des Pumpenschritts, mit ausgehebeltem AZ-5 -- das Drehbuch
  // selbst (Pumpen, Auslauf, AR-Trimm) laeuft unveraendert weiter, step()
  // ruft engine.scram() nur ins Leere.
  function runWithoutAz5({ dropTrim = false } = {}) {
    const { engine, session } = boot();
    const s = engine.state; const c = engine.ctx; const tut = session.tutorial;
    step({ engine, session }, Math.round(6 / DT));
    tut.confirmInspect();
    step({ engine, session }, Math.round(5 / DT));
    tut.confirmInspect();
    advanceTo({ engine, session }, 3, 1200);
    assert.equal(tut.index, 3);
    engine.scram = () => {};
    let peak = s.n; let tPeak = 0;
    for (let i = 0, n = Math.round(120 / DT); i < n && session.phase === PHASE.RUNNING; i++) {
      step({ engine, session }, 1);
      if (dropTrim && c.arTrim) { c.arTrim = null; s.rho_ext = 0; }
      if (s.n > peak) { peak = s.n; tPeak = s.t_sim - tut._runbackT0; }
    }
    assert.equal(s.scram.active, false, 'AZ-5 must really have been suppressed for this measurement');
    return { s, peak, tPeak, since: s.t_sim - tut._runbackT0 };
  }

  // 1) Mit Trimm: der Dampfblasenkoeffizient treibt die Leistung allein auf
  //    ~133 % bei t+38s -- und die Anlage haelt gerade noch.
  const held = runWithoutAz5();
  assert.equal(held.s.destroyed, false,
    `without AZ-5 the trim must still hold (peak ${(held.peak * 100).toFixed(1)}%)`);
  assert.ok(held.peak > 1.1 && held.peak < 1.6,
    `self-driven rise should peak near 133%, got ${(held.peak * 100).toFixed(1)}%`);
  assert.ok(held.tPeak > 30 && held.tPeak < 45,
    `self-driven peak should land near t+38s, got t+${held.tPeak.toFixed(1)}s`);

  // 2) Ohne Trimm: derselbe Zustand zerstoert sich selbst -- so duenn ist der
  //    Abstand, den der Abschlusstext behauptet.
  const bare = runWithoutAz5({ dropTrim: true });
  assert.equal(bare.s.destroyed, true,
    'without the narrow trim the same state must destroy itself even with AZ-5 suppressed');
  assert.ok(bare.since < 30, `should fail early without the trim, got t+${bare.since.toFixed(1)}s`);
  t.diagnostic(`no AZ-5: peak ${(held.peak * 100).toFixed(1)}% at t+${held.tPeak.toFixed(1)}s; `
    + `without trim destroyed at t+${bare.since.toFixed(1)}s`);
});

test('pressing AZ-5 too early (no coastdown) does not destroy the core -- the combination matters', () => {
  const { engine, session } = boot();
  const s = engine.state;
  const tut = session.tutorial;
  step({ engine, session }, Math.round(6 / DT));
  tut.confirmInspect();
  step({ engine, session }, Math.round(5 / DT));
  tut.confirmInspect();
  assert.equal(tut.index, 2);

  advanceTo({ engine, session }, 3, 1200);
  assert.equal(tut.index, 3);

  // AZ-5 sofort, OHNE Pumpen/Auslauf -- die Kombination aus niedriger ORM
  // UND sinkendem Durchsatz war entscheidend, nicht ORM allein.
  engine.scram('az5');
  for (let i = 0, n = Math.round(30 / DT); i < n; i++) { engine.step(DT); stepEvents(engine, DT); }
  assert.equal(s.destroyed, false, 'AZ-5 without the coastdown should NOT reproduce the excursion');
});

test('snapshot/restore round-trips through a save (own steps survive persist.js)', () => {
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

test('saving and reloading mid-coastdown must not lose the narrow AR trim', () => {
  // Nutzerrueckmeldung: nach einem Laden waehrend des Auslaufversuchs schoss
  // die Leistung viel frueher und viel hoeher hoch als ohne Neuladen (schon
  // 73-80% bei t+22s statt der erwarteten ~6%, siehe Screenshot). Ursache:
  // ctx.arTrim (chernobylTutorial.js: _triggerCoastdown/step()) ist ein
  // Ad-hoc-Objekt auf ctx, kein ctx.saveable-Regler -- persist.js kannte es
  // nicht, ein frischer Engine/ctx nach dem Laden hatte gar keinen Trimm
  // mehr. c.powerCtl.auto ist zu diesem Zeitpunkt schon false (der Trimm ist
  // die EINZIGE noch aktive Gegenkopplung), die Anlage lief danach voellig
  // ungebremst hoch.
  //
  // Gemessen wird seit dem Vorfuehrmodus bei t+14 s statt bei den gemeldeten
  // t+22,4 s: das Drehbuch drueckt AZ-5 bei 14,5 s, danach gibt es keinen
  // Trimm mehr zu vergleichen. Der Fehler ist dort genauso sichtbar -- der
  // Trimm steht zu diesem Zeitpunkt laengst an seinem Anschlag (AR_CAP_PCM =
  // 500 pcm), fehlt er, sind das 500 pcm Unterschied.
  const targetSince = 14; // knapp vor AUTO_SCRAM_S

  function runToSinceRunback(target, { reloadAfterTest } = {}) {
    const { engine, session } = boot();
    const s = engine.state; const c = engine.ctx; const tut = session.tutorial;
    step({ engine, session }, Math.round(6 / DT));
    tut.confirmInspect();
    step({ engine, session }, Math.round(5 / DT));
    tut.confirmInspect();
    advanceTo({ engine, session }, 3, 1200);
    let g = 0;
    while (tut.index === 3 && g < Math.round(30 / DT)) { step({ engine, session }, 1); g++; }
    g = 0;
    while (tut.index === 4 && g < Math.round(20 / DT)) { step({ engine, session }, 1); g++; }
    let curEngine = engine, curSession = session;
    if (reloadAfterTest) {
      const blob = JSON.parse(JSON.stringify(pack(engine, DEF.id, session.run, session)));
      curEngine = createEngine(rbmk, { seed: DEF.seed });
      curSession = new Session(curEngine, DEF);
      curSession.start();
      const err = apply(blob, curEngine, curSession.run, curSession);
      assert.equal(err, null, `reload failed: ${err}`);
    }
    const cs = curEngine.state; const ctut = curSession.tutorial;
    let guard = 0;
    while ((cs.t_sim - (ctut._runbackT0 ?? cs.t_sim)) < target
      && curSession.phase === PHASE.RUNNING && guard < Math.round(60 / DT)) {
      step({ engine: curEngine, session: curSession }, 1);
      guard++;
    }
    return { engine: curEngine, session: curSession };
  }

  const baseline = runToSinceRunback(targetSince, { reloadAfterTest: false });
  const reloaded = runToSinceRunback(targetSince, { reloadAfterTest: true });
  assert.ok(reloaded.engine.ctx.arTrim, 'arTrim must survive a save/reload mid-coastdown');
  assert.equal(reloaded.session.phase, PHASE.RUNNING,
    'plant must not have already run away/been destroyed by t+14s after a reload');
  const diff = Math.abs(baseline.engine.state.n - reloaded.engine.state.n) * 100;
  assert.ok(diff < 1,
    `power after reload should track the un-reloaded run closely, got ${diff.toFixed(2)}pp difference `
    + `(baseline n=${(baseline.engine.state.n * 100).toFixed(1)}%, reloaded n=${(reloaded.engine.state.n * 100).toFixed(1)}%)`);
});
