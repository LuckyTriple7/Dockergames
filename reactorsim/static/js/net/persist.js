// Spielstände und Bestenliste aus Sicht des Browsers.
//
// Der Server behandelt den Spielstand als undurchsichtigen Block. Geprüft wird
// er deshalb HIER, beim Laden: ein kaputter oder fremder Stand darf nicht in
// die Engine, sonst rechnet sie mit NaN weiter und der Spieler sieht Striche
// statt Zahlen, ohne zu wissen warum.

import { api } from './api.js';
import { numbers } from '../sim/state.js';

// Bewusst NICHT erhoeht: "components" ist rein additiv, ein alter Stand ohne
// dieses Feld muss weiter laden -- Pumpen/Regler federn dann einfach auf
// ihre frisch gebauten Anfangswerte ein, genau wie vor diesem Fix.
const SAVE_VERSION = 1;

/** Pumpen, Ventile und Regler in ihre je eigene Form packen -- siehe
 *  ctx.saveable, von hooks.extraState() je Typ befuellt. Fehlt die Liste
 *  (sollte nicht vorkommen, aber lieber leer als abstuerzen), gibt es
 *  einfach kein components-Feld. */
function packComponents(ctx) {
  if (!ctx.saveable) return undefined;
  const out = {};
  for (const [name, obj] of Object.entries(ctx.saveable)) {
    if (!obj) continue;
    out[name] = Array.isArray(obj) ? obj.map((o) => o.snapshot()) : obj.snapshot();
  }
  return out;
}

/** Zustand in einen Block packen, den der Server nur weiterreicht.
 *  `runState` ist optional (nur Szenarien haben eins, siehe game/session.js
 *  Session.run) -- ohne sie faengt die Wertung nach jedem Fortsetzen wieder
 *  bei null an, obwohl die Simulation selbst korrekt weiterlaeuft. */
export function pack(engine, scenarioId, runState) {
  const s = engine.state;
  const out = {};
  // Nur Zahlen und einfache Felder direkt am Zustand.
  for (const [k, v] of Object.entries(s)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (v instanceof Float64Array) out[k] = Array.from(v);
    else if (typeof v === 'boolean') out[k] = v;
  }
  out.scram = { ...s.scram };
  return {
    v: SAVE_VERSION,
    reactor: s.reactor,
    scenario: scenarioId || null,
    t_sim: s.t_sim,
    state: out,
    // Pumpen, Ventile, Regler -- eigenes Gedaechtnis ausserhalb von
    // engine.state, siehe ctx.saveable je Typ. Ohne das kam nach dem Laden
    // jede Pumpe wieder hochgefahren und jede Hand-Stellung sprang auf
    // Automatik zurueck, ganz gleich was der Spieler eingestellt hatte.
    components: packComponents(engine.ctx),
    run: runState ? runState.snapshot() : undefined,
    // Quittierstatus der Meldetafel -- ohne das blinkte/hupte nach dem Laden
    // jede vorher schon quittierte, aber weiterhin anstehende Meldung sofort
    // wieder auf (siehe TripSystem.snapshot() in sim/trips.js).
    trips: engine.ctx.trips.snapshot(),
    // Rollendes Protokoll-Gedaechtnis (siehe ctx.history in sim/engine.js) --
    // ohne das startete das Log-Panel nach jedem Laden leer.
    history: engine.ctx.history,
    // Laufende Stoerungs-Merker aus game/events.js (stepEvents()) -- leben
    // NUR auf ctx, nicht in engine.state, und waren deshalb komplett aus dem
    // Spielstand ausgeschlossen. Ohne sie kam nach dem Laden zwar die
    // Simulation richtig weiter (die betroffenen Werte selbst -- s.msiv,
    // Pumpen-Snapshot usw. -- sind ja Teil von state/components), aber
    // stepEvents() haette nichts mehr gehabt, das es weiter verteidigt: ein
    // "ausgefallener" Pumpenknopf liesse sich nach dem Laden einfach wieder
    // anklicken, und die zugehoerige Meldung (mcp_stuck/rod_stuck) fiel beim
    // naechsten Bild sofort auf "normal" zurueck, obwohl sie schon quittiert
    // war und die Ursache unveraendert weiter ansteht.
    malfunctions: {
      stuckRods: engine.ctx.stuckRods,
      msivStuck: engine.ctx.msivStuck,
      pumpsStuck: engine.ctx.pumpsStuck ? Array.from(engine.ctx.pumpsStuck) : undefined,
      recircPumpStuck: engine.ctx.recircPumpStuck,
      recircRunback: engine.ctx.recircRunback,
      porvStuck: engine.ctx.porvStuck,
      sgLeak: engine.ctx.sgLeak,
      boronRunaway: engine.ctx.boronRunaway,
    },
  };
}

/**
 * Block prüfen und anwenden.
 * @returns {string|null} Fehlergrund, oder null bei Erfolg
 */
export function apply(blob, engine, runState) {
  if (!blob || blob.v !== SAVE_VERSION) return 'version';
  if (blob.reactor !== engine.state.reactor) return 'reactor';
  const src = blob.state;
  if (!src || typeof src !== 'object') return 'shape';

  // Erst vollständig prüfen, dann erst schreiben. Ein halb angewandter
  // Spielstand wäre schlimmer als gar keiner.
  for (const [k, v] of Object.entries(src)) {
    if (Array.isArray(v)) {
      if (v.some((x) => typeof x !== 'number' || !Number.isFinite(x))) return `array:${k}`;
    } else if (typeof v === 'number') {
      if (!Number.isFinite(v)) return `number:${k}`;
    }
  }

  const s = engine.state;
  for (const [k, v] of Object.entries(src)) {
    const cur = s[k];
    if (cur instanceof Float64Array && Array.isArray(v) && v.length === cur.length) {
      cur.set(v);
    } else if (typeof cur === 'number' && typeof v === 'number') {
      s[k] = v;
    } else if (typeof cur === 'boolean' && typeof v === 'boolean') {
      s[k] = v;
    }
  }
  if (src.scram && typeof src.scram === 'object') {
    s.scram = { active: !!src.scram.active, t: Number(src.scram.t) || 0, cause: src.scram.cause || null };
  }

  // Pumpen, Ventile, Regler -- optional: ein Stand von vor diesem Fix hat
  // kein components-Feld, dann bleibt alles auf den frisch gebauten
  // Anfangswerten stehen (wie schon immer), statt den Ladevorgang scheitern
  // zu lassen. Jedes restore() prueft seine Felder selbst, bevor es sie
  // uebernimmt -- ein kaputter Eintrag hier wird ignoriert, nicht zum
  // Ladefehler wie bei engine.state oben.
  if (blob.components && typeof blob.components === 'object' && engine.ctx.saveable) {
    for (const [name, obj] of Object.entries(engine.ctx.saveable)) {
      const data = blob.components[name];
      if (data === undefined || !obj) continue;
      if (Array.isArray(obj)) {
        if (Array.isArray(data) && data.length === obj.length) {
          obj.forEach((o, i) => data[i] && o.restore(data[i]));
        }
      } else if (typeof data === 'object' && data !== null) {
        obj.restore(data);
      }
    }
  }

  // Zum Schluss: der Zustand muss die Grenzwächter überstehen.
  if (numbers(s).some((x) => !Number.isFinite(x))) return 'not_finite';

  // Wertungs-Zwischenstand optional, wie components oben: ein Stand von vor
  // diesem Fix hat kein run-Feld, dann startet die Wertung wie bisher bei
  // null statt den Ladevorgang scheitern zu lassen.
  if (runState && blob.run && typeof blob.run === 'object') runState.restore(blob.run);

  // Quittierstatus und Protokoll -- ebenso optional: ein Stand von vor
  // diesem Fix hat weder trips noch history, dann bleibt die Meldetafel wie
  // bisher auf "normal" und das Log-Panel leer, statt den Ladevorgang
  // scheitern zu lassen. restore() prueft seine Felder selbst.
  if (blob.trips) engine.ctx.trips.restore(blob.trips);
  if (Array.isArray(blob.history)) {
    engine.ctx.history = blob.history.filter((e) => e && typeof e === 'object' && typeof e.key === 'string');
  }

  // Laufende Stoerungs-Merker -- ebenso optional: ein Stand von vor diesem
  // Fix hat kein malfunctions-Feld, dann bleibt es wie bisher (die
  // betroffenen Werte selbst laden trotzdem korrekt aus state/components,
  // nur stepEvents() verteidigt sie ab da nicht mehr aktiv).
  const m = blob.malfunctions;
  if (m && typeof m === 'object') {
    if (m.stuckRods && typeof m.stuckRods === 'object') engine.ctx.stuckRods = { ...m.stuckRods };
    if (m.msivStuck) engine.ctx.msivStuck = true;
    if (Array.isArray(m.pumpsStuck) && m.pumpsStuck.length) {
      engine.ctx.pumpsStuck = new Set(m.pumpsStuck.filter((i) => Number.isInteger(i)));
    }
    if (m.recircPumpStuck) engine.ctx.recircPumpStuck = true;
    if (m.recircRunback && typeof m.recircRunback === 'object') {
      const { from, to, t0, dur } = m.recircRunback;
      if ([from, to, t0, dur].every((x) => typeof x === 'number' && Number.isFinite(x))) {
        engine.ctx.recircRunback = { from, to, t0, dur };
      }
    }
    if (m.porvStuck) engine.ctx.porvStuck = true;
    if (typeof m.sgLeak === 'number' && Number.isFinite(m.sgLeak)) engine.ctx.sgLeak = m.sgLeak;
    if (m.boronRunaway) engine.ctx.boronRunaway = true;
  }
  return null;
}

export async function save(engine, scenarioId, slot = 'auto', runState) {
  const r = await api.writeSave(slot, pack(engine, scenarioId, runState));
  return r.ok;
}

export async function load(engine, slot = 'auto', runState) {
  const r = await api.readSave(slot);
  if (!r.ok || !r.data) return 'not_found';
  return apply(r.data, engine, runState);
}

export { api };
