// Spielstände und Bestenliste aus Sicht des Browsers.
//
// Der Server behandelt den Spielstand als undurchsichtigen Block. Geprüft wird
// er deshalb HIER, beim Laden: ein kaputter oder fremder Stand darf nicht in
// die Engine, sonst rechnet sie mit NaN weiter und der Spieler sieht Striche
// statt Zahlen, ohne zu wissen warum.

import { api } from './api.js';
import { learningReport, restoreJournal } from '../game/learning.js';
import { numbers } from '../sim/state.js';
import { decaySum, equilibriumDecay } from '../sim/decayheat.js';
import { TrendHistory } from '../game/trendHistory.js';

export const CONTEXT_NUMBERS = ['controlAcc', 'decayFrac', 'nPrev', 'period', 'substeps',
  'tAvgPrev', 'pPrev', 'decayRatio', 'displayLevel',
  // Nur der DWR setzt ihn (plants/pwr.js: _limitedDemand) -- bei den anderen
  // beiden bleibt er undefined und faellt durch den isFinite-Filter unten
  // heraus, wie tAvgPrev/pPrev auch.
  'powerLimitMw'];
export const NESTED_STATE = ['zTop', 'zBot', 'az5'];

// Additive fields preserve compatibility with older saves. Missing historical
// values can only be reconstructed approximately; new saves retain them.
const SAVE_VERSION = 1;

/** Pumpen, Ventile und Regler in ihre je eigene Form packen -- siehe
 *  ctx.saveable, von hooks.extraState() je Typ befuellt. Fehlt die Liste
 *  (sollte nicht vorkommen, aber lieber leer als abstuerzen), gibt es
 *  einfach kein components-Feld. */
export function packComponents(ctx) {
  if (!ctx.saveable) return undefined;
  const out = {};
  for (const [name, obj] of Object.entries(ctx.saveable)) {
    if (!obj) continue;
    out[name] = Array.isArray(obj) ? obj.map((o) => o.snapshot()) : obj.snapshot();
  }
  return out;
}

/** Die Zahlen, Merker und verschachtelten Bloecke am Zustand selbst -- ohne
 *  alles, was drumherum in ctx lebt. Eigene Funktion, weil ausser dem
 *  Spielstand auch das Monitorbild genau diesen Teil braucht (siehe
 *  net/monitorFrame.js); zwei Kopien davon liefen beim naechsten neuen
 *  Zustandsfeld garantiert auseinander. */
export function packState(s) {
  const out = {};
  // Nur Zahlen und einfache Felder direkt am Zustand.
  for (const [k, v] of Object.entries(s)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (v instanceof Float64Array) out[k] = Array.from(v);
    else if (typeof v === 'boolean') out[k] = v;
  }
  out.scram = { ...s.scram };
  for (const key of NESTED_STATE) if (s[key]) out[key] = { ...s[key] };
  if (s.tipArmed) out.tipArmed = [...s.tipArmed];
  if (s.destroyedKey) out.destroyedKey = s.destroyedKey;
  return out;
}

/** Gegenstueck zu packComponents(). Jedes restore() prueft seine Felder
 *  selbst -- ein kaputter Eintrag wird uebersprungen, nicht zum Ladefehler
 *  wie beim Zustand selbst. */
export function restoreComponents(ctx, data) {
  if (!data || typeof data !== 'object' || !ctx.saveable) return;
  for (const [name, obj] of Object.entries(ctx.saveable)) {
    const entry = data[name];
    if (entry === undefined || !obj) continue;
    if (Array.isArray(obj)) {
      if (Array.isArray(entry) && entry.length === obj.length) {
        obj.forEach((o, i) => entry[i] && o.restore(entry[i]));
      }
    } else if (typeof entry === 'object' && entry !== null) {
      obj.restore(entry);
    }
  }
}

/** Zustand in einen Block packen, den der Server nur weiterreicht.
 *  `runState` ist optional (nur Szenarien haben eins, siehe game/session.js
 *  Session.run) -- ohne sie faengt die Wertung nach jedem Fortsetzen wieder
 *  bei null an, obwohl die Simulation selbst korrekt weiterlaeuft. */
export function pack(engine, scenarioId, runState, session) {
  const s = engine.state;
  const out = packState(s);
  return {
    v: SAVE_VERSION,
    reactor: s.reactor,
    scenario: scenarioId || null,
    t_sim: s.t_sim,
    state: out,
    context: Object.fromEntries(CONTEXT_NUMBERS
      .filter((key) => Number.isFinite(engine.ctx[key]))
      .map((key) => [key, engine.ctx[key]])),
    rng: engine.ctx.rng.snapshot(),
    session: session ? session.snapshot() : undefined,
    ...(engine.ctx.trends ? { trends: engine.ctx.trends.snapshot() } : {}),
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
    // Keep real events not yet drained by the renderer separate from history.
    pendingLog: { engine: engine.ctx.log.slice(-120), trips: engine.trips.events.slice(-120) },
    learning: learningReport(engine),
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
      // Schmaler Reaktivitaets-Trimm des Chernobyl-Tutorials (siehe
      // chernobylTutorial.js: _triggerCoastdown/step()) -- ein Ad-hoc-Objekt
      // auf ctx, kein ctx.saveable-Regler mit eigenem snapshot()/restore().
      // Ohne diesen Eintrag verschwand die Leistungshaltung nach jedem
      // Laden spurlos: c.powerCtl.auto ist zu diesem Zeitpunkt schon false
      // (siehe _triggerCoastdown), der Trimm war die EINZIGE noch aktive
      // Gegenkopplung -- die Anlage lief nach dem Laden ungebremst hoch,
      // Sekunden statt Minuten vor dem eigentlich vorgesehenen Anstieg.
      arTrim: engine.ctx.arTrim,
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
export function apply(blob, engine, runState, session) {
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
  let rbmkFeed;
  if (s.reactor === 'rbmk') {
    const normal = 1.3 * engine.spec.drum.W_steam0;
    rbmkFeed = {
      auxFeedInstalled: false, auxFeedAvailable: false, auxFeedOn: false,
      auxFeedDmd: 0, auxWaterKg: engine.spec.auxFeed.capacityKg,
      W_fwDemand: src.W_fw, W_fwMain: src.W_fw, W_fwAux: 0,
      fwSupplyMax: normal, coolantHeatMW: 0,
    };
    const bounds = {
      auxFeedDmd: [0, 1], auxWaterKg: [0, engine.spec.auxFeed.capacityKg],
      W_fwDemand: [0, 1e6], W_fwMain: [0, 1e6], W_fwAux: [0, engine.spec.auxFeed.maxFlow],
      fwSupplyMax: [0, normal], coolantHeatMW: [-1e12, 1e12],
    };
    const hasFeedState = Object.keys(rbmkFeed).some(key => key !== 'coolantHeatMW' && Object.hasOwn(src, key));
    for (const key of Object.keys(rbmkFeed)) {
      if (Object.hasOwn(src, key)) rbmkFeed[key] = src[key];
      // An equipped save needs its complete inventory/request history. Only
      // legacy unequipped saves may reconstruct demand from the W_fw alias.
      else if (hasFeedState && key !== 'coolantHeatMW'
        && !(key === 'W_fwDemand' && src.auxFeedInstalled === false)) return `rbmk:${key}`;
      const value = rbmkFeed[key];
      const range = bounds[key];
      if (range ? (!Number.isFinite(value) || value < range[0] || value > range[1])
        : typeof value !== 'boolean') return `rbmk:${key}`;
    }
    if ((rbmkFeed.auxFeedAvailable && !rbmkFeed.auxFeedInstalled)
      || (rbmkFeed.auxFeedOn && !rbmkFeed.auxFeedAvailable)
      || (rbmkFeed.W_fwAux > 0 && !rbmkFeed.auxFeedAvailable)) return 'rbmk:auxFeed';
    // Flows describe the completed physics step, not the latest button state:
    // switching off or emptying the tank may still leave a positive sample.
    if (rbmkFeed.auxFeedInstalled
      && src.W_fw !== rbmkFeed.W_fwMain + rbmkFeed.W_fwAux) return 'rbmk:W_fw';
  }
  for (const [k, v] of Object.entries(src)) {
    const cur = s[k];
    if (k === 'D' && Array.isArray(v) && v.length === 4 && cur.length !== 4) {
      // Legacy groups cannot recover the original irradiation history. Keep
      // instantaneous decay power continuous; redistribute by new weights.
      const total = v.reduce((a, b) => a + Math.max(0, b), 0);
      const weights = equilibriumDecay(1);
      const sum = decaySum(weights);
      cur.set(weights.map((f) => f * total / sum));
    } else if (s.reactor === 'rbmk' && (k === 'rod' || k === 'rodDmd')
      && cur instanceof Float64Array && Array.isArray(v)
      && v.length === 2 && cur.length === 3) {
      // Staende von vor 0.6.11 kennen zwei Stabgruppen. Die dritte (die 24
      // verkuerzten, von unten einfahrenden Staebe) wurde aus der
      // Abschaltgruppe herausgeloest und uebernimmt deshalb deren Stellung --
      // damit ist der geladene Zustand derselbe wie der gespeicherte:
      // gleiche Gesamtwirksamkeit, gleiche Stabzahl, gleiche Abschaltreserve.
      // Ohne diesen Zweig faellt der Wert durch alle Aeste hindurch und die
      // Staebe stuenden nach dem Laden stumm auf ihrem Anfangswert.
      cur.set([v[0], v[1], v[1]]);
    } else if (cur instanceof Float64Array && Array.isArray(v) && v.length === cur.length) {
      cur.set(v);
    } else if (typeof cur === 'number' && typeof v === 'number') {
      s[k] = v;
    } else if (typeof cur === 'boolean' && typeof v === 'boolean') {
      s[k] = v;
    }
  }
  if (rbmkFeed) Object.assign(s, rbmkFeed);
  if (src.scram && typeof src.scram === 'object') {
    s.scram = { active: !!src.scram.active, t: Number(src.scram.t) || 0, cause: src.scram.cause || null };
  }
  for (const key of NESTED_STATE) {
    if (!s[key] || !src[key]) continue;
    for (const [field, value] of Object.entries(src[key])) {
      if ((typeof s[key][field] === 'number' && Number.isFinite(value))
        || (typeof s[key][field] === 'boolean' && typeof value === 'boolean')) s[key][field] = value;
    }
  }
  if (s.tipArmed && Array.isArray(src.tipArmed) && src.tipArmed.length === s.tipArmed.length) {
    s.tipArmed = [...src.tipArmed];
  } else if (s.tipArmed && Array.isArray(src.tipArmed)
    && src.tipArmed.length === 2 && s.tipArmed.length === 3) {
    // Dieselbe Aufteilung wie bei rod/rodDmd oben. Die verkuerzten Staebe
    // haben ohnehin keine Graphitspitze (rbmk.js: _tipReactivity ueberspringt
    // sie), der uebernommene Wert ist also nur Buchhaltung.
    s.tipArmed = [src.tipArmed[0], src.tipArmed[1], src.tipArmed[1]];
  }
  if (typeof src.destroyedKey === 'string') s.destroyedKey = src.destroyedKey;

  // Pumpen, Ventile, Regler -- optional: ein Stand von vor diesem Fix hat
  // kein components-Feld, dann bleibt alles auf den frisch gebauten
  // Anfangswerten stehen (wie schon immer), statt den Ladevorgang scheitern
  // zu lassen. Jedes restore() prueft seine Felder selbst, bevor es sie
  // uebernimmt -- ein kaputter Eintrag hier wird ignoriert, nicht zum
  // Ladefehler wie bei engine.state oben.
  restoreComponents(engine.ctx, blob.components);

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
  // Discard startup events from the fresh engine; only the saved run may speak.
  const pending = entries => Array.isArray(entries) ? entries.filter(e => e
    && typeof e.key === 'string' && Number.isFinite(e.t) && e.t >= 0 && e.t <= s.t_sim)
    .slice(-120).map(e => ({ ...e })) : [];
  engine.ctx.log = pending(blob.pendingLog?.engine);
  engine.trips.events = pending(blob.pendingLog?.trips);

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
    // `mcpRunback` stand hier bis 0.6.0: die geskriptete Pumpenrampe des
    // Auslaufversuchs. Sie ist ersatzlos weg -- der Auslauf ist jetzt eine
    // Zustandsgroesse (s.tgSpeed/s.tgCoasting, siehe rbmk.js) und kommt damit
    // ueber den ganz normalen Zustandsteil des Spielstands mit.
    if (m.arTrim && typeof m.arTrim === 'object') {
      const { rho, setpoint } = m.arTrim;
      if ([rho, setpoint].every((x) => typeof x === 'number' && Number.isFinite(x))) {
        engine.ctx.arTrim = { rho, setpoint };
      }
    }
    if (m.porvStuck) engine.ctx.porvStuck = true;
    if (typeof m.sgLeak === 'number' && Number.isFinite(m.sgLeak)) engine.ctx.sgLeak = m.sgLeak;
    if (m.boronRunaway) engine.ctx.boronRunaway = true;
  }
  // Legacy saves lack history-dependent context. Reconstruct the values that
  // can be derived, preventing a false temperature/pressure impulse on load.
  const ctx = engine.ctx;
  ctx.decayFrac = decaySum(s.D);
  ctx.nPrev = s.n;
  if ('tAvgPrev' in ctx) ctx.tAvgPrev = (s.T_ci + s.T_co) / 2;
  if ('pPrev' in ctx) ctx.pPrev = s.p_dome ?? s.p_drum;
  for (const key of CONTEXT_NUMBERS) {
    if (Number.isFinite(blob.context?.[key])) ctx[key] = blob.context[key];
  }
  if (blob.rng) ctx.rng.restore(blob.rng);
  restoreJournal(engine, blob.learning);
  engine.reactivity.compute(s, engine.spec);
  if (session && blob.session) session.restore(blob.session);
  if (!ctx.trends && blob.trends) new TrendHistory(engine);
  if (ctx.trends) ctx.trends.restore(blob.trends, s.t_sim);
  return null;
}

export async function save(engine, scenarioId, slot = 'auto', runState, session) {
  const r = await api.writeSave(slot, pack(engine, scenarioId, runState, session));
  return r.ok;
}

export async function load(engine, slot = 'auto', runState) {
  const r = await api.readSave(slot);
  if (!r.ok || !r.data) return 'not_found';
  return apply(r.data, engine, runState);
}

export { api };
