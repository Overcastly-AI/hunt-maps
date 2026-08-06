import { describe, expect, it } from 'vitest';
import { analyze, requiredHalo, type AnalysisRequest } from './pipeline.js';
import { syntheticGrid, plane, hillsideWithBench } from './testing/synthetic.js';
import { requiredMetrics } from './filters/terrainFilter.js';

const SIZE = 33;

describe('analyze', () => {
  it('computes only the requested layers', () => {
    const grid = syntheticGrid(plane(0.3, 0.1), { size: SIZE, halo: 24 });
    const r = analyze(grid, { layers: ['slope'] });

    expect(r.slope).toBeDefined();
    // Not asked for, so not computed — this is what keeps a filter slider at 60fps.
    expect(r.aspect).toBeUndefined();
    expect(r.weiss).toBeUndefined();
    expect(r.skyView).toBeUndefined();
    expect(r.bedding).toBeUndefined();
  });

  it('computes shared dependencies once and reuses them', () => {
    const grid = syntheticGrid(plane(0.3, 0.1), { size: SIZE, halo: 24 });
    const r = analyze(grid, { layers: ['slope', 'aspect', 'hillshade'] });
    // slope/aspect are views onto the single surface computation.
    expect(r.slope).toBe(r.surface.slope);
    expect(r.aspect).toBe(r.surface.aspect);
    expect(r.hillshade).toBeDefined();
  });

  it('produces every field a request asks for', () => {
    const grid = syntheticGrid(hillsideWithBench(0.6, -40, 40), {
      size: SIZE,
      halo: 26,
      cellSize: 10,
    });
    const request: AnalysisRequest = {
      layers: [
        'elevation',
        'slope',
        'aspect',
        'curvatureProfile',
        'curvaturePlan',
        'tpiSmall',
        'tpiLarge',
        'ruggedness',
        'weiss',
        'wood',
        'bench',
        'insolation',
        'windExposure',
        'shelter',
        'bedding',
        'hillshade',
      ],
      windFromDeg: 315,
      date: new Date('2026-11-15T17:00:00Z'),
      latitude: 39.7,
      longitude: -84.2,
    };
    const r = analyze(grid, request);

    for (const key of [
      'elevation',
      'slope',
      'aspect',
      'curvatureProfile',
      'curvaturePlan',
      'tpiSmall',
      'tpiLarge',
      'ruggedness',
      'weiss',
      'wood',
      'bench',
      'insolation',
      'windExposure',
      'shelter',
      'bedding',
      'hillshade',
    ] as const) {
      expect(r[key], key).toBeDefined();
      expect(r[key]!.length, key).toBe(SIZE * SIZE);
    }
  });

  it('skips wind-dependent layers when no wind direction is supplied', () => {
    const grid = syntheticGrid(plane(0.3, 0.1), { size: SIZE, halo: 24 });
    const r = analyze(grid, { layers: ['windExposure', 'bedding', 'shelter'] });
    expect(r.windExposure).toBeUndefined();
    expect(r.bedding).toBeUndefined();
    expect(r.shelter).toBeUndefined();
  });

  it('exposes the sun position used for the insolation layer', () => {
    const grid = syntheticGrid(plane(0, 0.4), { size: SIZE, halo: 4 });
    const r = analyze(grid, {
      layers: ['insolation'],
      date: new Date('2026-11-15T17:30:00Z'),
      latitude: 40,
      longitude: -84,
    });
    expect(r.sun).toBeDefined();
    expect(r.sun!.altitude).toBeGreaterThan(0);
  });
});

describe('requiredHalo', () => {
  it('is 1 for plain 3x3 kernels', () => {
    expect(requiredHalo({ layers: ['slope', 'aspect', 'hillshade'] })).toBe(1);
  });

  it('grows to cover the large TPI radius', () => {
    expect(requiredHalo({ layers: ['tpiLarge'], tpiLargeRadius: 40 })).toBe(40);
  });

  it('grows to cover Weiss, which needs both TPI scales', () => {
    expect(requiredHalo({ layers: ['weiss'], weiss: { largeRadius: 32 } })).toBe(32);
  });

  it('covers the ray-marched layers', () => {
    expect(requiredHalo({ layers: ['skyView'] })).toBeGreaterThanOrEqual(24);
    expect(requiredHalo({ layers: ['bedding'] })).toBeGreaterThanOrEqual(20);
  });

  it('takes the maximum across all requested layers', () => {
    const halo = requiredHalo({
      layers: ['slope', 'bench', 'tpiLarge'],
      tpiLargeRadius: 30,
      bench: { ringRadius: 12 },
    });
    expect(halo).toBe(30);
  });
});

describe('pipeline + filter integration', () => {
  it('a filter’s required metrics can be fed straight into analyze()', () => {
    // This is the actual runtime contract: the client derives the layer set
    // from the enabled saved filters rather than computing everything.
    const predicate = {
      kind: 'all' as const,
      operands: [
        { kind: 'range' as const, metric: 'slope' as const, min: 8, max: 20 },
        { kind: 'bench' as const, isBench: true },
      ],
    };
    const layers = [...requiredMetrics(predicate)] as AnalysisRequest['layers'];
    const grid = syntheticGrid(hillsideWithBench(0.6, -40, 40), {
      size: SIZE,
      halo: 12,
      cellSize: 10,
    });
    const r = analyze(grid, { layers });

    expect(r.slope).toBeDefined();
    expect(r.bench).toBeDefined();
    expect(r.weiss).toBeUndefined();
  });
});
