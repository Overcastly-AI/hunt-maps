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
 *
 * ## What TRI cannot be used for
 *
 * TRI is **strongly correlated with slope by construction**: on a perfectly
 * smooth plane of grade `g` and cell size `s` it evaluates to `g·s·√6`, so it
 * reports a cliff as "rugged" even though the cliff has one normal everywhere
 * and hides nothing. Any composite score that already contains a slope term must
 * therefore NOT use TRI as its second, independent "cover" term — that double-
 * counts slope and quietly re-biases the whole layer toward steep ground.
 * `computeVectorRuggedness` exists for exactly that job; see Sappington et al.
 * 2007 (J. Wildl. Manage. 71:1419), which built VRM because of this correlation.
 * TRI remains the right layer to *render* and to denormalise onto observations,
 * where it is read as "local relief in metres" and not as a cover proxy.
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

/**
 * Default VRM window radius, in **cells**. 4 → a 9x9 window.
 *
 * Concealment is a coarse-scale signal: what breaks a bedded buck's sightlines
 * (and a hunter's) is chopped-up ground over tens of metres, not the 1-cell
 * texture a 3x3 window measures — at LiDAR resolution a 3x3 mostly measures
 * vegetation-return noise. At the ~10 m cells the tile pipeline serves in the
 * z12–z14 band this is a 90 m window, which is the scale a hunter means by
 * "broken ground".
 *
 * **Known limitation (resolution dependence).** The window is specified in cells,
 * so on 1 m LiDAR a 9x9 covers only 9 m. Callers working below ~5 m cells should
 * raise `radiusCells` to keep the window near 50–90 m on the ground; `analyze`
 * exposes this as `coverRadiusCells` and `requiredHalo` reads the same value, so
 * raising it also widens the halo and cannot introduce a seam.
 */
export const DEFAULT_VRM_RADIUS_CELLS = 4;

export interface VectorRuggednessOptions {
  /** Neighbourhood radius in cells; the window is (2r+1)². */
  radiusCells?: number;
}

/**
 * Vector Ruggedness Measure (Sappington, Longshore & Thompson 2007,
 * *J. Wildl. Manage.* 71:1419), dimensionless on **[0, 1]**.
 *
 * Each cell's unit surface normal is decomposed into components; the
 * neighbourhood's resultant vector magnitude `|R|` is divided by the number of
 * contributing cells, and `VRM = 1 − |R|/n`. It measures the **dispersion of
 * surface orientation**, which is what "broken ground" actually means.
 *
 * ## Why this and not TRI
 *
 * VRM is ~0 on any plane *of any grade* — a 40° smooth sidehill has one normal
 * everywhere and conceals nothing — whereas TRI grows linearly with grade
 * (`g·s·√6`). That independence from slope is the entire reason Sappington et al.
 * introduced VRM, and it is what lets a composite bedding score contain a slope
 * term and a cover term without counting slope twice. The failure it prevents is
 * concrete: with TRI in the cover slot, the flagship bedding layer rewarded
 * steep ground once through its slope term and again through its cover term, so
 * the map pushed hunters onto smooth steep faces and away from genuinely broken
 * bedding cover.
 *
 * ## Implementation notes
 *
 *  - The normal is taken as `(−dz/dx, −dz/dy, 1)` normalised, in (east, south,
 *    up). This is algebraically identical to Sappington's
 *    `(sin s·sin a, sin s·cos a, cos s)` up to a fixed rotation/reflection of
 *    axes, and VRM depends only on the *dispersion* of those vectors, which is
 *    invariant under it. Avoiding the trig also avoids the flat-cell aspect
 *    sentinel entirely: a flat cell's normal is exactly `(0, 0, 1)` with no
 *    special case, which is the degenerate case that would otherwise inject a
 *    fake direction from `aspect = −1`.
 *  - Summed-area tables, so cost is O(n) and independent of the radius. A naive
 *    kernel at the radii a 1 m DEM needs (r≈45) would be ~8000 reads per cell,
 *    which is not something a phone can do inside a render loop.
 *  - A cell is skipped if it or any of its 8 neighbours is no-data, because a
 *    Horn gradient straddling the NODATA sentinel is a ~32 km cliff. Skipped
 *    cells are removed from the divisor rather than counted as smooth.
 *
 * Reads up to `radiusCells + 1` cells outside the interior, so the grid halo
 * must be at least that (`requiredHalo` handles this for `bedding`).
 */
export function computeVectorRuggedness(
  grid: HeightGrid,
  options: VectorRuggednessOptions = {},
): Float32Array {
  const { width, height, cellSize } = grid;
  const r = Math.max(1, Math.round(options.radiusCells ?? DEFAULT_VRM_RADIUS_CELLS));

  // Padded region we integrate over: every interior cell then has a full window.
  const pw = width + 2 * r;
  const ph = height + 2 * r;
  const sw = pw + 1;
  const satX = new Float64Array(sw * (ph + 1));
  const satY = new Float64Array(sw * (ph + 1));
  const satZ = new Float64Array(sw * (ph + 1));
  const satN = new Float64Array(sw * (ph + 1));
  const w = new Float32Array(9);
  // Direct-buffer fast path. `grid.get` clamps both axes on every read, and this
  // loop does nine of them per padded cell — measurably the dominant cost of the
  // layer at tile scale. Inside the allocated buffer the clamps provably cannot
  // fire, so the slow path is only taken where the halo genuinely runs out and
  // edge-replication is the intended behaviour.
  const data = grid.data;
  const stride = grid.stride;
  const bufRows = grid.height + 2 * grid.halo;
  const halo = grid.halo;

  for (let py = 0; py < ph; py++) {
    let rowX = 0;
    let rowY = 0;
    let rowZ = 0;
    let rowN = 0;
    for (let px = 0; px < pw; px++) {
      const gx = px - r;
      const gy = py - r;
      const bx = gx + halo;
      const by = gy + halo;
      let ok: boolean;
      if (bx >= 1 && by >= 1 && bx < stride - 1 && by < bufRows - 1) {
        const o = by * stride + bx;
        w[0] = data[o - stride - 1];
        w[1] = data[o - stride];
        w[2] = data[o - stride + 1];
        w[3] = data[o - 1];
        w[4] = data[o];
        w[5] = data[o + 1];
        w[6] = data[o + stride - 1];
        w[7] = data[o + stride];
        w[8] = data[o + stride + 1];
        ok = true;
        for (let k = 0; k < 9; k++) {
          if (!(w[k] > NODATA + 1)) {
            ok = false;
            break;
          }
        }
      } else {
        ok = gridWindowHasData(grid, gx, gy, w);
      }
      if (ok) {
        const dzdx = (w[2] + 2 * w[5] + w[8] - (w[0] + 2 * w[3] + w[6])) / (8 * cellSize);
        const dzdy = (w[6] + 2 * w[7] + w[8] - (w[0] + 2 * w[1] + w[2])) / (8 * cellSize);
        const inv = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
        rowX += -dzdx * inv;
        rowY += -dzdy * inv;
        rowZ += inv;
        rowN += 1;
      }
      const o = (py + 1) * sw + px + 1;
      const u = py * sw + px + 1;
      satX[o] = satX[u] + rowX;
      satY[o] = satY[u] + rowY;
      satZ[o] = satZ[u] + rowZ;
      satN[o] = satN[u] + rowN;
    }
  }

  const box = (sat: Float64Array, x0: number, y0: number, x1: number, y1: number): number =>
    sat[(y1 + 1) * sw + (x1 + 1)] -
    sat[y0 * sw + (x1 + 1)] -
    sat[(y1 + 1) * sw + x0] +
    sat[y0 * sw + x0];

  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!grid.hasData(x, y)) {
        out[i] = NaN;
        continue;
      }
      // Interior (x, y) sits at padded (x + r, y + r); the window is r either side.
      const x0 = x;
      const y0 = y;
      const x1 = x + 2 * r;
      const y1 = y + 2 * r;
      const n = box(satN, x0, y0, x1, y1);
      if (n <= 0) {
        out[i] = NaN;
        continue;
      }
      const sx = box(satX, x0, y0, x1, y1);
      const sy = box(satY, x0, y0, x1, y1);
      const sz = box(satZ, x0, y0, x1, y1);
      const vrm = 1 - Math.sqrt(sx * sx + sy * sy + sz * sz) / n;
      // |R| ≤ n by the triangle inequality, so vrm ∈ [0, 1] mathematically; the
      // clamp only absorbs float cancellation on perfectly planar ground, where
      // the unclamped value lands at ±1e-16 and a negative would flow into a
      // downstream clamp01 as a hard zero rather than as "no roughness".
      out[i] = vrm < 0 ? 0 : vrm > 1 ? 1 : vrm;
    }
  }
  return out;
}

/** Load the 3x3 window at (x, y) and report whether every cell in it has data. */
function gridWindowHasData(
  grid: HeightGrid,
  x: number,
  y: number,
  out: Float32Array,
): boolean {
  grid.window3(x, y, out);
  for (let k = 0; k < 9; k++) {
    if (!(out[k] > NODATA + 1)) return false;
  }
  return true;
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
