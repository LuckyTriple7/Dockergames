// Ein Bild des Leitstands fuer ein zweites Geraet.
//
// Die Simulation laeuft ausschliesslich im Browser des Spielers (siehe
// loop.js). Ein Monitor auf einem zweiten Bildschirm kann deshalb nicht
// "mitrechnen" -- zwei Engines mit zwei Bildraten laufen auseinander, genau
// das schliesst verify_run.mjs sonst aus. Er bekommt den Zustand geschickt.
//
// Geschickt wird derselbe Zustand, den auch ein Spielstand traegt: packState()
// und packComponents() kommen unveraendert aus net/persist.js. Der Unterschied
// liegt in dem, was NICHT mitkommt -- Trendhistorie (bis 28.800 Abtastungen),
// Lernprotokoll, Zufallszahlenstand, Wertungsstand. Die sind fuer eine Anzeige
// wertlos und wuerden das Bild um Groessenordnungen aufblaehen; die Trendkurve
// baut sich der Monitor aus den ankommenden Bildern selbst (siehe monitor.js).
//
// Kein Rueckweg: ein Bild geht vom Leitstand zum Monitor, nie umgekehrt. Der
// Monitor kann die Anlage nicht anfassen, auch nicht versehentlich.

import { numbers } from '../sim/state.js';
import {
  packState, packComponents, restoreComponents, CONTEXT_NUMBERS, NESTED_STATE,
} from './persist.js';

/** Steigt bei jeder Formataenderung. Sender und Empfaenger sind immer
 *  derselbe Auslieferungsstand (beide holen ihr JS unter /s/<version>/), ein
 *  Unterschied kann deshalb nur ein stehen gebliebener Reiter sein -- der
 *  bekommt eine ehrliche Meldung statt stiller Falschanzeige. */
export const FRAME_VERSION = 1;

/** Volles Meldungsprotokoll nur jedes n-te Bild. Es aendert sich selten
 *  (Alarme sind Ereignisse, keine Messwerte), waere aber mit 120 Eintraegen
 *  das groesste Einzelfeld. Ein Monitor, der mitten im Lauf dazukommt, sieht
 *  das Protokoll also hoechstens HISTORY_EVERY Bilder spaeter -- die Kurve
 *  und die Instrumente stehen sofort. */
const HISTORY_EVERY = 10;

/**
 * Ein Bild packen.
 *
 * @param {object} engine
 * @param {object} meta Kopfdaten, die nicht im Zustand stehen: laufende
 *   Kennung, Szenario, Zeitraffer, Sichtbarkeit des Leitstandfensters.
 * @param {number} seq Laufende Nummer, vom Sender vergeben.
 */
export function packFrame(engine, meta, seq) {
  const s = engine.state;
  const ctx = engine.ctx;
  return {
    v: FRAME_VERSION,
    seq,
    reactor: s.reactor,
    t_sim: s.t_sim,
    state: packState(s),
    context: Object.fromEntries(CONTEXT_NUMBERS
      .filter((key) => Number.isFinite(ctx[key]))
      .map((key) => [key, ctx[key]])),
    components: packComponents(ctx),
    trips: ctx.trips.snapshot(),
    // Der Nachlauf haengt als Objekt an engine.state und faellt deshalb
    // durch packState() (das nimmt Zahlen, Merker und die drei Bloecke aus
    // NESTED_STATE). Ohne ihn zeigte der Monitor den abgehobenen Schild nie
    // -- weder im Fliessbild (mimic.js: data-aftermath) noch als Klang
    // (game/endSounds.js). Das Feld ist klein und aendert sich genau
    // zweimal je Lauf.
    ...(s.aftermath ? { aftermath: { ...s.aftermath } } : {}),
    // Die Reaktivitaet wird MITGESCHICKT und nicht drueben nachgerechnet.
    // Sie ist die einzige Anzeigegroesse, die nicht aus dem Zustand allein
    // folgt: engine.step() bildet sie VOR der Vergiftung, derive() liest sie
    // DANACH (siehe sim/engine.js, Schritte 1 bis 7). Wer sie aus dem
    // fertigen Zustand neu bildet, bekommt einen Wert, den der Leitstand so
    // nie angezeigt hat -- gemessen rund 4e-6 daneben, sichtbar erst in der
    // Aufschluesselung, aber eben falsch. Ein Monitor, der etwas anderes
    // zeigt als der Schirm daneben, ist schlimmer als keiner.
    reactivity: { total: engine.reactivity.total, breakdown: { ...engine.reactivity.breakdown } },
    ...(seq % HISTORY_EVERY === 0 ? { history: ctx.history } : {}),
    meta,
  };
}

/**
 * Ein Bild in eine Engine schreiben, die nie selbst rechnet.
 *
 * Bewusst strenger als apply() in persist.js: dort muessen auch Spielstaende
 * aelterer Ausgaben noch hineinpassen, hier kommt das Bild garantiert aus
 * demselben Auslieferungsstand. Was nicht passt, ist deshalb ein Fehler und
 * keine Altlast.
 *
 * @returns {string|null} Fehlergrund, oder null bei Erfolg
 */
export function applyFrame(frame, engine) {
  if (!frame || frame.v !== FRAME_VERSION) return 'version';
  if (frame.reactor !== engine.state.reactor) return 'reactor';
  const src = frame.state;
  if (!src || typeof src !== 'object') return 'shape';

  // Erst vollstaendig pruefen, dann erst schreiben -- dieselbe Regel wie beim
  // Spielstand: ein halb angewandtes Bild waere schlimmer als gar keines.
  for (const [k, v] of Object.entries(src)) {
    if (Array.isArray(v)) {
      if (v.some((x) => typeof x !== 'number' || !Number.isFinite(x))) return `array:${k}`;
    } else if (typeof v === 'number' && !Number.isFinite(v)) return `number:${k}`;
  }

  const s = engine.state;
  for (const [k, v] of Object.entries(src)) {
    const cur = s[k];
    if (cur instanceof Float64Array && Array.isArray(v) && v.length === cur.length) cur.set(v);
    else if (typeof cur === 'number' && typeof v === 'number') s[k] = v;
    else if (typeof cur === 'boolean' && typeof v === 'boolean') s[k] = v;
  }
  if (src.scram && typeof src.scram === 'object') {
    s.scram = {
      active: !!src.scram.active,
      t: Number(src.scram.t) || 0,
      cause: src.scram.cause || null,
    };
  }
  for (const key of NESTED_STATE) {
    if (!s[key] || !src[key]) continue;
    for (const [field, value] of Object.entries(src[key])) {
      if ((typeof s[key][field] === 'number' && Number.isFinite(value))
        || (typeof s[key][field] === 'boolean' && typeof value === 'boolean')) {
        s[key][field] = value;
      }
    }
  }
  if (s.tipArmed && Array.isArray(src.tipArmed) && src.tipArmed.length === s.tipArmed.length) {
    s.tipArmed = [...src.tipArmed];
  }
  // destroyedKey faellt beim Wechsel auf eine heile Anlage NICHT von selbst
  // weg -- das Feld fehlt dann im Bild. Ein Monitor baut seine Engine bei
  // jedem neuen Lauf ohnehin neu (siehe monitor.js), aber innerhalb eines
  // Laufs soll ein einmal gesetzter Grund auch nicht stumm verschwinden.
  if (typeof src.destroyedKey === 'string') s.destroyedKey = src.destroyedKey;

  // Nachlauf: nur Zahlen und Merker uebernehmen, und nur die Felder, die
  // startAftermath() selbst anlegt -- der Block kommt von einem anderen
  // Browser, und eine Anzeige ist kein Grund, ihm fremde Schluessel zu
  // glauben.
  if (frame.aftermath && typeof frame.aftermath === 'object') {
    const a = frame.aftermath;
    s.aftermath = {
      cause: typeof a.cause === 'string' ? a.cause : null,
      t0: Number(a.t0) || 0,
      energy_J: Number(a.energy_J) || 0,
      steam_kg: Number(a.steam_kg) || 0,
      water_kg: Number(a.water_kg) || 0,
      work_J: Number(a.work_J) || 0,
      lift_bar: Number(a.lift_bar) || 0,
      share: Number(a.share) || 0,
      lid: a.lid === null ? null : !!a.lid,
      done: !!a.done,
    };
  }

  restoreComponents(engine.ctx, frame.components);
  if (numbers(s).some((x) => !Number.isFinite(x))) return 'not_finite';

  const ctx = engine.ctx;
  for (const key of CONTEXT_NUMBERS) {
    if (Number.isFinite(frame.context?.[key])) ctx[key] = frame.context[key];
  }
  ctx.trips.restore(frame.trips);

  // Reaktivitaet uebernehmen statt neu bilden -- siehe packFrame(). Nur
  // Kennungen, die es in DIESER Engine gibt: ein Bild eines anderen Typs ist
  // oben schon abgewiesen, aber ein Szenario-Beitrag aus einem Lauf mit
  // anderen Haken waere sonst ein stiller neuer Balken.
  const rx = frame.reactivity;
  if (rx && typeof rx === 'object' && Number.isFinite(rx.total)) {
    engine.reactivity.total = rx.total;
    for (const key of Object.keys(engine.reactivity.breakdown)) {
      const v = rx.breakdown?.[key];
      if (Number.isFinite(v)) engine.reactivity.breakdown[key] = v;
    }
  } else {
    // Ein Bild ohne Aufschluesselung ist kein Grund, gar nichts zu zeigen.
    engine.reactivity.compute(s, engine.spec);
  }
  return null;
}
