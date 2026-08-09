import { describe, expect, it } from 'vitest';
import { coverageExtentToDraw } from './coverageOverlay';
import { isSyncedLayer } from './baseSources';
import type { CoverageResult, CoverageState } from '../offline/coverage';

function state(over: Partial<CoverageResult>): CoverageState {
  return {
    kind: 'result',
    result: {
      status: 'partial',
      basis: 'view',
      viewZoom: 14,
      tileZoom: 14,
      neededTiles: 20,
      probedTiles: 20,
      presentTiles: 8,
      fraction: 0.4,
      sampled: false,
      coveredExtent: [{ z: 14, x: 4370, y: 6323 }],
      backend: 'opfs',
      volatile: false,
      ...over,
    },
  };
}

describe('what the map is allowed to draw', () => {
  it('draws the stored extent for an exact partial measurement', () => {
    expect(coverageExtentToDraw(state({}))).toHaveLength(1);
  });

  it('draws nothing while the answer is unknown', () => {
    // The state that matters: mid-pan. Leaving the previous view's extent
    // painted is a hatch that lags the map by one pan, which is its own lie.
    expect(coverageExtentToDraw({ kind: 'checking' })).toEqual([]);
    expect(coverageExtentToDraw({ kind: 'unavailable', reason: 'x' })).toEqual([]);
    expect(coverageExtentToDraw(null)).toEqual([]);
  });

  it('draws nothing when the measurement was sampled', () => {
    // A sample is a scatter of probed tiles, not an extent. Drawing it as one
    // replaces an honest percentage with a dishonest picture.
    expect(coverageExtentToDraw(state({ sampled: true }))).toEqual([]);
  });

  it('draws nothing for covered or empty', () => {
    expect(coverageExtentToDraw(state({ status: 'covered' }))).toEqual([]);
    expect(coverageExtentToDraw(state({ status: 'empty' }))).toEqual([]);
  });

  it('draws nothing when the gap is at a zoom the user cannot see yet', () => {
    expect(coverageExtentToDraw(state({ basis: 'detail' }))).toEqual([]);
  });
});

describe('layer ownership', () => {
  /**
   * `syncLayers` removes any `rl-*` layer it does not recognise. The coverage
   * overlay's layers are also `rl-*`, so a prefix-only test tore the hatch off
   * the map on the next layer toggle: the badge still said "Partial", and the
   * thing that told you *which half of the draw* silently disappeared.
   */
  it('does not claim the coverage overlay as one of its own layers', () => {
    expect(isSyncedLayer('offline-coverage-fill')).toBe(false);
    expect(isSyncedLayer('offline-coverage-line')).toBe(false);
  });

  it('still claims the real layers', () => {
    expect(isSyncedLayer('slope')).toBe(true);
    expect(isSyncedLayer('satellite')).toBe(true);
    expect(isSyncedLayer('__filters')).toBe(true);
  });
});
