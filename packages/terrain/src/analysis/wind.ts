/**
 * Wind exposure, terrain shelter, and thermal modelling.
 *
 * ## The behaviour being modelled
 *
 * A mature buck beds where he can **watch downwind and smell upwind**. In hill
 * country that resolves to a specific, mappable signature: the leeward side of a
 * ridge, point, or bench, where the prevailing wind curls over the crest and
 * delivers scent from behind him while his eyes cover the open downhill side.
 * That is why "leeward" is not a vibe — it is `cos(aspect − windFrom)` and a
 * shelter term, and it can be computed for every cell on the map for any wind
 * direction the user dials in.
 *
 * Thermals are the other half, and they invert twice a day:
 *
 *  - **Morning / warming:** air rises upslope. Scent goes *up* the hill.
 *  - **Evening / cooling:** air sinks downslope and pools in draws and bottoms.
 *    Scent goes *down*, and it follows the drainage network, not the wind rose.
 *
 * Convergent terrain (negative plan curvature) channels sinking air, which is
 * why draws are scent superhighways in the evening and why a stand that is fine
 * at 08:00 is burnt at 17:00.
 */

import type { CurvatureField, SurfaceField } from './surface.js';
import { azimuthDelta } from './surface.js';

const RAD = Math.PI / 180;

export interface WindOptions {
  /** Direction the wind is coming FROM, degrees clockwise from north. */
  windFromDeg: number;
  /** Cells to look upwind when computing shelter. */
  shelterRadiusCells?: number;
}

/**
 * Windward/leeward index in [-1, 1].
 *
 *  +1 = the face points straight into the wind (windward, scent blown away
 *       from anything bedded there — deer avoid this for bedding)
 *  -1 = the face points straight downwind (leeward, in the lee of the crest —
 *       this is the bedding signature)
 *
 * Computed purely from aspect, so it is instantaneous for any wind the user
 * scrubs to. `terrainShelter` adds the part aspect cannot see: whether there is
 * actually anything upwind tall enough to be in the lee *of*.
 */
export function windExposure(surface: SurfaceField, windFromDeg: number): Float32Array {
  const n = surface.aspect.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const aspect = surface.aspect[i];
    if (aspect < 0 || !Number.isFinite(aspect)) {
      out[i] = 0;
      continue;
    }
    // Aspect is the downslope azimuth. A face whose downslope direction equals
    // the direction the wind comes from is pointing into the wind.
    out[i] = Math.cos(azimuthDelta(aspect, windFromDeg) * RAD);
  }
  return out;
}

/**
 * TOPEX-style terrain shelter, 0..1 (1 = fully sheltered).
 *
 * Marches upwind and takes the maximum horizon angle: a cell tucked below a
 * steep crest 40 m upwind is sheltered; a cell on an open plain with the same
 * aspect is not. Weighting the exposure index by this is what stops the leeward
 * layer from lighting up every gently south-tilted acre of a flat farm field.
 */
export function terrainShelter(
  heightAt: (x: number, y: number) => number,
  width: number,
  height: number,
  cellSize: number,
  windFromDeg: number,
  radiusCells = 20,
): Float32Array {
  const out = new Float32Array(width * height);
  const azRad = windFromDeg * RAD;
  // Step INTO the wind (toward where it comes from).
  const dx = Math.sin(azRad);
  const dy = -Math.cos(azRad);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const z0 = heightAt(x, y);
      if (!Number.isFinite(z0)) {
        out[y * width + x] = NaN;
        continue;
      }
      let maxAngle = 0;
      for (let r = 1; r <= radiusCells; r++) {
        const zr = heightAt(Math.round(x + dx * r), Math.round(y + dy * r));
        if (!Number.isFinite(zr)) continue;
        const angle = Math.atan2(zr - z0, r * cellSize);
        if (angle > maxAngle) maxAngle = angle;
      }
      // 30° of upwind horizon is treated as full shelter.
      out[y * width + x] = Math.min(1, maxAngle / (30 * RAD));
    }
  }
  return out;
}

export enum ThermalPhase {
  /** Sun on the slope, air warming and rising. Scent travels uphill. */
  Rising = 'rising',
  /** Cooling after sundown / before sunup. Scent sinks and pools. */
  Sinking = 'sinking',
  /** The switch. Unpredictable, swirling — the worst time to be moving. */
  Transition = 'transition',
}

export interface ThermalField {
  phase: ThermalPhase;
  /**
   * Azimuth scent is travelling, degrees clockwise from north, per cell.
   * Rising thermals move upslope (opposite of aspect); sinking move downslope
   * (along aspect).
   */
  scentAzimuth: Float32Array;
  /**
   * Strength 0..1. Scales with slope (steeper = stronger thermal) and, for
   * sinking thermals, with convergence — draws concentrate cold air.
   */
  strength: Float32Array;
}

export interface ThermalOptions {
  phase: ThermalPhase;
  /**
   * Optional per-cell insolation (from `slopeInsolation`). When supplied,
   * rising-thermal strength is scaled by how much sun the cell is actually
   * getting, which is what makes the "sunny face is already pumping while the
   * shaded face is still sinking" case fall out of the model correctly.
   */
  insolation?: Float32Array;
}

export function computeThermals(
  surface: SurfaceField,
  curvature: CurvatureField,
  options: ThermalOptions,
): ThermalField {
  const n = surface.aspect.length;
  const scentAzimuth = new Float32Array(n);
  const strength = new Float32Array(n);
  const { phase } = options;

  for (let i = 0; i < n; i++) {
    const aspect = surface.aspect[i];
    const slope = surface.slope[i];
    if (aspect < 0 || !Number.isFinite(slope)) {
      scentAzimuth[i] = -1;
      strength[i] = 0;
      continue;
    }

    scentAzimuth[i] =
      phase === ThermalPhase.Rising ? (aspect + 180) % 360 : aspect;

    // Slope drives the pressure gradient; saturate around 30°, past which
    // steeper ground does not meaningfully strengthen the thermal.
    let s = Math.min(1, slope / 30);

    if (phase === ThermalPhase.Sinking) {
      // Convergent (negative plan curvature) terrain funnels sinking air.
      const conv = curvature.plan[i];
      if (Number.isFinite(conv) && conv < 0) {
        s *= 1 + Math.min(1, Math.abs(conv) * 200);
      }
    } else if (phase === ThermalPhase.Rising && options.insolation) {
      s *= Math.max(0.1, options.insolation[i]);
    } else if (phase === ThermalPhase.Transition) {
      s *= 0.35;
    }

    strength[i] = Math.min(1, s);
  }

  return { phase, scentAzimuth, strength };
}

/**
 * Pick the thermal phase for a moment, given the day's sun times.
 *
 * The transition windows are deliberately wide (±45 min around sunrise and
 * sunset). Field consensus is that the switch is gradual and unreliable, and a
 * model that claims a crisp flip at sunrise would give users false confidence
 * during precisely the window that busts the most hunts.
 */
export function thermalPhaseAt(
  now: Date,
  sunrise: Date | null,
  sunset: Date | null,
  transitionMinutes = 45,
): ThermalPhase {
  if (!sunrise || !sunset) return ThermalPhase.Transition;
  const t = now.getTime();
  const w = transitionMinutes * 60000;
  if (Math.abs(t - sunrise.getTime()) <= w) return ThermalPhase.Transition;
  if (Math.abs(t - sunset.getTime()) <= w) return ThermalPhase.Transition;
  return t > sunrise.getTime() && t < sunset.getTime()
    ? ThermalPhase.Rising
    : ThermalPhase.Sinking;
}

/**
 * Leeward bedding likelihood, 0..1 — the composite the map actually renders.
 *
 * Combines the four things that have to co-occur for a buck bed:
 *  - leeward aspect (in the lee of the prevailing wind)
 *  - genuine terrain shelter upwind (something to be in the lee of)
 *  - a slope band he can actually lie on and still see downhill
 *  - broken ground for security cover
 *
 * Multiplicative, not additive: every term is a *requirement*, and an additive
 * score would happily rank an exposed flat with great cover as prime bedding.
 */
export interface BeddingOptions {
  windFromDeg: number;
  /** Optional terrain-shelter field; strongly recommended. */
  shelter?: Float32Array;
  /** Optional ruggedness (TRI, metres) as a security-cover proxy. */
  ruggedness?: Float32Array;
  /** Ideal bedding slope in degrees. Deer bed on grade, not on cliffs. */
  idealSlopeDeg?: number;
  /** Tolerance around the ideal slope. */
  slopeToleranceDeg?: number;
}

export function beddingLikelihood(
  surface: SurfaceField,
  options: BeddingOptions,
): Float32Array {
  const ideal = options.idealSlopeDeg ?? 22;
  const tol = options.slopeToleranceDeg ?? 14;
  const exposure = windExposure(surface, options.windFromDeg);
  const n = surface.slope.length;
  const out = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const slope = surface.slope[i];
    if (!Number.isFinite(slope)) {
      out[i] = NaN;
      continue;
    }

    // Leeward term: exposure of -1 (fully leeward) → 1, +1 (windward) → 0.
    const lee = (1 - exposure[i]) / 2;

    // Slope term: Gaussian around the ideal bedding grade.
    const d = (slope - ideal) / tol;
    const slopeTerm = Math.exp(-0.5 * d * d);

    // Shelter term: without an upwind obstruction, "leeward" is meaningless.
    const shelterTerm = options.shelter ? 0.25 + 0.75 * clamp01(options.shelter[i]) : 1;

    // Cover term: 4 m of local relief in a 3x3 is plenty of broken ground.
    const coverTerm = options.ruggedness
      ? 0.4 + 0.6 * clamp01(options.ruggedness[i] / 4)
      : 1;

    out[i] = clamp01(lee * slopeTerm * shelterTerm * coverTerm);
  }
  return out;
}

function clamp01(v: number): number {
  return !Number.isFinite(v) ? 0 : v < 0 ? 0 : v > 1 ? 1 : v;
}
