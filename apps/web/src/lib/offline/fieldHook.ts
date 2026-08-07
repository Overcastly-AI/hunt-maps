/**
 * `window.__ridgeline.offline` — a read-only window onto the offline state.
 *
 * The map instance is already exposed on `window.__ridgeline` (see `MapView`)
 * because there is no other honest way for an automated run to know when tiles
 * have settled. Coverage has the same problem in a sharper form: the defect
 * class here is *the UI claiming something the storage does not support*, and a
 * test that asks the UI what it thinks cannot detect that. This hook lets a QA
 * run — or a person standing in a hollow with a phone and a console — ask the
 * storage layer directly and compare the two answers.
 *
 * Deliberately read-only apart from `refresh`. No write, no clear, no seed: a
 * script on this origin can already reach OPFS directly, so a writer here would
 * add no capability, only a way to destroy a region somebody waited twenty
 * minutes for.
 */

import type { TileCoord } from '@hunt-maps/terrain';
import { boundsToBBox, demSourceZoom, demTilesForBounds } from '../map/demTiles';
import { openTileStore, type TileStoreStats } from './tileStore';
import { queryViewportCoverage, type CoverageResult } from './coverage';

export interface OfflineFieldHook {
  /** DEM tiles the current view needs, derived exactly as the fetch path does. */
  tilesForView(): TileCoord[];
  /** The tile zoom MapLibre is requesting elevation at right now. */
  tileZoom(): number;
  /** Probe storage now, bypassing the hook's debounce and signature cache. */
  probe(): Promise<CoverageResult>;
  /** Backend, tile count and quota, straight from the store. */
  stats(): Promise<TileStoreStats | null>;
  /** Ask the app to recompute and re-render its badge and overlay. */
  refresh(): void;
}

interface HookHost {
  __ridgeline?: { offline?: OfflineFieldHook } & Record<string, unknown>;
}

/** The slice of `maplibregl.Map` this needs — kept narrow so tests can fake it. */
export interface MapLike {
  getZoom(): number;
  getBounds(): { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number };
}

export function installOfflineFieldHook(map: MapLike, refresh: () => void): () => void {
  const host = window as unknown as HookHost;

  const tileZoom = () => demSourceZoom(map.getZoom());
  const tilesForView = () => demTilesForBounds(boundsToBBox(map.getBounds()), tileZoom());

  const hook: OfflineFieldHook = {
    tilesForView,
    tileZoom,
    probe: () =>
      queryViewportCoverage({ bounds: boundsToBBox(map.getBounds()), zoom: map.getZoom() }),
    stats: async () => {
      const store = await openTileStore().catch(() => null);
      return store ? store.stats() : null;
    },
    refresh,
  };

  // Merge rather than replace: `MapView` owns the `map` key on the same object.
  host.__ridgeline = { ...(host.__ridgeline ?? {}), offline: hook };

  return () => {
    if (host.__ridgeline) delete host.__ridgeline.offline;
  };
}
