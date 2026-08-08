/**
 * "Can I hunt this stand today?" — the flagship answer, surfaced on the
 * stand's own detail view.
 *
 * `GET /waypoints/:id/wind-check` blends synoptic wind with modelled
 * thermals server-side; this component only renders what comes back. The one
 * rule that is non-negotiable here (CLAUDE.md, "never be confidently wrong
 * about terrain"): **no wind set means no wind check**, not a wind check
 * against a made-up direction. `useWaypointWindCheck` already refuses to
 * fetch when `windFromDeg` is `null` — this renders that refusal as a stated
 * reason, greyed out, exactly like a blocked layer in `LayersSheet`.
 */

import { Chip, type ChipTone } from '@hunt-maps/design';
import { useWaypointWindCheck } from '../../lib/api/waypoints';

export interface WindCheckCardProps {
  waypointId: string;
  windFromDeg: number | null;
  atUtc: Date;
  /** Set by the caller (`ConditionsBar`'s own state) — used only in the "no wind" message so the reason points at the real control. */
  onSetWind?: () => void;
}

const RATING_TONE: Record<string, ChipTone> = {
  good: 'ok',
  marginal: 'warn',
  burned: 'danger',
};

const RATING_LABEL: Record<string, string> = {
  good: 'Good to sit',
  marginal: 'Marginal',
  burned: 'Burned — scent blows toward the approach',
};

export function WindCheckCard({ waypointId, windFromDeg, atUtc, onSetWind }: WindCheckCardProps) {
  const { data, isLoading, isError } = useWaypointWindCheck(waypointId, windFromDeg, atUtc.toISOString());

  if (windFromDeg === null) {
    return (
      <section className="rl-panel wp-windcheck wp-windcheck--blocked" aria-label="Wind check">
        <h4 className="rl-panel__title">Wind check</h4>
        <p className="rl-hint">
          Set a wind direction to see whether this stand is huntable today — without one, this would be a guess
          rendered as an answer.
          {onSetWind && (
            <>
              {' '}
              <button type="button" className="rl-btn rl-btn--link wp-inline-link" onClick={onSetWind}>
                Set wind
              </button>
            </>
          )}
        </p>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className="rl-panel wp-windcheck" aria-label="Wind check">
        <h4 className="rl-panel__title">Wind check</h4>
        <p className="rl-hint">Checking…</p>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className="rl-panel wp-windcheck" aria-label="Wind check">
        <h4 className="rl-panel__title">Wind check</h4>
        <p className="rl-hint">Could not reach the wind check right now. Terrain and layers still work offline.</p>
      </section>
    );
  }

  return (
    <section className="rl-panel wp-windcheck" aria-label="Wind check">
      <div className="rl-panel__head">
        <h4 className="rl-panel__title">Wind check</h4>
        <Chip tone={RATING_TONE[data.rating] ?? 'neutral'}>{RATING_LABEL[data.rating] ?? data.rating}</Chip>
      </div>
      <dl className="readout">
        <dt>Wind</dt>
        <dd>
          {Math.round(data.windFromDeg)}° {data.windOctant}
        </dd>
        <dt>Thermals</dt>
        <dd>{thermalLabel(data.thermalPhase)}</dd>
        {data.thermalScentAzimuthDeg !== null && (
          <>
            <dt>Scent carries toward</dt>
            <dd>{Math.round(data.thermalScentAzimuthDeg)}°</dd>
          </>
        )}
      </dl>
      {data.reasons.length > 0 && (
        <ul className="wp-windcheck__reasons">
          {data.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <p className="rl-hint">
        Blends the wind you set with modelled thermal drift for this slope and time of day. Resolves against the
        elevation on this device, so it works with no signal.
      </p>
    </section>
  );
}

function thermalLabel(phase: string): string {
  if (phase === 'rising') return 'Rising — scent moves upslope';
  if (phase === 'sinking') return 'Sinking — scent pools in draws';
  return 'Switching — unreliable window';
}
