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

test('full guided sequence runs itself: handover, dip, recovery, pumps, hold, coastdown, AZ-5', t => {
  const { engine, session } = boot();
  const s = engine.state;
  const c = engine.ctx;
  const tut = session.tutorial;

  // 0 handover
  step({ engine, session }, Math.round(6 / DT));
  assert.equal(tut.index, 0);
  assert.ok(tut.confirmInspect());
  assert.equal(tut.index, 1);

  // 1 dip -- seit 0.6.1 wirklich gefahren: die Regelung geht auf Hand, die
  // Staebe fahren ein, die Leistung bricht ein, danach holt dieselbe Regelung
  // sie zurueck (siehe _triggerDip/_stepDip). Der Schritt bestaetigt sich
  // nicht mehr, er dauert.
  assert.equal(tut._dip?.phase, 'down', 'the dip must start when handover is confirmed');
  assert.equal(c.powerCtl.auto, false, 'the controller goes to manual for the dip');
  let bottom = 1;
  let dipGuard = 0;
  while (tut.index === 1 && dipGuard < Math.round(600 / DT)) {
    step({ engine, session }, 1);
    bottom = Math.min(bottom, s.n);
    dipGuard++;
  }
  assert.equal(tut.index, 2, 'dip step did not complete');
  assert.ok(bottom <= 0.02, `power must really collapse, lowest was ${(bottom * 100).toFixed(2)}%`);
  // Und die Anlage ist danach wieder da, wo die Uebung sie braucht.
  assert.ok(s.n >= 0.055 && s.n <= 0.09, `recovered to ${(s.n * 100).toFixed(2)}%`);
  assert.equal(c.powerCtl.auto, true, 'the controller brings the power back itself');

  // 2 recover -- powerCtl haelt automatisch (siehe prepare()/_triggerDip:
  // das ist der validierte Pfad, kein manuelles Stabziehen als zusaetzliche
  // Fehlerquelle -- ein schmaler Trimm allein driftet hier nicht genug, um
  // ohne Spielereingriff denselben Endzustand zu treffen, und aendert damit
  // den spaeteren AZ-5-Ausgang). Seit 0.6.1 laeuft dieser erste Abschnitt nur
  // bis zur Pumpenzuschaltung um 01:07, nicht mehr ueber die ganzen 19
  // Minuten -- der Rest steht im Schritt 'hold' dahinter.
  advanceTo({ engine, session }, 3, 400);
  assert.equal(tut.index, 3, `recover step did not complete (n=${(s.n * 100).toFixed(2)}%, orm=${engine.derive().orm.toFixed(1)})`);

  // 3 pumps -- KEIN Handgriff mehr: seit dem Vorfuehrmodus schaltet das
  // Drehbuch die beiden zusaetzlichen Pumpen selbst zu (AUTO_PUMPS_S). Dass
  // hier nichts gestartet wird, IST der Test.
  assert.equal(c.mcp.filter(p => p.running).length, 6, 'six pumps before the script acts');
  let pumpGuard = 0;
  while (tut.index === 3 && pumpGuard < Math.round(60 / DT)) { step({ engine, session }, 1); pumpGuard++; }
  assert.equal(tut.index, 4, 'pumps step did not complete');
  assert.equal(c.mcp.filter(p => p.running && p.speed >= 0.9).length, 8);
  // Und der Auslauf laeuft hier noch NICHT -- er haengt seit 0.6.1 am Ende
  // von 'hold', nicht mehr am Ende von 'pumps'.
  assert.equal(s.tgCoasting, false, 'coastdown must not start with the pumps any more');
  assert.equal(s.tgSpeed, 1, 'the turbogenerator is still on the grid here');

  // 4 hold -- die zweite Haelfte der Haltephase, jetzt mit acht Pumpen. Ihre
  // Dauer steht nicht fest, sondern zielt auf die Uhr (siehe holdSeconds()).
  advanceTo({ engine, session }, 5, 1400);
  assert.equal(tut.index, 5, `hold step did not complete (n=${(s.n * 100).toFixed(2)}%)`);

  // 5 test -- completeStep('hold') muss den Auslauf gestartet haben. Der
  // Schritt selbst schliesst, sobald die Drehzahl 5s ununterbrochen unter
  // 90% liegt (siehe HOLD in chernobylTutorial.js).
  assert.equal(s.tgCoasting, true, 'coastdown was not triggered when the hold step completed');
  // Der Pumpen-Sollwert des Spielers bleibt dabei unangetastet -- der Auslauf
  // faehrt die Drehzahl, nicht den Schieber (siehe rbmk.js sp.turbogen).
  assert.equal(s.mcpDmd, 1, 'the coastdown must not move the operator demand');
  let testGuard = 0;
  while (tut.index === 5 && testGuard < Math.round(20 / DT)) { step({ engine, session }, 1); testGuard++; }
  assert.equal(tut.index, 6, 'test step did not complete');

  // 6 window -- reine Anzeige, bis das Drehbuch drueckt (AUTO_SCRAM_S = 36 s
  // seit Auslaufbeginn, der historische Abstand). Kurz davor, bei t+12s, darf
  // noch nichts ausgeloest haben -- dort waere der Druck sogar folgenlos
  // (siehe DESTROY_WINDOWS: die ersten zwoelf Sekunden zerstoeren nicht).
  let preGuard = 0;
  while (tut.view().values.sinceRunback < 12 && preGuard < Math.round(20 / DT)) {
    step({ engine, session }, 1); preGuard++;
  }
  assert.equal(s.scram.active, false, 'script must not have pressed AZ-5 before PRESS_WINDOW mid-point');
  assert.equal(tut.index, 6, 'window step should still be waiting at t+12s');
  assert.equal(tut.hint(), 'tut_chernobyl_hint_window_wait');

  // Weiter, bis das Drehbuch AZ-5 ausloest.
  let windowGuard = 0;
  while (tut.index === 6 && windowGuard < Math.round(60 / DT)) { step({ engine, session }, 1); windowGuard++; }
  assert.equal(tut.index, 7, 'script did not press AZ-5');
  const since = tut.view().values.sinceRunback;
  // Gedrueckt wird im HISTORISCHEN Abstand von 36 s -- seit der echte
  // Rotorauslauf das Wirkfenster bis weit dahinter reicht (gemessen 15-105 s,
  // siehe DESTROY_WINDOWS), geht beides zugleich: die dokumentierte Sekunde
  // UND ein Druck, der wirklich zerstoert. Der Test haelt beides fest.
  assert.ok(since >= 36 && since < 36.5,
    `script should press AZ-5 at t+36s, got sinceRunback=${since}`);
  assert.ok(since >= 15 && since <= 105, `press must fall inside PRESS_WINDOW, got ${since}`);
  assert.equal(s.scram.active, true);

  // 7 az5 -- ob das gutgeht, entscheidet danach die Physik
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
// Der Sprungwert selbst steht NICHT mehr fest in chernobylTutorial.js: er
// ergibt sich rueckwaerts aus 01:07 minus Vorlauf und Haltezeit des ersten
// Abschnitts (WALL_PUMPS_S - AUTO_PUMPS_S - RECOVER_HOLD_S = 01:04:05). Hier
// steht er als Zahl, damit eine stille Verschiebung auffaellt.
const WALL_HANDOVER = 27 * 60;            // 00:27:00
const WALL_DIP = 1 * 3600 + 4 * 60 + 5;   // 01:04:05
const WALL_PUMPS = 1 * 3600 + 7 * 60;     // 01:07:00
const WALL_TEST = 1 * 3600 + 23 * 60 + 4; // 01:23:04
const WALL_AZ5 = 1 * 3600 + 23 * 60 + 40; // 01:23:40
test('the clock hits the historical marks: dip jump, pumps at 01:07, AZ-5 at 01:23:40', t => {
  const { engine, session } = boot();
  const s = engine.state;
  const tut = session.tutorial;
  const hms = (sec) => new Date(Math.round(sec) * 1000).toISOString().slice(11, 19);

  // 0 handover -- vor dem Sprung laeuft die Uhr mit festem Versatz zur
  // Betriebszeit: Schichtuebernahme um 00:27, kurz vor dem Einbruch.
  step({ engine, session }, Math.round(6 / DT));
  assert.equal(tut.view().wall, s.t_sim + WALL_HANDOVER);
  assert.equal(engine.ctx.wallClock, WALL_HANDOVER);
  assert.ok(tut.confirmInspect());

  // 1 dip -- der einzige Sprung. Er ueberbrueckt nur noch den Rest: der
  // Einbruch selbst wird gefahren (Minuten), real dauerte die Erholung eine
  // gute halbe Stunde.
  const beforeJump = tut.view().wall;
  assert.ok(beforeJump >= WALL_HANDOVER && beforeJump < WALL_HANDOVER + 600,
    `the shift starts shortly before the dip at 00:28, got ${hms(beforeJump)}`);
  let dipGuard = 0;
  while (tut.index === 1 && dipGuard < Math.round(600 / DT)) { step({ engine, session }, 1); dipGuard++; }
  assert.equal(tut.index, 2, 'dip step did not complete');
  const afterJump = tut.view().wall;
  assert.equal(afterJump, WALL_DIP, `dip must end on 01:04:08, got ${hms(afterJump)}`);
  assert.equal(tut.completed.at(-1).w, WALL_DIP,
    'the dip entry carries the time AFTER the jump -- that step IS the missing hour');
  assert.equal(tut.completed[0].w, tut.completed[0].t + WALL_HANDOVER,
    'handover was stamped before the jump, so it carries only the shift offset');

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

  // Die Pumpenzuschaltung ist die zweite dokumentierte Marke -- bis 0.6.0
  // zeigte sie 01:23:25, weil der Pumpenschritt hinter der GANZEN Haltephase
  // stand. Seit die Haltephase an dieser Stelle geteilt ist, faellt sie auf
  // die historische Minute.
  let pumpGuard = 0;
  const pumpLimit = Math.round(400 / DT);
  while (engine.ctx.mcp.filter(p => p.running).length < 8 && pumpGuard < pumpLimit) {
    step({ engine, session }, 1); pumpGuard++;
  }
  const pumpsOn = tut.view().wall;
  assert.ok(Math.abs(pumpsOn - WALL_PUMPS) <= 2,
    `the two extra pumps should start on 01:07:00, got ${hms(pumpsOn)}`);

  // Ab hier laeuft die Uhr 1:1 mit -- durch die zweite Haelfte der Haltephase
  // und den Auslauf bis zum Knopfdruck.
  let guard = 0;
  const limit = Math.round(1400 / DT);
  while (!s.scram.active && guard < limit) { step({ engine, session }, 1); guard++; }
  assert.equal(s.scram.active, true, 'script never pressed AZ-5');
  const az5 = tut.view().wall;
  assert.ok(Math.abs(az5 - WALL_AZ5) <= 3, `AZ-5 should fall on 01:23:40, got ${hms(az5)}`);
  // Und der Testbeginn trifft jetzt ebenfalls die dokumentierte Sekunde. Bis
  // 0.6.0 ging nur eines von beiden: das Wirkfenster endete bei 21 s, der
  // historische Abstand von 36 s war nicht darstellbar, und der Auslauf
  // begann 21 s zu spaet (siehe BACKLOG.md).
  const coast = tut.completed.find(e => e.id === 'hold');
  assert.ok(coast, 'the hold step must be recorded');
  assert.ok(Math.abs(coast.w - WALL_TEST) <= 3,
    `the coastdown should start on 01:23:04, got ${hms(coast.w)}`);

  while (session.phase === PHASE.RUNNING && guard < limit) { step({ engine, session }, 1); guard++; }
  assert.equal(s.destroyed, true);
  const end = s.t_sim + engine.ctx.wallClock;
  assert.ok(Math.abs(end - (WALL_AZ5 + 4)) <= 5, `destruction should fall near 01:23:44, got ${hms(end)}`);
  // Das Ergebnis traegt die Uhrzeiten mit -- die Schrittliste im Debrief
  // zeigt sie neben der Betriebszeit (siehe ui/tutorial.js).
  const az5Entry = session.result.tutorial.completed.find(e => e.id === 'az5');
  assert.ok(!az5Entry || Math.abs(az5Entry.w - WALL_AZ5) <= 3);
  assert.equal(session.result.tutorial.wallOffset, engine.ctx.wallClock);
  t.diagnostic(`dip ${hms(afterJump)} · pumps ${hms(pumpsOn)} · AZ-5 ${hms(az5)} `
    + `· destroyed ${hms(end)}`);
});

// ── Turbogenerator als Schwungmasse ─────────────────────────────────────────
//
// Bis 0.6.0 war der Auslaufversuch ein Drehbuch: ein Ereignis fuhr den
// PUMPEN-SOLLWERT linear auf null. Jetzt ist die Drehzahl eine echte
// Zustandsgroesse, die gegen die Pumpenlast ausbremst (rbmk.js sp.turbogen).
// Beides gehoert geprueft: die Kurve selbst und dass sie nur die Pumpen
// erwischt, die am Generator haengen.

test('the turbogenerator coasts down on its own curve, not on a scripted ramp', () => {
  const engine = createEngine(rbmk, { seed: DEF.seed });
  const s = engine.state;
  const tau = engine.spec.turbogen.tau_s;
  assert.equal(s.tgSpeed, 1, 'on the grid the rotor holds nominal speed');

  // Zehn Sekunden am Netz aendern nichts -- ohne Auslauf keine Bremse.
  for (let i = 0; i < Math.round(10 / DT); i++) engine.step(DT);
  assert.equal(s.tgSpeed, 1);

  s.tgCoasting = true;
  const t0 = s.t_sim;
  // w(t) = 1 / (1 + t/tau) ist die geschlossene Loesung von dw/dt = -w^2/tau
  // (Kreiselpumpe: Leistung ~ Drehzahl^3, siehe sp.turbogen). Der Schritt in
  // rbmk.js ist dafuer exakt, der Zeitschritt faellt heraus -- deshalb darf
  // die Toleranz hier eng sein.
  for (const probe of [tau, 2 * tau, 4 * tau]) {
    while (s.t_sim - t0 < probe - 1e-9) engine.step(DT);
    const expected = 1 / (1 + (s.t_sim - t0) / tau);
    assert.ok(Math.abs(s.tgSpeed - expected) < 1e-9,
      `w(${probe}s) = ${s.tgSpeed}, expected ${expected}`);
  }
  // Nach vier Zeitkonstanten ist sie bei einem Fuenftel -- aber nicht bei null.
  assert.ok(s.tgSpeed > 0.15 && s.tgSpeed < 0.25, `tgSpeed = ${s.tgSpeed}`);
});

test('only the pumps on the coasting generator lose speed -- the rest stay on the grid', () => {
  const engine = createEngine(rbmk, { seed: DEF.seed });
  const s = engine.state;
  const c = engine.ctx;
  const onRotor = engine.spec.turbogen.coastdownPumps;
  const gridSide = c.mcp.length - onRotor;

  for (let i = 0; i < Math.round(20 / DT); i++) engine.step(DT);
  const fullFlow = s.W_core;

  s.tgCoasting = true;
  for (let i = 0; i < Math.round(120 / DT); i++) engine.step(DT);

  // Der Sollwert des Spielers bleibt unangetastet -- der Auslauf faehrt die
  // Drehzahl, nicht den Schieber. Genau das war am alten Drehbuch falsch.
  assert.equal(s.mcpDmd, 1, 'the coastdown must not move the operator demand');
  for (let i = 0; i < gridSide; i++) {
    assert.ok(c.mcp[i].speed > 0.95,
      `pump ${i} is on the grid and must keep running, got ${c.mcp[i].speed}`);
  }
  for (let i = gridSide; i < c.mcp.length; i++) {
    assert.ok(c.mcp[i].speed < 0.3,
      `pump ${i} hangs on the coasting generator, got ${c.mcp[i].speed}`);
  }
  // Historisch entscheidend: der Kernstrom faellt DEUTLICH, aber nicht auf
  // null -- vier von acht Pumpen kuehlen weiter.
  assert.ok(s.W_core < 0.8 * fullFlow && s.W_core > 0.4 * fullFlow,
    `core flow ${s.W_core.toFixed(0)} of ${fullFlow.toFixed(0)} kg/s`);
});

// ── Zeitlupe ────────────────────────────────────────────────────────────────

test('the exercise asks for slow motion only around AZ-5, not during the hold', () => {
  const { engine, session } = boot();
  const s = engine.state;
  const tut = session.tutorial;
  // Vor dem Auslauf entscheidet der Spieler ueber den Zeitraffer.
  assert.equal(tut.speedHint, null);

  step({ engine, session }, Math.round(6 / DT));
  tut.confirmInspect();
  step({ engine, session }, Math.round(5 / DT));
  tut.confirmInspect();
  advanceTo({ engine, session }, 5, 1400);
  assert.equal(tut.speedHint, null, 'the hold and the coastdown start run at normal speed');

  // Kurz vor dem Knopfdruck schaltet die Uebung selbst auf Zeitlupe -- im
  // Vorfuehrmodus koennte der Spieler den Moment sonst nicht sehen, und die
  // Stellteile sind ohnehin gesperrt.
  let guard = 0;
  while (tut.speedHint === null && guard < Math.round(60 / DT)) {
    step({ engine, session }, 1); guard++;
  }
  const since = s.t_sim - tut._runbackT0;
  assert.ok(typeof tut.speedHint === 'number' && tut.speedHint > 0 && tut.speedHint < 1,
    `slow motion must be a real factor below 1, got ${tut.speedHint}`);
  assert.ok(since > 25 && since < 36,
    `slow motion should start a few seconds before AZ-5 at t+36s, got t+${since.toFixed(1)}s`);
  assert.equal(s.scram.active, false, 'the switch must land BEFORE the press, not inside it');
});

// Der zweite Befund, den der Abschlusstext dem Spieler als Tatsache hinstellt
// (tut_chernobyl_debrief_note). Er hat sich mit dem echten Rotorauslauf
// GEAENDERT und gehoert deshalb erst recht in einen Test:
//
//   frueher (Rampe auf null): die Anlage lief schon ohne AZ-5 auf 133 % und
//   haing allein am schmalen Trimm -- der Knopf gab nur den Rest.
//   jetzt (vier Pumpen bleiben am Netz): ohne AZ-5 passiert NICHTS, die
//   Leistung bleibt bei rund 7 %. Der Knopf ist die Ursache, nicht der
//   Ausloeser eines ohnehin laufenden Ausbruchs.
//
// Was geblieben ist: ohne den schmalen AR-Trimm zerstoert sich dieselbe
// Anlage auch ohne jeden Knopfdruck.
test('the debrief note must stay true: nothing without AZ-5, destroyed without the trim', t => {
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
    // Bis zum Beginn des Auslaufs (Schritt 'test', Index 5) -- er haengt seit
    // 0.6.1 am Ende von 'hold', nicht mehr am Ende von 'pumps'.
    advanceTo({ engine, session }, 5, 1400);
    assert.equal(tut.index, 5);
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

  // 1) Ohne AZ-5 passiert nichts. Vier der acht Pumpen bleiben am Netz, der
  //    Kern bleibt gekuehlt -- die Leistung ruehrt sich kaum von ihren 7 %.
  //    Damit ist der Knopfdruck die Ursache und nicht die Zugabe.
  const held = runWithoutAz5();
  assert.equal(held.s.destroyed, false,
    `without AZ-5 nothing must happen (peak ${(held.peak * 100).toFixed(1)}%)`);
  assert.ok(held.peak < 0.12,
    `without AZ-5 power must stay near its 7% hold, got ${(held.peak * 100).toFixed(1)}%`);

  // 2) Ohne Trimm: derselbe Zustand zerstoert sich selbst, auch ohne jeden
  //    Knopfdruck -- so duenn ist der Abstand, den der Abschlusstext
  //    behauptet.
  const bare = runWithoutAz5({ dropTrim: true });
  assert.equal(bare.s.destroyed, true,
    'without the narrow trim the same state must destroy itself even with AZ-5 suppressed');
  assert.ok(bare.since < 40, `should fail early without the trim, got t+${bare.since.toFixed(1)}s`);
  t.diagnostic(`no AZ-5: peak ${(held.peak * 100).toFixed(1)}%; `
    + `without trim destroyed at t+${bare.since.toFixed(1)}s`);
});

// Der erste Befund, und der Kern der Uebung: derselbe Knopf, zu frueh
// gedrueckt, ist harmlos. Gemessen (tests/tools/chernobyl_press_window.mjs):
// bis t+12s haelt der Brennstoff, ab t+15s nicht mehr.
test('AZ-5 pressed too early in the same coastdown does not destroy the core', t => {
  function pressAt(target) {
    const { engine, session } = boot();
    const s = engine.state; const tut = session.tutorial;
    const realScram = engine.scram.bind(engine);
    engine.scram = () => {};          // nur das Drehbuch aushebeln
    step({ engine, session }, Math.round(6 / DT));
    tut.confirmInspect();
    step({ engine, session }, Math.round(5 / DT));
    tut.confirmInspect();
    advanceTo({ engine, session }, 5, 1400);
    let pressed = false;
    for (let i = 0, n = Math.round(180 / DT); i < n && session.phase === PHASE.RUNNING; i++) {
      step({ engine, session }, 1);
      const since = s.t_sim - tut._runbackT0;
      if (!pressed && since >= target) { realScram('az5'); pressed = true; }
    }
    assert.equal(pressed, true, `AZ-5 was never pressed for t+${target}s`);
    return s;
  }

  const early = pressAt(5);
  assert.equal(early.destroyed, false,
    'AZ-5 five seconds into the coastdown must not destroy the core -- the flow is still there');
  const late = pressAt(36);
  assert.equal(late.destroyed, true,
    'the same button 36 s in must destroy it -- that is the whole point of the exercise');
  t.diagnostic('AZ-5 at t+5s survived, at t+36s destroyed');
});

test('pressing AZ-5 too early (no coastdown) does not destroy the core -- the combination matters', () => {
  const { engine, session } = boot();
  const s = engine.state;
  const tut = session.tutorial;
  step({ engine, session }, Math.round(6 / DT));
  tut.confirmInspect();
  // Durch den gefahrenen Einbruch (siehe _triggerDip) und die Haltephase bis
  // zur Pumpenzuschaltung -- beides laeuft von selbst ab.
  advanceTo({ engine, session }, 3, 1400);
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
    // Index 6 ('window') heisst: Haltephase, Pumpen und der Schritt 'test'
    // sind durch, der Auslauf laeuft -- genau der Zustand, in dem der Fehler
    // auftrat.
    advanceTo({ engine, session }, 6, 1400);
    assert.equal(tut.index, 6, 'coastdown was not reached');
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
