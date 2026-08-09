/**
 * Fetching a region's elevation tiles onto the device.
 *
 * Field conditions this is built against, all of which happen:
 *
 *  - **Started on hotel wifi, finished on cellular.** The connection changes
 *    under the download. Individual tiles fail and are retried with backoff;
 *    the run does not.
 *  - **Backgrounded.** The tab is throttled to a crawl or discarded outright.
 *    Progress is written to the region record as it goes, so what survives is
 *    the truth rather than an optimistic number from before the freeze.
 *  - **Interrupted by a flat battery.** Nothing gets a chance to clean up. So
 *    resume never trusts a bookmark: it re-checks the store for every planned
 *    tile and fetches what is genuinely absent. That is slower to start and it
 *    is correct no matter how the previous run died — including if the browser
 *    evicted half the region in between, which a cursor-based resume would
 *    happily skip past and report as complete.
 *  - **Cancelled.** Aborts within a tile, keeps everything already written, and
 *    leaves the region resumable. A cancel that threw away 4 GB of progress
 *    would be a worse failure than never offering cancel.
 *  - **Out of space.** Stops immediately and says so, rather than grinding
 *    through 40 000 more failures to arrive at the same place an hour later.
 *
 * The tile order comes from `planRegion` — coarsest zoom first — so a run that
 * dies early leaves a usable overview of the whole region rather than one
 * perfect corner.
 */

import type { TileCoord } from '@hunt-maps/terrain';
import { demTileKey } from '../map/demTiles';
import type { TileStore } from './tileStore';

export type DownloadPhase = 'checking' | 'downloading' | 'paused' | 'done' | 'failed';

export interface DownloadProgress {
  phase: DownloadPhase;
  /** Tiles in the plan. */
  total: number;
  /** Tiles confirmed on the device — skipped-because-present plus newly written. */
  stored: number;
  /** Written during *this* run. `stored - fetched` is what resume saved you. */
  fetched: number;
  /** Tiles that were attempted and could not be stored. */
  failed: number;
  /** Bytes written this run. */
  bytes: number;
  /** Set when `phase` is `failed`. Shown to the user verbatim. */
  error?: string;
}

export interface DownloadOptions {
  tiles: TileCoord[];
  store: TileStore;
  /** Fetch one tile's bytes. Rejects on any non-success. */
  fetchTile: (tile: TileCoord, signal: AbortSignal) => Promise<ArrayBuffer>;
  onProgress: (progress: DownloadProgress) => void;
  signal: AbortSignal;
  /**
   * Parallel fetches.
   *
   * Six, not sixty. Browsers cap per-host connections around six anyway, and
   * queueing thousands of requests behind that cap makes cancel feel dead and
   * starves the map's own tile requests while the user is still panning around
   * looking at the region they are downloading.
   */
  concurrency?: number;
  /** Attempts per tile, including the first. */
  attempts?: number;
  /** Injected by tests so backoff does not make the suite slow. */
  sleepImpl?: (ms: number) => Promise<void>;
}

const DEFAULT_CONCURRENCY = 6;
const DEFAULT_ATTEMPTS = 3;

/** Progress is reported at most this often, so 100k tiles is not 100k renders. */
const PROGRESS_INTERVAL_MS = 200;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Is this the browser telling us the disk is full?
 *
 * Checked by name first (the spec'd `QuotaExceededError`, plus Firefox's
 * numeric legacy code 22) and by message as a fallback, because OPFS write
 * failures surface with varying shapes across engines. A false positive costs
 * an early stop with an honest message; a false negative costs an hour of
 * failing writes, so the check errs toward stopping.
 */
export function isQuotaError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; code?: number; message?: string };
  if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_FILE_NO_DEVICE_SPACE') return true;
  if (e.code === 22) return true;
  // Engines phrase this every way there is: "The quota has been exceeded.",
  // "There is not enough space", "device is out of space", "disk full". Match
  // the family rather than one vendor's sentence.
  return /quota|(no|not enough|out of) space|storage full|disk full/i.test(
    String(e.message ?? ''),
  );
}

export interface DownloadResult extends DownloadProgress {
  /** Tiles that were attempted and failed, for a targeted retry. */
  failedTiles: TileCoord[];
}

export async function runDownload(options: DownloadOptions): Promise<DownloadResult> {
  const {
    tiles,
    store,
    fetchTile,
    onProgress,
    signal,
    concurrency = DEFAULT_CONCURRENCY,
    attempts = DEFAULT_ATTEMPTS,
    sleepImpl = defaultSleep,
  } = options;

  const state: DownloadProgress = {
    phase: 'checking',
    total: tiles.length,
    stored: 0,
    fetched: 0,
    failed: 0,
    bytes: 0,
  };
  const failedTiles: TileCoord[] = [];

  let lastEmit = 0;
  const emit = (force = false): void => {
    const now = Date.now();
    if (!force && now - lastEmit < PROGRESS_INTERVAL_MS) return;
    lastEmit = now;
    onProgress({ ...state });
  };
  emit(true);

  // --- Phase 1: what is already here? -------------------------------------
  //
  // Every planned tile is probed, not just the ones a previous run claimed to
  // have missed. This is the resume path and it is deliberately paranoid: a
  // download killed by a flat battery, or a region the browser partially
  // evicted, both look identical from the outside and both must be repaired.
  const missing: TileCoord[] = [];
  await pool(tiles, concurrency, signal, async (tile) => {
    if (await store.has(demTileKey(tile)).catch(() => false)) {
      state.stored++;
    } else {
      missing.push(tile);
    }
    emit();
  });

  if (signal.aborted) {
    state.phase = 'paused';
    emit(true);
    return { ...state, failedTiles };
  }

  // --- Phase 2: fetch what is not ------------------------------------------
  state.phase = 'downloading';
  emit(true);

  let quotaError: string | null = null;

  await pool(missing, concurrency, signal, async (tile) => {
    if (quotaError) return;

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (signal.aborted || quotaError) return;
      try {
        const bytes = await fetchTile(tile, signal);
        await store.put(demTileKey(tile), bytes);
        state.stored++;
        state.fetched++;
        state.bytes += bytes.byteLength;
        emit();
        return;
      } catch (err) {
        if (signal.aborted) return;
        if (isQuotaError(err)) {
          // Stop the whole run. Every subsequent write would fail the same way,
          // and forty thousand identical failures is not a better user
          // experience than one honest sentence.
          quotaError =
            'This device ran out of storage part-way through. ' +
            'The tiles saved so far are kept — free some space, or pick a smaller area, and resume.';
          return;
        }
        const last = attempt === attempts - 1;
        if (last) {
          state.failed++;
          failedTiles.push(tile);
          emit();
          return;
        }
        // Exponential backoff. A cellular handover drops a burst of requests at
        // once; retrying all of them immediately just drops them all again.
        await sleepImpl(250 * 2 ** attempt);
      }
    }
  });

  if (quotaError) {
    state.phase = 'failed';
    state.error = quotaError;
  } else if (signal.aborted) {
    state.phase = 'paused';
  } else {
    state.phase = 'done';
  }
  emit(true);
  return { ...state, failedTiles };
}

/**
 * Run `work` over `items` with at most `limit` in flight.
 *
 * A shared cursor rather than chunking: chunks make the whole batch wait for
 * its slowest member, which on a flaky connection is a tile that is about to
 * time out. Aborts leave the remaining items untouched, which is what makes the
 * run resumable rather than restartable.
 */
async function pool<T>(
  items: T[],
  limit: number,
  signal: AbortSignal,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      if (signal.aborted) return;
      const index = cursor++;
      if (index >= items.length) return;
      await work(items[index]);
    }
  });
  await Promise.all(workers);
}

/**
 * Fetch one DEM tile over HTTP, as bytes.
 *
 * A non-2xx is a rejection, not an empty buffer: writing a 404 body into the
 * tile store would make the coverage probe answer "present" for a tile the
 * analysis worker cannot decode, which is a confidently-wrong "Covered" badge
 * built out of error pages.
 */
export function httpTileFetcher(
  urlFor: (tile: TileCoord) => string,
): (tile: TileCoord, signal: AbortSignal) => Promise<ArrayBuffer> {
  return async (tile, signal) => {
    const res = await fetch(urlFor(tile), { signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} for ${tile.z}/${tile.x}/${tile.y}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0) throw new Error(`empty tile ${tile.z}/${tile.x}/${tile.y}`);
    return buf;
  };
}
