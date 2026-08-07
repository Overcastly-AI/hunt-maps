/**
 * "Is *this view* actually stored on this device?"
 *
 * ## The defect this replaces
 *
 * The Layers sheet used to sample `store.stats().tileCount > 0` **once at
 * mount** and render the result behind the words "elevation for *this area* is
 * stored on this device". One tile anywhere in the world made it green, and it
 * stayed green while you panned five hundred miles. A hunter reads that at the
 * trailhead, walks in at 04:30, and the analysis engine has nothing to compute
 * from — the single worst failure this product has.
 *
 * So coverage is a *query about the current viewport*, recomputed whenever the
 * view changes, and it has three honest answers plus two "I do not know" ones.
 * It never falls back to "ready".
 *
 * ## What the answer means across zooms
 *
 * Coverage is per zoom level, and the check is run at the tile zoom MapLibre is
 * actually requesting right now ({@link demSourceZoom}). Two consequences,
 * both surfaced in the label rather than hidden:
 *
 *  - At `DEM_MAX_ZOOM` (the deepest zoom the DEM source is ever requested at)
 *    "Covered" is permanent for that ground: zooming further overzooms the same
 *    tiles and needs nothing new.
 *  - Below it, "every tile this view needs *now*" says nothing about the detail
 *    tiles a user will need the moment they zoom in. So when the current zoom
 *    comes back fully covered and is not yet at max, a bounded sample of
 *    `DEM_MAX_ZOOM` tiles across the same viewport is probed too. Missing detail
 *    downgrades the answer to Partial, and the label says it is a sample and
 *    which zoom it is talking about. Enumerating every z15 tile under a z6 view
 *    would be millions of lookups; sampling and saying so is the honest option.
 *
 * ## Cost
 *
 * This runs on `moveend` on a mid-range phone, so it is bounded twice over:
 * the needed-tile set is capped at {@link MAX_VIEW_PROBES} (beyond that it is
 * sampled, and `sampled` is set so the UI can say so), probes run through a
 * small concurrency pool rather than thousands of parallel OPFS opens, and
 * results are memoised briefly so a pan back and forth is nearly free.
 */

import type { BBox, TileCoord } from '@hunt-maps/terrain';
import {
  DEM_MAX_ZOOM,
  demSourceZoom,
  demTileCount,
  demTileKey,
  demTilesForBounds,
  sampleDemTiles,
} from '../map/demTiles';
import { openTileStore, type TileStore, type TileStoreStats } from './tileStore';

/** Exact-count ceiling for the current view. A typical viewport is 20–60 tiles. */
export const MAX_VIEW_PROBES = 256;

/** Probe budget for the "will this still work when I zoom in" check. */
export const MAX_DETAIL_PROBES = 48;

/** Parallel store lookups. OPFS costs ~3 async handle opens per probe. */
const PROBE_CONCURRENCY = 12;

/** How long a probe result is trusted. Short: a download can land underneath us. */
const PROBE_TTL_MS = 20_000;

const PROBE_CACHE_MAX = 4_000;

export type CoverageVerdict = 'covered' | 'partial' | 'empty';

export interface CoverageResult {
  status: CoverageVerdict;
  /**
   * `view` — measured at the zoom the map is requesting right now.
   * `detail` — the current zoom was fully covered, but a sample of
   * `DEM_MAX_ZOOM` tiles under the same view found gaps.
   */
  basis: 'view' | 'detail';
  /** Tile zoom the figures below refer to. */
  tileZoom: number;
  /** Tiles this view needs at `tileZoom`. */
  neededTiles: number;
  /** Tiles actually looked up. Less than `neededTiles` iff `sampled`. */
  probedTiles: number;
  presentTiles: number;
  /** `presentTiles / probedTiles`, in [0, 1]. An estimate when `sampled`. */
  fraction: number;
  sampled: boolean;
  /**
   * Stored tiles, for the map overlay. Populated only for an exact `view`
   * measurement — a scatter of sampled squares would draw an extent we did not
   * actually measure, which is a different flavour of the same lie.
   */
  coveredExtent: TileCoord[];
  backend: TileStoreStats['backend'];
  /** In-memory fallback: real for this session, gone after a reload. */
  volatile: boolean;
}

export type CoverageState =
  | { kind: 'checking' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'result'; result: CoverageResult };

export interface CoverageRequest {
  bounds: BBox;
  /** The *map* zoom, not the tile zoom. */
  zoom: number;
  /** Injected by tests; production reads the real store. */
  store?: TileStore;
  maxViewProbes?: number;
  maxDetailProbes?: number;
  signal?: AbortSignal;
}

interface CacheEntry {
  present: boolean;
  at: number;
}

const probeCache = new Map<string, CacheEntry>();

/**
 * Drop memoised probe results.
 *
 * Call after a region download or a delete: otherwise the sheet keeps
 * reporting the pre-download answer for up to {@link PROBE_TTL_MS}, which
 * would make a completed download look like it did nothing.
 */
export function invalidateCoverageCache(): void {
  probeCache.clear();
}

async function probe(store: TileStore, tile: TileCoord): Promise<boolean> {
  const key = `${tile.z}/${tile.x}/${tile.y}`;
  const now = Date.now();
  const hit = probeCache.get(key);
  if (hit && now - hit.at < PROBE_TTL_MS) return hit.present;

  const present = await store.has(demTileKey(tile));
  if (probeCache.size >= PROBE_CACHE_MAX) {
    // Cheap FIFO trim. The cache is an optimisation, not a source of truth.
    const oldest = probeCache.keys().next().value;
    if (oldest !== undefined) probeCache.delete(oldest);
  }
  probeCache.set(key, { present, at: now });
  return present;
}

/**
 * Probe every tile through a bounded pool.
 *
 * A wide viewport is tens of tiles, but a `Promise.all` over all of them still
 * opens that many OPFS directory handles at once, which on a cheap phone
 * competes with the tile renderer for the same thread. Twelve at a time keeps
 * the map interactive while panning.
 */
async function probeAll(
  store: TileStore,
  tiles: TileCoord[],
  signal?: AbortSignal,
): Promise<TileCoord[]> {
  const present: TileCoord[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(PROBE_CONCURRENCY, tiles.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= tiles.length) return;
      if (signal?.aborted) return;
      if (await probe(store, tiles[index])) present.push(tiles[index]);
    }
  });
  await Promise.all(workers);
  return present;
}

/**
 * Measure offline DEM coverage for one viewport.
 *
 * Throws if the store cannot be opened or a lookup fails — the caller turns
 * that into an explicit `unavailable` state. It must never be swallowed into
 * "0% covered", because "we could not read your storage" and "your storage is
 * empty" call for different actions from the user.
 */
export async function queryViewportCoverage(req: CoverageRequest): Promise<CoverageResult> {
  const store = req.store ?? (await openTileStore());
  const maxViewProbes = req.maxViewProbes ?? MAX_VIEW_PROBES;
  const maxDetailProbes = req.maxDetailProbes ?? MAX_DETAIL_PROBES;
  const volatile = store.backend === 'memory';

  const tileZoom = demSourceZoom(req.zoom);
  const needed = demTileCount(req.bounds, tileZoom);
  const sampled = needed > maxViewProbes;
  const probes = sampled
    ? sampleDemTiles(req.bounds, tileZoom, maxViewProbes)
    : demTilesForBounds(req.bounds, tileZoom);

  const present = await probeAll(store, probes, req.signal);
  const fraction = probes.length === 0 ? 0 : present.length / probes.length;

  const base: CoverageResult = {
    status: present.length === 0 ? 'empty' : fraction >= 1 ? 'covered' : 'partial',
    basis: 'view',
    tileZoom,
    neededTiles: needed,
    probedTiles: probes.length,
    presentTiles: present.length,
    fraction,
    sampled,
    coveredExtent: sampled ? [] : present,
    backend: store.backend,
    volatile,
  };

  if (base.status !== 'covered' || tileZoom >= DEM_MAX_ZOOM) return base;

  // Fully covered at the zoom on screen — but the user will zoom in, and the
  // detail tiles are a different set. Sampled, never enumerated: at low zoom
  // the exact set runs to millions.
  const detailNeeded = demTileCount(req.bounds, DEM_MAX_ZOOM);
  const detailSampled = detailNeeded > maxDetailProbes;
  const detailProbes = detailSampled
    ? sampleDemTiles(req.bounds, DEM_MAX_ZOOM, maxDetailProbes)
    : demTilesForBounds(req.bounds, DEM_MAX_ZOOM);
  const detailPresent = await probeAll(store, detailProbes, req.signal);

  if (detailProbes.length === 0 || detailPresent.length === detailProbes.length) return base;

  return {
    status: 'partial',
    basis: 'detail',
    tileZoom: DEM_MAX_ZOOM,
    neededTiles: detailNeeded,
    probedTiles: detailProbes.length,
    presentTiles: detailPresent.length,
    fraction: detailPresent.length / detailProbes.length,
    sampled: detailSampled,
    // The current zoom is covered edge to edge, so hatching it would paint the
    // whole screen; the gap is in a zoom the user cannot see yet, and the text
    // is what has to carry that.
    coveredExtent: [],
    backend: store.backend,
    volatile,
  };
}
