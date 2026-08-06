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
 * Two things this panel does that most map UIs do not, both deliberate:
 *
 *  1. **It explains each layer in a sentence.** These are not familiar layers —
 *    "Weiss multi-scale TPI landform classification" means nothing to a hunter,
 *    and a layer nobody understands is a layer nobody turns on. Every entry
 *    says what it shows and why it matters, in hunting language.
 *  2. **It says out loud when a layer is missing its inputs.** Bedding
 *    likelihood with no wind set renders *something* — and that something is
 *    misleading. Better to grey it out and say why than to draw a confident
 *    heat map built on a default.
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
        <span
          className={offlineReady ? 'chip chip--ok' : 'chip chip--warn'}
          title={
            offlineReady
              ? 'Elevation for this area is stored on this device. Analysis layers work with no signal.'
              : 'This area is not downloaded. Layers need a connection until you save it for offline use.'
          }
        >
          {offlineReady ? 'Offline ready' : 'Online only'}
        </span>
      </header>

      <section className="control-block">
        <label htmlFor="wind-dial">
          Wind from
          <span className="control-block__value">
            {windFromDeg === null ? 'not set' : `${Math.round(windFromDeg)}° ${octant(windFromDeg)}`}
          </span>
        </label>
        <input
          id="wind-dial"
          type="range"
          min={0}
          max={359}
          step={5}
          value={windFromDeg ?? 0}
          onChange={(e) => onWindChange(Number(e.target.value))}
          aria-label="Wind direction in degrees the wind is coming from"
        />
        {windFromDeg !== null && (
          <button type="button" className="link" onClick={() => onWindChange(null)}>
            Clear wind
          </button>
        )}
      </section>

      <section className="control-block">
        <label htmlFor="time-input">
          Date &amp; time
          <span className="control-block__value">{atUtc.toLocaleString()}</span>
        </label>
        <input
          id="time-input"
          type="datetime-local"
          value={toLocalInput(atUtc)}
          onChange={(e) => {
            const next = new Date(e.target.value);
            if (!Number.isNaN(next.getTime())) onTimeChange(next);
          }}
        />
        <p className="hint">
          Sun and thermal layers move through the day and through the season. Scrub this to see
          where light lands at first light on opening morning.
        </p>
      </section>

      {warnings.length > 0 && (
        <div className="callout callout--warn" role="status">
          {warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}

      {LAYER_GROUPS.filter((g) => g.id !== 'saved').map((group) => (
        <section key={group.id} className="layer-group">
          <h3>
            {group.label}
            <span className="layer-group__hint">{group.hint}</span>
          </h3>
          {LAYERS.filter((l) => l.group === group.id).map((layer) => {
            const on = active.has(layer.id);
            const blocked = layer.requiresWind && windFromDeg === null;
            return (
              <div key={layer.id} className={`layer-row${on ? ' layer-row--on' : ''}`}>
                <label className="layer-row__main">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={blocked}
                    onChange={() => onToggle(layer.id)}
                    aria-describedby={`blurb-${layer.id}`}
                  />
                  <span className="layer-row__label">{layer.label}</span>
                </label>
                <p id={`blurb-${layer.id}`} className="layer-row__blurb">
                  {layer.blurb}
                </p>
                {on && (
                  <>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round((opacities[layer.id] ?? layer.defaultOpacity) * 100)}
                      onChange={(e) => onOpacity(layer.id, Number(e.target.value) / 100)}
                      aria-label={`${layer.label} opacity`}
                      className="layer-row__opacity"
                    />
                    {layer.legend && (
                      <ul className="legend">
                        {layer.legend.map((entry) => (
                          <li key={entry.label}>
                            <span
                              className="legend__swatch"
                              style={{ background: entry.swatch }}
                              aria-hidden="true"
                            />
                            {entry.label}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </section>
      ))}

      <section className="layer-group">
        <h3>
          Saved filters
          <button type="button" className="link" onClick={onEditFilters}>
            Edit
          </button>
        </h3>
        {savedFilters.length === 0 ? (
          <p className="hint">
            No saved filters yet. A filter is a terrain query you name and keep — “12–25°, facing
            north through east, on a bench” — and it travels with you offline.
          </p>
        ) : (
          savedFilters.map((f) => (
            <div key={f.id} className={`layer-row${f.enabled ? ' layer-row--on' : ''}`}>
              <label className="layer-row__main">
                <input
                  type="checkbox"
                  checked={f.enabled}
                  onChange={() => onToggleFilter(f.id)}
                />
                <span className="legend__swatch" style={{ background: f.color }} aria-hidden="true" />
                <span className="layer-row__label">{f.name}</span>
              </label>
              {f.description && <p className="layer-row__blurb">{f.description}</p>}
            </div>
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
