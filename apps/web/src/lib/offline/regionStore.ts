/**
 * The record of what a user saved, kept on the device that holds the tiles.
 *
 * ## Local-first, not server-first
 *
 * The tiles live on this device. The list of regions therefore has to live on
 * this device too, or the "what have I actually got saved?" screen goes blank
 * the moment you lose signal — which is the moment you most want to read it.
 * The API's `/offline/regions` is a convenience for seeing your regions from
 * another device; it is never the source of truth for this one.
 *
 * ## Identity and versioning
 *
 * Every record carries a `clientId` minted before the server has ever heard of
 * it, and a `version` that increments on every local edit. That is not
 * ceremony: a region created at camp with no signal must have a stable identity
 * so a later sync is idempotent rather than creating a duplicate every time the
 * tab reloads, and `version` is what makes a real conflict detectable instead
 * of resolved by whichever write landed last.
 *
 * **Known gap, deliberately not worked around:** `POST /offline/regions` has no
 * `clientId` field and the API runs `forbidNonWhitelisted`, so sending one is a
 * 400. Until the API takes it, `serverId` is written only on a confirmed create
 * and `syncState` guards against a blind retry. Recorded in the report rather
 * than hidden behind a retry loop that would quietly duplicate rows.
 *
 * ## Why `localStorage` and not IndexedDB
 *
 * A few hundred bytes per region, read on panel open, written a handful of
 * times per download. IndexedDB's async ceremony buys nothing at that size, and
 * the expensive, genuinely-must-not-be-lost data — the tiles — is in OPFS
 * already. The interface is async anyway so the backend can change without
 * touching a caller. A memory fallback exists for private-browsing modes that
 * throw on `localStorage` access, and it reports itself as volatile so the UI
 * can say the list will not survive a reload.
 */

import type { BBox } from '@hunt-maps/terrain';

export type RegionStatus =
  /** Tiles are being fetched right now. */
  | 'downloading'
  /** Stopped by the user or by the tab going away. Resumable. */
  | 'paused'
  /** Every planned tile is on the device. */
  | 'ready'
  /** Finished, but some tiles could not be fetched. Named, not hidden. */
  | 'partial'
  /** Stopped by an error the user has to act on — out of space, mostly. */
  | 'failed';

export interface SavedRegion {
  /** Stable identity minted on this device, before any server has seen it. */
  clientId: string;
  /** Set only once the API has confirmed a create. */
  serverId?: string;
  syncState: 'local' | 'synced' | 'sync-failed';
  /** Bumped on every local edit, so a conflict is detectable. */
  version: number;
  name: string;
  bounds: BBox;
  minZoom: number;
  maxZoom: number;
  createdAt: number;
  updatedAt: number;
  status: RegionStatus;
  /** Tiles in the plan. */
  tileTotal: number;
  /** Tiles confirmed present in the tile store. */
  tileDone: number;
  /** Tiles that were tried and failed. `tileDone + tileFailed <= tileTotal`. */
  tileFailed: number;
  /** Bytes actually written, summed as they were stored. Not an estimate. */
  bytes: number;
  /** Set for `failed`; shown to the user verbatim. */
  error?: string;
  /**
   * The tile store was in-memory when this was written, so the region is gone
   * on reload. Recorded on the region rather than inferred later, because by
   * the time anyone reads the list the store may have been re-opened onto a
   * different backend and the truth about *this* download would be lost.
   */
  volatile: boolean;
}

const KEY = 'ridgeline.offline.regions.v1';

export interface RegionRecordStore {
  readonly volatile: boolean;
  list(): Promise<SavedRegion[]>;
  get(clientId: string): Promise<SavedRegion | null>;
  put(region: SavedRegion): Promise<void>;
  remove(clientId: string): Promise<void>;
}

/** Minimal `Storage` surface, so a test can hand in a plain object. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

class WebStorageRegionStore implements RegionRecordStore {
  constructor(
    private readonly storage: StorageLike,
    readonly volatile: boolean,
  ) {}

  private read(): SavedRegion[] {
    try {
      const raw = this.storage.getItem(KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // A malformed record is dropped rather than crashing the panel, but the
      // shape check is narrow: losing a region silently is exactly what this
      // file exists to prevent, so anything with an id and bounds is kept.
      return parsed.filter(
        (r): r is SavedRegion =>
          !!r && typeof (r as SavedRegion).clientId === 'string' && !!(r as SavedRegion).bounds,
      );
    } catch {
      return [];
    }
  }

  private write(regions: SavedRegion[]): void {
    this.storage.setItem(KEY, JSON.stringify(regions));
  }

  async list(): Promise<SavedRegion[]> {
    return this.read().sort((a, b) => b.createdAt - a.createdAt);
  }

  async get(clientId: string): Promise<SavedRegion | null> {
    return this.read().find((r) => r.clientId === clientId) ?? null;
  }

  async put(region: SavedRegion): Promise<void> {
    const all = this.read();
    const i = all.findIndex((r) => r.clientId === region.clientId);
    if (i >= 0) all[i] = region;
    else all.push(region);
    this.write(all);
  }

  async remove(clientId: string): Promise<void> {
    this.write(this.read().filter((r) => r.clientId !== clientId));
  }
}

/** In-memory `Storage`, for private-browsing modes that refuse the real one. */
function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

let cached: RegionRecordStore | null = null;

export function openRegionStore(): RegionRecordStore {
  if (cached) return cached;
  try {
    // Probe with a real write. Safari in private mode exposes `localStorage`
    // and throws on `setItem`, so a truthiness check is not enough.
    const probe = '__ridgeline_probe__';
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    cached = new WebStorageRegionStore(globalThis.localStorage, false);
  } catch {
    cached = new WebStorageRegionStore(memoryStorage(), true);
  }
  return cached;
}

/** Test seam. */
export function __setRegionStore(store: RegionRecordStore | null): void {
  cached = store;
}

/**
 * A fresh identity for a region created on this device.
 *
 * `crypto.randomUUID` when available; a time-plus-entropy fallback otherwise,
 * because an id that fails to mint is a region that cannot be tracked at all.
 */
export function newClientId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Apply an edit, bumping `version` and `updatedAt`. Never mutates in place. */
export function reviseRegion(region: SavedRegion, patch: Partial<SavedRegion>): SavedRegion {
  return { ...region, ...patch, version: region.version + 1, updatedAt: Date.now() };
}
