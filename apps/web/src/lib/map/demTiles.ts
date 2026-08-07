/**
 * Which DEM tiles a view needs — the single derivation.
 *
 * ## Why this file exists at all
 *
 * The offline coverage indicator and the actual analysis fetch path must agree,
 * exactly, about which elevation tiles a given view requires. If they disagree
 * the indicator is not merely imprecise, it is *confidently wrong about
 * terrain* — a hunter reads "covered", walks in, and the engine has nothing to
 * compute from. That is the failure CLAUDE.md names as the worst this product
 * has, so the derivation lives here once and both callers import it:
 *
 *  - `terrainProtocol.ts` builds its DEM store key with {@link demTileKey}.
 *  - `MapView.tsx` sets the raster source's `maxzoom` from {@link DEM_MAX_ZOOM}.
 *  - `coverage.ts` enumerates what a viewport needs with
 *    {@link demTilesForBounds} / {@link demTileCount} / {@link sampleDemTiles}.
 *
 * The tile enumeration itself is `tilesForBBox` from `@hunt-maps/terrain` — the
 * same function the server's region estimator uses to plan a download. So
 * "what you were told to download", "what gets stored" and "what the coverage
 * check looks for" are all one function, not three implementations that agree
 * until someone edits one of them.
 */

import {
  lngLatToTile,
  tileBBox,
  tilesForBBox,
  type BBox,
  type TileCoord,
} from '@hunt-maps/terrain';
import type { TileKey } from '../offline/tileStore';

/** Store namespace for elevation tiles. Rendered layers are never cached. */
export const DEM_LAYER = 'dem';

/** The DEM source is a 256px raster source; this feeds MapLibre's covering-zoom. */
export const DEM_TILE_SIZE = 256;

/**
 * Deepest zoom the DEM source is requested at.
 *
 * Above this MapLibre overzooms the z15 tile rather than asking for a new one,
 * which is why "covered at z15" is covered for good — see {@link demSourceZoom}.
 */
export const DEM_MAX_ZOOM = 15;

/** Web Mercator's latitude cut-off. Beyond it `lngLatToTile` runs off the grid. */
export const MERCATOR_MAX_LAT = 85.051129;

export function demTileKey(tile: TileCoord): TileKey {
  return { layer: DEM_LAYER, z: tile.z, x: tile.x, y: tile.y };
}

/** Stable string form of a tile — set membership, change detection, adjacency. */
export function tileId(tile: TileCoord): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

/** A tile's ground footprint, for drawing coverage on the map. */
export function tileFootprint(tile: TileCoord): BBox {
  return tileBBox(tile);
}

/**
 * Order-independent fingerprint of a tile set.
 *
 * Lets the coverage hook tell "the camera moved" from "the tiles I need
 * changed". Nudging the map a few pixels is the former, and re-probing storage
 * on every frame of it would cost battery for an answer that cannot have
 * changed.
 */
export function tileSetSignature(tiles: TileCoord[]): string {
  return tiles.map(tileId).sort().join(' ');
}

/** MapLibre's `getBounds()` shape, narrowed to what this module needs. */
export interface BoundsLike {
  getWest(): number;
  getSouth(): number;
  getEast(): number;
  getNorth(): number;
}

/** `LngLatBounds` → the engine's `BBox`. */
export function boundsToBBox(bounds: BoundsLike): BBox {
  return {
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth(),
  };
}

/**
 * The tile zoom MapLibre will actually request for the DEM source at `mapZoom`.
 *
 * Mirrors `Transform.coveringZoomLevel`:
 *   `max(0, round(zoom + log2(transform.tileSize / source.tileSize)))`
 * `transform.tileSize` is 512 and our source is 256, so the log term is exactly
 * 1; `RasterTileSource` sets `roundZoom = true`, hence `round` not `floor`.
 * Clamped to `maxzoom`, which MapLibre also does before it enumerates tiles.
 *
 * This is deliberately re-derived rather than read off `map.transform`: that is
 * private API, and a coverage check that silently stopped tracking the real
 * tile zoom would report on tiles nobody is fetching.
 */
export function demSourceZoom(mapZoom: number, maxZoom: number = DEM_MAX_ZOOM): number {
  const covering = Math.max(0, Math.round(mapZoom + Math.log2(512 / DEM_TILE_SIZE)));
  return Math.min(covering, maxZoom);
}

export interface TileRange {
  z: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function wrapLng(lng: number): number {
  return (((lng + 180) % 360) + 360) % 360 - 180;
}

/**
 * Longitude spans to enumerate, normalised into [-180, 180].
 *
 * MapLibre's `getBounds()` happily returns west > east (the view straddles the
 * antimeridian) or a span past 360 (zoomed far enough out to see world copies).
 * `tilesForBBox` assumes west <= east, so a raw hand-off would produce an empty
 * or nonsense tile list — and an empty needed-set reads as "nothing missing",
 * which is precisely the silent green this module exists to prevent.
 */
function longitudeSpans(west: number, east: number): Array<[number, number]> {
  if (east - west >= 359.9) return [[-180, 180]];
  const w = wrapLng(west);
  const e = wrapLng(east);
  return e < w
    ? [
        [w, 180],
        [-180, e],
      ]
    : [[w, e]];
}

/** Integer tile ranges covering `bounds` at `z`, one per longitude span. */
export function demTileRanges(bounds: BBox, z: number): TileRange[] {
  const zoom = Math.max(0, Math.round(z));
  const n = 2 ** zoom;
  const north = clamp(Math.max(bounds.north, bounds.south), -MERCATOR_MAX_LAT, MERCATOR_MAX_LAT);
  const south = clamp(Math.min(bounds.north, bounds.south), -MERCATOR_MAX_LAT, MERCATOR_MAX_LAT);

  return longitudeSpans(bounds.west, bounds.east).map(([w, e]) => {
    const nw = lngLatToTile(w, north, zoom);
    const se = lngLatToTile(e, south, zoom);
    return {
      z: zoom,
      x0: clamp(Math.floor(nw.x), 0, n - 1),
      x1: clamp(Math.floor(se.x), 0, n - 1),
      y0: clamp(Math.floor(nw.y), 0, n - 1),
      y1: clamp(Math.floor(se.y), 0, n - 1),
    };
  });
}

/** How many tiles `bounds` needs at `z`, without allocating any of them. */
export function demTileCount(bounds: BBox, z: number): number {
  return demTileRanges(bounds, z).reduce(
    (sum, r) => sum + (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1),
    0,
  );
}

/**
 * Every DEM tile `bounds` needs at `z`.
 *
 * Uses `tilesForBBox` — the shared enumeration — and then wraps/clamps to the
 * valid grid, so a view straddling the antimeridian resolves to the same tile
 * ids MapLibre will request rather than to negative x values that can never
 * match anything in the store.
 */
export function demTilesForBounds(bounds: BBox, z: number): TileCoord[] {
  const zoom = Math.max(0, Math.round(z));
  const n = 2 ** zoom;
  const north = clamp(Math.max(bounds.north, bounds.south), -MERCATOR_MAX_LAT, MERCATOR_MAX_LAT);
  const south = clamp(Math.min(bounds.north, bounds.south), -MERCATOR_MAX_LAT, MERCATOR_MAX_LAT);

  const seen = new Set<string>();
  const out: TileCoord[] = [];
  for (const [w, e] of longitudeSpans(bounds.west, bounds.east)) {
    for (const t of tilesForBBox({ west: w, east: e, south, north }, zoom)) {
      const x = ((t.x % n) + n) % n;
      const y = clamp(t.y, 0, n - 1);
      const k = `${x}/${y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ z: zoom, x, y });
    }
  }
  return out;
}

/**
 * An evenly-spread subset of the tiles `bounds` needs at `z`, at most `max`.
 *
 * Why a 2-D grid rather than striding the flat list: the flat list is
 * row-major, and a stride that happens to equal the row width samples a single
 * column — which would report "0% covered" for a region whose stored half
 * happens to sit in the other columns. Sampling x and y independently cannot
 * alias that way.
 *
 * Never used to claim an exact figure. Every caller that samples says so in
 * the label.
 */
export function sampleDemTiles(bounds: BBox, z: number, max: number): TileCoord[] {
  const ranges = demTileRanges(bounds, z);
  const total = ranges.reduce((s, r) => s + (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1), 0);
  if (total === 0) return [];
  if (total <= max) return demTilesForBounds(bounds, z);

  const out: TileCoord[] = [];
  const seen = new Set<string>();
  for (const r of ranges) {
    const w = r.x1 - r.x0 + 1;
    const h = r.y1 - r.y0 + 1;
    const budget = Math.max(1, Math.round((max * w * h) / total));
    // Keep the sample roughly isotropic: a wide, short viewport gets more
    // columns than rows, so the probes stay spread over the ground rather than
    // bunched in one stripe.
    const nx = clamp(Math.round(Math.sqrt((budget * w) / h)), 1, w);
    const ny = clamp(Math.ceil(budget / nx), 1, h);
    for (let j = 0; j < ny; j++) {
      const y = r.y0 + Math.floor(((j + 0.5) * h) / ny);
      for (let i = 0; i < nx; i++) {
        const x = r.x0 + Math.floor(((i + 0.5) * w) / nx);
        const k = `${x}/${y}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ z: r.z, x, y });
      }
    }
  }
  return out;
}
