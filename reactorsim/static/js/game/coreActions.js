// Bedienhandlungen, die jeder Reaktortyp hat.
//
// Alles, was NICHT hier steht, läuft über hooks.uiControls() -- die
// typspezifische Bedienung (Borsäure, Frischdampf-Absperrung, ...), siehe
// replayKit.js für deren Aufzeichnung/Wiedergabe. Hier stehen die
// gemeinsamen: Stäbe, Pumpen, Lastanforderung, Turbinenregler und
// Speisewasser in Automatik/Hand, Schnellabschaltung, Quittieren,
// Rückstellen, Turbine zuschalten.
//
// Reines Engine-Objekt, kein DOM -- deshalb sowohl im Browser (main.js/
// panels.js, über record() unten: tatsächliche Wirkung UND Aufzeichnung)
// als auch in game/replay.js (Server-Nachrechnung, nur die Wirkung über
// CORE_ACTIONS direkt) importierbar. Jede Funktion hier ist deshalb die
// EINZIGE Stelle, die diese Handlung ausführt -- panels.js/main.js rufen sie
// über record(), nicht mehr die Mutation selbst.

export const CORE_ACTIONS = {
  rod_jog(engine, dir) {
    const { state: s, spec: sp, ctx } = engine;
    // Wie beim Automatik/Hand-Umschalter (autoSwitch): der Sollwert kommt
    // jetzt vom Bediener, nicht mehr vom Regler -- unabhängig davon, ob die
    // Automatik gerade an war oder schon aus.
    if (ctx.rodAutoCtl) ctx.rodAutoCtl.auto = false;
    s.rodDmd[0] = Math.max(0, Math.min(1, s.rodDmd[0] + dir * 0.005));
    if (sp.rodBanksMoveTogether) {
      for (let i = 1; i < s.rodDmd.length; i++) {
        s.rodDmd[i] = Math.max(0, Math.min(1, s.rodDmd[i] + dir * 0.005));
      }
    }
  },
  rod_auto(engine, v) {
    const ctl = engine.ctx.rodAutoCtl;
    if (!ctl) return;
    // Stossfrei, wie im Dateikopf von sim/controllers.js versprochen: der
    // RBMK-Leistungsregler (PowerController) traegt sein setpoint als festes
    // Feld -- ohne dieses Nachziehen spraenge er beim Einschalten auf den
    // Sollwert von Rundenbeginn zurueck. RodController (PWR) regelt live auf
    // setpoint(load) und hat kein eingefrorenes Feld, daher der typeof-Test.
    if (v && typeof ctl.setpoint === 'number') ctl.setpoint = engine.state.n;
    ctl.auto = v;
  },
  pump_toggle(engine, i) {
    const { state: s, spec: sp, ctx, hooks } = engine;
    if (hooks.togglePump) hooks.togglePump(s, sp, ctx, i);
  },
  demand_set(engine, mw) { engine.state.P_demand = mw; },
  gov_auto(engine, v) { engine.ctx.govCtl.auto = v; },
  // Der Rohwert kommt vom Schieber in Anzeigeeinheiten (0-100 %) -- dieselbe
  // Umrechnung wie in panels.js' govStation.write() vorher.
  gov_write(engine, v) { engine.ctx.govCtl.manual = v / 100; },
  fw_auto(engine, v) { engine.ctx.fwCtl.auto = v; },
  fw_write(engine, v) { engine.ctx.fwCtl.manual = v / 100; },
  scram(engine) { engine.scram('manual'); },
  ack(engine) { engine.trips.ack(); },
  reset(engine) { engine.trips.reset(); engine.resetScram(); },
  turbine_resume(engine) { engine.resumeTurbine(); },
};

/**
 * Client-Aufruf: aufzeichnen (falls ein Recorder angehängt ist, siehe
 * recorder.js attachRecorder()) UND ausführen -- immer beides zusammen,
 * damit keine Handlung im Spiel wirkt, ohne im Protokoll zu stehen.
 */
export function record(engine, id, value) {
  if (engine.recorder) engine.recorder.record(id, value);
  const fn = CORE_ACTIONS[id];
  if (fn) fn(engine, value);
}
