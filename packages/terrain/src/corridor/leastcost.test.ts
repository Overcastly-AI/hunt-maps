import { describe, expect, it } from 'vitest';
import { accumulateCost, computeCorridor, findPinchPoints, leastCostPath } from './leastcost.js';
import { buildCostSurface, resistanceFromNlcd, toblerSpeed } from './cost.js';
import { computeSurface } from '../analysis/surface.js';
import { plane, syntheticGrid } from '../testing/synthetic.js';

/** Flat terrain of a given size, with optional per-cell resistance. */
function flatCost(size: number, resistance?: Float32Array) {
  const grid = syntheticGrid(() => 500, { size, halo: 2, cellSize: 10 });
  const surface = computeSurface(grid);
  return buildCostSurface(surface, 10, { resistance });
}

describe('toblerSpeed', () => {
  it('peaks on a slight downhill, not on the flat', () => {
    expect(toblerSpeed(-0.05)).toBeGreaterThan(toblerSpeed(0));
  });

  it('penalises uphill more than the equivalent gentle downhill', () => {
    expect(toblerSpeed(0.3)).toBeLessThan(toblerSpeed(-0.05));
  });

  it('falls off steeply on hard grades', () => {
    expect(toblerSpeed(0.8)).toBeLessThan(toblerSpeed(0.2) / 2);
  });
});

describe('accumulateCost', () => {
  it('grows monotonically with distance from the source on flat ground', () => {
    const cost = flatCost(21);
    const { cost: dist } = accumulateCost(cost, [0]);
    const at = (x: number, y: number) => dist[y * 21 + x];
    expect(at(0, 0)).toBe(0);
    expect(at(5, 0)).toBeGreaterThan(at(2, 0));
    expect(at(20, 20)).toBeGreaterThan(at(5, 5));
  });

  it('routes around an impassable barrier', () => {
    const size = 21;
    const resistance = new Float32Array(size * size).fill(1);
    // A wall across every row except the bottom two, at x = 10.
    for (let y = 0; y < size - 2; y++) resistance[y * size + 10] = Infinity;

    const cost = flatCost(size, resistance);
    const { cost: dist } = accumulateCost(cost, [0]);
    const target = 0 * size + 20; // top-right, directly across the wall

    // Reachable, but only the long way round the wall's bottom end.
    expect(Number.isFinite(dist[target])).toBe(true);
    const straightLine = dist[0 * size + 9];
    expect(dist[target]).toBeGreaterThan(straightLine * 2);
  });

  it('leaves fully walled-off cells unreachable', () => {
    const size = 11;
    const resistance = new Float32Array(size * size).fill(1);
    for (let y = 0; y < size; y++) resistance[y * size + 5] = Infinity;
    const cost = flatCost(size, resistance);
    const { cost: dist } = accumulateCost(cost, [0]);
    expect(Number.isFinite(dist[0 * size + 9])).toBe(false);
  });

  it('is direction-aware: climbing a hill costs more than descending it', () => {
    const size = 21;
    // Ground rising steeply to the east.
    const grid = syntheticGrid(plane(0.4, 0), { size, halo: 2, cellSize: 10 });
    const surface = computeSurface(grid);
    const cost = buildCostSurface(surface, 10);

    const west = 10 * size + 0;
    const east = 10 * size + 20;
    const uphill = leastCostPath(cost, west, east).totalCost;
    const downhill = leastCostPath(cost, east, west).totalCost;

    expect(uphill).toBeGreaterThan(downhill);
  });
});

describe('leastCostPath', () => {
  it('connects start to goal as a contiguous chain of adjacent cells', () => {
    const size = 15;
    const cost = flatCost(size);
    const path = leastCostPath(cost, 0, size * size - 1);

    expect(path.indices[0]).toBe(0);
    expect(path.indices[path.indices.length - 1]).toBe(size * size - 1);
    expect(Number.isFinite(path.totalCost)).toBe(true);

    for (let i = 1; i < path.indices.length; i++) {
      const a = path.indices[i - 1];
      const b = path.indices[i];
      const dx = Math.abs((a % size) - (b % size));
      const dy = Math.abs(((a / size) | 0) - ((b / size) | 0));
      expect(Math.max(dx, dy)).toBe(1);
    }
  });

  it('takes the diagonal on open flat ground', () => {
    const size = 15;
    const cost = flatCost(size);
    const path = leastCostPath(cost, 0, size * size - 1);
    expect(path.indices.length).toBe(size);
  });

  it('reports Infinity when the goal is unreachable', () => {
    const size = 11;
    const resistance = new Float32Array(size * size).fill(1);
    for (let y = 0; y < size; y++) resistance[y * size + 5] = Infinity;
    const cost = flatCost(size, resistance);
    expect(leastCostPath(cost, 0, size * size - 1).totalCost).toBe(Infinity);
  });
});

describe('computeCorridor', () => {
  it('scores ~0 excess along the optimal route and more off it', () => {
    const size = 21;
    const cost = flatCost(size);
    const a = 10 * size + 0;
    const b = 10 * size + 20;
    const corridor = computeCorridor(cost, [a], [b], { toleranceFraction: 0.15 });

    expect(Number.isFinite(corridor.optimalCost)).toBe(true);
    // A cell on the straight line between them is on the optimal route.
    expect(corridor.excess[10 * size + 10]).toBeCloseTo(0, 6);
    // A cell far off the line requires a detour.
    expect(corridor.excess[0 * size + 10]).toBeGreaterThan(0);
  });

  it('produces a mask that includes the endpoints and excludes far detours', () => {
    const size = 21;
    const cost = flatCost(size);
    const a = 10 * size + 0;
    const b = 10 * size + 20;
    const corridor = computeCorridor(cost, [a], [b], { toleranceFraction: 0.1 });

    expect(corridor.mask[a]).toBe(1);
    expect(corridor.mask[b]).toBe(1);
    expect(corridor.mask[0]).toBe(0);
    expect(corridor.strength[10 * size + 10]).toBeCloseTo(1, 3);
  });

  it('widens the corridor as tolerance increases', () => {
    const size = 21;
    const cost = flatCost(size);
    const a = 10 * size + 0;
    const b = 10 * size + 20;
    const tight = computeCorridor(cost, [a], [b], { toleranceFraction: 0.02 });
    const loose = computeCorridor(cost, [a], [b], { toleranceFraction: 0.4 });

    const count = (m: Uint8Array) => m.reduce((s, v) => s + v, 0);
    expect(count(loose.mask)).toBeGreaterThan(count(tight.mask));
  });

  it('funnels through a gap in a barrier — the pinch-point case', () => {
    const size = 21;
    const resistance = new Float32Array(size * size).fill(1);
    // Wall at x = 10 with a single 3-cell gap at rows 9–11.
    for (let y = 0; y < size; y++) {
      if (y >= 9 && y <= 11) continue;
      resistance[y * size + 10] = Infinity;
    }
    const cost = flatCost(size, resistance);
    const a = 10 * size + 0;
    const b = 10 * size + 20;
    const corridor = computeCorridor(cost, [a], [b], { toleranceFraction: 0.25 });

    // Everything routes through the gap, so the gap is in the corridor...
    expect(corridor.mask[10 * size + 10]).toBe(1);
    // ...and the pinch score there is high.
    const pinch = findPinchPoints(corridor, size, size, 10);
    expect(pinch[10 * size + 10]).toBeGreaterThan(0.3);
  });

  it('returns an empty corridor when the two areas are disconnected', () => {
    const size = 11;
    const resistance = new Float32Array(size * size).fill(1);
    for (let y = 0; y < size; y++) resistance[y * size + 5] = Infinity;
    const cost = flatCost(size, resistance);
    const corridor = computeCorridor(cost, [0], [size * size - 1]);
    expect(corridor.optimalCost).toBe(Infinity);
    expect(corridor.mask.reduce((s, v) => s + v, 0)).toBe(0);
  });
});

describe('resistanceFromNlcd', () => {
  it('makes open water impassable and prefers woody wetlands over row crops', () => {
    const r = resistanceFromNlcd(Uint8Array.from([11, 90, 82, 41]));
    expect(r[0]).toBe(Infinity);
    expect(r[1]).toBeLessThan(r[2]);
    expect(r[1]).toBeLessThan(r[3]);
  });

  it('falls back to a neutral cost for unknown classes', () => {
    expect(resistanceFromNlcd(Uint8Array.from([200]))[0]).toBe(1.5);
  });
});
