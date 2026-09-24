// Jahreszeit des freien Spiels -- genauer: die Kühlwassertemperatur, die sie
// mitbringt.
//
// Bis hierher war `sp.condenser.T_cw` in allen drei Anlagendateien dieselbe
// Konstante (15 °C) und damit die einzige Randbedingung des Kraftwerks, die
// sich nie änderte. Das ist die eine Stelle, an der das Wetter physikalisch
// wirklich in die Anlage greift: das Kühlwasser setzt über die Grädigkeit des
// Kondensators den Gegendruck der Turbine, der Gegendruck setzt das nutzbare
// Enthalpiegefälle, und das Gefälle setzt die elektrische Leistung. Warmes
// Wasser heißt schlechteres Vakuum heißt weniger Megawatt -- bei gleicher
// thermischer Leistung, gleicher Stabstellung, gleichem allem.
//
// Deshalb ist der Sommer hier kein Schmuck, sondern eine Aufgabe: die
// Abendspitze der Tageslastkurve (19:00, voller Anteil der Nennleistung,
// siehe game/session.js) ist im Sommer mit dieser Anlage nicht mehr ganz zu
// decken. Wer sie trotzdem fahren will, muss die Lücke vorher sehen und dem
// Netz früher sagen, dass sie kommt -- nicht um 19:05 feststellen, dass die
// Stäbe schon oben sind.
//
// Warum das Wasser dem Kalender nachhinkt: ein Fluss oder See trägt die Wärme
// des Sommers in den Herbst hinein und die Kälte des Winters ins Frühjahr.
// Deshalb ist der Herbst hier WÄRMER als das Frühjahr, obwohl die Luft in
// beiden ähnlich ist. Das ist keine Willkür, sondern die Wärmekapazität des
// Wassers.
//
// Warum vier feste Stufen und kein Grad-Regler: die Zahl allein sagt
// niemandem etwas. "Sommer" sagt sofort, was einen erwartet.

const C = (c) => c + 273.15;

// Kühlwassereintrittstemperatur je Jahreszeit. Die 15 °C der Anlagendateien
// bleiben unangetastet -- sie sind weiterhin der Auslegungspunkt und gelten
// für jedes Szenario, dessen Zeitplan und Wertung auf genau diesem Punkt
// abgestimmt sind. Nur das freie Spiel wählt.
const TABLE = {
  winter: C(4),
  spring: C(12),
  summer: C(26),
  autumn: C(18),
};

export const SEASON_IDS = ['spring', 'summer', 'autumn', 'winter'];

/** Vorgabe im Startdialog. Das Frühjahr liegt nahe am Auslegungspunkt und
 *  etwas darunter -- ein freies Spiel ohne bewusste Wahl wird dadurch nicht
 *  schwerer als vorher, sondern eine Spur leichter. Wer den Sommer will,
 *  wählt ihn. */
export const DEFAULT_SEASON = 'spring';

/**
 * Kühlwassertemperatur einer Jahreszeit.
 * @param {object} spec   plant.spec -- liefert den Auslegungspunkt als Rückfall
 * @param {string} id     'spring' | 'summer' | 'autumn' | 'winter'
 * @returns {number} Temperatur in Kelvin
 */
export function seasonCoolingWater(spec, id) {
  if (Object.hasOwn(TABLE, id)) return TABLE[id];
  return spec && spec.condenser ? spec.condenser.T_cw : C(15);
}
