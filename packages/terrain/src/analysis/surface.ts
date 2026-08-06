/**
 * First- and second-order surface derivatives.
 *
 * Two kernels, deliberately:
 *
 *  - **Horn (1981)** third-order finite difference for slope/aspect. This is
 *    what ArcGIS, GDAL and QGIS all ship, so our slope-angle bands line up with
 *    what a user sees in desktop GIS. Divergence there would be a support
 *    nightmare ("your app says 34°, QGIS says 31°").
 *  - **Evans–Young quadratic fit** for curvature. Curvature from finite
 *    differences alone is far too noisy on 1 m LiDAR; the least-squares
 *    quadratic acts as an implicit smoother, which is what makes bench and
 *    saddle detection stable instead of a speckle field.
 *
 * ## Coordinate conventions (get these wrong and every aspect is mirrored)
 *
 *  - Row index increases **southward** (raster convention).
 *  - `dzdx` is east-positive; `dzdy` is south-positive.
 *  - Aspect is the **downslope azimuth**, degrees clockwise from true north,
 *    in [0, 360). Flat cells get `-1`.
 */

import { NODATA } from '../dem/encoding.js';
import { HeightGrid } from '../dem/grid.js';

export interface SurfaceField {
  width: number;
  height: number;
  /** Slope in degrees, 0..90. */
  slope: Float32Array;
  /** Downslope azimuth in degrees clockwise from north; -1 where flat. */
  aspect: Float32Array;
  /** East-positive gradient (rise/run, dimensionless). */
  dzdx: Float32Array;
  /** South-positive gradient. */
  dzdy: Float32Array;
}

export interface CurvatureField {
  width: number;
  height: number;
  /**
   * Vertical (downslope) curvature, **ESRI sign convention**:
   * negative = convex/shedding, positive = concave/collecting.
   */
  profile: Float32Array;
  /**
   * Contour (across-slope) curvature, **ESRI sign convention**:
   * positive = divergent (a spur), negative = convergent (a draw).
   * This is the field the thermal-sink and drainage layers key off.
   */
  plan: Float32Array;
  /**
   * Wood longitudinal curvature, **Wood/`r.param.scale` sign convention** —
   * which is the OPPOSITE of `profile` above (positive = convex).
   */
  longitudinal: Float32Array;
  /**
   * Wood cross-sectional curvature (positive = ridge, negative = channel).
   * Same sign as `plan`, but unnormalised — this is the classifier's input.
   */
  crossSectional: Float32Array;
  /** Maximum principal curvature. */
  maxCurvature: Float32Array;
  /** Minimum principal curvature. */
  minCurvature: Float32Array;
}

/** Horn's 3x3 slope & aspect. */
export function computeSurface(grid: HeightGrid): SurfaceField {
  const { width, height, cellSize } = grid;
  const n = width * height;
  const slope = new Float32Array(n);
  const aspect = new Float32Array(n);
  const dzdxOut = new Float32Array(n);
  const dzdyOut = new Float32Array(n);
  const w = new Float32Array(9);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!grid.hasData(x, y)) {
        slope[i] = NaN;
        aspect[i] = -1;
        continue;
      }
      grid.window3(x, y, w);
      // w = [a b c / d e f / g h i] with row 0 = north.
      const dzdx = (w[2] + 2 * w[5] + w[8] - (w[0] + 2 * w[3] + w[6])) / (8 * cellSize);
      const dzdy = (w[6] + 2 * w[7] + w[8] - (w[0] + 2 * w[1] + w[2])) / (8 * cellSize);

      dzdxOut[i] = dzdx;
      dzdyOut[i] = dzdy;

      const rise = Math.hypot(dzdx, dzdy);
      slope[i] = (Math.atan(rise) * 180) / Math.PI;

      if (rise < 1e-9) {
        aspect[i] = -1;
      } else {
        // Downslope vector in (east, north) is (-dzdx, +dzdy) because dzdy is
        // south-positive. Azimuth clockwise from north = atan2(east, north).
        let az = (Math.atan2(-dzdx, dzdy) * 180) / Math.PI;
        if (az < 0) az += 360;
        aspect[i] = az;
      }
    }
  }

  return { width, height, slope, aspect, dzdx: dzdxOut, dzdy: dzdyOut };
}

/**
 * Evans–Young quadratic fit over a 3x3 window.
 *
 * Fits `z = ax² + by² + cxy + dx + ey + f` in local metres, then derives the
 * standard curvature quantities. `d` is east-positive, `e` is north-positive
 * (note the sign flip relative to `computeSurface`'s `dzdy` — the quadratic is
 * written in map coordinates, the Horn kernel in raster coordinates).
 */
export function computeCurvature(grid: HeightGrid): CurvatureField {
  const { width, height, cellSize } = grid;
  const n = width * height;
  const profile = new Float32Array(n);
  const plan = new Float32Array(n);
  const longitudinal = new Float32Array(n);
  const crossSectional = new Float32Array(n);
  const maxCurvature = new Float32Array(n);
  const minCurvature = new Float32Array(n);
  const w = new Float32Array(9);
  const g = cellSize;
  const g2 = g * g;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!grid.hasData(x, y)) {
        profile[i] = NaN;
        plan[i] = NaN;
        longitudinal[i] = NaN;
        crossSectional[i] = NaN;
        maxCurvature[i] = NaN;
        minCurvature[i] = NaN;
        continue;
      }
      grid.window3(x, y, w);
      const [z1, z2, z3, z4, z5, z6, z7, z8, z9] = w;

      const a = ((z1 + z3 + z4 + z6 + z7 + z9) / 6 - (z2 + z5 + z8) / 3) / g2;
      const b = ((z1 + z2 + z3 + z7 + z8 + z9) / 6 - (z4 + z5 + z6) / 3) / g2;
      const c = (z3 + z7 - z1 - z9) / (4 * g2);
      const d = (z3 + z6 + z9 - z1 - z4 - z7) / (6 * g);
      const e = (z1 + z2 + z3 - z7 - z8 - z9) / (6 * g);

      const p = d * d + e * e;

      if (p < 1e-12) {
        // Flat: directional curvatures are undefined, principal ones are not.
        profile[i] = 0;
        plan[i] = 0;
        longitudinal[i] = 0;
        crossSectional[i] = 0;
      } else {
        const q = 1 + p;
        // NOTE the sign difference between the two pairs. `profile`/`plan`
        // follow the ESRI/Zevenbergen–Thorne convention that GIS users read off
        // a desktop legend; `longitudinal`/`crossSectional` follow Wood's, which
        // is what the morphometric classifier is defined against. They disagree
        // on `profile` vs `longitudinal` by design — do not "fix" one to match
        // the other. Getting `plan` backwards inverts every draw/spur layer and
        // makes the thermal-sink filter select ridge tops.
        profile[i] = (2 * (a * d * d + b * e * e + c * d * e)) / (p * Math.pow(q, 1.5));
        plan[i] = (-2 * (b * d * d + a * e * e - c * d * e)) / Math.pow(p, 1.5);
        longitudinal[i] = (-2 * (a * d * d + b * e * e + c * d * e)) / p;
        crossSectional[i] = (-2 * (b * d * d + a * e * e - c * d * e)) / p;
      }

      // Principal curvatures of the fitted quadric — scale-free, so they are
      // what the classifier uses on near-flat cells where the directional
      // curvatures above have collapsed to zero.
      const root = Math.sqrt((a - b) * (a - b) + c * c);
      maxCurvature[i] = -a - b + root;
      minCurvature[i] = -a - b - root;
    }
  }

  return {
    width,
    height,
    profile,
    plan,
    longitudinal,
    crossSectional,
    maxCurvature,
    minCurvature,
  };
}

/**
 * Terrain Ruggedness Index (Riley et al. 1999) — RMS elevation change to the
 * eight neighbours, in metres.
 *
 * For hunting this is a **security-cover proxy**: mature bucks bed where TRI is
 * high because broken ground breaks sightlines and lets them slip out of a
 * bedding area unseen. It is also the first thing to look at when deciding
 * whether a "flat" bench is genuinely flat or just averaged-out chop.
 */
export function computeRuggedness(grid: HeightGrid): Float32Array {
  const { width, height } = grid;
  const out = new Float32Array(width * height);
  const w = new Float32Array(9);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!grid.hasData(x, y)) {
        out[i] = NaN;
        continue;
      }
      grid.window3(x, y, w);
      const c = w[4];
      let sum = 0;
      for (let k = 0; k < 9; k++) {
        if (k === 4) continue;
        const diff = w[k] - c;
        sum += diff * diff;
      }
      out[i] = Math.sqrt(sum);
    }
  }
  return out;
}

/** Aspect in degrees → the compass octant a hunter actually thinks in. */
export function aspectOctant(aspectDeg: number): string {
  if (aspectDeg < 0) return 'flat';
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round(aspectDeg / 45) % 8];
}

/** Signed angular difference between two azimuths, in [-180, 180]. */
export function azimuthDelta(a: number, b: number): number {
  let d = ((a - b + 180) % 360) - 180;
  if (d < -180) d += 360;
  return d;
}

export { NODATA };
