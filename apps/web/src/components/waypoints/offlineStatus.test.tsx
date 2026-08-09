import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { enqueue, removeFromQueue } from '../../lib/api';
import { useQueuedIds } from './offlineStatus';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function clearQueueStorage() {
  window.localStorage.removeItem('ridgeline.offlineQueue.v1');
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
  clearQueueStorage();
});

function Probe({ onIds }: { onIds: (ids: Set<string>) => void }) {
  const ids = useQueuedIds('waypoint.create');
  onIds(ids);
  return null;
}

describe('useQueuedIds — "is this record still queued" (offline visibility)', () => {
  it('reflects a create already in the queue at mount, and clears once it is removed', () => {
    clearQueueStorage();
    enqueue({
      kind: 'waypoint.create',
      clientId: 'c-1',
      input: { propertyId: 'p1', type: 'STAND', name: 'A', location: { type: 'Point', coordinates: [0, 0] } },
    });

    let latest = new Set<string>();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<Probe onIds={(ids) => (latest = ids)} />);
    });

    expect(latest.has('c-1')).toBe(true);

    act(() => {
      removeFromQueue(JSON.parse(window.localStorage.getItem('ridgeline.offlineQueue.v1')!)[0].queueId);
    });

    expect(latest.has('c-1')).toBe(false);
  });

  it('never reports an observation-queue clientId as a queued waypoint', () => {
    clearQueueStorage();
    enqueue({
      kind: 'observation.create',
      clientId: 'obs-1',
      input: { propertyId: 'p1', kind: 'SIT', observedAt: '2026-01-01T00:00:00Z', location: { type: 'Point', coordinates: [0, 0] } },
    });

    let latest = new Set<string>();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<Probe onIds={(ids) => (latest = ids)} />);
    });

    expect(latest.has('obs-1')).toBe(false);
  });
});
