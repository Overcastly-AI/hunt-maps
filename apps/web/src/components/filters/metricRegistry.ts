/**
 * What a `RangePredicate` can point at, and how to talk about it.
 *
 * ## Why this exists as its own registry
 *
 * `TerrainMetric` (`@hunt-maps/terrain`) is a bare union of field names — the
 * engine has no business knowing how a hunter reads "curvaturePlan" in feet,
 * degrees, or a raw dimensionless score. `CLAUDE.md`'s "explain, don't just
 * expose" rule means every one of those names needs a sentence, a unit, and a
 * sane slider range before it can go in front of someone building a filter,
 * so that lives here rather than being invented ad hoc inside a form.
 *
 * ## The one rule every entry follows
 *
 * **The predicate's `min`/`max` are always stored in the engine's own units —
 * never the display unit.** `elevation` is the sharpest example: the engine
 * stores metres (`HeightGrid`'s native unit) and this app displays feet
 * everywhere else (`TerrainReadout.tsx`, `pointQuery.ts`'s `METERS_TO_FEET`).
 * A metric whose `toDisplay`/`toStored` pair disagrees with what
 * `evaluateFilter` actually compares against is a *silent* wrong filter — the
 * predicate looks reasonable, the UI shows a sensible number, and the map
 * paints the wrong band. `metricRegistry.test.ts` round-trips every entry
 * (`toStored(toDisplay(x)) ≈ x`) specifically to catch that class of bug
 * before it reaches a saved, shared filter.
 *
 * ## `aspect` is deliberately not in this list
 *
 * `TerrainMetric` includes `'aspect'`, and nothing stops a caller building
 * `{ kind: 'range', metric: 'aspect', min: 315, max: 45 }` by hand — but
 * aspect is circular (`terrainFilter.ts`'s own doc comment: "breaks a naive
 * min/max range"), and `min > max` in a linear range matches nothing rather
 * than wrapping through north. `AspectPredicate` exists precisely so this
 * never has to be a range. The editor only ever offers `RANGE_METRICS`, which
 * excludes it, and route users to the dedicated aspect control instead.
 */

import type { TerrainMetric } from '@hunt-maps/terrain';

/** Metres → feet, matching `pointQuery.ts`'s `METERS_TO_FEET` exactly — two independent conversion constants for the same unit is how a filter and a readout quietly disagree. */
export const METERS_TO_FEET = 3.28084;

export interface MetricDef {
  id: Exclude<TerrainMetric, 'aspect'>;
  label: string;
  /** One sentence: what it shows, in hunting language, and why it matters. */
  blurb: string;
  /** Unit shown next to the number. Empty string for the dimensionless scores. */
  unit: string;
  /** Suggested slider bounds, in *display* units — a starting point, not a hard clamp; the paired number input accepts anything finite. */
  sliderMin: number;
  sliderMax: number;
  /** Slider/number step, in display units. */
  step: number;
  /** How many decimal places to show — curvature needs several, elevation needs none. */
  decimals: number;
  /** Engine value → what the user sees. */
  toDisplay: (stored: number) => number;
  /** What the user typed/dragged → the value saved on the predicate. */
  toStored: (display: number) => number;
  /**
   * Set when this metric cannot mean anything without a wind direction —
   * `windExposure`, `shelter`, `bedding` all read the ray-marched or cosine
   * relationship to `windFromDeg`. Mirrors `LayerDefinition.requiresWind`
   * (`lib/layers.ts`) for the same reason: a filter clause on one of these
   * with no wind set must grey out with a stated reason, never silently
   * evaluate against a default direction nobody chose.
   */
  requiresWind?: boolean;
}

const identity = (v: number) => v;

export const RANGE_METRICS: MetricDef[] = [
  {
    id: 'elevation',
    label: 'Elevation',
    blurb:
      'Ground height above sea level. Useful for benching a filter to a known elevation band on ' +
      'a big property, or excluding the valley floor a road runs through.',
    unit: 'ft',
    sliderMin: 0,
    sliderMax: 3000,
    step: 10,
    decimals: 0,
    toDisplay: (m) => m * METERS_TO_FEET,
    toStored: (ft) => ft / METERS_TO_FEET,
  },
  {
    id: 'slope',
    label: 'Slope angle',
    blurb:
      'Steepness in degrees. 8–20° is the grade deer contour along without climbing; 20–30° is ' +
      'the classic bedding pitch; past 45° nothing crosses on purpose.',
    unit: '°',
    sliderMin: 0,
    sliderMax: 60,
    step: 1,
    decimals: 0,
    toDisplay: identity,
    toStored: identity,
  },
  {
    id: 'curvatureProfile',
    label: 'Profile curvature',
    blurb:
      'Convexity along the steepest line — the ESRI sign convention, positive rolls over a nose, ' +
      'negative cups a hollow. Values are small; use the exact-value fields for a precise cut.',
    unit: '/m',
    sliderMin: -0.02,
    sliderMax: 0.02,
    step: 0.0005,
    decimals: 4,
    toDisplay: identity,
    toStored: identity,
  },
  {
    id: 'curvaturePlan',
    label: 'Plan curvature',
    blurb:
      'Convexity across the slope — positive bulges outward off a ridge or spur, negative pinches ' +
      'inward into a draw or channel that funnels scent and deer alike.',
    unit: '/m',
    sliderMin: -0.02,
    sliderMax: 0.02,
    step: 0.0005,
    decimals: 4,
    toDisplay: identity,
    toStored: identity,
  },
  {
    id: 'tpiSmall',
    label: 'Local relief position',
    blurb:
      'Where this cell sits against its immediate few metres of ground — standardized, so the ' +
      'same number means "local high point" whether the hill is gentle or steep. Positive is a ' +
      'rise, negative is a dip.',
    unit: '',
    sliderMin: -3,
    sliderMax: 3,
    step: 0.1,
    decimals: 1,
    toDisplay: identity,
    toStored: identity,
  },
  {
    id: 'tpiLarge',
    label: 'Landscape position',
    blurb:
      'The same idea at hillside scale rather than a few metres — this is the number the ' +
      'landform classifier uses to tell a ridge from a valley floor.',
    unit: '',
    sliderMin: -3,
    sliderMax: 3,
    step: 0.1,
    decimals: 1,
    toDisplay: identity,
    toStored: identity,
  },
  {
    id: 'ruggedness',
    label: 'Ruggedness (TRI)',
    blurb:
      'Average elevation change to the eight neighbouring cells, in metres. High is broken, ' +
      'technical ground; low is a smooth bench or field.',
    unit: 'm',
    sliderMin: 0,
    sliderMax: 15,
    step: 0.1,
    decimals: 1,
    toDisplay: identity,
    toStored: identity,
  },
  {
    id: 'insolation',
    label: 'Sun exposure',
    blurb:
      'Fraction of the maximum possible direct sun this cell gets on the date and time you have ' +
      'set — 1 is a south face at solar noon, 0 is full shade.',
    unit: '',
    sliderMin: 0,
    sliderMax: 1,
    step: 0.05,
    decimals: 2,
    toDisplay: identity,
    toStored: identity,
  },
  {
    id: 'windExposure',
    label: 'Wind exposure',
    blurb:
      'How square this slope faces into the wind you set — +1 is dead into it, −1 is fully ' +
      'leeward. A cosine of the angle between slope aspect and wind, not a measurement of real ' +
      'shelter — see "Terrain shelter" for that.',
    unit: '',
    sliderMin: -1,
    sliderMax: 1,
    step: 0.05,
    decimals: 2,
    toDisplay: identity,
    toStored: identity,
    requiresWind: true,
  },
  {
    id: 'shelter',
    label: 'Terrain shelter',
    blurb:
      'How much upwind terrain actually blocks the wind you set, ray-marched cell by cell rather ' +
      'than read off the compass bearing of the slope — real shelter, not just which way it faces.',
    unit: '',
    sliderMin: 0,
    sliderMax: 1,
    step: 0.05,
    decimals: 2,
    toDisplay: identity,
    toStored: identity,
    requiresWind: true,
  },
  {
    id: 'skyView',
    label: 'Sky view factor',
    blurb:
      'Fraction of the overhead sky this cell can see. Low values are tucked under a ridgeline or ' +
      'down in a bowl — exactly where evening thermals pool and hold scent.',
    unit: '',
    sliderMin: 0,
    sliderMax: 1,
    step: 0.05,
    decimals: 2,
    toDisplay: identity,
    toStored: identity,
  },
  {
    id: 'bedding',
    label: 'Bedding score (raw)',
    blurb:
      'The engine’s raw composite score — leeward aspect, real upwind shelter, a beddable ' +
      'grade and cover, multiplied together. It rarely gets close to 1; read it as a ranking ' +
      'between cells on this property, not a percentage.',
    unit: '',
    sliderMin: 0,
    sliderMax: 0.3,
    step: 0.005,
    decimals: 3,
    toDisplay: identity,
    toStored: identity,
    requiresWind: true,
  },
];

export function metricDef(id: string): MetricDef | undefined {
  return RANGE_METRICS.find((m) => m.id === id);
}

/** Round-trips through the display unit and back — the guard `metricRegistry.test.ts` exercises for every entry. */
export function roundTripError(def: MetricDef, storedValue: number): number {
  return Math.abs(def.toStored(def.toDisplay(storedValue)) - storedValue);
}
