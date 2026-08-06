import { describe, expect, it } from 'vitest';
import {
  classifyWeiss,
  classifyWood,
  computeTpi,
  detectBenches,
  removeSmallBlobs,
  resolveCurvatureTolerance,
  standardize,
  WeissLandform,
  WoodFeature,
} from './landform.js';
import { computeCurvature, computeSurface } from './surface.js';
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
