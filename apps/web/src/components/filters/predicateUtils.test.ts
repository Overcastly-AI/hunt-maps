import { describe, expect, it } from 'vitest';
import type { TerrainPredicate } from '@hunt-maps/terrain';
import {
  containsNegation,
  defaultPredicateForKind,
  describeAspectWindow,
  emptyGroup,
  hasAnyCondition,
  limitViolation,
  parseStoredPredicate,
  predicateDepth,
  widestGroup,
  windDependentMetrics,
} from './predicateUtils';

describe('containsNegation — BACKLOG R56', () => {
  it('is false for a plain range/group tree', () => {
    const p: TerrainPredicate = {
      kind: 'all',
      operands: [{ kind: 'range', metric: 'slope', min: 8, max: 20 }],
    };
    expect(containsNegation(p)).toBe(false);
  });

  it('is true for a top-level not', () => {
    const p: TerrainPredicate = { kind: 'not', operand: { kind: 'bench', isBench: true } };
    expect(containsNegation(p)).toBe(true);
  });

  it('finds a not nested arbitrarily deep inside groups', () => {
    const p: TerrainPredicate = {
      kind: 'all',
      operands: [
        { kind: 'range', metric: 'slope', min: 0, max: 10 },
        {
          kind: 'any',
          operands: [{ kind: 'not', operand: { kind: 'range', metric: 'slope', min: 30, max: 90 } }],
        },
      ],
    };
    expect(containsNegation(p)).toBe(true);
  });
});

describe('hasAnyCondition — an empty group is not a filter yet', () => {
  it('is false for an empty all/any group', () => {
    expect(hasAnyCondition(emptyGroup('all'))).toBe(false);
    expect(hasAnyCondition(emptyGroup('any'))).toBe(false);
  });

  it('is true once a leaf condition exists anywhere in the tree', () => {
    const p: TerrainPredicate = { kind: 'all', operands: [emptyGroup('any')] };
    expect(hasAnyCondition(p)).toBe(false);
    const withLeaf: TerrainPredicate = {
      kind: 'all',
      operands: [{ kind: 'all', operands: [{ kind: 'bench', isBench: true }] }],
    };
    expect(hasAnyCondition(withLeaf)).toBe(true);
  });

  it('sees through a not wrapper', () => {
    const p: TerrainPredicate = { kind: 'not', operand: { kind: 'bench', isBench: true } };
    expect(hasAnyCondition(p)).toBe(true);
  });
});

describe('depth / width guards mirror the server (`validatePredicate`)', () => {
  it('reports depth 0 for a bare leaf', () => {
    expect(predicateDepth({ kind: 'bench', isBench: true })).toBe(0);
  });

  it('counts one level per group/not nesting', () => {
    const p: TerrainPredicate = {
      kind: 'all',
      operands: [{ kind: 'any', operands: [{ kind: 'not', operand: { kind: 'bench', isBench: true } }] }],
    };
    expect(predicateDepth(p)).toBe(3);
  });

  it('flags a tree past the server depth limit', () => {
    let p: TerrainPredicate = { kind: 'bench', isBench: true };
    for (let i = 0; i < 20; i++) p = { kind: 'all', operands: [p] };
    expect(limitViolation(p)).toMatch(/nested/i);
  });

  it('flags a group past the server operand-count limit', () => {
    const operands: TerrainPredicate[] = Array.from({ length: 40 }, () => ({
      kind: 'bench',
      isBench: true,
    }));
    expect(widestGroup({ kind: 'all', operands })).toBe(40);
    expect(limitViolation({ kind: 'all', operands })).toMatch(/conditions/i);
  });

  it('is clean for a small, real preset-shaped tree', () => {
    const p: TerrainPredicate = {
      kind: 'all',
      operands: [
        { kind: 'bench', isBench: true },
        { kind: 'range', metric: 'slope', max: 10 },
      ],
    };
    expect(limitViolation(p)).toBeNull();
  });
});

describe('windDependentMetrics', () => {
  it('is empty for geometry-only predicates', () => {
    expect(windDependentMetrics({ kind: 'range', metric: 'slope', min: 0, max: 10 })).toEqual([]);
  });

  it('finds windExposure/shelter/bedding, and only those', () => {
    const p: TerrainPredicate = {
      kind: 'all',
      operands: [
        { kind: 'range', metric: 'windExposure', max: -0.25 },
        { kind: 'range', metric: 'skyView', max: 0.7 },
      ],
    };
    expect(windDependentMetrics(p)).toEqual(['windExposure']);
  });
});

describe('describeAspectWindow — the "north-through-east" language from the ticket itself', () => {
  it('renders a narrow window as one octant', () => {
    expect(describeAspectWindow(0, 20)).toBe('N-facing');
  });

  it('renders a wide window as a through-range', () => {
    // North, ±45° — the VISION.md example.
    expect(describeAspectWindow(22.5, 45)).toBe('N through E');
  });

  it('renders a full circle as "every direction"', () => {
    expect(describeAspectWindow(90, 180)).toBe('every direction');
  });
});

describe('parseStoredPredicate — untrusted-input validation (`CLAUDE.md`: never trust a shared filter)', () => {
  it('accepts a well-formed predicate', () => {
    const json = { kind: 'range', metric: 'slope', min: 8, max: 20 };
    expect(parseStoredPredicate(json)).toEqual(json);
  });

  it('rejects a predicate with an unknown metric', () => {
    expect(parseStoredPredicate({ kind: 'range', metric: 'notAMetric', min: 0, max: 1 })).toBeNull();
  });

  it('rejects a bare function-shaped payload rather than ever evaluating it', () => {
    expect(parseStoredPredicate({ kind: 'eval', code: 'process.exit(1)' })).toBeNull();
  });

  it('rejects null/undefined/primitives without throwing', () => {
    expect(parseStoredPredicate(null)).toBeNull();
    expect(parseStoredPredicate(undefined)).toBeNull();
    expect(parseStoredPredicate('not an object')).toBeNull();
    expect(parseStoredPredicate(42)).toBeNull();
  });
});

describe('defaultPredicateForKind', () => {
  it('produces a valid predicate for every addable kind', () => {
    for (const kind of ['range', 'aspect', 'weiss', 'wood', 'bench'] as const) {
      const p = defaultPredicateForKind(kind);
      expect(p.kind).toBe(kind);
      expect(parseStoredPredicate(p)).not.toBeNull();
    }
  });
});
