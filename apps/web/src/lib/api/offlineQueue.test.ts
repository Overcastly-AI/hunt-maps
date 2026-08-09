import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './client';
import {
  enqueue,
  flushQueue,
  isKnownOffline,
  isQueueableFailure,
  listQueue,
  newClientId,
  queueIsMemoryOnly,
  removeFromQueue,
  wireOfflineQueueRunner,
  type QueuedOp,
} from './offlineQueue';

function clearQueueStorage(): void {
  window.localStorage.removeItem('ridgeline.offlineQueue.v1');
}

function setOnLine(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { get: () => value, configurable: true });
}

describe('offlineQueue', () => {
  afterEach(() => {
    clearQueueStorage();
    setOnLine(true);
    vi.restoreAllMocks();
  });

  it('isKnownOffline() reports the device signal the write hooks gate on', () => {
    setOnLine(true);
    expect(isKnownOffline()).toBe(false);
    setOnLine(false);
    expect(isKnownOffline()).toBe(true);
  });

  it('listQueue() is referentially stable between writes, and changes identity on one', () => {
    // `useObservations`/`useWaypoints` feed this straight to
    // `useSyncExternalStore`, which loops forever if the snapshot is a new
    // array on every call.
    const first = listQueue();
    expect(listQueue()).toBe(first);

    enqueue({ kind: 'filter.create', clientId: 'f1', input: { name: 'F', predicate: {} } });
    const afterWrite = listQueue();
    expect(afterWrite).not.toBe(first);
    expect(listQueue()).toBe(afterWrite);
  });

  it('an external clear of storage is not masked by the snapshot cache', () => {
    enqueue({ kind: 'filter.create', clientId: 'f1', input: { name: 'F', predicate: {} } });
    expect(listQueue()).toHaveLength(1);
    // Another tab, devtools, or a user clearing site data. A cache that could
    // go stale against the durable copy would have this queue reporting work
    // as still pending that no longer exists — or worse, the inverse.
    clearQueueStorage();
    expect(listQueue()).toHaveLength(0);
  });

  it('a queued item survives a storage write failure in memory rather than vanishing', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    });

    enqueue({ kind: 'filter.create', clientId: 'f-quota', input: { name: 'F', predicate: {} } });
    // It cannot survive a reload — that is reported separately by
    // `queueIsMemoryOnly()` — but it must not disappear from the session's
    // view of what is unsaved the instant storage refuses it.
    expect(listQueue()).toHaveLength(1);
    expect(queueIsMemoryOnly(), 'a memory-only queue must be reportable, not implied').toBe(true);

    // And once storage accepts a write again, it goes back to being the source
    // of truth — the whole array is rewritten, so the two cannot disagree.
    setItem.mockRestore();
    removeFromQueue(listQueue()[0].queueId);
    expect(listQueue()).toHaveLength(0);
    expect(queueIsMemoryOnly()).toBe(false);
  });

  it('newClientId() produces distinct, non-empty ids', () => {
    const a = newClientId();
    const b = newClientId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(10);
  });

  it('isQueueableFailure is true only for a network ApiError', () => {
    expect(isQueueableFailure(new ApiError('network', 'x'))).toBe(true);
    expect(isQueueableFailure(new ApiError('auth', 'x'))).toBe(false);
    expect(isQueueableFailure(new ApiError('conflict', 'x'))).toBe(false);
    expect(isQueueableFailure(new Error('plain'))).toBe(false);
  });

  it('enqueue() persists the item and it survives a simulated reload', () => {
    const op: QueuedOp = {
      kind: 'waypoint.create',
      clientId: 'c1',
      input: { propertyId: 'p1', type: 'STAND', name: 'Ridge stand', location: { type: 'Point', coordinates: [0, 0] } },
    };
    enqueue(op);

    const raw = window.localStorage.getItem('ridgeline.offlineQueue.v1');
    expect(raw).not.toBeNull();
    const items = JSON.parse(raw as string);
    expect(items).toHaveLength(1);
    expect(items[0].op).toEqual(op);
    expect(items[0].status).toBe('pending');
  });

  it('flushQueue() replays pending items in order and removes them on success', async () => {
    const applied: string[] = [];
    wireOfflineQueueRunner(async (op) => {
      if (op.kind === 'waypoint.create') applied.push(op.clientId);
    });

    enqueue({ kind: 'waypoint.create', clientId: 'first', input: { propertyId: 'p1', type: 'STAND', name: 'A', location: { type: 'Point', coordinates: [0, 0] } } });
    enqueue({ kind: 'waypoint.create', clientId: 'second', input: { propertyId: 'p1', type: 'STAND', name: 'B', location: { type: 'Point', coordinates: [0, 0] } } });

    await flushQueue();

    expect(applied).toEqual(['first', 'second']);
    expect(listQueue()).toHaveLength(0);
  });

  it('flushQueue() stops at the first item that is still offline, leaving it and everything after it queued in order', async () => {
    const applied: string[] = [];
    wireOfflineQueueRunner(async (op) => {
      if (op.kind !== 'waypoint.create') return;
      if (op.clientId === 'second') throw new ApiError('network', 'still offline');
      applied.push(op.clientId);
    });

    enqueue({ kind: 'waypoint.create', clientId: 'first', input: { propertyId: 'p1', type: 'STAND', name: 'A', location: { type: 'Point', coordinates: [0, 0] } } });
    enqueue({ kind: 'waypoint.create', clientId: 'second', input: { propertyId: 'p1', type: 'STAND', name: 'B', location: { type: 'Point', coordinates: [0, 0] } } });
    enqueue({ kind: 'waypoint.create', clientId: 'third', input: { propertyId: 'p1', type: 'STAND', name: 'C', location: { type: 'Point', coordinates: [0, 0] } } });

    await flushQueue();

    expect(applied).toEqual(['first']);
    const remaining = listQueue();
    // "second" and "third" are both still queued, in their original order —
    // never reshuffled to let "third" go ahead of the item still failing.
    expect(remaining.map((i) => (i.op as { clientId: string }).clientId)).toEqual(['second', 'third']);
    expect(remaining.every((i) => i.status === 'pending')).toBe(true);
  });

  it('a 409 conflict is never silently applied or dropped — it is kept, flagged, with the server state attached', async () => {
    wireOfflineQueueRunner(async () => {
      throw new ApiError('conflict', 'This changed elsewhere since you last loaded it.', {
        body: { serverVersion: 3, yourVersion: 2 },
      });
    });

    enqueue({ kind: 'waypoint.update', id: 'w1', input: { name: 'Renamed', baseVersion: 2 } });
    await flushQueue();

    const items = listQueue();
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('conflict');
    expect(items[0].lastError?.serverState).toMatchObject({ serverVersion: 3 });
  });

  it('a validation/auth failure is kept and flagged as an error, never silently discarded', async () => {
    wireOfflineQueueRunner(async () => {
      throw new ApiError('validation', 'That request was not valid.');
    });

    enqueue({ kind: 'filter.create', clientId: 'f1', input: { name: 'Bad filter', predicate: {} } });
    await flushQueue();

    const items = listQueue();
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('error');
    expect(items[0].attempts).toBe(1);
  });

  it('conflict/error items are not retried by a later flush — they wait for a person', async () => {
    let calls = 0;
    wireOfflineQueueRunner(async () => {
      calls += 1;
      throw new ApiError('conflict', 'conflict');
    });

    enqueue({ kind: 'waypoint.update', id: 'w1', input: { name: 'x' } });
    await flushQueue();
    expect(calls).toBe(1);

    await flushQueue();
    // A second flush must not re-attempt an item already parked as a conflict.
    expect(calls).toBe(1);
  });
});
