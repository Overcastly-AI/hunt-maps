/**
 * `window.__ridgeline.offline` — a read-only window onto the offline state.
 *
 * The map instance is already exposed on `window.__ridgeline` (see `MapView`)
 * because there is no other honest way for an automated run to know when tiles
 * have settled. Coverage has the same problem in a sharper form: the whole
 * defect class here is *the UI claiming something the storage does not support*,
 * and a test that asks the UI what it thinks cannot detect that. This hook lets
 * a QA run — or a person standing in a hollow with a phone and a console — ask
 * the storage layer directly and compare.
 *
 * Deliberately read-only plus a recompute trigger. No write, no clear, no seed:
 * a script that wants to write to this origin's storage can already use OPFS
 * directly, so a writer here would add no capability, only a footgun that could
 * destroy a region a user waited twenty minutes for.
 */

import type { TileCoord } from '@hunt-maps/terrain';
import { demTilesForView } from '../map/demTiles';
import { openTileStore, type TileStoreStats } from './tileStore';
import { queryViewportCoverage, type ViewportCoverage } from './coverage';

export interface OfflineFieldHook {
  /** The DEM tiles the current view needs, derived exactly as the fetch path does. */
  tilesForView(): TileCoord[];
  /** Probe the store now, bypassing the debounce and the signature cache. */
  probe(): Promise<ViewportCoverage>;
  /** Backend, tile count and quota, straight from the store. */
  stats(): Promise<TileStoreStats | null>;
  /** Ask the app to recompute and re-render its coverage badge and overlay. */
  refresh(): void;
}

interface HookHost {
  __ridgeline?: { offline?: OfflineFieldHook } & Record<string, unknown>;
}

interface MapLike {
  getZoom(): number;
  getBounds(): { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number };
}

export function installOfflineFieldHook(map: MapLike, refresh: () => void): () => void {
  const host = window as unknown as HookHost;

  const tilesForView = (): TileCoord[] => {
    const b = map.getBounds();
    return demTilesForView(
      { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
      map.getZoom(),
    );
  };

  const hook: OfflineFieldHook = {
    tilesForView,
    probe: async () => {
      const store = await openTileStore().catch(() => null);
      return queryViewportCoverage(store, tilesForView());
    },
    stats: async () => {
      const store = await openTileStore().catch(() => null);
      return store ? store.stats() : null;
    },
    refresh,
  };

  host.__ridgeline = { ...(host.__ridgeline ?? {}), offline: hook };

  return () => {
    if (host.__ridgeline) delete host.__ridgeline.offline;
  };
}
