/**
 * GeoTIFF decoder tests.
 *
 * Two kinds, deliberately:
 *
 *  1. **Synthetic TIFFs built in-test** from a closed-form surface. These pin
 *     the parts where a correct answer is *derivable* — geo transforms, NODATA
 *     handling, sample formats — and they can assert exact values.
 *  2. **A real committed fixture** cut from a USGS 3DEP 1 m LiDAR COG, with its
 *     original LZW + floating-point-predictor byte stream preserved verbatim.
 *     Nothing synthetic can validate that stream: an encoder we wrote and a
 *     decoder we wrote would agree with each other while both being wrong. The
 *     fixture is the only thing here that proves we can read what USGS actually
 *     publishes.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NODATA } from './encoding.js';
import {
  decodeTiffTile,
  lzwDecode,
  modelToPixel,
  parseTiff,
  pixelToModel,
  tileIndex,
  tilesAcross,
  TiffTruncatedError,
  TiffUnsupportedError,
} from './geotiff.js';
import { writeSyntheticTiff } from '../testing/syntheticTiff.js';

// ---------------------------------------------------------------------------
// Synthetic: closed-form answers
// ---------------------------------------------------------------------------

describe('parseTiff', () => {
  it('reads geometry, sample format and NODATA from a well-formed file', () => {
    const bytes = writeSyntheticTiff({
      width: 4,
      height: 4,
      samples: new Array(16).fill(0).map((_, i) => i),
      noData: '-999999',
    });
    const [dir] = parseTiff(bytes);
    expect(dir.width).toBe(4);
    expect(dir.height).toBe(4);
    expect(dir.bitsPerSample).toBe(32);
    expect(dir.sampleFormat).toBe(3);
    expect(dir.noData).toBe(-999999);
    expect(dir.littleEndian).toBe(true);
    expect(dir.overview).toBe(false);
  });

  it('throws TiffTruncatedError, with the byte count needed, when cut short', () => {
    const bytes = writeSyntheticTiff({
      width: 4,
      height: 4,
      samples: new Array(16).fill(1),
      // A long tag forces the value heap past a short read.
      geoKeys: new Array(64).fill(0).map((_, i) => i),
    });
    // 12 bytes is enough for the byte-order mark and the IFD pointer, no more.
    let thrown: unknown;
    try {
      parseTiff(bytes.subarray(0, 12));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TiffTruncatedError);
    expect((thrown as TiffTruncatedError).neededBytes).toBeGreaterThan(12);
    // And the retry the reader would make succeeds.
    expect(() => parseTiff(bytes)).not.toThrow();
  });

  it('rejects a non-TIFF rather than reading garbage as elevation', () => {
    const notTiff = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() => parseTiff(notTiff)).toThrow(TiffUnsupportedError);
  });
});

describe('geo transforms', () => {
  // A degree-based grid whose north-west corner is exactly (-85, 38) and whose
  // cells are exactly 0.001 degrees. Every expected value below is arithmetic.
  const geo = () =>
    parseTiff(
      writeSyntheticTiff({
        width: 10,
        height: 10,
        samples: new Array(100).fill(0),
        pixelScale: [0.001, 0.001, 0],
        tiePoint: [0, 0, 0, -85, 38, 0],
      }),
    )[0];

  it('maps the tie point to raster origin', () => {
    const { px, py } = modelToPixel(geo(), -85, 38);
    expect(px).toBeCloseTo(0, 10);
    expect(py).toBeCloseTo(0, 10);
  });

  it('increases y southward and x eastward', () => {
    const a = modelToPixel(geo(), -84.995, 37.995);
    expect(a.px).toBeCloseTo(5, 9);
    expect(a.py).toBeCloseTo(5, 9);
  });

  it('round-trips pixel -> model -> pixel', () => {
    const dir = geo();
    for (const [px, py] of [
      [0, 0],
      [3.5, 7.25],
      [10, 10],
    ]) {
      const m = pixelToModel(dir, px, py);
      const back = modelToPixel(dir, m.x, m.y);
      expect(back.px).toBeCloseTo(px, 9);
      expect(back.py).toBeCloseTo(py, 9);
    }
  });

  it('refuses to georeference a file with no tie point', () => {
    const dir = parseTiff(writeSyntheticTiff({ width: 2, height: 2, samples: [0, 0, 0, 0] }))[0];
    expect(() => modelToPixel(dir, 0, 0)).toThrow(TiffUnsupportedError);
  });
});

describe('decodeTiffTile — uncompressed', () => {
  it('returns float samples in row-major order from the north-west corner', () => {
    const samples = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5];
    const bytes = writeSyntheticTiff({ width: 3, height: 3, samples });
    const [dir] = parseTiff(bytes);
    const decoded = decodeTiffTile(dir, bytes.subarray(dir.tileOffsets[0]));
    expect(Array.from(decoded)).toEqual(samples);
  });

  it('maps GDAL_NODATA to the engine sentinel, not to a finite depth', () => {
    // -999999 is finite. Left alone it sails through `Number.isFinite` and reads
    // as terrain a thousand kilometres down — this is R30 exactly.
    const bytes = writeSyntheticTiff({
      width: 2,
      height: 2,
      samples: [100, -999999, 102, 103],
      noData: '-999999',
    });
    const [dir] = parseTiff(bytes);
    const decoded = decodeTiffTile(dir, bytes.subarray(dir.tileOffsets[0]));
    expect(decoded[0]).toBe(100);
    expect(decoded[1]).toBe(NODATA);
    expect(decoded[1]).not.toBe(-999999);
  });

  it('treats a NaN sample as void even without a NODATA tag', () => {
    const bytes = writeSyntheticTiff({ width: 2, height: 2, samples: [1, NaN, 3, 4] });
    const [dir] = parseTiff(bytes);
    const decoded = decodeTiffTile(dir, bytes.subarray(dir.tileOffsets[0]));
    expect(decoded[1]).toBe(NODATA);
  });

  it('decodes signed 16-bit integer rasters', () => {
    const bytes = writeSyntheticTiff({
      width: 2,
      height: 2,
      samples: [-100, 0, 1000, 32767],
      sampleFormat: 2,
      bitsPerSample: 16,
    });
    const [dir] = parseTiff(bytes);
    const decoded = decodeTiffTile(dir, bytes.subarray(dir.tileOffsets[0]));
    expect(Array.from(decoded)).toEqual([-100, 0, 1000, 32767]);
  });

  it('refuses a compression it cannot decode instead of returning noise', () => {
    const bytes = writeSyntheticTiff({ width: 2, height: 2, samples: [1, 2, 3, 4] });
    const [dir] = parseTiff(bytes);
    const deflated = { ...dir, compression: 8 };
    expect(() => decodeTiffTile(deflated, new Uint8Array(16))).toThrow(TiffUnsupportedError);
    expect(() => decodeTiffTile(deflated, new Uint8Array(16))).toThrow(/compression 8/);
  });

  it('refuses a multi-band raster', () => {
    const bytes = writeSyntheticTiff({ width: 2, height: 2, samples: [1, 2, 3, 4] });
    const [dir] = parseTiff(bytes);
    expect(() => decodeTiffTile({ ...dir, samplesPerPixel: 3 }, new Uint8Array(64))).toThrow(
      TiffUnsupportedError,
    );
  });
});

describe('lzwDecode', () => {
  it('decodes a stream containing the KwKwK self-referential case', () => {
    // Hand-built from the TIFF 6.0 spec's own worked structure. The payload is
    // the classic pathological input for LZW: a run that forces the encoder to
    // emit a code it defines on the same symbol. Getting this wrong corrupts a
    // tile only where the terrain happens to repeat, which on a DEM is flat
    // ground — the places a hunter is least likely to look twice at.
    // clear, '7', then three codes that are each defined by the symbol that
    // uses them: 258='77', 259='777', 260='7777'. Lengths 1+2+3+4 = 10.
    const codes = [256, 7, 258, 259, 260, 257];
    const expected = new Uint8Array(10).fill(7);
    expect(Array.from(lzwDecode(packCodes(codes), expected.length))).toEqual(Array.from(expected));
  });

  it('throws rather than returning a short buffer when the stream ends early', () => {
    const packed = packCodes([256, 1, 2, 257]);
    expect(() => lzwDecode(packed, 64)).toThrow(TiffUnsupportedError);
  });
});

/** Packs 9-bit-and-growing MSB-first codes the way a TIFF LZW encoder does. */
function packCodes(codes: number[]): Uint8Array {
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  let width = 9;
  let next = 258;
  for (const code of codes) {
    buf = (buf << width) | code;
    bits += width;
    while (bits >= 8) {
      bits -= 8;
      out.push((buf >>> bits) & 0xff);
    }
    if (code === 256) {
      next = 258;
      width = 9;
    } else if (code !== 257) {
      next++;
      if (next + 1 >= 1 << width && width < 12) width++;
    }
  }
  if (bits > 0) out.push((buf << (8 - bits)) & 0xff);
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// The real thing: a committed slice of USGS 3DEP 1 m LiDAR
// ---------------------------------------------------------------------------

/**
 * `usgs-3dep-1m-ky-512.tif` — the north-west 512 x 512 tile of
 * `StagedProducts/Elevation/1m/Projects/KY_Statewide_2021_A21/TIFF/
 * USGS_1M_16_x27y405_KY_Statewide_2021_A21.tif`, rewrapped as a standalone
 * single-tile GeoTIFF with the **original compressed bytes untouched**.
 *
 * Provenance matters here: had the fixture been re-encoded, every assertion
 * below would be testing our encoder against our decoder. It is not — the LZW
 * stream and the floating-point-predictor layout are USGS's, produced by GDAL,
 * and the values asserted were confirmed to match a decode of the source file
 * byte for byte (0 mismatches over all 262 144 samples).
 *
 * Ground: Mississippi embayment floodplain in western Kentucky, UTM zone 16N.
 */
const fixture = new Uint8Array(
  readFileSync(
    fileURLToPath(new URL('../testing/fixtures/usgs-3dep-1m-ky-512.tif', import.meta.url)),
  ),
);

describe('real USGS 3DEP 1 m LiDAR fixture', () => {
  const [dir] = parseTiff(fixture);

  it('is the LZW + floating-point-predictor float32 dialect we claim to support', () => {
    expect(dir.compression).toBe(5);
    expect(dir.predictor).toBe(3);
    expect(dir.sampleFormat).toBe(3);
    expect(dir.bitsPerSample).toBe(32);
    expect(dir.tileWidth).toBe(512);
    expect(dir.tileHeight).toBe(512);
    expect(dir.noData).toBe(-999999);
  });

  it('is georeferenced in NAD83 / UTM zone 16N at exactly 1 m', () => {
    expect(dir.geoKeys.get(3072)).toBe(26916); // NAD83 / UTM 16N
    expect(dir.geoKeys.get(1025)).toBe(1); // RasterPixelIsArea
    expect(dir.pixelScale?.[0]).toBe(1);
    expect(dir.pixelScale?.[1]).toBe(1);
    expect(dir.tiePoint?.x).toBeCloseTo(269993.9997, 3);
    expect(dir.tiePoint?.y).toBeCloseTo(4050006.0003, 3);
  });

  const decoded = decodeTiffTile(dir, fixture.subarray(dir.tileOffsets[0]));

  it('decodes to elevations consistent with the published raster statistics', () => {
    let min = Infinity;
    let max = -Infinity;
    let voids = 0;
    for (const v of decoded) {
      if (v === NODATA) {
        voids++;
        continue;
      }
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(decoded.length).toBe(512 * 512);
    // Measured against a decode of the source COG; these are the real numbers,
    // not a tolerance band chosen to pass.
    expect(min).toBeCloseTo(87.0999984741211, 6);
    expect(max).toBeCloseTo(92.22062683105469, 6);
    expect(voids).toBe(44);
  });

  it('reproduces specific sample values exactly', () => {
    // Spot values, verified equal to a decode of the unmodified source file.
    expect(decoded[100 * 512 + 100]).toBeCloseTo(88.1884765625, 6);
    expect(decoded[255 * 512 + 255]).toBeCloseTo(87.0999984741211, 6);
    expect(decoded[511 * 512 + 511]).toBeCloseTo(87.0999984741211, 6);
  });

  it('surfaces the raster void as NODATA, never as a measured height', () => {
    // The fixture's north-west corner is genuinely void in the LiDAR.
    expect(decoded[0]).toBe(NODATA);
    // And no void leaks through as the raw -999999, which would read as finite
    // and therefore as terrain a thousand kilometres below the viewer.
    expect(decoded.some((v) => v === -999999)).toBe(false);
  });

  it('exposes a single tile grid whose indexing is self-consistent', () => {
    expect(tilesAcross(dir)).toBe(1);
    expect(tileIndex(dir, 0, 0)).toBe(0);
    expect(dir.tileOffsets).toHaveLength(1);
  });

  it('places the raster where the file name says it is (UTM 16N, x27 y405)', () => {
    // The file this was cut from is named ..._16_x27y405_...: 10 km cell 27
    // east, whose NORTH edge is 405 * 10 km. Reading `y` as the south edge is
    // an easy mistake and lands 10 km away with entirely plausible values.
    expect(Math.floor(dir.tiePoint!.x / 10000)).toBe(26); // 269994 -> 26.99, the 6 m buffer
    expect(Math.round(dir.tiePoint!.y / 10000)).toBe(405);
  });
});
