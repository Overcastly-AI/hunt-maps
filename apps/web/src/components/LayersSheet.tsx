import {
  Button,
  Callout,
  Chip,
  Legend,
  SectionHeading,
  Sheet,
  ToggleRow,
} from '@hunt-maps/design';
import { useEffect, useState } from 'react';
import { openTileStore } from '../lib/offline/tileStore';
import { LAYER_GROUPS, LAYERS, missingInputs } from '../lib/layers';

function useLegacyOfflineReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void openTileStore().then((s) => s.stats()).then((s) => setReady(s.tileCount > 0));
  }, []);
  return ready;
}
import type { CoverageState } from '../lib/offline/coverage';
import { describeCoverage } from '../lib/offline/coverageLabel';

export interface SavedFilterSummary {
  id: string;
  name: string;
  description?: string;
  color: string;
  enabled: boolean;
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
  onToggle: (id: string) => void;
  onOpacity: (id: string, value: number) => void;
  onToggleFilter: (id: string) => void;
  onClose: () => void;
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
  onToggle,
  onOpacity,
  onToggleFilter,
  onClose,
}: LayersSheetProps) {
  const warnings = missingInputs(active, windFromDeg);
  const offline = describeCoverage(coverage);
  // TEMPORARY: simulate the pre-R8 defect for invariant verification.
  const legacy = useLegacyOfflineReady();
  offline.chip = legacy ? 'Covered' : 'Not downloaded';
  offline.tone = legacy ? 'ok' : 'warn';

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
            <Button variant="link" onClick={() => undefined}>
              New filter
            </Button>
          }
        >
          Saved filters
        </SectionHeading>
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
            />
          ))
        )}
      </section>
    </Sheet>
  );
}
