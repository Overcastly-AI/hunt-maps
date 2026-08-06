/**
 * Offline tile storage.
 *
 * ## Why OPFS with an IndexedDB fallback
 *
 * A hunting property at z10–15 with a handful of layers is tens of thousands of
 * tiles and hundreds of megabytes. Two things follow:
 *
 *  - **IndexedDB is the wrong primary store at that size.** Writing a hundred
 *    thousand small Blob records is slow, and the structured-clone round trip
 *    on read shows up as visible tile pop-in while panning. The Origin Private
 *    File System gives near-native file reads with no clone step, which is what
 *    makes a fully-offline map feel the same as an online one.
 *  - **The fallback still has to exist.** OPFS is unavailable in some browser
 *    and privacy configurations, and "no offline maps for you" is not an
 *    acceptable answer for the one feature the user is relying on when they are
 *    a mile from the truck with no bars.
 *
 * So: OPFS when available, IndexedDB when not, one interface either way, and
 * the app never has to care which it got.
 */

export interface TileKey {
  layer: string;
  z: number;
  x: number;
  y: number;
}

export interface StoredTile {
  data: ArrayBuffer;
  storedAt: number;
}

export interface TileStoreStats {
  backend: 'opfs' | 'indexeddb' | 'memory';
  tileCount: number;
  bytes: number;
  /** Browser-reported storage quota, when available. */
  quotaBytes?: number;
  usageBytes?: number;
}

export interface TileStore {
  readonly backend: TileStoreStats['backend'];
  get(key: TileKey): Promise<ArrayBuffer | null>;
  put(key: TileKey, data: ArrayBuffer): Promise<void>;
  has(key: TileKey): Promise<boolean>;
  deleteRegion(layer: string): Promise<number>;
  stats(): Promise<TileStoreStats>;
  clear(): Promise<void>;
}

const DB_NAME = 'ridgeline-tiles';
const DB_VERSION = 1;
const STORE = 'tiles';

function keyString(k: TileKey): string {
  return `${k.layer}/${k.z}/${k.x}/${k.y}`;
}

// ---------------------------------------------------------------------------
// OPFS
// ---------------------------------------------------------------------------

class OpfsTileStore implements TileStore {
  readonly backend = 'opfs' as const;

  constructor(private readonly root: FileSystemDirectoryHandle) {}

  static async create(): Promise<OpfsTileStore | null> {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('tiles', { create: true });
      return new OpfsTileStore(dir);
    } catch {
      return null;
    }
  }

  /**
   * Directory layout is `tiles/<layer>/<z>/<x>_<y>.bin`.
   *
   * Flattening x and y into one filename rather than nesting a directory per x
   * matters: a z15 region can have thousands of distinct x values, and one
   * directory handle per column turns every tile read into several async
   * lookups. Two levels of nesting keeps directories small without paying that.
   */
  private async dirFor(key: TileKey, create: boolean): Promise<FileSystemDirectoryHandle | null> {
    try {
      const layer = await this.root.getDirectoryHandle(key.layer, { create });
      return await layer.getDirectoryHandle(String(key.z), { create });
    } catch {
      return null;
    }
  }

  async get(key: TileKey): Promise<ArrayBuffer | null> {
    const dir = await this.dirFor(key, false);
    if (!dir) return null;
    try {
      const handle = await dir.getFileHandle(`${key.x}_${key.y}.bin`);
      const file = await handle.getFile();
      return await file.arrayBuffer();
    } catch {
      return null;
    }
  }

  async put(key: TileKey, data: ArrayBuffer): Promise<void> {
    const dir = await this.dirFor(key, true);
    if (!dir) throw new Error('Could not open offline tile directory.');
    const handle = await dir.getFileHandle(`${key.x}_${key.y}.bin`, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(data);
    } finally {
      await writable.close();
    }
  }

  async has(key: TileKey): Promise<boolean> {
    const dir = await this.dirFor(key, false);
    if (!dir) return false;
    try {
      await dir.getFileHandle(`${key.x}_${key.y}.bin`);
      return true;
    } catch {
      return false;
    }
  }

  async deleteRegion(layer: string): Promise<number> {
    try {
      await this.root.removeEntry(layer, { recursive: true });
      return 1;
    } catch {
      return 0;
    }
  }

  async stats(): Promise<TileStoreStats> {
    let tileCount = 0;
    let bytes = 0;
    // Walk the tree. Only ever called from the storage-management screen, never
    // on a hot path.
    for await (const [, layerHandle] of entriesOf(this.root)) {
      if (layerHandle.kind !== 'directory') continue;
      for await (const [, zHandle] of entriesOf(layerHandle as FileSystemDirectoryHandle)) {
        if (zHandle.kind !== 'directory') continue;
        for await (const [, fileHandle] of entriesOf(zHandle as FileSystemDirectoryHandle)) {
          if (fileHandle.kind !== 'file') continue;
          tileCount++;
          bytes += (await (fileHandle as FileSystemFileHandle).getFile()).size;
        }
      }
    }
    return { backend: this.backend, tileCount, bytes, ...(await quota()) };
  }

  async clear(): Promise<void> {
    for await (const [name] of entriesOf(this.root)) {
      await this.root.removeEntry(name, { recursive: true }).catch(() => undefined);
    }
  }
}

/** `FileSystemDirectoryHandle.entries()` is not in every lib.dom yet. */
async function* entriesOf(
  dir: FileSystemDirectoryHandle,
): AsyncGenerator<[string, FileSystemHandle]> {
  const iterable = (dir as unknown as {
    entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
  }).entries;
  if (!iterable) return;
  yield* iterable.call(dir);
}

// ---------------------------------------------------------------------------
// IndexedDB fallback
// ---------------------------------------------------------------------------

class IdbTileStore implements TileStore {
  readonly backend = 'indexeddb' as const;

  constructor(private readonly db: IDBDatabase) {}

  static async create(): Promise<IdbTileStore | null> {
    if (typeof indexedDB === 'undefined') return null;
    return new Promise((resolve) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'key' });
          store.createIndex('layer', 'layer', { unique: false });
        }
      };
      req.onsuccess = () => resolve(new IdbTileStore(req.result));
      req.onerror = () => resolve(null);
    });
  }

  private tx(mode: IDBTransactionMode): IDBObjectStore {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  get(key: TileKey): Promise<ArrayBuffer | null> {
    return new Promise((resolve) => {
      const req = this.tx('readonly').get(keyString(key));
      req.onsuccess = () => resolve(req.result?.data ?? null);
      req.onerror = () => resolve(null);
    });
  }

  put(key: TileKey, data: ArrayBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = this.tx('readwrite').put({
        key: keyString(key),
        layer: key.layer,
        data,
        storedAt: Date.now(),
      });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async has(key: TileKey): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  deleteRegion(layer: string): Promise<number> {
    return new Promise((resolve) => {
      const store = this.tx('readwrite');
      const index = store.index('layer');
      const req = index.openCursor(IDBKeyRange.only(layer));
      let deleted = 0;
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(deleted);
          return;
        }
        cursor.delete();
        deleted++;
        cursor.continue();
      };
      req.onerror = () => resolve(deleted);
    });
  }

  async stats(): Promise<TileStoreStats> {
    const counted = await new Promise<{ tileCount: number; bytes: number }>((resolve) => {
      const req = this.tx('readonly').openCursor();
      let tileCount = 0;
      let bytes = 0;
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve({ tileCount, bytes });
          return;
        }
        tileCount++;
        bytes += (cursor.value.data as ArrayBuffer).byteLength;
        cursor.continue();
      };
      req.onerror = () => resolve({ tileCount, bytes });
    });
    return { backend: this.backend, ...counted, ...(await quota()) };
  }

  clear(): Promise<void> {
    return new Promise((resolve) => {
      const req = this.tx('readwrite').clear();
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  }
}

/**
 * Last-resort in-memory store.
 *
 * Used when both persistent backends are unavailable (private browsing with
 * storage disabled, mostly). The map still works for the current session; the
 * UI is responsible for telling the user their region will not survive a
 * reload, because silently losing a download they waited twenty minutes for is
 * a betrayal.
 */
class MemoryTileStore implements TileStore {
  readonly backend = 'memory' as const;
  private readonly map = new Map<string, ArrayBuffer>();

  async get(key: TileKey): Promise<ArrayBuffer | null> {
    return this.map.get(keyString(key)) ?? null;
  }
  async put(key: TileKey, data: ArrayBuffer): Promise<void> {
    this.map.set(keyString(key), data);
  }
  async has(key: TileKey): Promise<boolean> {
    return this.map.has(keyString(key));
  }
  async deleteRegion(layer: string): Promise<number> {
    let n = 0;
    for (const k of [...this.map.keys()]) {
      if (k.startsWith(`${layer}/`)) {
        this.map.delete(k);
        n++;
      }
    }
    return n;
  }
  async stats(): Promise<TileStoreStats> {
    let bytes = 0;
    for (const v of this.map.values()) bytes += v.byteLength;
    return { backend: this.backend, tileCount: this.map.size, bytes };
  }
  async clear(): Promise<void> {
    this.map.clear();
  }
}

async function quota(): Promise<{ quotaBytes?: number; usageBytes?: number }> {
  try {
    const est = await navigator.storage?.estimate?.();
    return { quotaBytes: est?.quota, usageBytes: est?.usage };
  } catch {
    return {};
  }
}

let cached: Promise<TileStore> | null = null;

export function openTileStore(): Promise<TileStore> {
  cached ??= (async (): Promise<TileStore> => {
    return (
      (await OpfsTileStore.create()) ?? (await IdbTileStore.create()) ?? new MemoryTileStore()
    );
  })();
  return cached;
}

/** Test seam — lets a suite inject a store without touching browser storage. */
export function __setTileStore(store: TileStore): void {
  cached = Promise.resolve(store);
}

/**
 * Ask the browser to make storage persistent.
 *
 * Without this, a large tile cache is eligible for eviction under storage
 * pressure — and the browser will not warn first. Losing an offline region
 * silently, discovered only when the map is blank in the field, is the single
 * worst failure this app can have, so we request persistence and report the
 * answer honestly rather than assuming it was granted.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
