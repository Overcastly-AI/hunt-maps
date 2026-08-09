import { describe, expect, it } from 'vitest';
import {
  BoundaryDrawLayer,
  INITIAL_BOUNDARY_DRAW_STATE,
  boundaryDrawReducer,
  deriveBoundaryDraw,
  describeRingProblem,
  polygonToRing,
  ringAreaM2,
  ringSelfIntersects,
  ringToPolygon,
  toAcres,
  toHectares,
  type BoundaryDrawState,
  type DrawableMap,
  type LngLat,
} from './boundaryDraw';

/**
 * A one-degree-square box near the equator, where a degree of longitude and
 * a degree of latitude are both close to 111.32 km — the reference figure
 * used to sanity-check `ringAreaM2` against a closed-form expectation
 * (111,320 m × 111,320 m ≈ 1.239 × 10¹⁰ m²) without needing a second,
 * independent area implementation in the test itself.
 */
const UNIT_SQUARE: LngLat[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

// A real property is nowhere near a full degree — a small rectangle near
// mid-latitude Ohio (this app's own default map centre) exercises the same
// formula at a scale the drawer actually operates at.
const SMALL_RECT: LngLat[] = [
  [-82.541, 39.430],
  [-82.539, 39.430],
  [-82.539, 39.432],
  [-82.541, 39.432],
];

// Self-crossing "bowtie" — vertices in an order that makes edges 0-1 and 2-3 cross.
const BOWTIE: LngLat[] = [
  [0, 0],
  [1, 1],
  [1, 0],
  [0, 1],
];

describe('ringAreaM2', () => {
  it('matches the closed-form expectation for a one-degree box at the equator within 1%', () => {
    const expected = 111_320 * 111_320;
    const actual = ringAreaM2(UNIT_SQUARE);
    expect(Math.abs(actual - expected) / expected).toBeLessThan(0.01);
  });

  it('is zero for fewer than three points', () => {
    expect(ringAreaM2([])).toBe(0);
    expect(ringAreaM2([[0, 0]])).toBe(0);
    expect(ringAreaM2([[0, 0], [1, 0]])).toBe(0);
  });

  it('does not depend on winding order', () => {
    const cw = ringAreaM2(SMALL_RECT);
    const ccw = ringAreaM2([...SMALL_RECT].reverse());
    expect(ccw).toBeCloseTo(cw, 6);
  });

  it('is unaffected by an explicitly repeated closing point', () => {
    const open = ringAreaM2(SMALL_RECT);
    const closed = ringAreaM2([...SMALL_RECT, SMALL_RECT[0]]);
    expect(closed).toBeCloseTo(open, 6);
  });
});

describe('unit conversions', () => {
  it('10,000 m² is exactly one hectare', () => {
    expect(toHectares(10_000)).toBe(1);
  });

  it('a hectare is bigger than an acre — the acre figure must always read larger for the same ground', () => {
    const m2 = ringAreaM2(SMALL_RECT);
    expect(toAcres(m2)).toBeGreaterThan(toHectares(m2));
  });
});

describe('ringSelfIntersects', () => {
  it('is false for a simple rectangle', () => {
    expect(ringSelfIntersects(SMALL_RECT)).toBe(false);
  });

  it('is false for any triangle — three edges are always mutually adjacent', () => {
    expect(ringSelfIntersects([[0, 0], [1, 0], [0, 1]])).toBe(false);
  });

  it('is true for a bowtie', () => {
    expect(ringSelfIntersects(BOWTIE)).toBe(true);
  });

  it('is false for a simple concave (L-shaped) ring', () => {
    const lShape: LngLat[] = [
      [0, 0],
      [2, 0],
      [2, 1],
      [1, 1],
      [1, 2],
      [0, 2],
    ];
    expect(ringSelfIntersects(lShape)).toBe(false);
  });
});

describe('describeRingProblem', () => {
  it('is null for a clean simple rectangle', () => {
    expect(describeRingProblem(SMALL_RECT)).toBeNull();
  });

  it('flags too few points', () => {
    expect(describeRingProblem([[0, 0], [1, 0]])).toMatch(/at least three/);
  });

  it('flags a self-intersecting ring, naming the defect rather than a generic error', () => {
    expect(describeRingProblem(BOWTIE)).toMatch(/crosses itself/);
  });

  it('flags near-duplicate consecutive vertices', () => {
    const nearlyCoincident: LngLat[] = [
      [-82.541, 39.430],
      [-82.541, 39.430 + 1e-8], // well under half a metre away
      [-82.539, 39.432],
    ];
    expect(describeRingProblem(nearlyCoincident)).toMatch(/on top of each other/);
  });

  it('flags collinear points enclosing no area', () => {
    const line: LngLat[] = [
      [-82.541, 39.430],
      [-82.540, 39.430],
      [-82.539, 39.430],
    ];
    expect(describeRingProblem(line)).toMatch(/no area/);
  });
});

describe('ringToPolygon / polygonToRing', () => {
  it('closes an open ring by repeating the first point', () => {
    const polygon = ringToPolygon(SMALL_RECT);
    const coords = polygon.coordinates[0];
    expect(coords).toHaveLength(SMALL_RECT.length + 1);
    expect(coords[0]).toEqual(coords[coords.length - 1]);
  });

  it('does not double-close an already-closed ring', () => {
    const alreadyClosed = [...SMALL_RECT, SMALL_RECT[0]];
    const polygon = ringToPolygon(alreadyClosed);
    expect(polygon.coordinates[0]).toHaveLength(alreadyClosed.length);
  });

  it('round-trips through polygonToRing', () => {
    const polygon = ringToPolygon(SMALL_RECT);
    expect(polygonToRing(polygon)).toEqual(SMALL_RECT);
  });
});

describe('boundaryDrawReducer', () => {
  it('starts empty and open', () => {
    expect(INITIAL_BOUNDARY_DRAW_STATE).toEqual({ vertices: [], closed: false });
  });

  it('adds points in order while drawing', () => {
    let state = INITIAL_BOUNDARY_DRAW_STATE;
    for (const point of SMALL_RECT) {
      state = boundaryDrawReducer(state, { type: 'add', point });
    }
    expect(state.vertices).toEqual(SMALL_RECT);
    expect(state.closed).toBe(false);
  });

  it('refuses to add a point once closed', () => {
    let state: BoundaryDrawState = { vertices: SMALL_RECT, closed: true };
    state = boundaryDrawReducer(state, { type: 'add', point: [0, 0] });
    expect(state.vertices).toEqual(SMALL_RECT);
  });

  it('undo removes the last vertex and does nothing on empty', () => {
    let state = boundaryDrawReducer(INITIAL_BOUNDARY_DRAW_STATE, { type: 'add', point: SMALL_RECT[0] });
    state = boundaryDrawReducer(state, { type: 'undo' });
    expect(state.vertices).toEqual([]);
    state = boundaryDrawReducer(state, { type: 'undo' });
    expect(state.vertices).toEqual([]);
  });

  it('undo reopens a finished ring rather than being a no-op', () => {
    const finished: BoundaryDrawState = { vertices: SMALL_RECT, closed: true };
    const state = boundaryDrawReducer(finished, { type: 'undo' });
    expect(state.closed).toBe(false);
    expect(state.vertices).toEqual(SMALL_RECT.slice(0, -1));
  });

  it('finish requires at least three points', () => {
    const twoPoints: BoundaryDrawState = { vertices: SMALL_RECT.slice(0, 2), closed: false };
    const state = boundaryDrawReducer(twoPoints, { type: 'finish' });
    expect(state.closed).toBe(false);
  });

  it('finish refuses a self-intersecting ring — never silently closes a bowtie', () => {
    const bowtieState: BoundaryDrawState = { vertices: BOWTIE, closed: false };
    const state = boundaryDrawReducer(bowtieState, { type: 'finish' });
    expect(state.closed).toBe(false);
  });

  it('finish closes a valid ring', () => {
    const state = boundaryDrawReducer({ vertices: SMALL_RECT, closed: false }, { type: 'finish' });
    expect(state.closed).toBe(true);
  });

  it('clear resets to empty and open', () => {
    const state = boundaryDrawReducer({ vertices: SMALL_RECT, closed: true }, { type: 'clear' });
    expect(state).toEqual(INITIAL_BOUNDARY_DRAW_STATE);
  });

  it('move repositions one vertex and leaves the rest alone', () => {
    const state = boundaryDrawReducer(
      { vertices: SMALL_RECT, closed: false },
      { type: 'move', index: 1, point: [-82.5395, 39.4305] },
    );
    expect(state.vertices[1]).toEqual([-82.5395, 39.4305]);
    expect(state.vertices[0]).toEqual(SMALL_RECT[0]);
  });

  it('move ignores an out-of-range index rather than throwing', () => {
    const state = boundaryDrawReducer({ vertices: SMALL_RECT, closed: false }, { type: 'move', index: 99, point: [0, 0] });
    expect(state.vertices).toEqual(SMALL_RECT);
  });

  it('reset loads an existing boundary already closed, for the redraw flow', () => {
    const state = boundaryDrawReducer(INITIAL_BOUNDARY_DRAW_STATE, { type: 'reset', vertices: SMALL_RECT });
    expect(state.vertices).toEqual(SMALL_RECT);
    expect(state.closed).toBe(true);
  });
});

describe('deriveBoundaryDraw', () => {
  it('cannot finish with fewer than three points, and offers no polygon', () => {
    const derived = deriveBoundaryDraw({ vertices: SMALL_RECT.slice(0, 2), closed: false });
    expect(derived.canFinish).toBe(false);
    expect(derived.polygon).toBeNull();
  });

  it('can finish a clean, open ring with three or more points', () => {
    const derived = deriveBoundaryDraw({ vertices: SMALL_RECT, closed: false });
    expect(derived.canFinish).toBe(true);
    expect(derived.problem).toBeNull();
  });

  it('reports the problem instead of allowing finish for a bowtie', () => {
    const derived = deriveBoundaryDraw({ vertices: BOWTIE, closed: false });
    expect(derived.canFinish).toBe(false);
    expect(derived.problem).toMatch(/crosses itself/);
  });

  it('only emits a polygon once closed', () => {
    const open = deriveBoundaryDraw({ vertices: SMALL_RECT, closed: false });
    expect(open.polygon).toBeNull();
    const closed = deriveBoundaryDraw({ vertices: SMALL_RECT, closed: true });
    expect(closed.polygon).not.toBeNull();
    expect(closed.polygon?.type).toBe('Polygon');
  });

  it('area updates live as points are added, before the ring is closed', () => {
    const twoPoints = deriveBoundaryDraw({ vertices: SMALL_RECT.slice(0, 2), closed: false });
    const threePoints = deriveBoundaryDraw({ vertices: SMALL_RECT.slice(0, 3), closed: false });
    expect(twoPoints.areaM2).toBe(0);
    expect(threePoints.areaM2).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// BoundaryDrawLayer — exercised against the narrow `DrawableMap` interface,
// not a real MapLibre instance (see this module's own doc comment for why).
// ---------------------------------------------------------------------------

function fakeMap(): DrawableMap & { sources: Record<string, unknown[]>; layers: Set<string>; paint: Record<string, Record<string, unknown>> } {
  const sources: Record<string, unknown[]> = {};
  const layers = new Set<string>();
  const paint: Record<string, Record<string, unknown>> = {};
  return {
    sources,
    layers,
    paint,
    getSource(id: string) {
      if (!(id in sources)) return undefined;
      return {
        setData: (data: GeoJSON.FeatureCollection) => {
          sources[id] = data.features;
        },
      };
    },
    addSource(id: string) {
      sources[id] = [];
    },
    addLayer(layer: unknown, _before?: string) {
      const id = (layer as { id: string }).id;
      layers.add(id);
      paint[id] = { ...((layer as { paint?: Record<string, unknown> }).paint ?? {}) };
    },
    getLayer(id: string) {
      return layers.has(id) ? { id } : undefined;
    },
    removeLayer(id: string) {
      layers.delete(id);
    },
    removeSource(id: string) {
      delete sources[id];
    },
    setLayoutProperty() {},
    setPaintProperty(id: string, name: string, value: unknown) {
      paint[id] = { ...(paint[id] ?? {}), [name]: value };
    },
  };
}

describe('BoundaryDrawLayer', () => {
  it('installs both sources and every layer exactly once, even across repeated setDraft calls', () => {
    const map = fakeMap();
    const layer = new BoundaryDrawLayer(map);
    layer.setDraft(SMALL_RECT.slice(0, 2), false);
    layer.setDraft(SMALL_RECT, false);
    layer.setDraft(SMALL_RECT, true);

    expect(map.layers.has('rl-boundary-draft-fill')).toBe(true);
    expect(map.layers.has('rl-boundary-draft-line')).toBe(true);
    expect(map.layers.size).toBe(3); // fill + line + the reference line, installed together
  });

  it('the draft polygon only appears once there are at least three points', () => {
    const map = fakeMap();
    const layer = new BoundaryDrawLayer(map);
    layer.setDraft(SMALL_RECT.slice(0, 2), false);
    const twoPointFeatures = map.sources['rl-boundary-draft'] as GeoJSON.Feature[];
    expect(twoPointFeatures.some((f) => f.geometry.type === 'Polygon')).toBe(false);

    layer.setDraft(SMALL_RECT, false);
    const threePointFeatures = map.sources['rl-boundary-draft'] as GeoJSON.Feature[];
    expect(threePointFeatures.some((f) => f.geometry.type === 'Polygon')).toBe(true);
  });

  it('switches the outline dash pattern from open to closed', () => {
    const map = fakeMap();
    const layer = new BoundaryDrawLayer(map);
    layer.setDraft(SMALL_RECT, false);
    expect(map.paint['rl-boundary-draft-line']['line-dasharray']).toEqual([2, 1.5]);
    layer.setDraft(SMALL_RECT, true);
    expect(map.paint['rl-boundary-draft-line']['line-dasharray']).toEqual([1, 0]);
  });

  it('setReference draws nothing for an unset or too-short boundary, and something for a real one', () => {
    const map = fakeMap();
    const layer = new BoundaryDrawLayer(map);
    layer.setReference(null);
    expect((map.sources['rl-boundary-reference'] as GeoJSON.Feature[]).length).toBe(0);

    layer.setReference(SMALL_RECT);
    expect((map.sources['rl-boundary-reference'] as GeoJSON.Feature[]).length).toBeGreaterThan(0);
  });

  it('destroy removes every layer and source it installed', () => {
    const map = fakeMap();
    const layer = new BoundaryDrawLayer(map);
    layer.setDraft(SMALL_RECT, true);
    layer.destroy();
    expect(map.layers.size).toBe(0);
    expect(Object.keys(map.sources)).toEqual([]);
  });

  it('is inert after destroy — no re-adding sources a caller thinks are still gone', () => {
    const map = fakeMap();
    const layer = new BoundaryDrawLayer(map);
    layer.destroy();
    layer.setDraft(SMALL_RECT, true);
    expect(map.layers.size).toBe(0);
  });
});
