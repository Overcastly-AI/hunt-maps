/**
 * Tests for the COG reader, the UTM projection it needs, the 3DEP addressing
 * built on it, and the vertical-datum guard.
 *
 * Three kinds of evidence appear here, and it is worth being explicit about
 * which is which:
 *
 *  - **Closed form.** The meridian arc of GRS80 is a published geodetic
 *    constant; a plane raster has an exactly derivable value at every point.
 *    These can be asserted to many decimal places and are the strongest.
 *  - **Invariants.** Round-trips, and "an output cell outside the raster is
 *    NODATA". True by construction, and they catch sign and off-by-one errors.
 *  - **Pinned real values.** File names and elevations confirmed against the
 *    live USGS bucket during development, recorded here so a later change
 *    cannot silently move them. These are marked where they appear.
 */

import { describe, expect, it } from 'vitest';
import { NODATA, isElevation } from './encoding.js';
import { CogReader } from './cog.js';
import { TiffUnsupportedError } from './geotiff.js';
import {
  lngLatToUtm,
  nad83UtmEpsg,
  utmCentralMeridian,
  utmToLngLat,
  utmZoneForLongitude,
  utmZoneFromEpsg,
} from './projection.js';
import {
  oneDegreeCellName,
  oneMeterTileName,
  oneMeterUrl,
  oneThirdArcSecondUrl,
  renderMercatorTileFromCog,
  USGS_3DEP_VERTICAL_DATUM,
} from './usgs3dep.js';
import {
  assertSameVerticalDatum,
  looksLikeUnconvertedEllipsoidalHeight,
  VerticalDatumMismatchError,
} from './verticalDatum.js';
import { writeSyntheticTiff } from '../testing/syntheticTiff.js';

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

describe('UTM projection', () => {
  it('places the central meridian at exactly 500 000 m east', () => {
    for (const lat of [0, 25, 38.5, 49, 64]) {
      const u = lngLatToUtm(utmCentralMeridian(16), lat, 16);
      expect(u.easting).toBeCloseTo(500000, 6);
    }
  });

  it('reproduces the GRS80 meridian arc on the central meridian', () => {
    // Closed form: on the central meridian, northing = k0 * M(lat), where M is
    // the meridian arc from the equator. The GRS80 arc to 45 deg is
    // 4 984 944.3778 m (a published geodetic constant, independent of this
    // implementation), so northing must be 0.9996 * that = 4 982 950.400 m.
    const u = lngLatToUtm(utmCentralMeridian(16), 45, 16);
    expect(u.northing).toBeCloseTo(0.9996 * 4984944.3778, 3);
  });

  it('puts the equator at northing zero', () => {
    expect(lngLatToUtm(utmCentralMeridian(16), 0, 16).northing).toBeCloseTo(0, 6);
  });

  it('round-trips to better than a millimetre across a zone', () => {
    let worstMetres = 0;
    for (let lat = 25; lat <= 49; lat += 2) {
      for (let dLng = -3; dLng <= 3; dLng += 0.5) {
        const lng = utmCentralMeridian(17) + dLng;
        const back = utmToLngLat(lngLatToUtm(lng, lat, 17));
        // Degrees to metres, worst case (longitude scaled by cos lat).
        worstMetres = Math.max(
          worstMetres,
          Math.abs(back.lat - lat) * 111320,
          Math.abs(back.lng - lng) * 111320 * Math.cos((lat * Math.PI) / 180),
        );
      }
    }
    expect(worstMetres).toBeLessThan(0.001);
  });

  it('derives zone and EPSG code consistently', () => {
    expect(utmZoneForLongitude(-83.25)).toBe(17);
    expect(utmZoneForLongitude(-89.5)).toBe(16);
    expect(utmCentralMeridian(17)).toBe(-81);
    expect(nad83UtmEpsg(17)).toBe(26917);
    expect(utmZoneFromEpsg(26916)).toBe(16);
    expect(utmZoneFromEpsg(4269)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3DEP addressing
// ---------------------------------------------------------------------------

describe('3DEP product addressing', () => {
  it('names the one-degree cell by its north-west corner', () => {
    // Pinned against the live bucket: a point at 37.5N 84.5W is served by
    // USGS_13_n38w085.tif, confirmed by fetching and decoding it.
    expect(oneDegreeCellName(-84.5, 37.5)).toBe('n38w085');
    expect(oneThirdArcSecondUrl(-84.5, 37.5)).toBe(
      'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/n38w085/USGS_13_n38w085.tif',
    );
    // And the neighbouring cell, confirmed the same way.
    expect(oneDegreeCellName(-83.27, 38.48)).toBe('n39w084');
  });

  it('uses ceiling for latitude and floor for longitude, not the same for both', () => {
    // The failure mode: naming 37.5N 84.5W as `n37w084` (floor for both) fetches
    // the cell diagonally adjacent. Every height in it is real and plausible.
    expect(oneDegreeCellName(-84.5, 37.5)).not.toBe('n37w084');
    // Exactly on a boundary the cell is the one the point is the corner of.
    expect(oneDegreeCellName(-85, 38)).toBe('n38w085');
  });

  it('derives the 1 m tile name USGS actually publishes', () => {
    // Pinned: this exact stem exists in the live bucket as
    // USGS_1M_17_x30y427_KY_Eastern_2019_A19.tif, and sampling it agreed with
    // the independent 1/3 arc-second product to a mean of -0.69 m over 16
    // points of 150 m relief.
    const tile = oneMeterTileName(-83.27183, 38.48432, 17);
    expect(tile.stem).toBe('USGS_1M_17_x30y427');
    expect(tile.zone).toBe(17);
    expect(oneMeterUrl(tile, 'KY_Eastern_2019_A19')).toBe(
      'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/' +
        'KY_Eastern_2019_A19/TIFF/USGS_1M_17_x30y427_KY_Eastern_2019_A19.tif',
    );
  });

  it('indexes the 1 m cell by its NORTH edge', () => {
    // The tie point of ..._x30y427_... is northing 4 270 006, so `y` counts the
    // top of the cell. Reading it as the bottom lands 10 km due south — far
    // enough to be a different property, close enough to look right.
    const tile = oneMeterTileName(-83.27183, 38.48432, 17);
    const utm = lngLatToUtm(-83.27183, 38.48432, 17);
    expect(tile.y * 10000).toBeGreaterThan(utm.northing);
    expect((tile.y - 1) * 10000).toBeLessThanOrEqual(utm.northing);
  });

  it('declares 3DEP as orthometric, and this is load-bearing', () => {
    expect(USGS_3DEP_VERTICAL_DATUM).toBe('orthometric');
  });
});

// ---------------------------------------------------------------------------
// Vertical datum
// ---------------------------------------------------------------------------

describe('vertical datum guard', () => {
  it('allows two orthometric sources to be combined', () => {
    expect(() => assertSameVerticalDatum('orthometric', 'orthometric', 'mosaic')).not.toThrow();
  });

  it('refuses to combine orthometric with ellipsoidal', () => {
    expect(() => assertSameVerticalDatum('orthometric', 'ellipsoidal', 'mosaic')).toThrow(
      VerticalDatumMismatchError,
    );
  });

  it('flags a GNSS altitude that was never converted from the ellipsoid', () => {
    // A hunter standing on ground the DEM says is 300 m, whose handheld reports
    // 328 m, has an unconverted ellipsoidal height — not a 28 m position error.
    expect(looksLikeUnconvertedEllipsoidalHeight(328, 300)).toBe(true);
    expect(looksLikeUnconvertedEllipsoidalHeight(302, 300)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CogReader
// ---------------------------------------------------------------------------

/** Serves a whole in-memory TIFF over the reader's range interface. */
function bytesReader(bytes: Uint8Array, onRead?: (start: number, end: number) => void) {
  return async (start: number, end: number): Promise<Uint8Array> => {
    onRead?.(start, end);
    return bytes.subarray(start, Math.min(end + 1, bytes.length));
  };
}

/**
 * A geographic raster on an exact tilted plane, so every sample has a closed
 * form: height = 100 + 1000 * (lng + 85) + 2000 * (38 - lat).
 */
const PLANE = (() => {
  const w = 64;
  const h = 64;
  const scale = 0.001;
  const samples: number[] = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const lng = -85 + (i + 0.5) * scale;
      const lat = 38 - (j + 0.5) * scale;
      samples.push(100 + 1000 * (lng + 85) + 2000 * (38 - lat));
    }
  }
  return {
    bytes: writeSyntheticTiff({
      width: w,
      height: h,
      tileWidth: 32,
      tileHeight: 32,
      samples,
      pixelScale: [scale, scale, 0],
      tiePoint: [0, 0, 0, -85, 38, 0],
      // Geographic (GTModelType 2), NAD83, PixelIsArea.
      geoKeys: [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4269],
      noData: '-999999',
    }),
    at: (lng: number, lat: number) => 100 + 1000 * (lng + 85) + 2000 * (38 - lat),
  };
})();

describe('CogReader — geographic raster', () => {
  it('reports the CRS from the GeoKeys', async () => {
    const reader = await CogReader.open(bytesReader(PLANE.bytes));
    expect(reader.crs).toEqual({ kind: 'geographic', epsg: 4269 });
    expect(reader.verticalDatum).toBe('orthometric');
  });

  it('samples the closed-form plane at cell centres exactly', async () => {
    const reader = await CogReader.open(bytesReader(PLANE.bytes));
    for (const [i, j] of [
      [0, 0],
      [10, 20],
      [63, 63],
    ]) {
      const lng = -85 + (i + 0.5) * 0.001;
      const lat = 38 - (j + 0.5) * 0.001;
      const got = await reader.sampleLngLat(lng, lat);
      expect(got).toBeCloseTo(PLANE.at(lng, lat), 3);
    }
  });

  it('interpolates between cell centres, on the plane', async () => {
    // Bilinear interpolation of a plane is exact, so this is still closed form
    // — and it is the assertion that catches a half-cell registration error,
    // which is 5 m on the real 1/3 arc-second product.
    const reader = await CogReader.open(bytesReader(PLANE.bytes));
    const lng = -85 + 10.13 * 0.001;
    const lat = 38 - 7.77 * 0.001;
    expect(await reader.sampleLngLat(lng, lat)).toBeCloseTo(PLANE.at(lng, lat), 3);
  });

  it('reads outside the raster as NODATA, never as a number', async () => {
    const reader = await CogReader.open(bytesReader(PLANE.bytes));
    // West of the western edge, and north of the northern edge.
    expect(await reader.sampleLngLat(-85.01, 37.99)).toBe(NODATA);
    expect(await reader.sampleLngLat(-84.99, 38.01)).toBe(NODATA);
    expect(isElevation(await reader.sampleLngLat(-85.01, 37.99))).toBe(false);
  });

  it('reports its geographic bounds', async () => {
    const reader = await CogReader.open(bytesReader(PLANE.bytes));
    const b = reader.bounds();
    expect(b.west).toBeCloseTo(-85, 9);
    expect(b.north).toBeCloseTo(38, 9);
    expect(b.east).toBeCloseTo(-85 + 64 * 0.001, 9);
    expect(b.south).toBeCloseTo(38 - 64 * 0.001, 9);
  });

  it('fetches only the header when nothing has been sampled', async () => {
    const reads: Array<[number, number]> = [];
    await CogReader.open(bytesReader(PLANE.bytes, (s, e) => reads.push([s, e])));
    expect(reads).toHaveLength(1);
    expect(reads[0][0]).toBe(0);
  });
});

describe('CogReader — voids', () => {
  const withHole = (() => {
    const w = 16;
    const h = 16;
    const samples = new Array(w * h).fill(200);
    // A 2x2 void in the middle, as a river or a survey boundary would be.
    for (const j of [7, 8]) for (const i of [7, 8]) samples[j * w + i] = -999999;
    return writeSyntheticTiff({
      width: w,
      height: h,
      samples,
      pixelScale: [0.001, 0.001, 0],
      tiePoint: [0, 0, 0, -85, 38, 0],
      geoKeys: [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4269],
      noData: '-999999',
    });
  })();

  it('returns NODATA inside a void rather than interpolating neighbours', async () => {
    const reader = await CogReader.open(bytesReader(withHole));
    const lng = -85 + 7.5 * 0.001;
    const lat = 38 - 7.5 * 0.001;
    expect(await reader.sampleLngLat(lng, lat)).toBe(NODATA);
  });

  it('still returns a measured height in the cells around the void', async () => {
    const reader = await CogReader.open(bytesReader(withHole));
    const lng = -85 + 2.5 * 0.001;
    const lat = 38 - 2.5 * 0.001;
    expect(await reader.sampleLngLat(lng, lat)).toBeCloseTo(200, 6);
  });

  it('never lets the raw -999999 through as a finite elevation', async () => {
    const reader = await CogReader.open(bytesReader(withHole));
    const v = await reader.sampleLngLat(-85 + 7.5 * 0.001, 38 - 7.5 * 0.001);
    expect(v).not.toBe(-999999);
    expect(isElevation(v)).toBe(false);
  });
});

describe('CogReader — overview selection', () => {
  // 64x64 at 0.001 deg (~111 m), plus two overviews at ~222 m and ~445 m.
  const pyramid = writeSyntheticTiff({
    width: 64,
    height: 64,
    tileWidth: 32,
    tileHeight: 32,
    samples: new Array(64 * 64).fill(500),
    pixelScale: [0.001, 0.001, 0],
    tiePoint: [0, 0, 0, -85, 38, 0],
    geoKeys: [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4269],
    overviews: [
      { width: 32, height: 32, samples: new Array(32 * 32).fill(500) },
      { width: 16, height: 16, samples: new Array(16 * 16).fill(500) },
    ],
  });

  it('derives a resolution for every level, including overviews', async () => {
    // Regression: GDAL writes ModelPixelScale on IFD 0 only. Reading it straight
    // off an overview returns undefined, which made `resolutionMeters` NaN, made
    // every overview score as unusable, and silently pinned rendering to full
    // resolution. Measured cost on a real 1 m tile at z13: 60 range reads and
    // 41 s, versus 2 and under a second. Nothing failed — it was just slow and
    // aliased.
    const reader = await CogReader.open(bytesReader(pyramid));
    expect(reader.directories).toHaveLength(3);
    for (let level = 0; level < 3; level++) {
      expect(Number.isFinite(reader.resolutionMeters(level))).toBe(true);
    }
    expect(reader.resolutionMeters(0)).toBeCloseTo(111.32, 2);
    expect(reader.resolutionMeters(1)).toBeCloseTo(222.64, 2);
    expect(reader.resolutionMeters(2)).toBeCloseTo(445.28, 2);
  });

  it('picks a coarser level as the target cell size grows', async () => {
    const reader = await CogReader.open(bytesReader(pyramid));
    expect(reader.chooseOverview(100)).toBe(0);
    expect(reader.chooseOverview(200)).toBe(1);
    expect(reader.chooseOverview(1000)).toBe(2);
  });

  it('never picks an overview coarser than the target', async () => {
    const reader = await CogReader.open(bytesReader(pyramid));
    // 1.5x slack is allowed by design; beyond that it must step down a level.
    const level = reader.chooseOverview(150);
    expect(reader.resolutionMeters(level)).toBeLessThanOrEqual(150 * 1.5);
  });
});

describe('CogReader — UTM raster reprojected into a Web Mercator tile', () => {
  // A plane in UTM metres: height = 300 + 0.01 * (easting - 270000).
  // Because it is planar in projected space it has a closed form we can check
  // after reprojection, which is what proves the UTM chain is not merely
  // self-consistent.
  const E0 = 270000;
  const N0 = 4050000;
  const utmPlane = (() => {
    const w = 512;
    const h = 512;
    const samples: number[] = [];
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        samples.push(300 + 0.01 * (i + 0.5) * 10);
      }
    }
    return writeSyntheticTiff({
      width: w,
      height: h,
      tileWidth: 256,
      tileHeight: 256,
      samples,
      // 10 m cells so the raster spans ~5 km, enough for a whole z15 tile.
      pixelScale: [10, 10, 0],
      tiePoint: [0, 0, 0, E0, N0, 0],
      // Projected (GTModelType 1), NAD83 / UTM 16N, PixelIsArea.
      geoKeys: [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 26916],
      noData: '-999999',
    });
  })();

  it('reports a UTM CRS and metre resolution', async () => {
    const reader = await CogReader.open(bytesReader(utmPlane));
    expect(reader.crs).toEqual({ kind: 'utm', zone: 16, north: true, epsg: 26916 });
    // Already metres: no cos(lat) factor is applied to a projected raster, which
    // is what keeps slope metrically correct after reprojection.
    expect(reader.resolutionMeters(0)).toBe(10);
  });

  it('samples through lng/lat back to the closed-form value', async () => {
    const reader = await CogReader.open(bytesReader(utmPlane));
    // Take a known UTM position, convert to lng/lat, and ask for it that way.
    // Agreement proves forward and inverse projection are consistent *and*
    // correctly wired to the raster's georeferencing.
    for (const [de, dn] of [
      [1000, -1000],
      [2500, -3000],
      [4000, -500],
    ]) {
      const { lng, lat } = utmToLngLat({
        zone: 16,
        easting: E0 + de,
        northing: N0 + dn,
        north: true,
      });
      const expected = 300 + 0.01 * de;
      expect(await reader.sampleLngLat(lng, lat)).toBeCloseTo(expected, 1);
    }
  });

  it('renders a Web Mercator tile whose cells are isotropic ground metres', async () => {
    const reader = await CogReader.open(bytesReader(utmPlane));
    const centre = utmToLngLat({ zone: 16, easting: E0 + 2560, northing: N0 - 2560, north: true });
    const n = 2 ** 15;
    const tx = Math.floor(((centre.lng + 180) / 360) * n);
    const latRad = (centre.lat * Math.PI) / 180;
    const ty = Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
    );

    const { heights, report } = await renderMercatorTileFromCog(
      reader,
      { z: 15, x: tx, y: ty },
      64,
    );
    expect(heights).toHaveLength(64 * 64);
    expect(report.coverage).toBeGreaterThan(0);

    // The surface is a plane rising eastward, so within a row every step east
    // must increase by the same amount — that constancy is what a botched
    // reprojection destroys, and it is visible as banding in a hillshade.
    const row = 32;
    const measured: number[] = [];
    for (let i = 0; i < 64; i++) {
      const v = heights[row * 64 + i];
      if (isElevation(v)) measured.push(v);
    }
    expect(measured.length).toBeGreaterThan(8);
    const steps: number[] = [];
    for (let i = 1; i < measured.length; i++) steps.push(measured[i] - measured[i - 1]);
    const mean = steps.reduce((s, v) => s + v, 0) / steps.length;
    for (const s of steps) expect(Math.abs(s - mean)).toBeLessThan(Math.abs(mean) * 0.05 + 1e-6);
  });

  it('reports coverage below 1 and NODATA cells when the tile overhangs the raster', async () => {
    const reader = await CogReader.open(bytesReader(utmPlane));
    // A tile at the north-west corner of the raster necessarily hangs off it.
    const corner = utmToLngLat({ zone: 16, easting: E0, northing: N0, north: true });
    const n = 2 ** 15;
    const tx = Math.floor(((corner.lng + 180) / 360) * n);
    const latRad = (corner.lat * Math.PI) / 180;
    const ty = Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
    );
    const { heights, report } = await renderMercatorTileFromCog(
      reader,
      { z: 15, x: tx, y: ty },
      64,
    );

    // The honesty requirement: a gap is NODATA and the report says so. It is
    // never filled from a coarser source, and it is never quietly interpolated.
    expect(report.coverage).toBeLessThan(1);
    expect(report.coverage).toBeGreaterThan(0);
    const voids = Array.from(heights).filter((v) => !isElevation(v));
    expect(voids.length).toBeGreaterThan(0);
    for (const v of voids) expect(v).toBe(NODATA);
  });
});

describe('CogReader — refusals', () => {
  it('refuses a RasterPixelIsPoint raster rather than absorbing a half-cell shift', async () => {
    const bytes = writeSyntheticTiff({
      width: 4,
      height: 4,
      samples: new Array(16).fill(1),
      pixelScale: [0.001, 0.001, 0],
      tiePoint: [0, 0, 0, -85, 38, 0],
      geoKeys: [1, 1, 0, 2, 1024, 0, 1, 2, 1025, 0, 1, 2],
    });
    await expect(CogReader.open(bytesReader(bytes))).rejects.toThrow(TiffUnsupportedError);
  });

  it('refuses a projected CRS that is not a supported UTM zone', async () => {
    const bytes = writeSyntheticTiff({
      width: 4,
      height: 4,
      samples: new Array(16).fill(1),
      pixelScale: [10, 10, 0],
      tiePoint: [0, 0, 0, 0, 0, 0],
      // EPSG:5070, CONUS Albers — a real projection we deliberately do not do.
      geoKeys: [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 5070],
    });
    await expect(CogReader.open(bytesReader(bytes))).rejects.toThrow(/not a supported UTM zone/);
  });

  it('treats a failed range read as a coverage hole, not as a crash', async () => {
    let calls = 0;
    const flaky = async (start: number, end: number): Promise<Uint8Array> => {
      calls++;
      // The header read succeeds; every tile read after it fails.
      if (calls > 1) throw new Error('network');
      return PLANE.bytes.subarray(start, Math.min(end + 1, PLANE.bytes.length));
    };
    const reader = await CogReader.open(flaky);
    expect(await reader.sampleLngLat(-85 + 0.0005, 38 - 0.0005)).toBe(NODATA);
  });
});
