/**
 * Synthetic terrain generators for tests.
 *
 * The whole engine is validated against surfaces whose true slope, aspect and
 * curvature are known analytically. That is the only honest way to test terrain
 * code: a hillshade "looks right" screenshot proves nothing, and a regression
 * fixture just freezes whatever bug existed when it was recorded.
 */

import { HeightGrid } from '../dem/grid.js';

export interface SyntheticOptions {
  size?: number;
  halo?: number;
  cellSize?: number;
  centerLat?: number;
  centerLng?: number;
}

/**
 * Build a grid from `z = f(xMetres, yMetres)`, where x is **east-positive** and
 * y is **north-positive**, both measured in metres from the grid centre.
 */
export function syntheticGrid(
  f: (x: number, y: number) => number,
  options: SyntheticOptions = {},
): HeightGrid {
  const size = options.size ?? 33;
  const halo = options.halo ?? 4;
  const cellSize = options.cellSize ?? 10;
  const grid = HeightGrid.empty(
    size,
    size,
    halo,
    cellSize,
    options.centerLat ?? 40,
    options.centerLng ?? -84,
  );
  const c = (size - 1) / 2;
  for (let y = -halo; y < size + halo; y++) {
    for (let x = -halo; x < size + halo; x++) {
      // Row index increases southward, so north-positive y flips the sign.
      grid.set(x, y, f((x - c) * cellSize, -(y - c) * cellSize));
    }
  }
  return grid;
}

/** Index of the centre cell of a square synthetic grid. */
export function centerIndex(size: number): number {
  const c = (size - 1) / 2;
  return c * size + c;
}

/** A tilted plane. `gradeEast`/`gradeNorth` are rise/run. */
export function plane(gradeEast: number, gradeNorth: number) {
  return (x: number, y: number): number => gradeEast * x + gradeNorth * y + 500;
}

/** Circular paraboloid. `k > 0` makes a pit, `k < 0` a peak. */
export function paraboloid(k: number) {
  return (x: number, y: number): number => k * (x * x + y * y) + 500;
}

/** Hyperbolic paraboloid — a textbook saddle, rising east-west, falling north-south. */
export function saddle(k: number) {
  return (x: number, y: number): number => k * (x * x - y * y) + 500;
}

/** A cone rising to the centre. */
export function cone(slopeRatio: number) {
  return (x: number, y: number): number => 500 - slopeRatio * Math.hypot(x, y);
}

/**
 * A uniform hillside with a flat shelf cut into it — the canonical bench.
 *
 * The hill falls to the south at `grade`; between `benchLow` and `benchHigh`
 * metres north of centre the elevation is held constant, producing a level
 * terrace with steep ground above and below it.
 */
export function hillsideWithBench(grade = 0.45, benchLow = -30, benchHigh = 30) {
  return (x: number, y: number): number => {
    void x;
    if (y > benchHigh) return 500 + grade * (y - benchHigh) + grade * (benchHigh - benchLow) * 0;
    if (y >= benchLow) return 500;
    return 500 + grade * (y - benchLow);
  };
}

/**
 * A hillside with a **graded** shelf cut into it — the bench as it exists on
 * real ground, where the pad carries a few degrees rather than being a table.
 *
 * Continuous everywhere (no manufactured break of slope beyond the two intended
 * ones), so slope is analytically known: `atan(benchGrade)` on the pad between
 * `benchLow` and `benchHigh` metres north of centre, `atan(hillGrade)` above and
 * below. That closed form is what lets a test say a 10° shelf must outscore a
 * 22° sidehill and mean something by it.
 *
 * A pad grade of exactly 0 is avoidable on purpose in tests: a dead-flat cell has
 * no aspect, and every aspect-dependent term then collapses to its neutral value.
 */
export function benchedHillside(
  hillGrade = 0.45,
  benchGrade = 0.1,
  benchLow = -30,
  benchHigh = 30,
) {
  return (x: number, y: number): number => {
    void x;
    if (y > benchHigh)
      return 500 + benchGrade * (benchHigh - benchLow) + hillGrade * (y - benchHigh);
    if (y >= benchLow) return 500 + benchGrade * (y - benchLow);
    return 500 + hillGrade * (y - benchLow);
  };
}

/** A ridge running north–south with a convex cross-section, tilted downhill north. */
export function ridge(convexity: number, northGrade: number) {
  return (x: number, y: number): number => 500 - convexity * x * x + northGrade * y;
}

/** A channel/draw running north–south with a concave cross-section. */
export function channel(concavity: number, northGrade: number) {
  return (x: number, y: number): number => 500 + concavity * x * x + northGrade * y;
}
