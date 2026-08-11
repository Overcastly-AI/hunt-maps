import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { GameSpecies, RutPhase } from '@hunt-maps/shared';
import { AuthProvider } from '../../lib/api';
import { tokenStore } from '../../lib/api/tokenStore';
import { PropertyDetailScreen } from './PropertyDetailScreen';
import type { PropertyDetailDto } from '../../lib/api/types';

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
  tokenStore.clear();
  window.localStorage.clear();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Routes every request by pathname suffix — `/api/properties/p1` vs. `/api/auth/me` need different bodies in the same test. */
function routedFetch(routes: Record<string, unknown>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [suffix, body] of Object.entries(routes)) {
      if (url.endsWith(suffix)) return jsonResponse(body);
    }
    return jsonResponse({ message: `unhandled in test: ${url}` }, 404);
  }) as unknown as typeof fetch;
}

function withProviders(ui: JSX.Element, id = 'p1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/properties/${id}`]}>
          <Routes>
            <Route path="/properties/:id" element={ui} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

const BASE_PROPERTY: PropertyDetailDto = {
  id: 'p1',
  name: 'Home 80',
  description: 'Access off the north gravel road.',
  areaHectares: 32.4,
  centerLat: 39.4,
  centerLng: -82.5,
  timezone: 'America/New_York',
  ownerId: 'owner-1',
  createdAt: '2026-01-01T00:00:00Z',
  _count: { waypoints: 3, observations: 12 },
  rut: {
    supported: true,
    phase: RutPhase.Chasing,
    daysFromPeak: -6,
    confidence: 0.9,
    note: 'Sit all day near doe bedding.',
  },
  targetSpecies: null,
  memberships: [
    {
      role: 'OBSERVER',
      user: { id: 'someone-else', displayName: 'Jess', email: 'jess@example.com' },
    },
  ],
  terrainProfile: null,
  boundary: {
    type: 'Polygon',
    coordinates: [
      [
        [-82.501, 39.399],
        [-82.499, 39.399],
        [-82.499, 39.401],
        [-82.501, 39.401],
        [-82.501, 39.399],
      ],
    ],
  },
};

describe('PropertyDetailScreen', () => {
  it('renders area, rut phase (bucketed confidence, never a bare number) and terrain-profile status', async () => {
    vi.stubGlobal('fetch', routedFetch({ '/properties/p1': BASE_PROPERTY }));
    const el = mount(withProviders(<PropertyDetailScreen />));
    await flush();

    expect(el.textContent).toContain('Home 80');
    expect(el.textContent).toMatch(/32\.4 ha/);
    expect(el.textContent).toMatch(/Chasing/);
    // The bucketed label, never the raw 0.9 confidence figure.
    expect(el.textContent).toMatch(/High confidence/);
    expect(el.textContent).not.toMatch(/0\.9\b/);
    expect(el.textContent).toMatch(/Not computed yet/i);
  });

  it('never claims a terrain profile that does not exist — no fabricated slope/bench figures', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch({ '/properties/p1': { ...BASE_PROPERTY, terrainProfile: null } }),
    );
    const el = mount(withProviders(<PropertyDetailScreen />));
    await flush();
    expect(el.textContent).not.toMatch(/mean slope/i);
  });

  it('renders real terrain-profile figures once the server has computed one', async () => {
    const withProfile: PropertyDetailDto = {
      ...BASE_PROPERTY,
      terrainProfile: {
        id: 'tp1',
        propertyId: 'p1',
        demSource: 'usgs-10m',
        demZoom: 14,
        cellSizeM: 10,
        minElevationM: 210,
        maxElevationM: 340,
        meanSlopeDeg: 12.4,
        slopeShares: [],
        aspectShares: [],
        landformShares: [],
        benchShare: 0.18,
        sourceVersion: '1',
        computedAt: '2026-02-01T00:00:00Z',
      },
    };
    vi.stubGlobal('fetch', routedFetch({ '/properties/p1': withProfile }));
    const el = mount(withProviders(<PropertyDetailScreen />));
    await flush();
    expect(el.textContent).toMatch(/mean slope 12\.4/i);
    expect(el.textContent).toMatch(/18% bench/i);
  });

  it('a non-privileged member sees no edit/delete controls, and is told what access they have', async () => {
    tokenStore.set({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + 60_000,
      user: {
        id: 'someone-else',
        email: 'jess@example.com',
        displayName: 'Jess',
        unitSystem: 'IMPERIAL',
        createdAt: '2026-01-01',
      },
    });
    vi.stubGlobal(
      'fetch',
      routedFetch({
        '/properties/p1': BASE_PROPERTY,
        '/auth/me': BASE_PROPERTY.memberships[0].user,
      }),
    );
    const el = mount(withProviders(<PropertyDetailScreen />));
    await flush();

    expect(
      Array.from(el.querySelectorAll('a')).some((a) =>
        /edit boundary|draw boundary/i.test(a.textContent ?? ''),
      ),
    ).toBe(false);
    expect(el.textContent).toMatch(/Observer access/i);
    expect(el.querySelector('.rl-btn--danger')).toBeNull();
  });

  it('the owner sees Edit boundary and Delete, and delete requires an explicit second press', async () => {
    tokenStore.set({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + 60_000,
      user: {
        id: 'owner-1',
        email: 'owner@example.com',
        displayName: 'Owner',
        unitSystem: 'IMPERIAL',
        createdAt: '2026-01-01',
      },
    });
    const owned: PropertyDetailDto = {
      ...BASE_PROPERTY,
      memberships: [
        {
          role: 'OWNER',
          user: { id: 'owner-1', displayName: 'Owner', email: 'owner@example.com' },
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      routedFetch({ '/properties/p1': owned, '/auth/me': owned.memberships[0].user }),
    );
    const el = mount(withProviders(<PropertyDetailScreen />));
    await flush();

    const editLink = Array.from(el.querySelectorAll('a')).find((a) =>
      /edit boundary/i.test(a.textContent ?? ''),
    );
    expect(editLink?.getAttribute('href')).toBe('/properties/p1/boundary');

    const deleteButton = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent === 'Delete this property',
    )!;
    expect(deleteButton).toBeTruthy();
    // First press only arms the confirmation — it must not delete on one tap.
    act(() => deleteButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(el.textContent).toMatch(/Delete property for good/);
    expect(el.querySelector('a[href="/properties"]')).toBeTruthy();
  });

  it('renders the R83 rut refusal for a stated non-whitetail species — never a whitetail phase (docs/EVIDENCE.md Pass 7)', async () => {
    const elkProperty: PropertyDetailDto = {
      ...BASE_PROPERTY,
      targetSpecies: 'ELK',
      rut: {
        supported: false,
        species: GameSpecies.Elk,
        reason:
          'No rut model for elk — this photoperiod curve is fitted to whitetail breeding data only (docs/EVIDENCE.md Pass 7).',
      },
    };
    vi.stubGlobal('fetch', routedFetch({ '/properties/p1': elkProperty }));
    const el = mount(withProviders(<PropertyDetailScreen />));
    await flush();

    expect(el.textContent).toMatch(/No rut model for elk/i);
    expect(el.textContent).toContain('fitted to whitetail breeding data only');
    // The specific failure this guards: a refusal must never render any of
    // the whitetail phase vocabulary, borrowed or otherwise.
    for (const phase of [
      'Off-season',
      'Pre-rut',
      'Seeking',
      'Chasing',
      'Peak breeding',
      'Post-rut',
      'Second rut',
      'Late season',
    ]) {
      expect(el.textContent).not.toContain(phase);
    }
  });

  it('says the property was not found rather than rendering a blank screen', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'Not found.' }, 404)));
    const el = mount(withProviders(<PropertyDetailScreen />));
    await flush();
    const alert = el.querySelector('[role="alert"]');
    expect(alert?.textContent).toMatch(/not found/i);
  });
});
