// Die Chernobyl-Uebung durch den ECHTEN Simulationstakt der App.
//
// Warum eine eigene Datei: alle anderen Tests zu dieser Uebung rufen
// engine.step()/session.step() selbst auf. Das ist dieselbe Reihenfolge wie
// in main.js, aber es ist eben ein NACHBAU -- und damit war die Aussage "die
// Uebung zerstoert den Kern" nie fuer den Weg belegt, den ein Spieler
// tatsaechlich nimmt: ui/loop.js mit Bildtakt, Zeitraffer-Umschaltungen der
// Uebung und dem Verwerfen von Rueckstand, wenn ein Bild zu lange braucht
// (MAX_STEPS_PER_FRAME).
//
// Hier laeuft genau dieser Weg, mit gestellter Uhr und gestelltem
// requestAnimationFrame, und zwar bei drei Bildraten: fluessig, knapp und
// deutlich zu langsam.

import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
  hidden: false,
  addEventListener() {},
  removeEventListener() {},
};
let nowMs = 0;
globalThis.performance = { now: () => nowMs };
let pendingFrame = null;
globalThis.requestAnimationFrame = (cb) => { pendingFrame = cb; return 1; };

const { createEngine } = await import('../static/js/sim/engine.js');
const rbmk = await import('../static/js/plants/rbmk.js');
const { Session, PHASE } = await import('../static/js/game/session.js');
const { RBMK_CHERNOBYL_TUTORIAL } = await import('../static/js/game/chernobylTutorial.js');
const { Loop } = await import('../static/js/loop.js');

const DEF = {
  id: 'rbmk_chernobyl', reactor: 'rbmk', tutorial: RBMK_CHERNOBYL_TUTORIAL,
  difficulty: 3, title_key: 'x', brief_key: 'x', duration_s: 7200, seed: 26041986,
  demand: [{ t: 0, mw: 0 }, { t: 7200, mw: 0 }], events: [], fail: [{ type: 'fuel_damage' }],
};

/**
 * Einen ganzen Durchlauf durch den Bildtakt fahren.
 * @param {number} fps Bildrate; kleiner heisst mehr verworfener Rueckstand.
 */
function playThroughLoop(fps) {
  nowMs = 0;
  pendingFrame = null;
  const engine = createEngine(rbmk, { seed: DEF.seed });
  const session = new Session(engine, DEF);
  session.start();
  const s = engine.state;
  const tut = session.tutorial;

  let renders = 0;
  const loop = new Loop(engine, () => { renders++; });
  // Wortgleich zu main.js: die Spielschicht sieht jeden Schritt, und die
  // Uebung stellt den Zeitraffer selbst (applyTutorialSpeed dort).
  let applied = null;
  loop.afterStep = () => {
    session.step(0.05, engine.trips.tiles(), engine.trips.unacknowledgedSeconds());
    const hint = session.phase === PHASE.RUNNING ? tut.speedHint : null;
    if (hint != null && hint !== applied) { applied = hint; loop.setSpeed(hint); }
  };
  let crash = null;
  loop.onCrash = (err) => { crash = err; };
  loop.start();

  const frameMs = 1000 / fps;
  let peak = s.n;
  let az5Wall = null;
  let destroyWall = null;
  let slipped = false;
  loop.onSlip = (v) => { if (v) slipped = true; };

  // Grosszuegiges Bildbudget: bei 60x und verworfenem Rueckstand braucht ein
  // Durchlauf deutlich mehr Bilder als bei voller Geschwindigkeit.
  for (let f = 0; f < 400000 && pendingFrame && session.phase === PHASE.RUNNING; f++) {
    const cb = pendingFrame;
    pendingFrame = null;
    nowMs += frameMs;
    cb(nowMs);
    if (tut.index === 0 && tut.inspectReady) tut.confirmInspect();
    if (s.n > peak) peak = s.n;
    if (az5Wall == null && s.scram.active) az5Wall = s.t_sim + engine.ctx.wallClock;
    if (destroyWall == null && s.destroyed) destroyWall = s.t_sim + engine.ctx.wallClock;
  }
  loop.stop();
  return { crash, peak, az5Wall, destroyWall, destroyed: s.destroyed, slipped,
    phase: session.phase, renders, result: session.result };
}

const HMS = (x) => new Date(Math.round(x * 1000)).toISOString().slice(11, 19);

for (const fps of [60, 20, 5]) {
  test(`the exercise destroys the core through the real app loop at ${fps} fps`, (t) => {
    const r = playThroughLoop(fps);
    assert.equal(r.crash, null, `the loop crashed: ${r.crash}`);
    t.diagnostic(`peak ${(r.peak * 100).toFixed(0)} %, AZ-5 ${r.az5Wall ? HMS(r.az5Wall) : '-'}, `
      + `destroyed ${r.destroyWall ? HMS(r.destroyWall) : '-'}, slip ${r.slipped}`);
    assert.ok(r.az5Wall != null, 'AZ-5 never fired');
    // Die dokumentierte Sekunde, gemessen ueber den Bildtakt und nicht ueber
    // einen Nachbau davon.
    assert.ok(Math.abs(r.az5Wall - (1 * 3600 + 23 * 60 + 40)) < 1.5,
      `AZ-5 at ${HMS(r.az5Wall)}, expected 01:23:40`);
    assert.equal(r.destroyed, true, 'the core must be destroyed -- this is the whole exercise');
    assert.ok(r.peak > 5, `peak should be several times rated power, got ${(r.peak * 100).toFixed(0)} %`);
    assert.equal(r.phase, PHASE.DEBRIEF, 'the round must end in the debrief');
    assert.equal(r.result?.summary?.failed, 'fail_fuel_damage',
      `outcome should be fuel damage, got ${r.result?.summary?.failed}`);
  });
}
