import { useState } from 'react';
import {
  Button,
  Callout,
  Chip,
  Confidence,
  Legend,
  SectionHeading,
  Sheet,
  ToggleRow,
} from '@hunt-maps/design';
import { LAYER_GROUPS, LAYERS, missingInputs } from '../lib/layers';
import type { CoverageState } from '../lib/offline/coverage';
import { describeCoverage } from '../lib/offline/coverageLabel';
import {
  DEM_SOURCE,
  DEM_SOURCES,
  setDemSourceOverride,
  type DemSourceDescriptor,
} from '../lib/map/demSource';
import type { DemSourceCoverageState } from '../lib/map/demSourceCoverage';
import { reloadApp } from '../lib/reloadApp';
import type { SavedFilterDto } from '../lib/api';

export interface SavedFilterSummary {
  id: string;
  name: string;
  description?: string;
  color: string;
  enabled: boolean;
  /**
   * Present only for a real, persisted filter — a built-in preset (or a
   * filter fetched while signed out/offline, which never happens, but the
   * type stays honest either way) has none. Its presence is what decides
   * whether the row offers "Edit": `FilterEditor` needs the full DTO
   * (predicate, colour, opacity…), not the trimmed summary this sheet
   * renders from, and a preset was never meant to be opened there directly
   * (`FilterEditor` already refuses to show Delete for one).
   */
  editable?: SavedFilterDto;
}

export interface LayersSheetProps {
  active: Set<string>;
  opacities: Record<string, number>;
  windFromDeg: number | null;
  savedFilters: SavedFilterSummary[];
  /**
   * Offline coverage **for the view currently on screen**, recomputed as the
   * map moves. `null` means "not measured yet" and renders as an explicit
   * indeterminate state — never as ready.
   */
  coverage: CoverageState | null;
  /**
   * Whether USGS has actually surveyed 1 m LiDAR under the ground currently on
   * screen — a fact about the *upstream* data (`GET /terrain/dem/coverage`),
   * not about this device's offline cache; do not confuse with `coverage`
   * above. Omitted/`undefined` renders as "checking", the same indeterminate
   * posture `coverage: null` gets — never as available, per CLAUDE.md's "say
   * when you do not know". See `lib/map/demSourceCoverage.ts`.
   */
  demCoverage?: DemSourceCoverageState;
  onToggle: (id: string) => void;
  onOpacity: (id: string, value: number) => void;
  onToggleFilter: (id: string) => void;
  onClose: () => void;
  /** Opens the "start a new filter" picker (`components/filters`' `FilterLibrary`) in the drawer slot. */
  onNewFilter: () => void;
  /** Opens `FilterEditor` on an existing saved filter. Never offered for a preset — see `SavedFilterSummary.editable`. */
  onEditFilter: (filter: SavedFilterDto) => void;
  /**
   * Whether saving a new filter could actually succeed right now.
   *
   * `FilterEditor`/`FilterLibrary` (`components/filters`) call an
   * authenticated endpoint with no sign-in prompt of their own — creating one
   * while signed out fails silently at Save with a generic error, which is
   * exactly the kind of control CLAUDE.md's "say when an input is missing"
   * rule exists for. Defaults `true` so existing callers/tests are
   * unaffected; `App.tsx` passes the real `useAuth()` status.
   */
  canCreateFilters?: boolean;
}

/**
 * The layers panel.
 *
 * Two product rules it carries, both unusual and both deliberate:
 *
 *  1. **Every layer is explained in a sentence.** "Weiss multi-scale TPI
 *     landform classification" means nothing to a hunter, and a layer nobody
 *     understands is a layer nobody turns on. The blurb is the feature.
 *  2. **A layer whose inputs are unset is disabled with a stated reason**, not
 *     rendered against a default. `ToggleRow`'s `blockedReason` makes that the
 *     path of least resistance rather than something each screen must remember.
 *  3. **The offline badge describes the view on screen, and nothing else.** It
 *     used to be a boolean sampled once at mount from the total tile count, so
 *     one stored tile made every view on earth read "Offline ready" — including
 *     five hundred miles away. Every string here now comes from
 *     `describeCoverage`, which has no code path that produces a reassuring
 *     answer from an absent measurement.
 */
export function LayersSheet({
  active,
  opacities,
  windFromDeg,
  savedFilters,
  coverage,
  demCoverage = { kind: 'checking' },
  onToggle,
  onOpacity,
  onToggleFilter,
  onClose,
  onNewFilter,
  onEditFilter,
  canCreateFilters = true,
}: LayersSheetProps) {
  const warnings = missingInputs(active, windFromDeg);
  const offline = describeCoverage(coverage);
  // A source the hunter has tapped but not yet confirmed — switching reloads
  // the app (`lib/map/demSource.ts`'s header comment explains why: dozens of
  // modules read `DEM_SOURCE` as a plain import-time constant, and a reload is
  // what lets all of them agree from one persisted value instead of needing a
  // live-update path threaded through every one of them). Held locally rather
  // than lifted to `App.tsx`: nothing outside this sheet needs to know a
  // switch is pending, and the confirmation is the one place that has to say,
  // before the reload happens, that per-source offline regions do not carry
  // over — CLAUDE.md's "say so in the UI before the switch, do not discover
  // it in a hollow with no signal."
  const [pendingSource, setPendingSource] = useState<DemSourceDescriptor | null>(null);

  return (
    <Sheet
      title="Layers"
      onClose={onClose}
      action={
        // Wrapped purely to give the invariant suite a stable handle. What is
        // asserted there is the *rendered* text and tone of the chip, not that
        // some chip exists — a `getByRole` hit is exactly what stayed green
        // through the whole life of the bug this replaces.
        <span className="coverage-chip" data-testid="coverage-chip">
          <Chip tone={offline.tone} glyph={offline.glyph} title={offline.detail}>
            {offline.chip}
          </Chip>
        </span>
      }
    >
      {/* The full sentence lives in the body, where there is room for the
          caveats the header chip cannot carry: which zoom the answer is for,
          how much of it was sampled, and what the hatch on the map means.
          `aria-live` because this changes underneath the user as they pan, and
          a screen-reader user is owed the same correction a sighted one gets. */}
      <p className="rl-hint" data-testid="coverage-detail" role="status" aria-live="polite">
        {offline.detail}
      </p>

      {/* Degrade loudly. The in-memory store is a real store for this session
          and will happily report "Covered" — and then lose the lot on reload.
          A hunter who saw green last night and finds a blank map at 05:00 has
          been failed completely, so this is an alert, not a hint. */}
      {coverage?.kind === 'result' && coverage.result.volatile && (
        <Callout tone="danger" role="alert">
          <p>
            This device would not give us persistent storage, so elevation is being held in memory
            only and will be gone when the app reloads. Do not rely on this at the trailhead.
          </p>
        </Callout>
      )}

      {warnings.length > 0 && (
        <Callout tone="warn">
          {warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </Callout>
      )}

      {/*
       * The DEM source — what every layer below is actually computed from.
       *
       * Not a `LAYERS` entry: it is not a raster you toggle on/off, it is the
       * ground model underneath every one of them, so it gets its own section
       * ahead of the layer catalogue rather than living inside it.
       */}
      <section className="rl-group">
        <SectionHeading hint="What every layer below is computed from">
          Elevation source
        </SectionHeading>
        <p className="rl-hint">
          Under heavy timber a surface model measures the treetops, not the ground — bare-earth data
          sees through the canopy. Switching reloads the map.
        </p>
        {Object.values(DEM_SOURCES).map((source) => {
          const isActive = source.id === DEM_SOURCE.id;
          const isOneMeter = source.id === 'usgs3dep-1m';
          // Only a *definite* negative blocks the row — "checking" or
          // "could not reach the server" must not read as "no coverage",
          // which would be confidently wrong about ground that was never
          // actually checked (CLAUDE.md's "say when you do not know").
          const noCoverageHere =
            isOneMeter && demCoverage.kind === 'result' && !demCoverage.result.oneMeter.available;
          const blurb = isOneMeter
            ? demCoverage.kind === 'result' && demCoverage.result.oneMeter.available
              ? `${source.resolutionNote}. Covers the ground on screen right now (${
                  demCoverage.result.oneMeter.project ?? 'a USGS acquisition'
                }).`
              : `${source.resolutionNote}. Reveals benches, saddles and old skid roads under timber ` +
                'that a 10 m blend cannot — where USGS has actually flown it.'
            : source.id === 'terrarium'
              ? `${source.resolutionNote}. Free and global, but a *surface* model — it includes the ` +
                'canopy, so under heavy timber it describes the treetops.'
              : `${source.resolutionNote}. Same ~10 m grid as the default above, but authoritative ` +
                'bare earth — the ground under the canopy, not the canopy itself. US only.';
          return (
            <ToggleRow
              key={source.id}
              id={`dem-source-${source.id}`}
              label={source.label}
              checked={isActive}
              onToggle={() => {
                if (isActive) return;
                setPendingSource(source);
              }}
              blurb={blurb}
              blockedReason={
                noCoverageHere
                  ? 'No 1 m data here — USGS has not surveyed this ground yet. This source would ' +
                    'render blank over the current view; pick a different view, or use the 10 m ' +
                    'bare-earth source above.'
                  : undefined
              }
            />
          );
        })}
        {pendingSource && (
          <Callout tone="warn" role="alert">
            <p>Switch to {pendingSource.label}? This reloads the map.</p>
            <p>
              Downloaded regions are stored separately for each elevation source — what you saved
              offline under {DEM_SOURCE.label} stays exactly where it is, but you will need to
              download this area again under {pendingSource.label} to use it with no signal.
            </p>
            <p>
              Bench and landform detection are tuned in map cells, not metres, so a saved filter can
              describe a tighter or looser patch of ground at a different resolution. This map does
              not correct for that automatically yet.
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
                Switch and reload
              </Button>
            </div>
          </Callout>
        )}
      </section>

      {LAYER_GROUPS.filter((g) => g.id !== 'saved').map((group) => (
        <section key={group.id} className="rl-group">
          <SectionHeading hint={group.hint}>{group.label}</SectionHeading>
          {LAYERS.filter((l) => l.group === group.id).map((layer) => (
            <ToggleRow
              key={layer.id}
              id={`layer-${layer.id}`}
              label={layer.label}
              checked={active.has(layer.id)}
              onToggle={() => onToggle(layer.id)}
              blurb={layer.blurb}
              blockedReason={
                layer.requiresWind && windFromDeg === null
                  ? 'Set a wind direction first — without one this layer would render against a default, which would be misleading rather than merely wrong.'
                  : undefined
              }
            >
              {layer.grade && (
                <Confidence
                  grade={layer.grade}
                  note="Graded against docs/EVIDENCE.md — the slope term behind this score is a defensible estimate, not a measured value."
                />
              )}
              <input
                type="range"
                className="rl-range"
                min={0}
                max={100}
                value={Math.round((opacities[layer.id] ?? layer.defaultOpacity) * 100)}
                onChange={(e) => onOpacity(layer.id, Number(e.target.value) / 100)}
                aria-label={`${layer.label} opacity`}
              />
              {layer.legend && <Legend entries={layer.legend} />}
            </ToggleRow>
          ))}
        </section>
      ))}

      <section className="rl-group">
        <SectionHeading
          action={
            canCreateFilters ? (
              <Button variant="link" onClick={onNewFilter}>
                New filter
              </Button>
            ) : undefined
          }
        >
          Saved filters
        </SectionHeading>
        {!canCreateFilters && (
          <p className="rl-hint">
            Sign in to build and save your own filters — they travel with you offline once you have.
            The built-in ones below still work with no account.
          </p>
        )}
        {savedFilters.length === 0 ? (
          <p className="rl-hint">
            No saved filters yet. A filter is a terrain query you name and keep — “12–25°, facing
            north through east, on a bench” — and it travels with you offline.
          </p>
        ) : (
          savedFilters.map((f) => (
            <ToggleRow
              key={f.id}
              id={`filter-${f.id}`}
              label={f.name}
              checked={f.enabled}
              onToggle={() => onToggleFilter(f.id)}
              blurb={f.description}
              swatch={f.color}
              action={
                f.editable && (
                  <Button variant="link" onClick={() => onEditFilter(f.editable as SavedFilterDto)}>
                    Edit
                  </Button>
                )
              }
            />
          ))
        )}
      </section>
    </Sheet>
  );
}
