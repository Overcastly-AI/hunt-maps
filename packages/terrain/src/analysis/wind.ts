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
 * Leeward geometry is not the whole aspect story, though, and in cold weather it
 * is not even the dominant part: once snow and cold set in, deer move to the
 * faces that catch sun, and a purely leeward layer on a south wind in January
 * points at the north slope — the deepest snow on the property. `beddingLikelihood`
 * therefore blends leeward with solar aspect on a temperature ramp that is a
 * no-op above 5 °C. See `BeddingSeasonOptions`.
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
import { DEFAULT_RING_RADIUS_CELLS, ringSlopeStats, type RingSlopeStats } from './landform.js';

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

// ---------------------------------------------------------------------------
// Bedding likelihood
// ---------------------------------------------------------------------------

/**
 * Slope at which the pad term has fallen to half, in degrees.
 *
 * The shape here is the load-bearing decision, not the number. Rowland et al.
 * 2018 (*Wildlife Monographs* 199, elk, western Oregon/Washington) measure use
 * declining **5.3% per percent of slope, monotonically, with no interior
 * optimum** — a Gaussian with an interior peak is the one shape the best-measured
 * cervid slope response contradicts. So the pad term is monotone decreasing:
 * gentler is always better, all else equal, and "all else" is the ring term
 * below, which is what stops that preference from selecting the valley floor.
 *
 * The half-max point sits inside three independent bands that agree with each
 * other and disagree with the 22° this used to peak at: BC WHR whitetail winter
 * range 5.7–24.2° (centre 15°), elk daily use 8.5–16.7° (centre 12.5°), and
 * `detectBenches`' own pad definition of ≤8°. The failure this fixes is
 * user-facing and backwards: a 10° shelf used to score *lower* than a 22°
 * sidehill, so the flagship layer sent hunters past the bench to the open face.
 */
export const BEDDING_PAD_HALF_MAX_SLOPE_DEG = 12;

/**
 * Ring slope at which the "embedded in steep ground" term reaches half, degrees.
 *
 * A bed is a gentle pad *inside* steep ground: that is what gives a buck a
 * sightline downhill, a thermal advantage, and an exit nobody can follow. Slope
 * alone cannot express it — the same 8° reads as a bench, a ridge crown or the
 * middle of a hayfield. `detectBenches` requires ≥18° in a 16-direction ring;
 * this is the soft version of the same test, at the bottom of the BC WHR band so
 * that it credits ground the hard threshold would reject outright.
 */
export const BEDDING_RING_MIN_SLOPE_DEG = 15;

/**
 * Logistic width of the ring term, degrees. Purely a shape parameter: at 4° the
 * term runs from ~5% at 3° of surround to ~95% at 27°, so the transition spans
 * the "rolling farm ground → hill country" range rather than snapping at a
 * threshold. A hard threshold here would make the layer flicker cell-to-cell
 * along every break of slope.
 */
export const BEDDING_RING_SOFTNESS_DEG = 4;

/**
 * VRM at which the security-cover term saturates, dimensionless.
 *
 * VRM is `1 − |R|/n` over surface normals, which for small dispersion is
 * `≈ σ²/2` where σ is the RMS angular spread of those normals. 0.06 is therefore
 * "surface orientation varies by about ±20° within the window" — ground broken
 * enough to break a sightline at bedding range. Derived from that geometry, not
 * measured against deer locations; it wants field validation against known beds.
 */
export const BEDDING_VRM_FULL_COVER = 0.06;

/**
 * Above this air temperature the solar-aspect term is switched off entirely,
 * °C. Set at 5 °C so the season term is a **no-op through the entire early and
 * peak-rut season** — a Midwest October morning is 5–15 °C and the leeward
 * geometry alone is what a hunter wants there.
 */
export const BEDDING_COLD_ONSET_C = 5;

/**
 * At or below this temperature the solar-aspect term carries its full weight,
 * °C. −10 °C is a genuine winter-severity threshold, not a cold snap.
 */
export const BEDDING_SEVERE_COLD_C = -10;

/**
 * Maximum share of the aspect term given to sun rather than to lee.
 *
 * Four agencies (BC WHR, Ontario, Nova Scotia, Maine) prescribe south/west
 * aspects for winter deer range, and the mechanism is measured: 18.1 cm of snow
 * on the SE-facing slope against 42.0 cm on the NE-facing slope in the same
 * study area (Lang & Gates 1985). At 0.75, a fully sun-facing but windward slope
 * overtakes a fully leeward but shaded one at roughly **−7 °C** and below, and
 * lee still wins at every temperature above about 0 °C. Deep cold does not make
 * wind irrelevant — hence 0.75 and not 1 — it makes the sun the stronger of two
 * live requirements. The failure this prevents: on a south wind in January the
 * leeward-only term pointed at north-facing ground, the deepest snow and coldest
 * cell on the property, and presented it as the safe pick.
 */
export const BEDDING_MAX_SOLAR_ASPECT_WEIGHT = 0.75;

/**
 * Optional cold-season inputs for the aspect term.
 *
 * Both fields are required *together* if the caller supplies this at all. There
 * is deliberately no default season: assuming "winter" would silently move every
 * user's bedding layer to the sunny face in October, and assuming "not winter"
 * from a missing temperature is the bug being fixed. An unset season means the
 * function behaves exactly as leeward-only, and the UI is expected to say the
 * layer is running without a temperature rather than to imply it accounted for one.
 */
export interface BeddingSeasonOptions {
  /** Air temperature expected during the sit, °C. */
  temperatureC: number;
  /**
   * **Absolute** direct-beam incidence, `cos(incidence)` in [0, 1], per cell —
   * i.e. the output of `slopeInsolation(surface, sun)`, conventionally at solar
   * noon on the date being planned.
   *
   * It must be an absolute quantity, never a field normalised by its own
   * min/max: a per-tile normalisation makes the same hillside score differently
   * depending on which tile it lands in, which paints seams straight down the
   * middle of the bedding layer.
   */
  insolation: Float32Array;
  /** Override the temperature ramp; see the `BEDDING_*_C` constants. */
  coldOnsetC?: number;
  severeColdC?: number;
  maxSolarWeight?: number;
}

/**
 * Weight given to solar aspect over leeward aspect, 0..`maxSolarWeight`.
 *
 * Exported so callers can skip building an insolation field they would multiply
 * by zero, and so the ramp is pinned by tests independently of the composite.
 */
export function coldBlendWeight(
  temperatureC: number,
  options: Pick<BeddingSeasonOptions, 'coldOnsetC' | 'severeColdC' | 'maxSolarWeight'> = {},
): number {
  const onset = options.coldOnsetC ?? BEDDING_COLD_ONSET_C;
  const severe = options.severeColdC ?? BEDDING_SEVERE_COLD_C;
  const maxWeight = options.maxSolarWeight ?? BEDDING_MAX_SOLAR_ASPECT_WEIGHT;
  if (!Number.isFinite(temperatureC) || temperatureC >= onset) return 0;
  if (temperatureC <= severe) return maxWeight;
  return (maxWeight * (onset - temperatureC)) / (onset - severe);
}

export interface BeddingOptions {
  windFromDeg: number;
  /** Optional terrain-shelter field; strongly recommended. */
  shelter?: Float32Array;
  /**
   * Optional **Vector Ruggedness Measure** field (`computeVectorRuggedness`),
   * dimensionless 0..1, as the security-cover proxy.
   *
   * Not TRI. TRI is `g·s·√6` on a smooth plane, so feeding it here rewards steep
   * ground a second time on top of the slope terms below — see the note on
   * `computeRuggedness`.
   */
  vectorRuggedness?: Float32Array;
  /** Slope at which the pad term halves, degrees. */
  padHalfMaxSlopeDeg?: number;
  /** Ring slope at which the surround term reaches half, degrees. */
  ringMinSlopeDeg?: number;
  /** Logistic width of the surround term, degrees. */
  ringSoftnessDeg?: number;
  /** Ring radius in cells; shared with `detectBenches` by default. */
  ringRadiusCells?: number;
  /** VRM value at which the cover term saturates. */
  vrmFullCover?: number;
  /** Cold-season aspect inputs. Omit for leeward-only behaviour. */
  season?: BeddingSeasonOptions;
}

/**
 * Leeward bedding likelihood, 0..1 — the composite the map actually renders.
 *
 * Four things have to co-occur for a mature-buck bed, and each is a **separate
 * requirement**, so the score is multiplicative. An additive score would happily
 * rank an exposed flat with great cover as prime bedding.
 *
 *  1. **Aspect** — leeward of the wind (`cos(aspect − windFrom)`), blended
 *     toward *sun-facing* as it gets cold (see `BeddingSeasonOptions`).
 *  2. **Shelter** — something upwind actually tall enough to be in the lee of.
 *  3. **Position on the hill** — a gentle pad (monotone in slope, Rowland 2018)
 *     that is embedded in steep ground (the ring term). Together these describe
 *     a bench, a shoulder or a spur crown; separately, neither does.
 *  4. **Security cover** — dispersion of surface orientation (VRM), which is
 *     independent of slope by construction.
 *
 * Units: slopes in degrees; output dimensionless 0..1; `NaN` where the DEM has
 * no data. The ring term reads `SurfaceField` out to `ringRadiusCells`, and the
 * `ringSlopeStats` edge caveat applies at the tile border.
 */
export function beddingLikelihood(
  surface: SurfaceField,
  options: BeddingOptions,
): Float32Array {
  // Degenerate parameters are clamped rather than trusted: a half-max of 0 would
  // divide by zero and paint the entire tile as unbeddable without erroring.
  const padHalfMax = Math.max(0.1, options.padHalfMaxSlopeDeg ?? BEDDING_PAD_HALF_MAX_SLOPE_DEG);
  const ringMin = options.ringMinSlopeDeg ?? BEDDING_RING_MIN_SLOPE_DEG;
  const ringSoft = Math.max(1e-6, options.ringSoftnessDeg ?? BEDDING_RING_SOFTNESS_DEG);
  const ringRadius = Math.max(2, Math.round(options.ringRadiusCells ?? DEFAULT_RING_RADIUS_CELLS));
  const vrmFull = Math.max(1e-9, options.vrmFullCover ?? BEDDING_VRM_FULL_COVER);
  const exposure = windExposure(surface, options.windFromDeg);
  const { width, height } = surface;
  const n = surface.slope.length;

  // Season is opt-in and only engaged when it is genuinely cold. Resolving the
  // weight to exactly 0 here means the warm path is the *same arithmetic* as the
  // no-season path, not an approximation of it, so a caller that always passes a
  // temperature gets bit-identical output in October.
  const solarWeight = options.season
    ? coldBlendWeight(options.season.temperatureC, options.season)
    : 0;
  const insolation = solarWeight > 0 ? options.season?.insolation : undefined;
  if (insolation && insolation.length !== n) {
    throw new Error(
      `beddingLikelihood: season.insolation has length ${insolation.length}, expected ${n}`,
    );
  }
  const leeWeight = 1 - solarWeight;

  const out = new Float32Array(n);
  // Reused across cells — 65k short-lived objects per tile is real GC pressure
  // in a render loop.
  const ring: RingSlopeStats = { samples: 0, steepCount: 0, meanSlopeDeg: NaN };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const slope = surface.slope[i];
      if (!Number.isFinite(slope)) {
        out[i] = NaN;
        continue;
      }

      // Leeward term: exposure of -1 (fully leeward) → 1, +1 (windward) → 0.
      // A flat cell has no aspect, so `windExposure` returns 0 and this lands on
      // 0.5 — neither leeward nor windward, which is the honest answer.
      const lee = (1 - exposure[i]) / 2;
      const aspectTerm = insolation ? leeWeight * lee + solarWeight * clamp01(insolation[i]) : lee;

      // Pad term: monotone decreasing, half at `padHalfMax`. Never peaks in the
      // interior — that shape is what Rowland et al. 2018 measured against.
      const padTerm = 1 / (1 + (slope / padHalfMax) * (slope / padHalfMax));

      // Ring term: is that pad embedded in steep ground, or is it a field?
      // Falls back to the cell's own slope when the ring is entirely outside the
      // tile, which keeps a uniform hillside self-consistent at the border
      // instead of collapsing the term to "no surround".
      ringSlopeStats(surface, x, y, ringRadius, ringMin, 16, ring);
      const ringSlope = ring.samples > 0 ? ring.meanSlopeDeg : slope;
      const ringTerm = 1 / (1 + Math.exp(-(ringSlope - ringMin) / ringSoft));

      // Shelter term: without an upwind obstruction, "leeward" is meaningless.
      const shelterTerm = options.shelter ? 0.25 + 0.75 * clamp01(options.shelter[i]) : 1;

      // Cover term: orientation dispersion, deliberately slope-independent.
      const coverTerm = options.vectorRuggedness
        ? 0.4 + 0.6 * clamp01(options.vectorRuggedness[i] / vrmFull)
        : 1;

      out[i] = clamp01(aspectTerm * padTerm * ringTerm * shelterTerm * coverTerm);
    }
  }
  return out;
}

function clamp01(v: number): number {
  return !Number.isFinite(v) ? 0 : v < 0 ? 0 : v > 1 ? 1 : v;
}
