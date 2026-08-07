/**
 * The region manager: start, resume, cancel, delete — and tell the truth about
 * all four.
 *
 * This hook owns the lifecycle around `regionDownloader.ts`. The rules it
 * enforces are the ones that decide whether a hunter finds a map or a blank
 * screen at 04:30:
 *
 *  1. **A record left in `downloading` at load time is a lie.** Nothing is
 *     running — the tab was closed, the battery died, the OS reaped the
 *     process. It is demoted to `paused` on mount so the list never shows a
 *     progress bar that will never move.
 *  2. **Progress is persisted as it happens**, not at the end, so what survives
 *     a kill is what actually happened.
 *  3. **The coverage cache is invalidated the moment the store changes.** R8's
 *     probe memo has a 20 s TTL; without this, a download that just finished
 *     keeps reading "Not downloaded" for twenty seconds, which trains a user to
 *     distrust the badge.
 *  4. **Deleting a region deletes only the tiles no other region needs.** Two
 *     saved areas over neighbouring ground share tiles along the seam, and
 *     freeing them wholesale would silently punch a hole in a region the user
 *     did not touch.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BBox, TileCoord } from '@hunt-maps/terrain';
import { DEM_TEMPLATE, demTileUrl } from '../map/demSource';
import { demTileKey, tileId } from '../map/demTiles';
import { invalidateCoverageCache } from './coverage';
import {
  httpTileFetcher,
  runDownload,
  type DownloadProgress,
} from './regionDownloader';
import { planZooms, type RegionPlan } from './regionPlan';
import {
  newClientId,
  openRegionStore,
  reviseRegion,
  type SavedRegion,
} from './regionStore';
import { openTileStore, requestPersistentStorage, type TileStoreStats } from './tileStore';

export interface StartRegionInput {
  name: string;
  bounds: BBox;
  plan: RegionPlan;
}

export interface OfflineRegionsApi {
  regions: SavedRegion[];
  /** The download running right now, if any. */
  active: { clientId: string; progress: DownloadProgress } | null;
  /**
   * Did the browser grant persistent storage?
   *
   * `null` means we have not got an answer yet. Never coerced to `true` — a
   * large tile cache without persistence is evictable under storage pressure
   * with no warning, and assuming we got it is how a region a hunter waited
   * twenty minutes for disappears overnight.
   */
  persisted: boolean | null;
  backend: TileStoreStats['backend'] | null;
  start: (input: StartRegionInput) => Promise<void>;
  resume: (clientId: string) => Promise<void>;
  cancel: () => void;
  remove: (clientId: string) => Promise<void>;
}

export interface UseOfflineRegionsOptions {
  /** Called after any change to the tile store, so coverage can re-measure. */
  onStoreChanged?: () => void;
  /** Injected by tests. */
  tileTemplate?: string;
}

export function useOfflineRegions(options: UseOfflineRegionsOptions = {}): OfflineRegionsApi {
  const { onStoreChanged, tileTemplate = DEM_TEMPLATE } = options;

  const [regions, setRegions] = useState<SavedRegion[]>([]);
  const [active, setActive] = useState<{ clientId: string; progress: DownloadProgress } | null>(
    null,
  );
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [backend, setBackend] = useState<TileStoreStats['backend'] | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const changedRef = useRef(onStoreChanged);
  changedRef.current = onStoreChanged;

  const reload = useCallback(async () => {
    setRegions(await openRegionStore().list());
  }, []);

  // --- Mount: repair records, learn what storage we actually got ------------
  useEffect(() => {
    let disposed = false;

    void (async () => {
      const store = openRegionStore();
      const all = await store.list();
      // Rule 1. A `downloading` record with no run behind it is stale by
      // definition — this hook is the only thing that starts one.
      for (const r of all) {
        if (r.status === 'downloading') {
          await store.put(
            reviseRegion(r, {
              status: 'paused',
              error: undefined,
            }),
          );
        }
      }
      if (disposed) return;
      setRegions(await store.list());

      // Ask, then report what we were given. Both halves matter: the request
      // has to happen (a large cache is evictable without it) and the answer
      // has to reach the UI (assuming a grant is how a region silently
      // vanishes).
      const granted = await requestPersistentStorage();
      if (!disposed) setPersisted(granted);

      const tiles = await openTileStore();
      if (!disposed) setBackend(tiles.backend);
    })();

    return () => {
      disposed = true;
    };
  }, []);

  // --- Leaving the page mid-download ---------------------------------------
  //
  // `pagehide` rather than `beforeunload`: mobile Safari and Chrome for Android
  // frequently discard a backgrounded tab without ever firing `beforeunload`,
  // and this is exactly the "backgrounded the tab on hotel wifi" case. The
  // record's progress is already written incrementally, so all this does is
  // stop the run cleanly; the mount repair above is the real backstop.
  useEffect(() => {
    const stop = (): void => abortRef.current?.abort();
    window.addEventListener('pagehide', stop);
    return () => window.removeEventListener('pagehide', stop);
  }, []);

  const runFor = useCallback(
    async (region: SavedRegion, tiles: TileCoord[]) => {
      const store = openRegionStore();
      const tileStore = await openTileStore();
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      let current = reviseRegion(region, {
        status: 'downloading',
        tileTotal: tiles.length,
        error: undefined,
        volatile: region.volatile || tileStore.backend === 'memory',
      });
      await store.put(current);
      setRegions(await store.list());
      setActive({ clientId: current.clientId, progress: initialProgress(tiles.length) });

      // Throttled persistence. Every tile would be a localStorage write per
      // tile; never persisting would lose the lot to a flat battery.
      let lastWrite = 0;
      const persist = async (progress: DownloadProgress, force: boolean): Promise<void> => {
        const now = Date.now();
        if (!force && now - lastWrite < 1000) return;
        lastWrite = now;
        current = {
          ...current,
          tileDone: progress.stored,
          tileFailed: progress.failed,
          bytes: region.bytes + progress.bytes,
          updatedAt: now,
        };
        await store.put(current);
      };

      const result = await runDownload({
        tiles,
        store: tileStore,
        fetchTile: httpTileFetcher((t) => demTileUrl(t, tileTemplate)),
        signal: controller.signal,
        onProgress: (progress) => {
          setActive({ clientId: current.clientId, progress });
          void persist(progress, false);
          // Tiles have landed; whatever the coverage badge is showing is now
          // out of date. Cheap — it only clears a memo.
          invalidateCoverageCache();
        },
      });

      const status: SavedRegion['status'] =
        result.phase === 'failed'
          ? 'failed'
          : result.phase === 'paused'
            ? 'paused'
            : result.failed > 0
              ? 'partial'
              : 'ready';

      current = reviseRegion(current, {
        status,
        tileDone: result.stored,
        tileFailed: result.failed,
        bytes: region.bytes + result.bytes,
        error: result.error,
        volatile: current.volatile || tileStore.backend === 'memory',
      });
      await store.put(current);
      lastWrite = Date.now();

      setRegions(await store.list());
      setActive(
        result.phase === 'downloading' || result.phase === 'checking'
          ? { clientId: current.clientId, progress: result }
          : null,
      );

      invalidateCoverageCache();
      changedRef.current?.();
    },
    [tileTemplate],
  );

  const start = useCallback(
    async (input: StartRegionInput) => {
      const now = Date.now();
      const region: SavedRegion = {
        clientId: newClientId(),
        syncState: 'local',
        version: 1,
        name: input.name,
        bounds: input.bounds,
        minZoom: input.plan.minZoom,
        maxZoom: input.plan.maxZoom,
        createdAt: now,
        updatedAt: now,
        status: 'downloading',
        tileTotal: input.plan.tileCount,
        tileDone: 0,
        tileFailed: 0,
        bytes: 0,
        volatile: false,
      };
      await runFor(region, input.plan.tiles);
    },
    [runFor],
  );

  const resume = useCallback(
    async (clientId: string) => {
      const store = openRegionStore();
      const region = await store.get(clientId);
      if (!region) return;
      // Re-derive the plan from the record rather than storing 100 000 tile
      // coordinates. `planZooms` is deterministic in its inputs and the record
      // pins the zoom span, so the second run asks for exactly the same tiles
      // as the first — and the downloader re-probes the store anyway, so a tile
      // that landed before the interruption is skipped rather than refetched.
      const plan = planZooms(region.bounds, region.minZoom, region.maxZoom);
      await runFor(region, plan.tiles);
    },
    [runFor],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const remove = useCallback(
    async (clientId: string) => {
      const store = openRegionStore();
      const region = await store.get(clientId);
      if (!region) return;
      const others = (await store.list()).filter((r) => r.clientId !== clientId);

      // Rule 4: only tiles nothing else claims. Built as a Set of ids rather
      // than by re-probing per tile, because a neighbouring region can be
      // 100 000 tiles and this must not become an O(n×m) walk on a phone.
      const keep = new Set<string>();
      for (const other of others) {
        for (const t of planZooms(other.bounds, other.minZoom, other.maxZoom).tiles) {
          keep.add(tileId(t));
        }
      }

      const tileStore = await openTileStore();
      const mine = planZooms(region.bounds, region.minZoom, region.maxZoom).tiles;
      for (const t of mine) {
        if (keep.has(tileId(t))) continue;
        await tileStore.delete(demTileKey(t)).catch(() => false);
      }

      await store.remove(clientId);
      setRegions(await store.list());
      invalidateCoverageCache();
      changedRef.current?.();
    },
    [],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  return { regions, active, persisted, backend, start, resume, cancel, remove };
}

function initialProgress(total: number): DownloadProgress {
  return { phase: 'checking', total, stored: 0, fetched: 0, failed: 0, bytes: 0 };
}

/**
 * Tiles a region owns that no other saved region also needs.
 *
 * Exported for the delete confirmation, which has to be able to say how much
 * space a delete actually frees — "this will free 4 tiles" for an area that
 * overlaps everything else you have saved is information a user needs *before*
 * they press it, not a surprise afterwards.
 */
export function exclusiveTileCount(region: SavedRegion, others: SavedRegion[]): number {
  const keep = new Set<string>();
  for (const other of others) {
    if (other.clientId === region.clientId) continue;
    for (const t of planZooms(other.bounds, other.minZoom, other.maxZoom).tiles) {
      keep.add(tileId(t));
    }
  }
  let n = 0;
  for (const t of planZooms(region.bounds, region.minZoom, region.maxZoom).tiles) {
    if (!keep.has(tileId(t))) n++;
  }
  return n;
}
