// Netzleitstelle: Aufträge mit Frist und Haltefenster.
//
// Zwei Dinge müssen stimmen, und sie hängen zusammen. Erstens: der Auftrag
// ist kein zweiter Schreiber auf s.P_demand, sondern dieselbe Quelle wie der
// Fahrplan -- an keinem Übergang darf etwas springen. Zweitens: er muss
// FAHRBAR sein. Eine Zusage, die die Anlage nicht halten kann, ist kein
// Schwierigkeitsgrad, sondern ein kaputter Auftrag.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngine } from '../static/js/sim/engine.js';
import { getPlant } from '../static/js/plants/index.js';
import { Session, freeDemandFrac } from '../static/js/game/session.js';
import { Dispatch, DISPATCH_LEVELS, DISPATCH_LEVEL_IDS, dispatchLevel } from '../static/js/game/dispatch.js';
import { ShiftLog, SHIFT_SECONDS } from '../static/js/game/shift.js';
import { pack, apply } from '../static/js/net/persist.js';
import { readFileSync } from 'node:fs';

const DT = 0.05;

function freeRun(reactor = 'pwr', level = 'normal', seed = 4711) {
  const engine = createEngine(getPlant(reactor), { n: 1.0 });
  const session = new Session(engine, null, { faults: 'off', dispatch: level, dispatchSeed: seed });
  session.start();
  return { engine, session };
}

/** Spielschicht ohne Physik weiterdrehen -- die Leitstelle liest nur den
 *  Zustand. `pe` stellt die Klemmenleistung, damit sich Halten und
 *  Bandverletzung prüfen lassen, ohne einen Reaktor zu fahren. */
function advance(engine, session, seconds, { step = 10, pe = null } = {}) {
  for (let done = 0; done < seconds; done += step) {
    engine.state.t_sim += step;
    if (pe) engine.state.P_e = pe(engine.state);
    session.step(step, [], 0);
  }
}

/** Bis der Auftrag eine bestimmte Phase erreicht, höchstens `limit` Sekunden. */
function until(engine, session, predicate, { limit = 40000, step = 10, pe = null } = {}) {
  for (let done = 0; done < limit; done += step) {
    if (predicate(session.dispatch.view())) return true;
    advance(engine, session, step, { step, pe });
  }
  return predicate(session.dispatch.view());
}

const orders = (engine) => engine.ctx.log.filter((e) => String(e.key).startsWith('log_order_'));

test('Stufen: aus bleibt aus, unbekanntes fällt auf aus zurück', () => {
  assert.equal(DISPATCH_LEVELS.off, null);
  assert.equal(dispatchLevel('gibtsnicht'), null);
  assert.ok(DISPATCH_LEVEL_IDS.includes('off'));
  const { engine, session } = freeRun('pwr', 'off');
  assert.equal(session.dispatch.active, false);
  advance(engine, session, 40000, { step: 60 });
  assert.deepEqual(orders(engine), []);
  assert.equal(session.dispatch.view(), null);

  const bogus = new Dispatch(engine, 'gibtsnicht', 1, session.run);
  assert.equal(bogus.active, false);
});

test('Ein Auftrag kommt, kündigt sich an und nennt seine Frist', () => {
  const { engine, session } = freeRun();
  // In der Einfahrzeit passiert nichts.
  advance(engine, session, DISPATCH_LEVELS.normal.grace - 60, { step: 60 });
  assert.deepEqual(orders(engine), [], 'Auftrag in der Einfahrzeit');

  assert.ok(until(engine, session, (v) => v !== null), 'gar kein Auftrag');
  const announced = orders(engine);
  assert.equal(announced.length, 1);
  assert.equal(announced[0].key, 'log_order_new');
  assert.ok(announced[0].params.mw > 0);
  assert.match(announced[0].params.time, /^\d{2}:\d{2}$/);
  assert.ok(announced[0].params.min >= 15 && announced[0].params.min <= 45);

  const v = session.dispatch.view();
  assert.equal(v.state, 'lead');
  // Der Vorlauf ist der Sinn der Ankuendigung: waehrend seiner fuehrt noch
  // der Fahrplan, die Anforderung darf sich nicht schon bewegen.
  assert.equal(session.dispatch.targetMw(1234), null);
});

test('Der Auftrag bleibt im zulässigen Band und weit genug vom Fahrplan weg', () => {
  // Sonst ist er entweder unerfuellbar (zu hoch, siehe game/season.js) oder
  // kein Auftrag, sondern Rauschen (zu nah am aktuellen Wert).
  for (const reactor of ['pwr', 'bwr', 'rbmk']) {
    for (let seed = 1; seed <= 6; seed++) {
      const { engine, session } = freeRun(reactor, 'normal', seed * 97);
      const p0 = engine.spec.P0_e;
      let seen = 0;
      for (let round = 0; round < 3; round++) {
        assert.ok(until(engine, session, (v) => v !== null && v.id === seen + 1),
          `${reactor}/${seed}: Auftrag ${seen + 1} kam nicht`);
        const v = session.dispatch.view();
        seen = v.id;
        const frac = v.mw / p0;
        assert.ok(frac >= 0.40 - 1e-9 && frac <= 0.92 + 1e-9,
          `${reactor}/${seed}: ${(frac * 100).toFixed(1)} % ausserhalb des Bandes`);
        // Gemessen gegen die Anforderung BEI DER ANKUENDIGUNG -- die steht
        // solange in order.fromMw (der Rampenbeginn ueberschreibt sie erst
        // spaeter, siehe dispatch.js). Gegen einen aelteren Wert zu pruefen
        // hiesse den Fahrplan mitzumessen, der seither weitergelaufen ist.
        assert.equal(v.state, 'lead');
        const announcedAt = session.dispatch.order.fromMw;
        assert.ok(Math.abs(v.mw - announcedAt) >= 0.08 * p0 - 1e-6,
          `${reactor}/${seed}: nur ${Math.round(Math.abs(v.mw - announcedAt))} MW Unterschied`);
        assert.ok(until(engine, session, (w) => w === null || w.id > v.id),
          `${reactor}/${seed}: Auftrag ${v.id} endete nicht`);
      }
    }
  }
});

test('Die Rampe ist langsamer als die Anforderung selbst dürfte', () => {
  // FREE_DEMAND_RAMP_FRAC_PER_S erlaubt 0,2 % je Sekunde -- viermal mehr, als
  // eine Anlage folgen kann. Ein Auftrag, der das ausschoepft, waere unfahrbar.
  const { engine, session } = freeRun();
  const p0 = engine.spec.P0_e;
  assert.ok(until(engine, session, (v) => v !== null));
  const v = session.dispatch.view();
  const o = session.dispatch.order;
  const rampS = o.atT - o.rampStartT;
  const rate = Math.abs(v.mw - engine.state.P_demand) / rampS / p0;
  assert.ok(rate <= 0.03 / 60 + 1e-9, `${(rate * 6000).toFixed(2)} %/min ist zu schnell`);
  assert.ok(rampS >= 120, 'Rampe kuerzer als die Untergrenze');
});

test('Kein Sprung: Fahrplan, Rampe, Halten, Rückfahrt gehen stetig ineinander', () => {
  const { engine, session } = freeRun();
  const p0 = engine.spec.P0_e;
  let prev = engine.state.P_demand;
  let worst = 0;
  // Zwei Aufträge lang jeden Takt die Anforderung beobachten. Die
  // Rampengrenze gilt in JEDER Phase, auch am Übergang -- genau das ist der
  // Punkt an "eine Quelle, zwei Betriebsarten".
  for (let i = 0; i < 20000; i++) {
    engine.state.t_sim += 1;
    engine.state.P_e = engine.state.P_demand;   // perfekter Bediener
    session.step(1, [], 0);
    worst = Math.max(worst, Math.abs(engine.state.P_demand - prev));
    prev = engine.state.P_demand;
  }
  assert.ok(worst <= 0.002 * p0 + 1e-6,
    `Sprung von ${worst.toFixed(2)} MW in einer Sekunde`);
  assert.ok(session.dispatch.count >= 2, 'zu wenige Auftraege fuer die Probe');
});

test('Wer im Band bleibt, erfüllt -- wer es verlässt, fängt von null an', () => {
  const { engine, session } = freeRun();
  assert.ok(until(engine, session, (v) => v !== null));
  // Perfekter Bediener: Klemmenleistung folgt der Anforderung genau.
  const follow = (s) => s.P_demand;
  assert.ok(until(engine, session, (v) => v.state === 'holding', { pe: follow }));

  // Erst ein Stück halten, dann ausbrechen: die Haltezeit muss auf null fallen.
  advance(engine, session, 300, { pe: follow });
  assert.ok(session.dispatch.view().held > 0);
  advance(engine, session, 30, { pe: (s) => s.P_demand + 200 });
  assert.equal(session.dispatch.view().held, 0, 'Bandverletzung setzt nicht zurueck');

  // Danach durchhalten -- die Nachfrist von 25 % traegt genau diesen Ausrutscher.
  assert.ok(until(engine, session, (v) => v === null || v.state === 'releasing', { pe: follow }));
  assert.equal(session.run.ordersMet, 1, 'Auftrag nicht erfuellt');
  assert.equal(session.run.ordersFailed, 0);
  assert.equal(orders(engine).filter((e) => e.key === 'log_order_met').length, 1);
});

test('Wer nie ins Band kommt, scheitert am Ende des Fensters', () => {
  const { engine, session } = freeRun();
  assert.ok(until(engine, session, (v) => v !== null));
  const off = (s) => s.P_demand + 400;
  assert.ok(until(engine, session, (v) => v.state === 'holding', { pe: off }));
  const o = session.dispatch.order;
  const deadline = o.atT + o.windowS;
  assert.ok(until(engine, session, (v) => v === null || v.state === 'releasing', { pe: off }));
  assert.equal(session.run.ordersFailed, 1);
  assert.equal(session.run.ordersMet, 0);
  assert.ok(engine.state.t_sim >= deadline, 'zu frueh gescheitert');
  assert.equal(orders(engine).filter((e) => e.key === 'log_order_failed').length, 1);
});

test('Die Nachfrist trägt nicht beliebig viel', () => {
  // Gefordert ist die UNGEBROCHENE Haltezeit. Wer alle zwei Minuten
  // ausbricht, sammelt nie holdS zusammen und scheitert -- sonst waere das
  // Fenster eine Summe statt einer Zusage.
  const { engine, session } = freeRun();
  assert.ok(until(engine, session, (v) => v !== null));
  let flip = 0;
  const flaky = (s) => (Math.floor(flip++ / 12) % 2 === 0 ? s.P_demand : s.P_demand + 300);
  assert.ok(until(engine, session, (v) => v === null || v.state === 'releasing', { pe: flaky }));
  assert.equal(session.run.ordersFailed, 1);
});

test('Eine Schnellabschaltung zieht den Auftrag zurück, statt ihn zu verlieren', () => {
  // Dieselbe Ausnahme wie bei der Fehlbedingung grid_deviation: wer auf eine
  // Ausloesemeldung hin richtig abschaltet, darf dafuer nicht bestraft werden.
  const { engine, session } = freeRun();
  assert.ok(until(engine, session, (v) => v !== null));
  assert.ok(until(engine, session, (v) => v.state === 'holding', { pe: (s) => s.P_demand }));
  engine.scram('test');
  advance(engine, session, 60);
  assert.equal(session.dispatch.view(), null, 'Auftrag laeuft trotz RESA weiter');
  assert.equal(session.run.ordersFailed, 0, 'RESA als Scheitern gezaehlt');
  assert.equal(session.run.ordersMet, 0);
  assert.equal(orders(engine).filter((e) => e.key === 'log_order_cancelled').length, 1);

  // Und nach dem Wiederanlauf beginnt die Einfahrzeit von vorn, wie bei den
  // Stoerungen -- kein Auftrag direkt in den Wiederanlauf hinein.
  engine.state.scram.active = false;
  const back = engine.state.t_sim;
  advance(engine, session, DISPATCH_LEVELS.normal.grace - 120, { step: 60 });
  assert.equal(session.dispatch.view(), null, 'Auftrag direkt nach dem Wiederanlauf');
  assert.ok(session.dispatch.nextT >= back + DISPATCH_LEVELS.normal.grace);
});

test('Bei offenem Schalter kommt kein Auftrag', () => {
  // Ohne Netzanschluss ist die Klemmenleistung null: jede Zusage waere
  // unerfuellbar.
  const { engine, session } = freeRun();
  engine.state.breaker = false;
  advance(engine, session, 40000, { step: 60 });
  assert.deepEqual(orders(engine), []);
});

test('Der Schichtbericht zählt die Aufträge mit', () => {
  const { engine, session } = freeRun();
  const reports = [];
  session.onShift = (r) => reports.push(r);
  session.run.ordersMet = 2;
  session.run.ordersFailed = 1;
  advance(engine, session, SHIFT_SECONDS + 60, { step: 60, pe: (s) => s.P_demand });
  assert.ok(reports.length >= 1);
  const r = reports[0];
  assert.ok(r.orders_total >= 3, `nur ${r.orders_total} Auftraege gezaehlt`);
  assert.ok(r.orders_met >= 2);
  // Und die Protokollzeile nennt sie -- eigener Schluessel, damit eine Runde
  // ohne Auftraege nicht in jeder Schicht "0/0" lesen muss.
  const entry = ShiftLog.logEntry(r);
  assert.equal(entry.key, 'log_shift_report_orders');
  assert.equal(entry.params.total, r.orders_total);
  const quiet = ShiftLog.logEntry({ ...r, orders_met: 0, orders_total: 0 });
  assert.equal(quiet.key, 'log_shift_report');
  assert.equal(quiet.params.total, undefined);
});

test('Ein laufender Auftrag überlebt den Spielstand', () => {
  const { engine, session } = freeRun();
  assert.ok(until(engine, session, (v) => v !== null));
  assert.ok(until(engine, session, (v) => v.state === 'holding', { pe: (s) => s.P_demand }));
  advance(engine, session, 200, { pe: (s) => s.P_demand });
  const before = session.dispatch.view();
  const blob = JSON.parse(JSON.stringify(pack(engine, null, session.run, session)));

  const engine2 = createEngine(getPlant('pwr'), { n: 1.0 });
  const session2 = new Session(engine2, null, { faults: 'off', dispatch: 'normal', dispatchSeed: 4711 });
  session2.start();
  assert.equal(apply(blob, engine2, session2.run, session2), null);
  const after = session2.dispatch.view();
  assert.ok(after, 'Auftrag nach dem Laden verschwunden');
  assert.equal(after.id, before.id);
  assert.equal(after.mw, before.mw);
  assert.equal(after.state, 'holding');
  assert.equal(after.held, before.held);
  // Und die Anforderung wird weiter vom Auftrag gefuehrt, nicht vom Fahrplan.
  assert.equal(session2.dispatch.targetMw(1), before.mw);
});

test('Ein kaputter Auftrag im Spielstand wird verworfen, nicht gefahren', () => {
  const { engine, session } = freeRun();
  const d = session.dispatch;
  for (const broken of [null, {}, 'nein', { state: 'holding' },
    { id: 1, mw: NaN, tolMw: 1, fromMw: 1, rampStartT: 0, atT: 1, holdS: 1, windowS: 1, releaseS: 1, releaseStartT: 0, held: 0, state: 'holding' },
    { id: 1, mw: 1, tolMw: 1, fromMw: 1, rampStartT: 5, atT: 1, holdS: 1, windowS: 1, releaseS: 1, releaseStartT: 0, held: 0, state: 'holding' },
    { id: 1, mw: 1, tolMw: 1, fromMw: 1, rampStartT: 0, atT: 1, holdS: 1, windowS: 1, releaseS: 1, releaseStartT: 0, held: 9, state: 'holding' },
    { id: 1, mw: 1, tolMw: 1, fromMw: 1, rampStartT: 0, atT: 1, holdS: 1, windowS: 1, releaseS: 1, releaseStartT: 0, held: 0, state: 'quatsch' }]) {
    d.restore({ nextT: 10, count: 1, lastT: 0, rng: d.rng.snapshot(), order: broken });
    assert.equal(d.order, null, JSON.stringify(broken));
    assert.equal(d.targetMw(500), null);
  }
  // Die Stufe kommt bewusst NICHT aus dem Stand zurueck: sie wurde fuer diese
  // Runde gewaehlt (gleiche Regel wie FreeFaults.restore()).
  d.restore({ level: 'off', nextT: 10, rng: d.rng.snapshot(), order: null });
  assert.equal(d.levelId, 'normal');
  assert.equal(engine.state.reactor, 'pwr');
  assert.ok(freeDemandFrac(0) > 0);
});

// ── Fahrbarkeit mit echter Physik ───────────────────────────────────────────
//
// Die Prüfungen oben stellen die Klemmenleistung von Hand: sie prüfen die
// Mechanik des Auftrags, nicht die Anlage. Der entscheidende Anspruch an einen
// Auftrag ist aber, dass eine WIRKLICH GERECHNETE Anlage ihn halten kann.
// Sonst ist er kein Schwierigkeitsgrad, sondern ein kaputter Auftrag -- genau
// das, was MAX_FRAC, MIN_FRAC und die langsame Rampe verhindern sollen.
//
// Der Hebel ist je Reaktortyp ein anderer, und das ist keine Unsauberkeit der
// Prüfung, sondern das Regelkonzept:
//
//   DWR   turbinengeführt. Das Regelventil holt sich den Dampf, den die
//         Anforderung verlangt, der Kern zieht nach. Der Auftrag wird ohne
//         jeden Bedienereingriff erfüllt -- gut fürs Netz, aber es heisst
//         auch, dass der Auftrag dem DWR-Spieler nichts abverlangt.
//   RBMK  hält seine Leistung. Der Leistungsregler (ctx.powerCtl) bekommt
//         einen neuen Sollwert, dann fährt er.
//   SWR   hält sie ebenfalls, und der Umwälzstrom allein reicht nicht: solange
//         die Stabregelung auf Automatik die Moderatortemperatur hält, hebt
//         sie die Wirkung wieder auf. Gefahren wird über die Stäbe von Hand.
//
// Die Prüfung fährt deshalb je Typ den Hebel, den ein Bediener dort auch
// nehmen würde, und verlangt nur eines: der erste Auftrag wird erfüllt.

/** Bediener je Typ. Wird alle paar Sekunden Simulationszeit gerufen. */
function operator(reactor, engine) {
  const s = engine.state;
  const p0 = engine.spec.P0_e;
  if (reactor === 'rbmk') {
    if (engine.ctx.powerCtl) {
      engine.ctx.powerCtl.auto = true;
      engine.ctx.powerCtl.setpoint = Math.max(0.2, Math.min(1, s.P_demand / p0));
    }
    return;
  }
  if (reactor === 'bwr') {
    // Proportional auf die Abweichung: zu viel Leistung, Stäbe rein.
    const err = (s.P_e - s.P_demand) / p0;
    s.rodDmd[0] = Math.max(0, Math.min(1, s.rodDmd[0] + 0.02 * err));
  }
  // DWR: nichts. Das Regelventil erledigt es.
}

test('Eine echt gerechnete Anlage hält ihren ersten Auftrag', () => {
  for (const reactor of ['pwr', 'bwr', 'rbmk']) {
    const engine = createEngine(getPlant(reactor), { n: 1.0 });
    const session = new Session(engine, null,
      { faults: 'off', dispatch: 'normal', dispatchSeed: 4711 });
    session.start();
    // Der SWR fährt über die Stäbe, also muss die Stabautomatik aus der Hand
    // genommen werden -- sonst hält sie die Moderatortemperatur und damit die
    // Leistung fest.
    if (reactor === 'bwr') engine.ctx.rodCtl.auto = false;
    let settled = null;
    for (let i = 0; i < 400000 && settled === null; i++) {
      if (i % 100 === 0) operator(reactor, engine);
      engine.step(DT);
      session.step(DT, engine.trips.tiles(), 0);
      const v = session.dispatch.view();
      if (v && v.state === 'releasing') settled = v;
    }
    assert.ok(settled, `${reactor}: kein Auftrag abgeschlossen`);
    assert.equal(session.run.ordersFailed, 0,
      `${reactor}: Auftrag über ${Math.round(settled.mw)} MW nicht zu halten `
      + `(${Math.round(engine.state.P_e)} MW erreicht, Band ±${Math.round(settled.tolMw)} MW)`);
    assert.equal(session.run.ordersMet, 1, `${reactor}: Auftrag nicht erfuellt`);
    assert.equal(engine.state.scram.active, false, `${reactor}: RESA unterwegs`);
    assert.equal(engine.state.destroyed, false, `${reactor}: Anlage verloren`);
  }
});

test('Jeder Reaktortyp hat einen Hilfetext, der sein Stellmittel nennt', () => {
  // Der Auftrag steht im Netz-Panel, aber WAS zu tun ist, steht nur im
  // Hilfetext -- und es ist je Typ etwas anderes. Beim SWR genuegt der
  // Umwaelzstrom nicht, solange die Stabregelung auf Automatik gegenhaelt;
  // darauf kommt von allein niemand. Geprueft wird deshalb, dass es den Text
  // gibt und dass er das richtige Stellmittel benennt.
  const de = JSON.parse(readFileSync(new URL('../locales/de.json', import.meta.url), 'utf-8'));
  const en = JSON.parse(readFileSync(new URL('../locales/en.json', import.meta.url), 'utf-8'));
  for (const table of [de, en]) {
    assert.ok(table.order_help, 'gemeinsamer Hilfetext fehlt');
    for (const id of ['pwr', 'bwr', 'rbmk']) {
      const text = table['order_help_' + id];
      assert.ok(text, `order_help_${id} fehlt`);
      // Jeder Text nennt das Stellmittel SEINES Typs, in Anfuehrungszeichen --
      // test_locales.py prueft zusaetzlich, dass es die Bedienelemente wirklich
      // gibt.
      const lever = { pwr: 'ctl_rod_auto', bwr: 'ctl_rod_auto', rbmk: 'ctl_power_auto' }[id];
      assert.ok(text.includes(table[lever]),
        `order_help_${id} nennt "${table[lever]}" nicht`);
    }
    // Und der SWR-Text muss den Umwaelzstrom ausdruecklich als das NICHT
    // ausreichende Mittel benennen, sonst fehlt genau die Einsicht.
    assert.ok(table.order_help_bwr.includes(table.ctl_recirc));
    assert.ok(table.order_help_bwr.includes(table.ctl_rods));
  }
});
