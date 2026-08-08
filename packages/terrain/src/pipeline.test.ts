import { describe, expect, it } from 'vitest';
import { analyze, requiredHalo, type AnalysisRequest } from './pipeline.js';
import { centerIndex, syntheticGrid, plane, hillsideWithBench } from './testing/synthetic.js';
import { requiredMetrics, evaluateFilter } from './filters/terrainFilter.js';
import { NODATA } from './dem/encoding.js';

const SIZE = 33;

describe('analyze', () => {
  it('computes only the requested layers', () => {
    const grid = syntheticGrid(plane(0.3, 0.1), { size: SIZE, halo: 24 });
    const r = analyze(grid, { layers: ['slope'] });

    expect(r.slope).toBeDefined();
    // Not asked for, so not computed — this is what keeps a filter slider at 60fps.
    expect(r.aspect).toBeUndefined();
    expect(r.weiss).toBeUndefined();
    expect(r.skyView).toBeUndefined();
    expect(r.bedding).toBeUndefined();
  });

  it('computes shared dependencies once and reuses them', () => {
    const grid = syntheticGrid(plane(0.3, 0.1), { size: SIZE, halo: 24 });
    const r = analyze(grid, { layers: ['slope', 'aspect', 'hillshade'] });
    // slope/aspect are views onto the single surface computation.
    expect(r.slope).toBe(r.surface.slope);
    expect(r.aspect).toBe(r.surface.aspect);
    expect(r.hillshade).toBeDefined();
  });

  it('produces every field a request asks for', () => {
    const grid = syntheticGrid(hillsideWithBench(0.6, -40, 40), {
      size: SIZE,
      halo: 26,
      cellSize: 10,
    });
    const request: AnalysisRequest = {
      layers: [
        'elevation',
        'slope',
        'aspect',
        'curvatureProfile',
        'curvaturePlan',
        'tpiSmall',
        'tpiLarge',
        'ruggedness',
        'weiss',
        'wood',
        'bench',
        'insolation',
        'windExposure',
        'shelter',
        'bedding',
        'hillshade',
      ],
      windFromDeg: 315,
      date: new Date('2026-11-15T17:00:00Z'),
      latitude: 39.7,
      longitude: -84.2,
    };
    const r = analyze(grid, request);

    for (const key of [
      'elevation',
      'slope',
      'aspect',
      'curvatureProfile',
      'curvaturePlan',
      'tpiSmall',
      'tpiLarge',
      'ruggedness',
      'weiss',
      'wood',
      'bench',
      'insolation',
      'windExposure',
      'shelter',
      'bedding',
      'hillshade',
    ] as const) {
      expect(r[key], key).toBeDefined();
      expect(r[key]!.length, key).toBe(SIZE * SIZE);
    }
  });

  it('skips wind-dependent layers when no wind direction is supplied', () => {
    const grid = syntheticGrid(plane(0.3, 0.1), { size: SIZE, halo: 24 });
    const r = analyze(grid, { layers: ['windExposure', 'bedding', 'shelter'] });
    expect(r.windExposure).toBeUndefined();
    expect(r.bedding).toBeUndefined();
    expect(r.shelter).toBeUndefined();
  });

  it('leaves bedding purely leeward unless a temperature is supplied (R22)', () => {
    // The season term must be opt-in end to end. A pipeline that quietly
    // defaulted to a season would move every user's bedding layer without
    // telling them which season it picked.
    const grid = syntheticGrid(plane(0, 0.4), { size: SIZE, halo: 24 });
    const base = analyze(grid, { layers: ['bedding'], windFromDeg: 0 }).bedding!;
    const warm = analyze(grid, {
      layers: ['bedding'],
      windFromDeg: 0,
      temperatureC: 14,
      date: new Date('2026-10-20T17:30:00Z'),
      latitude: 40,
      longitude: -84,
    }).bedding!;
    for (let i = 0; i < base.length; i++) {
      expect(Object.is(warm[i], base[i]), `cell ${i}`).toBe(true);
    }
  });

  it('moves bedding onto the sun-facing slope in cold weather (R22)', () => {
    const jan = new Date('2027-01-15T17:30:00Z');
    // Shelter is held equal across the two faces on purpose. On a pair of
    // opposing infinite planes, lee and shelter are perfectly confounded — the
    // sun face on a south wind is also the face with nothing upwind of it — and
    // shelter is a separate requirement that R22 did not make season-aware.
    // Pinning it isolates the aspect term, which is what changed.
    const flatShelter = new Float32Array(SIZE * SIZE).fill(0.8);
    const score = (gradeNorth: number, temperatureC?: number): number =>
      analyze(syntheticGrid(plane(0, gradeNorth), { size: SIZE, halo: 24 }), {
        layers: ['bedding'],
        windFromDeg: 180, // south wind: the north face is the lee
        date: jan,
        latitude: 40,
        longitude: -84,
        temperatureC,
        bedding: { shelter: flatShelter },
      }).bedding![centerIndex(SIZE)];

    // Leeward-only: the north face wins, which in January is the coldest cell on
    // the property and the one holding snow longest (Lang & Gates 1985 means:
    // SE face 18.1 cm vs NE face 21.7 cm — 1.20×, not the 2.32× once quoted
    // here, which compared a mean against a maximum).
    expect(score(-0.4)).toBeGreaterThan(score(0.4));
    // Same wind, same terrain, -12 °C: the south face wins. This exercises the
    // whole wiring — date and location resolved to a solar-noon sun position,
    // insolation built, blend weight ramped — from a single temperature input.
    expect(score(0.4, -12)).toBeGreaterThan(score(-0.4, -12));
  });

  it('exposes the sun position used for the insolation layer', () => {
    const grid = syntheticGrid(plane(0, 0.4), { size: SIZE, halo: 4 });
    const r = analyze(grid, {
      layers: ['insolation'],
      date: new Date('2026-11-15T17:30:00Z'),
      latitude: 40,
      longitude: -84,
    });
    expect(r.sun).toBeDefined();
    expect(r.sun!.altitude).toBeGreaterThan(0);
  });
});

describe('requiredHalo', () => {
  it('is 1 for plain 3x3 kernels', () => {
    expect(requiredHalo({ layers: ['slope', 'aspect', 'hillshade'] })).toBe(1);
  });

  it('grows to cover the large TPI radius', () => {
    expect(requiredHalo({ layers: ['tpiLarge'], tpiLargeRadius: 40 })).toBe(40);
  });

  it('grows to cover Weiss, which needs both TPI scales', () => {
    expect(requiredHalo({ layers: ['weiss'], weiss: { largeRadius: 32 } })).toBe(32);
  });

  it('covers the ray-marched layers', () => {
    expect(requiredHalo({ layers: ['skyView'] })).toBeGreaterThanOrEqual(24);
    expect(requiredHalo({ layers: ['bedding'] })).toBeGreaterThanOrEqual(20);
  });

  it('covers a widened bedding cover window', () => {
    // On a 1 m DEM the VRM window has to be far wider than the shelter march,
    // and an undersized halo there is the seam-grid bug in `grid.ts`.
    expect(requiredHalo({ layers: ['bedding'], coverRadiusCells: 45 })).toBe(46);
  });

  it('takes the maximum across all requested layers', () => {
    const halo = requiredHalo({
      layers: ['slope', 'bench', 'tpiLarge'],
      tpiLargeRadius: 30,
      bench: { ringRadius: 12 },
    });
    expect(halo).toBe(30);
  });
});

describe('pipeline + filter integration', () => {
  it('a filter’s required metrics can be fed straight into analyze()', () => {
    // This is the actual runtime contract: the client derives the layer set
    // from the enabled saved filters rather than computing everything.
    const predicate = {
      kind: 'all' as const,
      operands: [
        { kind: 'range' as const, metric: 'slope' as const, min: 8, max: 20 },
        { kind: 'bench' as const, isBench: true },
      ],
    };
    const layers = [...requiredMetrics(predicate)] as AnalysisRequest['layers'];
    const grid = syntheticGrid(hillsideWithBench(0.6, -40, 40), {
      size: SIZE,
      halo: 12,
      cellSize: 10,
    });
    const r = analyze(grid, { layers });

    expect(r.slope).toBeDefined();
    expect(r.bench).toBeDefined();
    expect(r.weiss).toBeUndefined();
  });
});

describe('analyze with a neighbour tile that never arrived (R49)', () => {
  /**
   * The end-to-end shape of the bug on a phone. `assembleGrid` leaves a missing
   * neighbour as `NODATA` *inside* the halo, so the tile's west column has an
   * unreadable 3x3 window while everything east of it is perfectly measurable.
   * Every layer must abstain on the same cells, or one layer contradicts
   * another about the same ground.
   */
  const HALO = 24;
  function tileWithMissingWestNeighbour() {
    const g = syntheticGrid(plane(Math.tan((15 * Math.PI) / 180), 0), {
      size: SIZE,
      halo: HALO,
      cellSize: 10,
    });
    for (let y = -HALO; y < SIZE + HALO; y++) {
      for (let x = -HALO; x < 0; x++) g.set(x, y, NODATA);
    }
    return g;
  }

  it('abstains on the fringe in every layer at once, and only there', () => {
    const g = tileWithMissingWestNeighbour();
    const r = analyze(g, {
      layers: [
        'slope',
        'aspect',
        'hillshade',
        'ruggedness',
        'curvaturePlan',
        'weiss',
        'wood',
        'bench',
        'windExposure',
      ],
      windFromDeg: 270,
    });

    for (let y = 0; y < SIZE; y++) {
      const west = y * SIZE;
      const east = y * SIZE + SIZE - 1;
      // Was: slope 89.93°, a definite hillshade, "Channel / draw", 33 km of
      // relief, and a confident crosswind exposure — one column deep, along
      // every edge where a tile failed to fetch.
      expect(r.slope![west], `slope west row ${y}`).toBeNaN();
      expect(r.hillshade![west], `hillshade west row ${y}`).toBeNaN();
      expect(r.ruggedness![west], `TRI west row ${y}`).toBeNaN();
      expect(r.curvaturePlan![west], `plan west row ${y}`).toBeNaN();
      expect(r.windExposure![west], `exposure west row ${y}`).toBeNaN();
      expect(r.weiss![west], `weiss west row ${y}`).toBe(0); // WeissLandform.Unknown
      expect(r.wood![west], `wood west row ${y}`).toBe(6); // WoodFeature.Unknown
      // `R69`: was 0, which is also what a measured 30° sidehill gets. The
      // third state is what lets a filter tell the two apart.
      expect(r.bench![west], `bench west row ${y}`).toBe(2); // BenchFlag.Unknown

      // One column in, everything is measurable and exactly right.
      expect(r.slope![west + 1], `slope col 1 row ${y}`).toBeCloseTo(15, 3);
      expect(r.slope![east], `slope east row ${y}`).toBeCloseTo(15, 3);
      expect(Number.isNaN(r.hillshade![east]), `hillshade east row ${y}`).toBe(false);
    }
  });

  it('does not let a saved filter select ground the engine never saw', () => {
    // The moat feature. A filter is a persisted, shareable object a hunter acts
    // on; matching the fringe would put a highlighted band along a download
    // boundary that looks exactly like a found feature.
    const g = tileWithMissingWestNeighbour();
    const r = analyze(g, { layers: ['slope', 'aspect', 'wood'] });
    const mask = evaluateFilter(
      {
        kind: 'all',
        operands: [
          { kind: 'range', metric: 'slope', min: 12, max: 25 },
          { kind: 'aspect', centerDeg: 270, toleranceDeg: 45 },
        ],
      },
      r,
    );
    for (let y = 0; y < SIZE; y++) {
      expect(mask[y * SIZE], `west fringe row ${y}`).toBe(0);
      // The rest of this 15° west-facing plane is exactly what the filter asks
      // for, so the guard must not have eaten the layer.
      expect(mask[y * SIZE + 5], `interior row ${y}`).toBe(1);
    }
  });

  it('and not through the two predicates a conjunction does not rescue (R69)', () => {
    // The test above passes because the slope clause abstains on the fringe.
    // That is what hid `R69` for a release: a filter is only exposed when every
    // clause is void-tolerant, which is precisely the case for a *single*
    // clause. Both of these are one click in the editor.
    const g = tileWithMissingWestNeighbour();
    const r = analyze(g, { layers: ['slope', 'aspect', 'bench'] });

    const notABench = evaluateFilter({ kind: 'bench', isBench: false }, r);
    const alsoFlat = evaluateFilter(
      { kind: 'aspect', centerDeg: 270, toleranceDeg: 45, includeFlat: true },
      r,
    );
    for (let y = 0; y < SIZE; y++) {
      expect(notABench[y * SIZE], `"not on a bench", west fringe row ${y}`).toBe(0);
      expect(alsoFlat[y * SIZE], `"also match flat", west fringe row ${y}`).toBe(0);
      // Anti-over-correction: this 15° plane is west-facing and benchless, so
      // both predicates are true of every measured cell on it.
      expect(notABench[y * SIZE + 5], `not-a-bench interior row ${y}`).toBe(1);
      expect(alsoFlat[y * SIZE + 5], `also-flat interior row ${y}`).toBe(1);
    }
  });
});
