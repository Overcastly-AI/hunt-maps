import {
  Callout,
  Chip,
  Field,
  Legend,
  RangeField,
  SectionHeading,
  Button,
  ToggleRow,
} from '@hunt-maps/design';
import { LAYER_GROUPS, LAYERS, layerById, missingInputs } from '../lib/layers';

export interface SavedFilterSummary {
  id: string;
  name: string;
  description?: string;
  color: string;
  enabled: boolean;
}

export interface LayerPanelProps {
  active: Set<string>;
  opacities: Record<string, number>;
  windFromDeg: number | null;
  atUtc: Date;
  savedFilters: SavedFilterSummary[];
  offlineReady: boolean;
  onToggle: (id: string) => void;
  onOpacity: (id: string, value: number) => void;
  onWindChange: (deg: number | null) => void;
  onTimeChange: (at: Date) => void;
  onToggleFilter: (id: string) => void;
  onEditFilters: () => void;
}

/**
 * The layer stack control.
 *
 * All presentation comes from `@hunt-maps/design` primitives — this component
 * is now purely the arrangement and the product rules. Two of those rules are
 * worth calling out because they are unusual and deliberate:
 *
 *  1. **Every layer is explained in a sentence.** "Weiss multi-scale TPI
 *     landform classification" means nothing to a hunter, and a layer nobody
 *     understands is a layer nobody turns on.
 *  2. **A layer whose inputs are unset is disabled with a stated reason**, not
 *     rendered against a default. `ToggleRow`'s `blockedReason` prop makes that
 *     the path of least resistance rather than something each screen has to
 *     remember.
 */
export function LayerPanel({
  active,
  opacities,
  windFromDeg,
  atUtc,
  savedFilters,
  offlineReady,
  onToggle,
  onOpacity,
  onWindChange,
  onTimeChange,
  onToggleFilter,
  onEditFilters,
}: LayerPanelProps) {
  const warnings = missingInputs(active, windFromDeg);

  return (
    <aside className="layer-panel" aria-label="Map layers">
      <header className="layer-panel__head">
        <h2>Layers</h2>
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
      </header>

      <RangeField
        id="wind-dial"
        label="Wind from"
        min={0}
        max={359}
        step={5}
        value={windFromDeg ?? 0}
        onValueChange={onWindChange}
        display={
          windFromDeg === null ? 'not set' : `${Math.round(windFromDeg)}° ${octant(windFromDeg)}`
        }
        aria-label="Wind direction in degrees the wind is coming from"
        hint={
          windFromDeg !== null ? (
            <Button variant="link" onClick={() => onWindChange(null)}>
              Clear wind
            </Button>
          ) : (
            'Leeward bedding and shelter layers need this before they mean anything.'
          )
        }
      />

      <Field
        id="time-input"
        label="Date &amp; time"
        value={atUtc.toLocaleString()}
        hint="Sun and thermal layers move through the day and through the season. Scrub this to see where light lands at first light on opening morning."
      >
        <input
          id="time-input"
          className="rl-input"
          type="datetime-local"
          value={toLocalInput(atUtc)}
          onChange={(e) => {
            const next = new Date(e.target.value);
            if (!Number.isNaN(next.getTime())) onTimeChange(next);
          }}
        />
      </Field>

      {warnings.length > 0 && (
        <Callout tone="warn">
          {warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </Callout>
      )}

      {LAYER_GROUPS.filter((g) => g.id !== 'saved').map((group) => (
        <section key={group.id} className="layer-group">
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
                  ? `Set a wind direction first — without one this layer would render against a default, which would be misleading rather than merely wrong.`
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

      <section className="layer-group">
        <SectionHeading
          action={
            <Button variant="link" onClick={onEditFilters}>
              Edit
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
    </aside>
  );
}

function octant(deg: number): string {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** `datetime-local` wants local wall time with no zone suffix. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export { layerById };
