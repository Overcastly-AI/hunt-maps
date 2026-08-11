import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { GameSpecies, RutPhase } from '@hunt-maps/shared';
import { PropertiesListScreen } from './PropertiesListScreen';
import type { PropertySummaryDto } from '../../lib/api/types';

// Mounting pattern and the reasoning for it: see `TerrainReadout.test.tsx`.
// The network-mocking shape (`vi.stubGlobal('fetch', ...)` + `QueryClientProvider`)
// follows `WindCheckCard.test.tsx` — the one existing precedent in this repo
// for a component wired directly to a `useQuery` hook rather than driven by
// props.
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
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});

function withProviders(ui: JSX.Element) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/properties']}>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const HOME_80: PropertySummaryDto = {
  id: 'p1',
  name: 'Home 80',
  description: null,
  areaHectares: 32.4,
  centerLat: 39.4,
  centerLng: -82.5,
  timezone: 'America/New_York',
  ownerId: 'u1',
  createdAt: '2026-01-01T00:00:00Z',
  _count: { waypoints: 3, observations: 12 },
  rut: {
    supported: true,
    phase: RutPhase.Seeking,
    daysFromPeak: -15,
    confidence: 0.9,
    note: 'Cover ground.',
  },
  targetSpecies: null,
};

describe('PropertiesListScreen — renders from cached data, treats error as an annotation', () => {
  it('shows a loading state, then the list once the request resolves', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([HOME_80]));
    vi.stubGlobal('fetch', fetchMock);

    const el = mount(withProviders(<PropertiesListScreen />));
    expect(el.textContent).toMatch(/Loading your properties/i);

    await flush();
    expect(el.textContent).toContain('Home 80');
    expect(el.textContent).toMatch(/32\.4 ha/);
    expect(el.textContent).toMatch(/3 waypoints/);
    expect(el.textContent).toMatch(/12 observations/);
    expect(el.textContent).toMatch(/Seeking/);
  });

  it('renders the R83 rut refusal chip for an elk property, never a borrowed whitetail phase', async () => {
    const elkProperty: PropertySummaryDto = {
      ...HOME_80,
      id: 'p-elk',
      name: 'Tobacco Root Ridge',
      targetSpecies: 'ELK',
      rut: {
        supported: false,
        species: GameSpecies.Elk,
        reason: 'No rut model for elk — fitted to whitetail breeding data only.',
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([elkProperty]));
    vi.stubGlobal('fetch', fetchMock);

    const el = mount(withProviders(<PropertiesListScreen />));
    await flush();

    expect(el.textContent).toContain('Tobacco Root Ridge');
    expect(el.textContent).toMatch(/No rut model for elk/i);
    expect(el.textContent).not.toMatch(/Seeking|Chasing|Peak breeding/);
  });

  it('shows an explained empty state, with a way to draw the first property, when there are none yet', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    const el = mount(withProviders(<PropertiesListScreen />));
    await flush();

    expect(el.textContent).toMatch(/No ground yet/i);
    const link = Array.from(el.querySelectorAll('a')).find((a) =>
      /Draw your first property/i.test(a.textContent ?? ''),
    );
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe('/properties/new');
  });

  it('always offers the primary "draw a new property" door, even while loading', () => {
    const fetchMock = vi.fn(() => new Promise(() => {})); // never resolves
    vi.stubGlobal('fetch', fetchMock);

    const el = mount(withProviders(<PropertiesListScreen />));
    const link = Array.from(el.querySelectorAll('a')).find((a) =>
      /Draw a new property/i.test(a.textContent ?? ''),
    );
    expect(link?.getAttribute('href')).toBe('/properties/new');
  });

  it('a failed refresh with nothing cached yet reads as an alert, not a silent blank page', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const el = mount(withProviders(<PropertiesListScreen />));
    await flush();

    const alert = el.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toMatch(/could not reach the server/i);
  });

  it('says so before a hunter starts drawing while offline, without hiding what is already loaded', async () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([HOME_80]));
    vi.stubGlobal('fetch', fetchMock);

    const el = mount(withProviders(<PropertiesListScreen />));
    await flush();

    expect(el.textContent).toMatch(/you are offline/i);
    // Still shows the last-loaded property underneath the banner.
    expect(el.textContent).toContain('Home 80');
  });
});
