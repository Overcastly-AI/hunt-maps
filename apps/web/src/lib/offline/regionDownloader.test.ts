import { describe, expect, it, vi } from 'vitest';
import type { TileCoord } from '@hunt-maps/terrain';
import { isQuotaError, runDownload, type DownloadProgress } from './regionDownloader';
import { demTileKey } from '../map/demTiles';
import type { TileKey, TileStore, TileStoreStats } from './tileStore';

function tiles(n: number, z = 14): TileCoord[] {
  return Array.from({ length: n }, (_, i) => ({ z, x: 1000 + i, y: 2000 }));
}

class MemStore implements TileStore {
  readonly backend = 'opfs' as const;
  readonly data = new Map<string, ArrayBuffer>();
  /** Start failing writes with a quota error after this many successes. */
  quotaAfter = Infinity;

  private id(k: TileKey): string {
    return `${k.layer}/${k.z}/${k.x}/${k.y}`;
  }
  async has(key: TileKey): Promise<boolean> {
    return this.data.has(this.id(key));
  }
  async get(key: TileKey): Promise<ArrayBuffer | null> {
    return this.data.get(this.id(key)) ?? null;
  }
  async put(key: TileKey, value: ArrayBuffer): Promise<void> {
    if (this.data.size >= this.quotaAfter) {
      const err = new Error('The quota has been exceeded.');
      err.name = 'QuotaExceededError';
      throw err;
    }
    this.data.set(this.id(key), value);
  }
  async delete(key: TileKey): Promise<boolean> {
    return this.data.delete(this.id(key));
  }
  async deleteRegion(): Promise<number> {
    return 0;
  }
  async stats(): Promise<TileStoreStats> {
    return { backend: this.backend, tileCount: this.data.size, bytes: 0 };
  }
  async clear(): Promise<void> {
    this.data.clear();
  }
}

const bytes = (n = 64): ArrayBuffer => new ArrayBuffer(n);
const noSleep = async (): Promise<void> => undefined;

async function download(
  opts: Partial<Parameters<typeof runDownload>[0]> & { tiles: TileCoord[]; store: TileStore },
) {
  const progress: DownloadProgress[] = [];
  const result = await runDownload({
    fetchTile: async () => bytes(),
    onProgress: (p) => progress.push(p),
    signal: new AbortController().signal,
    sleepImpl: noSleep,
    ...opts,
  });
  return { result, progress };
}

describe('a clean run', () => {
  it('fetches every tile and reports done', async () => {
    const store = new MemStore();
    const { result } = await download({ tiles: tiles(20), store });
    expect(result.phase).toBe('done');
    expect(result.stored).toBe(20);
    expect(result.fetched).toBe(20);
    expect(result.failed).toBe(0);
    expect(store.data.size).toBe(20);
  });

  it('writes under the same key the analysis fetch path reads', async () => {
    // If these ever diverged, a download would "succeed" into keys nothing
    // reads, and the coverage badge — which probes by this key — would report
    // an empty region for a completed download.
    const store = new MemStore();
    const plan = tiles(3);
    await download({ tiles: plan, store });
    for (const tile of plan) {
      expect(await store.has(demTileKey(tile))).toBe(true);
    }
  });
});

describe('resume', () => {
  it('does not refetch what is already on the device', async () => {
    const store = new MemStore();
    const plan = tiles(30);
    // A previous run got two thirds of the way and then the battery died.
    for (const tile of plan.slice(0, 20)) await store.put(demTileKey(tile), bytes());

    const fetchTile = vi.fn(async () => bytes());
    const { result } = await download({ tiles: plan, store, fetchTile });

    expect(fetchTile).toHaveBeenCalledTimes(10);
    expect(result.stored).toBe(30);
    // `fetched` is this run only, so the UI can say what resuming saved you.
    expect(result.fetched).toBe(10);
    expect(result.phase).toBe('done');
  });

  it('repairs a region the browser partially evicted, which a cursor would skip', async () => {
    // The reason resume re-probes every tile instead of trusting a bookmark: a
    // run that "completed" and was then evicted in the middle looks identical
    // from the outside to one that was interrupted at the end.
    const store = new MemStore();
    const plan = tiles(12);
    for (const tile of plan) await store.put(demTileKey(tile), bytes());
    for (const tile of plan.slice(4, 8)) await store.delete(demTileKey(tile));

    const fetchTile = vi.fn(async () => bytes());
    const { result } = await download({ tiles: plan, store, fetchTile });
    expect(fetchTile).toHaveBeenCalledTimes(4);
    expect(result.stored).toBe(12);
  });
});

describe('cancel', () => {
  it('stops promptly, keeps everything already written, and reports paused', async () => {
    const store = new MemStore();
    const controller = new AbortController();
    let fetched = 0;

    const result = await runDownload({
      tiles: tiles(500),
      store,
      signal: controller.signal,
      sleepImpl: noSleep,
      fetchTile: async () => {
        fetched++;
        if (fetched === 10) controller.abort();
        return bytes();
      },
      onProgress: () => undefined,
    });

    expect(result.phase).toBe('paused');
    // A cancel that threw away progress would be worse than offering no
    // cancel at all — resuming has to be cheaper than restarting.
    expect(store.data.size).toBeGreaterThan(0);
    expect(store.data.size).toBeLessThan(500);
  });

  it('an already-aborted signal writes nothing at all', async () => {
    const store = new MemStore();
    const controller = new AbortController();
    controller.abort();
    const result = await runDownload({
      tiles: tiles(50),
      store,
      signal: controller.signal,
      sleepImpl: noSleep,
      fetchTile: async () => bytes(),
      onProgress: () => undefined,
    });
    expect(result.phase).toBe('paused');
    expect(store.data.size).toBe(0);
  });
});

describe('running out of space', () => {
  it('stops the whole run at the first quota error and says so', async () => {
    const store = new MemStore();
    store.quotaAfter = 25;
    const fetchTile = vi.fn(async () => bytes());

    const { result } = await download({ tiles: tiles(4_000), store, fetchTile });

    expect(result.phase).toBe('failed');
    expect(result.error).toMatch(/ran out of storage/);
    // The point of stopping early: not four thousand identical failures on the
    // way to the same conclusion an hour later.
    expect(fetchTile.mock.calls.length).toBeLessThan(200);
    expect(store.data.size).toBe(25);
  });

  it('recognises the shapes browsers actually throw', () => {
    const named = new Error('nope');
    named.name = 'QuotaExceededError';
    expect(isQuotaError(named)).toBe(true);
    expect(isQuotaError({ code: 22 })).toBe(true);
    expect(isQuotaError(new Error('device is out of space'))).toBe(true);
    expect(isQuotaError(new Error('404 not found'))).toBe(false);
  });
});

describe('flaky connections', () => {
  it('retries a failing tile before giving up on it', async () => {
    const store = new MemStore();
    let attempts = 0;
    const { result } = await download({
      tiles: tiles(1),
      store,
      fetchTile: async () => {
        attempts++;
        if (attempts < 3) throw new Error('network reset');
        return bytes();
      },
    });
    expect(attempts).toBe(3);
    expect(result.phase).toBe('done');
    expect(result.failed).toBe(0);
  });

  it('names the tiles it could not get rather than reporting a clean finish', async () => {
    const store = new MemStore();
    const { result } = await download({
      tiles: tiles(5),
      store,
      fetchTile: async (tile) => {
        if (tile.x % 2 === 0) throw new Error('404');
        return bytes();
      },
    });
    // "Partial", with a count — not "done". Ground that will be blank at 04:30
    // has to be visible before the user leaves the house.
    expect(result.failed).toBe(3);
    expect(result.failedTiles).toHaveLength(3);
    expect(result.stored).toBe(2);
  });
});

describe('progress reporting', () => {
  it('reports a checking phase before a downloading one', async () => {
    const store = new MemStore();
    const { progress } = await download({ tiles: tiles(40), store });
    const phases = progress.map((p) => p.phase);
    expect(phases[0]).toBe('checking');
    expect(phases).toContain('downloading');
    expect(phases[phases.length - 1]).toBe('done');
  });

  it('never reports more stored than planned', async () => {
    const store = new MemStore();
    const { progress } = await download({ tiles: tiles(60), store });
    for (const p of progress) expect(p.stored).toBeLessThanOrEqual(p.total);
  });
});
