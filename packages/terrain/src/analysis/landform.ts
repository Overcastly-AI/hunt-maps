/**
 * Landform classification — the layer that turns a DEM into hunting language.
 *
 * Two independent classifiers, because they answer different questions and
 * hunters use both:
 *
 *  - **Weiss (2001) multi-scale TPI** answers *"where does this cell sit in the
 *    landscape?"* — canyon bottom, midslope drainage, bench, midslope ridge,
 *    mountaintop. The two-scale trick is the whole point: a single TPI cannot
 *    tell a small ridge inside a big valley from a big ridge, and that
 *    distinction is exactly what separates a doe-bedding finger from a
 *    windswept summit nobody beds on.
 *  - **Wood (1996) morphometric features** answers *"what shape is this cell?"*
 *    — peak, pit, pass (saddle), ridge, channel, planar. This is where **saddle
 *    detection** comes from, and saddles are the single highest-value terrain
 *    feature in whitetail hunting: deer cross ridges through them because it
 *    costs less energy than going over the top.
 *
 * Both are computed from the same grid so their outputs are directly comparable
 * cell-for-cell, and both are exposed as toggleable map layers.
 */

import { HeightGrid } from '../dem/grid.js';
import type { CurvatureField, SurfaceField } from './surface.js';

// ---------------------------------------------------------------------------
// Topographic Position Index
// ---------------------------------------------------------------------------

export interface TpiOptions {
  /**
   * Neighbourhood radius in **cells**. Use `annulusInner > 0` to compare against
   * a ring rather than a disc — a ring ignores the immediate neighbourhood and
   * responds to landscape position instead of local roughness.
   */
  radius: number;
  annulusInner?: number;
}

/**
 * TPI = z(cell) − mean(z) over the neighbourhood.
 *
 * Implemented with a summed-area table so cost is O(n) regardless of radius —
 * a 60-cell radius on a 256² tile would otherwise be ~1.8 billion reads per
 * tile, which is not something you can do in a render loop.
 *
 * The annulus variant subtracts a smaller square's integral from a larger one,
 * which approximates a ring with squares. That approximation is standard
 * practice (Jenness' TPI toolbox does the same) and the classification
 * thresholds are z-scored afterwards, so the shape bias washes out.
 */
export function computeTpi(grid: HeightGrid, options: TpiOptions): Float32Array {
  const { width, height } = grid;
  const r = Math.max(1, Math.round(options.radius));
  const inner = Math.max(0, Math.round(options.annulusInner ?? 0));

  // Summed-area table over the padded region we can legally read.
  const pad = r;
  const sw = width + 2 * pad;
  const sh = height + 2 * pad;
  const sat = new Float64Array((sw + 1) * (sh + 1));
  for (let y = 0; y < sh; y++) {
    let rowSum = 0;
    for (let x = 0; x < sw; x++) {
      rowSum += grid.get(x - pad, y - pad);
      sat[(y + 1) * (sw + 1) + (x + 1)] = sat[y * (sw + 1) + (x + 1)] + rowSum;
    }
  }

  const boxSum = (x0: number, y0: number, x1: number, y1: number): number => {
    // Inclusive interior coords → SAT coords.
    const ax = clampInt(x0 + pad, 0, sw);
    const ay = clampInt(y0 + pad, 0, sh);
    const bx = clampInt(x1 + pad + 1, 0, sw);
    const by = clampInt(y1 + pad + 1, 0, sh);
    return (
      sat[by * (sw + 1) + bx] -
      sat[ay * (sw + 1) + bx] -
      sat[by * (sw + 1) + ax] +
      sat[ay * (sw + 1) + ax]
    );
  };
  const boxCount = (x0: number, y0: number, x1: number, y1: number): number => {
    const ax = clampInt(x0 + pad, 0, sw);
    const ay = clampInt(y0 + pad, 0, sh);
    const bx = clampInt(x1 + pad + 1, 0, sw);
    const by = clampInt(y1 + pad + 1, 0, sh);
    return Math.max(0, bx - ax) * Math.max(0, by - ay);
  };

  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!grid.hasData(x, y)) {
        out[i] = NaN;
        continue;
      }
      let sum = boxSum(x - r, y - r, x + r, y + r);
      let count = boxCount(x - r, y - r, x + r, y + r);
      if (inner > 0) {
        sum -= boxSum(x - inner, y - inner, x + inner, y + inner);
        count -= boxCount(x - inner, y - inner, x + inner, y + inner);
      }
      out[i] = count > 0 ? grid.get(x, y) - sum / count : 0;
    }
  }
  return out;
}

/**
 * Standardise a field to z-scores, ignoring NaN. Weiss thresholds are in σ.
 *
 * ## The degenerate case, and why it needs an explicit guard
 *
 * Dividing by σ is exactly what makes Weiss classification scale-free, and
 * exactly what makes it explode when σ → 0. On genuinely uniform ground — a
 * flat ag field, a lake surface, a laser-flat clearcut, or any smooth quadratic
 * surface (where TPI is provably *constant*) — the only variation left in the
 * field is float32 rounding noise at the 1e-4 m level. Standardising that
 * produces z-scores of ±1σ from nothing, and the map speckles into random
 * "ridge"/"canyon" cells across terrain a hunter can see is flat. That is a
 * visible, trust-destroying defect, not a rounding curiosity.
 *
 * So: if the spread is below the precision of the source data, the field is
 * reported as uniformly zero (i.e. "no cell stands out"), which is the truthful
 * answer. The default floor of 1 mm sits an order of magnitude below Terrarium's
 * 1/256 m quantum, so it can never suppress signal a real DEM could carry.
 */
export function standardize(field: Float32Array, minSigma = 1e-3): Float32Array {
  let sum = 0;
  let count = 0;
  for (const v of field) {
    if (Number.isFinite(v)) {
      sum += v;
      count++;
    }
  }
  const out = new Float32Array(field.length);
  if (count === 0) return out;

  const mean = sum / count;
  let varSum = 0;
  for (const v of field) {
    if (Number.isFinite(v)) varSum += (v - mean) * (v - mean);
  }
  const sd = Math.sqrt(varSum / count);
  if (!(sd > minSigma)) {
    // Uniform within the noise floor. Preserve NaN so downstream classifiers
    // still see no-data as no-data rather than as "average".
    for (let i = 0; i < field.length; i++) {
      out[i] = Number.isFinite(field[i]) ? 0 : NaN;
    }
    return out;
  }

  for (let i = 0; i < field.length; i++) {
    out[i] = Number.isFinite(field[i]) ? (field[i] - mean) / sd : NaN;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Weiss 10-class landform
// ---------------------------------------------------------------------------

export enum WeissLandform {
  Unknown = 0,
  /** Deeply incised drainage bottom. Thermal sink; travel route in dry country. */
  Canyon = 1,
  /** Midslope drainage / shallow valley — the classic whitetail travel channel. */
  MidslopeDrainage = 2,
  /** Upland drainage, headwater bowl. Bedding when it holds cover. */
  UplandDrainage = 3,
  /** Broad U-shaped valley floor. */
  UShapedValley = 4,
  /** Plain — low relief, low slope. */
  Plain = 5,
  /** Open slope — the connective tissue between everything else. */
  OpenSlope = 6,
  /** Upper slope / mesa shoulder. */
  UpperSlope = 7,
  /** Local ridge or hill sitting inside a valley — high-value bedding island. */
  LocalRidgeInValley = 8,
  /** Midslope ridge / spur / point. Prime buck bedding when leeward. */
  MidslopeRidge = 9,
  /** Mountaintop or high ridge. */
  MountainTop = 10,
}

export const WEISS_LABELS: Record<WeissLandform, string> = {
  [WeissLandform.Unknown]: 'Unknown',
  [WeissLandform.Canyon]: 'Canyon / incised drainage',
  [WeissLandform.MidslopeDrainage]: 'Midslope drainage',
  [WeissLandform.UplandDrainage]: 'Upland drainage / headwater',
  [WeissLandform.UShapedValley]: 'U-shaped valley',
  [WeissLandform.Plain]: 'Plain',
  [WeissLandform.OpenSlope]: 'Open slope',
  [WeissLandform.UpperSlope]: 'Upper slope / mesa',
  [WeissLandform.LocalRidgeInValley]: 'Local ridge in valley',
  [WeissLandform.MidslopeRidge]: 'Midslope ridge / spur',
  [WeissLandform.MountainTop]: 'Mountain top / high ridge',
};

export interface WeissOptions {
  /** Small-neighbourhood radius in cells (fine landform). */
  smallRadius?: number;
  /** Large-neighbourhood radius in cells (landscape position). */
  largeRadius?: number;
  /** Slope threshold in degrees separating Plain from Open slope. */
  plainSlopeDeg?: number;
}

export function classifyWeiss(
  grid: HeightGrid,
  surface: SurfaceField,
  options: WeissOptions = {},
): Uint8Array {
  const smallRadius = options.smallRadius ?? 3;
  const largeRadius = options.largeRadius ?? 20;
  const plainSlope = options.plainSlopeDeg ?? 5;

  const sn = standardize(computeTpi(grid, { radius: smallRadius }));
  const ln = standardize(computeTpi(grid, { radius: largeRadius }));

  const out = new Uint8Array(sn.length);
  for (let i = 0; i < sn.length; i++) {
    const s = sn[i];
    const l = ln[i];
    if (!Number.isFinite(s) || !Number.isFinite(l)) {
      out[i] = WeissLandform.Unknown;
      continue;
    }
    const sLow = s <= -1;
    const sHigh = s >= 1;
    const lLow = l <= -1;
    const lHigh = l >= 1;

    if (sLow && lLow) out[i] = WeissLandform.Canyon;
    else if (sLow && !lLow && !lHigh) out[i] = WeissLandform.MidslopeDrainage;
    else if (sLow && lHigh) out[i] = WeissLandform.UplandDrainage;
    else if (!sLow && !sHigh && lLow) out[i] = WeissLandform.UShapedValley;
    else if (!sLow && !sHigh && !lLow && !lHigh)
      out[i] = surface.slope[i] <= plainSlope ? WeissLandform.Plain : WeissLandform.OpenSlope;
    else if (!sLow && !sHigh && lHigh) out[i] = WeissLandform.UpperSlope;
    else if (sHigh && lLow) out[i] = WeissLandform.LocalRidgeInValley;
    else if (sHigh && !lLow && !lHigh) out[i] = WeissLandform.MidslopeRidge;
    else out[i] = WeissLandform.MountainTop;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Wood morphometric features — where saddles come from
// ---------------------------------------------------------------------------

export enum WoodFeature {
  Planar = 0,
  Pit = 1,
  Channel = 2,
  /** A pass/col. In hunting terms: a **saddle**. */
  Pass = 3,
  Ridge = 4,
  Peak = 5,
}

export const WOOD_LABELS: Record<WoodFeature, string> = {
  [WoodFeature.Planar]: 'Planar slope',
  [WoodFeature.Pit]: 'Pit / sink',
  [WoodFeature.Channel]: 'Channel / draw',
  [WoodFeature.Pass]: 'Saddle (pass)',
  [WoodFeature.Ridge]: 'Ridge / spur',
  [WoodFeature.Peak]: 'Peak / knob',
};

export interface WoodOptions {
  /** Below this slope a cell is treated as "flat enough" to be a peak/pit/pass. */
  slopeToleranceDeg?: number;
  /**
   * Explicit curvature threshold in 1/m. Overrides the scale-aware default.
   * Prefer supplying `cellSize` instead — see `gradientChangePerCell`.
   */
  curvatureTolerance?: number;
  /** Grid resolution in metres. Enables the scale-aware default threshold. */
  cellSize?: number;
  /**
   * The real parameter: how much the across-slope gradient must change **per
   * cell** before a cell counts as a ridge or a channel rather than a plain
   * slope. Dimensionless, default 0.015 (a 1.5% grade change per cell).
   *
   * ## Why the threshold cannot be a fixed curvature
   *
   * Curvature has units of 1/m, so its magnitude depends on grid resolution:
   * the same hillside sampled at 4 m and at 15 m produces curvature values
   * differing by roughly the resolution ratio. A single hard-coded tolerance
   * therefore means something different at every zoom level.
   *
   * Measured on real terrain (Hocking Hills, Ohio, 3.7 m cells), the original
   * fixed 5e-4 classified **only 8.4% of cells as planar** — 91% of the map came
   * out ridge or channel. That is not a map, it is confetti, and real saddles
   * were invisible inside it. Gradient is approximately scale-invariant on real
   * terrain, so curvature scales as ~1/cellSize; dividing a dimensionless
   * gradient-change budget by the cell size restores a stable classification
   * across zooms.
   *
   * At the default, that same tile comes out ~56% planar, ~20% channel,
   * ~24% ridge — a readable map in which draws and spurs are the exception, as
   * they are on the ground.
   *
   * **Known limitation:** the constant is calibrated on dissected-plateau
   * terrain. A coarse DEM over low-relief farmland still classifies more
   * ridge/channel than it should, because resampling noise dominates real
   * curvature there. A noise floor tied to DEM vertical accuracy would fix it
   * (backlog N14).
   */
  gradientChangePerCell?: number;
}

/**
 * Wood's six morphometric features, following the `r.param.scale` formulation.
 *
 * The curvature tolerance is the parameter that decides whether this layer is
 * usable. Too tight and the map becomes ridge/channel speckle with real saddles
 * lost inside it; too loose and genuine features vanish. It is resolution-
 * dependent, so it is derived from `cellSize` rather than fixed — see
 * `WoodOptions.gradientChangePerCell` for the measurement behind that.
 */
/**
 * Resolve the curvature threshold, preferring an explicit override, then the
 * scale-aware derivation, then a last-resort constant.
 *
 * The constant is deliberately the worst option: it is only correct at one
 * resolution, and callers that hit it are getting a classification whose
 * meaning shifts with zoom.
 */
export function resolveCurvatureTolerance(options: WoodOptions): number {
  if (options.curvatureTolerance !== undefined) return options.curvatureTolerance;
  const cellSize = options.cellSize;
  if (cellSize !== undefined && cellSize > 0) {
    return (options.gradientChangePerCell ?? 0.015) / cellSize;
  }
  return 0.0005;
}

export function classifyWood(
  surface: SurfaceField,
  curvature: CurvatureField,
  options: WoodOptions = {},
): Uint8Array {
  const slopeTol = options.slopeToleranceDeg ?? 1.5;
  const curvTol = resolveCurvatureTolerance(options);
  const n = surface.slope.length;
  const out = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const slope = surface.slope[i];
    if (!Number.isFinite(slope)) {
      out[i] = WoodFeature.Planar;
      continue;
    }
    const cross = curvature.crossSectional[i];
    const maxC = curvature.maxCurvature[i];
    const minC = curvature.minCurvature[i];

    if (slope > slopeTol) {
      // On a real slope, the across-slope curvature decides: convex across the
      // fall line is a spur, concave across it is a draw.
      if (cross > curvTol) out[i] = WoodFeature.Ridge;
      else if (cross < -curvTol) out[i] = WoodFeature.Channel;
      else out[i] = WoodFeature.Planar;
    } else {
      // Near-flat: use the principal curvatures. Opposite signs = a col, i.e.
      // the surface falls away in one direction and rises in the perpendicular
      // one. That is a saddle.
      const maxUp = maxC > curvTol;
      const maxDown = maxC < -curvTol;
      const minUp = minC > curvTol;
      const minDown = minC < -curvTol;
      if (maxUp && minUp) out[i] = WoodFeature.Peak;
      else if (maxDown && minDown) out[i] = WoodFeature.Pit;
      else if (maxUp && minDown) out[i] = WoodFeature.Pass;
      else if (maxUp || minUp) out[i] = WoodFeature.Ridge;
      else if (maxDown || minDown) out[i] = WoodFeature.Channel;
      else out[i] = WoodFeature.Planar;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Benches
// ---------------------------------------------------------------------------

export interface BenchOptions {
  /** A bench cell must itself be gentler than this (degrees). */
  maxBenchSlopeDeg?: number;
  /** The surrounding ring must average steeper than this (degrees). */
  minSurroundSlopeDeg?: number;
  /** Ring radius in cells over which "surrounding" is measured. */
  ringRadius?: number;
  /** Minimum contiguous cell count to survive as a bench. */
  minCells?: number;
}

/**
 * Bench detection — flat shelves embedded in steep ground.
 *
 * No standard GIS tool ships this, but it is arguably the highest-value derived
 * layer for hill-country deer: benches are where bucks bed, and marking every
 * bench then connecting them is the standard "speed scouting" technique. We
 * define a bench as a cell that is locally gentle while its surrounding ring is
 * steep — which is precisely the shelf-on-a-hillside signature, and correctly
 * rejects valley floors (gentle cell, gentle ring) and ridge tops (gentle cell,
 * but the ring is gentle on at least one side too, once `ringRadius` is large
 * enough to reach past the crest).
 */
export function detectBenches(
  grid: HeightGrid,
  surface: SurfaceField,
  options: BenchOptions = {},
): Uint8Array {
  const maxBench = options.maxBenchSlopeDeg ?? 8;
  const minSurround = options.minSurroundSlopeDeg ?? 18;
  const ring = Math.max(2, Math.round(options.ringRadius ?? DEFAULT_RING_RADIUS_CELLS));
  const minCells = options.minCells ?? 6;

  const { width, height } = grid;
  const flag = new Uint8Array(width * height);
  // One reused stats object: this is a per-cell inner loop in a render budget.
  const r: RingSlopeStats = { samples: 0, steepCount: 0, meanSlopeDeg: NaN };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const s = surface.slope[i];
      if (!Number.isFinite(s) || s > maxBench) continue;

      ringSlopeStats(surface, x, y, ring, minSurround, 16, r);
      // At least half the ring must be steep — a shelf is steep above and below
      // but typically open along the contour.
      if (r.samples >= 8 && r.steepCount / r.samples >= 0.5) flag[i] = 1;
    }
  }

  return minCells > 1 ? removeSmallBlobs(flag, width, height, minCells) : flag;
}

/**
 * Default ring radius in cells for "is this pad embedded in steep ground?".
 *
 * Shared by `detectBenches` and the bedding slope term so the two layers cannot
 * disagree about what counts as a shelf. They did disagree once — bedding peaked
 * at a uniform 22° sidehill while `detectBenches` required a ≤8° pad inside a
 * ≥18° ring — which put the flagship bedding layer's maximum on exactly the
 * ground the bench layer rejects.
 */
export const DEFAULT_RING_RADIUS_CELLS = 8;

export interface RingSlopeStats {
  /** Ring directions that landed inside the grid and had data. */
  samples: number;
  /** How many of those were at or above the steep threshold. */
  steepCount: number;
  /** Mean slope over the sampled directions, degrees; NaN when `samples` is 0. */
  meanSlopeDeg: number;
}

/**
 * Slope statistics on a ring of radius `radiusCells` around (x, y).
 *
 * Samples 16 directions rather than every cell in the annulus: 16 is enough to
 * characterise the surround and keeps this inside a per-tile render budget
 * (a full annulus at r=8 is 200+ reads per cell).
 *
 * **Edge behaviour.** `SurfaceField` covers the tile interior only, so ring
 * samples that fall outside it are dropped rather than read from the halo. The
 * result is a `radiusCells`-wide border where the ring is characterised from
 * fewer directions. That is a real (pre-existing) limitation shared by every
 * consumer, and it is why callers get `samples` back and decide for themselves
 * whether they have enough to speak.
 */
export function ringSlopeStats(
  surface: SurfaceField,
  x: number,
  y: number,
  radiusCells: number,
  steepDeg: number,
  directions = 16,
  out: RingSlopeStats = { samples: 0, steepCount: 0, meanSlopeDeg: NaN },
): RingSlopeStats {
  const { width, height, slope } = surface;
  const offsets = ringOffsets(radiusCells, directions);
  let samples = 0;
  let steepCount = 0;
  let sum = 0;
  for (let k = 0; k < directions; k++) {
    const sx = x + offsets[k * 2];
    const sy = y + offsets[k * 2 + 1];
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
    const rs = slope[sy * width + sx];
    if (!Number.isFinite(rs)) continue;
    samples++;
    sum += rs;
    if (rs >= steepDeg) steepCount++;
  }
  out.samples = samples;
  out.steepCount = steepCount;
  out.meanSlopeDeg = samples > 0 ? sum / samples : NaN;
  return out;
}

/**
 * Rounded (dx, dy) cell offsets for the ring directions, memoised on the last
 * (radius, directions) pair used.
 *
 * Called once per cell, so computing 16 sin/cos here costs a million transcendental
 * calls per 256² tile — measurably the most expensive thing in the bedding layer
 * before it was hoisted, and this runs per tile inside a render loop. The cache
 * is a pure memoisation of a deterministic function of its two arguments: a
 * caller interleaving two radii only loses the speed-up, never correctness.
 */
let cachedRingRadius = -1;
let cachedRingDirections = -1;
let cachedRingOffsets = new Int32Array(0);
function ringOffsets(radiusCells: number, directions: number): Int32Array {
  if (radiusCells === cachedRingRadius && directions === cachedRingDirections) {
    return cachedRingOffsets;
  }
  const offsets = new Int32Array(directions * 2);
  for (let k = 0; k < directions; k++) {
    const ang = (k / directions) * Math.PI * 2;
    offsets[k * 2] = Math.round(Math.cos(ang) * radiusCells);
    offsets[k * 2 + 1] = Math.round(Math.sin(ang) * radiusCells);
  }
  cachedRingRadius = radiusCells;
  cachedRingDirections = directions;
  cachedRingOffsets = offsets;
  return offsets;
}

/** Drop connected components smaller than `minCells` (4-connectivity). */
export function removeSmallBlobs(
  mask: Uint8Array,
  width: number,
  height: number,
  minCells: number,
): Uint8Array {
  const out = new Uint8Array(mask.length);
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  const component: number[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    component.length = 0;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;

    while (stack.length) {
      const i = stack.pop()!;
      component.push(i);
      const x = i % width;
      const y = (i / width) | 0;
      if (x > 0) pushIf(i - 1);
      if (x < width - 1) pushIf(i + 1);
      if (y > 0) pushIf(i - width);
      if (y < height - 1) pushIf(i + width);
    }

    if (component.length >= minCells) {
      for (const i of component) out[i] = 1;
    }
  }
  return out;

  function pushIf(j: number): void {
    if (mask[j] && !seen[j]) {
      seen[j] = 1;
      stack.push(j);
    }
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
