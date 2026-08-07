import { beforeEach, describe, expect, it } from 'vitest';
import type { BBox } from '@hunt-maps/terrain';
import {
  invalidateCoverageCache,
  queryViewportCoverage,
  type CoverageResult,
} from './coverage';
import { demTileKey, demSourceZoom, demTilesForBounds } from '../map/demTiles';
import type { TileKey, TileStore, TileStoreStats } from './tileStore';

/**
 * A store whose contents the test controls exactly.
 *
 * Note what is *not* faked: the tile enumeration, the key derivation and the
 * verdict logic are all the real thing. The store is the only seam, because the
 * question these tests answer is "given a device with exactly these tiles, does
 * the app tell the truth about this view".
 */
class FakeStore implements TileStore {
  readonly backend: TileStoreStats['backend'];
  readonly keys = new Set<string>();
  failOn: string | null = null;
  /**
   * "Everything is stored", without materialising it. Seeding a continent-sized
   * view at z15 is millions of keys — which is the very thing the sampler exists
   * to avoid, so a test that has to build it first is testing the wrong shape.
   */
  everything = false;

  constructor(backend: TileStoreStats['backend'] = 'opfs') {
    this.backend = backend;
  }

  private id(k: TileKey): string {
    return `${k.layer}/${k.z}/${k.x}/${k.y}`;
  }
  async has(key: TileKey): Promise<boolean> {
    if (this.failOn && this.id(key) === this.failOn) throw new Error('quota exhausted');
    return this.everything || this.keys.has(this.id(key));
  }
  async get(): Promise<ArrayBuffer | null> {
    return null;
  }
  async put(): Promise<void> {}
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

  store(bounds: BBox, z: number, predicate: (i: number) => boolean = () => true): void {
    demTilesForBounds(bounds, z).forEach((t, i) => {
      if (predicate(i)) this.keys.add(this.id(demTileKey(t)));
    });
  }
}

/** One deep-zoom viewport over Hocking Hills: small, exact, ~20 tiles. */
const VIEW: BBox = { west: -82.58, south: 39.41, east: -82.5, north: 39.46 };
/** The map zoom that makes `demSourceZoom` land on DEM_MAX_ZOOM. */
const DEEP_ZOOM = 15;

beforeEach(() => {
  // The probe memo is module state and would otherwise leak between cases.
  invalidateCoverageCache();
});

async function query(store: TileStore, bounds = VIEW, zoom = DEEP_ZOOM): Promise<CoverageResult> {
  return queryViewportCoverage({ bounds, zoom, store });
}

describe('the three honest answers', () => {
  it('covered — every tile this view draws from is on the device', async () => {
    const store = new FakeStore();
    store.store(VIEW, demSourceZoom(DEEP_ZOOM));

    const r = await query(store);
    expect(r.status).toBe('covered');
    expect(r.basis).toBe('view');
    expect(r.sampled).toBe(false);
    expect(r.presentTiles).toBe(r.probedTiles);
    expect(r.probedTiles).toBe(r.neededTiles);
  });

  it('partial — some are, and it reports which ones for the overlay', async () => {
    const store = new FakeStore();
    store.store(VIEW, demSourceZoom(DEEP_ZOOM), (i) => i % 2 === 0);

    const r = await query(store);
    expect(r.status).toBe('partial');
    expect(r.fraction).toBeGreaterThan(0);
    expect(r.fraction).toBeLessThan(1);
    // The extent is what the hatch is drawn from; an empty one would leave the
    // user knowing they have a gap but not where.
    expect(r.coveredExtent.length).toBe(r.presentTiles);
  });

  it('empty — none are', async () => {
    const r = await query(new FakeStore());
    expect(r.status).toBe('empty');
    expect(r.presentTiles).toBe(0);
    expect(r.coveredExtent).toEqual([]);
  });

  it('one missing tile out of twenty is partial, not covered', async () => {
    // No rounding slack. That one tile is a blank square on the screen, and the
    // user is entitled to know which square.
    const store = new FakeStore();
    const tiles = demTilesForBounds(VIEW, demSourceZoom(DEEP_ZOOM));
    expect(tiles.length).toBeGreaterThan(4);
    store.store(VIEW, demSourceZoom(DEEP_ZOOM), (i) => i !== 0);

    const r = await query(store);
    expect(r.status).toBe('partial');
    expect(r.presentTiles).toBe(tiles.length - 1);
  });
});

describe('the regression that motivated all of this', () => {
  it('a store full of tiles for one place does not report a different place as covered', async () => {
    const store = new FakeStore();
    store.store(VIEW, demSourceZoom(DEEP_ZOOM)); // Ohio, downloaded

    // Roughly five hundred miles west — the pan that used to keep reading green.
    const faraway: BBox = { west: -92.58, south: 39.41, east: -92.5, north: 39.46 };
    const r = await query(store, faraway);

    expect(r.status).toBe('empty');
    expect(r.presentTiles).toBe(0);
  });

  it('coverage is per zoom: the same ground at a deeper zoom is a different answer', async () => {
    const store = new FakeStore();
    store.store(VIEW, demSourceZoom(11)); // only the coarse level is stored

    const coarse = await query(store, VIEW, 11);
    expect(coarse.status).toBe('partial'); // covered at z12, but the detail probe finds nothing
    expect(coarse.basis).toBe('detail');

    const deep = await query(store, VIEW, DEEP_ZOOM);
    expect(deep.status).toBe('empty');
  });
});

describe('the zoom-in warning', () => {
  it('flags a fully-covered coarse view whose detail tiles are missing', async () => {
    const store = new FakeStore();
    store.store(VIEW, demSourceZoom(11));

    const r = await query(store, VIEW, 11);
    expect(r.status).toBe('partial');
    expect(r.basis).toBe('detail');
    expect(r.viewZoom).toBe(demSourceZoom(11));
    expect(r.tileZoom).toBe(15);
    // The current zoom really is covered edge to edge, so there is no gap to
    // hatch — the text has to carry this one.
    expect(r.coveredExtent).toEqual([]);
  });

  it('does not run at max zoom, where there is no deeper set to need', async () => {
    const store = new FakeStore();
    store.store(VIEW, demSourceZoom(DEEP_ZOOM));

    const r = await query(store, VIEW, DEEP_ZOOM);
    expect(r.status).toBe('covered');
    expect(r.basis).toBe('view');
  });
});

describe('sampling honesty', () => {
  it('marks a viewport too large to enumerate as sampled', async () => {
    const store = new FakeStore();
    store.everything = true;
    const huge: BBox = { west: -95, south: 30, east: -75, north: 45 };

    const r = await queryViewportCoverage({ bounds: huge, zoom: DEEP_ZOOM, store });
    expect(r.sampled).toBe(true);
    expect(r.probedTiles).toBeLessThan(r.neededTiles);
    // A sampled measurement knows a scatter of tiles, not an extent. Drawing
    // that scatter as though it were the extent is a picture that lies.
    expect(r.coveredExtent).toEqual([]);
  });
});

describe('failure is surfaced, not swallowed', () => {
  it('propagates a store error instead of reporting 0% covered', async () => {
    // "We could not read your storage" and "your storage is empty" call for
    // different actions from the user, and only one of them means "go
    // download this again".
    const store = new FakeStore();
    store.store(VIEW, demSourceZoom(DEEP_ZOOM));
    const first = demTilesForBounds(VIEW, demSourceZoom(DEEP_ZOOM))[0];
    store.failOn = `dem/${first.z}/${first.x}/${first.y}`;

    await expect(query(store)).rejects.toThrow();
  });

  it('reports the in-memory fallback as volatile even when it is full', async () => {
    const store = new FakeStore('memory');
    store.store(VIEW, demSourceZoom(DEEP_ZOOM));

    const r = await query(store);
    expect(r.status).toBe('covered');
    expect(r.volatile).toBe(true); // covered *for this session only*
  });
});

describe('probe memoisation', () => {
  it('does not keep reporting the pre-download answer after invalidation', async () => {
    const store = new FakeStore();
    expect((await query(store)).status).toBe('empty');

    store.store(VIEW, demSourceZoom(DEEP_ZOOM)); // a download lands
    invalidateCoverageCache();

    expect((await query(store)).status).toBe('covered');
  });
});
