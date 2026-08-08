import { describe, expect, it } from 'vitest';
import {
  classifyWeiss,
  classifyWood,
  computeTpi,
  detectBenches,
  removeSmallBlobs,
  resolveCurvatureTolerance,
  standardize,
  TPI_MAX_CENTROID_OFFSET_FRACTION,
  TPI_MIN_DATA_FRACTION,
  WeissLandform,
  WOOD_LABELS,
  WoodFeature,
} from './landform.js';
import { computeCurvature, computeSurface, NODATA } from './surface.js';
import { HeightGrid } from '../dem/grid.js';
import {
  centerIndex,
  channel,
  cone,
  hillsideWithBench,
  paraboloid,
  plane,
  ridge,
  saddle,
  syntheticGrid,
} from '../testing/synthetic.js';

const SIZE = 41;
const CENTER = centerIndex(SIZE);

/**
 * FNV-1a over the raw Float32 bits of a field — `Object.is` semantics across a
 * whole array. A data quorum that shifts an interior value by one ulp is exactly
 * the bug a `toBeCloseTo` sweep cannot see.
 */
function float32Hash(field: Float32Array): string {
  const bits = new Uint32Array(field.buffer, field.byteOffset, field.length);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < bits.length; i++) h = (Math.imul(h, 16777619) ^ bits[i]) >>> 0;
  return h.toString(16);
}

describe('computeTpi', () => {
  it('is strongly positive on a summit and negative in a sink', () => {
    const peak = computeTpi(syntheticGrid(cone(0.3), { size: SIZE, halo: 12 }), { radius: 8 });
    const pit = computeTpi(syntheticGrid(paraboloid(0.002), { size: SIZE, halo: 12 }), {
      radius: 8,
    });
    expect(peak[CENTER]).toBeGreaterThan(5);
    expect(pit[CENTER]).toBeLessThan(-5);
  });

  it('is ~zero on a uniform slope — TPI measures position, not steepness', () => {
    const tpi = computeTpi(syntheticGrid(plane(0.5, 0.2), { size: SIZE, halo: 12 }), {
      radius: 8,
    });
    expect(Math.abs(tpi[CENTER])).toBeLessThan(0.5);
  });

  it('supports an annulus that ignores the immediate neighbourhood', () => {
    const grid = syntheticGrid(cone(0.3), { size: SIZE, halo: 12 });
    const disc = computeTpi(grid, { radius: 10 });
    const ring = computeTpi(grid, { radius: 10, annulusInner: 5 });
    // The ring excludes nearby (also-high) cells, so the summit stands out more.
    expect(ring[CENTER]).toBeGreaterThan(disc[CENTER]);
  });
});

describe('standardize', () => {
  it('reports a uniform field as all-zero instead of amplifying float noise', () => {
    // Without the noise floor this returns pseudo-random ±1σ values and the
    // landform layer speckles across visibly flat ground.
    const flat = new Float32Array(1000).fill(42);
    flat[10] = 42.00001; // float32-scale jitter
    const z = standardize(flat);
    expect(z.every((v) => v === 0)).toBe(true);
  });

  it('keeps NaN as NaN through the uniform-field path', () => {
    const f = new Float32Array([5, 5, NaN, 5]);
    const z = standardize(f);
    expect(z[0]).toBe(0);
    expect(Number.isNaN(z[2])).toBe(true);
  });

  it('produces zero mean and unit variance', () => {
    const raw = Float32Array.from({ length: 500 }, (_, i) => i * 3 - 100);
    const z = standardize(raw);
    const mean = z.reduce((a, b) => a + b, 0) / z.length;
    const sd = Math.sqrt(z.reduce((a, b) => a + (b - mean) ** 2, 0) / z.length);
    expect(mean).toBeCloseTo(0, 5);
    expect(sd).toBeCloseTo(1, 5);
  });
});

describe('classifyWood', () => {
  const opts = { slopeToleranceDeg: 1.5, curvatureTolerance: 1e-6 };

  function classifyAt(f: (x: number, y: number) => number): WoodFeature {
    const grid = syntheticGrid(f, { size: SIZE });
    const surface = computeSurface(grid);
    const curvature = computeCurvature(grid);
    return classifyWood(surface, curvature, opts)[CENTER] as WoodFeature;
  }

  it('identifies a saddle (pass) on a hyperbolic paraboloid', () => {
    // The headline case: this is the feature hunters care most about.
    expect(classifyAt(saddle(0.001))).toBe(WoodFeature.Pass);
  });

  it('identifies a peak', () => {
    expect(classifyAt(paraboloid(-0.001))).toBe(WoodFeature.Peak);
  });

  it('identifies a pit', () => {
    expect(classifyAt(paraboloid(0.001))).toBe(WoodFeature.Pit);
  });

  it('identifies a ridge on sloping ground', () => {
    expect(classifyAt(ridge(0.002, 0.3))).toBe(WoodFeature.Ridge);
  });

  it('identifies a channel on sloping ground', () => {
    expect(classifyAt(channel(0.002, 0.3))).toBe(WoodFeature.Channel);
  });

  it('calls a uniform slope planar', () => {
    expect(classifyAt(plane(0.35, 0.1))).toBe(WoodFeature.Planar);
  });
});

describe('classifyWeiss', () => {
  it('puts a summit in the mountain-top class and a sink in the canyon class', () => {
    const peakGrid = syntheticGrid(cone(0.35), { size: SIZE, halo: 24 });
    const peak = classifyWeiss(peakGrid, computeSurface(peakGrid), {
      smallRadius: 3,
      largeRadius: 16,
    });
    expect(peak[CENTER]).toBe(WeissLandform.MountainTop);

    // An inverted cone, not a paraboloid — see the next test for why.
    const pitGrid = syntheticGrid(cone(-0.35), { size: SIZE, halo: 24 });
    const pit = classifyWeiss(pitGrid, computeSurface(pitGrid), {
      smallRadius: 3,
      largeRadius: 16,
    });
    expect(pit[CENTER]).toBe(WeissLandform.Canyon);
  });

  it('reads a perfect paraboloid as featureless — TPI is constant on a quadratic', () => {
    // Worth pinning down, because it surprises people and it is not a bug.
    // For z = k(x² + y²) the neighbourhood mean is z(cell) + k·<r²>, so TPI is
    // the same constant everywhere and standardising it yields all zeros. Weiss
    // classification is *relative to the analysis window*: it answers "how does
    // this cell rank against its surroundings", and on a scale-free bowl the
    // honest answer is "no cell stands out". The practical consequence is that
    // Weiss classes shift as the user zooms, which is why the map legend labels
    // them as relative position rather than absolute landform.
    const grid = syntheticGrid(paraboloid(0.003), { size: SIZE, halo: 24 });
    const tpi = standardize(computeTpi(grid, { radius: 8 }));
    expect(Math.abs(tpi[CENTER])).toBeLessThan(1e-3);
  });

  it('separates plains from open slopes by the slope threshold', () => {
    const flatGrid = syntheticGrid(() => 500, { size: SIZE, halo: 24 });
    const flat = classifyWeiss(flatGrid, computeSurface(flatGrid), {
      smallRadius: 3,
      largeRadius: 16,
    });
    expect(flat[CENTER]).toBe(WeissLandform.Plain);

    const slopeGrid = syntheticGrid(plane(0.5, 0), { size: SIZE, halo: 24 });
    const sloped = classifyWeiss(slopeGrid, computeSurface(slopeGrid), {
      smallRadius: 3,
      largeRadius: 16,
    });
    expect(sloped[CENTER]).toBe(WeissLandform.OpenSlope);
  });
});

describe('detectBenches', () => {
  it('finds a level shelf cut into a steep hillside', () => {
    const size = 61;
    const grid = syntheticGrid(hillsideWithBench(0.6, -40, 40), {
      size,
      halo: 12,
      cellSize: 10,
    });
    const surface = computeSurface(grid);
    const bench = detectBenches(grid, surface, {
      maxBenchSlopeDeg: 8,
      minSurroundSlopeDeg: 18,
      ringRadius: 8,
      minCells: 4,
    });
    expect(bench[centerIndex(size)]).toBe(1);
  });

  it('does not call a uniform gentle slope a bench — the surround must be steep', () => {
    const size = 61;
    const grid = syntheticGrid(plane(0, 0.05), { size, halo: 12, cellSize: 10 });
    const surface = computeSurface(grid);
    const bench = detectBenches(grid, surface, { ringRadius: 8, minCells: 4 });
    expect(bench[centerIndex(size)]).toBe(0);
  });

  it('does not call a flat plain a bench', () => {
    const size = 61;
    const grid = syntheticGrid(() => 500, { size, halo: 12 });
    const surface = computeSurface(grid);
    const bench = detectBenches(grid, surface, { ringRadius: 8, minCells: 4 });
    expect(bench.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('removeSmallBlobs', () => {
  it('drops components below the size threshold and keeps larger ones', () => {
    const w = 10;
    const h = 10;
    const mask = new Uint8Array(w * h);
    mask[0] = 1; // isolated single cell
    for (let y = 4; y < 8; y++) for (let x = 4; x < 8; x++) mask[y * w + x] = 1; // 16 cells

    const out = removeSmallBlobs(mask, w, h, 5);
    expect(out[0]).toBe(0);
    expect(out[5 * w + 5]).toBe(1);
    expect(out.reduce((a, b) => a + b, 0)).toBe(16);
  });
});

describe('resolveCurvatureTolerance', () => {
  it('prefers an explicit override', () => {
    expect(resolveCurvatureTolerance({ curvatureTolerance: 1e-6, cellSize: 10 })).toBe(1e-6);
  });

  it('scales inversely with cell size', () => {
    // Curvature magnitude tracks ~1/cellSize on real terrain, so a fixed
    // threshold means something different at every zoom. Measured on Hocking
    // Hills at 3.7 m cells, the old fixed 5e-4 left only 8.4% of the map
    // planar — 91% came out ridge or channel, and real saddles were invisible
    // inside the speckle.
    const fine = resolveCurvatureTolerance({ cellSize: 3.69 });
    const coarse = resolveCurvatureTolerance({ cellSize: 15.07 });
    expect(fine).toBeGreaterThan(coarse);
    expect(fine / coarse).toBeCloseTo(15.07 / 3.69, 5);
  });

  it('honours the gradient-change budget', () => {
    expect(resolveCurvatureTolerance({ cellSize: 10, gradientChangePerCell: 0.02 })).toBeCloseTo(
      0.002,
      9,
    );
  });

  it('falls back to a constant only when no cell size is known', () => {
    expect(resolveCurvatureTolerance({})).toBe(0.0005);
    expect(resolveCurvatureTolerance({ cellSize: 0 })).toBe(0.0005);
  });
});

describe('classifyWood — planar majority on realistic terrain', () => {
  it('leaves most of a rolling surface planar rather than speckling it', () => {
    // A synthetic dissected surface: a regional tilt with superimposed
    // drainage-scale undulation. Most cells are plain slope; ridges and draws
    // are the exception, as on the ground. Before the scale-aware threshold,
    // this classified almost entirely as ridge/channel.
    const size = 61;
    const cellSize = 4;
    const grid = syntheticGrid(
      (x, y) => 500 + 0.25 * y + 6 * Math.sin(x / 90) + 4 * Math.cos(y / 110),
      { size, halo: 4, cellSize },
    );
    const surface = computeSurface(grid);
    const curvature = computeCurvature(grid);
    const cls = classifyWood(surface, curvature, { cellSize });

    let planar = 0;
    for (const v of cls) if (v === WoodFeature.Planar) planar++;
    expect(planar / cls.length).toBeGreaterThan(0.5);
  });

  it('still finds a genuine saddle at the scale-aware threshold', () => {
    // Loosening the threshold must not cost us the headline feature.
    const size = 41;
    const cellSize = 4;
    const grid = syntheticGrid(saddle(0.004), { size, halo: 4, cellSize });
    const cls = classifyWood(computeSurface(grid), computeCurvature(grid), { cellSize });
    expect(cls[centerIndex(size)]).toBe(WoodFeature.Pass);
  });
});

// ---------------------------------------------------------------------------
// R49 — what the landform layers did with a fabricated slope, and with the
// sentinel in their own neighbourhoods
// ---------------------------------------------------------------------------

const GRADE_15 = Math.tan((15 * Math.PI) / 180);
const GRADE_25 = Math.tan((25 * Math.PI) / 180);

describe('computeTpi — no-data in the neighbourhood (R49)', () => {
  /**
   * TPI had by far the widest blast radius in the package, and it was the
   * quietest. The mean was taken over the raw buffer, sentinels included, so a
   * single unreadable cell dragged the mean of its whole window down by
   * `32768 / n` metres — and *every* cell within `radius` of the void was
   * shifted, not just its immediate neighbours. One missing 3x3 patch therefore
   * corrupted a 41-cell-wide disc (≈400 m at z13) of Weiss classification
   * around it, and the classes it produced were ordinary ones, so nothing
   * looked wrong.
   */
  const R = 8;
  const N = (2 * R + 1) * (2 * R + 1);

  function tpiGrid() {
    // halo 24 > radius 8, so no window here is ever clipped and every number
    // below is a pure closed form rather than a border effect.
    return syntheticGrid(plane(GRADE_15, 0), { size: SIZE, halo: 24 });
  }

  it('is exactly 0 on a plane — the closed form the sentinel used to swamp', () => {
    // A plane is antisymmetric about the cell, so the mean over a symmetric
    // window is the cell's own elevation and TPI is identically 0.
    const tpi = computeTpi(tpiGrid(), { radius: R });
    expect(tpi[CENTER]).toBeCloseTo(0, 6);
  });

  it('excludes one void from the mean instead of averaging −32768 into it', () => {
    // Closed form with the void excluded: dropping cell k from a symmetric
    // window leaves mean' = z_c + (z_c − z_k)/(n−1), so TPI = (z_k − z_c)/(n−1).
    // Here k is 3 cells east on a 15° plane at 10 m cells:
    //   z_k − z_c = 3 · 10 · tan15° = 8.0385 m,  n = 289
    //   → TPI = 8.0385 / 288 = 0.02791 m
    // Before, the sentinel was averaged in and TPI was (z_k + 32768)/289 =
    // **115.14 m** — four thousand times the honest answer, on a cell three
    // cells from a void that a hunter would never associate with it.
    const g = tpiGrid();
    const zk = 500 + 3 * 10 * GRADE_15;
    g.set((CENTER % SIZE) + 3, Math.floor(CENTER / SIZE), NODATA);
    const tpi = computeTpi(g, { radius: R });

    const expected = (zk - 500) / (N - 1);
    expect(expected).toBeCloseTo(0.027911, 6);
    expect(tpi[CENTER], 'was 115.14 m').toBeCloseTo(expected, 4);
    expect(Math.abs(tpi[CENTER])).toBeLessThan(1);
  });

  it('abstains once most of the window is void, rather than meaning two corners', () => {
    // The `R40` rule, at the same 0.5 quorum: a mean over the fraction of a
    // window that happens to have answered is not a description of landscape
    // position, and reporting it as one is how unknown becomes a number.
    expect(TPI_MIN_DATA_FRACTION).toBe(0.5);
    const cx = CENTER % SIZE;
    const cy = Math.floor(CENTER / SIZE);

    // Quadrant void — two neighbour tiles missing. The cell itself still has
    // data, but only 81 of the 289 cells in its window do (0.28), and a mean
    // over one corner of a window is not a statement about landscape position.
    const quad = tpiGrid();
    for (let y = -24; y < SIZE + 24; y++) {
      for (let x = -24; x < SIZE + 24; x++) {
        if (y < cy || x < cx) quad.set(x, y, NODATA);
      }
    }
    expect(quad.hasData(cx, cy), 'the cell itself is measurable').toBe(true);
    expect(
      Number.isNaN(computeTpi(quad, { radius: R })[CENTER]),
      '81/289 of the window: below quorum, was a confident number',
    ).toBe(true);

    // The half-plane void that used to be asserted here — 9 of 17 window rows,
    // 0.529, just above quorum — is now covered by the centroid tests below.
    // It was pinned as *must still answer*, on the reasoning that greying it
    // would grey the edge of every partially downloaded region. The number that
    // overturned that is in `computeTpi — a one-sided window (R59)`: on a
    // uniform plane whose closed-form TPI is 0, it answers +10.72 m.
  });

  it('does NOT grey the tile border, where the window is merely clipped', () => {
    // Cells within `radius` of a tile edge have always had a truncated window;
    // that is a border artefact of the readable region, not missing ground.
    // Counting it as missing would grey a radius-wide frame around every tile.
    // Checked at r=20 on a grid whose halo is only 4, which is the harshest
    // clipping the shipped callers can produce.
    const g = syntheticGrid(plane(GRADE_15, 0), { size: SIZE, halo: 4 });
    for (const radius of [3, 8, 20]) {
      const tpi = computeTpi(g, { radius });
      for (let i = 0; i < tpi.length; i++) {
        expect(Number.isNaN(tpi[i]), `r=${radius}, cell ${i % SIZE},${Math.floor(i / SIZE)}`).toBe(
          false,
        );
      }
    }
  });

  it('leaves cells beyond the window radius bit-identical', () => {
    // The blast radius is now exactly the window, and nothing wider.
    const clean = computeTpi(tpiGrid(), { radius: R });
    const g = tpiGrid();
    g.set(10, 10, NODATA);
    const holed = computeTpi(g, { radius: R });
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (Math.max(Math.abs(x - 10), Math.abs(y - 10)) <= R) continue;
        const i = y * SIZE + x;
        expect(Object.is(holed[i], clean[i]), `cell ${x},${y}`).toBe(true);
      }
    }
  });

  it('keeps the annulus variant honest too', () => {
    const g = tpiGrid();
    const clean = computeTpi(g, { radius: R, annulusInner: 3 });
    expect(clean[CENTER]).toBeCloseTo(0, 6);
    // Void the whole inner disc *and* most of the ring: no quorum, no answer.
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx === 0 && dy === 0) continue;
        g.set((CENTER % SIZE) + dx, Math.floor(CENTER / SIZE) + dy, NODATA);
      }
    }
    expect(Number.isNaN(computeTpi(g, { radius: R, annulusInner: 3 })[CENTER])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R59 — a window can clear 50% from one side only and still shift the mean
// ---------------------------------------------------------------------------

describe('computeTpi — a one-sided window (R59)', () => {
  /**
   * ## The closed form
   *
   * TPI is `z(c) − mean(z over the retained cells)`. On a plane of gradient
   * `∇z`, `z(p) = z(c) + ∇z·(p − c)`, so
   *
   *     TPI = −∇z · d,   d = centroid of the retained cells, relative to c
   *
   * exactly. A complete window has `d = 0` by symmetry and TPI is identically 0
   * — that is the closed form the whole operator is validated against. Remove
   * cells from one side and `d` is no longer zero, and the bias is not a small
   * correction: it is a *first-order* term in the gradient, which on a uniform
   * hillside is the largest quantity in the neighbourhood.
   *
   * For the canonical case — a straight void edge, the shape a missing
   * neighbour tile or a big lake leaves — the retained columns run `−r … m` and
   * `d = (m − r)/2`. At exactly the 50% quorum (`m = 0`) that is `−r/2` cells, so
   *
   *     TPI = ∇z · (r/2) · cellSize
   *
   * which at r=20 on 10 m cells over a 15° slope is **26.79 m of fabricated
   * relief on ground that is provably flat-of-curvature**.
   */
  const R59_GRADE = Math.tan((15 * Math.PI) / 180);
  const R59_CELL = 10;
  const R59_SIZE = 65;
  /**
   * Slack for "this should be the closed form exactly".
   *
   * TPI is a difference of ~500 m elevations, and a `HeightGrid` holds Float32,
   * where one ulp at 500 m is `500·2⁻²³` ≈ 6.0e-5 m. So the *input* quantisation
   * dominates the answer's precision, not the Float64 summed-area arithmetic and
   * not the Float32 output. Two ulps is the honest floor here; anything tighter
   * is a tolerance tuned until it passed, which is how a quorum bug hides.
   */
  const ELEV_ULP = 2 * 500 * 2 ** -23;

  /**
   * A uniform east-rising plane with everything east of interior column `cut`
   * voided. Built directly rather than through `syntheticGrid` so the void fills
   * the halo too — a missing neighbour tile is missing in the halo, which is the
   * only place TPI can lose coverage at all.
   */
  function halfPlaneGrid(radius: number, cut: number): HeightGrid {
    const halo = radius;
    const g = HeightGrid.empty(R59_SIZE, R59_SIZE, halo, R59_CELL, 40, -84);
    for (let y = -halo; y < R59_SIZE + halo; y++) {
      for (let x = -halo; x < R59_SIZE + halo; x++) {
        g.set(x, y, x > cut ? NODATA : 500 + R59_GRADE * x * R59_CELL);
      }
    }
    return g;
  }

  it('REPRODUCTION: the 0.5 quorum passes a half window that reports 26.79 m on a plane', () => {
    // The coverage of the last surviving column is (r+1)(2r+1) / (2r+1)² =
    // (r+1)/(2r+1), which tends to 0.5 from *above* for every radius. So the
    // `R49` quorum does not merely fail to catch this case — it can never catch
    // it. This is the row's claim, as a number, at all three shipped radii.
    for (const r of [3, 8, 20]) {
      const coverage = (r + 1) / (2 * r + 1);
      expect(coverage, `r=${r} clears the 0.5 quorum`).toBeGreaterThan(TPI_MIN_DATA_FRACTION);

      const cut = 40;
      const tpi = computeTpi(halfPlaneGrid(r, cut), { radius: r });
      const closedForm = (R59_GRADE * R59_CELL * r) / 2;
      expect(closedForm, `r=${r}`).toBeCloseTo([4.0192, 10.718, 26.7949][[3, 8, 20].indexOf(r)], 3);
      // What the operator does about it is asserted below; here we only pin that
      // the honest answer for this cell is 0 and the biased one is `closedForm`.
      const got = tpi[32 * R59_SIZE + cut];
      expect(Number.isNaN(got) || Math.abs(got - closedForm) < 1e-3, `r=${r}`).toBe(true);
    }
  });

  it('abstains on the one-sided half window instead of inventing relief', () => {
    for (const r of [3, 8, 20]) {
      const tpi = computeTpi(halfPlaneGrid(r, 40), { radius: r });
      expect(
        Number.isNaN(tpi[32 * R59_SIZE + 40]),
        `r=${r}: was ${((R59_GRADE * R59_CELL * r) / 2).toFixed(2)} m on a plane`,
      ).toBe(true);
    }
  });

  it('admits a residual bias of a stated size, and the size matches the closed form', () => {
    // The guard is a bound, not a cure: cells further from the void edge have a
    // smaller centroid offset and are allowed to answer. What they answer is
    // `∇z · d · cellSize` exactly, so the error this layer ships is a number we
    // can write down rather than a worry.
    const r = 20;
    const cut = 40;
    const tpi = computeTpi(halfPlaneGrid(r, cut), { radius: r });
    let worstBias = 0;
    for (let x = cut - 2 * r; x <= cut; x++) {
      const v = tpi[32 * R59_SIZE + x];
      if (Number.isNaN(v)) continue;
      // Retained columns run −r … min(r, cut − x); centroid is the mean of that.
      const m = Math.min(r, cut - x);
      const centroid = (m - r) / 2;
      const closedForm = -centroid * R59_CELL * R59_GRADE;
      expect(v, `x=${x} centroid ${centroid}`).toBeCloseTo(closedForm, 3);
      worstBias = Math.max(worstBias, Math.abs(closedForm));
    }
    // `TPI_MAX_CENTROID_OFFSET_FRACTION · r` cells of offset, times the rise per
    // cell. At r=20 on this 15° plane that is one cell, i.e. 2.68 m — against
    // the 26.79 m the unguarded operator reported two cells away.
    const bound = TPI_MAX_CENTROID_OFFSET_FRACTION * r * R59_CELL * R59_GRADE;
    expect(worstBias).toBeLessThanOrEqual(bound + 1e-6);
    expect(worstBias).toBeCloseTo(2.6795, 3);
  });

  it('greys the region edge and nothing else — the cost, as a cell count', () => {
    // The `R49` fix was pinned as "must still answer" here, because greying
    // would grey the edge of every partially downloaded region. It does: at
    // r=20 the guard silences a band `r` cells deep inside the void edge. That
    // cost is accepted because the alternative is measured in the Weiss test
    // below, and because the band appears ONLY where a neighbour is genuinely
    // absent — a tile with its eight neighbours present has a complete,
    // perfectly symmetric window at every interior cell, corners included.
    const r = 20;
    const cut = 40;
    const tpi = computeTpi(halfPlaneGrid(r, cut), { radius: r });
    const row = 32;
    let greyed = 0;
    for (let x = 0; x < R59_SIZE; x++) if (Number.isNaN(tpi[row * R59_SIZE + x])) greyed++;
    // Two populations, and the band has a closed form of its own. Cells east of
    // `cut` are void themselves and were already `NaN`. Inside it, the centroid
    // is `(m − r)/2` for `m = cut − x`, so the guard fires while
    // `m < r(1 − 2ε)` — a band exactly `r·(1 − 2·TPI_MAX_CENTROID_OFFSET_FRACTION)`
    // cells deep. At r=20, ε=0.05 that is 18 cells, ≈180 m at z13.
    const bandDepth = r * (1 - 2 * TPI_MAX_CENTROID_OFFSET_FRACTION);
    expect(bandDepth).toBe(18);
    expect(greyed).toBe(R59_SIZE - 1 - cut + bandDepth);
    expect(greyed).toBe(42);
    // Everything deeper than the band is the plane's closed form, 0, to the
    // precision a Float32 field can carry a difference of ~500 m elevations.
    for (let x = 0; x <= cut - r; x++) {
      expect(Math.abs(tpi[row * R59_SIZE + x]), `x=${x} is untouched`).toBeLessThan(ELEV_ULP);
    }
  });

  it('is inert on a fully covered tile — every interior cell bit-identical', () => {
    // `Object.is` over the whole field via a Float32 digest, because a quorum
    // bug hides inside an epsilon. These digests are the pre-R59 output.
    const field = (x: number, y: number): number =>
      500 + 0.25 * x + 4 * Math.sin(x / 23) * Math.cos(y / 19) + 0.9 * Math.sin(x / 7);
    const expected: Record<number, string> = { 3: 'a422ed4c', 8: 'bfc410a8', 20: '89d3568a' };
    for (const r of [3, 8, 20]) {
      const g = syntheticGrid(field, { size: 33, halo: Math.max(8, r), cellSize: 10 });
      expect(float32Hash(computeTpi(g, { radius: r })), `r=${r}`).toBe(expected[r]);
    }
    const ann = computeTpi(syntheticGrid(field, { size: 33, halo: 12, cellSize: 10 }), {
      radius: 8,
      annulusInner: 3,
    });
    expect(float32Hash(ann), 'annulus r=8 inner=3').toBe('5026b2a3');
  });

  it('the two guards catch different things — neither implies the other', () => {
    // A symmetric void has centroid 0 and can still leave almost nothing, and a
    // one-sided void can be 51% covered. Keeping both is not belt-and-braces.
    const r = 8;
    const cx = 32;
    const cy = 32;

    // (a) Symmetric but sparse: void everything except the centre cell and a
    //     symmetric cross. Centroid is exactly 0; coverage is far below quorum.
    const sparse = HeightGrid.empty(R59_SIZE, R59_SIZE, r, R59_CELL, 40, -84);
    for (let y = -r; y < R59_SIZE + r; y++) {
      for (let x = -r; x < R59_SIZE + r; x++) {
        const onCross = x === cx || y === cy;
        sparse.set(x, y, onCross ? 500 + R59_GRADE * x * R59_CELL : NODATA);
      }
    }
    const cross = computeTpi(sparse, { radius: r });
    // 33 of 289 cells, centroid exactly 0 — only the fraction quorum stops this.
    expect(Number.isNaN(cross[cy * R59_SIZE + cx]), 'symmetric but 11% covered').toBe(true);

    // (b) One-sided and 53% covered — only the centroid test stops this.
    const oneSided = computeTpi(halfPlaneGrid(r, cx), { radius: r });
    expect((r + 1) / (2 * r + 1)).toBeGreaterThan(TPI_MIN_DATA_FRACTION);
    expect(Number.isNaN(oneSided[cy * R59_SIZE + cx]), 'one-sided but 53% covered').toBe(true);
  });

  it('does not fire on the scattered single-cell voids fillVoids leaves behind', () => {
    // Both shipped callers run `grid.fillVoids()` before analysis, so an
    // isolated hole is normally gone before TPI sees it. If one does survive,
    // greying a radius-wide disc around it would be a wildly disproportionate
    // response: one missing cell of 1681 shifts the centroid by at most
    // `r√2 / (n−1)` = 0.017 cells, i.e. 4.5 cm of bias on this plane.
    const r = 20;
    const g = HeightGrid.empty(R59_SIZE, R59_SIZE, r, R59_CELL, 40, -84);
    for (let y = -r; y < R59_SIZE + r; y++) {
      for (let x = -r; x < R59_SIZE + r; x++) g.set(x, y, 500 + R59_GRADE * x * R59_CELL);
    }
    g.set(50, 20, NODATA);
    const tpi = computeTpi(g, { radius: r });
    for (let y = 0; y < R59_SIZE; y++) {
      for (let x = 0; x < R59_SIZE; x++) {
        if (x === 50 && y === 20) continue;
        const i = y * R59_SIZE + x;
        expect(Number.isNaN(tpi[i]), `cell ${x},${y}`).toBe(false);
        expect(Math.abs(tpi[i]), `cell ${x},${y}`).toBeLessThan(0.05);
      }
    }
  });
});

describe('classifyWeiss on the edge of a downloaded region (R59)', () => {
  /**
   * Terrain: a uniform 15° plane. No summit, no ridge, no bench, nothing — the
   * true classification is `OpenSlope` at every one of its 4096 cells. One
   * neighbour tile absent to the east, which is what a user gets one tile past
   * the edge of a downloaded region, or when a fetch 404s.
   *
   * **Before `R59`: 512 cells of UpperSlope and 128 of MountainTop** — a 20-cell
   * band running the full height of the tile, 15.6% of it, on a plane. The
   * one-sided TPI ramped smoothly from 0 to 26.79 m across that band; because
   * `standardize` is scale-free, the fabricated relief *became* the tile's
   * entire variance and z-scored straight past Weiss's ±1σ thresholds.
   */
  const size = 64;
  const halo = 20;
  const grade = Math.tan((15 * Math.PI) / 180);

  function regionEdgeGrid(): HeightGrid {
    const g = HeightGrid.empty(size, size, halo, 10, 40, -84);
    for (let y = -halo; y < size + halo; y++) {
      for (let x = -halo; x < size + halo; x++) {
        g.set(x, y, x >= size ? NODATA : 500 + grade * x * 10);
      }
    }
    return g;
  }

  function histogram(): Map<number, number> {
    const g = regionEdgeGrid();
    const weiss = classifyWeiss(g, computeSurface(g));
    const counts = new Map<number, number>();
    for (const v of weiss) counts.set(v, (counts.get(v) ?? 0) + 1);
    return counts;
  }

  it('no longer invents a summit, and cuts the fabricated band by 80%', () => {
    const counts = histogram();
    expect(counts.get(WeissLandform.MountainTop) ?? 0, 'was 128').toBe(0);
    expect(counts.get(WeissLandform.Canyon) ?? 0).toBe(0);
    expect(counts.get(WeissLandform.MidslopeRidge) ?? 0).toBe(0);
    expect(counts.get(WeissLandform.LocalRidgeInValley) ?? 0).toBe(0);

    const fabricated =
      size * size -
      (counts.get(WeissLandform.OpenSlope) ?? 0) -
      (counts.get(WeissLandform.Unknown) ?? 0);
    expect(fabricated, '640 before: 512 UpperSlope + 128 MountainTop').toBe(128);
  });

  it('KNOWN RESIDUAL: two columns survive, and the cause is standardize, not TPI', () => {
    // This is the part of `R59` that is *not* fixed, pinned so it cannot be
    // forgotten or quietly rediscovered.
    //
    // The centroid guard bounds the fabricated **relief** — here to 2.68 m, the
    // `ε/2 = 2.5%` of window span its constant promises. It cannot bound the
    // fabricated **z-score**, because `standardize` divides by the field's own
    // σ and this field has no real variance at all: on a perfectly uniform
    // slope the only variation left is the residual, so the residual becomes
    // 100% of σ and z-scores to +2.9 and +6.0 however small it is in metres.
    // That is `standardize`'s documented degenerate case (a quadratic surface
    // has *constant* TPI) reached from a new direction, and no centroid bound
    // short of exactly zero removes it. Zero is not affordable: it would grey a
    // 41x41 disc around every surviving single-cell void, for a bias of 4.5 cm.
    //
    // Why this is tolerable on real ground: the bias is `|∇z|·|d|·cellSize`,
    // proportional to the *same* local gradient that generates genuine TPI
    // variance. On dissected terrain σ(TPI at r=20) runs tens of metres and
    // 2.68 m is a fraction of it; the pathological case is specifically a long
    // uniform planar sidehill, where σ → 0 while the bias does not.
    const counts = histogram();
    expect(counts.get(WeissLandform.UpperSlope) ?? 0, 'was 512, now 2 columns').toBe(128);
    expect(128 / 64, 'columns').toBe(2);

    // And the relief behind it is bounded by the constant, not by luck.
    const raw = computeTpi(regionEdgeGrid(), { radius: 20 });
    let worst = 0;
    for (const v of raw) if (Number.isFinite(v)) worst = Math.max(worst, Math.abs(v));
    expect(worst).toBeCloseTo(2.6795, 3);
    // The bound is exact in Float64; the field is Float32, so it is asserted
    // with one ulp of slack rather than a round epsilon that hides a real breach.
    // Float32 elevations of ~500 m quantise at ~6e-5 m, and TPI is a difference
    // of two of them, so the bound is asserted with that much slack — see
    // ELEV_ULP above for why a tighter epsilon would be a tuned one.
    const bound = TPI_MAX_CENTROID_OFFSET_FRACTION * 20 * 10 * grade;
    expect(worst).toBeLessThanOrEqual(bound + 2 * 500 * 2 ** -23);
  });
});

describe('classifyWeiss and classifyWood on unmeasurable ground (R49)', () => {
  it('Wood reports Unknown, not Planar, where the surface could not be measured', () => {
    // `Planar` renders transparent, so the old fallback looked harmless — but
    // it is also what the point query returns as "Planar slope" and what a
    // saved filter `wood ∈ {Planar}` selects on. The engine was answering a
    // question about ground it had never seen.
    const g = syntheticGrid(plane(GRADE_15, 0), { size: SIZE, halo: 8 });
    g.set(20, 20, NODATA);
    const cls = classifyWood(computeSurface(g), computeCurvature(g), { cellSize: 10 });
    expect(cls[20 * SIZE + 20]).toBe(WoodFeature.Unknown);
    expect(cls[20 * SIZE + 20]).not.toBe(WoodFeature.Planar);
    expect(WOOD_LABELS[WoodFeature.Unknown]).toBe('Not measurable');
  });

  it('no longer invents a draw and a knob at the edge of a void', () => {
    // Measured on the 15° plane, whose every cell is truly `Planar`:
    //   one neighbour missing  →  "Channel / draw"  (crossSectional 27.7)
    //   all eight missing      →  "Peak / knob"     (maxCurvature 221.9)
    // Draws are the classic whitetail travel corridor and the peak/pass family
    // is where saddles come from, so a void rendered as exactly the two
    // features a hunter is hunting for.
    const g = syntheticGrid(plane(GRADE_15, 0), { size: SIZE, halo: 8 });
    g.set(9, 10, NODATA);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) if (dx || dy) g.set(20 + dx, 20 + dy, NODATA);
    }
    const cls = classifyWood(computeSurface(g), computeCurvature(g), { cellSize: 10 });
    expect(cls[10 * SIZE + 10], 'was Channel / draw').toBe(WoodFeature.Unknown);
    expect(cls[20 * SIZE + 20], 'was Peak / knob').toBe(WoodFeature.Unknown);
    // And the rest of the plane is still read as what it is.
    expect(cls[30 * SIZE + 30]).toBe(WoodFeature.Planar);
  });

  it('Weiss reports Unknown across the void, and is unchanged beyond the window', () => {
    const clean = syntheticGrid(plane(GRADE_15, 0), { size: SIZE, halo: 24 });
    const before = classifyWeiss(clean, computeSurface(clean), {
      smallRadius: 3,
      largeRadius: 16,
    });
    const g = syntheticGrid(plane(GRADE_15, 0), { size: SIZE, halo: 24 });
    g.set(8, 8, NODATA);
    const after = classifyWeiss(g, computeSurface(g), { smallRadius: 3, largeRadius: 16 });

    expect(after[8 * SIZE + 8]).toBe(WeissLandform.Unknown);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        // The large TPI radius is the reach; beyond it nothing may move.
        if (Math.max(Math.abs(x - 8), Math.abs(y - 8)) <= 16) continue;
        expect(after[y * SIZE + x], `cell ${x},${y}`).toBe(before[y * SIZE + x]);
      }
    }
  });
});

describe('detectBenches on unmeasurable ground (R49)', () => {
  it('no longer flags a lone return inside a void as a bedding shelf', () => {
    // The sharpest downstream consequence, and a real DEM shape: one surviving
    // return (a tower, a building, a partially written tile) inside a void, on
    // a uniform 25° sidehill with no shelf anywhere on it.
    //
    // The lone cell's eight neighbours were all sentinel, so Horn's terms
    // cancelled and it reported **slope 0.0°** — inside the ≤8° pad window —
    // while its r=8 ring landed on clean 25° ground and passed the ≥18°
    // surround test. Result: exactly **1 bench cell** on a hillside that has
    // none. Benches are where bucks bed and the standard speed-scouting
    // technique is to mark every one and connect them, so this is a stand
    // location the map invented out of missing data.
    const g = syntheticGrid(plane(GRADE_25, 0), { size: SIZE, halo: 12 });
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) g.set(20 + dx, 20 + dy, NODATA);
    }
    g.set(20, 20, 500);

    const bench = detectBenches(g, computeSurface(g), { minCells: 1 });
    expect(bench[20 * SIZE + 20], 'was 1').toBe(0);
    let total = 0;
    for (const b of bench) total += b;
    expect(total, 'a uniform 25° plane has no benches').toBe(0);
  });

  it('still finds a real shelf next to a void — the guard must not eat the layer', () => {
    // Anti-over-correction. A genuine bench with a void 15 cells away is still
    // a bench; only the cells whose own measurement is missing may drop out.
    const size = 61;
    const g = syntheticGrid(hillsideWithBench(0.6, -40, 40), {
      size,
      halo: 12,
      cellSize: 10,
    });
    g.set(5, 5, NODATA);
    const bench = detectBenches(g, computeSurface(g), {
      maxBenchSlopeDeg: 8,
      minSurroundSlopeDeg: 18,
      ringRadius: 8,
      minCells: 4,
    });
    expect(bench[centerIndex(size)]).toBe(1);
  });
});
