/**
 * "Does 1 m LiDAR actually exist under the ground on screen right now?"
 *
 * ## Not the same question `useViewportCoverage` answers
 *
 * `lib/offline/useViewportCoverage.ts` asks "is DEM data for this view stored
 * *on this device*?" — a question about the offline cache. This hook asks
 * whether the data exists *upstream at all*, for the one source that does not
 * cover the whole country. Conflating the two would produce two different
 * wrong answers: a hunter told to "just download it" over ground USGS has
 * never surveyed, or a hunter told a genuine coverage gap is a download they
 * forgot to make.
 *
 * ## Same staleness discipline as the offline coverage hook, and for the same
 * reason
 *
 * A pan voids the previous answer immediately, on `movestart`, not after the
 * settle delay — the whole point of `useViewportCoverage`'s header comment
 * applies here without modification: a debounce window is just a shorter-
 * lived version of the exact bug ("stale green claim about ground the user
 * has left") this discipline exists to prevent. A late response for a view
 * the hunter has already panned away from is dropped by token rather than
 * allowed to paint the wrong verdict over the current one.
 *
 * ## Why the map centre, not the viewport
 *
 * The DEM picker's question is "does 1 m exist under the ground I am looking
 * at", not a percentage over the whole screen — unlike offline coverage,
 * where a partial answer is actionable (which corner to walk toward). One
 * point is the honest granularity for "should this option be offered right
 * now", and it costs one request instead of four.
 */

import { useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { terrainApi } from '../api/terrain';
import type { DemCoverageDto } from '../api/types';

/** Mirrors `useViewportCoverage`'s `SETTLE_MS`, tuned slightly looser: this is
 * a single lightweight point query, not a store probe, so there is less to
 * gain from a tight window, and the wind-scrub-style rapid moves a hunter
 * makes while orienting benefit from not firing on every intermediate frame. */
const SETTLE_MS = 400;

export type DemSourceCoverageState =
  | { kind: 'checking' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'result'; result: DemCoverageDto };

export function useDemSourceCoverage(map: maplibregl.Map | null): DemSourceCoverageState {
  const [state, setState] = useState<DemSourceCoverageState>({ kind: 'checking' });
  const token = useRef(0);

  useEffect(() => {
    if (!map) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const run = (): void => {
      const mine = ++token.current;
      const { lng, lat } = map.getCenter();
      void terrainApi
        .demCoverage(lng, lat)
        .then((result) => {
          if (disposed || mine !== token.current) return;
          setState({ kind: 'result', result });
        })
        .catch((err: unknown) => {
          if (disposed || mine !== token.current) return;
          // Degrade to "I do not know", never to a guess either way — see
          // `useViewportCoverage`'s identical reasoning for `unavailable`. An
          // offline hunter mid-scout must not be told "no 1 m data here" for
          // ground that has never actually been checked.
          setState({
            kind: 'unavailable',
            reason: err instanceof Error ? err.message : 'could not reach the server',
          });
        });
    };

    const invalidate = (): void => {
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

    map.on('movestart', onMoveStart);
    map.on('zoomstart', onMoveStart);
    map.on('moveend', schedule);
    map.on('zoomend', schedule);

    // Same double-hook-in as `useViewportCoverage`: `isStyleLoaded()` is
    // false while any source has tiles in flight, which is this app's normal
    // condition offline, so a lone `once('load')` would frequently never
    // fire.
    if (map.isStyleLoaded()) schedule();
    else {
      map.once('load', schedule);
      map.once('idle', schedule);
    }

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      map.off('movestart', onMoveStart);
      map.off('zoomstart', onMoveStart);
      map.off('moveend', schedule);
      map.off('zoomend', schedule);
      map.off('load', schedule);
      map.off('idle', schedule);
    };
  }, [map]);

  return state;
}
