/**
 * Property boundary drawing — the pure geometry engine and the map-canvas
 * renderer, kept in one file per this task's territory brief.
 *
 * ## Why the client refuses a bad ring rather than letting the server clean it up
 *
 * `apps/api/src/prisma/geometry.service.ts` runs `ST_MakeValid` on every
 * incoming boundary specifically because a hand-drawn polygon from a
 * touchscreen very often self-intersects, and it is a deliberate, documented
 * choice there to repair rather than reject. That is the right call for a
 * geometry that arrives already wrong for reasons outside the drawer's
 * control (an offline-queued edit replayed later, a third-party import). It
 * is the wrong call for a boundary the user is drawing live in this editor:
 * `ST_MakeValid` on a self-intersecting ring can silently change *which
 * shape* gets stored — splitting a bowtie into the larger of its two lobes,
 * for instance — and a hunter who drew one shape and watched a different one
 * get saved has just experienced exactly the "confidently wrong about
 * terrain" failure `CLAUDE.md` names as the worst class this product has.
 * So: this module checks the same failure modes *before* the round trip and
 * explains them in the drawer's own language ("this line crosses itself")
 * rather than silently repairing or forwarding a server 400.
 *
 * ## Why area is computed here instead of waiting on the server
 *
 * The whole point of showing area live is that "is this the right piece of
 * ground" has to be answered while the ring is still being drawn, with no
 * round trip and no signal required — offline is the operating assumption.
 * `ringAreaM2` is the spherical-excess formula used by Turf.js's `area` and
 * Google's Maps geometry library (attributed to R. G. Chamberlain & W. H.
 * Duquette, NASA JPL, "Some Algorithms for Polygons on a Sphere", 2007) — a
 * mean-radius sphere, not the WGS84 ellipsoid PostGIS's `::geography` cast
 * uses server-side. That is a real, small discrepancy (well under 1% at
 * property scale) and this module is never the number of record: `create`/
 * `update`'s response carries the server's authoritative `areaHectares`,
 * computed on the real spheroid, and every screen in this feature re-reads
 * that once it exists rather than trusting its own live estimate past the
 * moment of save.
 */

import type { GeoPolygon } from '@hunt-maps/shared';
import { color } from '@hunt-maps/design';

/** `[longitude, latitude]` — GeoJSON axis order, matching `GeoPolygon`. */
export type LngLat = [number, number];

const EARTH_RADIUS_M = 6_371_008.8;
const M2_PER_HECTARE = 10_000;
const M2_PER_ACRE = 4_046.8564224;
/** Below this, a ring reads as "no real area" rather than a small property — collinear or coincident points, not ground. */
const MIN_AREA_M2 = 4;
/** Consecutive vertices closer than this are one point placed twice, not two distinct corners. */
const MIN_VERTEX_SEPARATION_M = 0.5;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Geodesic area of a closed ring, in square metres.
 *
 * `ring` is the *open* form — unique vertices, no repeated closing point.
 * Works for any winding order (returns the unsigned area) and treats the
 * ring as implicitly closed back to `ring[0]`, so it is safe to call on
 * every keystroke of a still-open drawing to show "if you closed it now".
 */
export function ringAreaM2(ring: LngLat[]): number {
  if (ring.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    total += toRadians(x2 - x1) * (2 + Math.sin(toRadians(y1)) + Math.sin(toRadians(y2)));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

export function toHectares(areaM2: number): number {
  return areaM2 / M2_PER_HECTARE;
}

export function toAcres(areaM2: number): number {
  return areaM2 / M2_PER_ACRE;
}

/** Haversine distance in metres — used only for the small-scale duplicate-vertex check below. */
function haversineMeters(a: LngLat, b: LngLat): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Orientation of the turn `p -> q -> r`: 0 collinear, 1 clockwise, 2 counter-clockwise. */
function orientation(p: LngLat, q: LngLat, r: LngLat): 0 | 1 | 2 {
  const val = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
  if (Math.abs(val) < 1e-12) return 0;
  return val > 0 ? 1 : 2;
}

function onSegment(p: LngLat, q: LngLat, r: LngLat): boolean {
  return (
    Math.min(p[0], r[0]) <= q[0] &&
    q[0] <= Math.max(p[0], r[0]) &&
    Math.min(p[1], r[1]) <= q[1] &&
    q[1] <= Math.max(p[1], r[1])
  );
}

/** Planar segment intersection test — accurate enough at property scale, where a geodesic correction is noise. */
function segmentsIntersect(p1: LngLat, q1: LngLat, p2: LngLat, q2: LngLat): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

/**
 * True if the ring, closed back to its first vertex, crosses itself anywhere
 * other than at shared corners.
 */
export function ringSelfIntersects(ring: LngLat[]): boolean {
  const n = ring.length;
  if (n < 4) return false; // a triangle's three edges are all mutually adjacent — nothing non-adjacent to cross
  for (let i = 0; i < n; i++) {
    const a1 = ring[i];
    const a2 = ring[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      const b1 = ring[j];
      const b2 = ring[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/**
 * Why this ring cannot be finished/saved as drawn, in the drawer's own
 * language — or `null` when it is a valid simple polygon. Callers with fewer
 * than 3 vertices should treat that as "not yet enough points" rather than
 * routing it through here; this function's job is judging a ring that is at
 * least nominally closeable, not counting points.
 */
export function describeRingProblem(ring: LngLat[]): string | null {
  if (ring.length < 3) return 'A boundary needs at least three points.';

  for (let i = 0; i < ring.length; i++) {
    const next = ring[(i + 1) % ring.length];
    if (haversineMeters(ring[i], next) < MIN_VERTEX_SEPARATION_M) {
      return 'Two points are on top of each other — move one apart before finishing.';
    }
  }

  // Checked before the area test on purpose: a self-crossing ring's two
  // lobes wind in opposite directions, so the shoelace sum can cancel
  // towards zero even though real ground is enclosed on each side — the
  // exact bowtie shape `ST_MakeValid` would silently repair server-side.
  // Naming that defect specifically is more useful than a "no area" message
  // that is technically true of the *sum* but not of what was drawn.
  if (ringSelfIntersects(ring)) {
    return 'This boundary crosses itself. Undo back to where the lines cross and redraw that side.';
  }

  if (ringAreaM2(ring) < MIN_AREA_M2) {
    return 'These points fall on a line and enclose no area — spread them out to outline real ground.';
  }

  return null;
}

/** Closes the ring (GeoJSON requires the first and last positions to match) and wraps it as a `Polygon`. */
export function ringToPolygon(ring: LngLat[]): GeoPolygon {
  const closed = ring.length > 0 && !samePoint(ring[0], ring[ring.length - 1]) ? [...ring, ring[0]] : ring;
  return { type: 'Polygon', coordinates: [closed] };
}

/** The inverse of `ringToPolygon` — the outer ring, with the redundant closing point dropped. */
export function polygonToRing(polygon: GeoPolygon): LngLat[] {
  const outer = polygon.coordinates[0] ?? [];
  if (outer.length > 1 && samePoint(outer[0], outer[outer.length - 1])) {
    return outer.slice(0, -1);
  }
  return outer.slice();
}

function samePoint(a: LngLat, b: LngLat): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

// ---------------------------------------------------------------------------
// The drawing state machine
// ---------------------------------------------------------------------------

export interface BoundaryDrawState {
  vertices: LngLat[];
  /** True once "Finish" (or the equivalent tap on the first vertex) has closed the ring. */
  closed: boolean;
}

export type BoundaryDrawAction =
  | { type: 'add'; point: LngLat }
  | { type: 'undo' }
  | { type: 'finish' }
  | { type: 'clear' }
  | { type: 'move'; index: number; point: LngLat }
  | { type: 'reset'; vertices: LngLat[] };

export const INITIAL_BOUNDARY_DRAW_STATE: BoundaryDrawState = { vertices: [], closed: false };

/**
 * Pure reducer — no MapLibre, no DOM, so it is exercised directly in tests
 * rather than only through a mounted map (`packages/design`'s own
 * `TerrainReadout.test.tsx` documents why a real map instance does not run
 * in this repo's `jsdom` test environment; this module is written so the one
 * part that matters for correctness never needs one).
 */
export function boundaryDrawReducer(
  state: BoundaryDrawState,
  action: BoundaryDrawAction,
): BoundaryDrawState {
  switch (action.type) {
    case 'add':
      // Once closed, a tap on the map is not "keep drawing" — the user must
      // explicitly undo or clear first. Silently reopening on a stray tap
      // would be a surprise edit to a shape someone just finished.
      if (state.closed) return state;
      return { ...state, vertices: [...state.vertices, action.point] };
    case 'undo':
      if (state.vertices.length === 0) return state;
      // Undoing always reopens the ring, even if it had been finished — "go
      // back a step" is the more useful reading of the one Undo control than
      // a second, closed-only meaning.
      return { vertices: state.vertices.slice(0, -1), closed: false };
    case 'finish':
      if (state.vertices.length < 3 || describeRingProblem(state.vertices)) return state;
      return { ...state, closed: true };
    case 'clear':
      return { vertices: [], closed: false };
    case 'move': {
      if (action.index < 0 || action.index >= state.vertices.length) return state;
      const vertices = state.vertices.slice();
      vertices[action.index] = action.point;
      return { ...state, vertices };
    }
    case 'reset':
      return { vertices: action.vertices, closed: action.vertices.length >= 3 };
    default:
      return state;
  }
}

export interface BoundaryDrawDerived {
  areaM2: number;
  areaHectares: number;
  areaAcres: number;
  /** Why the current ring cannot be finished/saved, or `null` when it is a valid simple polygon with enough points. */
  problem: string | null;
  /** `true` once there are enough points to offer "Finish" and nothing about the ring blocks it. */
  canFinish: boolean;
  /** The boundary to send to the API — only set once the ring is closed and clean. */
  polygon: GeoPolygon | null;
}

/** Everything a screen needs to render from a `BoundaryDrawState`, recomputed from scratch — cheap at drawing-scale vertex counts. */
export function deriveBoundaryDraw(state: BoundaryDrawState): BoundaryDrawDerived {
  const areaM2 = ringAreaM2(state.vertices);
  const problem = state.vertices.length >= 3 ? describeRingProblem(state.vertices) : null;
  return {
    areaM2,
    areaHectares: toHectares(areaM2),
    areaAcres: toAcres(areaM2),
    problem,
    canFinish: !state.closed && state.vertices.length >= 3 && !problem,
    polygon: state.closed && !problem ? ringToPolygon(state.vertices) : null,
  };
}

// ---------------------------------------------------------------------------
// The map-canvas renderer
// ---------------------------------------------------------------------------

/**
 * Minimal surface of `maplibregl.Map` this class touches — narrowed the same
 * way `lib/map/demTiles.ts`'s `BoundsLike` narrows `getBounds()`, so this
 * module (and its tests) do not need the real library or its WebGL context.
 */
export interface DrawableMap {
  getSource(id: string): { setData: (data: GeoJSON.FeatureCollection) => void } | undefined;
  addSource(id: string, source: unknown): void;
  addLayer(layer: unknown, before?: string): void;
  getLayer(id: string): unknown;
  removeLayer(id: string): void;
  removeSource(id: string): void;
  setLayoutProperty(id: string, name: string, value: unknown): void;
  setPaintProperty(id: string, name: string, value: unknown): void;
}

function ringFeatureCollection(ring: LngLat[], closed: boolean): GeoJSON.FeatureCollection {
  if (ring.length === 0) return { type: 'FeatureCollection', features: [] };
  const lineCoords = closed ? [...ring, ring[0]] : ring;
  const features: GeoJSON.Feature[] = [
    {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: lineCoords },
    },
  ];
  if (ring.length >= 3) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
    });
  }
  return { type: 'FeatureCollection', features };
}

const DRAFT_SOURCE = 'rl-boundary-draft';
const DRAFT_FILL_LAYER = 'rl-boundary-draft-fill';
const DRAFT_LINE_LAYER = 'rl-boundary-draft-line';
const REFERENCE_SOURCE = 'rl-boundary-reference';
const REFERENCE_LINE_LAYER = 'rl-boundary-reference-line';

/**
 * Renders the ring being drawn (fill + outline, amber — the one accent) and,
 * during a redraw, the property's existing saved boundary as a quiet
 * reference outline so a hunter can see exactly how much they are about to
 * change before they commit to it.
 *
 * Deliberately does not render the vertices themselves — those are real DOM
 * buttons (`BoundaryEditor.tsx`) so each one is a genuine ≥44×44 CSS px hit
 * target, which a canvas-painted dot cannot be to `elementFromPoint` no
 * matter how large its paint radius. Keeping that concern out of this class
 * is what lets it be tested with the narrow `DrawableMap` interface above
 * instead of a real WebGL map.
 */
export class BoundaryDrawLayer {
  private installed = false;
  private destroyed = false;

  constructor(private readonly map: DrawableMap) {}

  setDraft(ring: LngLat[], closed: boolean): void {
    if (this.destroyed) return;
    this.install();
    const source = this.map.getSource(DRAFT_SOURCE);
    source?.setData(ringFeatureCollection(ring, closed));
    // A style-level `setPaintProperty` rather than a data-driven expression:
    // "closed" is a property of the whole ring, not of any one feature, and
    // driving it from `['get', 'closed']` would need every feature stamped
    // with a property this class does not otherwise need to carry.
    this.map.setPaintProperty(
      DRAFT_LINE_LAYER,
      'line-dasharray',
      closed ? [1, 0] : [2, 1.5],
    );
  }

  /** The property's saved boundary, or `null` when there is none (a new property, or nothing to compare against). */
  setReference(ring: LngLat[] | null): void {
    if (this.destroyed) return;
    this.install();
    const source = this.map.getSource(REFERENCE_SOURCE);
    source?.setData(ring && ring.length >= 3 ? ringFeatureCollection(ring, true) : { type: 'FeatureCollection', features: [] });
  }

  private install(): void {
    if (this.installed) return;

    if (!this.map.getSource(REFERENCE_SOURCE)) {
      this.map.addSource(REFERENCE_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    if (!this.map.getLayer(REFERENCE_LINE_LAYER)) {
      this.map.addLayer({
        id: REFERENCE_LINE_LAYER,
        type: 'line',
        source: REFERENCE_SOURCE,
        filter: ['==', ['geometry-type'], 'LineString'],
        // The same quiet, "what already exists" language `RegionOutline`
        // uses for a pending download box — info, not accent, so the two
        // rings (what you have vs. what you are about to save) never share
        // a colour a colourblind user could mistake for the same thing.
        paint: { 'line-color': color.info, 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.8 },
      });
    }

    if (!this.map.getSource(DRAFT_SOURCE)) {
      this.map.addSource(DRAFT_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    if (!this.map.getLayer(DRAFT_FILL_LAYER)) {
      this.map.addLayer({
        id: DRAFT_FILL_LAYER,
        type: 'fill',
        source: DRAFT_SOURCE,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': color.accent, 'fill-opacity': 0.16 },
      });
    }
    if (!this.map.getLayer(DRAFT_LINE_LAYER)) {
      this.map.addLayer({
        id: DRAFT_LINE_LAYER,
        type: 'line',
        source: DRAFT_SOURCE,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
          'line-color': color.accent,
          'line-width': 3,
          // Dashed while still open — a visual echo of "not finished yet"
          // that does not depend on a hunter reading any text. `setDraft`
          // keeps this in sync with `closed` via `setPaintProperty`.
          'line-dasharray': [2, 1.5],
        },
      });
    }

    this.installed = true;
  }

  destroy(): void {
    this.destroyed = true;
    try {
      for (const id of [DRAFT_FILL_LAYER, DRAFT_LINE_LAYER, REFERENCE_LINE_LAYER]) {
        if (this.map.getLayer(id)) this.map.removeLayer(id);
      }
      if (this.map.getSource(DRAFT_SOURCE)) this.map.removeSource(DRAFT_SOURCE);
      if (this.map.getSource(REFERENCE_SOURCE)) this.map.removeSource(REFERENCE_SOURCE);
    } catch {
      // The map is going away anyway.
    }
    this.installed = false;
  }
}
