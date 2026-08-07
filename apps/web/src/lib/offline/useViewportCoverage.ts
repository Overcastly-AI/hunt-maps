/**
 * Keep offline coverage in step with the map, honestly.
 *
 * The four rules here are each a direct answer to how the old
 * sampled-once-at-mount boolean failed:
 *
 *  1. **Recompute when the view changes.** Bound to `move`, not only `moveend`,
 *     so a `flyTo` crossing out of a downloaded region does not display the
 *     origin's answer for the whole animation.
 *  2. **Never show a stale answer as current.** The instant the needed tile
 *     range changes, the state becomes `checking`. There is no path that
 *     carries a previous view's `covered` into a new view.
 *  3. **Do not thrash storage.** Probing is debounced, and a move that does not
 *     change *which tiles are needed* does not re-probe at all. The signature is
 *     computed from tile *ranges* (O(1)) rather than an enumeration, because
 *     this runs on every frame of a pan.
 *  4. **Drop stale results.** Each run carries an epoch and an `AbortSignal`; a
 *     slow probe that resolves after the user has panned on is discarded rather
 *     than overwriting a newer answer with an older one.
 *
 * A store that cannot be opened, or a lookup that throws, becomes `unavailable`
 * — never `0% covered` and certainly never `covered`. "We could not read your
 * storage" and "your storage is empty" call for different actions.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { boundsToBBox, demSourceZoom, demTileRanges } from '../map/demTiles';
import {
  invalidateCoverageCache,
  queryViewportCoverage,
  type CoverageState,
} from './coverage';

export interface UseViewportCoverageResult {
  state: CoverageState;
  /** Re-probe now, ignoring the debounce, the signature cache and the memo. */
  refresh: () => void;
}

const DEBOUNCE_MS = 180;

const CHECKING: CoverageState = { kind: 'checking' };

export function useViewportCoverage(
  map: maplibregl.Map | null,
  options: { debounceMs?: number } = {},
): UseViewportCoverageResult {
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const [state, setState] = useState<CoverageState>(CHECKING);

  const epoch = useRef(0);
  const signature = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const probe = useCallback(async () => {
    if (!map) return;
    const runEpoch = ++epoch.current;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    const bounds = boundsToBBox(map.getBounds());
    const zoom = map.getZoom();

    try {
      const result = await queryViewportCoverage({ bounds, zoom, signal: controller.signal });
      if (epoch.current !== runEpoch) return;
      setState({ kind: 'result', result });
    } catch (err) {
      if (epoch.current !== runEpoch) return;
      setState({
        kind: 'unavailable',
        reason: err instanceof Error ? err.message : 'storage error',
      });
    }
  }, [map]);

  const schedule = useCallback(
    (force: boolean) => {
      if (!map) return;

      // O(1) fingerprint of the needed tile set: the integer tile ranges at the
      // zoom MapLibre is actually requesting. Enumerating tiles here would run
      // on every frame of a pan for no extra information.
      const sig = demTileRanges(boundsToBBox(map.getBounds()), demSourceZoom(map.getZoom()))
        .map((r) => `${r.z}:${r.x0}-${r.x1}:${r.y0}-${r.y1}`)
        .join('|');

      if (!force && sig === signature.current) return; // same tiles, same answer
      signature.current = force ? null : sig;

      // Invalidate immediately: everything between here and the probe resolving
      // is honestly "we do not know yet", which is the entire point.
      epoch.current++;
      inFlight.current?.abort();
      setState((prev) => (prev.kind === 'checking' ? prev : CHECKING));

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        signature.current = sig;
        void probe();
      }, debounceMs);
    },
    [map, probe, debounceMs],
  );

  useEffect(() => {
    if (!map) return;

    const onMove = () => schedule(false);
    map.on('move', onMove);
    map.on('moveend', onMove);

    schedule(true); // first answer immediately, not on the first pan

    return () => {
      map.off('move', onMove);
      map.off('moveend', onMove);
      if (timer.current) clearTimeout(timer.current);
      inFlight.current?.abort();
      // Any probe still in flight belongs to a component that no longer exists.
      epoch.current++;
    };
  }, [map, schedule]);

  const refresh = useCallback(() => {
    // A download (or a delete) just changed what is on disk underneath us, so
    // the memoised per-tile answers are exactly the thing that must not be
    // trusted here.
    invalidateCoverageCache();
    schedule(true);
  }, [schedule]);

  return { state, refresh };
}
