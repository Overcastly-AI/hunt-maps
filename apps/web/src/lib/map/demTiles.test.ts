import { describe, expect, it } from 'vitest';
import { tilesForBBox, type BBox } from '@hunt-maps/terrain';
import {
  DEM_MAX_ZOOM,
  boundsToBBox,
  demSourceZoom,
  demTileCount,
  demTileKey,
  demTileRanges,
  demTilesForBounds,
  sampleDemTiles,
  tileSetSignature,
} from './demTiles';

/** Hocking Hills, roughly one desktop viewport at z14. */
const HOCKING: BBox = { west: -82.58, south: 39.41, east: -82.5, north: 39.46 };

describe('demSourceZoom', () => {
  // MapLibre's own rule for a 256px raster source against a 512px transform:
  // round(zoom + 1), clamped to the source maxzoom. Pinned because the coverage
  // check probes at this zoom — if it drifts, the badge measures tiles nobody
  // is fetching, which is exactly the class of lie this feature removes.
  it('mirrors MapLibre covering-zoom for a 256px raster source', () => {
    expect(demSourceZoom(13)).toBe(14);
    expect(demSourceZoom(13.4)).toBe(14);
    expect(demSourceZoom(13.6)).toBe(15);
    expect(demSourceZoom(10)).toBe(11);
  });

  it('saturates at the DEM source maxzoom, because zooming past it overzooms', () => {
    expect(demSourceZoom(14)).toBe(DEM_MAX_ZOOM);
    expect(demSourceZoom(16)).toBe(DEM_MAX_ZOOM);
    expect(demSourceZoom(18)).toBe(DEM_MAX_ZOOM);
  });

  it('never returns a negative zoom', () => {
    expect(demSourceZoom(-4)).toBe(0);
  });
});

describe('demTilesForBounds', () => {
  it('is the engine enumeration, not a second implementation', () => {
    // The load-bearing claim of this whole feature: what the badge checks and
    // what a region download plans are the same function. If someone
    // reimplements either, this fails.
    const mine = demTilesForBounds(HOCKING, 14);
    const engine = tilesForBBox(HOCKING, 14);
    expect(tileSetSignature(mine)).toBe(tileSetSignature(engine.map((t) => ({ ...t }))));
  });

  it('agrees exactly with the allocation-free count', () => {
    for (const z of [8, 11, 14, 15]) {
      expect(demTileCount(HOCKING, z)).toBe(demTilesForBounds(HOCKING, z).length);
    }
  });

  it('quadruples per zoom level, which is what makes downloads surprising', () => {
    const at12 = demTileCount({ west: -83, south: 39, east: -82, north: 40 }, 12);
    const at13 = demTileCount({ west: -83, south: 39, east: -82, north: 40 }, 13);
    expect(at13 / at12).toBeGreaterThan(3.4);
    expect(at13 / at12).toBeLessThan(4.6);
  });

  it('handles a view straddling the antimeridian instead of returning nothing', () => {
    // west > east. A naive hand-off to tilesForBBox walks a backwards loop and
    // yields zero tiles — which reads downstream as "nothing is missing".
    const tiles = demTilesForBounds({ west: 179.5, south: -0.5, east: -179.5, north: 0.5 }, 8);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((t) => t.x >= 0 && t.x < 2 ** 8)).toBe(true);
    expect(demTileCount({ west: 179.5, south: -0.5, east: -179.5, north: 0.5 }, 8)).toBe(
      tiles.length,
    );
  });

  it('clamps past the Mercator latitude limit rather than running off the grid', () => {
    const tiles = demTilesForBounds({ west: -10, south: -89, east: 10, north: 89 }, 4);
    expect(tiles.every((t) => t.y >= 0 && t.y < 2 ** 4)).toBe(true);
  });

  it('tolerates inverted north/south', () => {
    const normal = demTilesForBounds(HOCKING, 12);
    const flipped = demTilesForBounds(
      { ...HOCKING, north: HOCKING.south, south: HOCKING.north },
      12,
    );
    expect(tileSetSignature(flipped)).toBe(tileSetSignature(normal));
  });
});

describe('sampleDemTiles', () => {
  const WIDE: BBox = { west: -90, south: 30, east: -70, north: 45 };

  it('returns everything when the exact set already fits', () => {
    expect(sampleDemTiles(HOCKING, 10, 500)).toEqual(demTilesForBounds(HOCKING, 10));
  });

  it('stays within budget and inside the needed set', () => {
    const needed = new Set(demTilesForBounds(WIDE, 12).map((t) => `${t.x}/${t.y}`));
    const sample = sampleDemTiles(WIDE, 12, 48);
    expect(sample.length).toBeGreaterThan(0);
    expect(sample.length).toBeLessThanOrEqual(48);
    for (const t of sample) expect(needed.has(`${t.x}/${t.y}`)).toBe(true);
  });

  it('honours the budget for awkward aspect ratios, not just square ones', () => {
    // The probe cap is a battery budget for a phone mid-pan. A cap that a
    // letterboxed viewport or an antimeridian split can overrun is not a cap.
    const shapes: BBox[] = [
      { west: -179, south: 0, east: 179, north: 1 }, // very wide, very short
      { west: -1, south: -80, east: 0, north: 80 }, // very tall, very narrow
      { west: 179, south: -1, east: -179, north: 1 }, // split across the line
    ];
    for (const shape of shapes) {
      for (const max of [4, 12, 48, 256]) {
        const n = sampleDemTiles(shape, 12, max).length;
        expect(n, `${JSON.stringify(shape)} @ max ${max} sampled ${n}`).toBeLessThanOrEqual(max);
        expect(n).toBeGreaterThan(0);
      }
    }
  });

  it('spreads over both axes — a single column would misreport a half-stored region', () => {
    // The failure this guards: striding a row-major list with a stride equal to
    // the row width samples one column, so a region stored in the other half of
    // the view reads as 0%.
    const sample = sampleDemTiles(WIDE, 12, 48);
    expect(new Set(sample.map((t) => t.x)).size).toBeGreaterThan(1);
    expect(new Set(sample.map((t) => t.y)).size).toBeGreaterThan(1);
  });
});

describe('demTileKey', () => {
  it('namespaces elevation, because rendered layers are never cached', () => {
    expect(demTileKey({ z: 14, x: 4370, y: 6323 })).toEqual({
      layer: 'dem',
      z: 14,
      x: 4370,
      y: 6323,
    });
  });
});

describe('boundsToBBox', () => {
  it('reads a MapLibre LngLatBounds without depending on maplibre at runtime', () => {
    expect(
      boundsToBBox({
        getWest: () => -82.58,
        getSouth: () => 39.41,
        getEast: () => -82.5,
        getNorth: () => 39.46,
      }),
    ).toEqual(HOCKING);
  });
});

describe('demTileRanges', () => {
  it('splits an antimeridian view into two spans', () => {
    expect(demTileRanges({ west: 179.5, south: -1, east: -179.5, north: 1 }, 6)).toHaveLength(2);
  });

  it('collapses a whole-world view to one span', () => {
    expect(demTileRanges({ west: -400, south: -80, east: 400, north: 80 }, 3)).toHaveLength(1);
  });
});
