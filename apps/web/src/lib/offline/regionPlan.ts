/**
 * What a region download actually is: a list of elevation tiles.
 *
 * ## The commitment this file encodes
 *
 * **We cache the DEM, never rendered layers.** A rendered cache would need a
 * variant per layer × per wind direction × per date — combinatorially
 * impossible to download and pointless to try. One elevation download unlocks
 * every analysis layer, at any wind, on any date, computed on-device. Every
 * number this module produces is therefore about *elevation tiles only*, and
 * there is no `layers` parameter anywhere in it on purpose.
 *
 * ## Why the plan is derived here and nowhere else
 *
 * The tile enumeration is `demTilesForBounds` — the same function the coverage
 * probe uses to decide what a view needs, and the same one the analysis fetch
 * path keys the store with. If the picker planned one set and the coverage
 * check looked for another, a completed download would leave the badge saying
 * "Partial" forever, or worse, a partial download would read as "Covered".
 * That is exactly the class of defect R8 exists to kill, and rebuilding it one
 * module over would be no improvement.
 *
 * ## Why the plan spans a *range* of zooms
 *
 * Coverage is measured at the tile zoom MapLibre is requesting right now
 * ({@link demSourceZoom}), and separately sampled at {@link DEM_MAX_ZOOM} for
 * the "will this still work when I zoom in" check. A download of one zoom level
 * would satisfy the badge at exactly one camera position and nothing either
 * side of it. So a plan runs from a couple of levels below the current view up
 * to the chosen detail zoom. The overview levels are nearly free — tile count
 * quadruples per level, so everything below the deepest level costs about a
 * third of the deepest level put together — and they are what stops a hunter
 * zooming out to find the truck and hitting a blank screen.
 */

import type { BBox, TileCoord } from '@hunt-maps/terrain';
import {
  DEM_MAX_ZOOM,
  MERCATOR_MAX_LAT,
  demTileCount,
  demTilesForBounds,
} from '../map/demTiles';

/**
 * Bytes per stored elevation tile, measured — not guessed.
 *
 * Sampled from 114 real 256px Terrarium PNGs pulled through `tools/dem-relay
 * .mjs` over Hocking Hills, Ohio: z13 averaged 111.9 kB (n=55), z15 averaged
 * 98.8 kB (n=56), z10 62.9 kB (n=1). 100 kB is the round number in the middle
 * of that.
 *
 * This is deliberately *not* the API's figure. `apps/api/src/offline/offline
 * .module.ts` has no entry for elevation in its `BYTES_PER_TILE` table, so an
 * elevation-only estimate falls through to its 10 kB default — a tenfold
 * under-statement. Showing that number would tell a hunter "about 90 MB" for a
 * download that is really 900 MB, which is the confidently-wrong failure this
 * product cannot afford. See `regionEstimate.ts` for how the two are
 * reconciled.
 *
 * Flat farmland compresses better than the ridge-and-draw country this app is
 * built for, so on gentle ground the real download comes in under the estimate.
 * Over-stating is the safe direction: a download that finishes early is a good
 * surprise, one that runs out of space at 05:00 is not.
 */
export const DEM_BYTES_PER_TILE = 100_000;

/** Shallowest zoom a region may include. Mirrors the API's `@Min(6)`. */
export const REGION_MIN_ZOOM = 6;

/**
 * Detail levels offered in the picker.
 *
 * Capped at {@link DEM_MAX_ZOOM} because that is the deepest zoom the DEM
 * source is ever requested at — MapLibre overzooms z15 rather than asking for
 * z16, so a z16 download would be bytes that nothing ever reads. Offering it
 * would be selling storage for nothing.
 */
export const DETAIL_ZOOMS = [12, 13, 14, DEM_MAX_ZOOM] as const;

/**
 * Overview levels included below the current view's tile zoom.
 *
 * Two, so a hunter can zoom out twice — the "where am I relative to the truck"
 * move — without falling off the edge of what they downloaded. Costs about 6%
 * of the deepest level's tile count.
 */
export const OVERVIEW_LEVELS = 2;

/** Hard ceiling per region, mirroring the API's `MAX_TILES`. */
export const MAX_REGION_TILES = 120_000;

/** How much ground beyond the current view the picker can include. */
export interface PaddingChoice {
  id: string;
  label: string;
  /** Fraction of the viewport's own span added to *each* side. */
  pad: number;
}

export const PADDING_CHOICES: PaddingChoice[] = [
  { id: 'view', label: 'This view', pad: 0 },
  { id: 'wide', label: '+ half again', pad: 0.25 },
  { id: 'wider', label: 'Double', pad: 0.5 },
];

export interface RegionPlan {
  bounds: BBox;
  minZoom: number;
  maxZoom: number;
  /**
   * Every tile, coarsest zoom first.
   *
   * The order is load-bearing, not incidental: a download that is cancelled,
   * backgrounded to death or interrupted by a flat battery leaves whatever it
   * got so far on the device. Coarse-first means what it got is a usable
   * zoomed-out map of the whole region rather than a perfect rendering of one
   * corner and nothing anywhere else.
   */
  tiles: TileCoord[];
  byZoom: Array<{ z: number; count: number }>;
  tileCount: number;
  /** `tileCount × {@link DEM_BYTES_PER_TILE}`. Elevation only. */
  estimatedBytes: number;
  /** True when the plan is above {@link MAX_REGION_TILES} and must be refused. */
  overLimit: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Grow a bounding box by `pad` of its own span on every side.
 *
 * Latitude is clamped at Web Mercator's cut-off; beyond it the tile grid does
 * not exist and `lngLatToTile` runs off the end. Longitude is *not* wrapped
 * here — `demTilesForBounds` already normalises an antimeridian-straddling box
 * into the tile ids MapLibre will actually request, and doing it twice would
 * turn a wide box into a narrow one.
 */
export function padBounds(bounds: BBox, pad: number): BBox {
  if (pad <= 0) return bounds;
  const dLng = (bounds.east - bounds.west) * pad;
  const dLat = (bounds.north - bounds.south) * pad;
  return {
    west: bounds.west - dLng,
    east: bounds.east + dLng,
    south: clamp(bounds.south - dLat, -MERCATOR_MAX_LAT, MERCATOR_MAX_LAT),
    north: clamp(bounds.north + dLat, -MERCATOR_MAX_LAT, MERCATOR_MAX_LAT),
  };
}

/**
 * The zoom span a download must cover to make the badge honestly say "Covered".
 *
 * `viewTileZoom` is what `demSourceZoom(map.getZoom())` returns — the level the
 * coverage probe is measuring right now. Anything shallower than the plan's
 * `minZoom` reads as uncovered the moment the user zooms out, and anything
 * between the view and `maxZoom` is what the detail sample looks at, so the
 * range has to be contiguous.
 */
export function zoomRange(viewTileZoom: number, detailZoom: number): {
  minZoom: number;
  maxZoom: number;
} {
  const maxZoom = clamp(Math.round(detailZoom), REGION_MIN_ZOOM, DEM_MAX_ZOOM);
  const minZoom = clamp(Math.round(viewTileZoom) - OVERVIEW_LEVELS, REGION_MIN_ZOOM, maxZoom);
  return { minZoom, maxZoom };
}

/** Tile counts per level without allocating the tiles — for a live estimate. */
export function planCounts(
  bounds: BBox,
  viewTileZoom: number,
  detailZoom: number,
): { minZoom: number; maxZoom: number; byZoom: Array<{ z: number; count: number }>; tileCount: number } {
  const { minZoom, maxZoom } = zoomRange(viewTileZoom, detailZoom);
  const byZoom: Array<{ z: number; count: number }> = [];
  let tileCount = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const count = demTileCount(bounds, z);
    byZoom.push({ z, count });
    tileCount += count;
  }
  return { minZoom, maxZoom, byZoom, tileCount };
}

/**
 * The full plan for an explicit zoom span, tiles included.
 *
 * This is the function resume and delete use, because a saved region records
 * the zoom span it was created with and must re-derive *exactly* that set — not
 * a set recomputed from wherever the camera happens to be sitting now.
 *
 * Enumerating 100k tile coordinates is a few megabytes of objects, which is why
 * {@link planCounts} exists for the live estimate as the user drags the detail
 * slider. This is called once, when they commit.
 */
export function planZooms(bounds: BBox, minZoom: number, maxZoom: number): RegionPlan {
  const lo = clamp(Math.round(minZoom), REGION_MIN_ZOOM, DEM_MAX_ZOOM);
  const hi = clamp(Math.round(maxZoom), lo, DEM_MAX_ZOOM);
  const tiles: TileCoord[] = [];
  const byZoom: Array<{ z: number; count: number }> = [];
  for (let z = lo; z <= hi; z++) {
    const forZoom = demTilesForBounds(bounds, z);
    byZoom.push({ z, count: forZoom.length });
    tiles.push(...forZoom);
  }
  const tileCount = tiles.length;
  return {
    bounds,
    minZoom: lo,
    maxZoom: hi,
    tiles,
    byZoom,
    tileCount,
    estimatedBytes: tileCount * DEM_BYTES_PER_TILE,
    overLimit: tileCount > MAX_REGION_TILES,
  };
}

/** The plan for the view on screen: overview levels plus the chosen detail. */
export function planRegion(bounds: BBox, viewTileZoom: number, detailZoom: number): RegionPlan {
  const { minZoom, maxZoom } = zoomRange(viewTileZoom, detailZoom);
  return planZooms(bounds, minZoom, maxZoom);
}

// ---------------------------------------------------------------------------
// Human-readable figures
// ---------------------------------------------------------------------------

/**
 * Approximate ground dimensions, in miles.
 *
 * A spherical approximation: 69.055 mi per degree of latitude, and that scaled
 * by cos(latitude) for longitude. Wrong by well under a percent at whitetail
 * latitudes, and it is only ever rendered behind the word "about" — a hunter
 * uses this to decide "is that roughly my whole lease", not to survey a
 * boundary.
 */
export function boundsSpanMiles(bounds: BBox): { width: number; height: number } {
  const midLat = ((bounds.north + bounds.south) / 2) * (Math.PI / 180);
  return {
    width: Math.abs(bounds.east - bounds.west) * 69.172 * Math.cos(midLat),
    height: Math.abs(bounds.north - bounds.south) * 69.055,
  };
}

/** `1.4 GB`, `320 MB`, `8.2 MB` — one significant decimal, never scientific. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} kB`;
  return `${Math.round(bytes)} B`;
}

/** A default region name a hunter will recognise in a list a month later. */
export function defaultRegionName(bounds: BBox, at: Date = new Date()): string {
  const lat = (bounds.north + bounds.south) / 2;
  const lng = (bounds.east + bounds.west) / 2;
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  const date = at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lng).toFixed(2)}°${ew} — ${date}`;
}
