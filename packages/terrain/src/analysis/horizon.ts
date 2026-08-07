/**
 * Horizon ray-marching, and the data-coverage rule the horizon operators share.
 *
 * ## The defect this file exists to prevent (BACKLOG `R30`)
 *
 * `skyViewFactor`, `terrainShelter` and `castShadows` all answer one geometric
 * question — *how high does the terrain rise along this bearing?* — and all
 * three used to end the ray with `if (!Number.isFinite(z)) continue;`. The
 * engine's no-data sentinel is `NODATA = -32768`, which **is finite**, so an
 * unwritten halo cell read as terrain 33 km below the viewer: the most "open"
 * value the encoding can express. Each operator then reported its open-ground
 * answer — full sky, zero shelter, full sun — with nothing to say its inputs had
 * run out. It never threw and no test failed. It produced a plausible, wrong
 * map, and a hunter sits a shaded bench believing it catches first light.
 *
 * ## The rule, stated once because three operators disagreeing is its own bug
 *
 * > **A ray that reads a cell with no elevation makes that cell's answer
 * > unknown — unless the answer was already pinned by data the ray did read.**
 *
 * The "already pinned" clause is what keeps the rule from being uselessly
 * conservative, and it is sound rather than convenient: missing terrain can only
 * ever *raise* a horizon, never lower it, so an answer that is already at its
 * ceiling cannot move.
 *
 *  - `terrainShelter` saturates at a 30° upwind horizon. Once the visible
 *    terrain reaches that, whatever hides in the gap is irrelevant: still 1.
 *  - `castShadows` is monotone in the same way. Once a blocker taller than the
 *    sun's altitude is found, the cell is shaded whatever lies behind it.
 *  - `skyViewFactor` has no ceiling — every extra metre of horizon lowers it —
 *    so any gap in any of its 16 bearings makes the cell unknown.
 *
 * Unknown is reported as `NaN` (and as `SHADOW_UNKNOWN` in the byte-valued
 * shadow mask, which has no NaN). `sampleRamp` paints a non-finite value fully
 * transparent, so the map greys out over ground the engine cannot see instead
 * of asserting that it is open.
 *
 * Units: `maxTan` is a tangent (rise over run), dimensionless and ≥ 0 — it is
 * clamped at 0 because terrain falling away below the viewer obstructs nothing.
 */

import { isElevation } from '../dem/encoding.js';

/**
 * Module-local alias, and **not** a redundant one — do not inline it back.
 *
 * The package compiles to CommonJS, where a cross-module call emits as a
 * property load on the imported module object. V8 will not inline that, and this
 * predicate runs 25 million times per 256² sky-view tile: measured on this
 * machine, calling it through the import costs **880 ms/tile against 347 ms**
 * through a module-local binding. Performance is a correctness constraint here —
 * these operators run per tile inside a render loop on a phone.
 */
const isElev = isElevation;

export interface HorizonScan {
  /**
   * Greatest `tan(elevation angle)` of terrain along the ray, ≥ 0. Zero means
   * nothing along the ray rose above the starting cell.
   */
  maxTan: number;
  /**
   * True when the ray read at least one cell with no elevation *and* never
   * reached `pinnedAboveTan`. When this is set the caller must report unknown,
   * not a number.
   */
  incomplete: boolean;
}

/**
 * March one bearing and return the highest horizon it found.
 *
 * `stepX`/`stepY` are a unit vector in grid space (x east, y **south**, matching
 * row order). `z0` is the elevation of the starting cell, already validated by
 * the caller. `pinnedAboveTan` is the tangent above which the caller's answer
 * can no longer change — pass `Infinity` when there is no such ceiling.
 *
 * `out` is an in/out parameter rather than a fresh object on purpose: sky-view
 * runs 16 bearings per cell over a 256² tile, so returning an object here would
 * allocate a million short-lived objects per tile inside a render loop. Same
 * reasoning as `ringSlopeStats`.
 */
export function scanHorizon(
  heightAt: (x: number, y: number) => number,
  x: number,
  y: number,
  stepX: number,
  stepY: number,
  z0: number,
  cellSize: number,
  maxRadiusCells: number,
  pinnedAboveTan: number,
  out: HorizonScan,
): HorizonScan {
  let maxTan = 0;
  let sawGap = false;

  for (let r = 1; r <= maxRadiusCells; r++) {
    const zr = heightAt(Math.round(x + stepX * r), Math.round(y + stepY * r));
    if (!isElev(zr)) {
      // Do not stop here. A later sample may still pin the answer, and rescuing
      // those cells is the difference between "the layer greys out past a
      // coverage edge" and "the layer greys out for the whole tile".
      sawGap = true;
      continue;
    }
    const tan = (zr - z0) / (r * cellSize);
    if (tan > maxTan) {
      maxTan = tan;
      if (maxTan > pinnedAboveTan) {
        // Pinned: nothing hiding in the gaps can change the caller's answer, so
        // the cell is genuinely known and the march is finished.
        out.maxTan = maxTan;
        out.incomplete = false;
        return out;
      }
    }
  }

  out.maxTan = maxTan;
  out.incomplete = sawGap;
  return out;
}

/** A reusable scratch scan, for callers that want one per loop. */
export function emptyScan(): HorizonScan {
  return { maxTan: 0, incomplete: false };
}

export interface HorizonRingScan {
  /**
   * `tan(horizon angle)` per bearing, in the order the bearings were given.
   * Only meaningful when `incomplete` is false.
   */
  maxTan: Float32Array;
  /** True when *any* bearing read a cell with no elevation. */
  incomplete: boolean;
}

/**
 * March every bearing of a ring from one cell.
 *
 * There is no `pinnedAboveTan` here, deliberately: a ring is consumed by
 * operators that aggregate over all bearings (sky-view today, viewshed and
 * Winstral `Sx` if they land), and those have no ceiling at which an answer
 * stops moving. Any gap on any bearing makes the whole ring unusable, so this
 * abandons the march at the first one.
 *
 * ## Why this exists rather than a loop of `scanHorizon`
 *
 * Purely measured performance, and it is worth stating because the duplication
 * below is otherwise indefensible. Sky-view calls a per-bearing scan a million
 * times per 256² tile, and V8 will not inline a ten-argument function that
 * itself calls a callback: routing sky-view through `scanHorizon` measured
 * **~460 ms/tile against ~330 ms** for the same work with the march inline.
 * Hoisting the bearing loop in here makes it 65k calls instead, and the march
 * runs inside one function the optimiser can treat as a unit.
 *
 * The march is therefore written twice **in this one file, adjacent**, rather
 * than once here and once in each of three operator modules — which is the shape
 * that produced `R30` in the first place. `halo.test.ts` pins the two against
 * each other over a randomised surface so they cannot drift.
 */
export function scanHorizonRing(
  heightAt: (x: number, y: number) => number,
  x: number,
  y: number,
  dirs: ReadonlyArray<readonly [number, number]>,
  z0: number,
  cellSize: number,
  maxRadiusCells: number,
  out: HorizonRingScan,
): HorizonRingScan {
  for (let k = 0; k < dirs.length; k++) {
    const stepX = dirs[k][0];
    const stepY = dirs[k][1];
    let maxTan = 0;
    for (let r = 1; r <= maxRadiusCells; r++) {
      const zr = heightAt(Math.round(x + stepX * r), Math.round(y + stepY * r));
      if (!isElev(zr)) {
        out.incomplete = true;
        return out;
      }
      const tan = (zr - z0) / (r * cellSize);
      if (tan > maxTan) maxTan = tan;
    }
    out.maxTan[k] = maxTan;
  }
  out.incomplete = false;
  return out;
}

/** A reusable scratch ring scan sized for `directions` bearings. */
export function emptyRingScan(directions: number): HorizonRingScan {
  return { maxTan: new Float32Array(directions), incomplete: false };
}
