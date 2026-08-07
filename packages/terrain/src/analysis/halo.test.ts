/**
 * `R30` — the halo-overflow silent degradation to "open ground".
 *
 * Every assertion in this file failed, or could not have been written, against
 * the code before the fix. The three horizon operators guarded their ray-march
 * with `!Number.isFinite(zr)`; `NODATA` is `-32768`, which is finite, so an
 * unwritten halo cell read as terrain 33 km below the viewer — "no obstruction".
 * Measured on the old code, at a cell whose whole ray lay in a no-data halo:
 *
 *   | operator          | halo has terrain | halo is NODATA | truth   |
 *   | ----------------- | ---------------- | -------------- | ------- |
 *   | `terrainShelter`  | 0.500            | **0.000**      | unknown |
 *   | `skyViewFactor`   | 0.467            | **1.000**      | unknown |
 *   | `castShadows`     | 0 (shaded)       | **1 (lit)**    | unknown |
 *
 * Each wrong value is the *most open* answer the operator can give, and each is
 * given with no signal at all. A hunter picks a "sun-warmed" bench that sits in
 * shade until mid-morning, or an "exposed" ridge that is in fact sheltered.
 *
 * The no-data halo built here is not hypothetical: `assembleGrid` leaves exactly
 * this pattern whenever a neighbour DEM tile 404s, or the user is panning past
 * the edge of a downloaded offline region — i.e. in the woods, with no signal,
 * which is the operating assumption.
 */

import { describe, expect, it } from 'vitest';
import {
  castShadows,
  DEFAULT_SHADOW_RADIUS_CELLS,
  SHADOW_LIT,
  SHADOW_SHADED,
  SHADOW_UNKNOWN,
} from './solar.js';
import { DEFAULT_SKY_VIEW_RADIUS_CELLS, skyViewFactor } from './shading.js';
import {
  DEFAULT_SHELTER_RADIUS_CELLS,
  SHELTER_FULL_HORIZON_DEG,
  terrainShelter,
} from './wind.js';
import { emptyRingScan, emptyScan, scanHorizon, scanHorizonRing } from './horizon.js';
import { isElevation, NODATA } from '../dem/encoding.js';
import { assembleGrid, HeightGrid } from '../dem/grid.js';
import {
  INSUFFICIENT_HALO,
  InsufficientHaloError,
  isInsufficientHaloError,
} from '../dem/halo.js';
import { analyze, requiredHalo } from '../pipeline.js';
import { plane, syntheticGrid } from '../testing/synthetic.js';

const SIZE = 31;
const HALO = 24;
const CELL = 10;
const RAD = Math.PI / 180;

/**
 * A cell on the north edge of the interior. With a wind out of the north (or a
 * bearing that leaves the tile northward) its entire ray lies in the halo, which
 * is the geometry that makes the defect visible rather than marginal.
 */
const NORTH_EDGE = 0 * SIZE + 15;
/** Likewise on the south edge, for a sun in the south. */
const SOUTH_EDGE = (SIZE - 1) * SIZE + 15;
/** The centre, whose ray spends most of its length on real interior data. */
const CENTRE = 15 * SIZE + 15;

const grade = (deg: number): number => Math.tan(deg * RAD);

function build(f: (x: number, y: number) => number): HeightGrid {
  return syntheticGrid(f, { size: SIZE, halo: HALO, cellSize: CELL });
}

/** Overwrite every halo cell with `value`, leaving the interior untouched. */
function setHalo(grid: HeightGrid, value: number): HeightGrid {
  for (let y = -grid.halo; y < grid.height + grid.halo; y++) {
    for (let x = -grid.halo; x < grid.width + grid.halo; x++) {
      if (x >= 0 && x < grid.width && y >= 0 && y < grid.height) continue;
      grid.set(x, y, value);
    }
  }
  return grid;
}

const reader = (g: HeightGrid) => (x: number, y: number) => g.get(x, y);

// ---------------------------------------------------------------------------
// The sentinel test itself
// ---------------------------------------------------------------------------

describe('isElevation', () => {
  it('rejects the NODATA sentinel that Number.isFinite accepts', () => {
    // This one line is the whole defect. Both halves must hold.
    expect(Number.isFinite(NODATA)).toBe(true);
    expect(isElevation(NODATA)).toBe(false);
  });

  it('rejects the sentinel after a float round-trip', () => {
    // Elevations pass through Float32 and bilinear resampling, so an exact
    // `=== NODATA` test would let a resampled sentinel through.
    expect(isElevation(NODATA + 0.4)).toBe(false);
    expect(isElevation(new Float32Array([NODATA])[0])).toBe(false);
  });

  it('rejects NaN and infinities, and accepts real terrain', () => {
    expect(isElevation(Number.NaN)).toBe(false);
    expect(isElevation(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isElevation(Number.NEGATIVE_INFINITY)).toBe(false);
    // Bottom of the Challenger Deep to the summit of Everest, and sea level.
    for (const z of [-10935, 0, 500.25, 8849]) expect(isElevation(z)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// terrainShelter
// ---------------------------------------------------------------------------

describe('terrainShelter with a no-data halo (R30)', () => {
  const FIFTEEN = () => build(plane(0, grade(15)));

  it('reports 0.5 on a 15° plane when the upwind halo is real terrain', () => {
    // Closed form: on a uniform plane the horizon angle is the plane's own
    // angle at every range, so shelter = min(1, 15/30) = 0.5 exactly.
    const s = terrainShelter(reader(FIFTEEN()), SIZE, SIZE, CELL, 0)[NORTH_EDGE];
    expect(s).toBeCloseTo(0.5, 4);
  });

  it('does NOT report "fully exposed" when the upwind halo is NODATA', () => {
    // Old code: 0.000 — a confident claim that nothing upwind shelters this
    // cell, on ground it never actually looked at.
    const s = terrainShelter(
      reader(setHalo(FIFTEEN(), NODATA)),
      SIZE,
      SIZE,
      CELL,
      0,
    )[NORTH_EDGE];
    expect(s).not.toBe(0);
    expect(Number.isNaN(s)).toBe(true);
  });

  it('keeps a definite 1 where the visible terrain already saturates the index', () => {
    // A 35° plane passes the 30° full-shelter ceiling within the interior, and
    // missing terrain can only ever *raise* a horizon. So the gaps beyond it
    // cannot change the answer and the cell stays known. This is the clause
    // that stops the fix from greying out ground it can genuinely see.
    const steep = setHalo(build(plane(0, grade(35))), NODATA);
    expect(terrainShelter(reader(steep), SIZE, SIZE, CELL, 0)[CENTRE]).toBe(1);
    expect(SHELTER_FULL_HORIZON_DEG).toBe(30);
  });

  it('is unchanged on a fully populated halo', () => {
    // The fix must cost nothing where the data is complete: no new NaNs, and
    // the same numbers as the closed form on a plain.
    const flat = terrainShelter(reader(build(() => 500)), SIZE, SIZE, CELL, 270);
    for (const v of flat) expect(v).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// skyViewFactor
// ---------------------------------------------------------------------------

describe('skyViewFactor with a no-data halo (R30)', () => {
  it('sees the rim when the halo carries it', () => {
    // Flat interior inside a 200 m rim: measurably enclosed.
    const svf = skyViewFactor(
      reader(setHalo(build(() => 500), 700)),
      SIZE,
      SIZE,
      CELL,
    )[NORTH_EDGE];
    expect(svf).toBeCloseTo(0.467, 2);
  });

  it('does NOT report open sky when the halo is NODATA', () => {
    // Old code: 1.000 — "the whole hemisphere is visible from here" — for a
    // cell whose surroundings were never loaded. This is the cold-air-pooling
    // proxy, so the error runs in the worst direction: an enclosed draw reads
    // as an open flat.
    const svf = skyViewFactor(
      reader(setHalo(build(() => 500), NODATA)),
      SIZE,
      SIZE,
      CELL,
    )[NORTH_EDGE];
    expect(svf).not.toBe(1);
    expect(Number.isNaN(svf)).toBe(true);
  });

  it('has no ceiling, so even the centre cell goes unknown', () => {
    // Unlike shelter, every extra metre of horizon changes the answer, so there
    // is no "already pinned" escape. Documented here so the asymmetry between
    // the three operators is deliberate and visible rather than a surprise.
    const svf = skyViewFactor(
      reader(setHalo(build(plane(0, grade(35))), NODATA)),
      SIZE,
      SIZE,
      CELL,
    )[CENTRE];
    expect(Number.isNaN(svf)).toBe(true);
  });

  it('is unchanged on a fully populated halo', () => {
    const svf = skyViewFactor(reader(build(() => 500)), SIZE, SIZE, CELL);
    for (const v of svf) expect(v).toBeCloseTo(1, 6);
  });
});

// ---------------------------------------------------------------------------
// castShadows
// ---------------------------------------------------------------------------

describe('castShadows with a no-data halo (R30)', () => {
  // 20° above the horizon in the south — the low-sun geometry that decides
  // where the first hour of light actually lands.
  const SUN = { altitude: 20, azimuth: 180 };

  it('shades a cell behind a wall the halo carries', () => {
    const wall = setHalo(build(() => 500), 700);
    expect(castShadows(reader(wall), SIZE, SIZE, CELL, SUN, HALO)[SOUTH_EDGE]).toBe(
      SHADOW_SHADED,
    );
  });

  it('does NOT report full sun when the halo is NODATA', () => {
    // Old code: 1 (lit). The identical cell, with the identical unknown
    // surroundings, was reported as being in full sun.
    const blank = setHalo(build(() => 500), NODATA);
    const v = castShadows(reader(blank), SIZE, SIZE, CELL, SUN, HALO)[SOUTH_EDGE];
    expect(v).not.toBe(SHADOW_LIT);
    expect(v).toBe(SHADOW_UNKNOWN);
  });

  it('keeps a definite shade where a blocker was found, even past an earlier gap', () => {
    // Shading is monotone: once something taller than the sun's altitude is in
    // the way, what lies behind it is irrelevant. Ordered deliberately so the
    // gap comes FIRST — a hole at r=2, the blocker at r=5 — because the cheap
    // implementation (bail out on the first gap) would wrongly abstain here and
    // grey out ground that is definitively in shade.
    const g = setHalo(build(() => 500), NODATA);
    g.set(15, 22, NODATA);
    for (let x = 0; x < SIZE; x++) g.set(x, 25, 900);
    const v = castShadows(reader(g), SIZE, SIZE, CELL, SUN, HALO)[20 * SIZE + 15];
    expect(v).toBe(SHADOW_SHADED);
  });

  it('treats a cell with no elevation of its own as unknown, not shaded', () => {
    const g = build(() => 500);
    g.set(15, 15, NODATA);
    expect(castShadows(reader(g), SIZE, SIZE, CELL, SUN, HALO)[CENTRE]).toBe(
      SHADOW_UNKNOWN,
    );
  });

  it('still reports a known, total shade when the sun is below the horizon', () => {
    // "The sun is down" needs no DEM at all, so a no-data halo must not turn it
    // into a question.
    const blank = setHalo(build(() => 500), NODATA);
    const night = castShadows(reader(blank), SIZE, SIZE, CELL, { altitude: -6, azimuth: 90 });
    for (const v of night) expect(v).toBe(SHADOW_SHADED);
  });

  it('is unchanged on a fully populated halo', () => {
    const lit = castShadows(reader(build(() => 500)), SIZE, SIZE, CELL, SUN, HALO);
    for (const v of lit) expect(v).toBe(SHADOW_LIT);
  });

  it('names the default radius it marches, since requiredHalo does not know it', () => {
    // `castShadows` is not wired into `analyze()` (R27), so nothing sizes a halo
    // for it. Pinned here so whoever wires it cannot miss the accounting.
    expect(DEFAULT_SHADOW_RADIUS_CELLS).toBe(64);
    expect(requiredHalo({ layers: ['insolation'] })).toBeLessThan(
      DEFAULT_SHADOW_RADIUS_CELLS,
    );
  });
});

// ---------------------------------------------------------------------------
// The three must agree
// ---------------------------------------------------------------------------

describe('the three horizon operators agree about missing data (R30)', () => {
  it('all report unknown on the same cell of the same grid, and none reports open ground', () => {
    // One grid, one no-data halo, one cell. Three operators. An operator that
    // answered here while the others abstained would be its own defect — the
    // insolation layer would claim sun on ground the shelter layer had already
    // admitted it could not see.
    const g = setHalo(build(() => 500), NODATA);
    const heights = reader(g);

    const svf = skyViewFactor(heights, SIZE, SIZE, CELL)[NORTH_EDGE];
    const shelter = terrainShelter(heights, SIZE, SIZE, CELL, 0)[NORTH_EDGE];
    const shadow = castShadows(
      heights,
      SIZE,
      SIZE,
      CELL,
      { altitude: 20, azimuth: 0 },
      HALO,
    )[NORTH_EDGE];

    expect(Number.isNaN(svf), 'skyViewFactor').toBe(true);
    expect(Number.isNaN(shelter), 'terrainShelter').toBe(true);
    expect(shadow, 'castShadows').toBe(SHADOW_UNKNOWN);

    // And explicitly: not the open-ground answers the old code gave.
    expect(svf).not.toBe(1);
    expect(shelter).not.toBe(0);
    expect(shadow).not.toBe(SHADOW_LIT);
  });

  it('all three answer normally on the same grid with the halo populated', () => {
    const g = build(() => 500);
    const heights = reader(g);
    expect(skyViewFactor(heights, SIZE, SIZE, CELL)[NORTH_EDGE]).toBeCloseTo(1, 6);
    expect(terrainShelter(heights, SIZE, SIZE, CELL, 0)[NORTH_EDGE]).toBe(0);
    expect(
      castShadows(heights, SIZE, SIZE, CELL, { altitude: 20, azimuth: 0 }, HALO)[NORTH_EDGE],
    ).toBe(SHADOW_LIT);
  });
});

describe('scanHorizon', () => {
  it('does not let a gap hide behind a later pin', () => {
    // Gap first, blocker second: the blocker still decides, because missing
    // terrain can only raise a horizon and the answer is already at its ceiling.
    const heights = (x: number, y: number): number => {
      void x;
      if (y === -2) return NODATA;
      if (y === -4) return 600;
      return 500;
    };
    const scan = scanHorizon(heights, 0, 0, 0, -1, 500, CELL, 10, Math.tan(30 * RAD), emptyScan());
    expect(scan.incomplete).toBe(false);
    expect(scan.maxTan).toBeCloseTo(100 / 40, 6);
  });

  it('reports incomplete when the gap is never overruled', () => {
    const heights = (x: number, y: number): number => {
      void x;
      return y === -2 ? NODATA : 500;
    };
    const scan = scanHorizon(heights, 0, 0, 0, -1, 500, CELL, 10, Math.tan(30 * RAD), emptyScan());
    expect(scan.incomplete).toBe(true);
    expect(scan.maxTan).toBe(0);
  });

  it('reuses the out-parameter rather than allocating per ray', () => {
    const out = emptyScan();
    expect(scanHorizon(() => 500, 0, 0, 1, 0, 500, CELL, 4, Infinity, out)).toBe(out);
  });
});

describe('scanHorizonRing agrees with scanHorizon', () => {
  /**
   * The ring march is a second copy of the same loop, kept only because routing
   * sky-view through the per-bearing version measured ~460 ms/tile against
   * ~300 ms. Two copies of a coverage rule is exactly the shape that produced
   * `R30`, so they are pinned against each other here rather than trusted.
   */
  it('produces identical horizons on a rough surface with holes', () => {
    // A deterministic pseudo-random surface: sinusoids at incommensurate
    // frequencies, so no bearing sees a degenerate special case, plus scattered
    // no-data cells so the gap paths are exercised too.
    const rough = (x: number, y: number): number =>
      500 + 40 * Math.sin(x * 0.31) * Math.cos(y * 0.17) + 12 * Math.sin(x * 0.07 + y * 0.11);
    const g = build(rough);
    for (let k = 0; k < 40; k++) {
      g.set(((k * 7) % SIZE) - HALO, ((k * 13) % SIZE) - HALO, NODATA);
    }
    const heights = reader(g);

    const directions = 16;
    const dirs: Array<[number, number]> = [];
    for (let k = 0; k < directions; k++) {
      const a = (k / directions) * Math.PI * 2;
      dirs.push([Math.cos(a), Math.sin(a)]);
    }

    const ring = emptyRingScan(directions);
    const single = emptyScan();
    let checkedComplete = 0;
    let checkedIncomplete = 0;

    for (let y = 0; y < SIZE; y += 3) {
      for (let x = 0; x < SIZE; x += 3) {
        const z0 = heights(x, y);
        if (!isElevation(z0)) continue;
        scanHorizonRing(heights, x, y, dirs, z0, CELL, DEFAULT_SKY_VIEW_RADIUS_CELLS, ring);

        // The per-bearing march with no ceiling is the reference.
        let anyGap = false;
        const reference: number[] = [];
        for (const [dx, dy] of dirs) {
          scanHorizon(heights, x, y, dx, dy, z0, CELL, DEFAULT_SKY_VIEW_RADIUS_CELLS, Infinity, single);
          if (single.incomplete) anyGap = true;
          reference.push(single.maxTan);
        }

        expect(ring.incomplete, `gap flag at ${x},${y}`).toBe(anyGap);
        if (anyGap) {
          checkedIncomplete++;
          continue;
        }
        checkedComplete++;
        for (let k = 0; k < directions; k++) {
          // Float32 round-trip through the ring's typed array, hence the epsilon.
          expect(ring.maxTan[k], `bearing ${k} at ${x},${y}`).toBeCloseTo(reference[k], 5);
        }
      }
    }
    // Both branches must actually have been exercised, or this proves nothing.
    expect(checkedComplete).toBeGreaterThan(10);
    expect(checkedIncomplete).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// Loud failure when the halo cannot cover the request
// ---------------------------------------------------------------------------

describe('analyze refuses an undersized halo (R30)', () => {
  it('throws rather than computing skyView on a halo that cannot supply it', () => {
    const grid = syntheticGrid(() => 500, { size: SIZE, halo: 4, cellSize: CELL });
    expect(() => analyze(grid, { layers: ['skyView'] })).toThrow(InsufficientHaloError);
  });

  it('reports what it needed and what it had, so a caller can act', () => {
    const grid = syntheticGrid(() => 500, { size: SIZE, halo: 4, cellSize: CELL });
    try {
      analyze(grid, { layers: ['skyView'] });
      expect.unreachable('analyze should have thrown');
    } catch (err) {
      expect(isInsufficientHaloError(err)).toBe(true);
      if (!isInsufficientHaloError(err)) return;
      expect(err.required).toBe(DEFAULT_SKY_VIEW_RADIUS_CELLS);
      expect(err.available).toBe(4);
      expect(err.layers).toContain('skyView');
      expect(err.code).toBe(INSUFFICIENT_HALO);
    }
  });

  it('is distinguishable from a genuine fault, so the app greys out instead of erroring', () => {
    // The whole point of a typed error here: "this needs a wider fetch" is a
    // normal, recoverable state and must not be shown to a hunter as a crash.
    expect(isInsufficientHaloError(new Error('DEM source returned 500'))).toBe(false);
    expect(isInsufficientHaloError(undefined)).toBe(false);
    expect(isInsufficientHaloError({ code: INSUFFICIENT_HALO })).toBe(true);
  });

  it('carries the code in the message, for callers that forward only a string', () => {
    // The web worker's error path posts `err.message` across `postMessage`,
    // where the class identity does not survive.
    const err = new InsufficientHaloError({ required: 273, available: 256 });
    expect(err.message).toContain(INSUFFICIENT_HALO);
    expect(err.message).toContain('273');
    expect(err.message).toContain('256');
  });

  it('accepts a halo exactly equal to the requirement', () => {
    // Off-by-one here would break every correctly-sized caller.
    const request = { layers: ['shelter'] as const, windFromDeg: 0 };
    const halo = requiredHalo({ ...request, layers: [...request.layers] });
    expect(halo).toBe(DEFAULT_SHELTER_RADIUS_CELLS);
    const grid = syntheticGrid(plane(0, grade(15)), { size: SIZE, halo, cellSize: CELL });
    const r = analyze(grid, { layers: ['shelter'], windFromDeg: 0 });
    // And with an exactly-sized halo the march never runs off the end, so no
    // cell is unknown — the halo requirement and the march radius agree.
    for (const v of r.shelter!) expect(Number.isNaN(v)).toBe(false);
  });
});

describe('assembleGrid refuses a halo a 3x3 fetch cannot supply (R30)', () => {
  const TS = 16;
  const tile = { z: 14, x: 100, y: 200 };

  it('throws when the halo exceeds one tile', () => {
    // The z≥16 / 500 m case in miniature: 273 cells of halo asked of a fetch
    // that can supply 256. `R23` raises the shelter radius to exactly there.
    expect(() =>
      assembleGrid(tile, new Float32Array(TS * TS), new Map(), TS, TS + 1),
    ).toThrow(InsufficientHaloError);
  });

  it('allows a halo of exactly one tile, which the 8 neighbours do fill', () => {
    const grid = assembleGrid(tile, new Float32Array(TS * TS).fill(500), new Map(), TS, TS);
    expect(grid.halo).toBe(TS);
  });

  it('leaves missing neighbours as no-data rather than plausible elevation', () => {
    // Not edge replication — `HeightGrid.get` only clamps outside the padded
    // buffer. This is the pattern a 404 or an offline pan past the edge of a
    // downloaded region produces, and it is what the operators above detect.
    const grid = assembleGrid(tile, new Float32Array(TS * TS).fill(500), new Map(), TS, 4);
    expect(grid.hasData(0, 0)).toBe(true);
    expect(grid.hasData(-2, -2)).toBe(false);
    expect(isElevation(grid.get(-2, -2))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The flagship layer must not swallow the unknown
// ---------------------------------------------------------------------------

describe('beddingLikelihood does not fold unknown shelter into "unsheltered" (R30)', () => {
  it('returns NaN where shelter is unknown, not the 0.25 floor', () => {
    // Every term of the bedding product is a requirement, so one unknown factor
    // makes the cell unknown. Folding NaN onto the floor would hand back a
    // confident *low* score for ground the engine cannot see — which reads on
    // the map as "checked, and it is not bedding".
    const grid = setHalo(build(plane(0, grade(15))), NODATA);
    const r = analyze(grid, { layers: ['bedding', 'shelter'], windFromDeg: 0 });
    expect(Number.isNaN(r.shelter![NORTH_EDGE])).toBe(true);
    expect(Number.isNaN(r.bedding![NORTH_EDGE])).toBe(true);
    // And ground whose whole 20-cell upwind ray stays on real data still
    // carries a real score — the layer must degrade at the coverage edge, not
    // collapse across the tile. Row 25 is the first row far enough from the
    // north edge for the march never to reach the halo.
    const inland = 25 * SIZE + 15;
    expect(Number.isNaN(r.bedding![inland])).toBe(false);
    expect(r.bedding![inland]).toBeGreaterThan(0);
  });
});
