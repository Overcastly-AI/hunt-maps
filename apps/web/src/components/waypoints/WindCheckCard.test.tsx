import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WindCheckCard } from './WindCheckCard';
import type { WaypointWindCheckDto } from '../../lib/api/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(ui: JSX.Element) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(ui);
  });
  return container;
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
  });
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
  vi.unstubAllGlobals();
});

function withClient(ui: JSX.Element) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

const CHECK: WaypointWindCheckDto = {
  waypointId: 'w1',
  name: 'Ridge stand',
  atUtc: '2026-01-01T12:00:00Z',
  windFromDeg: 270,
  windOctant: 'W',
  thermalPhase: 'sinking',
  thermalScentAzimuthDeg: 95,
  synopticScentAzimuthDeg: 90,
  scentCone: { type: 'Polygon', coordinates: [] },
  thermalScentCone: null,
  terrain: {},
  sunriseUtc: null,
  sunsetUtc: null,
  rating: 'good',
  reasons: ['Wind carries away from the main approach trail.'],
};

describe('WindCheckCard — never a wind check against a made-up default (CLAUDE.md)', () => {
  it('is greyed out with a stated reason, and never fetches, when no wind is set', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const el = mount(withClient(<WindCheckCard waypointId="w1" windFromDeg={null} atUtc={new Date('2026-01-01T12:00:00Z')} />));

    expect(el.textContent).toContain('Set a wind direction');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders the rating and reasons once a wind is set and the check resolves', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(CHECK), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const el = mount(withClient(<WindCheckCard waypointId="w1" windFromDeg={270} atUtc={new Date('2026-01-01T12:00:00Z')} />));
    await flush();

    expect(fetchMock).toHaveBeenCalled();
    expect(el.textContent).toContain('Good to sit');
    expect(el.textContent).toContain('Wind carries away from the main approach trail.');
  });

  it('surfaces an onSetWind shortcut inline, when provided', () => {
    const onSetWind = vi.fn();
    const el = mount(
      withClient(<WindCheckCard waypointId="w1" windFromDeg={null} atUtc={new Date()} onSetWind={onSetWind} />),
    );
    const btn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Set wind')!;
    act(() => btn.click());
    expect(onSetWind).toHaveBeenCalledTimes(1);
  });
});
