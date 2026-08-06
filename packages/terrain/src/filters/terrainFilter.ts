/**
 * Terrain filters — saveable, composable terrain queries.
 *
 * ## The feature this exists for
 *
 * "Shade the slopes between 12° and 25° facing north-through-east, that sit on a
 * midslope bench, and **save that** so I can come back to it and follow the
 * channels through it."
 *
 * That is one query, and it is the core interaction of the product. Every
 * hunting app on the market ships *fixed* slope-angle shading with a palette
 * somebody else chose. Making the predicate itself a first-class, named,
 * persisted, shareable object is the differentiator: a user's "November leeward
 * benches" filter is their scouting IP, it travels with them offline, and it can
 * be handed to the corridor engine as an attraction field so generated travel
 * routes prefer exactly the terrain they identified.
 *
 * Filters are a small declarative AST rather than user-supplied code:
 *  - it serialises to JSON for storage, sync, and offline replay;
 *  - it evaluates identically on the server and in the browser worker;
 *  - it cannot execute anything, so a *shared* filter from another user is inert
 *    data, not a script — which matters the moment filter sharing exists.
 */

import { WeissLandform, WoodFeature } from '../analysis/landform.js';

/** Every scalar field a predicate can address. */
export type TerrainMetric =
  | 'elevation'
  | 'slope'
  | 'aspect'
  | 'curvatureProfile'
  | 'curvaturePlan'
  | 'tpiSmall'
  | 'tpiLarge'
  | 'ruggedness'
  | 'insolation'
  | 'windExposure'
  | 'shelter'
  | 'skyView'
  | 'bedding';

export interface RangePredicate {
  kind: 'range';
  metric: TerrainMetric;
  /** Inclusive lower bound. Omit for -Infinity. */
  min?: number;
  /** Inclusive upper bound. Omit for +Infinity. */
  max?: number;
}

/**
 * Aspect is circular: "north-facing" spans 315°–45°, which wraps past 0 and
 * breaks a naive min/max range. It gets its own predicate for that reason.
 */
export interface AspectPredicate {
  kind: 'aspect';
  /** Centre azimuth, degrees clockwise from north. */
  centerDeg: number;
  /** Half-width in degrees; 45 gives a 90° window. */
  toleranceDeg: number;
  /** Treat flat cells (aspect = -1) as matching. Default false. */
  includeFlat?: boolean;
}

export interface WeissPredicate {
  kind: 'weiss';
  classes: WeissLandform[];
}

export interface WoodPredicate {
  kind: 'wood';
  features: WoodFeature[];
}

export interface BenchPredicate {
  kind: 'bench';
  /** Match cells flagged as bench (true) or not (false). */
  isBench: boolean;
}

export interface NotPredicate {
  kind: 'not';
  operand: TerrainPredicate;
}

export interface GroupPredicate {
  kind: 'all' | 'any';
  operands: TerrainPredicate[];
}

export type TerrainPredicate =
  | RangePredicate
  | AspectPredicate
  | WeissPredicate
  | WoodPredicate
  | BenchPredicate
  | NotPredicate
  | GroupPredicate;

export interface TerrainFilter {
  id?: string;
  name: string;
  description?: string;
  predicate: TerrainPredicate;
  /** Fill colour as #rrggbb. */
  color: string;
  /** Fill opacity 0..1. */
  opacity: number;
  /** Draw an outline around matched regions. */
  outline?: boolean;
}

/** The field bundle a filter evaluates against. */
export interface TerrainFields {
  width: number;
  height: number;
  elevation?: Float32Array;
  slope?: Float32Array;
  aspect?: Float32Array;
  curvatureProfile?: Float32Array;
  curvaturePlan?: Float32Array;
  tpiSmall?: Float32Array;
  tpiLarge?: Float32Array;
  ruggedness?: Float32Array;
  insolation?: Float32Array;
  windExposure?: Float32Array;
  shelter?: Float32Array;
  skyView?: Float32Array;
  bedding?: Float32Array;
  weiss?: Uint8Array;
  wood?: Uint8Array;
  bench?: Uint8Array;
}

/**
 * Which fields a predicate needs.
 *
 * The evaluator is cheap; *producing* the fields is not — a 20-cell-radius TPI
 * or a sky-view factor pass costs real milliseconds per tile. Walking the AST
 * first and computing only what is referenced is what keeps an interactive
 * filter editor responsive at 60fps while the user drags a slope slider.
 */
export function requiredMetrics(predicate: TerrainPredicate): Set<string> {
  const out = new Set<string>();
  walk(predicate);
  return out;

  function walk(p: TerrainPredicate): void {
    switch (p.kind) {
      case 'range':
        out.add(p.metric);
        break;
      case 'aspect':
        out.add('aspect');
        break;
      case 'weiss':
        out.add('weiss');
        break;
      case 'wood':
        out.add('wood');
        break;
      case 'bench':
        out.add('bench');
        break;
      case 'not':
        walk(p.operand);
        break;
      case 'all':
      case 'any':
        p.operands.forEach(walk);
        break;
    }
  }
}

/** Evaluate a predicate at one cell. */
export function evaluateAt(
  predicate: TerrainPredicate,
  fields: TerrainFields,
  i: number,
): boolean {
  switch (predicate.kind) {
    case 'range': {
      const arr = fields[predicate.metric];
      if (!arr) return false;
      const v = arr[i];
      if (!Number.isFinite(v)) return false;
      if (predicate.min !== undefined && v < predicate.min) return false;
      if (predicate.max !== undefined && v > predicate.max) return false;
      return true;
    }
    case 'aspect': {
      const arr = fields.aspect;
      if (!arr) return false;
      const a = arr[i];
      if (a < 0 || !Number.isFinite(a)) return predicate.includeFlat === true;
      let d = ((a - predicate.centerDeg + 180) % 360) - 180;
      if (d < -180) d += 360;
      return Math.abs(d) <= predicate.toleranceDeg;
    }
    case 'weiss': {
      const arr = fields.weiss;
      if (!arr) return false;
      return predicate.classes.includes(arr[i] as WeissLandform);
    }
    case 'wood': {
      const arr = fields.wood;
      if (!arr) return false;
      return predicate.features.includes(arr[i] as WoodFeature);
    }
    case 'bench': {
      const arr = fields.bench;
      if (!arr) return false;
      return (arr[i] === 1) === predicate.isBench;
    }
    case 'not':
      return !evaluateAt(predicate.operand, fields, i);
    case 'all':
      return predicate.operands.every((p) => evaluateAt(p, fields, i));
    case 'any':
      return predicate.operands.some((p) => evaluateAt(p, fields, i));
  }
}

/** Evaluate a predicate over an entire field bundle. */
export function evaluateFilter(
  predicate: TerrainPredicate,
  fields: TerrainFields,
): Uint8Array {
  const n = fields.width * fields.height;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (evaluateAt(predicate, fields, i)) out[i] = 1;
  }
  return out;
}

/** Fraction of cells matched — the "this filter covers 3.2% of the property" stat. */
export function matchFraction(mask: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < mask.length; i++) count += mask[i];
  return mask.length === 0 ? 0 : count / mask.length;
}

/**
 * Validate a filter arriving from the network.
 *
 * Filters are shareable, so the API accepts them from one user and evaluates
 * them for another. Depth is bounded to keep a hostile payload from blowing the
 * evaluator's stack, and every enum value is checked rather than trusted.
 */
export function validatePredicate(p: unknown, depth = 0): p is TerrainPredicate {
  if (depth > 12) return false;
  if (!p || typeof p !== 'object') return false;
  const node = p as Record<string, unknown>;

  switch (node.kind) {
    case 'range':
      return (
        typeof node.metric === 'string' &&
        VALID_METRICS.has(node.metric) &&
        (node.min === undefined || Number.isFinite(node.min)) &&
        (node.max === undefined || Number.isFinite(node.max))
      );
    case 'aspect':
      return Number.isFinite(node.centerDeg) && Number.isFinite(node.toleranceDeg);
    case 'weiss':
      return Array.isArray(node.classes) && node.classes.every((c) => Number.isInteger(c));
    case 'wood':
      return Array.isArray(node.features) && node.features.every((f) => Number.isInteger(f));
    case 'bench':
      return typeof node.isBench === 'boolean';
    case 'not':
      return validatePredicate(node.operand, depth + 1);
    case 'all':
    case 'any':
      return (
        Array.isArray(node.operands) &&
        node.operands.length <= 32 &&
        node.operands.every((o) => validatePredicate(o, depth + 1))
      );
    default:
      return false;
  }
}

const VALID_METRICS = new Set<string>([
  'elevation',
  'slope',
  'aspect',
  'curvatureProfile',
  'curvaturePlan',
  'tpiSmall',
  'tpiLarge',
  'ruggedness',
  'insolation',
  'windExposure',
  'shelter',
  'skyView',
  'bedding',
]);

// ---------------------------------------------------------------------------
// Starter filters
// ---------------------------------------------------------------------------

/**
 * Preset filters shipped with the app.
 *
 * These double as documentation: each one encodes a piece of published whitetail
 * terrain doctrine as a machine-checkable predicate, so a new user sees what the
 * language can express before writing their own.
 */
export const PRESET_FILTERS: TerrainFilter[] = [
  {
    name: 'Bedding benches',
    description:
      'Gentle shelves embedded in steep ground. Mark them, connect them, and you have the ' +
      'travel skeleton of a hill-country property.',
    color: '#e8a33d',
    opacity: 0.55,
    outline: true,
    predicate: {
      kind: 'all',
      operands: [
        { kind: 'bench', isBench: true },
        { kind: 'range', metric: 'slope', max: 10 },
      ],
    },
  },
  {
    name: 'Saddles & crossings',
    description:
      'Low points on a ridge where deer cross instead of climbing over the top. The ' +
      'highest-value single feature on a topo map.',
    color: '#3fb6d8',
    opacity: 0.7,
    outline: true,
    predicate: { kind: 'wood', features: [WoodFeature.Pass] },
  },
  {
    name: 'Midslope drainages',
    description:
      'Shallow draws running down the side of a hill. Cover, a contour to walk, and a ' +
      'thermal channel all in one — the classic travel corridor.',
    color: '#5fd08a',
    opacity: 0.5,
    predicate: {
      kind: 'all',
      operands: [
        { kind: 'weiss', classes: [WeissLandform.MidslopeDrainage] },
        { kind: 'range', metric: 'slope', min: 3, max: 30 },
      ],
    },
  },
  {
    name: 'Leeward spur points',
    description:
      'Ridge points on the downwind side, at a grade a buck can bed on and still watch the ' +
      'open slope below. Needs a wind direction set.',
    color: '#d8574b',
    opacity: 0.6,
    outline: true,
    predicate: {
      kind: 'all',
      operands: [
        {
          kind: 'weiss',
          classes: [WeissLandform.MidslopeRidge, WeissLandform.LocalRidgeInValley],
        },
        { kind: 'range', metric: 'windExposure', max: -0.25 },
        { kind: 'range', metric: 'slope', min: 10, max: 35 },
      ],
    },
  },
  {
    name: 'Late-season sun slopes',
    description:
      'Faces taking the most direct sun for the selected date. Where deer bed once it turns ' +
      'cold, and it moves through the season as declination shifts.',
    color: '#f2c14e',
    opacity: 0.5,
    predicate: {
      kind: 'all',
      operands: [
        { kind: 'range', metric: 'insolation', min: 0.6 },
        { kind: 'range', metric: 'slope', min: 5 },
      ],
    },
  },
  {
    name: 'Sidehill walkable grade',
    description:
      'The 8–20° band deer contour along without climbing. Trace it around a hill and you ' +
      'are usually tracing a trail.',
    color: '#9b8cf5',
    opacity: 0.4,
    predicate: { kind: 'range', metric: 'slope', min: 8, max: 20 },
  },
  {
    name: 'Thermal sinks',
    description:
      'Convergent low ground with a closed-in sky view — where evening thermals pool and ' +
      'your scent goes to die. Read it as a place NOT to walk out through.',
    color: '#7f8fa6',
    opacity: 0.45,
    predicate: {
      kind: 'all',
      operands: [
        { kind: 'range', metric: 'curvaturePlan', max: -0.001 },
        { kind: 'range', metric: 'skyView', max: 0.72 },
      ],
    },
  },
];
