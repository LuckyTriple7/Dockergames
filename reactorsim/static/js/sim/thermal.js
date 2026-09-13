// Reduced thermal hydraulics. All flows in kg/s, heat in kW, energy in kJ.
import { clamp } from './constants.js';
import { hf, hfg, dpdT } from './steam.js';

/** An empty inventory cannot continue supplying a valve. */
export function availableFlow(mass, feed, requested, dt) {
  return Math.min(Math.max(requested, 0), Math.max(mass, 0) / dt + Math.max(feed, 0));
}

/** Saturated-vessel steam is bounded by both water and available heat above
 * the model's 1 bar lower boundary. No steam can be created by pressure clipping. */
export function availableSteam({ mass, feed, requested, dt, pressure, cp,
  metalCapacity, heat, feedEnthalpy }) {
  const capacity = (Math.max(mass, 0) * cp + metalCapacity) / dpdT(pressure);
  const stored = Math.max(0, pressure - 1) * capacity;
  const netHeat = heat + feed * (feedEnthalpy - hf(pressure));
  const energyLimit = Math.max(0, stored / dt + netHeat) / hfg(pressure);
  return availableFlow(mass, feed, Math.min(requested, energyLimit), dt);
}

/** Saturated, variable-mass control volume: Q + Win(hin-hf) - Wout*hfg.
 * Metal capacity remains when water drains; it is not additional water.
 * Pressure range is the reduced model's operating envelope, not a steam table
 * extrapolation. Clipping is exposed as rejected energy for diagnostics.
 */
export function saturatedPressure({ pressure, mass, cp, metalCapacity, heat,
  feed, feedEnthalpy, steam, extraCooling = 0, dt }) {
  const capacity = (Math.max(mass, 0) * cp + metalCapacity) / dpdT(pressure);
  const net = heat + feed * (feedEnthalpy - hf(pressure))
    - steam * hfg(pressure) - extraCooling;
  const proposed = pressure + net * dt / capacity;
  const next = clamp(proposed, 1, 110);
  return { pressure: next, rejectedKJ: (proposed - next) * capacity };
}

/** Smooth loss of wetted area, separate from the level instrument scale. */
export function coverage(mass, start, bottom = 0) {
  return clamp((mass - bottom) / (start - bottom), 0, 1);
}

/** Phenomenological boiling-crisis multiplier, not a licensed CHF correlation.
 * Above margin=1 the normal heat transfer remains unchanged. Below it the
 * wetted fraction falls continuously. Full dryout retains weak steam cooling.
 */
export function transferFraction(margin, covered = 1) {
  const wet = clamp(margin, 0, 1) ** 4 * clamp(covered, 0, 1) ** 2;
  return 0.0001 + 0.9999 * wet;
}
