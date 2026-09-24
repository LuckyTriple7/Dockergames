// Untersuchung, keine Zusicherung: was traegt der geskriptete
// Kuehlmittelauslauf, und was bliebe von der Uebung uebrig, wenn er durch
// eine echte Rotordrehzahl ersetzt wuerde?
//
// Hintergrund: BACKLOG.md, "Turbinenauslauf geskriptet, keine echte
// Rotordrehzahl-Zustandsgroesse". Historisch hingen VIER der acht
// Hauptumwaelzpumpen am auslaufenden Turbogenerator, die anderen vier am
// Netz -- der Kernstrom faellt dabei also nicht auf null, sondern auf
// ungefaehr die Haelfte. Das Drehbuch faehrt ihn heute linear auf NULL.
//
// Gemessen wird deshalb beides: die Kurvenform (linear gegen den
// physikalischen 1/(1+t/tau)-Auslauf eines Rotors gegen Pumpenlast) und vor
// allem der Endwert.
//
// Aufruf: node tests/tools/chernobyl_coastdown.mjs

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

/**
 * @param {object} shape  { to, dur, rotor } -- `to` ist der Endwert des
 *   Pumpen-Sollwerts, `rotor` schaltet auf den physikalischen Auslauf um
 *   (Rotor gegen Pumpenlast: J*w*dw/dt = -P0*(w/w0)^3 ergibt
 *   w(t) = w0 / (1 + t/tau); tau so gewaehlt, dass die halbe Drehzahl nach
 *   dur/2 erreicht ist, also grob dieselbe Zeitskala wie die Rampe).
 */
function run(shape) {
  const f = boot();
  const { engine, session } = f;
  const s = engine.state;
  const c = engine.ctx;
  const tut = session.tutorial;

  for (let i = 0; i < Math.round(6 / DT); i++) one(f);
  tut.confirmInspect();
  for (let i = 0; i < Math.round(5 / DT); i++) one(f);
  tut.confirmInspect();

  let peak = s.n;
  let tPeak = null;
  let flowMin = Infinity;
  const trace = [];

  for (let i = 0, n = Math.round(2500 / DT); i < n && session.phase === PHASE.RUNNING; i++) {
    one(f);
    // Eigene Auslaufform ueber die des Drehbuchs legen -- direkt nach dem
    // Schritt, damit stepEvents() sie nicht wieder ueberschreibt.
    if (tut._runbackT0 != null) {
      const dt = s.t_sim - tut._runbackT0;
      const from = 1;
      if (shape.rotor) {
        const tau = shape.dur / 2;
        const w = 1 / (1 + dt / tau);
        s.mcpDmd = shape.to + (from - shape.to) * w;
      } else {
        const frac = Math.min(1, Math.max(0, dt / shape.dur));
        s.mcpDmd = from + (shape.to - from) * frac;
      }
      c.mcpRunback = null;
      flowMin = Math.min(flowMin, s.W_core);
      if (trace.length < 9 && Math.abs(dt - trace.length * 5) < DT) {
        trace.push(`t+${(trace.length * 5).toString().padStart(2)}s ${(s.mcpDmd * 100).toFixed(0)}%`);
      }
    }
    if (s.n > peak) { peak = s.n; tPeak = tut._runbackT0 != null ? s.t_sim - tut._runbackT0 : null; }
  }
  return { peak, tPeak, destroyed: s.destroyed, flowMin, trace, phase: session.phase };
}

const cases = [
  ['heute: linear auf 0 % ueber 30 s', { to: 0, dur: 30, rotor: false }],
  ['Rotorauslauf auf 0 %, tau=15 s', { to: 0, dur: 30, rotor: true }],
  ['historisch: 4 von 8 Pumpen -> auf 50 %', { to: 0.5, dur: 30, rotor: false }],
  ['Rotorauslauf auf 50 %, tau=15 s', { to: 0.5, dur: 30, rotor: true }],
  ['auf 25 %', { to: 0.25, dur: 30, rotor: false }],
  ['auf 40 %', { to: 0.4, dur: 30, rotor: false }],
];

for (const [label, shape] of cases) {
  const r = run(shape);
  console.log(`\n== ${label} ==`);
  console.log(`  ${r.trace.join('  ')}`);
  console.log(`  min. Kernstrom ${Number.isFinite(r.flowMin) ? r.flowMin.toFixed(0) : '-'} kg/s`
    + `  Spitze n=${(r.peak * 100).toFixed(1)}%`
    + (r.tPeak === null ? '' : ` bei t+${r.tPeak.toFixed(1)}s`)
    + `  zerstoert=${r.destroyed}`);
}
