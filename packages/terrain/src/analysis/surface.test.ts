import { describe, expect, it } from 'vitest';
import {
  computeCurvature,
  computeRuggedness,
  computeSurface,
  computeVectorRuggedness,
  NODATA,
} from './surface.js';
import { HeightGrid } from '../dem/grid.js';
import { BEDDING_VRM_FULL_COVER, beddingLikelihood } from './wind.js';
import {
  centerIndex,
  channel,
  paraboloid,
  plane,
  ridge,
  saddle,
  syntheticGrid,
} from '../testing/synthetic.js';

const SIZE = 33;
const CENTER = centerIndex(SIZE);

/**
 * FNV-1a over the raw Float32 bits of a field.
 *
 * The point is `Object.is` semantics across a whole array: a data quorum that
 * accidentally shifts an interior value by one ulp is exactly the bug a
 * `toBeCloseTo` sweep cannot see, and writing out 1089 literals is not a test
 * anybody will maintain. Any single-bit change anywhere moves the digest.
 */
function float32Hash(field: Float32Array): string {
  const bits = new Uint32Array(field.buffer, field.byteOffset, field.length);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < bits.length; i++) h = (Math.imul(h, 16777619) ^ bits[i]) >>> 0;
  return h.toString(16);
}

describe('computeSurface — slope', () => {
  it('recovers the true slope of a tilted plane', () => {
    // 30% grade to the east.
    const grid = syntheticGrid(plane(0.3, 0), { size: SIZE });
    const s = computeSurface(grid);
    const expected = (Math.atan(0.3) * 180) / Math.PI;
    expect(s.slope[CENTER]).toBeCloseTo(expected, 4);
  });

  it('is scale-correct: doubling cell size halves the slope of the same heights', () => {
    const f = plane(0.4, 0);
    const a = computeSurface(syntheticGrid(f, { size: SIZE, cellSize: 10 }));
    const b = computeSurface(syntheticGrid(f, { size: SIZE, cellSize: 10 }));
    expect(a.slope[CENTER]).toBeCloseTo(b.slope[CENTER], 6);

    // Same *height field*, coarser cells → gentler slope.
    const grid = syntheticGrid(f, { size: SIZE, cellSize: 10 });
    const coarse = computeSurface(
      Object.assign(Object.create(Object.getPrototypeOf(grid)), grid, { cellSize: 20 }),
    );
    expect(Math.tan((coarse.slope[CENTER] * Math.PI) / 180)).toBeCloseTo(0.2, 4);
  });

  it('reports 0° on a level surface', () => {
    const grid = syntheticGrid(() => 500, { size: SIZE });
    const s = computeSurface(grid);
    expect(s.slope[CENTER]).toBeCloseTo(0, 6);
    expect(s.aspect[CENTER]).toBe(-1);
  });
});

describe('computeSurface — aspect', () => {
  // Aspect is the DOWNSLOPE azimuth. Ground rising to the east means the
  // downhill direction is west (270°). Getting this mirrored is the single
  // most common bug in DEM code and would invert every leeward-bedding layer.
  const cases: Array<[string, number, number, number]> = [
    ['rising east → faces west', 0.3, 0, 270],
    ['rising west → faces east', -0.3, 0, 90],
    ['rising north → faces south', 0, 0.3, 180],
    ['rising south → faces north', 0, -0.3, 0],
    ['rising northeast → faces southwest', 0.3, 0.3, 225],
    ['rising southeast → faces northwest', 0.3, -0.3, 315],
  ];

  for (const [name, ge, gn, expected] of cases) {
    it(name, () => {
      const grid = syntheticGrid(plane(ge, gn), { size: SIZE });
      const s = computeSurface(grid);
      const got = s.aspect[CENTER];
      const delta = Math.abs(((got - expected + 540) % 360) - 180);
      expect(delta).toBeLessThan(0.5);
    });
  }
});

// ---------------------------------------------------------------------------
// R49 — the 3x3 kernels guarded only their centre cell
// ---------------------------------------------------------------------------

/**
 * The surface every reproduction below is measured against: a uniform plane of
 * exactly 15°, whose slope, aspect, curvature and TRI are all known in closed
 * form everywhere. Any deviation is fabrication, not approximation.
 */
const GRADE_15 = Math.tan((15 * Math.PI) / 180);
/** Halo wide enough that nothing here is ever an edge-replication artefact. */
const R49_HALO = 6;

function planeGrid(): HeightGrid {
  return syntheticGrid(plane(GRADE_15, 0), { size: SIZE, halo: R49_HALO });
}

/** Chebyshev distance, which is the metric a 3x3 kernel actually reaches over. */
function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

describe('computeSurface — no-data anywhere in the window (R49)', () => {
  it('one missing neighbour no longer fabricates a near-vertical cliff', () => {
    // REPRODUCTION 1, verbatim from the backlog row. Punch out the west
    // neighbour of (10, 10) on a 15° plane.
    //
    //   before:  slope 89.9311°, aspect 270.00°
    //   truth:   slope 15°,      aspect 270°
    //
    // The kernel differenced the real terrain against a value 33 km below it.
    // Nothing crashed, nothing was NaN, and the map grew a one-cell fringe of
    // "sheer cliff" around every DEM void and along every edge where a
    // neighbour tile 404'd — which is what `assembleGrid` produces whenever a
    // fetch fails or a user pans past a downloaded region.
    const g = planeGrid();
    g.set(9, 10, NODATA);
    const s = computeSurface(g);
    const i = 10 * SIZE + 10;

    expect(s.slope[i], 'was 89.9311°').toBeNaN();
    expect(s.aspect[i], 'no aspect — the same sentinel a flat cell gets').toBe(-1);
    // The gradients matter separately: `hillshade` and `stepCost` read them
    // directly, and a zero-initialised gradient is "level ground", not "no
    // ground", so an unknown cell used to shade as a lit flat.
    expect(s.dzdx[i], 'was +819.2 — a 33 km cliff over 40 m').toBeNaN();
    expect(s.dzdy[i]).toBeNaN();

    // Two cells away the window is clean again and the closed form is exact.
    expect(s.slope[10 * SIZE + 12]).toBeCloseTo(15, 4);
    expect(s.aspect[10 * SIZE + 12]).toBeCloseTo(270, 4);
  });

  it('all eight missing no longer fabricates a perfect flat pad', () => {
    // REPRODUCTION 2. With every neighbour missing, the sentinel differences
    // against *itself*, both Horn terms cancel exactly, and the cell reported
    //
    //   before:  slope 0.00°, aspect −1   — i.e. a dead-level pad
    //   truth:   slope 15°,   aspect 270°
    //
    // This is the more dangerous of the two, because 0° is not an obviously
    // broken number: it is the **maximum** of the bedding pad term and it sits
    // inside `detectBenches`' ≤8° window, so the engine's confident answer for
    // ground it cannot see at all was "prime flat shelf".
    const g = planeGrid();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx || dy) g.set(20 + dx, 20 + dy, NODATA);
      }
    }
    const s = computeSurface(g);
    const i = 20 * SIZE + 20;

    expect(s.slope[i], 'was exactly 0 — the flat-pad maximum').toBeNaN();
    expect(s.slope[i]).not.toBe(0);
    expect(s.dzdx[i]).toBeNaN();
    expect(s.dzdy[i]).toBeNaN();
  });

  it('is confined to the void margin: every other cell is bit-identical', () => {
    // The fix changes what the map looks like at every void edge, and it must
    // change *nothing* else. Asserted with `Object.is` rather than a tolerance:
    // a 3x3 kernel reaches exactly one cell, so any difference at Chebyshev
    // distance ≥ 2 means the guard leaked into terrain it was never asked about.
    const holes: Array<[number, number]> = [
      [9, 10],
      [20, 20],
      [3, 28],
    ];
    for (const [name, f] of [
      ['plane', plane(GRADE_15, 0)],
      ['paraboloid', paraboloid(0.001)],
      ['saddle', saddle(0.001)],
    ] as const) {
      const clean = computeSurface(syntheticGrid(f, { size: SIZE, halo: R49_HALO }));
      const holed = syntheticGrid(f, { size: SIZE, halo: R49_HALO });
      for (const [hx, hy] of holes) holed.set(hx, hy, NODATA);
      const got = computeSurface(holed);

      let greyed = 0;
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const i = y * SIZE + x;
          const touched = holes.some(([hx, hy]) => chebyshev(x, y, hx, hy) <= 1);
          if (touched) {
            expect(Number.isNaN(got.slope[i]), `${name} margin ${x},${y}`).toBe(true);
            greyed++;
            continue;
          }
          for (const k of ['slope', 'aspect', 'dzdx', 'dzdy'] as const) {
            expect(
              Object.is(got[k][i], clean[k][i]),
              `${name} ${k} at ${x},${y}: ${got[k][i]} vs ${clean[k][i]}`,
            ).toBe(true);
          }
        }
      }
      // 3 holes x a 3x3 margin, none of them overlapping or off-grid.
      expect(greyed, `${name}: exactly the 3x3 margins`).toBe(27);
    }
  });

  it('does NOT grey the tile border — a short halo is an artefact, not a void', () => {
    // The failure mode the guard must not introduce. `HeightGrid.get`
    // edge-replicates outside the padded buffer, so the outermost interior
    // cells of a grid with no halo still see real elevations. Greying them
    // would paint a frame around every tile — the seam grid this package
    // exists to avoid, and the same distinction `R40` had to draw between
    // `RingSlopeStats.samples` and `.missing`.
    for (const halo of [0, 1, 4]) {
      const s = computeSurface(syntheticGrid(plane(GRADE_15, 0), { size: SIZE, halo }));
      for (let i = 0; i < s.slope.length; i++) {
        expect(
          Number.isNaN(s.slope[i]),
          `halo ${halo}, cell ${i % SIZE},${Math.floor(i / SIZE)}`,
        ).toBe(false);
      }
      // The corner is edge-replicated in two axes and is the strictest case.
      expect(s.slope[0], `halo ${halo} corner`).not.toBeNaN();
    }
  });

  it('greys the interior edge when a neighbour tile is missing, and only that edge', () => {
    // The real shape of the bug on a phone: `assembleGrid` leaves a missing
    // neighbour as NODATA *inside* the halo, so the tile's west column has an
    // unreadable window while its east column is perfectly fine.
    const g = syntheticGrid(plane(GRADE_15, 0), { size: SIZE, halo: 4 });
    for (let y = -4; y < SIZE + 4; y++) {
      for (let x = -4; x < 0; x++) g.set(x, y, NODATA);
    }
    const s = computeSurface(g);
    for (let y = 0; y < SIZE; y++) {
      expect(Number.isNaN(s.slope[y * SIZE]), `west column row ${y}`).toBe(true);
      // 3 decimals, not 4: at the far east column the elevations are ~543 m,
      // where a Float32 mantissa step is ~3e-5 m, and Horn divides differences
      // by 8·cellSize. That is the honest precision of the storage format —
      // and still four orders of magnitude tighter than the 89.93° it used to
      // report one column to the west.
      expect(s.slope[y * SIZE + 1], `second column row ${y}`).toBeCloseTo(15, 3);
      expect(s.slope[y * SIZE + SIZE - 1], `east column row ${y}`).toBeCloseTo(15, 3);
    }
  });

  it('abstains on the same cells as slope only where the ground itself is void', () => {
    // `R49` pinned this as "a definite slope implies a definite cover", which was
    // true when VRM's only rule was `n > 0`. `R50` gave VRM a quorum and the
    // implication broke in **both** directions, so what is pinned now is the
    // divergence itself, measured, rather than a tidier claim that is false:
    //
    //  - slope is a 3x3 measurement, cover a 9x9 one, so a cell can have a clean
    //    3x3 while two thirds of its cover window is lake → slope, no cover;
    //  - and a cell's own 3x3 can straddle a void while 72 of the other 80
    //    windows in its neighbourhood are clean → cover, no slope. Cell (15,15)
    //    below is exactly that: diagonal to the void, 72/81 covered.
    //
    // Both are safe because `beddingLikelihood` abstains on a `NaN` from
    // *either*, which is asserted at the bottom of this test rather than assumed.
    const g = syntheticGrid(plane(GRADE_15, 0), { size: SIZE, halo: 8 });
    g.set(16, 16, NODATA);
    g.set(5, 20, NODATA);
    const s = computeSurface(g);
    const vrm = computeVectorRuggedness(g);

    // Where the ground itself is missing, both must abstain. That is the part of
    // the R49 agreement that is load-bearing and it still holds exactly.
    for (const [x, y] of [
      [16, 16],
      [5, 20],
    ]) {
      expect(Number.isNaN(s.slope[y * SIZE + x]), `slope ${x},${y}`).toBe(true);
      expect(Number.isNaN(vrm[y * SIZE + x]), `vrm ${x},${y}`).toBe(true);
    }
    // The measured divergence, so a future change to either quorum has to look
    // at it rather than discover it.
    expect(Number.isNaN(s.slope[15 * SIZE + 15]), 'own 3x3 touches the void').toBe(true);
    expect(Number.isNaN(vrm[15 * SIZE + 15]), '72 of 81 windows are clean').toBe(false);

    // The invariant that actually protects the map: the composite refuses
    // wherever either input refused.
    const bedding = beddingLikelihood(s, {
      windFromDeg: 270,
      vectorRuggedness: vrm,
    });
    for (let i = 0; i < s.slope.length; i++) {
      if (Number.isNaN(s.slope[i]) || Number.isNaN(vrm[i])) {
        expect(Number.isNaN(bedding[i]), `cell ${i % SIZE},${Math.floor(i / SIZE)}`).toBe(true);
      }
    }
  });
});

describe('computeCurvature', () => {
  it('reads a bowl as concave in both principal directions', () => {
    const grid = syntheticGrid(paraboloid(0.001), { size: SIZE });
    const c = computeCurvature(grid);
    expect(c.maxCurvature[CENTER]).toBeLessThan(0);
    expect(c.minCurvature[CENTER]).toBeLessThan(0);
  });

  it('reads a knob as convex in both principal directions', () => {
    const grid = syntheticGrid(paraboloid(-0.001), { size: SIZE });
    const c = computeCurvature(grid);
    expect(c.maxCurvature[CENTER]).toBeGreaterThan(0);
    expect(c.minCurvature[CENTER]).toBeGreaterThan(0);
  });

  it('reads a col as opposite-signed principal curvatures — the saddle signature', () => {
    const grid = syntheticGrid(saddle(0.001), { size: SIZE });
    const c = computeCurvature(grid);
    expect(c.maxCurvature[CENTER]).toBeGreaterThan(0);
    expect(c.minCurvature[CENTER]).toBeLessThan(0);
  });

  it('gives positive cross-sectional curvature on a spur and negative in a draw', () => {
    const spur = computeCurvature(syntheticGrid(ridge(0.002, 0.3), { size: SIZE }));
    const draw = computeCurvature(syntheticGrid(channel(0.002, 0.3), { size: SIZE }));
    expect(spur.crossSectional[CENTER]).toBeGreaterThan(0);
    expect(draw.crossSectional[CENTER]).toBeLessThan(0);
  });

  // Regression guard. These signs were inverted at first, which silently made
  // the "thermal sinks" filter select spurs and the sinking-thermal model
  // amplify on ridge tops instead of in draws. Nothing crashed; the map was
  // just confidently wrong, which is the worst failure mode this product has.
  describe('sign conventions (ESRI)', () => {
    it('plan curvature is POSITIVE on a divergent spur', () => {
      const c = computeCurvature(syntheticGrid(ridge(0.002, 0.3), { size: SIZE }));
      expect(c.plan[CENTER]).toBeGreaterThan(0);
    });

    it('plan curvature is NEGATIVE in a convergent draw', () => {
      const c = computeCurvature(syntheticGrid(channel(0.002, 0.3), { size: SIZE }));
      expect(c.plan[CENTER]).toBeLessThan(0);
    });

    it('profile curvature is NEGATIVE over a convex crest', () => {
      // Falls away to the north with increasing steepness — convex downslope.
      const c = computeCurvature(syntheticGrid((x, y) => 500 - 0.002 * y * y, { size: SIZE }));
      // Sample off-centre so the cell has a real downslope direction.
      const off = (SIZE * 3 + 3) * 1 + Math.floor(SIZE / 2) + SIZE * 5;
      expect(c.profile[off]).toBeLessThan(0);
    });

    it('profile curvature is POSITIVE in a concave toe slope', () => {
      const c = computeCurvature(syntheticGrid((x, y) => 500 + 0.002 * y * y, { size: SIZE }));
      const off = (SIZE * 3 + 3) * 1 + Math.floor(SIZE / 2) + SIZE * 5;
      expect(c.profile[off]).toBeGreaterThan(0);
    });

    it('plan and crossSectional always agree in sign', () => {
      // They are the same quantity at different normalisations; disagreement
      // means one of the two formulas drifted.
      for (const f of [ridge(0.002, 0.3), channel(0.002, 0.3), plane(0.2, 0.3)]) {
        const c = computeCurvature(syntheticGrid(f, { size: SIZE }));
        expect(Math.sign(c.plan[CENTER])).toBe(Math.sign(c.crossSectional[CENTER]));
      }
    });

    it('profile and longitudinal always DISAGREE in sign (different conventions)', () => {
      const c = computeCurvature(syntheticGrid((x, y) => 500 - 0.002 * y * y, { size: SIZE }));
      const off = (SIZE * 3 + 3) * 1 + Math.floor(SIZE / 2) + SIZE * 5;
      expect(Math.sign(c.profile[off])).toBe(-Math.sign(c.longitudinal[off]));
    });
  });

  it('is flat-curvature on a plane', () => {
    const grid = syntheticGrid(plane(0.25, -0.1), { size: SIZE });
    const c = computeCurvature(grid);
    expect(Math.abs(c.crossSectional[CENTER])).toBeLessThan(1e-9);
    expect(Math.abs(c.profile[CENTER])).toBeLessThan(1e-9);
  });

  describe('no-data anywhere in the window (R49)', () => {
    it('no longer fits a quadratic through the sentinel', () => {
      // Measured on the same 15° plane, whose true curvature is 0 in every
      // component:
      //
      //   one neighbour missing   → crossSectional  27.7   ("Channel / draw")
      //   all eight missing       → maxCurvature   221.9   (peak/pass family)
      //
      // Both are Wood-classifiable shapes, so a void did not render as a void:
      // it rendered as a draw ringed by knobs. Draws are the classic travel
      // corridor and saddles are the loudest colour on this map, so the layer
      // was inventing the two features a hunter most wants to find.
      const g = planeGrid();
      g.set(9, 10, NODATA);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) if (dx || dy) g.set(20 + dx, 20 + dy, NODATA);
      }
      const c = computeCurvature(g);
      for (const i of [10 * SIZE + 10, 20 * SIZE + 20]) {
        for (const k of [
          'profile',
          'plan',
          'longitudinal',
          'crossSectional',
          'maxCurvature',
          'minCurvature',
        ] as const) {
          expect(c[k][i], `${k} at ${i}`).toBeNaN();
        }
      }
    });

    it('keeps the closed-form principal curvatures of a pit and a col elsewhere', () => {
      // For z = a·x² + b·y² the Evans–Young fit recovers a and b exactly, so
      // maxCurvature = −a−b+|a−b| and minCurvature = −a−b−|a−b| are exact.
      // A void 5 cells away must not perturb either by a single float.
      const k = 0.001;
      for (const [name, f, maxC, minC] of [
        ['pit (paraboloid)', paraboloid(k), -2 * k, -2 * k],
        ['col (hyperbolic paraboloid)', saddle(k), 2 * k, -2 * k],
      ] as const) {
        const g = syntheticGrid(f, { size: SIZE, halo: R49_HALO });
        const clean = computeCurvature(g);
        g.set(16 + 5, 16, NODATA);
        const holed = computeCurvature(g);
        // 6 decimals: curvature is stored as Float32 and the values are ~1e-3,
        // so ~1e-7 of absolute slack is the format, not the maths.
        expect(clean.maxCurvature[CENTER], name).toBeCloseTo(maxC, 6);
        expect(clean.minCurvature[CENTER], name).toBeCloseTo(minC, 6);
        expect(Object.is(holed.maxCurvature[CENTER], clean.maxCurvature[CENTER]), name).toBe(true);
        expect(Object.is(holed.minCurvature[CENTER], clean.minCurvature[CENTER]), name).toBe(true);
      }
    });
  });
});

describe('computeRuggedness', () => {
  it('is zero on a level surface and rises with relief', () => {
    const flat = computeRuggedness(syntheticGrid(() => 500, { size: SIZE }));
    const steep = computeRuggedness(syntheticGrid(plane(0.8, 0), { size: SIZE }));
    expect(flat[CENTER]).toBeCloseTo(0, 6);
    expect(steep[CENTER]).toBeGreaterThan(flat[CENTER]);
  });

  it('matches the closed form g·s·√6 on a plane — i.e. it tracks slope', () => {
    // This is not a nice property, it is the defect: TRI cannot be used as a
    // cover proxy alongside a slope term, because on smooth ground it *is* a
    // slope term. Pinned here so the reason VRM exists stays visible.
    for (const grade of [0.1, 0.3, 0.6, 1.0]) {
      const tri = computeRuggedness(syntheticGrid(plane(0, grade), { size: SIZE, cellSize: 2 }));
      expect(tri[CENTER]).toBeCloseTo(grade * 2 * Math.sqrt(6), 4);
    }
  });

  it('does not report tens of kilometres of "local relief" next to a void (R49)', () => {
    // TRI is the one layer here whose units a user reads literally — "local
    // relief in metres" — and it is denormalised onto every observation row at
    // write time, so a fabricated value is not just rendered, it is *stored*
    // and then aggregated into the property's terrain profile. On the 15° plane
    // whose true TRI is 6.563 m, the same cell read:
    //
    //   one neighbour missing  →  33,251.9 m
    //   all eight missing      →  94,126.4 m
    const g = planeGrid();
    const truth = Math.tan((15 * Math.PI) / 180) * 10 * Math.sqrt(6);
    expect(computeRuggedness(g)[10 * SIZE + 10]).toBeCloseTo(truth, 4);

    g.set(9, 10, NODATA);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) if (dx || dy) g.set(20 + dx, 20 + dy, NODATA);
    }
    const tri = computeRuggedness(g);
    expect(tri[10 * SIZE + 10], 'was 33,251.9 m').toBeNaN();
    expect(tri[20 * SIZE + 20], 'was 94,126.4 m').toBeNaN();
    // A partial window is not averaged either: RMS over the three neighbours
    // that happen to exist is not "relief", it is a different quantity wearing
    // the same label.
    expect(tri[11 * SIZE + 10], 'diagonal neighbour of the punched cell').toBeNaN();
    expect(tri[12 * SIZE + 10], 'two cells clear').toBeCloseTo(truth, 4);
  });
});

describe('computeVectorRuggedness', () => {
  it('is exactly zero on a plane at every grade — the point of VRM', () => {
    // A plane has one surface normal everywhere, so the resultant vector has
    // full length and dispersion is nil, no matter how steep it is. This is the
    // property TRI lacks and the reason Sappington et al. 2007 built VRM.
    for (const grade of [0, 0.1, 0.3, 0.6, 1.0, 1.6]) {
      const vrm = computeVectorRuggedness(
        syntheticGrid(plane(0.2, grade), { size: SIZE, halo: 8, cellSize: 2 }),
      );
      expect(vrm[CENTER], `grade ${grade}`).toBeLessThan(1e-6);
    }
  });

  it('rises with orientation dispersion, not with steepness', () => {
    // Corrugated ground: same mean grade as the smooth plane, but the normals
    // sweep back and forth across the window.
    const smooth = computeVectorRuggedness(syntheticGrid(plane(0, 0.6), { size: SIZE, halo: 8 }));
    const broken = computeVectorRuggedness(
      syntheticGrid((x, y) => 0.6 * y + 5 * Math.sin((2 * Math.PI * x) / 80), {
        size: SIZE,
        halo: 8,
      }),
    );
    expect(smooth[CENTER]).toBeLessThan(1e-6);
    expect(broken[CENTER]).toBeGreaterThan(0.01);
    expect(broken[CENTER]).toBeLessThanOrEqual(1);
  });

  it('stays in [0, 1] and reports no-data as NaN', () => {
    const grid = syntheticGrid(paraboloid(-0.002), { size: SIZE, halo: 8 });
    grid.set(5, 5, NODATA);
    const vrm = computeVectorRuggedness(grid);
    expect(Number.isNaN(vrm[5 * SIZE + 5])).toBe(true);
    for (let i = 0; i < vrm.length; i++) {
      if (Number.isNaN(vrm[i])) continue;
      expect(vrm[i]).toBeGreaterThanOrEqual(0);
      expect(vrm[i]).toBeLessThanOrEqual(1);
    }
  });

  it('does not let a NODATA hole leak a fake cliff into the neighbourhood', () => {
    // A Horn gradient straddling the sentinel is a 32 km cliff; if those cells
    // were counted, one void would paint a ring of maximum "cover" around it.
    const grid = syntheticGrid(plane(0, 0.3), { size: SIZE, halo: 8 });
    grid.set(16, 16, NODATA);
    const vrm = computeVectorRuggedness(grid);
    // Two cells away from the hole: window still touches it, value must stay ~0.
    expect(vrm[16 * SIZE + 18]).toBeLessThan(1e-6);
  });
});

describe('computeVectorRuggedness — the window quorum (R50)', () => {
  /**
   * ## The surface, and why it has a closed form
   *
   * A "roof": `z = 500 − g·|x|` metres. Two planar facets meeting at a crest —
   * the elementary broken-ground feature, and a real one (a ridge crest is
   * exactly this). Horn's kernel is exact on a plane, so every window one cell
   * or more off the crest sits wholly on one facet and returns `dz/dx = ∓g`
   * exactly, while the crest column returns 0 by symmetry. The 9x9 VRM window
   * centred on the crest therefore holds exactly three distinct unit normals in
   * known proportions (4 columns : 1 column : 4 columns), and
   *
   *     VRM_crest = 1 − (8/√(1+g²) + 1) / 9
   *
   * with no numerical fitting anywhere in it. Every expectation below is that
   * closed form evaluated over the columns that survive a flood, so a wrong
   * answer is wrong by a stated amount rather than by a tolerance.
   */
  const GRADE = 0.5;
  const RSIZE = 33;
  const HALO = 8;
  const RC = (RSIZE - 1) / 2;
  const CREST = RC * RSIZE + RC;
  const roof = (x: number, y: number): number => {
    void y;
    return 500 - GRADE * Math.abs(x);
  };
  /** Unit-normal components of one facet: (∓sin, 0, cos) of the facet tilt. */
  const COS = 1 / Math.sqrt(1 + GRADE * GRADE);
  const SIN = GRADE * COS;
  const TRUE_CREST_VRM = 1 - (8 * COS + 1) / 9;

  /**
   * Roof grid with everything strictly west of interior column `cut` flooded —
   * the shape a lake edge, a mosaic boundary or a missing neighbour tile leaves.
   * A padded cell keeps a complete 3x3 iff it sits at `cut + 1` or further east,
   * so the crest's 9-column window retains columns `cut+1 … RC+4`.
   */
  function floodedRoof(cut: number): HeightGrid {
    const g = syntheticGrid(roof, { size: RSIZE, halo: HALO, cellSize: 10 });
    for (let y = -HALO; y < RSIZE + HALO; y++) {
      for (let x = -HALO; x < cut; x++) g.set(x, y, NODATA);
    }
    return g;
  }

  /** Closed-form VRM over `west` west-facet columns, `crest` crest columns, `east` east. */
  function closedForm(west: number, crest: number, east: number): number {
    const n = 9 * (west + crest + east);
    const sx = 9 * (east - west) * SIN;
    const sz = 9 * ((west + east) * COS + crest);
    return 1 - Math.hypot(sx, sz) / n;
  }

  it('reads a ridge crest as broken ground — the closed form', () => {
    const vrm = computeVectorRuggedness(
      syntheticGrid(roof, { size: RSIZE, halo: HALO, cellSize: 10 }),
      { radiusCells: 4 },
    );
    expect(TRUE_CREST_VRM).toBeCloseTo(0.0938425, 7);
    expect(vrm[CREST]).toBeCloseTo(TRUE_CREST_VRM, 6);
    expect(vrm[CREST]).toBeCloseTo(closedForm(4, 1, 4), 6);
  });

  it('refuses a window that is 44% covered instead of calling a crest a billiard table', () => {
    // The R50 defect in one number. Flooding to the crest column leaves the four
    // east-facet columns — 36 of 81 cells, all of them the *same* normal — so
    // the old `n > 0` rule returned VRM = 0 EXACTLY: not "a bit smoother than it
    // really is", but the engine's strongest possible statement that this ground
    // is a plane and conceals nothing. It is a ridge crest.
    const g = floodedRoof(RC);
    expect(closedForm(0, 0, 4)).toBe(0);
    const vrm = computeVectorRuggedness(g, { radiusCells: 4 });
    expect(Number.isNaN(vrm[CREST]), '36/81 covered, was a definite 0').toBe(true);
  });

  it('refuses at 56% — the coverage the neighbouring 0.5 quorums would have passed', () => {
    // 45 of 81 = 0.556 clears `TPI_MIN_DATA_FRACTION` and
    // `BEDDING_RING_MIN_DATA_FRACTION`. It must not clear this one: the closed
    // form here is 0.01704 against a truth of 0.09384, which is a 5.5x
    // understatement of the concealment on this cell.
    const g = floodedRoof(RC - 1);
    expect(closedForm(0, 1, 4)).toBeCloseTo(0.017037, 5);
    expect(0.556).toBeGreaterThan(0.5);
    const vrm = computeVectorRuggedness(g, { radiusCells: 4 });
    expect(Number.isNaN(vrm[CREST]), '45/81 covered').toBe(true);
  });

  it('answers at 78% and the answer is worth having', () => {
    // 63/81 = 0.778 is the tightest coverage the quorum admits on a straight
    // flood edge. The closed form there is 0.08156 against a truth of 0.09384 —
    // a 13% understatement, and (see the bedding test below) small enough that
    // the cover term it feeds does not move far.
    const g = floodedRoof(RC - 3);
    const vrm = computeVectorRuggedness(g, { radiusCells: 4 });
    expect(vrm[CREST]).toBeCloseTo(closedForm(2, 1, 4), 6);
    expect(vrm[CREST]).toBeCloseTo(0.08156, 5);
  });

  it('bounds what the admitted error can do to the bedding cover term', () => {
    // This is the measurement the 0.75 was chosen from, so it is pinned here
    // rather than asserted in prose. The cover term is
    // `0.4 + 0.6·clamp01(vrm / BEDDING_VRM_FULL_COVER)`, i.e. a 0.6-wide range.
    const coverTerm = (v: number): number =>
      0.4 + 0.6 * Math.min(1, Math.max(0, v / BEDDING_VRM_FULL_COVER));
    // Worst measured geometry: a roof gentle enough that the cover term is not
    // saturated, so the whole error passes through to the score.
    const g35 = 0.35;
    const cos35 = 1 / Math.sqrt(1 + g35 * g35);
    const truth35 = 1 - (8 * cos35 + 1) / 9;
    const build = (cut: number): HeightGrid => {
      const g = syntheticGrid(
        (x, y) => {
          void y;
          return 500 - g35 * Math.abs(x);
        },
        { size: RSIZE, halo: HALO, cellSize: 10 },
      );
      for (let y = -HALO; y < RSIZE + HALO; y++) {
        for (let x = -HALO; x < cut; x++) g.set(x, y, NODATA);
      }
      return g;
    };
    // Admitted (coverage 0.778): error must stay inside 15% of the term's range.
    const admitted = computeVectorRuggedness(build(RC - 3), { radiusCells: 4 })[CREST];
    expect(Number.isNaN(admitted)).toBe(false);
    const admittedErr = Math.abs(coverTerm(admitted) - coverTerm(truth35));
    expect(admittedErr).toBeLessThan(0.15 * 0.6);
    // Refused (coverage 0.667 and 0.556): had they been admitted, the error
    // would have been 29% and 68% of the range. Those are the numbers that put
    // the threshold above 0.667 rather than at the neighbours' 0.5.
    for (const cut of [RC - 2, RC - 1]) {
      expect(
        Number.isNaN(computeVectorRuggedness(build(cut), { radiusCells: 4 })[CREST]),
        `cut ${cut}`,
      ).toBe(true);
    }
  });

  it('is inert on a fully covered tile — nothing in the interior moves', () => {
    // A quorum bug hides inside an epsilon, so this is `Object.is` against a
    // hash of the pre-R50 output, not a tolerance. The grid is fully haloed, and
    // the measured fact that makes this safe is that a haloed VRM window is
    // *always* 81/81 covered: unlike `ringSlopeStats`, VRM reads the halo, so
    // there is no clipped-window border case for a fraction quorum to catch.
    const g = syntheticGrid(
      (x, y) => 500 + 0.25 * x + 4 * Math.sin(x / 23) * Math.cos(y / 19) + 0.9 * Math.sin(x / 7),
      { size: 33, halo: 8, cellSize: 10 },
    );
    const vrm = computeVectorRuggedness(g, { radiusCells: 4 });
    expect(float32Hash(vrm), 'pre-R50 baseline').toBe('1ff8f706');
    for (let i = 0; i < vrm.length; i++) expect(Number.isNaN(vrm[i]), `cell ${i}`).toBe(false);
  });

  it('still answers everywhere on a tile whose neighbours are all present', () => {
    // The cost of the quorum is paid only where data is genuinely absent. Every
    // interior cell of a haloed grid — corners included — keeps a complete
    // window, so a well-covered tile is untouched and no seam grid appears.
    for (const halo of [5, 8, 20]) {
      const g = syntheticGrid(paraboloid(-0.0015), { size: 33, halo, cellSize: 10 });
      const vrm = computeVectorRuggedness(g, { radiusCells: 4 });
      for (let i = 0; i < vrm.length; i++) {
        expect(Number.isNaN(vrm[i]), `halo ${halo}, cell ${i}`).toBe(false);
      }
    }
  });
});
