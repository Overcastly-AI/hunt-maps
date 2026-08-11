import { Chip } from '@hunt-maps/design';
import { LAYERS, speciesBlockedReason } from '../lib/layers';
import type { WireSpecies } from '../lib/api/types';
import type { CoverageState } from '../lib/offline/coverage';
import { describeCoverage } from '../lib/offline/coverageLabel';

export interface DesktopStatusBadgesProps {
  coverage: CoverageState | null;
  targetSpecies?: WireSpecies | null;
}

/**
 * Floats top-left over the map, for state that must not hide behind a
 * control the hunter has to go open (the founder's brief for Direction C,
 * verbatim: "e.g. `Elk · no bedding model`").
 *
 * Two things land here, both because CLAUDE.md treats silently hiding them as
 * the worst failure class this product has, not because they are visually
 * convenient to group:
 *
 *  - **Offline coverage** (`R8`) — whether the ground on screen is actually
 *    downloaded. Used to live only inside the Layers sheet header; the rail
 *    replaces that sheet's always-open real estate with a compact chip list
 *    that has no room for a full sentence, so this is now the one place the
 *    coverage verdict is guaranteed visible regardless of which rail section
 *    the hunter is looking at.
 *  - **A species/model gap** (R84/R85) — e.g. an elk property, where the
 *    bedding model has no evidentiary basis at all (`docs/EVIDENCE.md` Pass
 *    7). This used to surface only once bedding was toggled on inside the
 *    sheet; stated here proactively, because a hunter deciding *whether* to
 *    reach for a layer needs the caveat before the attempt, not as a
 *    disabled-checkbox surprise.
 *
 * Neither chip's full sentence disappears to fit the badge — see
 * `.rail-status-badge__detail` (`apps/web/src/index.css`): `visibility`
 * hidden at rest, visible on hover/focus, same reachable-not-vanished
 * contract `LayerChip`'s blurb uses.
 */
export function DesktopStatusBadges({ coverage, targetSpecies }: DesktopStatusBadgesProps) {
  const offline = describeCoverage(coverage);
  const speciesGaps = LAYERS.map((l) => ({
    layer: l,
    reason: speciesBlockedReason(l, targetSpecies),
  })).filter((x): x is { layer: (typeof LAYERS)[number]; reason: string } => Boolean(x.reason));

  return (
    <div className="rail-status-badges">
      <span className="rail-status-badge rl-glass" tabIndex={0}>
        <span data-testid="coverage-chip">
          <Chip tone={offline.tone} glyph={offline.glyph}>
            {offline.chip}
          </Chip>
        </span>
        <span className="rail-status-badge__detail" data-testid="coverage-detail">
          {offline.detail}
        </span>
      </span>

      {speciesGaps.map(({ layer, reason }) => (
        <span className="rail-status-badge rl-glass" tabIndex={0} key={layer.id}>
          <Chip tone="warn" glyph="!">
            {targetSpecies?.replace(/_/g, ' ').toLowerCase() ?? 'this species'} · no{' '}
            {layer.label.toLowerCase()} model
          </Chip>
          <span className="rail-status-badge__detail">{reason}</span>
        </span>
      ))}
    </div>
  );
}
