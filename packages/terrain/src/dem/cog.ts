/**
 * Reading elevation out of a remote Cloud-Optimized GeoTIFF, one range request
 * at a time.
 *
 * ## Why a COG at all
 *
 * The alternative ways to get real USGS 3DEP heights are a rendered PNG tile
 * service (which is what we are trying to stop relying on) or an ArcGIS
 * ImageServer `exportImage` call (which returns a server-side resample and needs
 * that server to be reachable). A COG needs nothing but a plain HTTP server that
 * honours `Range:` — which S3 does — and it hands back the *authoritative*
 * bytes, not somebody's resample of them.
 *
 * A USGS one-degree 1/3-arc-second cell is a 10812 x 10812 float raster, 485 MB.
 * Reading a 512 x 512 patch of it costs an 8 KB header read plus one ~800 KB
 * tile read. That ratio is the entire reason this approach is viable on a phone.
 *
 * ## What this class does and does not own
 *
 * It owns: overview selection, tile-set planning, decode caching, reprojection
 * and NODATA propagation. It owns **no I/O** — the caller supplies a
 * `readRange` function. That is what lets the identical code run against `fetch`
 * in a service worker, against a Node HTTP client on the API, and against a
 * `Uint8Array` of a committed fixture in the tests, which is how the tests can
 * assert real elevations without a network.
 *
 * ## Coverage is never silently degraded
 *
 * Every path that cannot produce a measured height returns {@link NODATA}:
 * outside the raster, inside a `GDAL_NODATA` void, or over a tile whose fetch
 * failed. It is never filled from a coarser source and never interpolated
 * across a void from valid neighbours. A hunter who is outside 1 m LiDAR
 * coverage must see "no data here", not a smooth surface invented from 10 m
 * data — that is the resolution-flavoured version of `R8`, and the reason
 * {@link CogSampleReport} exists is so the caller can *say* which source
 * actually answered.
 */

import { NODATA, isElevation } from './encoding.js';
import {
  decodeTiffTile,
  modelToPixel,
  parseTiff,
  pixelToModel,
  tileIndex,
  tilesAcross,
  TiffTruncatedError,
  TiffUnsupportedError,
  type TiffDirectory,
} from './geotiff.js';
import { lngLatToUtm, utmToLngLat, utmZoneFromEpsg } from './projection.js';
import type { VerticalDatum } from './verticalDatum.js';

/** GeoKey ids we interpret. */
const GEOKEY_MODEL_TYPE = 1024;
const GEOKEY_RASTER_TYPE = 1025;
const GEOKEY_GEOGRAPHIC_CRS = 2048;
const GEOKEY_PROJECTED_CRS = 3072;

const MODEL_TYPE_PROJECTED = 1;
const MODEL_TYPE_GEOGRAPHIC = 2;
const RASTER_PIXEL_IS_AREA = 1;

/** The coordinate reference systems 3DEP products actually use. */
export type CogCrs =
  | { kind: 'geographic'; epsg: number }
  | { kind: 'utm'; zone: number; north: boolean; epsg: number };

/** Reads `[start, end]` inclusive. Rejecting is treated as a coverage hole. */
export type RangeReader = (start: number, endInclusive: number) => Promise<Uint8Array>;

/** What a sample or a rendered tile actually came from. */
export interface CogSampleReport {
  /** Ground sample distance of the IFD used, in metres. */
  resolutionMeters: number;
  /** Which IFD answered: 0 is full resolution, higher is a coarser overview. */
  overviewLevel: number;
  /** Fraction of requested output cells that got a measured height, 0..1. */
  coverage: number;
}

/**
 * First guess at how many header bytes to read.
 *
 * Measured against the real products: a 1/3-arc-second cell's full IFD chain
 * fits in 8 KB, a 1 m tile's in 16 KB. 32 KB therefore lands in one request for
 * everything we ship, and {@link TiffTruncatedError} makes a second request
 * correct rather than merely slower when it does not.
 */
export const COG_HEADER_PROBE_BYTES = 32768;

function crsFromGeoKeys(dir: TiffDirectory): CogCrs {
  const modelType = dir.geoKeys.get(GEOKEY_MODEL_TYPE);
  const rasterType = dir.geoKeys.get(GEOKEY_RASTER_TYPE);
  if (rasterType !== undefined && rasterType !== RASTER_PIXEL_IS_AREA) {
    // PixelIsPoint shifts every coordinate by half a cell — 5 m at 1/3", which
    // is half a tree. Refuse rather than absorb the offset silently.
    throw new TiffUnsupportedError(
      'GeoTIFF declares RasterPixelIsPoint; only PixelIsArea rasters are supported.',
    );
  }
  if (modelType === MODEL_TYPE_GEOGRAPHIC) {
    return { kind: 'geographic', epsg: dir.geoKeys.get(GEOKEY_GEOGRAPHIC_CRS) ?? 4326 };
  }
  if (modelType === MODEL_TYPE_PROJECTED) {
    const epsg = dir.geoKeys.get(GEOKEY_PROJECTED_CRS);
    const zone = epsg === undefined ? undefined : utmZoneFromEpsg(epsg);
    if (epsg === undefined || zone === undefined) {
      throw new TiffUnsupportedError(
        `Projected GeoTIFF uses EPSG:${epsg ?? '?'}, which is not a supported UTM zone. ` +
          `Only NAD83/WGS84 UTM north zones are, because those are what 3DEP publishes.`,
      );
    }
    return { kind: 'utm', zone, north: true, epsg };
  }
  throw new TiffUnsupportedError(
    `GeoTIFF GTModelType ${modelType ?? 'absent'} is neither geographic nor projected.`,
  );
}

export interface CogReaderOptions {
  /**
   * Vertical datum of the values in this file. Not derivable from the GeoTIFF
   * in practice — 3DEP's vertical CRS is recorded in the sidecar metadata, not
   * the GeoKeys — so the caller states it and {@link assertSameVerticalDatum}
   * enforces it downstream. Defaults to orthometric, which is what every USGS
   * product is.
   */
  verticalDatum?: VerticalDatum;
  /** Cap on decoded tiles held in memory. A 512² float tile is 1 MB. */
  maxCachedTiles?: number;
}

/**
 * A remote COG, opened and ready to sample.
 *
 * Construct with {@link CogReader.open}, which does the header read (and the
 * one retry that a too-small first guess needs).
 */
export class CogReader {
  private readonly cache = new Map<string, Float32Array>();
  private readonly inflight = new Map<string, Promise<Float32Array | undefined>>();
  readonly crs: CogCrs;
  readonly verticalDatum: VerticalDatum;
  private readonly maxCachedTiles: number;

  private constructor(
    readonly directories: TiffDirectory[],
    private readonly readRange: RangeReader,
    options: CogReaderOptions,
  ) {
    this.crs = crsFromGeoKeys(directories[0]);
    this.verticalDatum = options.verticalDatum ?? 'orthometric';
    this.maxCachedTiles = options.maxCachedTiles ?? 24;
  }

  static async open(readRange: RangeReader, options: CogReaderOptions = {}): Promise<CogReader> {
    let want = COG_HEADER_PROBE_BYTES;
    // Bounded: each iteration must at least double, so this cannot spin. Four
    // rounds reaches 512 KB, far past any plausible IFD chain; past that the
    // file is not a COG (its header is not at the front) and saying so beats
    // paging in an arbitrary amount of a 485 MB file.
    for (let attempt = 0; attempt < 4; attempt++) {
      const head = await readRange(0, want - 1);
      try {
        return new CogReader(parseTiff(head), readRange, options);
      } catch (err) {
        if (err instanceof TiffTruncatedError && err.neededBytes > head.length) {
          want = Math.max(err.neededBytes, want * 2);
          continue;
        }
        throw err;
      }
    }
    throw new TiffUnsupportedError(
      'GeoTIFF header did not fit in 512 KB; this file is not cloud-optimized ' +
        '(its directories are not at the front) and cannot be range-read.',
    );
  }

  /** Full-resolution image dimensions. */
  get width(): number {
    return this.directories[0].width;
  }
  get height(): number {
    return this.directories[0].height;
  }

  /** Model (CRS) coordinate for a lng/lat, in this file's CRS. */
  modelFromLngLat(lng: number, lat: number): { x: number; y: number } {
    if (this.crs.kind === 'geographic') return { x: lng, y: lat };
    const u = lngLatToUtm(lng, lat, this.crs.zone);
    return { x: u.easting, y: u.northing };
  }

  /** Inverse of {@link modelFromLngLat}. */
  lngLatFromModel(x: number, y: number): { lng: number; lat: number } {
    if (this.crs.kind === 'geographic') return { lng: x, lat: y };
    return utmToLngLat({ zone: this.crs.zone, easting: x, northing: y, north: this.crs.north });
  }

  /**
   * Ground sample distance of an IFD, in metres, at a given latitude.
   *
   * For a projected file the pixel scale is already metres. For a geographic
   * one it is degrees, and a degree of longitude shrinks as `cos(lat)` — so
   * this reports the **north–south** size, which is the one that does not vary.
   * That choice matters: overview selection uses this number, and using the
   * east–west size would pick a coarser overview than needed at high latitude.
   */
  resolutionMeters(level: number): number {
    // Must go through `georeferencedDir`, not `directories[level].pixelScale`.
    // GDAL writes ModelPixelScale on IFD 0 only, so reading it directly off an
    // overview yields `undefined`. When that produced a NaN here, every
    // overview scored as unusable, `chooseOverview` silently fell back to full
    // resolution, and a zoomed-out tile took 60 range reads and 41 seconds
    // instead of 2 and under one — measured, not hypothesised.
    const scale = this.georeferencedDir(level).pixelScale;
    if (!scale) return NaN;
    if (this.crs.kind === 'utm') return scale[1];
    return scale[1] * 111320;
  }

  /**
   * The coarsest IFD still at least as fine as `targetMeters`.
   *
   * Rendering a zoomed-out tile from full resolution is not merely slow, it is
   * *wrong* in a specific way: point-sampling a 1 m raster at 30 m spacing
   * aliases, and aliased elevation turns into aliased slope, which shows up as
   * a shimmer of fake micro-benches that move when you pan. The overviews were
   * built with proper averaging; use them.
   */
  chooseOverview(targetMeters: number): number {
    let best = 0;
    for (let i = 0; i < this.directories.length; i++) {
      const res = this.resolutionMeters(i);
      if (!Number.isFinite(res)) continue;
      if (res <= targetMeters * 1.5) best = i;
      else break;
    }
    return best;
  }

  /**
   * Georeferencing for an overview.
   *
   * Overview IFDs carry no `ModelPixelScale`/`ModelTiepoint` of their own — GDAL
   * writes them only on IFD 0 — so they are derived from the full-resolution
   * directory by the width ratio. Deriving rather than assuming a factor of two
   * matters because the ratio is *not* exactly two: 10812 -> 5406 is, but
   * 10012 -> 5006 -> 2503 -> 1251 is not, and a hard-coded 2 would walk the
   * georeferencing off by a growing fraction of a pixel at each level.
   */
  private georeferencedDir(level: number): TiffDirectory {
    const base = this.directories[0];
    const dir = this.directories[level];
    if (dir.pixelScale && dir.tiePoint) return dir;
    if (!base.pixelScale || !base.tiePoint) {
      throw new TiffUnsupportedError('GeoTIFF has no georeferencing on its first directory.');
    }
    const fx = base.width / dir.width;
    const fy = base.height / dir.height;
    return {
      ...dir,
      pixelScale: [base.pixelScale[0] * fx, base.pixelScale[1] * fy, base.pixelScale[2]],
      tiePoint: base.tiePoint,
    };
  }

  /** Decode one TIFF tile, memoised. `undefined` when the fetch failed. */
  private async tile(level: number, tx: number, ty: number): Promise<Float32Array | undefined> {
    const key = `${level}/${tx}/${ty}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const running = this.inflight.get(key);
    if (running) return running;

    const dir = this.directories[level];
    const idx = tileIndex(dir, tx, ty);
    const offset = dir.tileOffsets[idx];
    const length = dir.tileByteCounts[idx];
    if (offset === undefined || length === undefined || length === 0) {
      // A zero-length tile is how GDAL records a wholly-empty block in a sparse
      // COG. It is genuinely absent data, not an error.
      return undefined;
    }

    const job = this.readRange(offset, offset + length - 1)
      .then((bytes) => {
        const samples = decodeTiffTile(dir, bytes);
        if (this.cache.size >= this.maxCachedTiles) {
          const oldest = this.cache.keys().next().value;
          if (oldest !== undefined) this.cache.delete(oldest);
        }
        this.cache.set(key, samples);
        return samples;
      })
      // A failed range read is a coverage hole, not a crash: one bad tile must
      // not blank a whole layer. It reads as NODATA below, which is honest.
      .catch(() => undefined)
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, job);
    return job;
  }

  /**
   * Sample one lng/lat. Returns {@link NODATA} outside coverage.
   *
   * Bilinear, but **gated on the containing cell**: if the cell the point falls
   * in is void, the answer is void, even when its neighbours are not. Without
   * that gate, interpolation would quietly extend a LiDAR project's footprint by
   * a cell in every direction and invent ground at the edge of a river or the
   * boundary of a survey — small, plausible, and fabricated.
   */
  async sampleLngLat(lng: number, lat: number, level = 0): Promise<number> {
    const dir = this.georeferencedDir(level);
    const model = this.modelFromLngLat(lng, lat);
    const { px, py } = modelToPixel(dir, model.x, model.y);
    return this.samplePixel(dir, level, px, py);
  }

  private async samplePixel(
    dir: TiffDirectory,
    level: number,
    px: number,
    py: number,
  ): Promise<number> {
    // `modelToPixel` returns coordinates where integers are pixel *corners*
    // (RasterPixelIsArea, checked in `crsFromGeoKeys`). Cell centres are at
    // +0.5, so the continuous coordinate for interpolation is px - 0.5.
    const cx = Math.floor(px);
    const cy = Math.floor(py);
    if (cx < 0 || cy < 0 || cx >= dir.width || cy >= dir.height) return NODATA;

    const fx = px - 0.5;
    const fy = py - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const wx = fx - x0;
    const wy = fy - y0;

    const need: Array<[number, number]> = [
      [x0, y0],
      [x0 + 1, y0],
      [x0, y0 + 1],
      [x0 + 1, y0 + 1],
    ];
    const values = await Promise.all(need.map(([x, y]) => this.readSample(dir, level, x, y)));

    // The gate: the containing cell must itself be measured.
    if (!isElevation(await this.readSample(dir, level, cx, cy))) return NODATA;

    let sum = 0;
    let weight = 0;
    const weights = [(1 - wx) * (1 - wy), wx * (1 - wy), (1 - wx) * wy, wx * wy];
    for (let i = 0; i < 4; i++) {
      if (!isElevation(values[i])) continue;
      sum += values[i] * weights[i];
      weight += weights[i];
    }
    return weight > 0 ? sum / weight : NODATA;
  }

  private async readSample(
    dir: TiffDirectory,
    level: number,
    x: number,
    y: number,
  ): Promise<number> {
    if (x < 0 || y < 0 || x >= dir.width || y >= dir.height) return NODATA;
    const tx = Math.floor(x / dir.tileWidth);
    const ty = Math.floor(y / dir.tileHeight);
    const samples = await this.tile(level, tx, ty);
    if (!samples) return NODATA;
    return samples[(y - ty * dir.tileHeight) * dir.tileWidth + (x - tx * dir.tileWidth)];
  }

  /**
   * Resample an area of this COG onto a regular lng/lat-addressed output grid.
   *
   * `lngLatAt(i, j)` maps an output cell to geography, which is what keeps this
   * agnostic about the output projection: the Web Mercator tile renderer in
   * `mercatorFromCog.ts` passes a Mercator inverse, and a test can pass a plain
   * linear ramp and check against a closed form.
   *
   * The two-pass structure — plan the TIFF tiles, fetch them, then sample — is
   * not an optimisation, it is the difference between one batched set of range
   * requests and one request per output pixel. 65 536 sequential HTTPS requests
   * would take hours; the batch takes one round trip per TIFF tile touched.
   */
  async resample(
    width: number,
    height: number,
    lngLatAt: (i: number, j: number) => { lng: number; lat: number },
    targetMeters: number,
  ): Promise<{ heights: Float32Array; report: CogSampleReport }> {
    const level = this.chooseOverview(targetMeters);
    const dir = this.georeferencedDir(level);

    // Pass 1 — which TIFF tiles does this output touch?
    const wanted = new Set<string>();
    const pixels = new Float64Array(width * height * 2);
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const { lng, lat } = lngLatAt(i, j);
        const model = this.modelFromLngLat(lng, lat);
        const { px, py } = modelToPixel(dir, model.x, model.y);
        pixels[(j * width + i) * 2] = px;
        pixels[(j * width + i) * 2 + 1] = py;
        // Include the bilinear footprint, or the tile straddling an output
        // pixel's neighbour would be missed and read as a seam of NODATA.
        for (const [dx, dy] of [
          [-0.5, -0.5],
          [0.5, -0.5],
          [-0.5, 0.5],
          [0.5, 0.5],
        ]) {
          const x = Math.floor(px + dx);
          const y = Math.floor(py + dy);
          if (x < 0 || y < 0 || x >= dir.width || y >= dir.height) continue;
          wanted.add(`${Math.floor(x / dir.tileWidth)},${Math.floor(y / dir.tileHeight)}`);
        }
      }
    }

    await Promise.all(
      [...wanted].map((k) => {
        const [tx, ty] = k.split(',').map(Number);
        return this.tile(level, tx, ty);
      }),
    );

    // Pass 2 — sample. Every tile is now cached, so nothing here awaits I/O.
    const heights = new Float32Array(width * height);
    let measured = 0;
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const px = pixels[(j * width + i) * 2];
        const py = pixels[(j * width + i) * 2 + 1];
        const v = this.samplePixelSync(dir, level, px, py);
        heights[j * width + i] = v;
        if (isElevation(v)) measured++;
      }
    }

    return {
      heights,
      report: {
        resolutionMeters: this.resolutionMeters(level),
        overviewLevel: level,
        coverage: measured / (width * height),
      },
    };
  }

  /** {@link samplePixel} against already-cached tiles. Misses read as NODATA. */
  private samplePixelSync(dir: TiffDirectory, level: number, px: number, py: number): number {
    const cx = Math.floor(px);
    const cy = Math.floor(py);
    if (cx < 0 || cy < 0 || cx >= dir.width || cy >= dir.height) return NODATA;

    const read = (x: number, y: number): number => {
      if (x < 0 || y < 0 || x >= dir.width || y >= dir.height) return NODATA;
      const tx = Math.floor(x / dir.tileWidth);
      const ty = Math.floor(y / dir.tileHeight);
      const samples = this.cache.get(`${level}/${tx}/${ty}`);
      if (!samples) return NODATA;
      return samples[(y - ty * dir.tileHeight) * dir.tileWidth + (x - tx * dir.tileWidth)];
    };

    if (!isElevation(read(cx, cy))) return NODATA;

    const fx = px - 0.5;
    const fy = py - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const wx = fx - x0;
    const wy = fy - y0;
    const corners: Array<[number, number, number]> = [
      [x0, y0, (1 - wx) * (1 - wy)],
      [x0 + 1, y0, wx * (1 - wy)],
      [x0, y0 + 1, (1 - wx) * wy],
      [x0 + 1, y0 + 1, wx * wy],
    ];
    let sum = 0;
    let weight = 0;
    for (const [x, y, w] of corners) {
      const v = read(x, y);
      if (!isElevation(v)) continue;
      sum += v * w;
      weight += w;
    }
    return weight > 0 ? sum / weight : NODATA;
  }

  /** Geographic bounding box of the full-resolution raster. */
  bounds(): { west: number; south: number; east: number; north: number } {
    const dir = this.directories[0];
    const nw = pixelToModel(dir, 0, 0);
    const se = pixelToModel(dir, dir.width, dir.height);
    const a = this.lngLatFromModel(nw.x, nw.y);
    const b = this.lngLatFromModel(se.x, se.y);
    const c = this.lngLatFromModel(nw.x, se.y);
    const d = this.lngLatFromModel(se.x, nw.y);
    return {
      west: Math.min(a.lng, b.lng, c.lng, d.lng),
      east: Math.max(a.lng, b.lng, c.lng, d.lng),
      south: Math.min(a.lat, b.lat, c.lat, d.lat),
      north: Math.max(a.lat, b.lat, c.lat, d.lat),
    };
  }
}
