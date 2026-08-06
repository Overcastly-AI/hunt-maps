/**
 * Least-cost paths and movement corridors.
 *
 * ## Path vs corridor — and why the corridor is the product
 *
 * A least-cost **path** is a single line: the cheapest route from A to B. It is
 * seductive and mostly useless for hunting, because no deer walks a
 * mathematically optimal polyline. What a hunter needs is the **corridor**: the
 * band of terrain that is *nearly* optimal, because that is where the trails
 * actually are and where a stand covers real traffic rather than one imaginary
 * line.
 *
 * The corridor is computed the standard connectivity-modelling way:
 *
 *   corridor(cell) = accumCost(A → cell) + accumCost(cell → B) − lcpCost(A → B)
 *
 * A cell on the optimal path scores 0. A cell you would have to detour 200
 * cost-units through scores 200. Thresholding that field at, say, 15% above
 * optimal gives a band — the "channel" animals work through. This is exactly
 * Linkage Mapper's cost-weighted-distance corridor, applied at property scale
 * instead of continental scale.
 *
 * ## Implementation notes
 *
 * Dijkstra with a binary heap over 8-connectivity. The cost function is
 * anisotropic (see `cost.ts`), which means `accumCost(A → cell)` and
 * `accumCost(cell → A)` genuinely differ — climbing out of a creek bottom costs
 * more than dropping into it. We therefore run the reverse accumulation with the
 * step direction flipped rather than reusing the forward field, which a lot of
 * naive implementations get wrong and which would bias every corridor downhill.
 */

import { type CostSurface, stepCost } from './cost.js';

/** Minimal binary min-heap keyed by cost. */
class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  private size = 0;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
  }

  get length(): number {
    return this.size;
  }

  push(key: number, val: number): void {
    if (this.size === this.keys.length) this.grow();
    let i = this.size++;
    this.keys[i] = key;
    this.vals[i] = val;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(p, i);
      i = p;
    }
  }

  pop(): { key: number; val: number } {
    const key = this.keys[0];
    const val = this.vals[0];
    this.size--;
    if (this.size > 0) {
      this.keys[0] = this.keys[this.size];
      this.vals[0] = this.vals[this.size];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.size && this.keys[l] < this.keys[m]) m = l;
        if (r < this.size && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(m, i);
        i = m;
      }
    }
    return { key, val };
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = k;
    const v = this.vals[a];
    this.vals[a] = this.vals[b];
    this.vals[b] = v;
  }

  private grow(): void {
    const k = new Float64Array(this.keys.length * 2);
    k.set(this.keys);
    this.keys = k;
    const v = new Int32Array(this.vals.length * 2);
    v.set(this.vals);
    this.vals = v;
  }
}

const NEIGHBOURS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export interface AccumulationResult {
  /** Accumulated cost to each cell; Infinity where unreachable. */
  cost: Float64Array;
  /** Predecessor index for path reconstruction; -1 at sources/unreached. */
  from: Int32Array;
}

/**
 * Dijkstra accumulation from one or more source cells.
 *
 * `reverse: true` accumulates the cost of travelling *from* each cell *to* the
 * sources, by evaluating every step in the opposite direction. Required for the
 * corridor formula to be correct under an anisotropic cost model.
 */
export function accumulateCost(
  cost: CostSurface,
  sources: number[],
  reverse = false,
): AccumulationResult {
  const { width, height } = cost;
  const n = width * height;
  const dist = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new MinHeap(Math.max(64, n >> 3));

  for (const s of sources) {
    if (s < 0 || s >= n) continue;
    dist[s] = 0;
    heap.push(0, s);
  }

  while (heap.length > 0) {
    const { key, val: i } = heap.pop();
    if (done[i]) continue;
    if (key > dist[i]) continue;
    done[i] = 1;

    const x = i % width;
    const y = (i / width) | 0;

    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (done[j]) continue;

      // Forward: cost of moving i → j. Reverse: cost of moving j → i, because
      // we are accumulating "cost to reach a source from here".
      const w = reverse ? stepCost(cost, nx, ny, x, y) : stepCost(cost, x, y, nx, ny);
      if (!Number.isFinite(w)) continue;

      const nd = dist[i] + w;
      if (nd < dist[j]) {
        dist[j] = nd;
        from[j] = i;
        heap.push(nd, j);
      }
    }
  }

  return { cost: dist, from };
}

export interface LeastCostPath {
  /** Cell indices from start to goal inclusive. Empty if unreachable. */
  indices: number[];
  /** Total accumulated cost. Infinity if unreachable. */
  totalCost: number;
}

export function leastCostPath(cost: CostSurface, start: number, goal: number): LeastCostPath {
  const { cost: dist, from } = accumulateCost(cost, [start]);
  if (!Number.isFinite(dist[goal])) return { indices: [], totalCost: Infinity };

  const indices: number[] = [];
  let cur = goal;
  const guard = cost.width * cost.height + 1;
  let steps = 0;
  while (cur !== -1 && steps++ < guard) {
    indices.push(cur);
    if (cur === start) break;
    cur = from[cur];
  }
  indices.reverse();
  return { indices, totalCost: dist[goal] };
}

export interface CorridorOptions {
  /**
   * Corridor width as a fraction above the optimal cost. 0.15 means "include
   * every cell you can route through for no more than 15% above the least-cost
   * route". Wider thresholds catch secondary trails; tighter ones isolate the
   * primary runway.
   */
  toleranceFraction?: number;
  /** Absolute cost slack, added to the fractional tolerance. */
  toleranceAbsolute?: number;
}

export interface CorridorResult {
  /** Per-cell excess cost over optimal. 0 on the least-cost path. */
  excess: Float64Array;
  /** 1 where the cell is inside the corridor. */
  mask: Uint8Array;
  /** Cost of the optimal route between the endpoints. */
  optimalCost: number;
  /** Normalised 0..1 corridor strength (1 = on the optimal line). */
  strength: Float32Array;
}

/**
 * Cost-weighted-distance corridor between two cell sets.
 *
 * `sourcesA` / `sourcesB` are cell index arrays — typically a bedding polygon
 * and a food-source polygon, not single points, because deer move between
 * *areas*. Multi-cell sources fall straight out of the Dijkstra formulation at
 * no extra cost.
 */
export function computeCorridor(
  cost: CostSurface,
  sourcesA: number[],
  sourcesB: number[],
  options: CorridorOptions = {},
): CorridorResult {
  const tolFrac = options.toleranceFraction ?? 0.15;
  const tolAbs = options.toleranceAbsolute ?? 0;

  const fromA = accumulateCost(cost, sourcesA, false);
  // Cost from each cell onward to B = reverse accumulation seeded at B.
  const toB = accumulateCost(cost, sourcesB, true);

  const n = cost.width * cost.height;
  const excess = new Float64Array(n).fill(Infinity);

  let optimal = Infinity;
  for (const b of sourcesB) {
    if (b >= 0 && b < n && fromA.cost[b] < optimal) optimal = fromA.cost[b];
  }

  const mask = new Uint8Array(n);
  const strength = new Float32Array(n);

  if (!Number.isFinite(optimal)) {
    return { excess, mask, optimalCost: Infinity, strength };
  }

  const limit = optimal * (1 + tolFrac) + tolAbs;
  const band = Math.max(1e-9, limit - optimal);

  for (let i = 0; i < n; i++) {
    const a = fromA.cost[i];
    const b = toB.cost[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const total = a + b;
    const e = total - optimal;
    excess[i] = e;
    if (total <= limit) {
      mask[i] = 1;
      strength[i] = 1 - e / band;
    }
  }

  return { excess, mask, optimalCost: optimal, strength };
}

/**
 * Pinch-point detection within a corridor.
 *
 * A pinch point is where the corridor narrows — every route between the two
 * areas has to squeeze through, so a stand there covers essentially all the
 * traffic. This is *the* stand-placement output, and it is the reason the
 * corridor is worth computing rather than just the path.
 *
 * Measured as local corridor width: for each corridor cell, the width of the
 * corridor along the direction perpendicular to the local flow. Narrow = pinch.
 */
export function findPinchPoints(
  corridor: CorridorResult,
  width: number,
  height: number,
  searchRadius = 24,
): Float32Array {
  const { mask } = corridor;
  const out = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;

      // Minimum corridor chord through this cell over 8 orientations. The
      // minimum (not the mean) is what defines a pinch — one tight axis is
      // enough to funnel movement.
      let minWidth = Infinity;
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI;
        const dx = Math.cos(ang);
        const dy = Math.sin(ang);
        let span = 1;
        for (const sign of [1, -1]) {
          for (let r = 1; r <= searchRadius; r++) {
            const nx = Math.round(x + dx * r * sign);
            const ny = Math.round(y + dy * r * sign);
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) break;
            if (!mask[ny * width + nx]) break;
            span++;
          }
        }
        if (span < minWidth) minWidth = span;
      }

      // Invert to a 0..1 score; a 4-cell-wide neck scores high.
      out[i] = Math.max(0, 1 - minWidth / (searchRadius * 0.75));
    }
  }
  return out;
}

/**
 * Trace corridor centrelines as polylines suitable for GeoJSON export.
 *
 * Skeletonises the corridor mask by repeatedly walking downhill on the excess
 * field from the highest-strength seeds, which yields the trail-like lines
 * hunters expect to see rather than an amorphous blob.
 */
export function traceCorridorLines(
  corridor: CorridorResult,
  width: number,
  height: number,
  maxLines = 6,
): number[][] {
  const { strength, mask } = corridor;
  const used = new Uint8Array(strength.length);
  const lines: number[][] = [];

  const seeds = Array.from(strength.keys())
    .filter((i) => mask[i])
    .sort((a, b) => strength[b] - strength[a])
    .slice(0, maxLines * 400);

  for (const seed of seeds) {
    if (lines.length >= maxLines) break;
    if (used[seed]) continue;

    // Walk out from the seed in both directions: once toward stronger cells
    // (up the corridor spine) and once toward weaker ones. `seen` is shared so
    // the two halves cannot double back over each other, and the seed is
    // claimed up-front so the second walk does not immediately terminate on it.
    const seen = new Set<number>([seed]);
    used[seed] = 1;
    const uphill = walk(seed, 1, seen);
    const downhill = walk(seed, -1, seen);

    const line: number[] = [];
    for (let k = uphill.length - 1; k >= 0; k--) line.push(uphill[k]);
    line.push(seed);
    for (const idx of downhill) line.push(idx);

    if (line.length >= 8) lines.push(line);
  }

  return lines;

  /** Greedy walk from `start`, stepping to the neighbour maximising `strength * dir`. */
  function walk(start: number, dir: 1 | -1, seen: Set<number>): number[] {
    const out: number[] = [];
    let cur = start;
    const maxSteps = width + height;
    for (let step = 0; step < maxSteps; step++) {
      const x = cur % width;
      const y = (cur / width) | 0;
      let best = -1;
      let bestVal = -Infinity;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (!mask[j] || seen.has(j)) continue;
        const v = strength[j] * dir;
        if (v > bestVal) {
          bestVal = v;
          best = j;
        }
      }
      if (best === -1) break;
      seen.add(best);
      used[best] = 1;
      out.push(best);
      cur = best;
    }
    return out;
  }
}
