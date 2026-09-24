// Untersuchung, keine Zusicherung: haengt die Uebung an tau = 15 s und an
// "genau vier der acht Pumpen am auslaufenden Generator"?
//
// Hintergrund: BACKLOG.md, "Die Rotorzeitkonstante ist gesetzt, nicht
// hergeleitet". Herleiten laesst sie sich nicht -- tau = J*w0^2/(2*P0)
// braeuchte die Rotortraegheit von TG-8, und die steht in keiner
// nachschlagbaren Quelle. Was sich messen laesst, ist das Gegenteil einer
// Herleitung und fuer die Uebung mehr wert: haengt das Ergebnis ueberhaupt an
// der Zahl? Bleiben die dokumentierten Zeiten und das AZ-5-Wirkfenster ueber
// einen weiten Bereich stehen, ist tau = 15 s keine Kalibrierung, an der die
// Nacht haengt, sondern eine Einstellung innerhalb eines Plateaus.
//
// Gemessen wird je Einstellung zweierlei:
//
//   1. der GESKRIPTETE Lauf, unveraendert -- drueckt das Drehbuch AZ-5 im
//      dokumentierten Abstand, und zerstoert es den Kern? Mit Uhrzeiten.
//   2. das WIRKFENSTER -- zu welchen Sekunden nach Auslaufbeginn zerstoert
//      AZ-5 den Kern? Entscheidend ist, ob die historischen 36 s drin liegen
//      und wie weit die Raender davon weg sind.
//
// Aufruf: node tests/tools/chernobyl_tau_sweep.mjs [schrittweiteS] [bisS]

import { createEngine } from '../../static/js/sim/engine.js';
import * as rbmk from '../../static/js/plants/rbmk.js';
import { Session, PHASE } from '../../static/js/game/session.js';
import { RBMK_CHERNOBYL_TUTORIAL } from '../../static/js/game/chernobylTutorial.js';

const DT = 0.05;
const DEF = {
  id: 'rbmk_chernobyl', reactor: 'rbmk', tutorial: RBMK_CHERNOBYL_TUTORIAL,
  difficulty: 3, title_key: 'x', brief_key: 'x', duration_s: 7200, seed: 26041986,
  demand: [{ t: 0, mw: 0 }, { t: 7200, mw: 0 }], events: [], fail: [{ type: 'fuel_damage' }],
};

// Die historischen Marken, gegen die gemessen wird (siehe BACKLOG.md).
const WALL_TEST = 1 * 3600 + 23 * 60 + 4;    // 01:23:04 Testbeginn
const WALL_AZ5 = 1 * 3600 + 23 * 60 + 40;    // 01:23:40 AZ-5
const PRESS_HIST = WALL_AZ5 - WALL_TEST;     // 36 s nach Auslaufbeginn

const hms = (sec) => new Date(Math.round(sec) * 1000).toISOString().slice(11, 19);

function boot() {
  const engine = createEngine(rbmk, { seed: DEF.seed });
  const session = new Session(engine, DEF);
  session.start();
  return { engine, session };
}

function one(f) {
  if (f.session.phase !== PHASE.RUNNING) return;
  f.engine.step(DT);
  f.session.step(DT, f.engine.trips.tiles(), 0);
}

/** Den geskripteten Ablauf unveraendert durchlaufen lassen. */
function scripted() {
  const f = boot();
  const { engine, session } = f;
  const s = engine.state;
  const tut = session.tutorial;
  let peak = s.n;
  let az5 = null;
  let ruin = null;
  let confirmed = false;
  const wall = () => s.t_sim + (engine.ctx.wallClock || 0);

  for (let i = 0; i < Math.round(4000 / DT) && session.phase === PHASE.RUNNING; i++) {
    one(f);
    peak = Math.max(peak, s.n);
    if (!confirmed && tut.index === 0 && tut.inspectReady) confirmed = tut.confirmInspect();
    if (az5 === null && s.scram.active) az5 = wall();
    if (ruin === null && s.destroyed) ruin = wall();
  }
  return { peak, az5, ruin, destroyed: s.destroyed };
}

/**
 * AZ-5 zu einem selbst gewaehlten Zeitpunkt nach Auslaufbeginn -- der eigene
 * Druck des Drehbuchs faellt dafuer aus (engine.scram wird stillgelegt und
 * nur ueber die gemerkte Fassung ausgeloest).
 */
function press(pressAt, watchS) {
  const f = boot();
  const { engine, session } = f;
  const s = engine.state;
  const tut = session.tutorial;
  const realScram = engine.scram.bind(engine);
  engine.scram = () => {};
  let pressed = false;
  let confirmed = false;

  for (let i = 0; i < Math.round(4000 / DT) && session.phase === PHASE.RUNNING; i++) {
    one(f);
    if (!confirmed && tut.index === 0 && tut.inspectReady) confirmed = tut.confirmInspect();
    if (tut._runbackT0 == null) continue;
    const since = s.t_sim - tut._runbackT0;
    if (!pressed && since >= pressAt) { realScram('az5'); pressed = true; }
    if (s.destroyed || since > pressAt + watchS) break;
  }
  return s.destroyed;
}

/** Zusammenhaengende Bereiche zerstoerender Zeitpunkte. */
function windows(step, to, watchS) {
  const hits = [];
  for (let t = 0; t <= to; t += step) if (press(t, watchS)) hits.push(t);
  const out = [];
  for (const t of hits) {
    const last = out[out.length - 1];
    if (last && t === last[1] + step) last[1] = t; else out.push([t, t]);
  }
  return out;
}

function inside(list, t) {
  return list.some(([a, b]) => t >= a && t <= b);
}

const step = Number(process.argv[2] ?? 3);
const to = Number(process.argv[3] ?? 60);
const watchS = 90;

const base = { tau: rbmk.spec.turbogen.tau_s, pumps: rbmk.spec.turbogen.coastdownPumps };
const cases = [];
for (const tau of [8, 10, 12, 15, 18, 22, 30]) cases.push({ tau, pumps: base.pumps });
for (const pumps of [3, 5, 6]) cases.push({ tau: base.tau, pumps });

console.log(`Massstab: Testbeginn ${hms(WALL_TEST)}, AZ-5 ${hms(WALL_AZ5)} `
  + `(= ${PRESS_HIST} s nach Auslaufbeginn), Zerstoerung 01:23:45`);
console.log(`Fenster abgetastet alle ${step} s bis ${to} s\n`);
console.log('tau   Pumpen   Drehbuch: AZ-5      Zerstoerung   Spitze     Wirkfenster (s)        36 s drin');

for (const c of cases) {
  rbmk.spec.turbogen.tau_s = c.tau;
  rbmk.spec.turbogen.coastdownPumps = c.pumps;
  const run = scripted();
  const win = windows(step, to, watchS);
  const mark = (c.tau === base.tau && c.pumps === base.pumps) ? ' <- heute' : '';
  console.log(`${String(c.tau).padStart(3)}s${String(c.pumps).padStart(8)}`
    + `   ${(run.az5 === null ? '-' : hms(run.az5)).padStart(12)}`
    + `   ${(run.ruin === null ? 'keine' : hms(run.ruin)).padStart(11)}`
    + `   ${(run.peak * 100).toFixed(0).padStart(5)} %`
    + `   ${JSON.stringify(win).padEnd(20)}`
    + `   ${inside(win, PRESS_HIST) ? 'ja' : 'NEIN'}${mark}`);
}

rbmk.spec.turbogen.tau_s = base.tau;
rbmk.spec.turbogen.coastdownPumps = base.pumps;
