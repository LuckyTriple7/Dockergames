// "Block 4 -- die Nacht des 26. April": gefuehrter historischer Nachbau.
//
// Der wichtigste Test hier ist der letzte: AZ-5 aus dem historisch
// nachgestellten Zustand heraus muss ueber den ECHTEN prepare()-Pfad zur
// Zerstoerung fuehren -- sonst waere die ganze Uebung ein Zwischenfilm ohne
// Physik dahinter (siehe Machbarkeitspruefung, BACKLOG.md).
import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
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

// Seit 0.6.4 ueberspringt die Uebung nichts mehr: zwischen Schichtuebernahme
// und Auslaufbeginn liegen rund 3400 wirklich gerechnete Sekunden statt der
// 1200 von vorher (die fehlende halbe Stunde machte bis dahin ein Uhrensprung
// wett). Alle Zeitbudgets hier zielen deshalb auf diese Groessenordnung.
const TO_PUMPS_S = 2600;
const TO_COASTDOWN_S = 3400;
// Bis zur Zerstoerung selbst noch einmal ein Stueck weiter -- sie faellt rund
// 40 s nach dem Auslaufbeginn.
const TO_END_S = 3600;

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
  advanceTo({ engine, session }, 3, TO_PUMPS_S);
  assert.equal(tut.index, 3, `recover step did not complete (n=${(s.n * 100).toFixed(2)}%, orm=${engine.derive().orm.toFixed(1)})`);

  // 3 pumps -- KEIN Handgriff mehr: seit dem Vorfuehrmodus schaltet das
  // Drehbuch die beiden zusaetzlichen Pumpen selbst zu (AUTO_PUMPS_S). Dass
  // hier nichts gestartet wird, IST der Test.
  assert.equal(c.mcp.filter(p => p.running).length, 6, 'six pumps before the script acts');
  let pumpGuard = 0;
  while (tut.index === 3 && pumpGuard < Math.round(TO_PUMPS_S / DT)) { step({ engine, session }, 1); pumpGuard++; }
  assert.equal(tut.index, 4, 'pumps step did not complete');
  assert.equal(c.mcp.filter(p => p.running && p.speed >= 0.9).length, 8);
  // Und der Auslauf laeuft hier noch NICHT -- er haengt seit 0.6.1 am Ende
  // von 'hold', nicht mehr am Ende von 'pumps'.
  assert.equal(s.tgCoasting, false, 'coastdown must not start with the pumps any more');
  assert.equal(s.tgSpeed, 1, 'the turbogenerator is still on the grid here');

  // 4 hold -- die zweite Haelfte der Haltephase, jetzt mit acht Pumpen. Ihre
  // Dauer steht nicht fest, sondern zielt auf die Uhr (siehe holdSeconds()).
  advanceTo({ engine, session }, 5, TO_COASTDOWN_S);
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

// Die zweite Zeitanzeige (siehe chernobylTutorial.js: WALL_HANDOVER_S). Sie
// ist eine Behauptung ueber die Nacht -- "AZ-5 um 01:23:40" steht sogar im
// Schritttext (tut_chernobyl_az5_instruction) -- und gehoert deshalb
// nachgemessen, nicht nur hingeschrieben. Aendert sich eine der Drehbuchzeiten
// (Haltephase, Pumpenhochlauf, AUTO_SCRAM_S), faellt dieser Test um, nicht die
// Glaubwuerdigkeit der Anzeige.
//
// Seit 0.6.4 gibt es keinen Uhrensprung mehr: die Uhr ist die Betriebszeit
// plus einem festen Versatz, von der Schichtuebernahme bis zur Zerstoerung.
// Genau das prueft dieser Test jetzt zusaetzlich -- an jeder Marke, nicht nur
// am Ende.
const WALL_HANDOVER = 27 * 60;            // 00:27:00
const WALL_PUMPS = 1 * 3600 + 7 * 60;     // 01:07:00
const WALL_TEST = 1 * 3600 + 23 * 60 + 4; // 01:23:04
const WALL_AZ5 = 1 * 3600 + 23 * 60 + 40; // 01:23:40
test('the clock runs 1:1 and hits the historical marks: pumps 01:07, test 01:23:04, AZ-5 01:23:40', t => {
  const { engine, session } = boot();
  const s = engine.state;
  const tut = session.tutorial;
  const hms = (sec) => new Date(Math.round(sec) * 1000).toISOString().slice(11, 19);

  // 0 handover -- die Uhr laeuft mit festem Versatz zur Betriebszeit:
  // Schichtuebernahme um 00:27, kurz vor dem Einbruch.
  step({ engine, session }, Math.round(6 / DT));
  assert.equal(tut.view().wall, s.t_sim + WALL_HANDOVER);
  assert.equal(engine.ctx.wallClock, WALL_HANDOVER);
  assert.ok(tut.confirmInspect());

  // 1 dip -- bis 0.6.2 sprang die Uhr an dieser Stelle um gut eine halbe
  // Stunde vor. Jetzt laeuft sie durch: der Einbruch beginnt kurz nach 00:28,
  // die Erholung danach wird wirklich gefahren (siehe holdSeconds()).
  const beforeDip = tut.view().wall;
  assert.ok(beforeDip >= WALL_HANDOVER && beforeDip < WALL_HANDOVER + 600,
    `the shift starts shortly before the dip at 00:28, got ${hms(beforeDip)}`);
  let dipGuard = 0;
  while (tut.index === 1 && dipGuard < Math.round(600 / DT)) { step({ engine, session }, 1); dipGuard++; }
  assert.equal(tut.index, 2, 'dip step did not complete');
  const afterDip = tut.view().wall;
  assert.equal(afterDip, s.t_sim + WALL_HANDOVER,
    `no jump any more: the clock stays operating time plus the shift, got ${hms(afterDip)}`);
  assert.ok(afterDip < WALL_HANDOVER + 600,
    `the dip ends shortly after 00:28, got ${hms(afterDip)}`);
  assert.equal(tut.completed.at(-1).w, tut.completed.at(-1).t + WALL_HANDOVER,
    'every step entry carries the same offset -- there is no hour to bridge any more');
  assert.equal(tut.completed[0].w, tut.completed[0].t + WALL_HANDOVER);

  // Speichern/Laden: ohne den Versatz im Snapshot liefe die Uhr nach dem Laden
  // wieder ab Mitternacht, waehrend die Schrittliste schon 01:04 zeigt.
  const blob = JSON.parse(JSON.stringify(pack(engine, DEF.id, session.run, session)));
  const reEngine = createEngine(rbmk, { seed: DEF.seed });
  const reSession = new Session(reEngine, DEF);
  reSession.start();
  assert.equal(apply(blob, reEngine, reSession.run, reSession), null);
  assert.equal(reSession.tutorial.view().wall, tut.view().wall, 'the clock must survive a save/reload');
  assert.equal(reEngine.ctx.wallClock, engine.ctx.wallClock,
    'the status-tile channel (ctx.wallClock) must be republished after a load');

  // Die Pumpenzuschaltung ist die zweite dokumentierte Marke -- bis 0.6.0
  // zeigte sie 01:23:25, weil der Pumpenschritt hinter der GANZEN Haltephase
  // stand. Seit die Haltephase an dieser Stelle geteilt ist, faellt sie auf
  // die historische Minute.
  let pumpGuard = 0;
  const pumpLimit = Math.round(TO_PUMPS_S / DT);
  while (engine.ctx.mcp.filter(p => p.running).length < 8 && pumpGuard < pumpLimit) {
    step({ engine, session }, 1); pumpGuard++;
  }
  const pumpsOn = tut.view().wall;
  assert.ok(Math.abs(pumpsOn - WALL_PUMPS) <= 2,
    `the two extra pumps should start on 01:07:00, got ${hms(pumpsOn)}`);
  assert.equal(pumpsOn, s.t_sim + WALL_HANDOVER,
    'and they get there by running, not by a jump');

  // Ab hier laeuft die Uhr 1:1 mit -- durch die zweite Haelfte der Haltephase
  // und den Auslauf bis zum Knopfdruck.
  let guard = 0;
  const limit = Math.round(TO_COASTDOWN_S / DT);
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
  t.diagnostic(`dip ${hms(afterDip)} · pumps ${hms(pumpsOn)} · AZ-5 ${hms(az5)} `
    + `· destroyed ${hms(end)}`);
});

// ── Speisewasserschwall um 01:19 ────────────────────────────────────────────
//
// Historisch die einzige Handlung zwischen Pumpenzuschaltung und Versuch. Die
// Wirkkette gab es in rbmk.js laengst (mehr kaltes Speisewasser -> mehr
// Unterkuehlung -> weniger Dampfblasen -> negative Reaktivitaet); neu ist nur,
// dass die Uebung sie faehrt. Geprueft wird beides: dass der Schwall wirkt --
// und dass die Anlage danach wieder so in den Versuch geht wie vorher, denn
// darauf ist die AZ-5-Wirkung kalibriert.

const WALL_SURGE = 1 * 3600 + 19 * 60;    // 01:19:00

test('the feedwater surge at 01:19 is really driven -- and the test still starts from the same plant', t => {
  const f = boot();
  const { engine, session } = f;
  const s = engine.state;
  const tut = session.tutorial;
  const fw = engine.ctx.fwCtl;
  const hms = (sec) => new Date(Math.round(sec) * 1000).toISOString().slice(11, 19);

  step(f, Math.round(6 / DT));
  assert.ok(tut.confirmInspect());

  // Bis kurz vor den Schwall -- dort steht die Anlage ruhig auf ihrem
  // Haltezustand.
  let guard = 0;
  const limit = Math.round(TO_COASTDOWN_S / DT);
  while (tut.view().wall < WALL_SURGE - 5 && guard < limit) { step(f, 1); guard++; }
  assert.equal(tut.steps[tut.index], 'hold', 'the surge belongs into the second half of the hold');
  const before = { sub: s.dTsub, void: s.alphaBar, fw: s.W_fw, level: s.L_drum, n: s.n };
  assert.equal(fw.auto, true, 'feedwater is on automatic before the surge');

  // Der Schwall selbst.
  while (fw.auto && guard < limit) { step(f, 1); guard++; }
  const started = tut.view().wall;
  assert.ok(Math.abs(started - WALL_SURGE) <= 2,
    `the surge should start on 01:19:00, got ${hms(started)}`);
  assert.ok(fw.manual > 0.1, `feedwater goes to hand, got ${fw.manual}`);
  assert.equal(tut.hint(), 'tut_chernobyl_hint_feed_surge',
    'while it runs, the hint says what is happening');
  assert.ok(engine.ctx.log.some(e => e.key === 'event_chernobyl_feed_surge'),
    'the surge belongs into the timeline, not only into the numbers');

  // Speichern/Laden mitten im Schwall: ohne die beiden Merker im Snapshot
  // finge er nach dem Laden wieder von vorn an.
  const blob = JSON.parse(JSON.stringify(pack(engine, DEF.id, session.run, session)));
  const reEngine = createEngine(rbmk, { seed: DEF.seed });
  const reSession = new Session(reEngine, DEF);
  reSession.start();
  assert.equal(apply(blob, reEngine, reSession.run, reSession), null);
  assert.equal(reSession.tutorial.hint(), 'tut_chernobyl_hint_feed_surge',
    'a save taken during the surge comes back inside it');

  let subMax = s.dTsub;
  let voidMin = s.alphaBar;
  let levelMax = s.L_drum;
  let nMin = s.n;
  while (!fw.auto && guard < limit) {
    step(f, 1); guard++;
    subMax = Math.max(subMax, s.dTsub);
    voidMin = Math.min(voidMin, s.alphaBar);
    levelMax = Math.max(levelMax, s.L_drum);
    nMin = Math.min(nMin, s.n);
  }
  // Wirkung, nicht Behauptung: Unterkuehlung hoch, Blasen weg, Leistung sackt.
  // Gemessen wird gegen den Zustand DAVOR, nicht gegen feste Zahlen: auf
  // welchem Niveau die Haltephase laeuft, haengt daran, welche Leistung die
  // Anlage bei der Schichtuebernahme hatte (siehe _triggerDip: der Sollwert
  // ist der Wert von damals) -- gemessen zwischen 6,4 und 7,4 %.
  assert.ok(subMax > before.sub + 1, `subcooling must climb, ${before.sub} -> ${subMax}`);
  assert.ok(voidMin < before.void / 2, `voids must collapse, ${before.void} -> ${voidMin}`);
  assert.ok(nMin < before.n - 0.002,
    `power dips while the voids go, ${(before.n * 100).toFixed(2)} -> ${(nMin * 100).toFixed(2)}%`);
  // Und der Trommelpegel bleibt unter der Meldung "hoch" (rbmk.js: 0,78 m).
  assert.ok(levelMax < 0.78, `drum level must stay below the alarm, got ${levelMax}`);

  // Die zweite Haelfte des Vorgangs faehrt die Automatik: sie nimmt den
  // Speisestrom zurueck, um den Pegel wieder auf den Sollwert zu bringen, die
  // Blasen kommen wieder, und die Leistung schwingt kurz ueber den
  // Ausgangswert. Auch das steht so in den Aufzeichnungen der Nacht -- die
  // Kopplung laeuft in beide Richtungen.
  let nMax = s.n;
  let voidMax = s.alphaBar;
  const after = tut.view().wall + 90;
  while (tut.view().wall < after && guard < limit) {
    step(f, 1); guard++;
    nMax = Math.max(nMax, s.n);
    voidMax = Math.max(voidMax, s.alphaBar);
  }
  assert.ok(nMax > before.n + 0.002,
    `power swings back up after the cutback, ${(before.n * 100).toFixed(2)} -> ${(nMax * 100).toFixed(2)}%`);
  assert.ok(voidMax > before.void * 1.3, `voids overshoot, ${before.void} -> ${voidMax}`);

  // Beim Auslaufbeginn steht die Anlage wieder da, wo sie ohne den Schwall
  // stuende -- sonst waere die AZ-5-Wirkung eine andere Messung.
  while (tut._runbackT0 == null && guard < limit) { step(f, 1); guard++; }
  assert.ok(Math.abs(s.alphaBar - before.void) < 0.005,
    `voids are back at the test, ${before.void} -> ${s.alphaBar}`);
  assert.ok(Math.abs(s.L_drum - before.level) < 0.05,
    `drum level is back at the test, ${before.level} -> ${s.L_drum}`);
  assert.equal(fw.auto, true, 'feedwater is back on automatic for the test');

  while (session.phase === PHASE.RUNNING && guard < limit) { step(f, 1); guard++; }
  assert.equal(s.destroyed, true, 'the surge must not cost the exercise its outcome');
  const end = s.t_sim + engine.ctx.wallClock;
  assert.ok(Math.abs(end - (WALL_AZ5 + 5)) <= 5, `destruction near 01:23:45, got ${hms(end)}`);
  t.diagnostic(`surge ${hms(started)} · subcooling ${before.sub.toFixed(1)} -> ${subMax.toFixed(1)} K `
    + `· voids ${(before.void * 100).toFixed(2)} -> ${(voidMin * 100).toFixed(2)} -> ${(voidMax * 100).toFixed(2)} % `
    + `· power ${(nMin * 100).toFixed(2)} / ${(before.n * 100).toFixed(2)} / ${(nMax * 100).toFixed(2)} % `
    + `· level max ${levelMax.toFixed(2)} m · destroyed ${hms(end)}`);
});

// ── Nachlauf: was nach dem Brennstoffversagen noch gerechnet wird ───────────
//
// Bis 0.6.4 endete das Modell mit `destroyed`, und der Endbildschirm sagte
// "Brennstoff zerstoert". Die Nacht des 26. April endete aber nicht damit,
// sondern mit einem abgehobenen Deckel. Gerechnet wird deshalb der eine
// Schritt, den der eigene Zustand hergibt -- eine Energiebilanz (engine.js:
// startAftermath). Dieser Test prueft, dass jede Zahl darin WIRKLICH aus
// Zustand und Datenblatt kommt und nicht danebengeschrieben ist.

test('the aftermath is computed from the plant state, not written down', t => {
  const f = boot();
  const { engine, session } = f;
  const s = engine.state;
  const tut = session.tutorial;
  const sp = engine.spec;
  const cfg = sp.aftermath;

  step(f, Math.round(6 / DT));
  assert.ok(tut.confirmInspect());
  let guard = 0;
  const limit = Math.round(TO_END_S / DT);
  while (!s.destroyed && guard < limit) { step(f, 1); guard++; }
  assert.equal(s.destroyed, true);

  // Bei einer schnellen Exkursion faellt die ZUWACHS-Grenze zuerst, nicht die
  // 963 J/g. Der Endbildschirm sagt seither Huellrohrversagen statt
  // Brennstoffzerlegung -- die kleinere, richtige Aussage.
  assert.equal(s.destroyedKey, 'event_fuel_failure');
  assert.ok(s.enthalpy < 963, `${s.enthalpy} J/g is below the dispersal limit`);

  const a = s.aftermath;
  assert.ok(a, 'the RBMK knows an aftermath (spec.aftermath)');
  assert.ok(Math.abs(a.t0 - s.t_sim) <= 2 * DT,
    `it starts in the step the fuel fails, off by ${(s.t_sim - a.t0).toFixed(3)} s`);
  assert.equal(a.done, false, 'and it is not over in the same instant');

  // Nachgerechnet, nicht nachgelesen: Hubarbeit und Hubdruck folgen aus
  // Masse, Durchmesser und Hubhoehe im Datenblatt.
  const mLid = cfg.lid.mass_t * 1000;
  const area = Math.PI * (cfg.lid.diameter_m / 2) ** 2;
  assert.ok(Math.abs(a.work_J - mLid * 9.81 * cfg.lid.lift_m) < 1);
  assert.ok(Math.abs(a.lift_bar - (mLid * 9.81) / area / 1e5) < 1e-9);
  assert.ok(a.lift_bar > 0.8 && a.lift_bar < 0.95,
    `2000 t on 17 m lift at about 0.86 bar, got ${a.lift_bar}`);
  assert.ok(Math.abs(a.share - a.work_J / a.energy_J) < 1e-12);
  // Und die Energie ist die im Brennstoff ueber der Saettigung -- mehr kann
  // beim Zerlegen nicht an das Wasser uebergehen.
  assert.ok(a.energy_J > 0 && a.energy_J < sp.fuel.mass_t * 1000 * sp.fuel.cp * s.T_f);
  assert.ok(a.steam_kg > 0 && a.steam_kg <= a.water_kg,
    'more steam than there is water would be nonsense');

  // Zwei Simulationssekunden spaeter hebt der Deckel ab -- weil ein Prozent
  // Umsetzung genuegt und zwei angenommen sind. Gestept wird ab hier die
  // ENGINE, nicht die Runde: die ist mit der Zerstoerung vorbei, waehrend die
  // Anlage im Bild noch weiterlaeuft (main.js: DESTROY_PAUSE_MS).
  const before = engine.ctx.log.length;
  for (let i = 0; i < Math.round(30 / DT) && !a.done; i++) engine.step(DT);
  const waited = s.t_sim - a.t0;
  assert.ok(waited >= cfg.lid_delay_s && waited <= cfg.lid_delay_s + 3 * DT,
    `the lid goes ${cfg.lid_delay_s} s after the failure, waited ${waited.toFixed(3)} s`);
  assert.equal(a.lid, true, `share ${a.share} must be below conversion ${cfg.conversion}`);
  assert.ok(engine.ctx.log.slice(before).some(e => e.key === 'event_lid_lifted'),
    'the lid belongs into the timeline, not only into the end screen');
  t.diagnostic(`${(a.energy_J / 1e9).toFixed(1)} GJ over saturation · `
    + `${(a.steam_kg / 1000).toFixed(1)} t of ${(a.water_kg / 1000).toFixed(1)} t flashed · `
    + `lift ${(a.work_J / 1e6).toFixed(0)} MJ = ${(a.share * 100).toFixed(2)} % · `
    + `${a.lift_bar.toFixed(2)} bar`);
});

test('a shield that needs more than the assumed conversion stays on', () => {
  // Die einzige Annahme im Nachlauf ist der Umsetzungsgrad. Dass sie WIRKT --
  // und nicht nur danebensteht -- zeigt sich, wenn man sie unter den
  // gerechneten Bedarf drueckt: dann hebt derselbe Deckel nicht ab.
  const cfg = rbmk.spec.aftermath;
  const keep = cfg.conversion;
  cfg.conversion = 1e-6;
  try {
    const f = boot();
    const { engine, session } = f;
    const s = engine.state;
    const tut = session.tutorial;
    step(f, Math.round(6 / DT));
    assert.ok(tut.confirmInspect());
    let guard = 0;
    const limit = Math.round(TO_END_S / DT);
    while (!s.destroyed && guard < limit) { step(f, 1); guard++; }
    assert.equal(s.destroyed, true);
    for (let i = 0; i < Math.round(30 / DT) && !s.aftermath.done; i++) engine.step(DT);
    assert.equal(s.aftermath.done, true);
    assert.equal(s.aftermath.lid, false);
    assert.ok(engine.ctx.log.some(e => e.key === 'event_lid_held'));
    assert.ok(!engine.ctx.log.some(e => e.key === 'event_lid_lifted'));
  } finally {
    cfg.conversion = keep;
  }
});

// Das Bild muss den Zustand auch zeigen koennen: mimic.js haengt Deckel und
// Fahne an `data-aftermath` auf der SVG-Wurzel, mimic.css macht sie darueber
// sichtbar. Ein Schreibfehler auf einer der beiden Seiten faellt sonst erst
// im Browser auf -- und dort genau einmal, naemlich zu spaet.
test('the flow diagram has the parts the aftermath switches on', () => {
  const js = readFileSync(new URL('../static/js/ui/mimic.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../static/css/mimic.css', import.meta.url), 'utf8');
  for (const cls of ['rs-lid', 'rs-plume', 'rs-breach']) {
    assert.ok(js.includes(`class: '${cls}`) || js.includes(`'${cls} `),
      `${cls} is drawn in mimic.js`);
    assert.ok(css.includes(`.${cls}`), `${cls} is styled in mimic.css`);
  }
  assert.ok(js.includes("setAttr(root, 'data-aftermath'"), 'the root carries the state');
  assert.ok(css.includes('svg[data-aftermath="lid"]'), 'and the stylesheet reads it');
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

test('the exercise drives the time factor: fast through the holds, real time for the coastdown, slow motion for AZ-5', t => {
  const f = boot();
  const { engine, session } = f;
  const s = engine.state;
  const tut = session.tutorial;
  // Vor der Schichtuebernahme und waehrend des Einbruchs entscheidet der
  // Spieler -- der Einbruch ist der Teil, den man sehen soll.
  assert.equal(tut.speedHint, null);

  step(f, Math.round(6 / DT));
  assert.ok(tut.confirmInspect());
  assert.equal(tut.speedHint, null, 'the dip itself runs at whatever the player chose');

  // Die lange Erholung: hoechster Zeitraffer, sonst sitzt der Spieler eine
  // halbe Stunde vor einer ruhigen Anzeige (seit 0.6.4 wird sie gerechnet).
  advanceTo(f, 2, 600);
  assert.equal(tut.steps[tut.index], 'recover');
  assert.equal(tut.speedHint, 60, 'the recovery hold asks for the highest time factor');

  // Die Pumpenzuschaltung um 01:07 gehoert gesehen -- der Schritttext bittet
  // ausdruecklich darum, dem Kernstrom zuzusehen.
  let guard = 0;
  const limit = Math.round(TO_COASTDOWN_S / DT);
  while (tut.speedHint === 60 && guard < limit) { step(f, 1); guard++; }
  assert.equal(tut.steps[tut.index], 'pumps');
  assert.equal(tut.speedHint, 1, 'the pumps come on in real time');

  // Danach wieder Zeitraffer, bis der Speisewasserschwall um 01:19 kommt --
  // die einzige Handlung in den Haltephasen, bei 60x ein Wimpernschlag.
  while (tut.speedHint === 1 && guard < limit) { step(f, 1); guard++; }
  assert.equal(tut.speedHint, 60, 'the second half of the hold is fast again');
  while (tut.speedHint === 60 && guard < limit) { step(f, 1); guard++; }
  assert.equal(tut.speedHint, 4, 'the surge is shown at a speed one can follow');
  assert.equal(tut.steps[tut.index], 'hold');
  assert.ok(engine.ctx.log.some(e => e.key === 'event_chernobyl_feed_surge'));

  // Danach wieder Zeitraffer bis zum Testbeginn.
  while (tut.speedHint === 4 && guard < limit) { step(f, 1); guard++; }
  assert.equal(tut.speedHint, 60, 'after the surge the hold is fast again');

  // Der Auslauf selbst laeuft in Echtzeit ...
  while (tut._runbackT0 == null && guard < limit) { step(f, 1); guard++; }
  assert.equal(tut.speedHint, 1, 'the coastdown runs in real time');

  // ... und kurz vor dem Knopfdruck schaltet die Uebung auf Zeitlupe: im
  // Vorfuehrmodus koennte der Spieler den Moment sonst nicht sehen, und die
  // Stellteile sind ohnehin gesperrt.
  while (tut.speedHint === 1 && guard < limit) { step(f, 1); guard++; }
  const since = s.t_sim - tut._runbackT0;
  const SLOWMO = tut.speedHint;
  assert.ok(typeof SLOWMO === 'number' && SLOWMO > 0 && SLOWMO < 1,
    `slow motion must be a real factor below 1, got ${SLOWMO}`);
  assert.ok(since > 25 && since < 36,
    `slow motion should start a few seconds before AZ-5 at t+36s, got t+${since.toFixed(1)}s`);
  assert.equal(s.scram.active, false, 'the switch must land BEFORE the press, not inside it');

  // Und am Ende bleibt es langsam: die Runde endet nicht damit, dass die
  // Uebung ihren letzten Schritt abhakt, sondern damit, dass der Kern
  // zerstoert ist (RunState.checkFail greift vor tutorial.done). Genau
  // dieser Nachlauf ist der Teil, den man sehen soll.
  while (session.phase === PHASE.RUNNING && guard < limit) { step(f, 1); guard++; }
  assert.equal(s.destroyed, true);
  assert.equal(tut.done, false, 'the physics ended the round, not the step list');
  assert.equal(tut.speedHint, SLOWMO, 'the last seconds stay in slow motion');
  t.diagnostic(`slow motion from t+${since.toFixed(1)}s after the coastdown started`);
});

// Der zweite Befund, den der Abschlusstext dem Spieler als Tatsache hinstellt
// (tut_chernobyl_debrief_note). Er hat sich mit dem echten Rotorauslauf
// GEAENDERT und gehoert deshalb erst recht in einen Test:
//
//   frueher (Rampe auf null): die Anlage lief schon ohne AZ-5 sichtbar auf
//   133 % hoch -- unhistorisch, real blieb die Leistung flach.
//   jetzt (vier Pumpen bleiben am Netz): ohne AZ-5 bleibt die ANZEIGE ruhig
//   bei rund 7 %. Dass darunter trotzdem Reaktivitaet aufgebaut wird, haelt
//   der Test 'flat power before AZ-5 is a balance' fest.
//
// Was geblieben ist: ohne den schmalen AR-Trimm zerstoert sich dieselbe
// Anlage auch ohne jeden Knopfdruck.
test('the debrief note must stay true: power flat without AZ-5, destroyed without the trim', t => {
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
    advanceTo({ engine, session }, 5, TO_COASTDOWN_S);
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

  // 1) Ohne AZ-5 bleibt die Leistung bei ihren 7 % -- so, wie die
  //    Aufzeichnungen der Nacht es beschreiben. Was darunter liegt, misst
  //    der Test 'flat power before AZ-5 is a balance'.
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

// Der Punkt, an dem sich "flache Leistung" und "ruhige Anlage" trennen.
//
// Ohne AZ-5 bleibt die Leistung bei rund 7 %. Daraus zu schliessen, vor dem
// Knopfdruck sei nichts passiert, waere falsch -- und genau diese
// Fehldeutung soll der Abschlusstext nicht stuetzen. Gemessen wird deshalb,
// was unter der flachen Anzeige liegt.
test('flat power before AZ-5 is a balance, not calm -- void rises while the trim holds', t => {
  const { engine, session } = boot();
  const s = engine.state; const c = engine.ctx; const tut = session.tutorial;
  engine.scram = () => {};      // nur das Drehbuch aushebeln
  step({ engine, session }, Math.round(6 / DT));
  tut.confirmInspect();
  advanceTo({ engine, session }, 5, TO_COASTDOWN_S);

  const voidStart = s.alphaBar;
  const nStart = s.n;
  let guard = 0;
  while ((s.t_sim - tut._runbackT0) < 36 && session.phase === PHASE.RUNNING
    && guard < Math.round(120 / DT)) { step({ engine, session }, 1); guard++; }

  // 1) Der Dampfblasenanteil steigt deutlich -- die Reaktivitaet baut sich auf.
  assert.ok(s.alphaBar > voidStart * 1.2,
    `void must grow during the coastdown: ${(voidStart * 100).toFixed(2)}% -> ${(s.alphaBar * 100).toFixed(2)}%`);
  // 2) Die Regelgruppe haelt dagegen, bis in die Naehe ihres Anschlags.
  const trim = (s.rho_ext || 0) * 1e5;
  assert.ok(trim < -60, `the trim must be pushing back hard, got ${trim.toFixed(0)} pcm`);
  // 3) Und deshalb -- nur deshalb -- steht die Leistungsanzeige still.
  assert.ok(Math.abs(s.n - nStart) < 0.005,
    `power should stay flat: ${(nStart * 100).toFixed(2)}% -> ${(s.n * 100).toFixed(2)}%`);
  assert.equal(s.destroyed, false);
  t.diagnostic(`t+36s: void ${(voidStart * 100).toFixed(2)}% -> ${(s.alphaBar * 100).toFixed(2)}%, `
    + `trim ${trim.toFixed(0)} pcm, power ${(s.n * 100).toFixed(2)}%`);
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
    advanceTo({ engine, session }, 5, TO_COASTDOWN_S);
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
  advanceTo({ engine, session }, 3, TO_PUMPS_S);
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
    advanceTo({ engine, session }, 6, TO_COASTDOWN_S);
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
