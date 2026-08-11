/**
 * DEM raster encodings.
 *
 * Elevation is shipped over the wire as RGB(A) PNG tiles. Two encodings dominate:
 *
 *  - **Terrarium** (Mapzen / AWS "elevation-tiles-prod", free and public):
 *      h = (R * 256 + G + B / 256) - 32768
 *  - **Terrain-RGB** (Mapbox / MapTiler style):
 *      h = -10000 + (R * 65536 + G * 256 + B) * 0.1
 *
 * Both are lossless-ish integer encodings; Terrarium resolves to 1/256 m and
 * Terrain-RGB to 0.1 m. We decode to Float32 metres and never round-trip.
 */

export type DemEncoding = 'terrarium' | 'terrain-rgb';

/** Sentinel used for "no data" cells throughout the engine. */
export const NODATA = -32768;

/**
 * Does this sample carry a real elevation?
 *
 * **Use this, never a bare `Number.isFinite`.** `NODATA` is `-32768`, which *is*
 * finite, so `Number.isFinite(z)` happily accepts a cell that was never written
 * and treats it as terrain 33 km below the viewer — the most "open" value the
 * encoding can represent. Three horizon operators guarded their ray-march that
 * way and therefore reported full sky, zero shelter and full sun wherever their
 * inputs ran out, silently (BACKLOG `R30`). Nothing crashed; the map was just
 * confidently wrong, which is the failure class this product ranks worst.
 *
 * The `> NODATA + 1` form (rather than `!== NODATA`) is deliberate and matches
 * the rest of `grid.ts`: elevations round-trip through Float32 and through
 * bilinear resampling, so the sentinel arrives as `-32768.000004` about as often
 * as it arrives exact. The margin also rejects anything below −32767 m, which no
 * point on Earth or in its oceans reaches.
 */
export function isElevation(z: number): boolean {
  return Number.isFinite(z) && z > NODATA + 1;
}

/** Decode a single pixel to metres. */
export function decodePixel(r: number, g: number, b: number, encoding: DemEncoding): number {
  if (encoding === 'terrarium') {
    return r * 256 + g + b / 256 - 32768;
  }
  return -10000 + (r * 65536 + g * 256 + b) * 0.1;
}

/** Encode metres back to an RGB triple (used by tests and by the tile baker). */
export function encodePixel(height: number, encoding: DemEncoding): [number, number, number] {
  if (encoding === 'terrarium') {
    const v = Math.max(0, Math.min(65535.99609375, height + 32768));
    const r = Math.floor(v / 256);
    const g = Math.floor(v - r * 256);
    const b = Math.round((v - r * 256 - g) * 256) & 0xff;
    return [r, g, b];
  }
  const v = Math.max(0, Math.round((height + 10000) * 10));
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/**
 * Encode a height field into RGBA bytes, ready to be written as a PNG tile.
 *
 * The inverse of {@link decodeRgbaToHeights}, and the piece that lets the API
 * serve real 3DEP COG data through the same PNG tile pipeline the browser and
 * the offline store already speak.
 *
 * ## NODATA travels as alpha = 0, and this is not cosmetic
 *
 * Both encodings are unsigned and clamped at their low end: `encodePixel` maps
 * anything at or below the floor to black. So a `NODATA` cell (-32768) encodes
 * to RGB (0,0,0), which decodes back as **-10000 m** under `terrain-rgb` and
 * **-32768 m** under `terrarium` — a finite number that sails past every
 * `Number.isFinite` guard and reads as ground 10 km below the viewer. That is
 * exactly the `R30` failure class: a void silently becoming the most "open"
 * terrain the encoding can express, so every horizon operator reports full sky
 * and zero shelter over it.
 *
 * Writing alpha = 0 instead is what `decodeRgbaToHeights` already looks for on
 * the way back in, so a void survives the round trip *as a void*. Measured
 * cells get alpha = 255.
 */
export function encodeHeightsToRgba(
  heights: Float32Array,
  encoding: DemEncoding,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(heights.length * 4);
  for (let i = 0; i < heights.length; i++) {
    const o = i * 4;
    const h = heights[i];
    if (!isElevation(h)) {
      // RGB left at 0 deliberately; alpha is what carries the meaning.
      out[o + 3] = 0;
      continue;
    }
    const [r, g, b] = encodePixel(h, encoding);
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  }
  return out;
}

/**
 * Decode an RGBA byte buffer (e.g. from `ImageData` or `sharp().raw()`) into a
 * Float32Array of metres.
 *
 * Fully-transparent pixels are treated as no-data — AWS Terrarium uses alpha=0
 * for ocean/void in some regions.
 */
export function decodeRgbaToHeights(
  rgba: Uint8Array | Uint8ClampedArray,
  encoding: DemEncoding,
): Float32Array {
  const n = rgba.length / 4;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (rgba[o + 3] === 0) {
      out[i] = NODATA;
      continue;
    }
    out[i] = decodePixel(rgba[o], rgba[o + 1], rgba[o + 2], encoding);
  }
  return out;
}
