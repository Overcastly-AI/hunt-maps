/**
 * One editor per leaf `TerrainPredicate` kind — `range`, `aspect`, `weiss`,
 * `wood`, `bench`. `PredicateNode.tsx` dispatches to these; `not` and group
 * wrapping live there, not here, so each of these stays a small, focused
 * translation between one AST shape and its controls.
 */

import { Callout } from '@hunt-maps/design';
import type { AspectPredicate, BenchPredicate, RangePredicate, WeissPredicate, WoodPredicate } from '@hunt-maps/terrain';
import { DualRangeSlider } from './DualRangeSlider';
import { metricDef, RANGE_METRICS } from './metricRegistry';
import { describeAspectWindow } from './predicateUtils';
import { WEISS_OPTIONS, WOOD_OPTIONS } from './landformOptions';

// ---------------------------------------------------------------------------
// Range
// ---------------------------------------------------------------------------

export function RangeNode({
  value,
  onChange,
  windFromDeg,
}: {
  value: RangePredicate;
  onChange: (next: RangePredicate) => void;
  windFromDeg: number | null;
}) {
  const def = metricDef(value.metric) ?? RANGE_METRICS[1];
  const min = value.min ?? def.sliderMin;
  const max = value.max ?? def.sliderMax;

  return (
    <div className="rl-filter-node">
      <label className="rl-filter-node__row">
        <span className="rl-filter-node__row-label">Reads</span>
        <select
          className="rl-input rl-filter-node__select"
          value={value.metric}
          onChange={(e) => {
            const next = metricDef(e.target.value) ?? def;
            // A fresh, sane default band for the newly-chosen metric — keeping
            // the old min/max would carry, say, a slope band of 8–20 straight
            // onto curvature, which is nonsense in the new metric's units.
            onChange({ ...value, metric: next.id, min: next.sliderMin, max: next.sliderMax });
          }}
        >
          {RANGE_METRICS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <p className="rl-hint">{def.blurb}</p>

      {def.requiresWind && windFromDeg === null ? (
        <Callout tone="warn">
          <p>
            {def.label} needs a wind direction to mean anything. You can still set the band below
            — it will grey out on the map and in the live match share until a wind is set.
          </p>
        </Callout>
      ) : null}

      <DualRangeSlider
        label={def.label}
        min={def.sliderMin}
        max={def.sliderMax}
        step={def.step}
        decimals={def.decimals}
        unit={def.unit}
        valueMin={def.toDisplay(min)}
        valueMax={def.toDisplay(max)}
        onChange={({ min: dMin, max: dMax }) =>
          onChange({ ...value, min: def.toStored(dMin), max: def.toStored(dMax) })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aspect
// ---------------------------------------------------------------------------

export function AspectNode({
  value,
  onChange,
}: {
  value: AspectPredicate;
  onChange: (next: AspectPredicate) => void;
}) {
  return (
    <div className="rl-filter-node">
      <p className="rl-hint">
        Which way the slope faces — deer bed on the leeward, sun-sheltered or sun-facing side
        depending on season and wind, and this is how you say which.
      </p>
      <p className="rl-filter-node__summary" data-testid="aspect-summary">
        Matches slopes facing <strong>{describeAspectWindow(value.centerDeg, value.toleranceDeg)}</strong>
        {value.toleranceDeg < 180 ? ` (± ${Math.round(value.toleranceDeg)}°)` : ''}
      </p>

      <div className="rl-filter-node__row">
        <label className="rl-field" style={{ flex: 1, marginBottom: 0 }}>
          <div className="rl-field__label">
            <span>Centre bearing</span>
            <span className="rl-field__value">{Math.round(value.centerDeg)}°</span>
          </div>
          <input
            type="range"
            className="rl-range"
            min={0}
            max={359}
            step={1}
            value={value.centerDeg}
            aria-label="Aspect — centre bearing"
            onChange={(e) => onChange({ ...value, centerDeg: Number(e.target.value) })}
          />
        </label>
      </div>

      <div className="rl-filter-node__row">
        <label className="rl-field" style={{ flex: 1, marginBottom: 0 }}>
          <div className="rl-field__label">
            <span>Window width</span>
            <span className="rl-field__value">± {Math.round(value.toleranceDeg)}°</span>
          </div>
          <input
            type="range"
            className="rl-range"
            min={5}
            max={180}
            step={5}
            value={value.toleranceDeg}
            aria-label="Aspect — window width"
            onChange={(e) => onChange({ ...value, toleranceDeg: Number(e.target.value) })}
          />
        </label>
      </div>

      <label className="rl-filter-node__checkbox-row">
        <input
          type="checkbox"
          checked={value.includeFlat === true}
          onChange={(e) => onChange({ ...value, includeFlat: e.target.checked })}
        />
        <span>Also match flat ground (no measurable downslope direction)</span>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weiss landform / Wood feature — same shape, different option list
// ---------------------------------------------------------------------------

export function WeissNode({
  value,
  onChange,
}: {
  value: WeissPredicate;
  onChange: (next: WeissPredicate) => void;
}) {
  return (
    <div className="rl-filter-node">
      <p className="rl-hint">
        Landscape position — where this ground sits in the hill (canyon, drainage, ridge, summit),
        computed from a multi-scale terrain-position index, not just how steep it is.
      </p>
      <div className="rl-filter-node__checklist">
        {WEISS_OPTIONS.map((opt) => (
          <label key={opt.value} className="rl-filter-node__checkbox-row" title={opt.blurb}>
            <input
              type="checkbox"
              checked={value.classes.includes(opt.value)}
              onChange={(e) => {
                const classes = e.target.checked
                  ? [...value.classes, opt.value]
                  : value.classes.filter((c) => c !== opt.value);
                onChange({ ...value, classes });
              }}
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function WoodNode({
  value,
  onChange,
}: {
  value: WoodPredicate;
  onChange: (next: WoodPredicate) => void;
}) {
  return (
    <div className="rl-filter-node">
      <p className="rl-hint">
        Morphometric feature — saddles, ridges, channels, peaks and pits, computed from the
        curvature of the ground itself (Wood, 1996).
      </p>
      <div className="rl-filter-node__checklist">
        {WOOD_OPTIONS.map((opt) => (
          <label key={opt.value} className="rl-filter-node__checkbox-row" title={opt.blurb}>
            <input
              type="checkbox"
              checked={value.features.includes(opt.value)}
              onChange={(e) => {
                const features = e.target.checked
                  ? [...value.features, opt.value]
                  : value.features.filter((f) => f !== opt.value);
                onChange({ ...value, features });
              }}
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bench
// ---------------------------------------------------------------------------

export function BenchNode({
  value,
  onChange,
}: {
  value: BenchPredicate;
  onChange: (next: BenchPredicate) => void;
}) {
  return (
    <div className="rl-filter-node">
      <p className="rl-hint">
        A detected bench — a level shelf cut into steep ground, found by looking for a ring of
        much steeper terrain around a flat centre. The travel skeleton of hill country.
      </p>
      <div className="rl-filter-segmented" role="group" aria-label="Bench">
        <button
          type="button"
          className={value.isBench ? 'rl-btn rl-btn--primary' : 'rl-btn rl-btn--ghost'}
          aria-pressed={value.isBench}
          onClick={() => onChange({ ...value, isBench: true })}
        >
          On a bench
        </button>
        <button
          type="button"
          className={!value.isBench ? 'rl-btn rl-btn--primary' : 'rl-btn rl-btn--ghost'}
          aria-pressed={!value.isBench}
          onClick={() => onChange({ ...value, isBench: false })}
        >
          Not on a bench
        </button>
      </div>
    </div>
  );
}
