import { describe, expect, it } from 'vitest';
import {
  decodePixel,
  decodeRgbaToHeights,
  encodeHeightsToRgba,
  encodePixel,
  isElevation,
  NODATA,
  type DemEncoding,
} from './encoding.js';
import {
  EQUATORIAL_RESOLUTION,
  haversine,
  lngLatToTile,
  pixelSizeMeters,
  tileBBox,
  tileToLngLat,
  tilesForBBox,
} from './tilemath.js';
import { assembleGrid, HeightGrid } from './grid.js';

describe('DEM encodings', () => {
  const encodings: DemEncoding[] = ['terrarium', 'terrain-rgb'];

  for (const enc of encodings) {
    it(`${enc} round-trips elevations within its quantisation`, () => {
      // Death Valley to Denali covers everything a North American hunter sees.
      for (const h of [-86, 0, 137.5, 300.25, 1609, 4200, 6190]) {
        const [r, g, b] = encodePixel(h, enc);
        const back = decodePixel(r, g, b, enc);
        expect(Math.abs(back - h)).toBeLessThan(enc === 'terrarium' ? 0.01 : 0.06);
      }
    });
  }

  it('decodes the documented Terrarium formula', () => {
    // h = (R*256 + G + B/256) - 32768
    expect(decodePixel(128, 0, 0, 'terrarium')).toBeCloseTo(0, 6);
    expect(decodePixel(128, 100, 128, 'terrarium')).toBeCloseTo(100.5, 6);
  });

  it('decodes the documented Terrain-RGB formula', () => {
    // h = -10000 + (R*65536 + G*256 + B) * 0.1
    expect(decodePixel(0, 0, 0, 'terrain-rgb')).toBeCloseTo(-10000, 6);
    expect(decodePixel(1, 134, 160, 'terrain-rgb')).toBeCloseTo(
      -10000 + (65536 + 134 * 256 + 160) * 0.1,
      6,
    );
  });

  it('treats fully transparent pixels as no-data', () => {
    const rgba = new Uint8Array([128, 0, 0, 255, 128, 0, 0, 0]);
    const heights = decodeRgbaToHeights(rgba, 'terrarium');
    expect(heights[0]).toBeCloseTo(0, 6);
    expect(heights[1]).toBe(NODATA);
  });

  for (const enc of encodings) {
    it(`${enc} round-trips a height field through RGBA`, () => {
      const heights = new Float32Array([-86, 0, 137.5, 1609, 4200]);
      const back = decodeRgbaToHeights(encodeHeightsToRgba(heights, enc), enc);
      for (let i = 0; i < heights.length; i++) {
        expect(Math.abs(back[i] - heights[i])).toBeLessThan(enc === 'terrarium' ? 0.01 : 0.06);
      }
    });

    /**
     * The regression that makes this function necessary rather than obvious.
     * Both encodings clamp at their low end, so a NODATA cell encodes to black
     * and decodes as -10000 m (terrain-rgb) or -32768 m (terrarium): finite
     * numbers that pass every `Number.isFinite` guard and read as terrain
     * kilometres below the viewer — the `R30` failure, where a void becomes the
     * most "open" ground the encoding can express and every horizon operator
     * reports full sky over it. Alpha = 0 is what carries the void across.
     */
    it(`${enc} carries NODATA across as alpha 0, not as ground far below`, () => {
      const rgba = encodeHeightsToRgba(new Float32Array([250, NODATA]), enc);
      expect(rgba[3]).toBe(255);
      expect(rgba[7]).toBe(0);
      const back = decodeRgbaToHeights(rgba, enc);
      expect(back[0]).toBeCloseTo(250, 1);
      expect(back[1]).toBe(NODATA);
      expect(isElevation(back[1])).toBe(false);
    });

    it(`${enc} treats NaN as no-data rather than encoding it as zero`, () => {
      const rgba = encodeHeightsToRgba(new Float32Array([NaN]), enc);
      expect(rgba[3]).toBe(0);
      expect(decodeRgbaToHeights(rgba, enc)[0]).toBe(NODATA);
    });
  }
});

describe('tile math', () => {
  it('matches the known z0 equatorial resolution', () => {
    expect(pixelSizeMeters(0, 0)).toBeCloseTo(EQUATORIAL_RESOLUTION, 3);
  });

  it('halves resolution per zoom level', () => {
    expect(pixelSizeMeters(14, 0)).toBeCloseTo(pixelSizeMeters(13, 0) / 2, 6);
  });

  it('shrinks ground resolution with latitude — the cos(lat) term', () => {
    // Missing this understates slope by 2x at 60°N.
    expect(pixelSizeMeters(14, 60)).toBeCloseTo(pixelSizeMeters(14, 0) * 0.5, 4);
  });

  it('accounts for 512px tiles', () => {
    expect(pixelSizeMeters(14, 40, 512)).toBeCloseTo(pixelSizeMeters(14, 40, 256) / 2, 6);
  });

  it('round-trips lng/lat through tile coordinates', () => {
    const lng = -84.3;
    const lat = 39.7;
    const t = lngLatToTile(lng, lat, 14);
    const back = tileToLngLat(t.x, t.y, 14);
    expect(back.lng).toBeCloseTo(lng, 8);
    expect(back.lat).toBeCloseTo(lat, 8);
  });

  it('produces a bbox whose corners bracket the tile', () => {
    const bbox = tileBBox({ z: 12, x: 1000, y: 1500 });
    expect(bbox.west).toBeLessThan(bbox.east);
    expect(bbox.south).toBeLessThan(bbox.north);
  });

  it('enumerates every tile covering a bbox', () => {
    const bbox = { west: -84.4, south: 39.6, east: -84.3, north: 39.7 };
    const tiles = tilesForBBox(bbox, 14);
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) expect(t.z).toBe(14);

    // Every corner of the bbox must land inside one of the returned tiles.
    const covers = (lng: number, lat: number) => {
      const p = lngLatToTile(lng, lat, 14);
      return tiles.some((t) => Math.floor(p.x) === t.x && Math.floor(p.y) === t.y);
    };
    expect(covers(bbox.west, bbox.north)).toBe(true);
    expect(covers(bbox.east, bbox.south)).toBe(true);
  });

  it('measures distance with haversine', () => {
    // One degree of latitude is ~111 km anywhere.
    const d = haversine({ lng: 0, lat: 39 }, { lng: 0, lat: 40 });
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });
});

describe('HeightGrid', () => {
  it('rejects a buffer that does not match its declared shape', () => {
    expect(
      () =>
        new HeightGrid({ width: 4, height: 4, halo: 1, cellSize: 10, data: new Float32Array(4) }),
    ).toThrow(/size mismatch/);
  });

  it('reads into the halo and clamps beyond it', () => {
    const g = HeightGrid.empty(4, 4, 2, 10);
    g.set(-2, -2, 111);
    g.set(0, 0, 222);
    expect(g.get(-2, -2)).toBe(111);
    // Past the halo, reads clamp to the edge rather than throwing.
    expect(g.get(-99, -99)).toBe(111);
  });

  it('bilinearly samples between cells', () => {
    const g = HeightGrid.empty(2, 2, 1, 10);
    g.set(0, 0, 0);
    g.set(1, 0, 10);
    g.set(0, 1, 0);
    g.set(1, 1, 10);
    expect(g.sample(0.5, 0.5)).toBeCloseTo(5, 6);
  });

  it('reports the interior elevation range, ignoring no-data', () => {
    const g = HeightGrid.empty(3, 3, 1, 10);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) g.set(x, y, 100 + x);
    const r = g.range();
    expect(r.min).toBe(100);
    expect(r.max).toBe(102);
  });

  it('fills voids from surrounding data', () => {
    const g = HeightGrid.empty(3, 3, 1, 10);
    for (let y = -1; y <= 3; y++) for (let x = -1; x <= 3; x++) g.set(x, y, 500);
    g.set(1, 1, NODATA);
    expect(g.hasData(1, 1)).toBe(false);
    g.fillVoids();
    expect(g.get(1, 1)).toBeCloseTo(500, 3);
  });

  it('copies a 3x3 window in north-first row-major order', () => {
    const g = HeightGrid.empty(3, 3, 1, 10);
    let v = 0;
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) g.set(x, y, v++);
    const w = g.window3(0, 0, new Float32Array(9));
    expect([...w]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('assembleGrid', () => {
  it('stitches neighbour tiles into the halo so edges have real data', () => {
    // This is the seam bug: without neighbour data, gradients at the tile edge
    // are computed against replicated pixels and every tile boundary shows.
    const size = 8;
    const center = new Float32Array(size * size).fill(100);
    const neighbours = new Map<string, Float32Array>();
    neighbours.set('-1,0', new Float32Array(size * size).fill(50)); // west
    neighbours.set('1,0', new Float32Array(size * size).fill(150)); // east

    const grid = assembleGrid({ z: 14, x: 100, y: 200 }, center, neighbours, size, 3);

    expect(grid.get(0, 0)).toBe(100);
    expect(grid.get(-1, 0)).toBe(50); // pulled from the western neighbour
    expect(grid.get(size, 0)).toBe(150); // pulled from the eastern neighbour
  });

  it('leaves missing neighbours as edge-replicated rather than failing', () => {
    const size = 8;
    const center = new Float32Array(size * size).fill(100);
    const grid = assembleGrid({ z: 14, x: 100, y: 200 }, center, new Map(), size, 2);
    expect(grid.get(0, 0)).toBe(100);
    expect(grid.hasData(-1, 0)).toBe(false);
  });

  it('derives cell size from the tile zoom, latitude and tile pixel size', () => {
    // A real 256px z14 tile over Ohio: ~9.5 m ground resolution.
    const size = 256;
    const center = new Float32Array(size * size).fill(100);
    const grid = assembleGrid({ z: 14, x: 4370, y: 6323 }, center, new Map(), size, 1);
    expect(grid.cellSize).toBeGreaterThan(6);
    expect(grid.cellSize).toBeLessThan(12);
  });

  it('scales cell size with the tile pixel dimension, not just zoom', () => {
    // A 512px tile covers the same ground with twice the samples.
    const centre256 = new Float32Array(256 * 256).fill(100);
    const centre512 = new Float32Array(512 * 512).fill(100);
    const t = { z: 14, x: 4370, y: 6323 };
    const g256 = assembleGrid(t, centre256, new Map(), 256, 1);
    const g512 = assembleGrid(t, centre512, new Map(), 512, 1);
    expect(g512.cellSize).toBeCloseTo(g256.cellSize / 2, 6);
  });
});
