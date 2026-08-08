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

import { NODATA } from '../dem/encoding.js';
import { HeightGrid } from '../dem/grid.js';
import type { CurvatureField, SurfaceField } from './surface.js';

/**
 * No-data threshold as a module-local constant — the `R30`/`R49` lesson.
 *
 * The TPI table evaluates this once per padded cell (~87k per tile at r=20,
 * twice over for the two Weiss scales). Reaching across the module boundary for
 * either `isElevation` or `NODATA` in that loop is a property load V8 will not
 * fold; measured on `computeSurface`, the identical mistake cost +58%. Same
 * predicate as `isElevation` — `>` already rejects `NaN` and `-Infinity`, and no
 * decoder in this package can produce `+Infinity`.
 */
const NODATA_FLOOR = NODATA + 1;

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
 * Fraction of a TPI neighbourhood that must carry data before the cell gets an
 * answer instead of `NaN`.
 *
 * **This one is `Doctrine`, not `Measured` (`R60`).** 0.5 was picked to line up
 * with `BEDDING_RING_MIN_DATA_FRACTION`, and the earlier note here went further
 * and claimed the shared value meant TPI, the bedding ring and `detectBenches`
 * "cannot disagree about how much of a neighbourhood has to answer". That is the
 * claim `R55` retracted one file over, and it is no truer here. The denominators
 * are not the same quantity:
 *
 *  - this one is the **full geometric window**, `(2r+1)²`. `computeTpi` pads its
 *    summed-area table by exactly `r`, so an interior cell's window is never
 *    clipped, and `HeightGrid.get` edge-replicates past the buffer. A tile whose
 *    eight neighbours are present therefore has 100% coverage at every interior
 *    cell, corners included — measured, not assumed.
 *  - `detectBenches` tests `samples >= 8` of 16 ring directions **absolutely**,
 *    and `SurfaceField` covers the tile interior only, so its directions go
 *    missing at every tile border whether or not any data is.
 *
 * So at a tile border the two diverge by construction: benches fall silent and
 * TPI speaks, because TPI reads the halo and benches cannot. Where they do agree
 * is the case the shared number was really bought for — a lake, a DEM void or a
 * 404'd neighbour *inside* the grid, which is the only thing that reduces TPI's
 * coverage at all.
 *
 * What this quorum is for is the **symmetric** loss: a window eaten from all
 * sides, where the survivors are still a fair sample of the disc but there are
 * too few of them to describe it. One-sided loss is a different failure with a
 * different magnitude and it is caught by `TPI_MAX_CENTROID_OFFSET_FRACTION`,
 * not here. Neither test implies the other.
 */
export const TPI_MIN_DATA_FRACTION = 0.5;

/**
 * How far the centroid of the surviving cells may sit from the cell being
 * described, as a fraction of the window radius, before TPI abstains.
 *
 * ## The failure (`R59`)
 *
 * TPI is `z(c) − mean(z over the survivors)`. On a plane of gradient `∇z` that
 * is exactly
 *
 *     TPI = −∇z · d          d = centroid of the survivors, relative to c
 *
 * so a complete (symmetric) window gives 0 and a one-sided one gives a
 * **first-order** term in the gradient — on a uniform hillside, the largest
 * quantity anywhere in the neighbourhood. A coverage quorum cannot see this. For
 * the canonical straight void edge the survivors run `−r … m` and `d = (m−r)/2`,
 * so the *worst* case sits at exactly `d = −r/2`, whose coverage is
 * `(r+1)/(2r+1)` — a number that tends to 0.5 **from above** at every radius.
 * `TPI_MIN_DATA_FRACTION = 0.5` therefore does not merely miss this case, it can
 * never catch it.
 *
 * Measured, on a uniform 15° plane with one neighbour tile absent, 10 m cells:
 * TPI at r=20 ramps from 0 to **+26.79 m** across the outer 20 columns, matching
 * `∇z·(r/2)·cellSize` to four decimals. `standardize` is scale-free, so that
 * fabricated relief became the tile's entire variance and z-scored straight past
 * Weiss's ±1σ thresholds: **512 cells of UpperSlope and 128 of MountainTop, on a
 * plane.** Those are classes a hunter goes looking for.
 *
 * ## The bound, and where 0.05 comes from
 *
 * Because the bias is `|∇z|·|d|·cellSize` and the window's own elevation span is
 * `|∇z|·2r·cellSize`, bounding `|d| ≤ ε·r` bounds the bias at **ε/2 of the
 * relief the window itself covers** — free of gradient, cell size and radius,
 * which is why the constant is expressed as a fraction of `r` rather than in
 * cells. At ε = 0.05 the admitted bias is 2.5% of the window's span: 2.68 m at
 * r=20 on the 15° plane above, against the 26.79 m the unguarded operator
 * reported two cells away.
 *
 * **Grade the number honestly: the *form* is derived, the *magnitude* is chosen.**
 * 2.5% is a judgement about how much fabricated relief may reach `standardize`,
 * not a measurement of deer or of DEMs. What is measured is the cost either side
 * of it, and that is what should move it: at ε = 0.05 the guard silences a band
 * `r` cells deep inside a void edge and touches nothing else; a scattered
 * single-cell void shifts the centroid by at most `r√2/(n−1)` ≈ 0.017 cells and
 * is nowhere near it.
 *
 * ## What it costs, and why that is the right trade here
 *
 * A band `r` cells deep — 200 m at r=20 on 10 m cells — greyed inside the edge
 * of a partially downloaded region. `R40` faced the same choice for the bedding
 * ring and went the other way, and was right to: `ringSlopeStats` reads a
 * tile-interior field, so requiring symmetry there would grey a frame around
 * **every** tile and paint a grid of seams across the whole layer. TPI reads the
 * halo, so this band appears only where a neighbour is genuinely absent — once,
 * around the edge of what the user actually downloaded, and never in the
 * interior of a region. That is the measurement that separates the two cases,
 * and it is why the same reasoning produces opposite answers.
 */
export const TPI_MAX_CENTROID_OFFSET_FRACTION = 0.05;

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
 *
 * ## No-data, and why this one has the widest blast radius in the package
 *
 * The mean used to be taken over the raw buffer, sentinels included. `NODATA` is
 * −32768, so a single unreadable cell drags the mean of a 41x41 window down by
 * ~19 m and a 3x3 void drags it down by ~178 m. Measured on a 15° plane, one
 * void 3 cells away moved TPI at r=8 from its closed-form **0.028 m** to
 * **115 m** — and *every* cell within `radius` of the void was shifted, so one
 * missing 3x3 patch corrupted a 41-cell-wide (≈400 m at z13) disc of Weiss
 * classification around it. Unlike the 1-cell fringe the Horn kernels produced,
 * that is a landscape-scale error, and it was invisible because the classes it
 * produces are ordinary ones.
 *
 * Now the sentinel is excluded from both the numerator and the count, and the
 * cell abstains below `TPI_MIN_DATA_FRACTION` of the window. Two counts are kept
 * apart on purpose, exactly as `RingSlopeStats` does (`R40`):
 *
 *  - the window is **clipped** to the padded region, and clipped-away cells are
 *    outside the denominator entirely. In practice this never fires: the padding
 *    is exactly `r`, so an interior cell's window always fits, and `get`
 *    edge-replicates past the buffer rather than returning the sentinel. It is
 *    kept because the alternative — counting a clip as missing — would grey a
 *    `radius`-wide frame around every tile.
 *  - cells **inside** the region carrying `NODATA` are counted in the
 *    denominator and not the numerator. That is ground the engine cannot see,
 *    and it is what drives the abstention.
 *
 * ## …and *where* the survivors are, not just how many (`R59`)
 *
 * A count is not enough. TPI compares a cell against the mean of a
 * neighbourhood, and a mean over a lopsided sample of a sloping neighbourhood is
 * biased by `−∇z·d` for a centroid offset `d` — first order in the gradient, and
 * large. The quorum above cannot catch it, because the worst one-sided case sits
 * at 50.x% coverage for every radius. So the survivors' centroid is tested as
 * well; see `TPI_MAX_CENTROID_OFFSET_FRACTION` for the closed form and for the
 * grey band it costs.
 */
export function computeTpi(grid: HeightGrid, options: TpiOptions): Float32Array {
  const { width, height } = grid;
  const r = Math.max(1, Math.round(options.radius));
  const inner = Math.max(0, Math.round(options.annulusInner ?? 0));

  // Two summed-area tables over the padded region we can legally read: one of
  // elevations (no-data contributing zero) and one of data counts. A single SAT
  // cannot express "mean over the cells that answered" — that is the bug.
  //
  // The count table is only built when it can matter. Scanning the padded buffer
  // once for a sentinel is a contiguous read costing well under a tenth of a
  // millisecond, and it buys back the whole cost of the fix on the overwhelmingly
  // common case of a fully covered tile: a second Float64 table at r=20 is
  // ~700 kB of extra allocation and write bandwidth per call, and `classifyWeiss`
  // calls this twice per tile. Without the fast path TPI ran +50%; with it, a
  // clean tile is unchanged and only tiles that actually contain a void pay.
  const pad = r;
  const sw = width + 2 * pad;
  const sh = height + 2 * pad;
  const rowStride = sw + 1;
  const satZ = new Float64Array(rowStride * (sh + 1));
  const buf = grid.data;
  let anyVoid = false;
  for (let k = 0; k < buf.length; k++) {
    if (!(buf[k] > NODATA_FLOOR)) {
      anyVoid = true;
      break;
    }
  }
  // A grid with no sentinel anywhere in it cannot produce one through `get`,
  // which either indexes the buffer or clamps to a cell of it.
  const satN = anyVoid ? new Float64Array(rowStride * (sh + 1)) : null;
  // First moments of the data mask, for the centroid test. Gated behind the same
  // `anyVoid` flag as `satN` and for the same reason: with no sentinel in the
  // grid every window is complete and perfectly symmetric, so the centroid is
  // provably (0, 0) and two more ~700 kB Float64 tables per call would be pure
  // cost on the overwhelmingly common case. `classifyWeiss` calls this twice.
  // Float64 rather than Float32 because these are running sums of padded indices
  // — ~1.3e7 on a 256² tile at r=20, past Float32's 2^24 exact-integer range.
  const satMx = anyVoid ? new Float64Array(rowStride * (sh + 1)) : null;
  const satMy = anyVoid ? new Float64Array(rowStride * (sh + 1)) : null;

  if (satN === null || satMx === null || satMy === null) {
    for (let y = 0; y < sh; y++) {
      let rowZ = 0;
      for (let x = 0; x < sw; x++) {
        rowZ += grid.get(x - pad, y - pad);
        const o = (y + 1) * rowStride + (x + 1);
        satZ[o] = satZ[y * rowStride + (x + 1)] + rowZ;
      }
    }
  } else {
    for (let y = 0; y < sh; y++) {
      let rowZ = 0;
      let rowN = 0;
      let rowMx = 0;
      let rowMy = 0;
      for (let x = 0; x < sw; x++) {
        const v = grid.get(x - pad, y - pad);
        if (v > NODATA_FLOOR) {
          rowZ += v;
          rowN += 1;
          // Moments in *padded* coordinates; the centre is subtracted per cell
          // below. Accumulating raw indices keeps the table independent of which
          // window reads it, which is what makes a SAT applicable at all.
          rowMx += x;
          rowMy += y;
        }
        const o = (y + 1) * rowStride + (x + 1);
        const u = y * rowStride + (x + 1);
        satZ[o] = satZ[u] + rowZ;
        satN[o] = satN[u] + rowN;
        satMx[o] = satMx[u] + rowMx;
        satMy[o] = satMy[u] + rowMy;
      }
    }
  }

  const box = (sat: Float64Array, x0: number, y0: number, x1: number, y1: number): number => {
    // Inclusive interior coords → SAT coords.
    const ax = clampInt(x0 + pad, 0, sw);
    const ay = clampInt(y0 + pad, 0, sh);
    const bx = clampInt(x1 + pad + 1, 0, sw);
    const by = clampInt(y1 + pad + 1, 0, sh);
    return (
      sat[by * rowStride + bx] -
      sat[ay * rowStride + bx] -
      sat[by * rowStride + ax] +
      sat[ay * rowStride + ax]
    );
  };
  /** Cells of the window that lie inside the readable region — the denominator. */
  const boxArea = (x0: number, y0: number, x1: number, y1: number): number => {
    const ax = clampInt(x0 + pad, 0, sw);
    const ay = clampInt(y0 + pad, 0, sh);
    const bx = clampInt(x1 + pad + 1, 0, sw);
    const by = clampInt(y1 + pad + 1, 0, sh);
    return Math.max(0, bx - ax) * Math.max(0, by - ay);
  };

  // Hoisted out of the per-cell loop — the `R30`/`R49` lesson again: these are
  // module bindings, and this loop runs once per interior cell.
  const minFraction = TPI_MIN_DATA_FRACTION;
  // Squared, so the centroid test is a comparison against a squared magnitude
  // and never takes a square root.
  const maxOffsetSq = (TPI_MAX_CENTROID_OFFSET_FRACTION * r) ** 2;

  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!grid.hasData(x, y)) {
        out[i] = NaN;
        continue;
      }
      let sum = box(satZ, x - r, y - r, x + r, y + r);
      let area = boxArea(x - r, y - r, x + r, y + r);
      // With no sentinel in the grid, every in-region cell answered, so the
      // count *is* the area and both tests below are trivially satisfied.
      let count = satN === null ? area : box(satN, x - r, y - r, x + r, y + r);
      if (inner > 0) {
        sum -= box(satZ, x - inner, y - inner, x + inner, y + inner);
        const innerArea = boxArea(x - inner, y - inner, x + inner, y + inner);
        count -= satN === null ? innerArea : box(satN, x - inner, y - inner, x + inner, y + inner);
        area -= innerArea;
      }
      // `count > 0` is not enough: a mean over the two corners of a window that
      // is otherwise a lake is not a description of landscape position.
      if (!(count > 0 && count >= area * minFraction)) {
        out[i] = NaN;
        continue;
      }
      // Nor is *how many* enough on its own. A window that lost its whole
      // eastern half still clears 50%, and the mean of what is left is taken
      // over ground that sits, on average, half a radius west of this cell — on
      // a slope that is a first-order error (`R59`). `count !== area` is the
      // fast path out: a complete window is symmetric by construction, so every
      // cell of a well-covered tile pays one integer compare and nothing else.
      if (count !== area && satMx !== null && satMy !== null) {
        let mx = box(satMx, x - r, y - r, x + r, y + r);
        let my = box(satMy, x - r, y - r, x + r, y + r);
        if (inner > 0) {
          mx -= box(satMx, x - inner, y - inner, x + inner, y + inner);
          my -= box(satMy, x - inner, y - inner, x + inner, y + inner);
        }
        // Moments are in padded coordinates; this cell sits at (x+pad, y+pad).
        const dx = mx / count - (x + pad);
        const dy = my / count - (y + pad);
        if (dx * dx + dy * dy > maxOffsetSq) {
          out[i] = NaN;
          continue;
        }
      }
      out[i] = grid.get(x, y) - sum / count;
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
    // Slope is checked here even though only one branch below reads it, for two
    // reasons (`R49`). The narrow one: `NaN <= plainSlope` is `false`, so an
    // unmeasurable cell in the middle band used to fall through to "Open slope"
    // — a definite class produced by a comparison against NaN. The broader one:
    // this file's contract is that Weiss and Wood are "directly comparable
    // cell-for-cell", and they only are if they abstain on the same cells.
    // Without this, a fringe cell whose own 3x3 window is void could still
    // reach TPI quorum from the half of its neighbourhood that survived, and
    // the map grew a one-cell band of *Canyon / incised drainage* along every
    // missing-tile edge — a thermal sink and travel route, invented.
    if (!Number.isFinite(s) || !Number.isFinite(l) || !Number.isFinite(surface.slope[i])) {
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
  /**
   * The window could not be measured — a DEM void, a lake, a neighbour tile that
   * 404'd. Distinct from `Planar`, which is a *finding*: "we looked, and this
   * cell is an unremarkable slope".
   *
   * Appended as 6 rather than renumbered to 0, because these ids are persisted
   * on observation rows (`morphometry`) and shifting them would silently
   * relabel every record ever written. `WeissLandform` has had its own
   * `Unknown` since it was written; this is Wood catching up.
   */
  Unknown = 6,
}

export const WOOD_LABELS: Record<WoodFeature, string> = {
  [WoodFeature.Planar]: 'Planar slope',
  [WoodFeature.Pit]: 'Pit / sink',
  [WoodFeature.Channel]: 'Channel / draw',
  [WoodFeature.Pass]: 'Saddle (pass)',
  [WoodFeature.Ridge]: 'Ridge / spur',
  [WoodFeature.Peak]: 'Peak / knob',
  [WoodFeature.Unknown]: 'Not measurable',
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
    const cross = curvature.crossSectional[i];
    const maxC = curvature.maxCurvature[i];
    const minC = curvature.minCurvature[i];
    // Unknown is its own class, not `Planar`. `Planar` renders transparent, so
    // the old fallback looked harmless on the map — but it is also the value the
    // point-query returns as "Planar slope" and the value a saved filter
    // `wood ∈ {Planar}` selects on, so the engine was answering a question about
    // ground it had never seen. Curvature is checked alongside slope because the
    // two operators can disagree at a window's edge only if one of them is
    // broken, and if they ever do, abstaining is the safe direction.
    if (!Number.isFinite(slope) || !Number.isFinite(cross) || !Number.isFinite(maxC)) {
      out[i] = WoodFeature.Unknown;
      continue;
    }

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
  const r: RingSlopeStats = { samples: 0, missing: 0, steepCount: 0, meanSlopeDeg: NaN };

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
  /**
   * Ring directions that landed **inside** the grid but carried no data.
   *
   * Reported separately from the directions that fell outside the grid because
   * the two mean opposite things and callers must not conflate them (`R40`):
   *
   *  - *outside the grid* is a tile-border artefact of `SurfaceField` covering
   *    only the interior. The ground is there, it is simply not in this array,
   *    and abstaining on it would grey a `radiusCells`-wide border around every
   *    tile — a visible grid of seams across the whole layer.
   *  - *inside the grid with no data* is ground the engine genuinely cannot see:
   *    a DEM void, a lake, a neighbour tile that 404'd. A ring characterised from
   *    the two directions that happen to have data is not a measurement of the
   *    surround, and reporting it as one is how "unknown" becomes a confident
   *    number.
   *
   * `samples + missing` is therefore the size of the ring actually available to
   * speak about, and `samples / (samples + missing)` is how much of it answered.
   */
  missing: number;
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
 *
 * **No-data behaviour.** A direction that lands inside the grid on a cell with
 * no slope is counted in `missing`, not silently forgotten. See the field's own
 * note: without that count a caller cannot tell "I saw two of sixteen directions
 * because fourteen are off the tile" from "…because fourteen are a lake".
 */
export function ringSlopeStats(
  surface: SurfaceField,
  x: number,
  y: number,
  radiusCells: number,
  steepDeg: number,
  directions = 16,
  out: RingSlopeStats = { samples: 0, missing: 0, steepCount: 0, meanSlopeDeg: NaN },
): RingSlopeStats {
  const { width, height, slope } = surface;
  const offsets = ringOffsets(radiusCells, directions);
  let samples = 0;
  let missing = 0;
  let steepCount = 0;
  let sum = 0;
  for (let k = 0; k < directions; k++) {
    const sx = x + offsets[k * 2];
    const sy = y + offsets[k * 2 + 1];
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
    const rs = slope[sy * width + sx];
    if (!Number.isFinite(rs)) {
      missing++;
      continue;
    }
    samples++;
    sum += rs;
    if (rs >= steepDeg) steepCount++;
  }
  out.samples = samples;
  out.missing = missing;
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
