import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { MapLayerKind } from '@hunt-maps/shared';
import { OfflineService } from './offline.module';

/** The estimator touches no injected dependency, so nulls are safe here. */
const service = new OfflineService(null as never, null as never, null as never);

// A ~11 x 11 km box in southern Ohio — a realistic hunting-lease footprint.
const BBOX = { west: -84.25, south: 39.6, east: -84.15, north: 39.7 };

describe('OfflineService.estimate', () => {
  it('grows roughly 4x per additional zoom level', () => {
    const to14 = service.estimate(BBOX, 10, 14, [MapLayerKind.Slope]);
    const to15 = service.estimate(BBOX, 10, 15, [MapLayerKind.Slope]);
    const added = to15.tileCount - to14.tileCount;
    const previousLevel = to14.tileCount - service.estimate(BBOX, 10, 13, [MapLayerKind.Slope]).tileCount;
    expect(added / previousLevel).toBeGreaterThan(3);
    expect(added / previousLevel).toBeLessThan(5);
  });

  it('scales the byte total with the number of layers', () => {
    const one = service.estimate(BBOX, 10, 14, [MapLayerKind.Slope]);
    const two = service.estimate(BBOX, 10, 14, [MapLayerKind.Slope, MapLayerKind.Aspect]);
    expect(two.tileCount).toBe(one.tileCount * 2);
    expect(two.estimatedBytes).toBeGreaterThan(one.estimatedBytes);
  });

  it('warns about zoom 16+, which is where downloads get away from people', () => {
    const r = service.estimate(BBOX, 10, 16, [MapLayerKind.Slope]);
    expect(r.warnings.some((w) => w.includes('Zoom 16+'))).toBe(true);
  });

  it('names the layer worth dropping when one dominates the download', () => {
    // Satellite is ~3x the bytes per tile of the terrain layers.
    const r = service.estimate(BBOX, 10, 15, [MapLayerKind.Satellite, MapLayerKind.Benches]);
    expect(r.warnings.some((w) => w.includes('satellite'))).toBe(true);
  });

  it('stays quiet on a small, sensible region', () => {
    const small = { west: -84.2, south: 39.65, east: -84.18, north: 39.67 };
    const r = service.estimate(small, 12, 15, [MapLayerKind.Slope]);
    expect(r.warnings).toHaveLength(0);
  });

  it('rejects an inverted zoom range', () => {
    expect(() => service.estimate(BBOX, 15, 12, [MapLayerKind.Slope])).toThrow(
      BadRequestException,
    );
  });

  it('reports a per-layer breakdown that sums to the total', () => {
    const r = service.estimate(BBOX, 12, 14, [MapLayerKind.Slope, MapLayerKind.Satellite]);
    const summed = r.byLayer.reduce((s, l) => s + l.estimatedBytes, 0);
    expect(summed).toBe(r.estimatedBytes);
    expect(r.byLayer).toHaveLength(2);
  });

  it('falls back to a neutral per-tile size for unrecognised layers', () => {
    const r = service.estimate(BBOX, 12, 13, ['some-future-layer']);
    expect(r.estimatedBytes).toBeGreaterThan(0);
  });
});
