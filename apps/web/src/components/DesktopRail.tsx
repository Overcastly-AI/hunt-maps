import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Callout, LayerChip, PopoverAnchor, SegmentedControl } from '@hunt-maps/design';
import { LAYER_GROUPS, LAYERS, speciesBlockedReason, type LayerDefinition } from '../lib/layers';
import type { WireSpecies } from '../lib/api/types';
import {
  DEM_SOURCE,
  DEM_SOURCES,
  setDemSourceOverride,
  type DemSourceDescriptor,
} from '../lib/map/demSource';
import type { DemSourceCoverageState } from '../lib/map/demSourceCoverage';
import { reloadApp } from '../lib/reloadApp';
import type { SavedFilterSummary } from './LayersSheet';
import type { SavedFilterDto } from '../lib/api';

export type DesktopRailTab = 'layers' | 'stands' | 'observations';

export interface DesktopRailProps {
  propertyName: string | null;
  active: Set<string>;
  onToggleLayer: (id: string) => void;
  windFromDeg: number | null;
  targetSpecies?: WireSpecies | null;
  savedFilters: SavedFilterSummary[];
  onToggleFilter: (id: string) => void;
  onNewFilter: () => void;
  onEditFilter: (filter: SavedFilterDto) => void;
  canCreateFilters?: boolean;
  demCoverage?: DemSourceCoverageState;
  atLabel: string;
  windOctant: string | null;
  thermal?: { phase: string; note: string } | null;
  onWindClick: () => void;
  onTimeClick: () => void;
  windEditor?: ReactNode;
  timeEditor?: ReactNode;
  tab: DesktopRailTab;
  onTabChange: (tab: DesktopRailTab) => void;
}

/**
 * Direction C — the thin dense rail (`docs/ROADMAP.md`, the founder's pick
 * off three desktop chrome directions, 2026-08-11).
 *
 * Replaces the 360px drawer (`LayersSheet` inside `.rl-drawer`), which sat
 * pinned top-left running to the command bar and covered ~25% of a 1440×900
 * window *while open* — the only route to Layers/Stands/Sightings, so in
 * practice it was open constantly. This is the fix, measured: a 240px rail
 * docked to the right edge, translucent over the map, with everything
 * reachable with no scrolling — see `ui-invariants.spec.ts` group 14 for the
 * invariant that proves it rather than just asserting it once by eye.
 *
 * `LayersSheet` (`components/LayersSheet.tsx`) is untouched and still mounts
 * unconditionally below 861px (`useIsDesktopChrome`) — this is a genuinely
 * different component tree for a genuinely different chassis, not the same
 * markup reflowed by a media query. The density here comes from three moves,
 * all deliberate trade-offs against the mobile sheet, not a smaller version
 * of it:
 *
 *  1. **No always-visible blurb, opacity slider or legend per layer.** The
 *     one-sentence explanation CLAUDE.md non-negotiable #6 requires is still
 *     there — every `LayerChip` carries it as `title` (hover) and an
 *     `aria-describedby` target (`.rl-chip-row__desc`, visible on hover/
 *     focus) — it is reachable, never deleted. Opacity stays at each layer's
 *     tuned `defaultOpacity`; per-layer live adjustment is not offered here.
 *  2. **A two-column chip grid, not a single tall list.** The founder's own
 *     mock called for ~26px rows; a literal 26px row fails this app's own
 *     44×44 gloved-tap floor (`ui-invariants.spec.ts` group 3, and
 *     `LayerChip`'s own `--space-touch` label), which nothing about a mouse-
 *     first desktop rail licenses loosening — the floor is a design-system
 *     invariant, not a mobile-only one, and the existing suite already runs
 *     it at DESKTOP width. Two columns halves the vertical cost of the same
 *     44px-tall, fully tappable row instead. A follow-up to *this* pass
 *     (founder review of `01-desktop-relief.png`, same day) found the two-up
 *     column too narrow for most layer/filter names and truncating —
 *     "Bedding likeli...", and seven of seven saved filters. Collapsing to a
 *     single column was measured and does not fit either budget viewport
 *     (`ui-invariants.spec.ts` group 14's own numbers, ~910px of content
 *     against a ~589-689px box) — so `.rl-chip-row__text`
 *     (`packages/design/src/styles.css`) wraps onto a second line inside the
 *     same 44px-floor row instead of truncating, which fits because a single
 *     line of `--text-xs` never used that floor's full headroom. Group 14b is
 *     the direct assertion that nothing in the rail is cut off.
 *  3. **Elevation source is a registry-driven segmented control, not a
 *     three-row list with its own long caveat paragraph per row.** The
 *     resolution claim (`DEM_SOURCE.resolutionNote`, "not LiDAR" etc.) is
 *     still the one from `lib/map/demSource.ts` — every guard in
 *     `demSourceHonesty.test.ts`/`layers.test.ts` reads that module directly
 *     and does not know or care which component renders it — surfaced as
 *     each segment's hover `title` plus the same pre-switch confirmation
 *     callout `LayersSheet` shows, so the "this reloads, downloaded regions
 *     do not carry over" warning survives word for word.
 */
export function DesktopRail({
  propertyName,
  active,
  onToggleLayer,
  windFromDeg,
  targetSpecies = null,
  savedFilters,
  onToggleFilter,
  onNewFilter,
  onEditFilter,
  canCreateFilters = true,
  demCoverage = { kind: 'checking' },
  atLabel,
  windOctant,
  thermal,
  onWindClick,
  onTimeClick,
  windEditor,
  timeEditor,
  tab,
  onTabChange,
}: DesktopRailProps) {
  const [pendingSource, setPendingSource] = useState<DemSourceDescriptor | null>(null);

  const baseMapLayers = LAYERS.filter((l) => l.group === 'base');
  const activeBase = baseMapLayers.find((l) => active.has(l.id))?.id ?? 'satellite';

  const demBadge = DEM_SOURCE.isLidar ? '1 m' : '10 m';

  return (
    <aside className="rail" role="region" aria-label="Map layers and conditions">
      <div className="rail__scroll">
        <header className="rail__head">
          <span className="rail__property" title={propertyName ?? 'No property selected'}>
            {propertyName ?? 'No property selected'}
          </span>
          <span
            className="rl-chip rl-chip--info"
            title={`${DEM_SOURCE.label} — ${DEM_SOURCE.resolutionNote}`}
          >
            {demBadge}
          </span>
        </header>

        <section className="rail__section">
          <SegmentedControl
            ariaLabel="Base map"
            value={activeBase}
            onChange={(id) => {
              if (id !== activeBase) onToggleLayer(id);
            }}
            options={baseMapLayers.map((l) => ({ value: l.id, label: l.label, title: l.blurb }))}
          />
        </section>

        <ChipGrid
          groupIds={['relief', 'analysis', 'hunting']}
          active={active}
          windFromDeg={windFromDeg}
          targetSpecies={targetSpecies}
          onToggleLayer={onToggleLayer}
        />

        <section
          className="rail__section"
          title="Elevation source — under heavy timber a surface model measures the treetops, not the ground; bare-earth data sees through the canopy. Switching reloads the map."
        >
          <SegmentedControl
            ariaLabel="Elevation source"
            value={DEM_SOURCE.id}
            onChange={(id) => {
              if (id === DEM_SOURCE.id) return;
              const next = DEM_SOURCES[id];
              if (next) setPendingSource(next);
            }}
            options={Object.values(DEM_SOURCES).map((source) => ({
              value: source.id,
              label: demShortLabel(source),
              title: `${source.label} — ${source.resolutionNote}`,
              // Optional chaining is deliberate, not defensive filler: `result`
              // is the caller's `terrainApi.demCoverage()` response, shaped by
              // a network boundary this component does not control. A
              // malformed response (`offline-durability.spec.ts`'s API mock
              // hit this — a catch-all `[]` in place of a real
              // `DemCoverageDto`) must never crash the whole rail with no
              // error boundary to catch it; degrading to "not disabled" here
              // is no worse than the existing `kind !== 'result'` branches
              // already do for "checking"/"unavailable".
              disabled:
                source.id === 'usgs3dep-1m' &&
                demCoverage.kind === 'result' &&
                !demCoverage.result?.oneMeter?.available,
              disabledReason:
                'No 1 m data here — USGS has not surveyed this ground yet. Pick a different view, ' +
                'or use a 10 m source above.',
            }))}
          />
          {pendingSource && (
            <Callout tone="warn" role="alert">
              <p>Switch to {pendingSource.label}? This reloads the map.</p>
              <p>
                Downloaded regions are stored separately for each elevation source — what you saved
                offline under {DEM_SOURCE.label} stays exactly where it is, but you will need to
                download this area again under {pendingSource.label} to use it with no signal.
              </p>
              <div className="rl-source-confirm">
                <Button variant="ghost" onClick={() => setPendingSource(null)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    setDemSourceOverride(pendingSource.id);
                    reloadApp();
                  }}
                >
                  Switch
                </Button>
              </div>
            </Callout>
          )}
        </section>

        <section className="rail__section">
          <div className="rail__micro-label">Saved filters</div>
          {savedFilters.length === 0 ? (
            <p className="rail__empty-hint">No saved filters yet.</p>
          ) : (
            <div className="rail-chip-grid">
              {savedFilters.map((f) => (
                <LayerChip
                  key={f.id}
                  id={`filter-${f.id}`}
                  label={f.name}
                  checked={f.enabled}
                  onToggle={() => onToggleFilter(f.id)}
                  swatch={f.color}
                  blurb={f.description ?? `${f.name} — a saved terrain filter.`}
                />
              ))}
            </div>
          )}
          {canCreateFilters ? (
            <Button variant="link" onClick={onNewFilter}>
              New filter
            </Button>
          ) : (
            <p className="rail__empty-hint">Sign in to build and save your own filters.</p>
          )}
          {savedFilters.some((f) => f.editable) && (
            <div className="rail-chip-grid">
              {savedFilters
                .filter((f) => f.editable)
                .map((f) => (
                  <Button
                    key={`edit-${f.id}`}
                    variant="link"
                    onClick={() => onEditFilter(f.editable as SavedFilterDto)}
                  >
                    Edit &ldquo;{f.name}&rdquo;
                  </Button>
                ))}
            </div>
          )}
        </section>
      </div>

      <div className="rail__pinned">
        <PopoverAnchor>
          <button type="button" className="rail-stat-row" onClick={onWindClick}>
            <span className="rail-stat-row__label">Wind from</span>
            <span
              className={
                windFromDeg === null
                  ? 'rail-stat-row__value rail-stat-row__value--unset'
                  : 'rail-stat-row__value'
              }
            >
              {windFromDeg === null ? 'Not set' : `${Math.round(windFromDeg)}° ${windOctant}`}
            </span>
          </button>
          {windEditor}
        </PopoverAnchor>

        <div className="rail-stat-row" title={thermal?.note}>
          <span className="rail-stat-row__label">Thermals</span>
          <span className="rail-stat-row__value">{thermal?.phase ?? '—'}</span>
        </div>

        <PopoverAnchor>
          <button type="button" className="rail-stat-row" onClick={onTimeClick}>
            <span className="rail-stat-row__label">Date &amp; time</span>
            <span className="rail-stat-row__value">{atLabel}</span>
          </button>
          {timeEditor}
        </PopoverAnchor>

        <SegmentedControl
          ariaLabel="Panel"
          value={tab}
          onChange={onTabChange}
          options={[
            { value: 'layers', label: 'Layers' },
            { value: 'stands', label: 'Stands' },
            { value: 'observations', label: 'Sightings' },
          ]}
        />
      </div>
    </aside>
  );
}

function demShortLabel(source: DemSourceDescriptor): string {
  if (source.id === 'usgs3dep-1m') return '1 m';
  if (source.id === 'usgs3dep-13') return '10 m BE';
  return '10 m';
}

/** Wind message text kept identical to `LayersSheet.tsx`'s, so the honesty/ blocked-reason guards read the same string regardless of which chrome rendered it. */
const WIND_BLOCKED_REASON =
  'Set a wind direction first — without one this layer would render against a default, which would be misleading rather than merely wrong.';

function blockedReasonFor(
  layer: LayerDefinition,
  targetSpecies: WireSpecies | null | undefined,
  windFromDeg: number | null,
): string | undefined {
  return (
    speciesBlockedReason(layer, targetSpecies) ??
    (layer.requiresWind && windFromDeg === null ? WIND_BLOCKED_REASON : undefined)
  );
}

function ChipGrid({
  groupIds,
  active,
  windFromDeg,
  targetSpecies,
  onToggleLayer,
}: {
  groupIds: Array<(typeof LAYER_GROUPS)[number]['id']>;
  active: Set<string>;
  windFromDeg: number | null;
  targetSpecies: WireSpecies | null | undefined;
  onToggleLayer: (id: string) => void;
}) {
  return (
    <section className="rail__section" aria-label="Layers">
      <div className="rail-chip-grid">
        {groupIds.flatMap((groupId) =>
          LAYERS.filter((l) => l.group === groupId).map((layer) => {
            const blockedReason = blockedReasonFor(layer, targetSpecies, windFromDeg);
            const blurb = layer.grade
              ? `${layer.blurb} Evidence: assumed — a defensible estimate, not a measured value.`
              : layer.blurb;
            return (
              <LayerChip
                key={layer.id}
                id={`layer-${layer.id}`}
                label={layer.label}
                checked={active.has(layer.id)}
                onToggle={() => onToggleLayer(layer.id)}
                blurb={blurb}
                blockedReason={blockedReason}
              />
            );
          }),
        )}
      </div>
    </section>
  );
}
