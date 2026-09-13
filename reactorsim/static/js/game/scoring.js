// Wertung.
//
// Diese Formel steht zweimal: hier und in scoring.py. Das ist Absicht und kein
// Versehen -- der Server darf dem Browser den Punktestand nicht glauben, also
// muss er ihn aus denselben Kennzahlen selbst ausrechnen. Wer hier etwas
// ändert, ändert dort dasselbe; ein Test vergleicht beide an festen Beispielen.
//
// Fassung 2: violation_seconds (Sekunden mit aktiver Meldetafel-Kachel, nach
// Schwere) ging vorher UNGEDECKELT und linear in die Wertung ein -- eine
// lange, im Kern beherrschte Schicht mit einer harmlosen Dauerwarnung (z.B.
// Graphittemperatur leicht ueber dem Normalband) sammelte so mehr Minus als
// ein kurzer Lauf, der in einer echten Katastrophe endete. Jetzt zaehlt der
// ANTEIL der Schichtdauer (violation_seconds[sev] / duration_s), gedeckelt je
// Schwere -- eine WARN-Kachel, die 25 % der Schicht ansteht, kostet
// unabhaengig davon, ob die Schicht eine oder vier Stunden dauerte, denselben
// Betrag.

export const WEIGHTS = {
  mission: 1000,          // Schicht laut Szenario abgeschlossen
  energy: 1000,            // x Anteil gelieferte/geforderte Energie
  deviationPerMwh: 2,
  deviationCap: 300,
  alarmPerSecond: 0.05,
  alarmCap: 100,
  // je Schwere: -min(Sekunden / Schichtdauer, 1.0) * Deckel
  violationCap: { 1: 100, 2: 300, 3: 1000 },
  scram: 500,
  fuelDamage: 5000,        // Kernzerstoerung (sim/engine.js lose())
  contFailed: 2500,        // SWR: Sicherheitsbehaelterversagen
  h2Exploded: 3000,        // SWR: Wasserstoffexplosion -- additiv zu contFailed,
                           // beides sind unabhaengig ausloesbare Ereignisse
  difficultyBonus: 250,
  floorNoScram: 500,
};

/** Rundet exakte .5-Werte immer von Null weg -- JavaScripts Math.round()
 *  rundet .5 immer aufwaerts (Math.round(-0.5) === 0), Pythons round()
 *  dagegen zur geraden Zahl (round(0.5) == 0). Server und Client MUESSEN
 *  hier identisch runden (siehe Dateikopf), sonst weicht der autoritative
 *  Server-Score vom Client-Vorschauwert ab, sobald ein Zwischenwert exakt
 *  auf eine halbe Zahl faellt (moeglich, da violations_warn & Co. mit
 *  Fliesskommazahlen rechnen). Eigener Name statt Math.round(), damit der
 *  Unterschied nicht unbemerkt zurueckkommt. */
export function roundScore(x) {
  return x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5);
}

/**
 * @param {object} sum Zusammenfassung aus RunState.summary()
 * @returns {{score:number, parts:object}} sum(parts) === score, IMMER exakt
 *   (siehe rounding_adjustment/floor_adjustment unten), nicht nur ungefaehr.
 */
export function score(sum) {
  const completed = !!sum.completed;
  const fuelDamage = !!sum.fuel_damage;
  const contFailed = !!sum.cont_failed;
  const h2Exploded = !!sum.h2_exploded;
  const scramCount = Number(sum.scram_count) || 0;

  const demanded = Math.max(Number(sum.energy_mwh_demanded) || 0, 1e-9);
  const ratio = Math.min((Number(sum.energy_mwh_delivered) || 0) / demanded, 1);
  // Tatsaechlich gespielte Zeit, NICHT die nominelle Szenariolaenge -- ein
  // nach 30 Minuten abgebrochener 4-Stunden-Lauf darf seine
  // Ueberschreitungssekunden nicht durch 14400 teilen.
  const duration = Math.max(Number(sum.duration_s) || 0, 1);

  const vs = (sum.violation_seconds && typeof sum.violation_seconds === 'object') ? sum.violation_seconds : {};
  const violationPart = (sev) => -Math.min((Number(vs[sev]) || 0) / duration, 1) * WEIGHTS.violationCap[sev];

  const parts = {
    mission: completed ? WEIGHTS.mission : 0,
    energy: WEIGHTS.energy * ratio,
    deviation: -Math.min((Number(sum.deviation_mwh) || 0) * WEIGHTS.deviationPerMwh, WEIGHTS.deviationCap),
    alarms: -Math.min((Number(sum.alarm_seconds_unacked) || 0) * WEIGHTS.alarmPerSecond, WEIGHTS.alarmCap),
    violations_info: violationPart(1),
    violations_warn: violationPart(2),
    violations_trip: violationPart(3),
    scram: -WEIGHTS.scram * scramCount,
    fuel: fuelDamage ? -WEIGHTS.fuelDamage : 0,
    cont_failed: contFailed ? -WEIGHTS.contFailed : 0,
    h2_exploded: h2Exploded ? -WEIGHTS.h2Exploded : 0,
    bonus: completed ? WEIGHTS.difficultyBonus * (Number(sum.difficulty) || 1) : 0,
  };

  // Runden passiert genau einmal, hier -- nicht als Teil eines Einzelpostens.
  let subtotal = 0;
  for (const v of Object.values(parts)) subtotal += v;
  const rawScore = roundScore(subtotal);
  parts.rounding_adjustment = rawScore - subtotal;
  let finalScore = rawScore;

  // Eine erfolgreich abgeschlossene, katastrophenfreie Schicht soll nicht
  // wegen bloss lange stehender Warnungen im Minus enden -- eine Katastrophe
  // (Kernschaden ODER Sicherheitsbehaelterversagen ODER Wasserstoffexplosion)
  // ist aber NIE "erfolgreich abgeschlossen", ganz gleich ob der
  // Schicht-Timer danach noch weiterlief.
  const catastrophic = fuelDamage || contFailed || h2Exploded;
  if (completed && !catastrophic) {
    finalScore = Math.max(finalScore, 0);
    if (scramCount === 0) finalScore = Math.max(finalScore, WEIGHTS.floorNoScram);
  }
  parts.floor_adjustment = finalScore - rawScore;

  return { score: finalScore, parts };
}
