/**
 * Name, description, fill colour, opacity and outline — the metadata that
 * turns a predicate into a named, shareable object rather than an anonymous
 * query. `name` is what shows up in `LayersSheet`'s saved-filters list and
 * in a share link; `description` is the "why this matters" sentence every
 * other layer in this app carries (`CLAUDE.md`: "explain, don't just
 * expose") — a filter with a predicate but no description is exactly the
 * unnamed-fixed-band experience this feature exists to replace.
 */

import { mapColor } from '@hunt-maps/design';

export interface FilterMeta {
  name: string;
  description: string;
  color: string;
  opacity: number;
  outline: boolean;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** A curated, distinguishable set of swatches sourced from the shared map palette (`@hunt-maps/design`'s `mapColor`) rather than invented hexes — see `CLAUDE.md`'s "no literal colours outside packages/design". A saved filter's own colour is user-chosen paint data, same as a preset's (`PRESET_FILTERS` in `@hunt-maps/terrain`), so a free hex field sits alongside these for editing a filter whose colour did not come from this list. */
const SWATCHES: string[] = [
  mapColor['slope-bedding'],
  mapColor['slope-sidehill'],
  mapColor['slope-steep'],
  mapColor['feature-saddle'],
  mapColor['feature-channel'],
  mapColor['feature-ridge'],
  mapColor['feature-bench'],
  mapColor.corridor,
  mapColor.pinch,
];

export function FilterMetaFields({
  value,
  onChange,
}: {
  value: FilterMeta;
  onChange: (next: FilterMeta) => void;
}) {
  const nameId = 'filter-name';
  const descId = 'filter-description';

  return (
    <div className="rl-filter-meta">
      <div className="rl-field">
        <label className="rl-field__label" htmlFor={nameId}>
          <span>Name</span>
        </label>
        <input
          id={nameId}
          type="text"
          className="rl-input"
          maxLength={120}
          placeholder='e.g. "November leeward benches"'
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </div>

      <div className="rl-field">
        <label className="rl-field__label" htmlFor={descId}>
          <span>What this shows, and why it matters</span>
        </label>
        <textarea
          id={descId}
          className="rl-input rl-filter-meta__textarea"
          maxLength={1000}
          rows={2}
          placeholder="One or two sentences in your own hunting language — this is what you (or whoever you share it with) will read back six months from now."
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
        />
      </div>

      <div className="rl-field">
        <div className="rl-field__label">
          <span>Map colour</span>
        </div>
        <div className="rl-filter-meta__swatches" role="group" aria-label="Fill colour">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              className="rl-filter-meta__swatch-btn"
              style={{ background: c }}
              aria-pressed={value.color.toLowerCase() === c.toLowerCase()}
              aria-label={`Use ${c} as the fill colour`}
              onClick={() => onChange({ ...value, color: c })}
            />
          ))}
          <input
            type="text"
            className="rl-input rl-filter-meta__hex"
            value={value.color}
            aria-label="Fill colour, exact hex value"
            onChange={(e) => {
              const v = e.target.value;
              if (HEX.test(v)) onChange({ ...value, color: v });
              else onChange({ ...value, color: v }); // allow free typing; save is gated on HEX.test elsewhere
            }}
          />
        </div>
        {/*
          The example below used to be a literal hex, which tripped CI's "no
          colour literals outside packages/design" guard — a false positive in
          spirit (it is prose, not paint) but a true one in effect, since a
          grep cannot tell the difference. `#RRGGBB` says the same thing and
          cannot drift from a token.
        */}
        {!HEX.test(value.color) && (
          <p className="rl-hint">Needs a full 6-digit hex value, like #RRGGBB.</p>
        )}
      </div>

      <div className="rl-field">
        <div className="rl-field__label">
          <span>Fill opacity</span>
          <span className="rl-field__value">{Math.round(value.opacity * 100)}%</span>
        </div>
        <input
          type="range"
          className="rl-range"
          min={10}
          max={100}
          step={5}
          value={Math.round(value.opacity * 100)}
          aria-label="Fill opacity"
          onChange={(e) => onChange({ ...value, opacity: Number(e.target.value) / 100 })}
        />
      </div>

      <label className="rl-filter-node__checkbox-row">
        <input
          type="checkbox"
          checked={value.outline}
          onChange={(e) => onChange({ ...value, outline: e.target.checked })}
        />
        <span>Draw an outline around matched ground</span>
      </label>
    </div>
  );
}

export function isValidHexColor(v: string): boolean {
  return HEX.test(v);
}
