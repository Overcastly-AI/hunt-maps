import { describe, expect, it } from 'vitest';
import { requiredMetrics, type TerrainMetric } from '@hunt-maps/terrain';
import { metricDef, RANGE_METRICS, roundTripError } from './metricRegistry';

describe('RANGE_METRICS — the unit-conversion guard', () => {
  it('never offers aspect as a range metric — it is circular and has its own predicate kind', () => {
    expect(RANGE_METRICS.some((m) => (m.id as string) === 'aspect')).toBe(false);
  });

  it('round-trips every metric through its display unit with negligible error', () => {
    // A handful of representative stored values per metric, including 0 and a
    // negative — the case that would expose a conversion that only works one
    // way (e.g. a stray `Math.abs`).
    const samples = [0, 1, -1, 123.456, -0.0123];
    for (const def of RANGE_METRICS) {
      for (const stored of samples) {
        expect(roundTripError(def, stored)).toBeLessThan(1e-6);
      }
    }
  });

  it("elevation's display unit is really feet, not a no-op — metres and feet must disagree", () => {
    const elevation = metricDef('elevation')!;
    // 1000 m is roughly 3280.84 ft — if `toDisplay` were ever accidentally
    // wired to `identity` this would be caught immediately.
    expect(elevation.toDisplay(1000)).toBeCloseTo(3280.84, 1);
    expect(elevation.toStored(3280.84)).toBeCloseTo(1000, 1);
  });

  it('flags exactly windExposure/shelter/bedding as wind-dependent, matching the engine fields wind.ts actually gates on windFromDeg', () => {
    const flagged = RANGE_METRICS.filter((m) => m.requiresWind).map((m) => m.id);
    expect(flagged.sort()).toEqual(['bedding', 'shelter', 'windExposure']);
  });

  it('every metric id is a real TerrainMetric the engine understands', () => {
    // Round-trip through `requiredMetrics` on a range predicate for each —
    // if a metric id were misspelled, the engine would silently treat the
    // predicate as reading a field that never gets computed.
    for (const def of RANGE_METRICS) {
      const required = requiredMetrics({ kind: 'range', metric: def.id as TerrainMetric, min: 0, max: 1 });
      expect(required.has(def.id)).toBe(true);
    }
  });

  it('every slider domain is non-degenerate (min < max, positive step)', () => {
    for (const def of RANGE_METRICS) {
      expect(def.sliderMin).toBeLessThan(def.sliderMax);
      expect(def.step).toBeGreaterThan(0);
    }
  });
});
