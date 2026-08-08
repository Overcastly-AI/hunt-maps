/**
 * The live match-share readout — "this filter matches N% of the view on
 * screen."
 *
 * ## Why this is a statistic, not a number (`CLAUDE.md`, `docs/BACKLOG.md` `R2`)
 *
 * Three honesty rules this hook exists to enforce, none of them optional:
 *
 *  1. **State what it is a share *of*.** `POST /terrain/filters/evaluate`
 *     (`TerrainController`) answers for a bounding box at a zoom, not "your
 *     property" — a property is a polygon, not a rectangle, and the API has
 *     no polygon-clipping path today. So this hook is deliberately scoped to
 *     *the map viewport currently on screen*, mirroring
 *     `lib/offline/coverage.ts`'s own rule ("describes the view on screen,
 *     and nothing else") rather than overclaiming property coverage the
 *     underlying call cannot actually measure.
 *  2. **Never silently count an abstained cell as a non-match.**
 *     `TerrainService.evaluateArea` (server) divides matched cells by *every*
 *     cell in the requested extent, including any with no elevation data —
 *     that denominator choice is the server's, and this hook's job is to say
 *     so on screen (`describeMatchShare` below), not to hide it behind a bare
 *     percentage.
 *  3. **`BACKLOG R56` — a negated predicate is not evaluated at all.**
 *     `evaluateFilter` reads a void cell as `false` for an ordinary predicate
 *     and `not` flips that to `true`, so a filter containing any negation
 *     would report a match share inflated by every downloaded tile's edge.
 *     Rather than surface a number known to be wrong, this hook refuses to
 *     call the endpoint at all once `containsNegation` is true — "show
 *     nothing rather than a number that is wrong" (the task brief, verbatim).
 */

import { useEffect, useRef, useState } from 'react';
import type { TerrainPredicate } from '@hunt-maps/terrain';
import type { BBox } from '@hunt-maps/terrain';
import { ApiError } from '../../lib/api/client';
import { terrainApi } from '../../lib/api/terrain';
import { containsNegation, hasAnyCondition, windDependentMetrics } from './predicateUtils';

/** Server DTO clamp (`EvaluateFilterDto`, `terrain.controller.ts`) — restated so the hook can clamp before asking, and say so if it had to. */
const MIN_ZOOM = 8;
const MAX_ZOOM = 16;

/** Debounce so dragging a slider does not fire a request per frame. */
const DEBOUNCE_MS = 500;

export type MatchShareState =
  | { kind: 'empty' }
  | { kind: 'negation-unreliable' }
  | { kind: 'needs-wind'; metrics: string[] }
  | { kind: 'no-view' }
  | { kind: 'loading' }
  | { kind: 'offline' }
  | { kind: 'error'; message: string }
  | {
      kind: 'result';
      matchShare: number;
      cellCount: number;
      advice: string | null;
      zoomUsed: number;
      zoomRequested: number;
    };

export interface LiveMatchShareOptions {
  predicate: TerrainPredicate;
  viewport: { bounds: BBox; zoom: number } | null;
  windFromDeg: number | null;
  atUtc: Date;
  demSource?: string;
  /** Tests/QA harness override — production uses the real endpoint. */
  evaluate?: typeof terrainApi.evaluateFilter;
}

export function useLiveMatchShare(options: LiveMatchShareOptions): MatchShareState {
  const { predicate, viewport, windFromDeg, atUtc, demSource } = options;
  const evaluate = options.evaluate ?? terrainApi.evaluateFilter;
  const [state, setState] = useState<MatchShareState>({ kind: 'no-view' });
  const requestId = useRef(0);

  const atUtcMs = atUtc.getTime();

  useEffect(() => {
    const id = ++requestId.current;

    if (!hasAnyCondition(predicate)) {
      setState({ kind: 'empty' });
      return;
    }
    if (containsNegation(predicate)) {
      setState({ kind: 'negation-unreliable' });
      return;
    }
    const needsWind = windDependentMetrics(predicate);
    if (needsWind.length > 0 && windFromDeg === null) {
      setState({ kind: 'needs-wind', metrics: needsWind });
      return;
    }
    if (!viewport) {
      setState({ kind: 'no-view' });
      return;
    }

    setState({ kind: 'loading' });
    const zoomUsed = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(viewport.zoom)));

    const timer = setTimeout(() => {
      evaluate({
        bbox: viewport.bounds,
        zoom: zoomUsed,
        predicate: predicate as unknown as Record<string, unknown>,
        demSource,
        windFromDeg: windFromDeg ?? undefined,
        atUtc: new Date(atUtcMs).toISOString(),
      })
        .then((result) => {
          if (requestId.current !== id) return; // superseded by a newer edit
          const withCells = result as typeof result & { cellCount?: number };
          setState({
            kind: 'result',
            matchShare: result.matchShare,
            cellCount: withCells.cellCount ?? 0,
            advice: result.advice,
            zoomUsed,
            zoomRequested: viewport.zoom,
          });
        })
        .catch((err: unknown) => {
          if (requestId.current !== id) return;
          if (err instanceof ApiError && err.kind === 'network') {
            setState({ kind: 'offline' });
            return;
          }
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Could not compute a match share.',
          });
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `predicate`/`viewport` are the meaningful identities here — both are
    // replaced (never mutated) by every editor change, so reference equality
    // is exactly "did anything this hook cares about change".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [predicate, viewport, windFromDeg, atUtcMs, demSource, evaluate]);

  return state;
}
