// Untersuchung, keine Zusicherung: was aendert sich, wenn die beiden
// zusaetzlichen Hauptumwaelzpumpen zur HISTORISCHEN Zeit (01:07, also mitten
// in der Haltephase) zulaufen statt danach als eigener Schritt?
//
// Hintergrund: BACKLOG.md, "Historische Zeitverhaeltnisse gerafft" -- die
// Pumpenzuschaltung zeigt heute ~01:23:25 statt 01:07. Bisher nachgemessen
// war nur der Bereich 0..300 s vor dem Auslauf; hier geht es um ~980 s davor.
//
// Aufruf: node tests/tools/chernobyl_pumps_early.mjs

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

/** @param {number|null} pumpsAtRecoverS  Sekunden nach Beginn von 'recover',
 *   zu denen alle acht Pumpen laufen sollen; null = wie heute (Drehbuch). */
function run(pumpsAtRecoverS) {
  const f = boot();
  const { engine, session } = f;
  const s = engine.state;
  const c = engine.ctx;
  const tut = session.tutorial;

  for (let i = 0; i < Math.round(6 / DT); i++) one(f);
  tut.confirmInspect();
  for (let i = 0; i < Math.round(5 / DT); i++) one(f);
  tut.confirmInspect();

  const recoverStart = s.t_sim;
  let atCoastdown = null;
  let pumpsOnAt = null;
  let peak = s.n;

  for (let i = 0, n = Math.round(2000 / DT); i < n && session.phase === PHASE.RUNNING; i++) {
    if (pumpsAtRecoverS !== null && pumpsOnAt === null
        && s.t_sim - recoverStart >= pumpsAtRecoverS) {
      for (const p of c.mcp) if (!p.running) p.start();
      pumpsOnAt = s.t_sim;
    }
    one(f);
    if (atCoastdown === null && tut._runbackT0 != null) {
      atCoastdown = {
        t: s.t_sim, n: s.n, P_th: s.P_th, orm: engine.derive().orm,
        X: s.X, rod: s.rod[0], alphaBar: s.alphaBar, T_f: s.T_f,
        p_drum: s.p_drum, W_core: s.W_core, dTsub: s.dTsub, ao: s.ao,
        pumps: c.mcp.filter(p => p.running && p.speed >= 0.9).length,
      };
    }
    peak = Math.max(peak, s.n);
  }

  return {
    recoverStart, pumpsOnAt, atCoastdown, peak,
    destroyed: s.destroyed, phase: session.phase,
    scramAt: tut._runbackT0 != null ? null : undefined,
    endT: s.t_sim,
    wallCoast: atCoastdown ? atCoastdown.t + engine.ctx.wallClock : null,
    wallEnd: s.t_sim + engine.ctx.wallClock,
  };
}

const hms = (sec) => new Date(Math.round(sec) * 1000).toISOString().slice(11, 19);

for (const [label, at] of [['heute (Drehbuch nach der Haltephase)', null],
                           ['01:07, 172 s nach dem Sprung', 172],
                           ['sofort mit Beginn der Haltephase', 0],
                           ['600 s nach dem Sprung', 600]]) {
  const r = run(at);
  const a = r.atCoastdown;
  console.log(`\n== ${label} ==`);
  if (!a) { console.log('  Auslauf nie erreicht'); continue; }
  console.log(`  Pumpen an bei t_sim=${r.pumpsOnAt === null ? '(Drehbuch)' : r.pumpsOnAt.toFixed(1)}`);
  console.log(`  Auslaufbeginn t_sim=${a.t.toFixed(1)}  Uhr=${hms(r.wallCoast)}`);
  console.log(`  dort: n=${(a.n * 100).toFixed(2)}%  P_th=${a.P_th.toFixed(1)}  ORM=${a.orm.toFixed(2)}`
    + `  X=${a.X.toFixed(4)}  rod=${a.rod.toFixed(4)}`);
  console.log(`        alpha=${a.alphaBar.toFixed(4)}  T_f=${a.T_f.toFixed(1)}  p=${a.p_drum.toFixed(2)}`
    + `  W=${a.W_core.toFixed(0)}  dTsub=${a.dTsub.toFixed(2)}  ao=${a.ao.toFixed(4)}  Pumpen=${a.pumps}`);
  console.log(`  Spitze n=${(r.peak * 100).toFixed(1)}%  zerstoert=${r.destroyed}`
    + `  Ende=${hms(r.wallEnd)}  phase=${r.phase}`);
}
