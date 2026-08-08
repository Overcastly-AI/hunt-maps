import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TerrainPredicate } from '@hunt-maps/terrain';
import { ApiError } from '../../lib/api/client';
import { useLiveMatchShare, type LiveMatchShareOptions } from './useLiveMatchShare';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let lastState: unknown;

function HarnessComponent(props: LiveMatchShareOptions) {
  lastState = useLiveMatchShare(props);
  return null;
}

function mount(props: LiveMatchShareOptions) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<HarnessComponent {...props} />);
  });
}

function rerender(props: LiveMatchShareOptions) {
  act(() => {
    root!.render(<HarnessComponent {...props} />);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
  vi.useRealTimers();
});

async function settle(ms = 600) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    // Let the promise microtask queue drain after the timer fires.
    await Promise.resolve();
    await Promise.resolve();
  });
}

const RANGE: TerrainPredicate = { kind: 'range', metric: 'slope', min: 8, max: 20 };
const VIEWPORT = { bounds: { west: -83, south: 39, east: -82, north: 40 }, zoom: 13 };

describe('useLiveMatchShare — the honesty gates, before any network call is made', () => {
  it('is "empty" for a predicate with no real condition', () => {
    const evaluate = vi.fn();
    mount({
      predicate: { kind: 'all', operands: [] },
      viewport: VIEWPORT,
      windFromDeg: null,
      atUtc: new Date(),
      evaluate,
    });
    expect(lastState).toEqual({ kind: 'empty' });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('is "negation-unreliable" for any predicate containing a not — BACKLOG R56 — and never calls the endpoint', async () => {
    const evaluate = vi.fn();
    mount({
      predicate: { kind: 'not', operand: RANGE },
      viewport: VIEWPORT,
      windFromDeg: null,
      atUtc: new Date(),
      evaluate,
    });
    await settle();
    expect(lastState).toEqual({ kind: 'negation-unreliable' });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('is "needs-wind" for a wind-dependent predicate with no wind set, and never calls the endpoint', async () => {
    const evaluate = vi.fn();
    mount({
      predicate: { kind: 'range', metric: 'bedding', min: 0, max: 0.1 },
      viewport: VIEWPORT,
      windFromDeg: null,
      atUtc: new Date(),
      evaluate,
    });
    await settle();
    expect(lastState).toEqual({ kind: 'needs-wind', metrics: ['bedding'] });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('is "no-view" when the map has not settled on a viewport yet, and never calls the endpoint', async () => {
    const evaluate = vi.fn();
    mount({ predicate: RANGE, viewport: null, windFromDeg: null, atUtc: new Date(), evaluate });
    await settle();
    expect(lastState).toEqual({ kind: 'no-view' });
    expect(evaluate).not.toHaveBeenCalled();
  });
});

describe('useLiveMatchShare — the happy path', () => {
  it('debounces, then resolves to a result carrying the server denominator fields', async () => {
    const evaluate = vi.fn().mockResolvedValue({ matchShare: 0.123, cellCount: 4096, advice: null });
    mount({ predicate: RANGE, viewport: VIEWPORT, windFromDeg: null, atUtc: new Date(), evaluate });

    // Not called yet — still inside the debounce window.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(evaluate).not.toHaveBeenCalled();

    await settle();
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(lastState).toMatchObject({ kind: 'result', matchShare: 0.123, cellCount: 4096 });
  });

  it('clamps zoom into the server DTO range [8, 16] and reports what it actually used', async () => {
    const evaluate = vi.fn().mockResolvedValue({ matchShare: 0.1, cellCount: 10, advice: null });
    mount({
      predicate: RANGE,
      viewport: { ...VIEWPORT, zoom: 19 },
      windFromDeg: null,
      atUtc: new Date(),
      evaluate,
    });
    await settle();
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ zoom: 16 }));
    expect(lastState).toMatchObject({ kind: 'result', zoomUsed: 16, zoomRequested: 19 });
  });

  it('supersedes a stale in-flight request with the latest edit — no flicker back to an old answer', async () => {
    let resolveFirst!: (v: { matchShare: number; cellCount: number; advice: string | null }) => void;
    const evaluate = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveFirst = resolve; }),
      )
      .mockResolvedValueOnce({ matchShare: 0.5, cellCount: 8, advice: null });

    mount({ predicate: RANGE, viewport: VIEWPORT, windFromDeg: null, atUtc: new Date(), evaluate });
    await settle();
    expect(lastState).toEqual({ kind: 'loading' });

    // A second edit lands before the first request resolves.
    const secondPredicate: TerrainPredicate = { kind: 'range', metric: 'slope', min: 5, max: 25 };
    rerender({ predicate: secondPredicate, viewport: VIEWPORT, windFromDeg: null, atUtc: new Date(), evaluate });
    await settle();

    // The stale first request finally resolves — must not overwrite the
    // answer for the edit the user actually made.
    await act(async () => {
      resolveFirst({ matchShare: 0.999, cellCount: 1, advice: null });
      await Promise.resolve();
    });
    expect(lastState).toMatchObject({ kind: 'result', matchShare: 0.5 });
  });
});

describe('useLiveMatchShare — failure is surfaced, not swallowed', () => {
  it('reports "offline" for a network failure, distinct from a real error', async () => {
    const evaluate = vi.fn().mockRejectedValue(new ApiError('network', 'no signal'));
    mount({ predicate: RANGE, viewport: VIEWPORT, windFromDeg: null, atUtc: new Date(), evaluate });
    await settle();
    expect(lastState).toEqual({ kind: 'offline' });
  });

  it('reports a real server error with its message', async () => {
    const evaluate = vi.fn().mockRejectedValue(new ApiError('server', 'the server had a problem'));
    mount({ predicate: RANGE, viewport: VIEWPORT, windFromDeg: null, atUtc: new Date(), evaluate });
    await settle();
    expect(lastState).toEqual({ kind: 'error', message: 'the server had a problem' });
  });
});
