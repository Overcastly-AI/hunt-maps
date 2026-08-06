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
  offlineReady: boolean;
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
 */
export function LayersSheet({
  active,
  opacities,
  windFromDeg,
  savedFilters,
  offlineReady,
  onToggle,
  onOpacity,
  onToggleFilter,
  onClose,
}: LayersSheetProps) {
  const warnings = missingInputs(active, windFromDeg);

  return (
    <Sheet
      title="Layers"
      onClose={onClose}
      action={
        <Chip
          tone={offlineReady ? 'ok' : 'warn'}
          glyph={offlineReady ? '●' : '○'}
          title={
            offlineReady
              ? 'Elevation for this area is stored on this device. Analysis layers work with no signal.'
              : 'This area is not downloaded. Layers need a connection until you save it for offline use.'
          }
        >
          {offlineReady ? 'Offline ready' : 'Online only'}
        </Chip>
      }
    >
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
