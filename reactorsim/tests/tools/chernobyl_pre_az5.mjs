// Untersuchung, keine Zusicherung: was passiert in den 36 Sekunden zwischen
// Testbeginn und AZ-5 -- steigt die Leistung dort, oder nicht?
//
// Anlass: Die Formulierung "AZ-5 ist die alleinige Ursache" (CHANGELOG 0.6.1)
// klingt so, als sei vor dem Knopfdruck nichts passiert. Historisch stieg der
// Dampfblasenanteil in dieser Zeit sehr wohl, die LEISTUNG blieb aber nahezu
// flach bei rund 200 MWth -- weil die automatische Regelung gegenhielt.
// Dieses Skript trennt die beiden Dinge: was die Anzeige zeigt (Leistung) und
// was darunter passiert (Reaktivitaetsbilanz).
//
// Aufruf: node tests/tools/chernobyl_pre_az5.mjs

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

/** @param {boolean} withTrim  die schmale automatische Regelgruppe laufen
 *   lassen (wie historisch) oder abschalten. */
function trace(withTrim) {
  const f = boot();
  const { engine, session } = f;
  const s = engine.state;
  const c = engine.ctx;
  const tut = session.tutorial;

  // Das Drehbuch darf hier nicht druecken -- gemessen wird, was OHNE AZ-5
  // geschieht.
  engine.scram = () => {};

  for (let i = 0; i < Math.round(6 / DT); i++) one(f);
  tut.confirmInspect();

  const rows = [];
  let next = 0;
  for (let i = 0, n = Math.round(3000 / DT); i < n && session.phase === PHASE.RUNNING; i++) {
    one(f);
    if (!withTrim && c.arTrim) { c.arTrim = null; s.rho_ext = 0; }
    if (tut._runbackT0 == null) continue;
    const since = s.t_sim - tut._runbackT0;
    if (since >= next) {
      const d = engine.derive();
      rows.push({
        since, n: s.n, void: s.alphaBar, flow: s.W_core, tg: s.tgSpeed,
        rho: d.rho_pcm, trim: (s.rho_ext || 0) * 1e5,
      });
      next += 4;
    }
    if (since > 44) break;
  }
  return { rows, destroyed: s.destroyed };
}

for (const withTrim of [true, false]) {
  const r = trace(withTrim);
  console.log(`\n== ${withTrim ? 'MIT' : 'OHNE'} automatische Regelgruppe, ohne AZ-5 ==`);
  console.log('  t+s   Drehzahl  Kernstrom   Blasen    Leistung   rho gesamt   Trimm');
  for (const row of r.rows) {
    console.log(`${row.since.toFixed(0).padStart(5)}`
      + `   ${(row.tg * 100).toFixed(0).padStart(6)} %`
      + `   ${row.flow.toFixed(0).padStart(7)}`
      + `   ${(row.void * 100).toFixed(2).padStart(6)} %`
      + `   ${(row.n * 100).toFixed(2).padStart(7)} %`
      + `   ${row.rho.toFixed(0).padStart(8)} pcm`
      + `   ${row.trim.toFixed(0).padStart(5)} pcm`);
  }
  console.log(`  zerstoert = ${r.destroyed}`);
}

// Und zum Vergleich: wie viel Reaktivitaet schieben die Graphitspitzen beim
// Druecken dazu? Dafuer die Reaktivitaetsbilanz unmittelbar vor und nach dem
// Knopfdruck bei t+36s.
{
  const f = boot();
  const { engine, session } = f;
  const s = engine.state;
  const tut = session.tutorial;
  const realScram = engine.scram.bind(engine);
  engine.scram = () => {};
  for (let i = 0; i < Math.round(6 / DT); i++) one(f);
  tut.confirmInspect();
  let before = null; let peakRho = -1e9; let pressed = false;
  for (let i = 0, n = Math.round(3000 / DT); i < n && session.phase === PHASE.RUNNING; i++) {
    one(f);
    if (tut._runbackT0 == null) continue;
    const since = s.t_sim - tut._runbackT0;
    if (!pressed && since >= 36) {
      before = engine.derive().rho_pcm;
      realScram('az5');
      pressed = true;
    }
    if (pressed) peakRho = Math.max(peakRho, engine.derive().rho_pcm);
    if (since > 60) break;
  }
  console.log(`\n== AZ-5 bei t+36s ==`);
  console.log(`  rho unmittelbar davor: ${before.toFixed(0)} pcm`);
  console.log(`  hoechstes rho danach:  ${peakRho.toFixed(0)} pcm`);
  console.log(`  Beitrag des Knopfes:   ${(peakRho - before).toFixed(0)} pcm`);
  console.log(`  zerstoert = ${s.destroyed}`);
}
