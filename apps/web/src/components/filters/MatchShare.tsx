/**
 * Renders `useLiveMatchShare`'s state honestly — see that hook's doc comment
 * for the three rules this component exists to keep visible on screen rather
 * than compressed into a bare percentage.
 */

import { Callout, Chip } from '@hunt-maps/design';
import type { MatchShareState } from './useLiveMatchShare';

export function MatchShare({ state }: { state: MatchShareState }) {
  switch (state.kind) {
    case 'empty':
      return (
        <p className="rl-hint" data-testid="match-share-empty">
          Add a condition above to see how much of the view on screen this filter matches.
        </p>
      );

    case 'negation-unreliable':
      // Deliberately no number here at all — see `useLiveMatchShare`'s doc
      // comment and `BACKLOG R56`. A hidden statistic is the honest choice
      // when the only number available is known to be wrong.
      return (
        <div data-testid="match-share-negation">
          <Callout tone="warn" role="status">
            <p>
              <strong>Match share hidden.</strong> This filter negates a condition, and a negated
              condition currently reads unmeasured ground as a match — the percentage would be
              wrong, not just imprecise. Remove the "Not" above to see a live share.
            </p>
          </Callout>
        </div>
      );

    case 'needs-wind':
      return (
        <div data-testid="match-share-needs-wind">
          <Callout tone="warn" role="status">
            <p>Set a wind direction to compute a match share — this filter reads wind-dependent terrain.</p>
          </Callout>
        </div>
      );

    case 'no-view':
      return (
        <p className="rl-hint" data-testid="match-share-no-view">
          Waiting on the map view to measure against.
        </p>
      );

    case 'loading':
      return (
        <p className="rl-hint" role="status" aria-live="polite" data-testid="match-share-loading">
          Measuring…
        </p>
      );

    case 'offline':
      return (
        <div data-testid="match-share-offline">
          <Callout tone="warn" role="status">
            <p>
              Match share needs a connection — try again once you have signal. Everything else
              about this filter, including how it renders on the map, still works offline.
            </p>
          </Callout>
        </div>
      );

    case 'error':
      return (
        <div data-testid="match-share-error">
          <Callout tone="warn" role="status">
            <p>Could not compute a match share: {state.message}</p>
          </Callout>
        </div>
      );

    case 'result': {
      const pct = (state.matchShare * 100).toFixed(state.matchShare < 0.01 ? 2 : 1);
      return (
        <div className="rl-match-share" data-testid="match-share-result">
          <div className="rl-match-share__headline">
            <Chip tone={state.matchShare > 0.35 ? 'warn' : 'info'}>{pct}% of the view</Chip>
          </div>
          <p className="rl-hint">
            Share of the map view currently on screen
            {state.zoomUsed !== Math.round(state.zoomRequested)
              ? `, measured at zoom ${state.zoomUsed} (your view is at ${Math.round(state.zoomRequested)})`
              : ''}
            . Cells with no elevation data count as non-matches in this figure, not as measured
            ground — {state.cellCount.toLocaleString()} cells total.
          </p>
          {state.advice && <p className="rl-hint rl-match-share__advice">{state.advice}</p>}
        </div>
      );
    }
  }
}
