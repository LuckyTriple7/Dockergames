// Untersuchung, keine Zusicherung: die ganze Uebung einmal durchlaufen und
// die Marken mitschreiben -- Betriebszeit, Uhrzeit und Zustand an jedem
// Schrittwechsel.
//
// Gebraucht, seit der Leistungseinbruch wirklich gefahren wird (siehe
// chernobylTutorial.js DIP_DEPTH): der Zustand beim Auslaufbeginn entsteht
// jetzt aus der Simulation statt fest aus prepare(), und genau darauf ist die
// AZ-5-Wirkung kalibriert.
//
// Aufruf: node tests/tools/chernobyl_full.mjs

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

const engine = createEngine(rbmk, { seed: DEF.seed });
const session = new Session(engine, DEF);
session.start();
const s = engine.state;
const tut = session.tutorial;
const hms = (sec) => new Date(Math.round(sec) * 1000).toISOString().slice(11, 19);

let last = tut.index;
let peak = s.n;
let confirmed = false;

console.log('Schritt        Betriebszeit   Uhr        n       ORM    Drehzahl');
const line = (label) => {
  const d = engine.derive();
  console.log(`${label.padEnd(14)} ${hms(s.t_sim).padEnd(14)} ${hms(tut.view().wall).padEnd(10)}`
    + ` ${(s.n * 100).toFixed(2).padStart(6)}% ${d.orm.toFixed(1).padStart(6)}`
    + ` ${(s.tgSpeed * 100).toFixed(0).padStart(7)}%`);
};

for (let i = 0; i < Math.round(4000 / DT) && session.phase === PHASE.RUNNING; i++) {
  engine.step(DT);
  session.step(DT, engine.trips.tiles(), 0);
  peak = Math.max(peak, s.n);
  if (!confirmed && tut.index === 0 && tut.inspectReady) {
    confirmed = tut.confirmInspect();
    if (confirmed) line('handover ok');
  }
  if (tut.index !== last) { line(tut.steps[last] + ' ok'); last = tut.index; }
}

line('Ende');
console.log(`\nSpitze n = ${(peak * 100).toFixed(1)} %`);
console.log(`zerstoert = ${s.destroyed}, phase = ${session.phase}`
  + `, Ausgang = ${session.result ? session.result.summary.failed : '-'}`);
console.log(`Uhr am Ende: ${hms(s.t_sim + engine.ctx.wallClock)}`);
