// History-dependent decay heat in logarithmically spaced pseudo-groups.
// Approximate gameplay model; coefficients and limitations in constants.js.

import { DECAY_F, DECAY_L, relax } from './constants.js';

export const NDECAY = DECAY_F.length;

/** Gleichgewicht zu einer Dauerleistung. */
export function equilibriumDecay(n) {
  const D = new Float64Array(NDECAY);
  for (let j = 0; j < NDECAY; j++) D[j] = DECAY_F[j] * n;
  return D;
}

/**
 * @param {Float64Array} D  NDECAY Gruppen (wird verändert)
 * @param {number} n        relative neutronische Leistung
 * @param {number} dt       Sekunden
 * @returns {number} Nachzerfallswärme als Anteil der Nennleistung
 */
export function stepDecay(D, n, dt) {
  let sum = 0;
  for (let j = 0; j < NDECAY; j++) {
    D[j] = relax(D[j], DECAY_F[j] * n, dt, 1 / DECAY_L[j]);
    sum += D[j];
  }
  return sum;
}

export function decaySum(D) {
  let sum = 0;
  for (let j = 0; j < NDECAY; j++) sum += D[j];
  return sum;
}
