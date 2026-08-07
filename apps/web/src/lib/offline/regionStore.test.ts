import { beforeEach, describe, expect, it } from 'vitest';
import type { BBox } from '@hunt-maps/terrain';
import {
  __setRegionStore,
  newClientId,
  openRegionStore,
  reviseRegion,
  type SavedRegion,
} from './regionStore';

const BOUNDS: BBox = { west: -82.6, south: 39.39, east: -82.48, north: 39.47 };

function region(overrides: Partial<SavedRegion> = {}): SavedRegion {
  return {
    clientId: newClientId(),
    syncState: 'local',
    version: 1,
    name: 'Test ridge',
    bounds: BOUNDS,
    minZoom: 12,
    maxZoom: 15,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'ready',
    tileTotal: 100,
    tileDone: 100,
    tileFailed: 0,
    bytes: 10_000_000,
    volatile: false,
    ...overrides,
  };
}

beforeEach(() => {
  __setRegionStore(null);
  globalThis.localStorage?.clear();
});

describe('region records', () => {
  it('round-trips through the device store', async () => {
    const store = openRegionStore();
    const r = region();
    await store.put(r);
    expect(await store.get(r.clientId)).toEqual(r);
    expect(await store.list()).toHaveLength(1);
  });

  it('survives a fresh open, because the list is read offline hours later', async () => {
    const r = region();
    await openRegionStore().put(r);
    __setRegionStore(null); // simulate a reload
    expect(await openRegionStore().get(r.clientId)).toEqual(r);
  });

  it('updates in place rather than accumulating duplicates', async () => {
    const store = openRegionStore();
    const r = region();
    await store.put(r);
    await store.put(reviseRegion(r, { status: 'partial' }));
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('partial');
  });

  it('lists newest first, which is the order a hunter looks for', async () => {
    const store = openRegionStore();
    await store.put(region({ name: 'old', createdAt: 1_000 }));
    await store.put(region({ name: 'new', createdAt: 2_000 }));
    expect((await store.list()).map((r) => r.name)).toEqual(['new', 'old']);
  });

  it('removes only the region asked for', async () => {
    const store = openRegionStore();
    const keep = region({ name: 'keep' });
    const drop = region({ name: 'drop' });
    await store.put(keep);
    await store.put(drop);
    await store.remove(drop.clientId);
    expect((await store.list()).map((r) => r.name)).toEqual(['keep']);
  });

  it('drops a corrupt record without losing the rest of the list', async () => {
    // Losing every saved region because one record went bad would be exactly
    // the "silently lose user data" failure this file exists to prevent.
    const good = region({ name: 'good' });
    globalThis.localStorage.setItem(
      'ridgeline.offline.regions.v1',
      JSON.stringify([{ nonsense: true }, good]),
    );
    __setRegionStore(null);
    expect((await openRegionStore().list()).map((r) => r.name)).toEqual(['good']);
  });

  it('returns an empty list rather than throwing on unparseable storage', async () => {
    globalThis.localStorage.setItem('ridgeline.offline.regions.v1', 'not json');
    __setRegionStore(null);
    await expect(openRegionStore().list()).resolves.toEqual([]);
  });
});

describe('identity and versioning', () => {
  it('mints a distinct id per region, before any server has seen it', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newClientId()));
    expect(ids.size).toBe(200);
  });

  it('bumps the version on every edit, so a conflict is detectable', () => {
    // Last-write-wins is banned: a hunting party edits the same saved areas
    // from several devices, one of them offline at camp.
    const r = region();
    const once = reviseRegion(r, { status: 'paused' });
    const twice = reviseRegion(once, { status: 'ready' });
    expect(once.version).toBe(r.version + 1);
    expect(twice.version).toBe(r.version + 2);
    expect(r.status).toBe('ready'); // the original was not mutated
  });

  it('keeps the client id stable across edits, so replay is idempotent', () => {
    const r = region();
    expect(reviseRegion(r, { name: 'renamed' }).clientId).toBe(r.clientId);
  });
});
