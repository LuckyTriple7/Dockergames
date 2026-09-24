// Untersuchung, keine Zusicherung: wie stark haengt die Exkursion an der
// Wirksamkeit der von unten einfahrenden USP-Gruppe (rbmk.js rodBanks[2])?
//
// Gebraucht, seit die Uebung diese Gruppe getrennt stellt, um die
// dokumentierte Abschaltreserve von 6-8 anzeigen zu koennen
// (chernobylTutorial.js: USP_ROD). Die ANZEIGE haengt nur an Stabzahl und
// Stellung, die WIRKUNG waehrend AZ-5 dagegen an der Wirksamkeit -- diese
// beiden Groessen sind hier auseinandergezogen.
//
// Aufruf: node tests/tools/chernobyl_usp_sweep.mjs

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

const uspBank = rbmk.spec.rodBanks.find(b => b.fromBelow);
const sdBank = rbmk.spec.rodBanks.find(b => b.id === 'sd');
const w0 = uspBank.worth, sd0 = sdBank.worth;

console.log('USP-pcm  ORM@Test  Spitze   zerstoert');
for (const w of [506, 400, 300, 200, 100, 50, 0]) {
  uspBank.worth = w;
  sdBank.worth = sd0 + (w0 - w);   // Gesamtwirksamkeit konstant halten
  const engine = createEngine(rbmk, { seed: DEF.seed });
  const session = new Session(engine, DEF);
  session.start();
  const s = engine.state, tut = session.tutorial;
  let confirmed = false, peak = s.n, ormAtTest = null;
  for (let i = 0; i < Math.round(4000 / DT) && session.phase === PHASE.RUNNING; i++) {
    engine.step(DT);
    session.step(DT, engine.trips.tiles(), 0);
    peak = Math.max(peak, s.n);
    if (!confirmed && tut.index === 0 && tut.inspectReady) confirmed = tut.confirmInspect();
    if (ormAtTest == null && tut._runbackT0 != null) ormAtTest = engine.derive().orm;
  }
  console.log(`${String(w).padStart(7)} ${(ormAtTest ?? NaN).toFixed(1).padStart(9)}`
    + ` ${(peak * 100).toFixed(1).padStart(7)}% ${String(s.destroyed).padStart(10)}`);
}
uspBank.worth = w0; sdBank.worth = sd0;
