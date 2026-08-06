/**
 * Movement-cost surfaces.
 *
 * Least-cost corridor analysis is only as good as its cost surface, and the
 * usual GIS default ("cost = slope") is wrong for deer in a specific, important
 * way: **deer are not slope-averse, they are energy-averse and exposure-averse.**
 * A whitetail will happily walk a 25° sidehill along the contour all day, and
 * will refuse to climb the same 25° straight up. Slope alone cannot express
 * that, because it has no notion of the direction of travel.
 *
 * So the primary cost model here is **anisotropic**: cost depends on the slope
 * *along the direction being travelled*, derived from the terrain gradient and
 * the step vector. That single change is what makes generated corridors hug
 * contours, run benches, and funnel through saddles — the same lines a hunter
 * draws by hand.
 */

import type { SurfaceField } from '../analysis/surface.js';

/**
 * Tobler-style effective speed as a function of along-path grade.
 *
 * Tobler's hiking function was fitted to humans, but its shape — a peak at a
 * slight downhill, steep penalty uphill, moderate penalty on steep downhill —
 * is the right qualitative model for any large-bodied terrestrial walker, and it
 * is the model the landscape-genomics literature uses for ungulate least-cost
 * paths. `slopeRatio` is rise/run, signed (positive = uphill).
 */
export function toblerSpeed(slopeRatio: number): number {
  return 6 * Math.exp(-3.5 * Math.abs(slopeRatio + 0.05));
}

export interface CostSurfaceOptions {
  /**
   * Per-cell resistance multiplier in [0, ∞), e.g. from land cover: open
   * agricultural field 2.5 (deer cross it but exposed), mature timber 1.0,
   * thick regen 0.8 (preferred), water/rock 50 (effectively barrier).
   * `Infinity` marks a hard barrier.
   */
  resistance?: Float32Array;
  /**
   * Optional attraction field in [0, 1] (e.g. bedding likelihood, cover
   * density). Higher values reduce cost, pulling corridors toward terrain deer
   * actually favour rather than merely terrain they *can* cross.
   */
  attraction?: Float32Array;
  /** How strongly attraction discounts cost. 0 = ignore, 1 = up to 50% off. */
  attractionWeight?: number;
  /** Slope above which movement is treated as effectively impassable. */
  impassableSlopeDeg?: number;
}

export interface CostSurface {
  width: number;
  height: number;
  cellSize: number;
  /** Isotropic base resistance per cell (dimensionless multiplier). */
  base: Float32Array;
  /** Reference to the surface field, needed for anisotropic step costs. */
  surface: SurfaceField;
  options: Required<Omit<CostSurfaceOptions, 'resistance' | 'attraction'>> &
    Pick<CostSurfaceOptions, 'resistance' | 'attraction'>;
}

export function buildCostSurface(
  surface: SurfaceField,
  cellSize: number,
  options: CostSurfaceOptions = {},
): CostSurface {
  const n = surface.slope.length;
  const base = new Float32Array(n);
  const impassable = options.impassableSlopeDeg ?? 55;
  const attractionWeight = options.attractionWeight ?? 0.5;

  for (let i = 0; i < n; i++) {
    const slope = surface.slope[i];
    if (!Number.isFinite(slope) || slope >= impassable) {
      base[i] = Infinity;
      continue;
    }
    let c = options.resistance ? options.resistance[i] : 1;
    if (!Number.isFinite(c) || c <= 0) {
      base[i] = Infinity;
      continue;
    }
    if (options.attraction) {
      const a = options.attraction[i];
      if (Number.isFinite(a)) c *= 1 - attractionWeight * Math.max(0, Math.min(1, a));
    }
    base[i] = c;
  }

  return {
    width: surface.width,
    height: surface.height,
    cellSize,
    base,
    surface,
    options: {
      attractionWeight,
      impassableSlopeDeg: impassable,
      resistance: options.resistance,
      attraction: options.attraction,
    },
  };
}

/**
 * Anisotropic cost of stepping from cell `from` to adjacent cell `to`.
 *
 * The along-path grade is taken from the actual elevation difference implied by
 * the gradient field, projected onto the step direction. Cost is
 * `distance / speed(grade)` scaled by the mean base resistance of the two
 * cells — i.e. **time**, which is the currency an animal minimises.
 */
export function stepCost(
  cost: CostSurface,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): number {
  const { width, base, surface, cellSize } = cost;
  const i = fromY * width + fromX;
  const j = toY * width + toX;
  const b0 = base[i];
  const b1 = base[j];
  if (!Number.isFinite(b0) || !Number.isFinite(b1)) return Infinity;

  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy) * cellSize;
  if (dist === 0) return 0;

  // Elevation change along the step, from the averaged gradient. dzdy is
  // south-positive and dy increases south, so both terms carry a plus sign.
  const gx = (surface.dzdx[i] + surface.dzdx[j]) / 2;
  const gy = (surface.dzdy[i] + surface.dzdy[j]) / 2;
  const dz = gx * dx * cellSize + gy * dy * cellSize;
  const grade = dz / dist;

  const speed = toblerSpeed(grade);
  if (speed <= 1e-6) return Infinity;

  return ((dist / speed) * (b0 + b1)) / 2;
}

/**
 * Land-cover resistance lookup for NLCD class codes.
 *
 * Values are movement-cost multipliers tuned for whitetail: lower means the
 * animal moves through it more readily. Open water and developed high-intensity
 * are hard barriers; woody wetlands and shrub/scrub are the cheapest because
 * they combine cover with passability.
 */
export const NLCD_RESISTANCE: Record<number, number> = {
  11: Infinity, // Open water
  12: 8, // Perennial ice/snow
  21: 4, // Developed, open space
  22: 12, // Developed, low intensity
  23: 40, // Developed, medium intensity
  24: Infinity, // Developed, high intensity
  31: 3, // Barren land
  41: 1.0, // Deciduous forest
  42: 1.0, // Evergreen forest
  43: 0.95, // Mixed forest
  52: 0.8, // Shrub/scrub — cover plus passability
  71: 1.6, // Grassland/herbaceous
  81: 2.2, // Pasture/hay
  82: 2.8, // Cultivated crops — food, but exposed
  90: 0.85, // Woody wetlands — classic sanctuary
  95: 1.8, // Emergent herbaceous wetlands
};

/** Map an NLCD class raster to a resistance field. */
export function resistanceFromNlcd(nlcd: Uint8Array | Uint16Array): Float32Array {
  const out = new Float32Array(nlcd.length);
  for (let i = 0; i < nlcd.length; i++) {
    const r = NLCD_RESISTANCE[nlcd[i]];
    out[i] = r === undefined ? 1.5 : r;
  }
  return out;
}
