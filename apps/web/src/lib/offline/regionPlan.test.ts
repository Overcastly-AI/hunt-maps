import { describe, expect, it } from 'vitest';
import type { BBox } from '@hunt-maps/terrain';
import {
  DEM_BYTES_PER_TILE,
  DETAIL_ZOOMS,
  OVERVIEW_LEVELS,
  REGION_MIN_ZOOM,
  boundsSpanMiles,
  formatBytes,
  padBounds,
  planCounts,
  planRegion,
  planZooms,
  zoomRange,
} from './regionPlan';
import { queryViewportCoverage } from './coverage';
import { DEM_MAX_ZOOM, demSourceZoom, demTileKey, demTilesForBounds, tileId } from '../map/demTiles';
import type { TileKey, TileStore, TileStoreStats } from './tileStore';

/** Hocking Hills, the app's default view. Real ridge-and-draw country. */
const VIEW: BBox = { west: -82.6, south: 39.39, east: -82.48, north: 39.47 };

class SeededStore implements TileStore {
  readonly backend = 'opfs' as const;
  readonly keys = new Set<string>();

  private id(k: TileKey): string {
    return `${k.layer}/${k.z}/${k.x}/${k.y}`;
  }
  async has(key: TileKey): Promise<boolean> {
    return this.keys.has(this.id(key));
  }
  async get(): Promise<ArrayBuffer | null> {
    return null;
  }
  async put(key: TileKey): Promise<void> {
    this.keys.add(this.id(key));
  }
  async delete(key: TileKey): Promise<boolean> {
    return this.keys.delete(this.id(key));
  }
  async deleteRegion(): Promise<number> {
    return 0;
  }
  async stats(): Promise<TileStoreStats> {
    return { backend: this.backend, tileCount: this.keys.size, bytes: 0 };
  }
  async clear(): Promise<void> {
    this.keys.clear();
  }
}

describe('zoomRange', () => {
  it('spans overview levels below the view up to the chosen detail zoom', () => {
    expect(zoomRange(14, 15)).toEqual({ minZoom: 14 - OVERVIEW_LEVELS, maxZoom: 15 });
  });

  it('never goes below the API-mirrored floor', () => {
    expect(zoomRange(6, 12).minZoom).toBe(REGION_MIN_ZOOM);
  });

  it('never plans deeper than the deepest zoom elevation is stored at', () => {
    // Anything past DEM_MAX_ZOOM is bytes nothing ever reads: MapLibre
    // overzooms z15 rather than requesting z16.
    expect(zoomRange(14, 17).maxZoom).toBe(DEM_MAX_ZOOM);
    expect(DETAIL_ZOOMS[DETAIL_ZOOMS.length - 1]).toBe(DEM_MAX_ZOOM);
  });

  it('collapses to a single level when the view is already deeper than the detail choice', () => {
    // A user zoomed to z15 who picks "z12" gets z12 only — not an inverted
    // range that silently enumerates nothing.
    const range = zoomRange(15, 12);
    expect(range.minZoom).toBeLessThanOrEqual(range.maxZoom);
    expect(range.maxZoom).toBe(12);
  });
});

describe('padBounds', () => {
  it('grows the box by the given fraction of its own span on each side', () => {
    const padded = padBounds({ west: -1, south: -1, east: 1, north: 1 }, 0.5);
    expect(padded.west).toBeCloseTo(-2);
    expect(padded.east).toBeCloseTo(2);
    expect(padded.south).toBeCloseTo(-2);
    expect(padded.north).toBeCloseTo(2);
  });

  it('is a no-op at zero, so "this view" means exactly this view', () => {
    expect(padBounds(VIEW, 0)).toEqual(VIEW);
  });

  it('clamps latitude to the Mercator cut-off rather than running off the grid', () => {
    const padded = padBounds({ west: -10, south: 80, east: 10, north: 85 }, 2);
    expect(padded.north).toBeLessThanOrEqual(85.051129);
    expect(padded.south).toBeGreaterThanOrEqual(-85.051129);
  });
});

describe('planRegion', () => {
  it('enumerates every level in the range, coarsest first', () => {
    const plan = planRegion(VIEW, 14, 15);
    expect(plan.minZoom).toBe(12);
    expect(plan.maxZoom).toBe(15);
    const zooms = plan.tiles.map((t) => t.z);
    expect([...zooms].sort((a, b) => a - b)).toEqual(zooms);
    // Coarse-first is load-bearing: a run killed early must leave a usable
    // overview of the whole region rather than one perfect corner.
    expect(zooms[0]).toBe(12);
  });

  it('agrees with its own count-only fast path', () => {
    const counts = planCounts(VIEW, 14, 15);
    const plan = planRegion(VIEW, 14, 15);
    expect(plan.tileCount).toBe(counts.tileCount);
    expect(plan.byZoom).toEqual(counts.byZoom);
  });

  it('prices the download from the measured elevation-tile size', () => {
    const plan = planRegion(VIEW, 14, 15);
    expect(plan.estimatedBytes).toBe(plan.tileCount * DEM_BYTES_PER_TILE);
  });

  it('quadruples roughly per zoom level, which is the thing users get wrong', () => {
    const shallow = planCounts(VIEW, 14, 13).tileCount;
    const deep = planCounts(VIEW, 14, 15).tileCount;
    expect(deep).toBeGreaterThan(shallow * 3);
  });
});

/**
 * The invariant this whole feature stands on.
 *
 * R8's defect was two components disagreeing about which tiles a view needs.
 * Rebuilding that in the picker — planning one set and probing another — would
 * produce a download that finishes and a badge that still says "Not
 * downloaded", or worse, the reverse. So this does not compare tile lists by
 * eye: it seeds a real coverage probe with *exactly* the plan's tiles and
 * asserts the badge's own verdict comes back `covered`.
 */
describe('a completed download satisfies the coverage probe', () => {
  it('makes the current view read Covered at the zoom the badge measures', async () => {
    const mapZoom = 13;
    const viewTileZoom = demSourceZoom(mapZoom);
    const plan = planRegion(VIEW, viewTileZoom, DEM_MAX_ZOOM);

    const store = new SeededStore();
    for (const tile of plan.tiles) await store.put(demTileKey(tile));

    const result = await queryViewportCoverage({ bounds: VIEW, zoom: mapZoom, store });
    expect(result.status).toBe('covered');
    expect(result.presentTiles).toBe(result.probedTiles);
  });

  it('also satisfies the deeper detail sample, so the badge does not fall to "Detail missing"', async () => {
    // The coverage check probes DEM_MAX_ZOOM separately once the current zoom
    // comes back clean. A plan that stopped at the view's own zoom would pass
    // the assertion above and still leave a hunter with "Detail missing".
    const mapZoom = 12;
    const plan = planRegion(VIEW, demSourceZoom(mapZoom), DEM_MAX_ZOOM);
    const store = new SeededStore();
    for (const tile of plan.tiles) await store.put(demTileKey(tile));

    const result = await queryViewportCoverage({ bounds: VIEW, zoom: mapZoom, store });
    expect(result.status).toBe('covered');
    expect(result.basis).toBe('view');
  });

  it('covers a two-step zoom-out, which is how a hunter finds the truck', async () => {
    const mapZoom = 14;
    const plan = planRegion(VIEW, demSourceZoom(mapZoom), DEM_MAX_ZOOM);
    const store = new SeededStore();
    for (const tile of plan.tiles) await store.put(demTileKey(tile));

    const zoomedOut = await queryViewportCoverage({ bounds: VIEW, zoom: mapZoom - 2, store });
    expect(zoomedOut.status).toBe('covered');
  });

  it('contains exactly the tiles the analysis fetch path derives for each level', () => {
    const plan = planZooms(VIEW, 13, 15);
    const planned = new Set(plan.tiles.map(tileId));
    for (let z = 13; z <= 15; z++) {
      for (const tile of demTilesForBounds(VIEW, z)) {
        expect(planned.has(tileId(tile))).toBe(true);
      }
    }
    // And nothing extra: paying for tiles nothing will ever ask for is a
    // download a hunter waits longer for with no benefit.
    let expected = 0;
    for (let z = 13; z <= 15; z++) expected += demTilesForBounds(VIEW, z).length;
    expect(plan.tileCount).toBe(expected);
  });
});

describe('display figures', () => {
  it('formats bytes at a scale a person can act on', () => {
    expect(formatBytes(1_400_000_000)).toBe('1.4 GB');
    expect(formatBytes(320_000_000)).toBe('320 MB');
    expect(formatBytes(8_200_000)).toBe('8 MB');
  });

  it('reports ground dimensions in miles, shrinking with latitude', () => {
    const equator = boundsSpanMiles({ west: 0, east: 1, south: 0, north: 1 });
    const north = boundsSpanMiles({ west: 0, east: 1, south: 60, north: 61 });
    expect(equator.width).toBeGreaterThan(north.width);
    // A degree of latitude is the same everywhere; only longitude converges.
    expect(equator.height).toBeCloseTo(north.height, 5);
  });
});
