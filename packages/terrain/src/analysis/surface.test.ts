import { describe, expect, it } from 'vitest';
import {
  computeCurvature,
  computeRuggedness,
  computeSurface,
  computeVectorRuggedness,
  NODATA,
} from './surface.js';
import { HeightGrid } from '../dem/grid.js';
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

  it('agrees with computeVectorRuggedness about which cells are measurable', () => {
    // The two used to disagree, which is the whole of `R49`: VRM refused the
    // exact windows Horn was differencing against the sentinel. VRM's window
    // contains the cell itself, so a definite slope now implies a definite
    // cover — pinned here so the two cannot drift apart again.
    const g = syntheticGrid(plane(GRADE_15, 0), { size: SIZE, halo: 8 });
    g.set(16, 16, NODATA);
    g.set(5, 20, NODATA);
    const s = computeSurface(g);
    const vrm = computeVectorRuggedness(g);
    for (let i = 0; i < s.slope.length; i++) {
      if (Number.isFinite(s.slope[i])) expect(Number.isNaN(vrm[i]), `cell ${i}`).toBe(false);
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
