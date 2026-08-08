/**
 * Pure helpers for building and reasoning about a `TerrainPredicate` tree —
 * no rendering, so `predicateUtils.test.ts` can exercise all of it without a
 * DOM.
 *
 * ## The one rule every function here answers to
 *
 * **A saved filter is a validated AST, never code** (`CLAUDE.md`). Nothing in
 * this module ever serialises a function, a string of code, or anything an
 * `eval` could touch — every predicate this editor can build is inert JSON
 * the server already validates on the way in (`FiltersService.assertPredicate`)
 * and the way out (`FiltersService.importShared`). `parseStoredPredicate`
 * below re-validates on this side too: a predicate arriving from the network
 * — including a filter another user shared — is untrusted input the moment it
 * lands in this editor, exactly as much as it is server-side.
 */

import {
  requiredMetrics,
  validatePredicate,
  WeissLandform,
  WoodFeature,
  type AspectPredicate,
  type BenchPredicate,
  type GroupPredicate,
  type NotPredicate,
  type RangePredicate,
  type TerrainPredicate,
  type WeissPredicate,
  type WoodPredicate,
} from '@hunt-maps/terrain';
import { RANGE_METRICS } from './metricRegistry';

/** Server-side limits (`terrainFilter.ts#validatePredicate`) restated so the editor can warn before a save round-trips to a 400. */
export const MAX_PREDICATE_DEPTH = 12;
export const MAX_GROUP_OPERANDS = 32;

export type PredicateKind = TerrainPredicate['kind'];

export const PREDICATE_KIND_LABELS: Record<PredicateKind, string> = {
  range: 'Terrain value',
  aspect: 'Facing (aspect)',
  weiss: 'Landform',
  wood: 'Feature',
  bench: 'Bench',
  not: 'Not',
  all: 'Group',
  any: 'Group',
};

/** A sensible starting point for a freshly-added condition of each kind. */
export function defaultPredicateForKind(kind: 'range' | 'aspect' | 'weiss' | 'wood' | 'bench'): TerrainPredicate {
  switch (kind) {
    case 'range': {
      const def = RANGE_METRICS[1]; // slope — the most legible default
      return { kind: 'range', metric: def.id, min: 8, max: 20 } satisfies RangePredicate;
    }
    case 'aspect':
      return { kind: 'aspect', centerDeg: 0, toleranceDeg: 45, includeFlat: false } satisfies AspectPredicate;
    case 'weiss':
      return { kind: 'weiss', classes: [WeissLandform.MidslopeRidge] } satisfies WeissPredicate;
    case 'wood':
      return { kind: 'wood', features: [WoodFeature.Pass] } satisfies WoodPredicate;
    case 'bench':
      return { kind: 'bench', isBench: true } satisfies BenchPredicate;
  }
}

export function emptyGroup(mode: 'all' | 'any' = 'all'): GroupPredicate {
  return { kind: mode, operands: [] };
}

/**
 * Any `not` anywhere in the tree — `BACKLOG R56`.
 *
 * `evaluateFilter` correctly returns `false` for a range predicate on a
 * void/`NaN` cell, and `not` flips that `false` to `true`: a negated
 * predicate paints a confident "match" along the exact edge where the data
 * runs out. The real fix is tri-state evaluation in `@hunt-maps/terrain`
 * (out of this editor's territory — see the task brief). This editor's job is
 * narrower and non-negotiable: **never let a negation exist in the tree
 * silently.** Every call site that finds one true must say so, in the same
 * screen the user is editing, in plain language — not a tooltip.
 */
export function containsNegation(predicate: TerrainPredicate): boolean {
  if (predicate.kind === 'not') return true;
  if (predicate.kind === 'all' || predicate.kind === 'any') {
    return predicate.operands.some(containsNegation);
  }
  return false;
}

/** True once the tree has at least one real (non-group) condition. An empty root group is not a filter yet — `all` with zero operands matches *everything*, `any` matches *nothing*, and neither is a state worth saving or evaluating. */
export function hasAnyCondition(predicate: TerrainPredicate): boolean {
  switch (predicate.kind) {
    case 'all':
    case 'any':
      return predicate.operands.some(hasAnyCondition);
    case 'not':
      return hasAnyCondition(predicate.operand);
    default:
      return true;
  }
}

/** Deepest nesting level, root = 0. Mirrors the server's `depth` parameter in `validatePredicate`. */
export function predicateDepth(predicate: TerrainPredicate): number {
  if (predicate.kind === 'not') return 1 + predicateDepth(predicate.operand);
  if (predicate.kind === 'all' || predicate.kind === 'any') {
    return predicate.operands.length === 0 ? 1 : 1 + Math.max(...predicate.operands.map(predicateDepth));
  }
  return 0;
}

/** Widest single group in the tree, for the same 32-operand cap the server enforces. */
export function widestGroup(predicate: TerrainPredicate): number {
  if (predicate.kind === 'not') return widestGroup(predicate.operand);
  if (predicate.kind === 'all' || predicate.kind === 'any') {
    return Math.max(predicate.operands.length, 0, ...predicate.operands.map(widestGroup));
  }
  return 0;
}

/** Null when the tree is within the server's limits; otherwise a plain-language reason a save would be rejected. */
export function limitViolation(predicate: TerrainPredicate): string | null {
  if (predicateDepth(predicate) > MAX_PREDICATE_DEPTH) {
    return `This filter is nested ${MAX_PREDICATE_DEPTH + 1}+ levels deep — flatten some of the groups before saving.`;
  }
  if (widestGroup(predicate) > MAX_GROUP_OPERANDS) {
    return `One group has more than ${MAX_GROUP_OPERANDS} conditions in it — split it into nested groups before saving.`;
  }
  return null;
}

/** Every `TerrainMetric` a predicate reads that is only meaningful with a wind direction set — `windExposure`, `shelter`, `bedding`. */
export function windDependentMetrics(predicate: TerrainPredicate): string[] {
  const WIND_METRICS = new Set(['windExposure', 'shelter', 'bedding']);
  return [...requiredMetrics(predicate)].filter((m) => WIND_METRICS.has(m));
}

const OCTANTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function octant(deg: number): string {
  return OCTANTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/**
 * "north-through-east" style summary of an aspect window — the exact
 * language `docs/BACKLOG.md`'s `R2` row and `VISION.md` use for the feature
 * this editor exists to build. A hunter reasons in compass language, not
 * `centerDeg: 22.5, toleranceDeg: 67.5`.
 */
export function describeAspectWindow(centerDeg: number, toleranceDeg: number): string {
  if (toleranceDeg >= 180) return 'every direction';
  const lo = octant(centerDeg - toleranceDeg);
  const hi = octant(centerDeg + toleranceDeg);
  if (toleranceDeg <= 22.5) return `${lo}-facing`;
  return `${lo} through ${hi}`;
}

/**
 * Validate JSON arriving from the network (a saved filter, a shared filter
 * import, a preset) before treating it as a `TerrainPredicate` this editor
 * will render and let the user mutate. Mirrors
 * `FiltersService['assertPredicate']` — the server already refuses a bad
 * predicate on save, but a filter can reach this editor from `GET /filters`
 * or `POST /filters/:id/import` without ever going through that check again,
 * and a shared filter is exactly the untrusted-input case `CLAUDE.md`'s
 * "never `eval`, always validate" rule names explicitly.
 */
export function parseStoredPredicate(json: unknown): TerrainPredicate | null {
  return validatePredicate(json) ? json : null;
}

export function isRange(p: TerrainPredicate): p is RangePredicate {
  return p.kind === 'range';
}
export function isAspect(p: TerrainPredicate): p is AspectPredicate {
  return p.kind === 'aspect';
}
export function isWeiss(p: TerrainPredicate): p is WeissPredicate {
  return p.kind === 'weiss';
}
export function isWood(p: TerrainPredicate): p is WoodPredicate {
  return p.kind === 'wood';
}
export function isBench(p: TerrainPredicate): p is BenchPredicate {
  return p.kind === 'bench';
}
export function isNot(p: TerrainPredicate): p is NotPredicate {
  return p.kind === 'not';
}
export function isGroup(p: TerrainPredicate): p is GroupPredicate {
  return p.kind === 'all' || p.kind === 'any';
}
