import { describe, expect, it } from 'vitest';
import {
  evaluateFilter,
  matchFraction,
  PRESET_FILTERS,
  requiredMetrics,
  validatePredicate,
  type TerrainFields,
  type TerrainPredicate,
} from './terrainFilter.js';
import { WeissLandform, WoodFeature } from '../analysis/landform.js';

function fields(over: Partial<TerrainFields> = {}): TerrainFields {
  return {
    width: 4,
    height: 1,
    slope: Float32Array.from([2, 12, 24, 40]),
    aspect: Float32Array.from([0, 90, 180, 350]),
    weiss: Uint8Array.from([
      WeissLandform.Plain,
      WeissLandform.MidslopeDrainage,
      WeissLandform.MidslopeRidge,
      WeissLandform.MountainTop,
    ]),
    wood: Uint8Array.from([
      WoodFeature.Planar,
      WoodFeature.Channel,
      WoodFeature.Pass,
      WoodFeature.Ridge,
    ]),
    bench: Uint8Array.from([0, 1, 0, 0]),
    ...over,
  };
}

describe('range predicates', () => {
  it('matches an inclusive band', () => {
    const p: TerrainPredicate = { kind: 'range', metric: 'slope', min: 8, max: 30 };
    expect([...evaluateFilter(p, fields())]).toEqual([0, 1, 1, 0]);
  });

  it('treats a missing bound as unbounded', () => {
    expect([...evaluateFilter({ kind: 'range', metric: 'slope', min: 20 }, fields())]).toEqual([
      0, 0, 1, 1,
    ]);
    expect([...evaluateFilter({ kind: 'range', metric: 'slope', max: 20 }, fields())]).toEqual([
      1, 1, 0, 0,
    ]);
  });

  it('never matches NaN cells', () => {
    const f = fields({ slope: Float32Array.from([NaN, NaN, NaN, NaN]) });
    expect([...evaluateFilter({ kind: 'range', metric: 'slope', min: -1e9 }, f)]).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it('returns no matches when the referenced field is absent', () => {
    const f = fields({ skyView: undefined });
    expect([...evaluateFilter({ kind: 'range', metric: 'skyView', min: 0 }, f)]).toEqual([
      0, 0, 0, 0,
    ]);
  });
});

describe('aspect predicate', () => {
  it('wraps across north — the case a min/max range gets wrong', () => {
    // "North-facing" = 315°..45°, which straddles 0.
    const p: TerrainPredicate = { kind: 'aspect', centerDeg: 0, toleranceDeg: 45 };
    // Cells at aspect 0, 90, 180, 350 → only 0 and 350 are north-facing.
    expect([...evaluateFilter(p, fields())]).toEqual([1, 0, 0, 1]);
  });

  it('matches a normal non-wrapping window', () => {
    const p: TerrainPredicate = { kind: 'aspect', centerDeg: 135, toleranceDeg: 45 };
    expect([...evaluateFilter(p, fields())]).toEqual([0, 1, 1, 0]);
  });

  it('excludes flat cells by default and includes them on request', () => {
    const f = fields({ aspect: Float32Array.from([-1, -1, -1, -1]) });
    const base: TerrainPredicate = { kind: 'aspect', centerDeg: 0, toleranceDeg: 180 };
    expect([...evaluateFilter(base, f)]).toEqual([0, 0, 0, 0]);
    expect([...evaluateFilter({ ...base, includeFlat: true } as TerrainPredicate, f)]).toEqual([
      1, 1, 1, 1,
    ]);
  });
});

describe('categorical predicates', () => {
  it('matches Weiss classes', () => {
    const p: TerrainPredicate = {
      kind: 'weiss',
      classes: [WeissLandform.MidslopeDrainage, WeissLandform.MountainTop],
    };
    expect([...evaluateFilter(p, fields())]).toEqual([0, 1, 0, 1]);
  });

  it('matches Wood features — saddles are the headline case', () => {
    const p: TerrainPredicate = { kind: 'wood', features: [WoodFeature.Pass] };
    expect([...evaluateFilter(p, fields())]).toEqual([0, 0, 1, 0]);
  });

  it('matches bench flags in both directions', () => {
    expect([...evaluateFilter({ kind: 'bench', isBench: true }, fields())]).toEqual([0, 1, 0, 0]);
    expect([...evaluateFilter({ kind: 'bench', isBench: false }, fields())]).toEqual([1, 0, 1, 1]);
  });
});

describe('boolean composition', () => {
  it('combines with all / any / not', () => {
    const all: TerrainPredicate = {
      kind: 'all',
      operands: [
        { kind: 'range', metric: 'slope', min: 8 },
        { kind: 'range', metric: 'slope', max: 30 },
      ],
    };
    expect([...evaluateFilter(all, fields())]).toEqual([0, 1, 1, 0]);

    const any: TerrainPredicate = {
      kind: 'any',
      operands: [
        { kind: 'range', metric: 'slope', max: 5 },
        { kind: 'range', metric: 'slope', min: 35 },
      ],
    };
    expect([...evaluateFilter(any, fields())]).toEqual([1, 0, 0, 1]);

    expect([...evaluateFilter({ kind: 'not', operand: all }, fields())]).toEqual([1, 0, 0, 1]);
  });

  it('nests to arbitrary depth', () => {
    const p: TerrainPredicate = {
      kind: 'all',
      operands: [
        { kind: 'range', metric: 'slope', min: 5 },
        {
          kind: 'any',
          operands: [
            { kind: 'wood', features: [WoodFeature.Pass] },
            { kind: 'bench', isBench: true },
          ],
        },
      ],
    };
    expect([...evaluateFilter(p, fields())]).toEqual([0, 1, 1, 0]);
  });
});

describe('requiredMetrics', () => {
  it('reports only the fields a predicate actually reads', () => {
    const p: TerrainPredicate = {
      kind: 'all',
      operands: [
        { kind: 'range', metric: 'slope', min: 5 },
        { kind: 'aspect', centerDeg: 180, toleranceDeg: 45 },
        { kind: 'not', operand: { kind: 'wood', features: [WoodFeature.Pass] } },
      ],
    };
    expect([...requiredMetrics(p)].sort()).toEqual(['aspect', 'slope', 'wood']);
  });
});

describe('matchFraction', () => {
  it('reports the share of matched cells', () => {
    expect(matchFraction(Uint8Array.from([1, 0, 0, 1]))).toBe(0.5);
    expect(matchFraction(new Uint8Array(0))).toBe(0);
  });
});

describe('validatePredicate', () => {
  it('accepts well-formed predicates', () => {
    expect(validatePredicate({ kind: 'range', metric: 'slope', min: 5, max: 20 })).toBe(true);
    expect(validatePredicate({ kind: 'aspect', centerDeg: 0, toleranceDeg: 45 })).toBe(true);
    expect(validatePredicate({ kind: 'wood', features: [3] })).toBe(true);
  });

  it('rejects unknown metrics and unknown node kinds', () => {
    expect(validatePredicate({ kind: 'range', metric: 'bank_balance', min: 0 })).toBe(false);
    expect(validatePredicate({ kind: 'exec', cmd: 'rm -rf /' })).toBe(false);
    expect(validatePredicate(null)).toBe(false);
    expect(validatePredicate('slope > 5')).toBe(false);
  });

  it('rejects a deeply nested payload rather than blowing the stack', () => {
    // Shared filters arrive from other users, so depth is an attack surface.
    let deep: unknown = { kind: 'range', metric: 'slope', min: 1 };
    for (let i = 0; i < 200; i++) deep = { kind: 'not', operand: deep };
    expect(validatePredicate(deep)).toBe(false);
  });

  it('rejects an over-wide operand list', () => {
    const operands = Array.from({ length: 64 }, () => ({
      kind: 'range' as const,
      metric: 'slope' as const,
      min: 1,
    }));
    expect(validatePredicate({ kind: 'all', operands })).toBe(false);
  });
});

describe('PRESET_FILTERS', () => {
  it('are all structurally valid', () => {
    for (const f of PRESET_FILTERS) {
      expect(validatePredicate(f.predicate), f.name).toBe(true);
      expect(f.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(f.opacity).toBeGreaterThan(0);
      expect(f.opacity).toBeLessThanOrEqual(1);
      expect(f.description?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it('have unique names', () => {
    const names = PRESET_FILTERS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('evaluate against a realistic field bundle without throwing', () => {
    const f = fields({
      windExposure: Float32Array.from([-0.8, 0.2, -0.5, 0.9]),
      insolation: Float32Array.from([0.2, 0.7, 0.9, 0.1]),
      curvaturePlan: Float32Array.from([-0.002, 0.001, -0.003, 0]),
      skyView: Float32Array.from([0.6, 0.9, 0.7, 0.95]),
    });
    for (const preset of PRESET_FILTERS) {
      expect(evaluateFilter(preset.predicate, f).length).toBe(4);
    }
  });
});
