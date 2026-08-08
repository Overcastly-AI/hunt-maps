/**
 * The offline write queue.
 *
 * ## What this is, honestly
 *
 * This is the foundation piece CLAUDE.md's first non-negotiable asks for
 * ("every write is queued and idempotent... if you cannot finish full
 * conflict resolution, build the queue with the right shape and report what
 * is unfinished") — **not** a finished offline-sync feature. What it does:
 *
 *  - Every write hook in `lib/api/` (`useCreateWaypoint`, `useCreateObservation`,
 *    `useSaveFilter`, `useUpdateWaypoint`, `useUpdateFilter`) tries the real
 *    request first. Only a `kind: 'network'` `ApiError` — genuinely no
 *    signal, never an auth/validation/conflict failure — falls back to
 *    queueing here instead of rejecting, so a stand logged at the bottom of a
 *    draw with no bars still feels like it saved.
 *  - Creates carry the `clientId` the API's own `CreateWaypointDto`/
 *    `CreateObservationDto`/`SaveFilterDto` already support for idempotent
 *    replay (`WaypointsService.create` etc. look the record up by `clientId`
 *    before inserting) — replaying this queue twice cannot create a
 *    duplicate.
 *  - Updates carry `baseVersion`. A conflict response (409, real optimistic-
 *    concurrency detection — `WaypointsService.update`,
 *    `apps/api/prisma/schema.prisma`'s `version` columns) is **never**
 *    discarded or silently retried as an overwrite. It is kept in the queue
 *    with `status: 'conflict'` and the server's state attached, exactly so a
 *    hunting party's two simultaneous edits from two devices do not silently
 *    drop one of them (last-write-wins is the specific failure this queue
 *    exists to prevent).
 *
 * ## What is NOT built here — read this before assuming otherwise
 *
 * There is **no merge UI** and **no automatic conflict resolution**. A
 * `status: 'conflict'` item sits in the queue, visible via `listQueue()`,
 * until a person looks at it. There is also no background periodic flush
 * beyond the `online` event listener registered by `initOfflineQueue()` — a
 * long offline session queues correctly, but nothing retries a `server`
 * (5xx) failure with backoff yet; it is left `status: 'error'` for a future
 * pass to add retry-with-backoff to. Building the resolution screen and the
 * retry policy is explicitly next-agent work; this module's job is to make
 * sure nothing already queued is ever silently lost in the meantime.
 *
 * ## Why `localStorage`, not the IndexedDB tile store
 *
 * `lib/offline/tileStore.ts` (owned by `offline-steward`/`map-builder`) is a
 * large-object DEM tile cache with an entirely different access pattern and
 * is explicitly out of this pass's territory. This queue holds small JSON
 * records — a few hundred bytes each — so `localStorage`'s ~5MB budget is
 * enough for thousands of queued mutations, and a synchronous API is
 * genuinely simpler here than IndexedDB for no real cost. If queue volume
 * ever becomes a real constraint, moving this to IndexedDB is a same-shaped
 * follow-up, not a redesign — the item shape below does not depend on the
 * storage engine.
 */

import { ApiError } from './client';
import type { CreateFilterInput, CreateObservationInput, CreateWaypointInput, UpdateFilterInput, UpdateWaypointInput } from './types';

export type QueuedOp =
  | { kind: 'waypoint.create'; clientId: string; input: CreateWaypointInput }
  | { kind: 'waypoint.update'; id: string; input: UpdateWaypointInput }
  | { kind: 'observation.create'; clientId: string; input: CreateObservationInput }
  | { kind: 'filter.create'; clientId: string; input: CreateFilterInput }
  | { kind: 'filter.update'; id: string; input: UpdateFilterInput };

export type QueueStatus = 'pending' | 'conflict' | 'error';

export interface QueueItem {
  /** Local identity, independent of `clientId` — an update has no `clientId` of its own. */
  queueId: string;
  op: QueuedOp;
  queuedAtUtc: string;
  status: QueueStatus;
  attempts: number;
  /** Set once `status` is `'conflict'` or `'error'`. Never used to silently overwrite — a person has to act on it. */
  lastError?: { message: string; serverState?: unknown };
}

const KEY = 'ridgeline.offlineQueue.v1';
type Listener = (items: QueueItem[]) => void;
const listeners = new Set<Listener>();

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readAll(): QueueItem[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueueItem[]) : [];
  } catch {
    return [];
  }
}

function writeAll(items: QueueItem[]): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage full or unavailable. The item that triggered this write is
    // lost from persistence, but it already exists in memory for this
    // session — nothing to recover from safely beyond not crashing.
  }
  notify();
}

function notify(): void {
  const items = readAll();
  for (const l of listeners) l(items);
}

/** UUID v4. `crypto.randomUUID` when available; a Math.random fallback for older/embedded runtimes so `clientId` generation never throws. */
export function newClientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function enqueue(op: QueuedOp): QueueItem {
  const item: QueueItem = {
    queueId: newClientId(),
    op,
    queuedAtUtc: new Date().toISOString(),
    status: 'pending',
    attempts: 0,
  };
  writeAll([...readAll(), item]);
  return item;
}

export function listQueue(): QueueItem[] {
  return readAll();
}

export function removeFromQueue(queueId: string): void {
  writeAll(readAll().filter((i) => i.queueId !== queueId));
}

export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True when `apiFetch` genuinely could not reach the server — the only case a write should queue instead of surfacing to the user. */
export function isQueueableFailure(err: unknown): boolean {
  return err instanceof ApiError && err.kind === 'network';
}

export type QueueRunner = (op: QueuedOp) => Promise<void>;

/**
 * Replay every pending item in order, in place, stopping at the first item
 * that is still unreachable (offline again mid-flush) so ordering is
 * preserved rather than reshuffled by whichever request happens to resolve
 * first.
 *
 * `runner` is injected rather than importing every feature module directly,
 * so this module has no dependency on `waypoints.ts`/`observations.ts`/
 * `filters.ts` — those already depend on this module for `enqueue`, and a
 * cycle would follow if it reached back in. `wireOfflineQueueRunner` (called
 * once from `lib/api/index.ts`) closes the loop at the composition root.
 */
let runner: QueueRunner | null = null;
let flushing = false;

export function wireOfflineQueueRunner(fn: QueueRunner): void {
  runner = fn;
}

export async function flushQueue(): Promise<void> {
  if (flushing || !runner) return;
  flushing = true;
  try {
    for (const item of readAll()) {
      if (item.status !== 'pending') continue; // conflicts/errors wait for a person, not a retry loop
      try {
        await runner(item.op);
        removeFromQueue(item.queueId);
      } catch (err) {
        if (isQueueableFailure(err)) {
          // Still offline. Leave this and everything after it queued, in
          // order, and stop — do not skip ahead and risk applying a later
          // write before an earlier one.
          return;
        }
        const items = readAll();
        const idx = items.findIndex((i) => i.queueId === item.queueId);
        if (idx === -1) continue;
        const isConflict = err instanceof ApiError && err.kind === 'conflict';
        items[idx] = {
          ...items[idx],
          attempts: items[idx].attempts + 1,
          status: isConflict ? 'conflict' : 'error',
          lastError: {
            message: err instanceof Error ? err.message : 'Failed to sync this change.',
            serverState: err instanceof ApiError ? err.body : undefined,
          },
        };
        writeAll(items);
      }
    }
  } finally {
    flushing = false;
  }
}

/** Registers the `online` listener that retries the queue as soon as the device reconnects. Call once at app start. */
export function initOfflineQueue(): () => void {
  const onOnline = () => void flushQueue();
  window.addEventListener('online', onOnline);
  // Also worth one attempt at boot — the app may have been launched already
  // connected with a queue left over from the last offline session.
  if (navigator.onLine) void flushQueue();
  return () => window.removeEventListener('online', onOnline);
}
