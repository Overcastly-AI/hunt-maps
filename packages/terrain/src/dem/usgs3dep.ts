/**
 * Addressing USGS 3DEP staged products, and rendering them into the engine's
 * Web Mercator tiles.
 *
 * ## The access path, and why this one
 *
 * USGS publishes 3DEP three ways. Only one of them is usable here:
 *
 * | Path | Verdict |
 * |------|---------|
 * | `elevation.nationalmap.gov` ArcGIS ImageServer (`exportImage`, `identify`) | Returns real heights, but it is a *server-side* resample and needs that host reachable. Blocked outright by this sandbox's egress policy (403 on CONNECT), so it could not be validated here. |
 * | The National Map download API (`apps.nationalmap.gov`) | A discovery API over the same files; also blocked, and adds a dependency on a service that has had multi-day outages. |
 * | **`prd-tnm.s3.amazonaws.com` staged products** | Plain public S3, no key, not requester-pays, honours `Range:`. The files are Cloud-Optimized GeoTIFFs, so a 512² patch of a 485 MB raster costs two requests. **This is what we use.** |
 *
 * The S3 path also has the property the others lack: it hands back the
 * authoritative bytes. Nothing between USGS and the hunter resamples, hillshades
 * or reprojects the data, so if a bench is in the LiDAR it is in what we render.
 *
 * ## Two products, and the honest difference between them
 *
 * - **`13`** — 1/3 arc-second (~10 m), bare-earth, seamless, **nationwide**, and
 *   addressed by a deterministic one-degree cell name (`n38w085`). No index, no
 *   configuration: given a lng/lat you can compute the URL. This is the product
 *   that can be switched on for everybody today.
 * - **`1m`** — 1 m LiDAR-derived bare earth. This is the real prize — it is the
 *   resolution at which old logging grades, micro-benches and the lip of a bench
 *   become visible, which is the thing that changed hunting cartography. But it
 *   is published *per acquisition project*, and the file name embeds the project
 *   name (`USGS_1M_16_x27y405_KY_Statewide_2021_A21.tif`). There is no
 *   deterministic lng/lat -> project mapping; USGS's own index for it
 *   (`FESM_1m.gpkg`) is a **1.9 GB GeoPackage**, which is not something this
 *   package can carry or a phone can download.
 *
 * So 1 m is addressable *given a project* and not otherwise. {@link
 * oneMeterTileName} does the deterministic part; resolving the project is left
 * to the caller (configuration, or a server-side probe of the handful of
 * projects whose name carries the right state prefix). **Where no project is
 * known, the answer is "no 1 m data here", never a silent fall back to 10 m
 * dressed up as LiDAR** — see the callers in `apps/api`.
 *
 * ## Vertical datum
 *
 * Every product here is **NAVD88 orthometric** (metres above the geoid), per
 * the USGS 3DEP product specification. That agrees with AWS Terrarium to
 * sub-metre in measurement (see `verticalDatum.ts` for the numbers), so the two
 * may be mixed; it does **not** agree with a raw GNSS altitude, which is
 * ellipsoidal and 22–34 m larger over CONUS.
 */

import { NODATA } from './encoding.js';
import { CogReader, type CogSampleReport, type RangeReader } from './cog.js';
import { lngLatToUtm, utmZoneForLongitude } from './projection.js';
import { pixelSizeMeters, tileBBox, type TileCoord } from './tilemath.js';
import type { VerticalDatum } from './verticalDatum.js';

/** Public, keyless, non-requester-pays bucket holding the staged products. */
export const TNM_BUCKET_URL = 'https://prd-tnm.s3.amazonaws.com';

/** 3DEP is NAVD88 — orthometric, not ellipsoidal. Pinned by a test. */
export const USGS_3DEP_VERTICAL_DATUM: VerticalDatum = 'orthometric';

/** Nominal ground sample distance of each product, metres. */
export const USGS_3DEP_RESOLUTION = { '13': 10, '1m': 1 } as const;

/**
 * The one-degree cell name containing a point, e.g. `n38w085`.
 *
 * USGS names a cell by its **north-west** corner, and the file covers one degree
 * south and one degree east of it. So a point at 37.5N, 84.5W lives in `n38w085`
 * — note that both numbers are the *ceiling* of the absolute value, which is the
 * detail that gets this wrong: naming it `n37w084` (the floor, the intuitive
 * choice) fetches the cell diagonally adjacent and every elevation in it is real,
 * plausible and from the wrong county.
 */
export function oneDegreeCellName(lng: number, lat: number): string {
  // North-west corner: the cell's north edge is ceil(lat) and its west edge is
  // floor(lng). Both are "outward" from the point in the direction the corner
  // lies, which is why one is a ceiling and the other a floor — using the same
  // rounding for both is the mistake that yields a neighbouring cell.
  const northEdge = Math.ceil(lat);
  const westEdge = Math.floor(lng);
  const ns = northEdge > 0 ? 'n' : 's';
  const ew = westEdge < 0 ? 'w' : 'e';
  return (
    `${ns}${String(Math.abs(northEdge)).padStart(2, '0')}` +
    `${ew}${String(Math.abs(westEdge)).padStart(3, '0')}`
  );
}

/** URL of the 1/3 arc-second COG covering a point. Deterministic; no index. */
export function oneThirdArcSecondUrl(lng: number, lat: number, bucket = TNM_BUCKET_URL): string {
  const cell = oneDegreeCellName(lng, lat);
  return `${bucket}/StagedProducts/Elevation/13/TIFF/current/${cell}/USGS_13_${cell}.tif`;
}

export interface OneMeterTile {
  /** UTM zone the project is published in. */
  zone: number;
  /** 10 km cell easting index — `x27` in the file name. */
  x: number;
  /** 10 km cell northing index of the cell's **north** edge — `y405`. */
  y: number;
  /** File-name stem without the project suffix, e.g. `USGS_1M_16_x27y405`. */
  stem: string;
}

/**
 * The 1 m tile a point falls in, given the project's UTM zone.
 *
 * Tiles are 10 km x 10 km in the project's UTM zone (10012 px, so a 6 m buffer
 * on each side). `x` indexes the **west** edge in units of 10 km; `y` indexes
 * the **north** edge — measured from the file itself, whose tie point for
 * `y405` is northing 4 050 006, i.e. `y` counts the top, not the bottom. Getting
 * that backwards costs exactly one tile, 10 km due south, which is far enough to
 * be a different property and close enough to look right.
 *
 * `zone` must be the *project's* zone, not the point's: projects near a zone
 * boundary publish everything in one zone using extended coordinates.
 */
export function oneMeterTileName(lng: number, lat: number, zone?: number): OneMeterTile {
  const z = zone ?? utmZoneForLongitude(lng);
  const utm = lngLatToUtm(lng, lat, z);
  const x = Math.floor(utm.easting / 10000);
  const y = Math.floor(utm.northing / 10000) + 1;
  return { zone: z, x, y, stem: `USGS_1M_${z}_x${x}y${y}` };
}

/** Full URL of a 1 m tile, once the project name is known. */
export function oneMeterUrl(tile: OneMeterTile, project: string, bucket = TNM_BUCKET_URL): string {
  return `${bucket}/StagedProducts/Elevation/1m/Projects/${project}/TIFF/${tile.stem}_${project}.tif`;
}

/**
 * Render a Web Mercator tile of heights from an open COG.
 *
 * The output is the engine's usual `tileSize²` Float32 grid in metres, row-major
 * from the north-west corner, with {@link NODATA} wherever the COG had nothing.
 * That is deliberately the *same* shape `decodeRgbaToHeights` produces, so
 * everything downstream — `assembleGrid`, `requiredHalo`, every operator — is
 * unchanged by which source the heights came from.
 *
 * ## Why this is not a straight pixel copy
 *
 * The COG is in NAD83 geographic degrees (1/3") or NAD83 UTM metres (1 m); the
 * output is Web Mercator. Both differ from Mercator in a way that varies across
 * the tile, so every output cell is projected individually. Cell **spacing** in
 * the output is then isotropic Web Mercator metres — `pixelSizeMeters` — which
 * is what the whole engine already assumes and is why slope and aspect stay
 * metrically correct after the reprojection: the grid handed to Horn's kernel is
 * square in ground units, not in degrees.
 *
 * `targetMeters` is the output cell size, so overview selection matches the zoom
 * being rendered rather than always paying for full resolution.
 */
export async function renderMercatorTileFromCog(
  reader: CogReader,
  tile: TileCoord,
  tileSize = 256,
): Promise<{ heights: Float32Array; report: CogSampleReport }> {
  const n = 2 ** tile.z;
  // Inverse Web Mercator for the centre of output cell (i, j).
  const lngLatAt = (i: number, j: number): { lng: number; lat: number } => {
    const wx = (tile.x + (i + 0.5) / tileSize) / n;
    const wy = (tile.y + (j + 0.5) / tileSize) / n;
    return {
      lng: wx * 360 - 180,
      lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180) / Math.PI,
    };
  };
  const bbox = tileBBox(tile);
  const centreLat = (bbox.north + bbox.south) / 2;
  const targetMeters = pixelSizeMeters(tile.z, centreLat, tileSize);
  return reader.resample(tileSize, tileSize, lngLatAt, targetMeters);
}

/**
 * Open the 1/3 arc-second COG covering a point.
 *
 * `fetchRange` is injected for the same reason `CogReader` injects it: the API
 * uses Node `fetch`, the browser worker uses the service worker's `fetch`, and
 * tests use a committed fixture with no network at all.
 */
export async function open3depOneThird(
  lng: number,
  lat: number,
  fetchRange: (url: string) => RangeReader,
  bucket = TNM_BUCKET_URL,
): Promise<CogReader> {
  const url = oneThirdArcSecondUrl(lng, lat, bucket);
  return CogReader.open(fetchRange(url), { verticalDatum: USGS_3DEP_VERTICAL_DATUM });
}

/**
 * A height grid that knows it might be empty.
 *
 * Returned instead of a bare `Float32Array` so a caller can never accidentally
 * render "3DEP 1 m" over ground where the answer was actually NODATA. The
 * coverage figure is the fraction of cells that carry a measured height; a
 * caller showing a source label is expected to check it, and the API does.
 */
export interface SourcedHeights {
  heights: Float32Array;
  /** Which product answered. */
  product: '13' | '1m';
  report: CogSampleReport;
}

/** An all-NODATA grid, for "this source has nothing here". */
export function emptyHeights(tileSize: number): Float32Array {
  return new Float32Array(tileSize * tileSize).fill(NODATA);
}
