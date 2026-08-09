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
import { BenchFlag, detectBenches, WeissLandform, WoodFeature } from '../analysis/landform.js';
import { computeSurface } from '../analysis/surface.js';
import { NODATA } from '../dem/encoding.js';
import { hillsideWithBench, plane, syntheticGrid } from '../testing/synthetic.js';

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

// ---------------------------------------------------------------------------
// R69 — a predicate must never match ground the engine did not measure.
//
// Two of the filter editor's own controls did. Both are the *absent vs measured*
// conflation this repo has now hit six times (`R30`, `R40`, `R41`, `R49`, `R66`),
// arriving in the filter layer:
//
//  - "Not on a bench" — `detectBenches` left the zero-initialised `0` on an
//    unmeasurable cell, and `(arr[i] === 1) === false` is `true` on `0`.
//  - "Also match flat ground" — `aspect` uses `-1` for *both* a genuinely flat
//    cell and an unmeasurable one, and this branch never read `slope`, which
//    `surface.ts:80-86` names in terms as the only field that can tell them
//    apart.
//
// The match-share percentage and the painted layer are computed from the same
// mask, so both were inflated by exactly the ground nobody knows anything about.
// ---------------------------------------------------------------------------
describe('predicates never match unmeasured ground (R69)', () => {
  const SIZE = 61;

  /** Cell-level fields: measured slope, measured flat, and a void. */
  function threeStates(): TerrainFields {
    return {
      width: 3,
      height: 1,
      //             sloped     flat      void
      slope: Float32Array.from([22, 0, NaN]),
      aspect: Float32Array.from([180, -1, -1]),
      bench: Uint8Array.from([BenchFlag.NotBench, BenchFlag.Bench, BenchFlag.Unknown]),
    };
  }

  describe('bench', () => {
    it('isBench:false matches a measured non-bench and abstains on a void', () => {
      const f = threeStates();
      expect([...evaluateFilter({ kind: 'bench', isBench: false }, f)]).toEqual([1, 0, 0]);
    });

    it('isBench:true is unchanged by the third state', () => {
      const f = threeStates();
      expect([...evaluateFilter({ kind: 'bench', isBench: true }, f)]).toEqual([0, 1, 0]);
    });

    it('matches neither way on a void — the mask has to abstain, not flip', () => {
      const f = threeStates();
      const yes = evaluateFilter({ kind: 'bench', isBench: true }, f);
      const no = evaluateFilter({ kind: 'bench', isBench: false }, f);
      expect(yes[2] || no[2], 'a void answers neither question').toBe(0);
    });

    it('a bare not-a-bench filter no longer claims 100% of a voided 25° plane', () => {
      // The reproduction, end to end. A uniform 25° plane has no benches at all,
      // so "not on a bench" is genuinely true of every cell the engine measured
      // — and of none of the 225 it did not. Before the fix the mask covered
      // 3721/3721 = 100.0% of the tile; the honest figure is 3496/3721 = 93.95%
      // of the tile, which is 100% of measured ground.
      const g = syntheticGrid(plane(0, Math.tan((25 * Math.PI) / 180)), {
        size: SIZE,
        halo: 12,
        cellSize: 10,
      });
      for (let y = 2; y <= 14; y++) for (let x = 2; x <= 14; x++) g.set(x, y, NODATA);
      const surface = computeSurface(g);
      const fields: TerrainFields = {
        width: SIZE,
        height: SIZE,
        slope: surface.slope,
        aspect: surface.aspect,
        bench: detectBenches(g, surface, { minCells: 1 }),
      };
      const mask = evaluateFilter({ kind: 'bench', isBench: false }, fields);
      expect(matchFraction(mask), 'was 1').toBeCloseTo(3496 / 3721, 12);
      let onVoid = 0;
      for (let i = 0; i < SIZE * SIZE; i++) {
        if (!Number.isFinite(surface.slope[i]) && mask[i]) onVoid++;
      }
      expect(onVoid, 'was 225').toBe(0);
    });
  });

  describe('aspect', () => {
    it('includeFlat matches a measured flat cell and not a void', () => {
      const f = threeStates();
      const p: TerrainPredicate = {
        kind: 'aspect',
        centerDeg: 0,
        toleranceDeg: 45,
        includeFlat: true,
      };
      // Cell 0 faces south (180°), so it is out of a north window either way.
      expect([...evaluateFilter(p, f)]).toEqual([0, 1, 0]);
    });

    it('still excludes measured flat ground when includeFlat is off', () => {
      const f = threeStates();
      const p: TerrainPredicate = { kind: 'aspect', centerDeg: 180, toleranceDeg: 45 };
      expect([...evaluateFilter(p, f)]).toEqual([1, 0, 0]);
    });

    it('abstains when slope is absent — it cannot tell flat from unmeasured', () => {
      // `requiredMetrics` asks for slope, but a caller can still hand over a
      // bundle without it. Guessing "flat" there is the same defect one level up.
      const f: TerrainFields = {
        width: 2,
        height: 1,
        aspect: Float32Array.from([-1, -1]),
      };
      const p: TerrainPredicate = {
        kind: 'aspect',
        centerDeg: 0,
        toleranceDeg: 45,
        includeFlat: true,
      };
      expect([...evaluateFilter(p, f)]).toEqual([0, 0]);
    });

    it('requiredMetrics asks for slope, because the flat test depends on it', () => {
      const p: TerrainPredicate = { kind: 'aspect', centerDeg: 0, toleranceDeg: 45 };
      expect([...requiredMetrics(p)].sort()).toEqual(['aspect', 'slope']);
    });

    it('"also match flat ground" over a voided plane matches nothing at all', () => {
      // The sharpest reproduction in the row: a 25° plane falling due south has
      // no north-facing cell and no flat cell, so the honest answer is 0%.
      // Before the fix the predicate matched 225 cells — 6.05% of the tile, and
      // **100% of what it matched was ground the engine had never measured**,
      // painted under a checkbox that calls it "flat ground".
      const g = syntheticGrid(plane(0, Math.tan((25 * Math.PI) / 180)), {
        size: SIZE,
        halo: 12,
        cellSize: 10,
      });
      for (let y = 2; y <= 14; y++) for (let x = 2; x <= 14; x++) g.set(x, y, NODATA);
      const surface = computeSurface(g);
      const fields: TerrainFields = {
        width: SIZE,
        height: SIZE,
        slope: surface.slope,
        aspect: surface.aspect,
      };
      const p: TerrainPredicate = {
        kind: 'aspect',
        centerDeg: 0,
        toleranceDeg: 45,
        includeFlat: true,
      };
      expect(matchFraction(evaluateFilter(p, fields)), 'was 225/3721').toBe(0);
    });

    it('a real flat pad still matches — the option is a user choice, not the bug', () => {
      // Anti-over-correction, and the reason `includeFlat` survives at all: the
      // bench pad of `hillsideWithBench` is dead level, so it has no aspect and
      // it is the ground a hunter asking for "flat" actually wants.
      const g = syntheticGrid(hillsideWithBench(0.6, -40, 40), {
        size: SIZE,
        halo: 12,
        cellSize: 10,
      });
      for (let y = 2; y <= 14; y++) for (let x = 2; x <= 14; x++) g.set(x, y, NODATA);
      const surface = computeSurface(g);
      const fields: TerrainFields = {
        width: SIZE,
        height: SIZE,
        slope: surface.slope,
        aspect: surface.aspect,
      };
      const mask = evaluateFilter(
        { kind: 'aspect', centerDeg: 0, toleranceDeg: 45, includeFlat: true },
        fields,
      );
      let onPad = 0;
      let onVoid = 0;
      for (let i = 0; i < SIZE * SIZE; i++) {
        if (!mask[i]) continue;
        if (Number.isFinite(surface.slope[i])) onPad++;
        else onVoid++;
      }
      expect(onPad, 'the level shelf, ~7 rows of 61').toBe(427);
      expect(onVoid, 'was 225').toBe(0);
    });
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
