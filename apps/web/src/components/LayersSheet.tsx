import {
  Button,
  Callout,
  Chip,
  Legend,
  SectionHeading,
  Sheet,
  ToggleRow,
} from '@hunt-maps/design';
import { LAYER_GROUPS, LAYERS, missingInputs } from '../lib/layers';
import { describeCoverage, type ViewportCoverage } from '../lib/offline/coverage';

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
  coverage: ViewportCoverage | null;
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

  return (
    <Sheet
      title="Layers"
      onClose={onClose}
      action={
        <Chip tone={offline.tone} glyph={offline.glyph} title={offline.detail}>
          {offline.chip}
        </Chip>
      }
    >
      {/* The full sentence lives in the body, where there is room for the
          caveats the header chip cannot carry: which zoom the answer is for,
          how much of it was sampled, and what the hatch on the map means. */}
      <p className="rl-hint" data-testid="coverage-detail">
        {offline.detail}
      </p>

      {coverage?.backend === 'memory' && (
        <Callout tone="danger" role="alert">
          <p>
            This device would not give us persistent storage, so saved elevation is being held in
            memory only and will be gone when the app reloads. Do not rely on this at the
            trailhead.
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
