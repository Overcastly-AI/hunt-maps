/**
 * `window.__ridgeline` — the QA seam.
 *
 * The map instance has been exposed here since the screenshot suite needed a
 * reliable "tiles have settled" signal. The offline surface is added for the
 * same reason and it is the more important one: the invariants that matter for
 * this app are things like *"seed the store for this view, pan five hundred
 * miles, and prove the label stops saying Covered"*, and there is no way to set
 * up that state from outside the page. Mocking the tile store instead would
 * test the mock — the whole point is to exercise the real OPFS/IndexedDB path
 * the hunter's device will use.
 *
 * Deliberately a *merge*, not an assignment: the map and the offline surface
 * are registered from different components, and the last one to mount used to
 * clobber the other.
 */

import type maplibregl from 'maplibre-gl';
import type { BBox, TileCoord } from '@hunt-maps/terrain';
import type { TileKey, TileStore } from './offline/tileStore';

export interface RidgelineOfflineHook {
  /** The real store — OPFS, IndexedDB or memory, whichever the device gave us. */
  store: () => Promise<TileStore>;
  /** Exactly the tiles the analysis path will ask for, for a given view. */
  tilesForView: (bounds: BBox, mapZoom: number) => TileCoord[];
  tileKey: (tile: TileCoord) => TileKey;
  /** Drop memoised probe results after writing tiles behind the app's back. */
  invalidate: () => void;
}

export interface RidgelineDevHook {
  map?: maplibregl.Map;
  offline?: RidgelineOfflineHook;
}

export function exposeDevHook(partial: Partial<RidgelineDevHook>): void {
  const target = window as unknown as { __ridgeline?: RidgelineDevHook };
  target.__ridgeline = { ...target.__ridgeline, ...partial };
}
