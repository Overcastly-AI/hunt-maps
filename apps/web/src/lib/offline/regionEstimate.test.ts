import { describe, expect, it, vi } from 'vitest';
import type { BBox } from '@hunt-maps/terrain';
import { ELEVATION_LAYER, deviceWarnings, estimateRegion } from './regionEstimate';
import { DEM_BYTES_PER_TILE, MAX_REGION_TILES } from './regionPlan';

const BOUNDS: BBox = { west: -82.6, south: 39.39, east: -82.48, north: 39.47 };

function serverResponse(body: unknown, ok = true): typeof fetch {
  return vi.fn(async () => ({
    ok,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('what the estimate actually sends', () => {
  it('asks about elevation and nothing else', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ tileCount: 100, estimatedBytes: 1_000_000, byLayer: [], warnings: [] }),
    })) as unknown as typeof fetch;

    await estimateRegion({
      bounds: BOUNDS,
      minZoom: 13,
      maxZoom: 15,
      tileCount: 100,
      fetchImpl,
    });

    const call = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const body = JSON.parse((call[1] as { body: string }).body);
    // The API's shape implies a cache of rendered layers, per layer. This app
    // caches elevation and computes every layer on-device, so the request says
    // so rather than inflating itself with layers we will never download.
    expect(body.layers).toEqual([ELEVATION_LAYER]);
    expect(body.minZoom).toBe(13);
    expect(body.maxZoom).toBe(15);
  });
});

describe('the byte figure', () => {
  it('is computed from measured elevation tiles, not from the API total', async () => {
    // The API has no elevation entry in its BYTES_PER_TILE table, so it falls
    // through to a 10 kB default — a tenfold under-statement against a real
    // ~100 kB Terrarium tile. Passing that through would tell a hunter "about
    // 90 MB" for a 900 MB download.
    const fetchImpl = serverResponse({
      tileCount: 9_000,
      estimatedBytes: 9_000 * 10_000,
      byLayer: [],
      warnings: [],
    });

    const estimate = await estimateRegion({
      bounds: BOUNDS,
      minZoom: 13,
      maxZoom: 15,
      tileCount: 9_000,
      fetchImpl,
    });

    expect(estimate.estimatedBytes).toBe(9_000 * DEM_BYTES_PER_TILE);
    expect(estimate.estimatedBytes).toBeGreaterThan(9_000 * 10_000);
  });
});

describe('warnings', () => {
  it('passes the server’s non-size warnings through verbatim', async () => {
    const zoomWarning =
      'Zoom 16+ quadruples the tile count per level. Zoom 15 is usually enough to read terrain in the field.';
    const fetchImpl = serverResponse({
      tileCount: 100,
      estimatedBytes: 1_000_000,
      byLayer: [],
      warnings: [zoomWarning],
    });

    const estimate = await estimateRegion({
      bounds: BOUNDS,
      minZoom: 13,
      maxZoom: 16,
      tileCount: 100,
      fetchImpl,
    });

    expect(estimate.warnings).toContain(zoomWarning);
  });

  it('replaces the server’s size warning with one computed from the honest byte figure', async () => {
    const fetchImpl = serverResponse({
      tileCount: 60_000,
      // 60 000 × 10 kB = 0.6 GB by the API's reckoning.
      estimatedBytes: 600_000_000,
      byLayer: [],
      warnings: ['About 0.6 GB. Start this on wifi, not the night before a hunt.'],
    });

    const estimate = await estimateRegion({
      bounds: BOUNDS,
      minZoom: 13,
      maxZoom: 15,
      tileCount: 60_000,
      fetchImpl,
    });

    expect(estimate.warnings).not.toContain(
      'About 0.6 GB. Start this on wifi, not the night before a hunt.',
    );
    // 60 000 × 100 kB = 6.0 GB — ten times what the server said, and the
    // number a hunter has to plan their evening around.
    expect(estimate.warnings).toContain(
      'About 6.0 GB. Start this on wifi, not the night before a hunt.',
    );
  });

  it('says so, loudly, when the server and the device planned different tile counts', async () => {
    // The two enumerations are meant to be the same function. A drift here is
    // R8's defect class, and the user is the one who pays for it later.
    const fetchImpl = serverResponse({
      tileCount: 4_321,
      estimatedBytes: 43_210_000,
      byLayer: [],
      warnings: [],
    });

    const estimate = await estimateRegion({
      bounds: BOUNDS,
      minZoom: 13,
      maxZoom: 15,
      tileCount: 4_000,
      fetchImpl,
    });

    expect(estimate.serverTileCount).toBe(4_321);
    expect(estimate.warnings[0]).toMatch(/server planned 4,321 tiles.*device planned 4,000/);
    // The download fetches the device's plan, so that is the number shown.
    expect(estimate.tileCount).toBe(4_000);
  });

  it('warns when the region will not fit in the storage the browser offers', () => {
    const warnings = deviceWarnings(5_000, 5_000 * DEM_BYTES_PER_TILE, 200_000_000);
    expect(warnings.some((w) => /run out part-way/.test(w))).toBe(true);
  });

  it('mirrors the API’s tile-ceiling sentence exactly, so online and offline read the same', () => {
    const warnings = deviceWarnings(MAX_REGION_TILES + 1, 1, undefined);
    expect(warnings).toContain(
      `${(MAX_REGION_TILES + 1).toLocaleString()} tiles is above the ` +
        `${MAX_REGION_TILES.toLocaleString()} limit. Reduce max zoom or shrink the area.`,
    );
  });
});

describe('when the server cannot be reached', () => {
  it('still produces an estimate, marked as computed on this device', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    const estimate = await estimateRegion({
      bounds: BOUNDS,
      minZoom: 13,
      maxZoom: 15,
      tileCount: 8_000,
      fetchImpl,
    });

    // The picker has to work at camp with one bar. An estimate that required a
    // round trip would break the feature in exactly the conditions it exists
    // for.
    expect(estimate.source).toBe('device');
    expect(estimate.tileCount).toBe(8_000);
    expect(estimate.estimatedBytes).toBe(8_000 * DEM_BYTES_PER_TILE);
    expect(estimate.warnings).toContain(
      'About 0.8 GB. Start this on wifi, not the night before a hunt.',
    );
  });

  it('treats an unauthenticated response the same as no response', async () => {
    const estimate = await estimateRegion({
      bounds: BOUNDS,
      minZoom: 13,
      maxZoom: 15,
      tileCount: 10,
      fetchImpl: serverResponse({}, false),
    });
    expect(estimate.source).toBe('device');
  });
});
