/**
 * Keeps the coverage answer honest as the map moves.
 *
 * ## The two rules that make this not-a-lie
 *
 * 1. **The moment the camera moves, the previous answer is void.** Not on
 *    `moveend`, not after the debounce — on `movestart`. The whole defect this
 *    replaces was a stale green claim about ground the user had left, and a
 *    debounce window is just a shorter version of the same bug. So a pan flips
 *    the state to `checking` immediately and it stays there until a real
 *    measurement lands.
 * 2. **A late answer never overwrites a newer one.** Each run carries a token;
 *    a result whose token is stale is dropped. Otherwise a slow probe for the
 *    view you panned away from can arrive after the fast probe for the view you
 *    are looking at, and paint the wrong verdict over the right one.
 *
 * The *work* is debounced (`moveend` plus a short settle) because probing OPFS
 * mid-flick costs battery for an answer that is about to be replaced. Saying
 * "I do not know" is not debounced, because that is always true the instant the
 * view changes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { boundsToBBox } from '../map/demTiles';
import { invalidateCoverageCache, queryViewportCoverage, type CoverageState } from './coverage';

/** Long enough to skip the frames of a flick, short enough to feel immediate. */
const SETTLE_MS = 250;

export interface ViewportCoverage {
  coverage: CoverageState;
  /**
   * Re-measure now, ignoring memoised probe results.
   *
   * For after a region download or delete: the store changed underneath us and
   * the cached answer would otherwise keep reporting the pre-download verdict.
   */
  refresh: () => void;
}

export function useViewportCoverage(map: maplibregl.Map | null): ViewportCoverage {
  const [state, setState] = useState<CoverageState>({ kind: 'checking' });
  const token = useRef(0);
  const refreshRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!map) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const run = (): void => {
      const mine = ++token.current;
      void queryViewportCoverage({
        bounds: boundsToBBox(map.getBounds()),
        zoom: map.getZoom(),
      })
        .then((result) => {
          if (disposed || mine !== token.current) return;
          setState({ kind: 'result', result });
        })
        .catch((err: unknown) => {
          if (disposed || mine !== token.current) return;
          // Degrade loudly. An unreadable store is not an empty store, and
          // collapsing the two would tell a user to download something they
          // may already have.
          setState({
            kind: 'unavailable',
            reason: err instanceof Error ? err.message : 'unknown storage error',
          });
        });
    };

    const invalidate = (): void => {
      // Bump the token so any in-flight probe for the old view is discarded
      // rather than landing as an answer about the new one.
      token.current++;
      setState((prev) => (prev.kind === 'checking' ? prev : { kind: 'checking' }));
    };

    const schedule = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, SETTLE_MS);
    };

    const onMoveStart = (): void => {
      invalidate();
      if (timer) clearTimeout(timer);
    };

    refreshRef.current = () => {
      invalidate();
      invalidateCoverageCache();
      run();
    };

    map.on('movestart', onMoveStart);
    map.on('zoomstart', onMoveStart);
    map.on('moveend', schedule);
    map.on('zoomend', schedule);

    // First measurement. `once('load')` if the style is not up yet — the store
    // is readable before the map is, but reading `getBounds()` early gives the
    // pre-hash default view rather than the deep-linked one.
    //
    // `idle` as well, and not belt-and-braces: `isStyleLoaded()` is false while
    // *any* source still has tiles in flight, which offline is close to always,
    // so this branch is the one that runs — and if `load` had already fired
    // before this hook subscribed, a lone `once('load')` would never fire and
    // the badge would sit on "Checking…" forever. The same trap silently
    // stopped the coverage overlay from ever installing; see
    // `coverageOverlay.ts#styleReady`. `idle` fires once the map settles,
    // including when every tile errored, so there is always a second chance.
    // A duplicate probe is harmless: it is memoised and idempotent.
    if (map.isStyleLoaded()) schedule();
    else {
      map.once('load', schedule);
      map.once('idle', schedule);
    }

    return () => {
      disposed = true;
      refreshRef.current = () => undefined;
      if (timer) clearTimeout(timer);
      map.off('movestart', onMoveStart);
      map.off('zoomstart', onMoveStart);
      map.off('moveend', schedule);
      map.off('zoomend', schedule);
      map.off('load', schedule);
      map.off('idle', schedule);
    };
  }, [map]);

  const refresh = useCallback(() => refreshRef.current(), []);

  return { coverage: state, refresh };
}
