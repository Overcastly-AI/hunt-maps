/**
 * Keep offline coverage in step with the map, honestly.
 *
 * The rules this hook exists to enforce, all of which the old
 * sample-once-at-mount boolean broke:
 *
 *  1. **Recompute when the view changes.** Bound to `move`, not just `moveend`,
 *     so a `flyTo` that crosses two states does not display the origin's answer
 *     for the whole animation.
 *  2. **Never show a stale answer as current.** The moment the needed tile set
 *     changes, the state becomes `checking`. There is no code path that carries
 *     the previous view's `covered` into a new view.
 *  3. **Do not thrash the store.** The probe is debounced, and a move that does
 *     not change *which tiles* are needed (a few pixels of pan) does not
 *     re-query at all — comparing tile-set signatures rather than centres is
 *     what makes the badge stable while the map is nudged.
 *  4. **Drop stale results.** Each run carries an epoch; a slow probe that
 *     resolves after the user has already panned on is discarded rather than
 *     overwriting a newer answer with an older one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { demTilesForView, tileSetSignature } from '../map/demTiles';
import { openTileStore, type TileStore } from './tileStore';
import { queryViewportCoverage, type ViewportCoverage } from './coverage';

export interface UseViewportCoverageResult {
  coverage: ViewportCoverage | null;
  /** Re-probe now, ignoring the signature cache. Call after a region download. */
  refresh: () => void;
}

const DEBOUNCE_MS = 180;

export function useViewportCoverage(
  map: maplibregl.Map | null,
  options: { debounceMs?: number } = {},
): UseViewportCoverageResult {
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const [coverage, setCoverage] = useState<ViewportCoverage | null>(null);

  const epoch = useRef(0);
  const signature = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const probe = useCallback(async () => {
    if (!map) return;
    const runEpoch = ++epoch.current;

    const bounds = map.getBounds();
    const tiles = demTilesForView(
      {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      },
      map.getZoom(),
    );

    // A store that will not open is a first-class answer (`unavailable`), not
    // an exception and definitely not a reason to fall back to "ready".
    let store: TileStore | null = null;
    try {
      store = await openTileStore();
    } catch {
      store = null;
    }
    if (epoch.current !== runEpoch) return;

    const result = await queryViewportCoverage(store, tiles);
    if (epoch.current !== runEpoch) return;
    setCoverage(result);
  }, [map]);

  const schedule = useCallback(
    (force: boolean) => {
      if (!map) return;

      if (!force) {
        const bounds = map.getBounds();
        const tiles = demTilesForView(
          {
            west: bounds.getWest(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            north: bounds.getNorth(),
          },
          map.getZoom(),
        );
        const sig = tileSetSignature(tiles);
        if (sig === signature.current) return; // same tiles: the last answer still holds
        signature.current = sig;
      } else {
        signature.current = null;
      }

      // Invalidate immediately. Everything between here and the probe resolving
      // is honestly "we do not know yet" — which is the entire point.
      epoch.current++;
      setCoverage((prev) => (prev && prev.state === 'checking' ? prev : emptyChecking(prev)));

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void probe();
      }, debounceMs);
    },
    [map, probe, debounceMs],
  );

  useEffect(() => {
    if (!map) return;

    const onMove = () => schedule(false);
    const onMoveEnd = () => schedule(false);
    map.on('move', onMove);
    map.on('moveend', onMoveEnd);

    // First answer, immediately — not on the first pan.
    schedule(true);

    return () => {
      map.off('move', onMove);
      map.off('moveend', onMoveEnd);
      if (timer.current) clearTimeout(timer.current);
      // Any probe still in flight belongs to a component that no longer exists.
      epoch.current++;
    };
  }, [map, schedule]);

  const refresh = useCallback(() => schedule(true), [schedule]);

  return { coverage, refresh };
}

/**
 * The indeterminate answer.
 *
 * Carries the previous zoom only so the detail line does not flash a bogus
 * zoom 0 mid-pan; every count is zeroed, so nothing about the old view can be
 * mistaken for a measurement of the new one.
 */
function emptyChecking(previous: ViewportCoverage | null): ViewportCoverage {
  return {
    state: 'checking',
    zoom: previous?.zoom ?? 0,
    neededCount: 0,
    probedCount: 0,
    presentCount: 0,
    sampled: false,
    fraction: 0,
    present: [],
    missing: [],
    backend: previous?.backend ?? null,
  };
}
