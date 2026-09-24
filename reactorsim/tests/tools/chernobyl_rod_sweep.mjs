// Untersuchung, keine Zusicherung: welche Stabstellung vor dem Test ist
// moeglich, und was zeigt die Abschaltreserve dabei an?
//
// Hintergrund: BACKLOG.md, "ORM-Anzeige passt nicht zur Historie". Die Uebung
// zieht vor dem Versuch auf WITHDRAW_ROD = 0,02 -- dort zeigt die
// Abschaltreserve 0,0 Stabaequivalente, dokumentiert sind fuer diese Nacht
// 6 bis 8. Gemessen (tests/tools/chernobyl_orm.mjs) liegt ORM = 7,4 bei
// h = tip.span = 0,179, also genau bei der historischen Geometrie: 1,25 m
// eingefahren von 7 m Kern.
//
// Die Frage ist, ob die Graphitspitzen-Wirkung bei dieser Stellung noch
// traegt. Bis 0.6.0 war das ausgeschlossen -- das Wirkfenster war schmal.
// Seit der Turbinenauslauf eine echte Rotordrehzahl ist, ist es breit.
//
// Aufruf: node tests/tools/chernobyl_rod_sweep.mjs

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

/** @param {number} rod  Stabstellung, auf die vor dem Test gezogen wird. */
function run(rod) {
  const f = boot();
  const { engine, session } = f;
  const s = engine.state;
  const tut = session.tutorial;

  // Den letzten Stabzug der Uebung auf den Probewert umbiegen -- der Rest
  // des Drehbuchs (Pumpen, Auslauf, AZ-5) laeuft unveraendert.
  const original = tut._withdrawToTipSpan.bind(tut);
  tut._withdrawToTipSpan = function patched() {
    const { state: st, spec: sp, reactivity } = this.engine;
    const xenonPcm = sp.feedback.xenon_worth_pcm * 1e-5;
    st.rod[0] = st.rod[1] = st.rodDmd[0] = st.rodDmd[1] = rod;
    const rho = reactivity.compute(st, sp);
    const dX = rho / xenonPcm;
    if (Number.isFinite(dX) && dX > 0) {
      const scale = (st.X + dX) / st.X;
      st.X *= scale;
      if (st.zTop) st.zTop.X *= scale;
      if (st.zBot) st.zBot.X *= scale;
    }
  };
  void original;

  for (let i = 0; i < Math.round(6 / DT); i++) one(f);
  tut.confirmInspect();

  let ormAtTest = null;
  let peak = s.n;
  for (let i = 0, n = Math.round(3000 / DT); i < n && session.phase === PHASE.RUNNING; i++) {
    one(f);
    if (ormAtTest === null && tut._runbackT0 != null) ormAtTest = engine.derive().orm;
    peak = Math.max(peak, s.n);
  }
  return { ormAtTest, peak, destroyed: s.destroyed, rho: engine.derive().rho_pcm,
    phase: session.phase, nEnd: s.n };
}

console.log('Stabstellung vor dem Test -> Anzeige und Ausgang');
console.log('(tip.span = 0,1786; dort liegt die historische Geometrie, 1,25 m von 7 m)\n');
console.log('  rod     ORM    Spitze n   zerstoert');
for (const rod of [0.02, 0.04, 0.06, 0.08, 0.10, 0.12, 0.14, 0.16, 0.1786, 0.20, 0.22]) {
  const r = run(rod);
  console.log(`${rod.toFixed(4)}  ${(r.ormAtTest ?? NaN).toFixed(2).padStart(6)}`
    + `  ${(r.peak * 100).toFixed(1).padStart(8)} %   ${r.destroyed ? 'JA' : '-'}`
    + `   (phase=${r.phase})`);
}
