import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './client';
import {
  enqueue,
  flushQueue,
  isQueueableFailure,
  listQueue,
  newClientId,
  wireOfflineQueueRunner,
  type QueuedOp,
} from './offlineQueue';

function clearQueueStorage(): void {
  window.localStorage.removeItem('ridgeline.offlineQueue.v1');
}

describe('offlineQueue', () => {
  afterEach(() => {
    clearQueueStorage();
    vi.restoreAllMocks();
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
