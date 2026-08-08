import { describe, expect, it } from 'vitest';
import {
  classifyWeiss,
  classifyWood,
  computeTpi,
  detectBenches,
  removeSmallBlobs,
  resolveCurvatureTolerance,
  standardize,
  TPI_MIN_DATA_FRACTION,
  WeissLandform,
  WOOD_LABELS,
  WoodFeature,
} from './landform.js';
import { computeCurvature, computeSurface, NODATA } from './surface.js';
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

    // Half-plane void — the shape a missing neighbour tile leaves. The first
    // surviving row keeps 9 of its 17 window rows = 0.529, just above quorum,
    // and must still answer: over-correcting here would grey the entire edge of
    // every partially downloaded region.
    const half = tpiGrid();
    for (let y = -24; y < cy; y++) {
      for (let x = -24; x < SIZE + 24; x++) half.set(x, y, NODATA);
    }
    expect(Number.isNaN(computeTpi(half, { radius: R })[CENTER]), '9/17 rows').toBe(false);

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
