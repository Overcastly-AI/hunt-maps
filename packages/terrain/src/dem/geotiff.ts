/**
 * A minimal, zero-dependency reader for the one GeoTIFF dialect USGS 3DEP ships.
 *
 * ## Why this file exists
 *
 * Every "real elevation" path that is not a pre-rendered PNG ends in a GeoTIFF.
 * USGS 3DEP's staged products (`prd-tnm.s3.amazonaws.com`) are **Cloud-Optimized
 * GeoTIFFs**: tiled, with the whole IFD chain at the front of the file and
 * power-of-two overviews after it. That layout is what makes a 485 MB, 10812²
 * one-degree DEM usable from a phone — you HTTP-range-read the ~800 KB tile you
 * actually need and nothing else.
 *
 * `packages/terrain` has zero runtime dependencies and ships into a service
 * worker, so `geotiff.js` and GDAL are both out. That is not a hardship here:
 * the format surface we must support is small and fixed, and it is enumerated
 * explicitly below. **Anything outside it throws rather than guesses** — a
 * silently mis-decoded elevation raster is exactly the "confidently wrong about
 * terrain" failure this codebase ranks worst.
 *
 * ## What is supported, and why only this
 *
 * Measured from the real files (see `geotiff.test.ts`, which decodes a committed
 * fixture cut from `USGS_13_n38w085.tif`):
 *
 * | Property        | 3DEP 1/3" and 1 m products              |
 * |-----------------|-----------------------------------------|
 * | Header          | Classic TIFF (`II*\0`), little-endian   |
 * | Organisation    | Tiled, 512x512                          |
 * | Samples         | 1 band                                  |
 * | Sample format   | IEEE float (3), 32-bit                   |
 * | Compression     | LZW (5)                                  |
 * | Predictor       | Floating-point (3)                       |
 * | NoData          | `GDAL_NODATA` ASCII tag, `-999999`       |
 *
 * BigTIFF is also parsed (some 1 m projects exceed 4 GB), as are uncompressed
 * rasters, integer samples and the horizontal predictor, because those cost a
 * few lines each and are the difference between "works" and "works until USGS
 * restages a project". Deflate/JPEG/packbits are **not** supported and throw a
 * named error: DEFLATE would mean either a dependency or a hand-rolled inflate,
 * and hand-rolling one to decode elevations nobody has validated is how you get
 * a plausible-looking wrong map.
 *
 * ## Units and sign conventions
 *
 * This module is unit-agnostic — it returns whatever the file stores. For 3DEP
 * that is **metres above NAVD88** (see `verticalDatum.ts`; the datum question is
 * load-bearing and is deliberately handled outside the decoder). Pixel (0,0) is
 * the **north-west** corner and row index increases **southward**, matching
 * `ModelTiepoint`/`ModelPixelScale` and the rest of the engine's grids.
 */

import { NODATA } from './encoding.js';

/** Compression schemes we can actually decode. Everything else throws. */
export const TIFF_COMPRESSION_NONE = 1;
export const TIFF_COMPRESSION_LZW = 5;

/** Predictors. 3 (floating point) is what GDAL writes for float DEMs. */
export const TIFF_PREDICTOR_NONE = 1;
export const TIFF_PREDICTOR_HORIZONTAL = 2;
export const TIFF_PREDICTOR_FLOAT = 3;

/** `SampleFormat` values (tag 339). */
export const SAMPLE_FORMAT_UINT = 1;
export const SAMPLE_FORMAT_INT = 2;
export const SAMPLE_FORMAT_IEEEFP = 3;

/**
 * Thrown when the byte range we were handed does not reach far enough to finish
 * parsing.
 *
 * This is not a failure — it is the normal first step of reading a remote COG.
 * You cannot know how much header a file has until you have read some of it, so
 * the fetcher asks for a guess, catches this, and re-requests `neededBytes`. The
 * alternative (parsing whatever is present and hoping) would produce a directory
 * with a truncated `TileOffsets` array, which reads as "that tile is at offset
 * 0" — a decode of the file header as though it were elevation.
 */
export class TiffTruncatedError extends Error {
  constructor(readonly neededBytes: number) {
    super(`GeoTIFF header is longer than the bytes provided; need at least ${neededBytes}.`);
    this.name = 'TiffTruncatedError';
  }
}

/** Thrown for a real file we deliberately refuse to guess at. */
export class TiffUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TiffUnsupportedError';
  }
}

/** One IFD: the full-resolution image, or one of its overviews. */
export interface TiffDirectory {
  /** File byte order. Sample bytes are read with this. */
  littleEndian: boolean;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  bitsPerSample: number;
  samplesPerPixel: number;
  sampleFormat: number;
  compression: number;
  predictor: number;
  /** Byte offset of each tile, row-major over the tile grid. */
  tileOffsets: number[];
  /** Compressed length of each tile, same order. */
  tileByteCounts: number[];
  /** `GDAL_NODATA`, already parsed to a number. `undefined` when the tag is absent. */
  noData?: number;
  /** True when this IFD is a reduced-resolution overview (tag 254 bit 0). */
  overview: boolean;
  /** `ModelPixelScale` (x, y, z) in CRS units per pixel. `y` is positive. */
  pixelScale?: [number, number, number];
  /** `ModelTiepoint` raster (i, j, k) -> model (x, y, z). */
  tiePoint?: { i: number; j: number; k: number; x: number; y: number; z: number };
  /** Parsed GeoKeys, keyed by GeoKey id. Only the short (in-directory) ones. */
  geoKeys: Map<number, number>;
}

const TAG_NEW_SUBFILE_TYPE = 254;
const TAG_IMAGE_WIDTH = 256;
const TAG_IMAGE_LENGTH = 257;
const TAG_BITS_PER_SAMPLE = 258;
const TAG_COMPRESSION = 259;
const TAG_SAMPLES_PER_PIXEL = 277;
const TAG_PLANAR_CONFIG = 284;
const TAG_PREDICTOR = 317;
const TAG_TILE_WIDTH = 322;
const TAG_TILE_LENGTH = 323;
const TAG_TILE_OFFSETS = 324;
const TAG_TILE_BYTE_COUNTS = 325;
const TAG_SAMPLE_FORMAT = 339;
const TAG_MODEL_PIXEL_SCALE = 33550;
const TAG_MODEL_TIEPOINT = 33922;
const TAG_GEO_KEY_DIRECTORY = 34735;
const TAG_GDAL_NODATA = 42113;

/** Byte width of each TIFF field type, indexed by type code. 0 = unknown. */
const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4, 0, 0, 8, 8, 8];

/**
 * Parse the IFD chain out of the leading bytes of a TIFF.
 *
 * `bytes` need only cover the header — for a COG that is a few tens of KB even
 * for a 485 MB file, which is the entire point of the format. If it does not
 * reach, this throws {@link TiffTruncatedError} with how far it needed to get,
 * rather than returning a half-parsed directory.
 */
export function parseTiff(bytes: Uint8Array): TiffDirectory[] {
  if (bytes.length < 8) throw new TiffTruncatedError(8);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const bom = (dv.getUint8(0) << 8) | dv.getUint8(1);
  let littleEndian: boolean;
  if (bom === 0x4949) littleEndian = true;
  else if (bom === 0x4d4d) littleEndian = false;
  else throw new TiffUnsupportedError('Not a TIFF: byte-order mark is neither "II" nor "MM".');

  const magic = dv.getUint16(2, littleEndian);
  const bigTiff = magic === 43;
  if (magic !== 42 && !bigTiff) {
    throw new TiffUnsupportedError(`Not a TIFF: magic number ${magic} is neither 42 nor 43.`);
  }

  const need = (end: number): void => {
    if (end > bytes.length) throw new TiffTruncatedError(end);
  };

  let nextIfd: number;
  if (bigTiff) {
    need(16);
    const offsetSize = dv.getUint16(4, littleEndian);
    if (offsetSize !== 8) {
      throw new TiffUnsupportedError(`BigTIFF offset size ${offsetSize} is not 8.`);
    }
    nextIfd = Number(dv.getBigUint64(8, littleEndian));
  } else {
    nextIfd = dv.getUint32(4, littleEndian);
  }

  /** Read `count` values of `type` starting at `offset`, as numbers. */
  const readValues = (offset: number, type: number, count: number): number[] => {
    const size = TYPE_SIZE[type] ?? 0;
    if (size === 0) throw new TiffUnsupportedError(`Unsupported TIFF field type ${type}.`);
    need(offset + size * count);
    const out = new Array<number>(count);
    for (let i = 0; i < count; i++) {
      const o = offset + i * size;
      switch (type) {
        case 1: // BYTE
        case 2: // ASCII
        case 7: // UNDEFINED
          out[i] = dv.getUint8(o);
          break;
        case 3: // SHORT
          out[i] = dv.getUint16(o, littleEndian);
          break;
        case 4: // LONG
          out[i] = dv.getUint32(o, littleEndian);
          break;
        case 5: // RATIONAL
          out[i] = dv.getUint32(o, littleEndian) / dv.getUint32(o + 4, littleEndian);
          break;
        case 6: // SBYTE
          out[i] = dv.getInt8(o);
          break;
        case 8: // SSHORT
          out[i] = dv.getInt16(o, littleEndian);
          break;
        case 9: // SLONG
          out[i] = dv.getInt32(o, littleEndian);
          break;
        case 11: // FLOAT
          out[i] = dv.getFloat32(o, littleEndian);
          break;
        case 12: // DOUBLE
          out[i] = dv.getFloat64(o, littleEndian);
          break;
        case 16: // LONG8 (BigTIFF)
          out[i] = Number(dv.getBigUint64(o, littleEndian));
          break;
        case 17: // SLONG8
          out[i] = Number(dv.getBigInt64(o, littleEndian));
          break;
        default:
          throw new TiffUnsupportedError(`Unsupported TIFF field type ${type}.`);
      }
    }
    return out;
  };

  const dirs: TiffDirectory[] = [];
  const seen = new Set<number>();

  while (nextIfd > 0) {
    // A malformed or hostile file can point an IFD at itself. Bound the walk.
    if (seen.has(nextIfd) || dirs.length > 64) break;
    seen.add(nextIfd);

    const entryCount = bigTiff
      ? (need(nextIfd + 8), Number(dv.getBigUint64(nextIfd, littleEndian)))
      : (need(nextIfd + 2), dv.getUint16(nextIfd, littleEndian));
    const entrySize = bigTiff ? 20 : 12;
    const base = nextIfd + (bigTiff ? 8 : 2);
    need(base + entryCount * entrySize + (bigTiff ? 8 : 4));

    const fields = new Map<number, number[]>();
    for (let i = 0; i < entryCount; i++) {
      const e = base + i * entrySize;
      const tag = dv.getUint16(e, littleEndian);
      const type = dv.getUint16(e + 2, littleEndian);
      const count = bigTiff
        ? Number(dv.getBigUint64(e + 4, littleEndian))
        : dv.getUint32(e + 4, littleEndian);
      const valueField = e + (bigTiff ? 12 : 8);
      const inlineCapacity = bigTiff ? 8 : 4;
      const size = TYPE_SIZE[type] ?? 0;
      if (size === 0) continue; // unknown tag type: skip, do not fail the file
      const fitsInline = size * count <= inlineCapacity;
      const valueOffset = fitsInline
        ? valueField
        : bigTiff
          ? Number(dv.getBigUint64(valueField, littleEndian))
          : dv.getUint32(valueField, littleEndian);
      fields.set(tag, readValues(valueOffset, type, count));
    }

    const first = (tag: number, fallback?: number): number => {
      const v = fields.get(tag);
      if (v === undefined || v.length === 0) {
        if (fallback !== undefined) return fallback;
        throw new TiffUnsupportedError(`GeoTIFF is missing required tag ${tag}.`);
      }
      return v[0];
    };

    const tileOffsets = fields.get(TAG_TILE_OFFSETS);
    const tileByteCounts = fields.get(TAG_TILE_BYTE_COUNTS);
    if (!tileOffsets || !tileByteCounts) {
      // Strip-organised TIFFs exist, but a strip is a full-width band of the
      // image: for a 10812-wide DEM that is a range read of the whole row set,
      // which defeats the reason we are range-reading at all. 3DEP ships tiled.
      throw new TiffUnsupportedError(
        'GeoTIFF is strip-organised, not tiled. Only tiled (Cloud-Optimized) ' +
          'GeoTIFFs are supported, because a strip read cannot be bounded.',
      );
    }

    const geoKeys = new Map<number, number>();
    const gk = fields.get(TAG_GEO_KEY_DIRECTORY);
    if (gk && gk.length >= 4) {
      const keyCount = gk[3];
      for (let i = 0; i < keyCount; i++) {
        const o = 4 + i * 4;
        if (o + 3 >= gk.length) break;
        // Only keys stored inline in the directory (TIFFTagLocation === 0) have
        // a numeric value here; the others point into GeoDoubleParams/GeoAscii,
        // which we do not need for what this reader is used for.
        if (gk[o + 1] === 0) geoKeys.set(gk[o], gk[o + 3]);
      }
    }

    const scale = fields.get(TAG_MODEL_PIXEL_SCALE);
    const tie = fields.get(TAG_MODEL_TIEPOINT);
    const nodataChars = fields.get(TAG_GDAL_NODATA);
    let noData: number | undefined;
    if (nodataChars) {
      const text = String.fromCharCode(...nodataChars)
        .replace(/\0/g, '')
        .trim();
      const parsed = Number(text);
      // "nan" is a legal GDAL_NODATA value and parses to NaN, which is also what
      // a garbage string parses to. Only trust it when the text says so.
      if (Number.isFinite(parsed)) noData = parsed;
      else if (/^nan$/i.test(text)) noData = NaN;
    }

    const planar = first(TAG_PLANAR_CONFIG, 1);
    if (planar !== 1) {
      throw new TiffUnsupportedError(
        `PlanarConfiguration ${planar} (separate planes) is not supported.`,
      );
    }

    dirs.push({
      littleEndian,
      width: first(TAG_IMAGE_WIDTH),
      height: first(TAG_IMAGE_LENGTH),
      tileWidth: first(TAG_TILE_WIDTH),
      tileHeight: first(TAG_TILE_LENGTH),
      bitsPerSample: first(TAG_BITS_PER_SAMPLE, 8),
      samplesPerPixel: first(TAG_SAMPLES_PER_PIXEL, 1),
      sampleFormat: first(TAG_SAMPLE_FORMAT, SAMPLE_FORMAT_UINT),
      compression: first(TAG_COMPRESSION, 1),
      predictor: first(TAG_PREDICTOR, TIFF_PREDICTOR_NONE),
      tileOffsets,
      tileByteCounts,
      noData,
      overview: (first(TAG_NEW_SUBFILE_TYPE, 0) & 1) === 1,
      pixelScale: scale && scale.length >= 3 ? [scale[0], scale[1], scale[2]] : undefined,
      tiePoint:
        tie && tie.length >= 6
          ? { i: tie[0], j: tie[1], k: tie[2], x: tie[3], y: tie[4], z: tie[5] }
          : undefined,
      geoKeys,
    });

    nextIfd = bigTiff
      ? Number(dv.getBigUint64(base + entryCount * entrySize, littleEndian))
      : dv.getUint32(base + entryCount * entrySize, littleEndian);
  }

  if (dirs.length === 0) throw new TiffUnsupportedError('GeoTIFF contains no image directories.');
  return dirs;
}

/** How many tiles across the tile grid is, for `tileIndex` arithmetic. */
export function tilesAcross(dir: TiffDirectory): number {
  return Math.ceil(dir.width / dir.tileWidth);
}

/** How many tiles down the tile grid is. */
export function tilesDown(dir: TiffDirectory): number {
  return Math.ceil(dir.height / dir.tileHeight);
}

/** Index into `tileOffsets`/`tileByteCounts` for a tile-grid coordinate. */
export function tileIndex(dir: TiffDirectory, tx: number, ty: number): number {
  return ty * tilesAcross(dir) + tx;
}

/**
 * TIFF LZW, decoded to bytes.
 *
 * TIFF's variant differs from GIF's in two ways that silently corrupt output if
 * you get them wrong: codes are packed **MSB-first**, and the code width grows
 * one code **early** (at 511, 1023, 2047 rather than 512, 1024, 2048). The
 * early-change rule is the classic interoperability bug here — it produces a
 * stream that decodes correctly for the first few hundred codes and then
 * desynchronises, which for a DEM looks like a tile that is right along its top
 * edge and noise below.
 */
export function lzwDecode(src: Uint8Array, expectedBytes: number): Uint8Array {
  const out = new Uint8Array(expectedBytes);
  let outPos = 0;

  const CLEAR = 256;
  const EOI = 257;

  // The dictionary is stored as (prefix code, appended byte, total length) so
  // that adding an entry is O(1) and needs no allocation. Materialising each
  // entry as its own Uint8Array is the obvious implementation and allocates
  // millions of small arrays per tile, which on a phone is the difference
  // between a pan that keeps up and one that stutters.
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const length = new Int32Array(4096);
  let next = 258;
  let width = 9;

  const reset = (): void => {
    next = 258;
    width = 9;
  };
  for (let i = 0; i < 256; i++) {
    prefix[i] = -1;
    suffix[i] = i;
    length[i] = 1;
  }
  reset();

  let bitBuf = 0;
  let bitCount = 0;
  let srcPos = 0;

  const readCode = (): number => {
    while (bitCount < width) {
      if (srcPos >= src.length) return EOI;
      bitBuf = ((bitBuf << 8) | src[srcPos++]) & 0x7fffffff;
      bitCount += 8;
    }
    bitCount -= width;
    return (bitBuf >>> bitCount) & ((1 << width) - 1);
  };

  /** Expand `code` into `out` at `pos`, walking the prefix chain backwards. */
  const emit = (code: number, pos: number): number => {
    const len = length[code];
    if (pos + len > out.length) {
      throw new TiffUnsupportedError('LZW stream expands past the expected tile size.');
    }
    let c = code;
    for (let i = len - 1; i >= 0; i--) {
      out[pos + i] = suffix[c];
      c = prefix[c];
    }
    return pos + len;
  };

  let previous = -1;
  for (;;) {
    const code = readCode();
    if (code === EOI) break;
    if (code === CLEAR) {
      reset();
      previous = -1;
      continue;
    }

    if (previous === -1) {
      // First code after a clear is always a literal.
      outPos = emit(code, outPos);
      previous = code;
    } else if (code < next) {
      const start = outPos;
      outPos = emit(code, outPos);
      if (next < 4096) {
        prefix[next] = previous;
        suffix[next] = out[start];
        length[next] = length[previous] + 1;
        next++;
      }
      previous = code;
    } else if (code === next) {
      // The KwKwK case: the encoder emitted a code it defined on this very
      // symbol. Its expansion is previous + previous[0].
      const firstByte = firstByteOf(previous, prefix, suffix);
      if (next < 4096) {
        prefix[next] = previous;
        suffix[next] = firstByte;
        length[next] = length[previous] + 1;
        next++;
      }
      outPos = emit(code, outPos);
      previous = code;
    } else {
      throw new TiffUnsupportedError(`Corrupt LZW stream: code ${code} is past the dictionary.`);
    }

    // Early change: widen one code before the table is actually full.
    if (next + 1 >= 1 << width && width < 12) width++;
  }

  if (outPos < out.length) {
    throw new TiffUnsupportedError(
      `LZW stream ended after ${outPos} of ${out.length} expected bytes.`,
    );
  }
  return out;
}

function firstByteOf(code: number, prefix: Int32Array, suffix: Uint8Array): number {
  let c = code;
  while (prefix[c] >= 0) c = prefix[c];
  return suffix[c];
}

/**
 * Undo the horizontal differencing predictor (2), in place, per row.
 *
 * Applies to integer samples only — floats use predictor 3, which is a wholly
 * different transform despite the adjacent tag value.
 */
function undoHorizontalPredictor(
  bytes: Uint8Array,
  width: number,
  rows: number,
  samplesPerPixel: number,
  bytesPerSample: number,
  littleEndian: boolean,
): void {
  const rowBytes = width * samplesPerPixel * bytesPerSample;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let row = 0; row < rows; row++) {
    const base = row * rowBytes;
    if (bytesPerSample === 1) {
      for (let i = samplesPerPixel; i < width * samplesPerPixel; i++) {
        bytes[base + i] = (bytes[base + i] + bytes[base + i - samplesPerPixel]) & 0xff;
      }
    } else if (bytesPerSample === 2) {
      for (let i = samplesPerPixel; i < width * samplesPerPixel; i++) {
        const o = base + i * 2;
        const p = o - samplesPerPixel * 2;
        dv.setUint16(
          o,
          (dv.getUint16(o, littleEndian) + dv.getUint16(p, littleEndian)) & 0xffff,
          littleEndian,
        );
      }
    } else if (bytesPerSample === 4) {
      for (let i = samplesPerPixel; i < width * samplesPerPixel; i++) {
        const o = base + i * 4;
        const p = o - samplesPerPixel * 4;
        dv.setUint32(
          o,
          (dv.getUint32(o, littleEndian) + dv.getUint32(p, littleEndian)) >>> 0,
          littleEndian,
        );
      }
    } else {
      throw new TiffUnsupportedError(
        `Horizontal predictor with ${bytesPerSample}-byte samples is not supported.`,
      );
    }
  }
}

/**
 * Undo the floating-point predictor (3), returning **big-endian** sample bytes.
 *
 * The float predictor is not "differencing on floats". libtiff splits each row
 * into *byte planes* — all the most-significant bytes of the row's samples,
 * then all the second bytes, and so on — and then horizontally differences the
 * resulting byte stream. It compresses well because the exponent bytes of a
 * smoothly-varying surface are nearly constant, which is exactly the case for a
 * DEM: it is why a 485 MB float raster compresses at all.
 *
 * Plane 0 is always the **most significant** byte, independent of the file's
 * byte-order mark, so this reassembles big-endian samples and the caller reads
 * them big-endian. That is why `readTileSamples` ignores `dir.littleEndian` for
 * predictor 3 — see the guard there, which refuses the big-endian-file case
 * outright rather than shipping an untested byte order.
 */
function undoFloatPredictor(
  bytes: Uint8Array,
  width: number,
  rows: number,
  samplesPerPixel: number,
  bytesPerSample: number,
): Uint8Array {
  const rowBytes = width * samplesPerPixel * bytesPerSample;
  const wordsPerRow = width * samplesPerPixel;
  const out = new Uint8Array(bytes.length);

  for (let row = 0; row < rows; row++) {
    const base = row * rowBytes;
    // 1. Horizontal accumulation over the row's bytes, stride = samplesPerPixel.
    for (let i = samplesPerPixel; i < rowBytes; i++) {
      bytes[base + i] = (bytes[base + i] + bytes[base + i - samplesPerPixel]) & 0xff;
    }
    // 2. De-interleave the byte planes back into whole samples, MSB first.
    for (let w = 0; w < wordsPerRow; w++) {
      for (let b = 0; b < bytesPerSample; b++) {
        out[base + w * bytesPerSample + b] = bytes[base + b * wordsPerRow + w];
      }
    }
  }
  return out;
}

/**
 * Decode one tile's compressed bytes into a Float32Array of `tileWidth *
 * tileHeight` samples.
 *
 * Values equal to the file's `GDAL_NODATA` are mapped to the engine's
 * {@link NODATA} sentinel, so the rest of the engine's `isElevation` guards work
 * unchanged. That mapping is deliberate and one-way: 3DEP's `-999999` is finite
 * and would otherwise sail through every `Number.isFinite` check as terrain a
 * thousand kilometres down, which is `R30` exactly.
 *
 * Tiles on the right/bottom edge of the image are stored full-size and padded;
 * the padding is returned as-is and it is the caller's job to ignore samples
 * outside `width`/`height`. (Cropping here would need the tile's grid position,
 * which the caller has and this function deliberately does not.)
 */
export function decodeTiffTile(dir: TiffDirectory, compressed: Uint8Array): Float32Array {
  const bytesPerSample = dir.bitsPerSample / 8;
  if (!Number.isInteger(bytesPerSample) || bytesPerSample < 1 || bytesPerSample > 8) {
    throw new TiffUnsupportedError(`BitsPerSample ${dir.bitsPerSample} is not a whole byte count.`);
  }
  if (dir.samplesPerPixel !== 1) {
    throw new TiffUnsupportedError(
      `Expected a single-band elevation raster; this file has ${dir.samplesPerPixel} bands.`,
    );
  }

  const sampleCount = dir.tileWidth * dir.tileHeight;
  const expected = sampleCount * bytesPerSample;

  let raw: Uint8Array;
  if (dir.compression === TIFF_COMPRESSION_NONE) {
    if (compressed.length < expected) throw new TiffTruncatedError(expected);
    raw = compressed.slice(0, expected);
  } else if (dir.compression === TIFF_COMPRESSION_LZW) {
    raw = lzwDecode(compressed, expected);
  } else {
    throw new TiffUnsupportedError(
      `TIFF compression ${dir.compression} is not supported. Only uncompressed (1) ` +
        `and LZW (5) are, because anything else needs a decoder this package cannot ` +
        `take a dependency on.`,
    );
  }

  return readTileSamples(dir, raw, bytesPerSample);
}

function readTileSamples(
  dir: TiffDirectory,
  raw: Uint8Array,
  bytesPerSample: number,
): Float32Array {
  let bytes = raw;
  let readLittleEndian = dir.littleEndian;

  if (dir.predictor === TIFF_PREDICTOR_HORIZONTAL) {
    undoHorizontalPredictor(
      bytes,
      dir.tileWidth,
      dir.tileHeight,
      1,
      bytesPerSample,
      dir.littleEndian,
    );
  } else if (dir.predictor === TIFF_PREDICTOR_FLOAT) {
    if (!dir.littleEndian) {
      // Every float-predictor GeoTIFF in the wild is GDAL-written and
      // little-endian; a big-endian one would exercise a byte-order path no
      // test here covers. Refusing is the honest option — a wrong guess here
      // reorders the exponent byte and yields elevations that are wrong by
      // powers of two while still looking like terrain.
      throw new TiffUnsupportedError(
        'Big-endian GeoTIFF with the floating-point predictor is not supported (untested byte order).',
      );
    }
    bytes = undoFloatPredictor(bytes, dir.tileWidth, dir.tileHeight, 1, bytesPerSample);
    readLittleEndian = false; // the predictor reassembles MSB-first
  } else if (dir.predictor !== TIFF_PREDICTOR_NONE) {
    throw new TiffUnsupportedError(`TIFF predictor ${dir.predictor} is not supported.`);
  }

  const n = dir.tileWidth * dir.tileHeight;
  const out = new Float32Array(n);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const noData = dir.noData;
  const hasNoData = noData !== undefined;

  for (let i = 0; i < n; i++) {
    const o = i * bytesPerSample;
    let v: number;
    if (dir.sampleFormat === SAMPLE_FORMAT_IEEEFP) {
      if (bytesPerSample === 4) v = dv.getFloat32(o, readLittleEndian);
      else if (bytesPerSample === 8) v = dv.getFloat64(o, readLittleEndian);
      else throw new TiffUnsupportedError(`${dir.bitsPerSample}-bit floats are not supported.`);
    } else if (dir.sampleFormat === SAMPLE_FORMAT_INT) {
      if (bytesPerSample === 1) v = dv.getInt8(o);
      else if (bytesPerSample === 2) v = dv.getInt16(o, readLittleEndian);
      else if (bytesPerSample === 4) v = dv.getInt32(o, readLittleEndian);
      else throw new TiffUnsupportedError(`${dir.bitsPerSample}-bit integers are not supported.`);
    } else {
      if (bytesPerSample === 1) v = dv.getUint8(o);
      else if (bytesPerSample === 2) v = dv.getUint16(o, readLittleEndian);
      else if (bytesPerSample === 4) v = dv.getUint32(o, readLittleEndian);
      else throw new TiffUnsupportedError(`${dir.bitsPerSample}-bit integers are not supported.`);
    }
    // NaN in the raster is void too — 1 m projects use it in place of a
    // GDAL_NODATA tag where the LiDAR had no ground returns (water, mostly).
    out[i] =
      (hasNoData && (v === noData || (Number.isNaN(noData) && Number.isNaN(v)))) || Number.isNaN(v)
        ? NODATA
        : v;
  }
  return out;
}

/**
 * Map a model (CRS) coordinate to a fractional pixel coordinate in `dir`.
 *
 * Only the axis-aligned `ModelPixelScale` + `ModelTiepoint` case is handled —
 * `ModelTransformation` (a full affine, i.e. a rotated raster) is not, and its
 * absence is checked by the caller. Every 3DEP product is north-up.
 *
 * Returned pixel coordinates are **pixel centres at integers**, and y increases
 * southward.
 */
export function modelToPixel(dir: TiffDirectory, x: number, y: number): { px: number; py: number } {
  if (!dir.pixelScale || !dir.tiePoint) {
    throw new TiffUnsupportedError(
      'GeoTIFF has no ModelPixelScale/ModelTiepoint, so its pixels cannot be georeferenced.',
    );
  }
  const [sx, sy] = dir.pixelScale;
  const t = dir.tiePoint;
  return {
    px: t.i + (x - t.x) / sx,
    py: t.j + (t.y - y) / sy,
  };
}

/** Inverse of {@link modelToPixel}: the model coordinate of a pixel centre. */
export function pixelToModel(dir: TiffDirectory, px: number, py: number): { x: number; y: number } {
  if (!dir.pixelScale || !dir.tiePoint) {
    throw new TiffUnsupportedError(
      'GeoTIFF has no ModelPixelScale/ModelTiepoint, so its pixels cannot be georeferenced.',
    );
  }
  const [sx, sy] = dir.pixelScale;
  const t = dir.tiePoint;
  return { x: t.x + (px - t.i) * sx, y: t.y - (py - t.j) * sy };
}
