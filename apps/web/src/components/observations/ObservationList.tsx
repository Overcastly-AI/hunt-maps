/**
 * Recent observations — a quick "what did I actually log" check, most recent
 * first. A blank sit renders with its own distinct label rather than
 * collapsing into "Sit, 0" — CLAUDE.md's rule against a bare number where a
 * confidence matters extends here in spirit: "0" alone reads as a data gap,
 * and a hunter scanning this list needs to trust that a blank really was
 * recorded, not silently dropped.
 */

import { Chip } from '@hunt-maps/design';
import type { ObservationDto } from '../../lib/api/types';
import { SEX_LABEL, SIGN_TYPE_LABEL, SPECIES_LABEL, observationKindMeta } from './meta';

export interface ObservationListProps {
  observations: ObservationDto[];
  queuedIds: Set<string>;
  limit?: number;
}

export function ObservationList({ observations, queuedIds, limit = 12 }: ObservationListProps) {
  if (observations.length === 0) {
    return <p className="rl-hint">Nothing logged yet for this property.</p>;
  }

  const sorted = [...observations]
    .sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime())
    .slice(0, limit);

  return (
    <ul className="obs-list">
      {sorted.map((o) => (
        <li key={o.id} className="obs-row">
          <div className="obs-row__main">
            <span className="obs-row__headline">{headline(o)}</span>
            <span className="obs-row__meta">{formatWhen(o.observedAt)}</span>
          </div>
          {queuedIds.has(o.id) && (
            <Chip tone="info" glyph="◐" title="Saved on this device — will sync once you have signal.">
              Queued
            </Chip>
          )}
        </li>
      ))}
    </ul>
  );
}

function headline(o: ObservationDto): string {
  if (o.kind === 'SIT') {
    if (o.isBlankSit) return 'Blank sit — 0 sightings';
    const who = o.species ? `${SPECIES_LABEL[o.species]}${o.sex ? ` ${SEX_LABEL[o.sex].toLowerCase()}` : ''}` : '';
    return who ? `Sit — saw ${who}${o.count > 1 ? ` (${o.count})` : ''}` : 'Sit — saw something';
  }
  if (o.kind === 'SIGN') {
    return o.signType ? SIGN_TYPE_LABEL[o.signType] : 'Sign';
  }
  const kindLabel = observationKindMeta(o.kind).label;
  const who = o.species ? SPECIES_LABEL[o.species] : '';
  const sexLabel = o.sex && o.sex !== 'UNKNOWN' ? ` ${SEX_LABEL[o.sex].toLowerCase()}` : '';
  const countLabel = o.count > 1 ? ` ×${o.count}` : '';
  return who ? `${kindLabel} — ${who}${sexLabel}${countLabel}` : kindLabel;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
