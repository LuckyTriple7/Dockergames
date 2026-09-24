// Serverseitige Nachrechnung eines Laufs.
//
// Gegenstück zu main.js (boot() + loop.js), aber ohne Bild, ohne DOM,
// deshalb unter Node lauffähig (siehe verify_run.mjs). Baut dieselbe Engine
// wie ein echter Rundenstart auf, spielt das aufgezeichnete Protokoll durch
// dieselbe Session/RunState-Maschine noch einmal durch (game/session.js,
// game/scenario.js -- unverändert, kein zweiter Wortlaut der Wertung) und
// liefert die daraus errechnete Zusammenfassung zurück: dieselbe Form, die
// RunState.summary() im Browser liefert und die scoring.py/scoring.js
// erwarten.
//
// Determinismus ist keine Hoffnung, sondern eine geprüfte Eigenschaft der
// Engine (fester Zeitschritt DT, gesäter Zufall -- siehe rng.js, sim/
// state.js hash()): derselbe Startwert (Szenario-Seed) und dieselbe Folge
// von Rechenschritten und Bedienhandlungen ergeben bitgleich denselben
// Endzustand, ganz gleich ob im Browser aufgezeichnet oder hier
// nachgerechnet.

import { createEngine } from '../sim/engine.js';
import { Session, PHASE } from './session.js';
import { gridDeviationTrips } from './scenario.js';
import { CORE_ACTIONS } from './coreActions.js';
import { captureKit } from './replayKit.js';
import { isKnownHelper, runHelper } from './helper.js';

const DT = 0.05;
// Notbremse gegen ein Protokoll, das den Lauf nie enden lässt (z.B. wenn
// scenario.duration aus welchem Grund auch immer nicht erreicht wird) --
// 24 Stunden Sim-Zeit liegen weit über jedem Szenario (das längste dauert 6h).
const MAX_STEPS = Math.ceil((24 * 3600) / DT);

/**
 * @param {object} plant        wie von plants/index.js getPlant() geliefert
 * @param {object} scenarioDef  geladene Szenario-JSON (dieselbe Datei, die
 *                               der Client beim Rundenstart lädt)
 * @param {Array<{n:number, id:string, value:*}>} log  aufgezeichnetes
 *                               Protokoll, siehe game/recorder.js
 * @returns {object|null} dieselbe Form wie RunState.summary(), oder null,
 *                          wenn die Runde nie zu Ende gerechnet wurde (das
 *                          Protokoll allein reicht dafür nicht -- z.B. weil
 *                          es zu kurz abbricht)
 */
export function replayRun(plant, scenarioDef, log) {
  const isCold = !!scenarioDef.cold;
  const engine = createEngine(plant, {
    n: isCold ? 1e-6 : 1.0,
    cold: isCold,
    seed: scenarioDef.seed,
    extraTrips: gridDeviationTrips(scenarioDef),
  });

  // Typspezifische Bedienung: dieselbe hooks.uiControls()-Schnittstelle wie
  // im Browser, nur mit einem Kit, das keine Oberfläche baut, sondern die
  // Mutations-Funktionen einsammelt (siehe replayKit.js).
  const kitMap = {};
  if (plant.hooks.uiControls) {
    plant.hooks.uiControls(engine.state, engine.spec, engine.ctx, captureKit(kitMap));
  }

  const byStep = new Map();
  for (const a of log || []) {
    const n = a && Number.isInteger(a.n) ? a.n : null;
    // Check the whole log, including actions after the run would have ended.
    // `Object.hasOwn(a, 'id')` sieht neben dem Vergleich eine Zeile darueber
    // ueberfluessig aus und ist es nicht: ein GEERBTES `id` liest sich genau
    // wie ein eigenes, `a.id === 'helper'` ist also auch fuer
    // `Object.create({ id: 'helper' })` wahr. Ohne die Pruefung liefe so ein
    // Eintrag als Hilfestellung durch -- siehe tests/test-replay.mjs,
    // "inherited event properties".
    if (a && a.id === 'helper'
        && (!Object.hasOwn(a, 'id') || !Object.hasOwn(a, 'n') || !Object.hasOwn(a, 'value')
          || !Number.isSafeInteger(n) || n < 0 || n > MAX_STEPS
          || scenarioDef.guidance?.auto_helper === false || !isKnownHelper(plant.spec.id, a.value))) {
      if (scenarioDef.score_mode === 'incident_v1') return null;
      continue;
    }
    if (n === null || typeof a.id !== 'string') continue;
    if (!byStep.has(n)) byStep.set(n, []);
    byStep.get(n).push(a);
  }

  const applyDue = (n) => {
    for (const a of byStep.get(n) || []) {
      if (a.id === 'helper') { runHelper(engine, plant.spec.id, a.value); continue; }
      const fn = Object.hasOwn(kitMap, a.id) ? kitMap[a.id] : null;
      if (fn) { fn(a.value); continue; }
      const core = Object.hasOwn(CORE_ACTIONS, a.id) ? CORE_ACTIONS[a.id] : null;
      if (core) core(engine, a.value);
      // Unbekannte id: stillschweigend ignorieren, nicht abbrechen -- ein
      // Protokoll aus einer neueren Client-Version darf eine ältere
      // Server-Fassung nicht zum Absturz bringen, siehe helper.js runHelper()
      // fuer dieselbe Haltung an anderer Stelle.
    }
  };

  const session = new Session(engine, scenarioDef);
  session.start();
  applyDue(0);

  let n = 0;
  while (session.phase === PHASE.RUNNING && n < MAX_STEPS) {
    engine.step(DT);
    n++;
    session.step(DT, engine.trips.tiles(), engine.trips.unacknowledgedSeconds());
    applyDue(n);
  }

  return session.result ? session.result.summary : null;
}
