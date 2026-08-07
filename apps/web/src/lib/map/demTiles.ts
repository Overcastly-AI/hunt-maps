/**
 * Which DEM tiles a given map view actually needs.
 *
 * ## Why this is one module and not three
 *
 * Ridgeline's offline promise is "the elevation for *this* ground is on the
 * device". Answering that honestly means the coverage check and the tile fetch
 * must agree, exactly, about which tiles "this ground" is. If they disagree,
 * the badge is still lying — just more subtly than a boolean sampled once at
 * mount, and therefore worse, because it looks like it was thought about.
 *
 * So the three places that need to know are all driven from here:
 *
 *  - `MapView` builds its raster sources with {@link DEM_TILE_SIZE} and
 *    {@link DEM_MAX_ZOOM}, which is what decides the zoom MapLibre requests at.
 *  - `terrainProtocol` turns a requested tile into a store key with
 *    {@link demTileKey}.
 *  - the coverage query enumerates the view's tiles with
 *    {@link demTilesForView} and probes those same keys.
 *
 * The enumeration itself is `tilesForBBox` from `@hunt-maps/terrain` — the same
 * function the API's region estimator uses to count a download. A view's
 * coverage and a region's download are then provably talking about the same
 * tiles.
 *
 * ## The zoom rule, and what "covered" therefore means
 *
 * MapLibre picks the zoom for a raster source itself. For a source with
 * `roundZoom` (every raster source sets it) the transform computes
 *
 *   z = round(mapZoom + log2(transform.tileSize / source.tileSize))
 *
 * with `transform.tileSize` fixed at 512, then clamps to the source's
 * `maxzoom`. With a 256px DEM source that is `round(mapZoom + 1)`, capped at
 * {@link DEM_MAX_ZOOM}. {@link demTileZoom} reproduces that, which is the one
 * piece of MapLibre internals we are obliged to mirror — there is no public API
 * that answers "which tiles would you request for this source right now".
 *
 * The consequence for the label, stated plainly because it is the kind of thing
 * that quietly becomes a lie: **coverage is answered for the zoom currently
 * being drawn.** "Covered" means every tile this view is drawing from is
 * stored. Zoom in two levels and the answer is recomputed against the new zoom
 * and may change — until you hit `DEM_MAX_ZOOM`, past which MapLibre overzooms
 * the same z15 tiles and the answer stops changing. That is why the label
 * always carries its zoom in the detail line.
 */

import { tileBBox, tilesForBBox, type BBox, type TileCoord } from '@hunt-maps/terrain';
import type { TileKey } from '../offline/tileStore';

/**
 * DEM source tile size, in pixels. Also passed to the analysis worker as the
 * grid width, so it is not freely tunable — 256 is what the kernels assume.
 */
export const DEM_TILE_SIZE = 256;

/**
 * Deepest zoom we ever request elevation at.
 *
 * Terrarium/USGS source data does not carry real detail past this, so deeper
 * tiles would be interpolation dressed up as measurement — and every extra
 * level quadruples what a hunter has to download for the same ground.
 */
export const DEM_MAX_ZOOM = 15;

/** Store layer name for elevation. The cache holds DEM, never rendered layers. */
export const DEM_LAYER = 'dem';

/** Web Mercator is only defined to ~±85.05°; beyond it the y projection diverges. */
const MAX_MERCATOR_LAT = 85.05112878;

/** Tile-store key for a DEM tile. The one place this shape is constructed. */
export function demTileKey(tile: TileCoord): TileKey {
  return { layer: DEM_LAYER, z: tile.z, x: tile.x, y: tile.y };
}

/** Stable string form of a tile, for set membership and change detection. */
export function tileId(tile: TileCoord): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

/**
 * The zoom MapLibre will request DEM tiles at for a given map zoom.
 *
 * See the module comment for the formula's provenance. Clamped at both ends:
 * negative zooms do not exist, and past `DEM_MAX_ZOOM` MapLibre overzooms the
 * deepest stored level rather than asking for a deeper one.
 */
export function demTileZoom(mapZoom: number, maxZoom = DEM_MAX_ZOOM): number {
  const scaled = Math.round(mapZoom + Math.log2(512 / DEM_TILE_SIZE));
  return Math.max(0, Math.min(maxZoom, scaled));
}

/**
 * Every DEM tile a viewport needs, at the zoom it will actually be drawn from.
 *
 * `bounds` is the map's own `getBounds()`, so a pitched view is covered by its
 * bounding box — a superset of the frustum MapLibre culls to. A superset is the
 * safe direction to be wrong in here: it can only ever under-report coverage,
 * never over-report it, and over-reporting is the failure that puts somebody on
 * a blank map at 04:30.
 */
export function demTilesForView(
  bounds: BBox,
  mapZoom: number,
  options: { maxZoom?: number } = {},
): TileCoord[] {
  const z = demTileZoom(mapZoom, options.maxZoom ?? DEM_MAX_ZOOM);
  const n = 2 ** z;

  const south = clamp(Math.min(bounds.south, bounds.north), -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT);
  const north = clamp(Math.max(bounds.south, bounds.north), -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT);

  // A zoomed-out map reports bounds spanning more than one world copy, and can
  // report longitudes outside ±180 either side of the antimeridian. Reduce to
  // at most one world, then split at the antimeridian if the span wraps — a
  // single bbox with west > east enumerates to nothing, which would read as
  // "not downloaded" for a legitimate view.
  const spansWorld = bounds.east - bounds.west >= 360;
  const boxes: BBox[] = spansWorld
    ? [{ west: -180, east: 180, south, north }]
    : splitAtAntimeridian(wrapLng(bounds.west), wrapLng(bounds.east), south, north);

  const seen = new Set<string>();
  const out: TileCoord[] = [];
  for (const box of boxes) {
    for (const tile of tilesForBBox(box, z)) {
      // Wrap x across world copies; drop y outside the world (possible when a
      // pitched or over-panned view reports bounds past the Mercator limit).
      const x = ((tile.x % n) + n) % n;
      if (tile.y < 0 || tile.y >= n) continue;
      const normalised = { z, x, y: tile.y };
      const id = tileId(normalised);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(normalised);
    }
  }
  return out;
}

/**
 * Order-independent fingerprint of a tile set.
 *
 * Used to skip re-querying when a pan moved the camera but not the tiles it
 * needs — the common case when nudging the map a few pixels, and the difference
 * between a badge that flickers to "checking" on every frame and one that does
 * not.
 */
export function tileSetSignature(tiles: TileCoord[]): string {
  return tiles
    .map(tileId)
    .sort()
    .join(' ');
}

/** Tile footprint in lng/lat, for drawing coverage on the map. */
export function tileFootprint(tile: TileCoord): BBox {
  return tileBBox(tile);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function wrapLng(lng: number): number {
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180;
  return wrapped;
}

function splitAtAntimeridian(west: number, east: number, south: number, north: number): BBox[] {
  if (west <= east) return [{ west, east, south, north }];
  return [
    { west, east: 180, south, north },
    { west: -180, east, south, north },
  ];
}
