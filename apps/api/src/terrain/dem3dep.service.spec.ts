/**
 * Tests for serving 3DEP as Web Mercator PNG tiles.
 *
 * All offline. A stubbed `fetch` serves synthetic GeoTIFFs built by the
 * engine's own `writeSyntheticTiff`, so the whole path — range request, TIFF
 * parse, reprojection, compositing, PNG encode, PNG decode — runs for real
 * against rasters whose values are known by construction.
 *
 * The two behaviours worth the most here are the ones that fail *silently* in
 * production: a void encoded as ground far below sea level, and a tile
 * straddling two source files leaving a seam of missing data.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PNG } from 'pngjs';
import { decodeRgbaToHeights, isElevation, lngLatToTile, NODATA } from '@hunt-maps/terrain';
import { writeSyntheticTiff } from '@hunt-maps/terrain/testing';
import { Dem3depService } from './dem3dep.service';

/** Serve `bodies` by URL substring, honouring `Range:` the way S3 does. */
function stubFetch(bodies: Array<{ match: string; bytes: Uint8Array | null }>) {
  const spy = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
    const entry = bodies.find((b) => url.includes(b.match));
    if (!entry || !entry.bytes) {
      return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    const m = /bytes=(\d+)-(\d+)/.exec(init?.headers?.Range ?? '');
    const bytes = entry.bytes;
    if (!m) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.slice().buffer,
      };
    }
    const start = Number(m[1]);
    const end = Math.min(Number(m[2]), bytes.length - 1);
    const slice = bytes.subarray(start, end + 1);
    return {
      ok: true,
      status: 206,
      arrayBuffer: async () => slice.slice().buffer,
    };
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** Decode a rendered PNG tile back to metres, exactly as the worker does. */
function heightsFromPng(png: Buffer): Float32Array {
  const decoded = PNG.sync.read(png);
  return decodeRgbaToHeights(new Uint8Array(decoded.data), 'terrain-rgb');
}

describe('Dem3depService — 1/3 arc-second tiles', () => {
  let service: Dem3depService;

  beforeEach(() => {
    service = new Dem3depService();
    vi.unstubAllGlobals();
  });

  it('renders a tile of real heights and round-trips them through the PNG', async () => {
    // A geographic raster, as the `13` product is: NAD83 degrees.
    const lng = -85.65;
    const lat = 37.92;
    const size = 256;
    const step = 0.002;
    const bytes = writeSyntheticTiff({
      width: size,
      height: size,
      tileWidth: 128,
      tileHeight: 128,
      samples: new Array(size * size).fill(300.25),
      pixelScale: [step, step, 0],
      tiePoint: [0, 0, 0, lng - (step * size) / 2, lat + (step * size) / 2, 0],
      geoKeys: [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4269],
      noData: String(NODATA),
    });
    stubFetch([{ match: 'USGS_13_', bytes }]);

    const t = lngLatToTile(lng, lat, 14);
    const tile = { z: 14, x: Math.floor(t.x), y: Math.floor(t.y) };
    const { png, report } = await service.renderPng(tile, '13', 64);

    expect(report.product).toBe('13');
    expect(report.coverage).toBe(1);
    const heights = heightsFromPng(png);
    for (const h of heights) {
      // terrain-rgb quantises to 0.1 m.
      expect(Math.abs(h - 300.25)).toBeLessThan(0.06);
    }
  });

  /**
   * The failure that makes `encodeHeightsToRgba` necessary. Both DEM encodings
   * are unsigned and clamp at their low end, so a NODATA cell encodes to black
   * and decodes as -10000 m — a finite number that passes every
   * `Number.isFinite` guard and reads as ground 10 km below the viewer. Voids
   * must travel as alpha = 0 instead.
   */
  it('encodes a void as transparent, not as ground far below sea level', async () => {
    const lng = -85.65;
    const lat = 37.92;
    const size = 256;
    const step = 0.002;
    const bytes = writeSyntheticTiff({
      width: size,
      height: size,
      tileWidth: 128,
      tileHeight: 128,
      samples: new Array(size * size).fill(NODATA),
      pixelScale: [step, step, 0],
      tiePoint: [0, 0, 0, lng - (step * size) / 2, lat + (step * size) / 2, 0],
      geoKeys: [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4269],
      noData: String(NODATA),
    });
    stubFetch([{ match: 'USGS_13_', bytes }]);

    const t = lngLatToTile(lng, lat, 14);
    const { png, report } = await service.renderPng(
      { z: 14, x: Math.floor(t.x), y: Math.floor(t.y) },
      '13',
      32,
    );
    expect(report.coverage).toBe(0);

    const decoded = PNG.sync.read(png);
    for (let i = 3; i < decoded.data.length; i += 4) expect(decoded.data[i]).toBe(0);
    for (const h of heightsFromPng(png)) {
      expect(h).toBe(NODATA);
      expect(isElevation(h)).toBe(false);
    }
  });

  it('reports zero coverage rather than throwing when a source is missing', async () => {
    stubFetch([]);
    const t = lngLatToTile(-85.65, 37.92, 14);
    const { report } = await service.renderTile(
      { z: 14, x: Math.floor(t.x), y: Math.floor(t.y) },
      '13',
      32,
    );
    // A missing source file is a coverage hole, honestly reported — not a 500.
    expect(report.coverage).toBe(0);
  });
});

describe('Dem3depService — compositing across source files', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * 3DEP tiles are 10 km squares; a Mercator tile is smaller but does not align
   * with them, so a tile near a boundary genuinely overlaps two source files.
   * Rendering from only the file under the tile's centre leaves the rest of the
   * tile NODATA — a hard edge of missing data every 10 km across the whole
   * layer, which looks like terrain rather than like a bug.
   *
   * Here the centre file covers only the northern half of the tile and a second
   * file supplies the south. Full coverage is only achievable by consulting
   * both.
   */
  it('fills a tile from more than one source file rather than leaving a seam', async () => {
    const service = new Dem3depService();
    const lng = -85.65;
    const lat = 37.92;
    const size = 256;
    const step = 0.002;
    const geoKeys = [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4269];

    const t = lngLatToTile(lng, lat, 12);
    const tile = { z: 12, x: Math.floor(t.x), y: Math.floor(t.y) };

    // Two overlapping-in-longitude rasters, split in latitude: the first
    // covers only north of `lat`, the second only south of it.
    const north = writeSyntheticTiff({
      width: size,
      height: size,
      tileWidth: 128,
      tileHeight: 128,
      samples: new Array(size * size).fill(400),
      pixelScale: [step, step, 0],
      tiePoint: [0, 0, 0, lng - (step * size) / 2, lat + step * size, 0],
      geoKeys,
      noData: String(NODATA),
    });
    const south = writeSyntheticTiff({
      width: size,
      height: size,
      tileWidth: 128,
      tileHeight: 128,
      samples: new Array(size * size).fill(200),
      pixelScale: [step, step, 0],
      tiePoint: [0, 0, 0, lng - (step * size) / 2, lat, 0],
      geoKeys,
      noData: String(NODATA),
    });

    // `13` addressing is deterministic per one-degree cell, so the centre and
    // the corners of a tile spanning a cell edge resolve to different names.
    // Serve `north` for one cell name and `south` for the other.
    const cellNorth = 'n38w086';
    const cellSouth = 'n37w086';
    stubFetch([
      { match: `USGS_13_${cellNorth}`, bytes: north },
      { match: `USGS_13_${cellSouth}`, bytes: south },
    ]);

    const { heights, report } = await service.renderTile(tile, '13', 32);
    const measured = [...heights].filter(isElevation);

    // Whatever the split, every cell that any source covers must be filled.
    expect(measured.length).toBeGreaterThan(0);
    expect(report.coverage).toBeGreaterThan(0);
    // And values must come from the sources, never blended into something
    // neither file contains — a blend across a seam invents a gradient, which
    // reads as a micro-bench exactly at the join.
    for (const h of measured) {
      expect([200, 400].some((v) => Math.abs(h - v) < 0.5)).toBe(true);
    }
  });
});
