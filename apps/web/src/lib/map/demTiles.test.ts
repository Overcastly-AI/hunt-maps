import { describe, expect, it } from 'vitest';
import {
  DEM_MAX_ZOOM,
  demSourceZoom,
  demTileCount,
  demTileKey,
  demTilesForBounds,
  sampleDemTiles,
} from './demTiles';

/**
 * These pin the one thing that makes the coverage badge meaningful: the tiles
 * it checks are the tiles the map will ask for. If `demSourceZoom` drifts from
 * MapLibre's covering-zoom rule, the badge starts reporting on a zoom level
 * nobody is fetching — which is a subtler version of the bug it replaced, and
 * harder to spot because it would look right most of the time.
 */
describe('demSourceZoom', () => {
  it('is map zoom + 1 for a 256px source, because the transform tile size is 512', () => {
    // MapLibre: round(zoom + log2(transform.tileSize / source.tileSize)),
    // roundZoom = true on every raster source.
    expect(demSourceZoom(13)).toBe(14);
    expect(demSourceZoom(12.4)).toBe(13);
    expect(demSourceZoom(12.6)).toBe(14);
  });

  it('clamps at DEM_MAX_ZOOM — past it MapLibre overzooms rather than fetching deeper', () => {
    expect(demSourceZoom(15)).toBe(DEM_MAX_ZOOM);
    expect(demSourceZoom(18)).toBe(DEM_MAX_ZOOM);
  });

  it('never goes negative', () => {
    expect(demSourceZoom(-4)).toBe(0);
  });
});

describe('demTilesForBounds', () => {
  const hocking = { west: -82.56, south: 39.42, east: -82.52, north: 39.45 };

  it('agrees with demTileCount', () => {
    for (const z of [8, 12, 14]) {
      expect(demTilesForBounds(hocking, z)).toHaveLength(demTileCount(hocking, z));
    }
  });

  it('quadruples per zoom level, which is the thing users never expect', () => {
    const z12 = demTileCount({ west: -83, south: 39, east: -82, north: 40 }, 12);
    const z13 = demTileCount({ west: -83, south: 39, east: -82, north: 40 }, 13);
    expect(z13 / z12).toBeGreaterThan(3.5);
  });

  it('produces tiles inside the grid when the view straddles the antimeridian', () => {
    // west > east: MapLibre reports this for a view over the date line. A naive
    // hand-off enumerates nothing, and "no tiles needed" reads as "nothing
    // missing" — a silent green over ground with no data at all.
    const tiles = demTilesForBounds({ west: 179.5, south: 10, east: -179.5, north: 11 }, 8);
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(2 ** 8);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThan(2 ** 8);
    }
    // Both sides of the line are represented, not just one.
    expect(tiles.some((t) => t.x > 2 ** 7)).toBe(true);
    expect(tiles.some((t) => t.x < 2 ** 7)).toBe(true);
  });

  it('clamps past the Mercator latitude limit instead of running off the grid', () => {
    const tiles = demTilesForBounds({ west: -10, south: -89, east: -9, north: 89 }, 6);
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(Number.isFinite(t.y)).toBe(true);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThan(2 ** 6);
    }
  });

  it('keys tiles into the `dem` namespace — rendered layers are never cached', () => {
    expect(demTileKey({ z: 14, x: 4370, y: 6323 })).toEqual({
      layer: 'dem',
      z: 14,
      x: 4370,
      y: 6323,
    });
  });
});

describe('sampleDemTiles', () => {
  const wide = { west: -84, south: 38, east: -80, north: 41 };

  it('returns the exact set when it fits under the cap', () => {
    const exact = demTilesForBounds(wide, 8);
    expect(sampleDemTiles(wide, 8, exact.length + 10)).toHaveLength(exact.length);
  });

  it('stays within budget for a viewport far too large to enumerate', () => {
    const sample = sampleDemTiles(wide, 15, 48);
    expect(demTileCount(wide, 15)).toBeGreaterThan(10_000);
    expect(sample.length).toBeGreaterThan(0);
    expect(sample.length).toBeLessThanOrEqual(48);
  });

  it('spreads over both axes rather than sampling one stripe', () => {
    // The failure this guards: striding a row-major list by a multiple of the
    // row width samples a single column, so a region stored in the other
    // columns reports 0% and a hunter re-downloads what they already have.
    const sample = sampleDemTiles(wide, 15, 48);
    expect(new Set(sample.map((t) => t.x)).size).toBeGreaterThan(1);
    expect(new Set(sample.map((t) => t.y)).size).toBeGreaterThan(1);
  });

  it('is deterministic — a still map must not show a jittering percentage', () => {
    const a = sampleDemTiles(wide, 15, 48);
    const b = sampleDemTiles(wide, 15, 48);
    expect(a).toEqual(b);
  });

  it('only ever samples tiles the view actually needs', () => {
    const needed = new Set(demTilesForBounds(wide, 10).map((t) => `${t.x}/${t.y}`));
    for (const t of sampleDemTiles(wide, 10, 12)) {
      expect(needed.has(`${t.x}/${t.y}`)).toBe(true);
    }
  });
});
