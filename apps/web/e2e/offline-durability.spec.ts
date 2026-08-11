// `test`/`expect` come from ./fixtures, not @playwright/test: that import is what
// attaches the DEM tile relay and runs the elevation preflight (BACKLOG R76).
import { type Page, type Route } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The three silent failures.
 *
 * Every case here is a defect that a DOM-level test passes straight through:
 * the button was clicked, the component rendered, `getByRole` found it — and
 * the hunter's morning was still lost. So each one asserts against the thing
 * that actually survives: what is in `localStorage` after a reload, whether the
 * router bounced, and what text is painted.
 *
 *  1. **An offline write must reach the persisted queue.** React Query's
 *     default `networkMode: 'online'` pauses a mutation *before* `mutationFn`
 *     runs, so the enqueue path in `lib/api/offlineQueue.ts` was unreachable in
 *     exactly the case it exists for. The symptom was a "Saving…" button that
 *     never resolved and a write that was gone after a reload.
 *  2. **Only a 401 signs anyone out.** A 502 from a restarting API is the
 *     single most likely thing a self-hosted Ridgeline does on a bad day, and
 *     it used to clear the session and bounce to `/login` with full signal.
 *  3. **An unanswered properties query is not "you have no properties".** An
 *     offline reload used to wipe the remembered property id and tell the
 *     hunter to go create one — a flow that cannot work offline.
 *
 * There is deliberately no backend in this sandbox. Every `/api` response here
 * is a route fulfilled in-process, which is what makes "the POST was never even
 * attempted" observable: a mock that answers in microseconds and still records
 * zero hits proves the request never left the app.
 */

const USER = {
  id: 'user-qa-1',
  email: 'qa@ridgeline.test',
  displayName: 'QA Hunter',
  unitSystem: 'IMPERIAL' as const,
  createdAt: '2025-01-01T00:00:00.000Z',
};

const PROPERTY = {
  id: 'prop-qa-1',
  name: 'Sandy Ridge',
  description: null,
  areaHectares: 120,
  centerLat: 39.434,
  centerLng: -82.54,
  timezone: 'America/New_York',
  ownerId: USER.id,
  createdAt: '2025-01-01T00:00:00.000Z',
  _count: { waypoints: 0, observations: 0 },
  rut: null,
};

const AUTH_KEY = 'ridgeline.auth.v1';
const QUEUE_KEY = 'ridgeline.offlineQueue.v1';
const PROPERTY_KEY = `ridgeline.currentPropertyId.${USER.id}`;

/** A cached session that is nowhere near expiry, so no proactive refresh fires. */
function storedAuth() {
  return {
    accessToken: 'access-qa',
    refreshToken: 'refresh-qa',
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    user: USER,
  };
}

/**
 * Seed `localStorage` **before any app script runs**.
 *
 * `addInitScript` rather than `evaluate`-then-reload because `AuthContext`
 * derives its initial state synchronously at module scope on first paint —
 * seeding after boot would be testing the second render, not the cold start.
 */
async function seedSession(
  page: Page,
  opts: { propertyId?: string | null; forceOffline?: boolean } = {},
): Promise<void> {
  await page.addInitScript(
    ({ auth, authKey, propertyKey, propertyId, forceOffline }) => {
      localStorage.setItem(authKey, JSON.stringify(auth));
      if (propertyId) localStorage.setItem(propertyKey, propertyId);
      if (forceOffline) {
        // The exact signal both React Query's `onlineManager` and the app's own
        // offline handling key off. Set before boot so nothing observes a
        // transient `true`.
        Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
      }
    },
    {
      auth: storedAuth(),
      authKey: AUTH_KEY,
      propertyKey: PROPERTY_KEY,
      propertyId: opts.propertyId ?? null,
      forceOffline: opts.forceOffline ?? false,
    },
  );
}

interface ApiRecorder {
  /** Method+path of every `/api` request the app actually issued. */
  hits: string[];
  /** Flip to make every `/api` route abort as if the radio were dead. */
  offline: { value: boolean };
}

/**
 * Mock the whole API surface as *healthy and instant*.
 *
 * The point of a healthy backend in an offline test: if the app still fails to
 * write, the failure cannot be blamed on the network. It is the app's own
 * offline gate.
 */
async function mockApi(page: Page, opts: { properties?: unknown[] } = {}): Promise<ApiRecorder> {
  const hits: string[] = [];
  const offline = { value: false };

  await page.route('**/api/**', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api/, '');
    hits.push(`${req.method()} ${path}`);

    if (offline.value) {
      await route.abort('internetdisconnected');
      return;
    }

    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/auth/me') return json(USER);
    if (path === '/properties') return json(opts.properties ?? [PROPERTY]);
    if (path.startsWith('/properties/')) return json(PROPERTY);
    if (path === '/observations' && req.method() === 'POST') {
      const sent = req.postDataJSON() as Record<string, unknown>;
      return json(
        {
          ...sent,
          id: 'server-obs-1',
          userId: USER.id,
          version: 1,
          createdAt: new Date().toISOString(),
        },
        201,
      );
    }
    if (path === '/observations') return json([]);
    if (path === '/waypoints') return json([]);
    if (path === '/filters' || path === '/filters/presets') return json([]);
    return json([]);
  });

  return { hits, offline };
}

/** The persisted offline queue, parsed. `null` when the key was never written. */
async function readQueue(
  page: Page,
): Promise<Array<{ op: { kind: string }; status: string }> | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Array<{ op: { kind: string }; status: string }>) : null;
  }, QUEUE_KEY);
}

/**
 * Boot the map workspace far enough to use the drawer.
 *
 * Deliberately **not** `gotoAndSettle`: the basemap host is blocked by this
 * sandbox's egress proxy, so any tiles-loaded wait stalls for the full timeout.
 * Nothing in this file needs a painted map — only the drawer.
 */
async function gotoWorkspace(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('map-canvas').waitFor({ state: 'visible', timeout: 60_000 });
}

// ---------------------------------------------------------------------------
// 1. An offline write must land in the persisted queue, and say so
// ---------------------------------------------------------------------------

test.describe('offline writes survive', () => {
  test('a blank sit logged with no signal is persisted to the queue and still there after a reload', async ({
    page,
    context,
  }) => {
    // GPS, not the map centre: the fallback location depends on the basemap
    // having settled, and the basemap is blocked here.
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 39.434, longitude: -82.54 });

    await seedSession(page, { propertyId: PROPERTY.id });
    const api = await mockApi(page);
    await gotoWorkspace(page);

    await page.getByRole('radio', { name: 'Sightings' }).click();
    await page.getByRole('button', { name: 'Log a blank sit' }).click();
    await page.getByRole('button', { name: 'Save blank sit' }).waitFor({ state: 'visible' });

    // No bars. The network itself stays healthy and the mocks stay instant —
    // so a POST that never arrives proves the app never attempted it, and a
    // POST that arrives proves the app ignored its own offline signal.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });

    const postsBefore = api.hits.filter((h) => h === 'POST /observations').length;
    await page.getByRole('button', { name: 'Save blank sit' }).click();

    // The single most important assertion in this file: the write reached
    // durable storage. Short timeout on purpose — enqueueing is synchronous
    // work, and "eventually, once signal returns, if the tab is still open"
    // is precisely the behaviour that lost the record.
    await expect
      .poll(async () => (await readQueue(page))?.length ?? 0, {
        timeout: 5_000,
        message: 'the offline write never reached ridgeline.offlineQueue.v1',
      })
      .toBe(1);

    const queued = await readQueue(page);
    expect(queued?.[0].op.kind).toBe('observation.create');
    expect(queued?.[0].status).toBe('pending');
    expect(
      api.hits.filter((h) => h === 'POST /observations').length - postsBefore,
      'with navigator.onLine false the app should queue rather than hang on a request it knows cannot be sent',
    ).toBe(0);

    // The button must not still read "Saving…" — that is the spinner that
    // looked like progress right up until the app was closed.
    await expect(page.getByRole('button', { name: 'Saving…' })).toHaveCount(0);

    // And the hunter has to be able to *see* it is queued, not just trust us.
    await expect(page.getByText('Queued').first()).toBeVisible();

    // Now the part that actually failed: the phone gets reclaimed by the OS
    // and the app is relaunched, still with no signal.
    api.offline.value = true;
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
    });
    await page.reload();
    await page.getByTestId('map-canvas').waitFor({ state: 'visible', timeout: 60_000 });

    const afterReload = await readQueue(page);
    expect(afterReload?.length ?? 0, 'the queued write did not survive a reload').toBe(1);

    await page.getByRole('radio', { name: 'Sightings' }).click();
    await expect(
      page.getByText('Queued').first(),
      'a write still waiting to sync must be visible after a cold start, not just remembered in localStorage',
    ).toBeVisible();

    // Signal comes back at the truck. The record must actually reach the
    // server and leave the queue — a durable queue that never drains is only a
    // slower way to lose the sighting.
    api.offline.value = false;
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
      window.dispatchEvent(new Event('online'));
    });

    await expect
      .poll(() => api.hits.filter((h) => h === 'POST /observations').length, { timeout: 15_000 })
      .toBe(1);
    await expect
      .poll(async () => (await readQueue(page))?.length ?? 0, {
        timeout: 15_000,
        message: 'the write synced but was left in the queue, so it would replay forever',
      })
      .toBe(0);
  });

  test('with signal, the same write goes straight to the server and never touches the queue', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 39.434, longitude: -82.54 });

    await seedSession(page, { propertyId: PROPERTY.id });
    const api = await mockApi(page);
    await gotoWorkspace(page);

    await page.getByRole('radio', { name: 'Sightings' }).click();
    await page.getByRole('button', { name: 'Log a blank sit' }).click();
    await page.getByRole('button', { name: 'Save blank sit' }).click();

    await expect
      .poll(() => api.hits.filter((h) => h === 'POST /observations').length, { timeout: 10_000 })
      .toBe(1);
    expect(
      await readQueue(page),
      'a write that succeeded online must not be left in the queue',
    ).toEqual(null);
  });
});

// ---------------------------------------------------------------------------
// 2. Only a 401 signs anyone out
// ---------------------------------------------------------------------------

test.describe('a sick server is not an invalid session', () => {
  test('a 502 from every endpoint leaves the hunter signed in', async ({ page }) => {
    await seedSession(page, { propertyId: PROPERTY.id });
    await page.route('**/api/**', (route) =>
      route.fulfill({
        status: 502,
        contentType: 'text/html',
        body: '<html><body><h1>502 Bad Gateway</h1></body></html>',
      }),
    );

    await gotoWorkspace(page);
    // Give the background /auth/me check time to resolve and do its damage.
    await page.waitForTimeout(2_000);

    expect(
      await page.evaluate((k) => localStorage.getItem(k), AUTH_KEY),
      'a 502 cleared the cached session — the server is unwell, the credentials are not',
    ).not.toBeNull();
    expect(new URL(page.url()).pathname).not.toBe('/login');

    // And the app must still behave as signed in, not show the signed-out copy.
    await page.getByRole('radio', { name: 'Stands' }).click();
    await expect(page.getByText(/Sign in to log stands/i)).toHaveCount(0);

    // A gated route must still be reachable rather than bouncing to /login.
    await page.goto('/properties');
    await page.waitForTimeout(1_000);
    expect(new URL(page.url()).pathname).toBe('/properties');
  });

  test('a genuine 401 that survives a refresh still signs the hunter out', async ({ page }) => {
    await seedSession(page, { propertyId: PROPERTY.id });
    await page.route('**/api/**', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Unauthorized' }),
      }),
    );

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect
      .poll(async () => page.evaluate((k) => localStorage.getItem(k), AUTH_KEY), {
        timeout: 15_000,
      })
      .toBeNull();
  });

  test('a genuinely dropped connection leaves the hunter signed in', async ({ page }) => {
    await seedSession(page, { propertyId: PROPERTY.id, forceOffline: true });
    await page.route('**/api/**', (route) => route.abort('internetdisconnected'));

    await gotoWorkspace(page);
    await page.waitForTimeout(2_000);

    expect(
      await page.evaluate((k) => localStorage.getItem(k), AUTH_KEY),
      'no signal must never sign anyone out',
    ).not.toBeNull();
    expect(new URL(page.url()).pathname).not.toBe('/login');
  });
});

// ---------------------------------------------------------------------------
// 3. An unanswered properties query is not "you have none"
// ---------------------------------------------------------------------------

test.describe('the remembered property survives no signal', () => {
  test('an offline reload keeps the selected property and never says "create one"', async ({
    page,
  }) => {
    await seedSession(page, { propertyId: PROPERTY.id });
    const api = await mockApi(page);
    await gotoWorkspace(page);

    // Confirmed selected while online first, so the offline case below is a
    // regression from a known-good state rather than a cold guess.
    //
    // The property name now appears twice on the desktop rail — the rail's
    // own header badge (`.rail__property`) and the docked panel's property
    // banner (`.rail-panel-dock .rl-property-banner`) — so the assertion is
    // scoped to the panel, which is the surface this test is actually about.
    await page.getByRole('radio', { name: 'Sightings' }).click();
    await expect(page.locator('.rail-panel-dock').getByText(PROPERTY.name)).toBeVisible();

    api.offline.value = true;
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
    });
    await page.reload();
    await page.getByTestId('map-canvas').waitFor({ state: 'visible', timeout: 60_000 });
    await page.getByRole('radio', { name: 'Sightings' }).click();

    // Six seconds, not one: the id used to survive the first render and only
    // get wiped once the query's retries were exhausted (~4s here). A short
    // wait would have called this fixed while the hunter's property was still
    // about to disappear in front of them.
    for (let elapsed = 0; elapsed < 6_000; elapsed += 1_000) {
      await page.waitForTimeout(1_000);
      expect(
        await page.evaluate((k) => localStorage.getItem(k), PROPERTY_KEY),
        `the remembered property id was wiped ${elapsed + 1000}ms into an offline reload, by a query that never got an answer`,
      ).toBe(PROPERTY.id);
    }

    // Rendered text, not a DOM query: this copy is split across text nodes by
    // its inline <Link>, and a `getByText` regex silently matches nothing —
    // which is how a broken assertion here would pass while the false message
    // was on screen. Read what was actually painted.
    const drawerText = await page.locator('.rail-panel-dock').innerText();
    expect(
      drawerText,
      'told an offline hunter to go create a property they already have',
    ).not.toMatch(/needs a property first/i);
    expect(drawerText, 'the remembered property should still be named, not "unknown"').toContain(
      PROPERTY.name,
    );
    await expect(page.getByRole('button', { name: 'Log a blank sit' })).toBeVisible();
  });

  test('with nothing remembered and no signal, the picker says it could not check — not "you have none"', async ({
    page,
  }) => {
    await seedSession(page, { propertyId: null, forceOffline: true });
    await page.route('**/api/**', (route) => route.abort('internetdisconnected'));

    await gotoWorkspace(page);
    await page.getByRole('radio', { name: 'Sightings' }).click();
    await page.waitForTimeout(6_000); // outlast the query's retries

    const drawerText = await page.locator('.rail-panel-dock').innerText();
    expect(drawerText).not.toMatch(/needs a property first/i);
    expect(drawerText).toMatch(/could not check your properties/i);
  });

  test('a property genuinely deleted server-side is still forgotten', async ({ page }) => {
    await seedSession(page, { propertyId: PROPERTY.id });
    // A *successful* answer that does not contain the remembered property —
    // the one case where clearing it is correct.
    await mockApi(page, { properties: [] });
    await gotoWorkspace(page);
    await page.getByRole('radio', { name: 'Sightings' }).click();

    await expect
      .poll(async () => page.evaluate((k) => localStorage.getItem(k), PROPERTY_KEY), {
        timeout: 10_000,
      })
      .toBeNull();
  });
});
