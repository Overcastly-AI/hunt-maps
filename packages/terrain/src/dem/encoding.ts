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
