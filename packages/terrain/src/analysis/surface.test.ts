import { describe, expect, it } from 'vitest';
import { computeCurvature, computeRuggedness, computeSurface } from './surface.js';
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
      const c = computeCurvature(
        syntheticGrid((x, y) => 500 - 0.002 * y * y, { size: SIZE }),
      );
      // Sample off-centre so the cell has a real downslope direction.
      const off = (SIZE * 3 + 3) * 1 + Math.floor(SIZE / 2) + SIZE * 5;
      expect(c.profile[off]).toBeLessThan(0);
    });

    it('profile curvature is POSITIVE in a concave toe slope', () => {
      const c = computeCurvature(
        syntheticGrid((x, y) => 500 + 0.002 * y * y, { size: SIZE }),
      );
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
      const c = computeCurvature(
        syntheticGrid((x, y) => 500 - 0.002 * y * y, { size: SIZE }),
      );
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
});

describe('computeRuggedness', () => {
  it('is zero on a level surface and rises with relief', () => {
    const flat = computeRuggedness(syntheticGrid(() => 500, { size: SIZE }));
    const steep = computeRuggedness(syntheticGrid(plane(0.8, 0), { size: SIZE }));
    expect(flat[CENTER]).toBeCloseTo(0, 6);
    expect(steep[CENTER]).toBeGreaterThan(flat[CENTER]);
  });
});
