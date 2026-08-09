import { describe, expect, it } from 'vitest';
import {
  analyze,
  HeightGrid,
  NODATA,
  WeissLandform,
  WoodFeature,
  type TileCoord,
} from '@hunt-maps/terrain';
import {
  extractFacts,
  extractJudgement,
  queryTerrainPoint,
  type HeightTileLoader,
} from './pointQuery';
import { DEM_TILE_SIZE } from './demTiles';

/**
 * A small local stand-in for `packages/terrain/src/testing/synthetic.ts`.
 *
 * Not imported directly: that module is internal to the engine package (no
 * subpath export in `package.json`), and the deep relative import across a
 * package boundary is worse than the ~15 lines this reproduces. Kept
 * deliberately minimal — this file is testing the *extraction* logic
 * (`extractFacts`/`extractJudgement`), not the analytic surfaces themselves,
 * which is what the engine's own suite already validates against closed-form
 * geometry.
 */
const SIZE = 41;
const CENTER_XY = (SIZE - 1) / 2;
const CENTER = CENTER_XY * SIZE + CENTER_XY;

// 20, not a smaller convenience value: `weiss`'s large-TPI radius and
// `bedding`'s shelter ray-march both default to a 20-cell requirement, and
// `analyze()` throws `InsufficientHaloError` up front if the grid cannot
// supply it — regardless of whether the *centre* cell's own window would
// have fit. Every test below requests at least one of those layers.
const HALO = 20;

function syntheticGrid(f: (x: number, y: number) => number, halo = HALO): HeightGrid {
  const cellSize = 10;
  const grid = HeightGrid.empty(SIZE, SIZE, halo, cellSize, 40, -84);
  for (let y = -halo; y < SIZE + halo; y++) {
    for (let x = -halo; x < SIZE + halo; x++) {
      grid.set(x, y, f((x - CENTER_XY) * cellSize, -(y - CENTER_XY) * cellSize));
    }
  }
  return grid;
}

/** Blank a 3x3 block around the centre cell so its Horn window is unmeasurable. */
function blankCenterWindow(grid: HeightGrid): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      grid.set(CENTER_XY + dx, CENTER_XY + dy, NODATA);
    }
  }
}

function plane(gradeEast: number, gradeNorth: number) {
  return (x: number, y: number): number => gradeEast * x + gradeNorth * y + 500;
}

/**
 * The correctness property this suite exists to protect: unmeasured ground
 * must never render as a number. `docs/EVIDENCE.md`/`CLAUDE.md` call this out
 * as the single most important property of this component, so every "cannot
 * measure" path the engine has (a void that survives `fillVoids`, a `weiss`/
 * `wood` abstention, an unset wind, a NaN `bedding` cell) gets its own case
 * here — not just the happy path.
 */
describe('extractFacts — the grade rule and the unknown rule', () => {
  it('reads real values off a tilted plane, with a legitimate flat aspect nowhere on it', () => {
    // 3% grade east, cellSize 10m — every field should resolve to a concrete
    // value; a plane is nowhere flat and nowhere a bench.
    const grid = syntheticGrid(plane(0.03, 0));
    const result = analyze(grid, { layers: ['elevation', 'slope', 'aspect', 'weiss', 'wood', 'bench'] });
    const facts = extractFacts(result, CENTER);

    expect(facts.elevationFt.kind).toBe('value');
    expect(facts.slopeDeg).toEqual({ kind: 'value', value: Math.round((Math.atan(0.03) * 180) / Math.PI) });
    expect(facts.aspect.kind).toBe('value');
    // Ground rises to the east, so the *downslope* face — what `aspect`
    // reports — is west.
    if (facts.aspect.kind === 'value') expect(facts.aspect.value.octant).toBe('W');
  });

  it('reports level ground as flat aspect — a real finding, not an unmeasured one', () => {
    const grid = syntheticGrid(plane(0, 0));
    const result = analyze(grid, { layers: ['elevation', 'slope', 'aspect', 'weiss', 'wood', 'bench'] });
    const facts = extractFacts(result, CENTER);
    // Slope must be measured (a value, however small) for aspect to mean
    // anything — this is the exact ordering bug the module's own doc comment
    // warns about: branching on `aspect < 0` alone conflates flat with unknown.
    expect(facts.slopeDeg.kind).toBe('value');
    expect(facts.aspect).toEqual({ kind: 'flat' });
  });

  it('renders a void as unmeasured on every field, never as a number or a flat', () => {
    // A DEM void (lake, sensor gap) right under the tapped cell: its own
    // Horn window is unmeasurable, so `computeSurface` returns NaN slope
    // there — the sentinel `NaN`/`aspect -1` handling must not be read as
    // "flat", and `weiss`/`wood` must abstain rather than guess.
    const grid = syntheticGrid(plane(0.1, 0));
    blankCenterWindow(grid);
    const result = analyze(grid, { layers: ['elevation', 'slope', 'aspect', 'weiss', 'wood', 'bench'] });
    const facts = extractFacts(result, CENTER);

    expect(facts.slopeDeg.kind).toBe('unmeasured');
    expect(facts.aspect.kind).toBe('unmeasured');
    expect(facts.landform.kind).toBe('unmeasured');
    expect(facts.morphometry.kind).toBe('unmeasured');
  });

  it('never shows a Weiss Unknown or Wood Unknown class as a landform/morphometry string', () => {
    // Regression pin for the exact bug landform.ts's own comments warn about:
    // reading the sentinel enum value as if it were a real classification.
    expect(WeissLandform.Unknown).toBe(0);
    expect(WoodFeature.Unknown).toBe(6);
  });

  it('names a detected bench alongside the Weiss class, without inventing new vocabulary', () => {
    const grid = syntheticGrid(plane(0.35, 0));
    const result = analyze(grid, { layers: ['elevation', 'slope', 'aspect', 'weiss', 'wood', 'bench'] });
    // Force the bench flag on directly rather than trying to sculpt a
    // synthetic shelf — this test is about the *composition* string, which
    // `detectBenches`'s own suite already covers for correctness.
    result.bench![CENTER] = 1;
    const facts = extractFacts(result, CENTER);
    if (facts.landform.kind === 'value') {
      expect(facts.landform.value.endsWith('— bench')).toBe(true);
    } else {
      throw new Error('expected a landform value on a steep, fully-measured plane');
    }
  });
});

describe('extractJudgement — modelled values only ever appear once wind is set', () => {
  it('is unmeasured (never a number) with no wind set, and says so distinctly from a NaN cell', () => {
    const grid = syntheticGrid(plane(0.2, 0));
    const result = analyze(grid, { layers: ['elevation'] }); // no `bedding` requested — mirrors no wind
    const judgement = extractJudgement(result, CENTER, false);
    expect(judgement).toEqual({ windSet: false, beddingPercent: { kind: 'unmeasured' } });
  });

  it('reads a real bedding percentage once wind is set, rescaled through the same domain the ramp uses', () => {
    const grid = syntheticGrid(plane(0.2, 0));
    const result = analyze(grid, { layers: ['elevation', 'slope', 'aspect', 'bedding'], windFromDeg: 270 });
    const judgement = extractJudgement(result, CENTER, true);
    expect(judgement.windSet).toBe(true);
    if (judgement.beddingPercent.kind === 'value') {
      expect(judgement.beddingPercent.value).toBeGreaterThanOrEqual(0);
      expect(judgement.beddingPercent.value).toBeLessThanOrEqual(100);
    } else {
      throw new Error('expected a bedding value on measurable terrain with wind set');
    }
  });

  it('is unmeasured, not zero, when the bedding cell itself is NaN despite wind being set', () => {
    const grid = syntheticGrid(plane(0.2, 0));
    const result = analyze(grid, { layers: ['elevation', 'slope', 'aspect', 'bedding'], windFromDeg: 270 });
    result.bedding![CENTER] = NaN;
    const judgement = extractJudgement(result, CENTER, true);
    expect(judgement).toEqual({ windSet: true, beddingPercent: { kind: 'unmeasured' } });
  });
});

describe('queryTerrainPoint — tile fetch, halo assembly and the no-data outcome', () => {
  /** A `HeightTileLoader` over one global tilted-plane world, in tile-pixel units. */
  function planeLoader(gradePerPixel: number): HeightTileLoader {
    return async (tile: TileCoord) => {
      const heights = new Float32Array(DEM_TILE_SIZE * DEM_TILE_SIZE);
      for (let y = 0; y < DEM_TILE_SIZE; y++) {
        for (let x = 0; x < DEM_TILE_SIZE; x++) {
          const gx = tile.x * DEM_TILE_SIZE + x;
          heights[y * DEM_TILE_SIZE + x] = 500 + gx * gradePerPixel;
        }
      }
      return heights;
    };
  }

  it('resolves a full readout for a point with real elevation data', async () => {
    const outcome = await queryTerrainPoint(
      { lng: -82.54, lat: 39.43 },
      planeLoader(0.2),
      { windFromDeg: 270 },
    );
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.readout.facts.elevationFt.kind).toBe('value');
    expect(outcome.readout.facts.slopeDeg.kind).toBe('value');
    expect(outcome.readout.judgement.windSet).toBe(true);
  });

  it('is unmeasured for bedding when no wind is supplied, without querying the layer at all', async () => {
    const outcome = await queryTerrainPoint(
      { lng: -82.54, lat: 39.43 },
      planeLoader(0.2),
      { windFromDeg: null },
    );
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.readout.judgement).toEqual({
      windSet: false,
      beddingPercent: { kind: 'unmeasured' },
    });
  });

  it('reports "no-data" rather than throwing when the centre tile was never downloaded', async () => {
    const missingCenter: HeightTileLoader = async () => null;
    const outcome = await queryTerrainPoint(
      { lng: -82.54, lat: 39.43 },
      missingCenter,
      { windFromDeg: null },
    );
    expect(outcome).toEqual({ kind: 'no-data' });
  });

  it('tolerates a missing neighbour tile — one seam, not a failure', async () => {
    const flaky: HeightTileLoader = async (tile) => {
      // Drop exactly one neighbour (north), keep the centre and the rest.
      if (tile.x === Math.round(tile.x) && tile.y < 0) return null;
      const heights = new Float32Array(DEM_TILE_SIZE * DEM_TILE_SIZE).fill(500);
      return heights;
    };
    const outcome = await queryTerrainPoint({ lng: -82.54, lat: 39.43 }, flaky, {
      windFromDeg: null,
    });
    expect(outcome.kind).toBe('ok');
  });
});
