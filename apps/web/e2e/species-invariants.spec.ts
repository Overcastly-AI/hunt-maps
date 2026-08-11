// `test`/`expect` come from ./fixtures, not @playwright/test: that import is what
// attaches the DEM tile relay and runs the elevation preflight (BACKLOG R76).
import { type Page, type Route } from '@playwright/test';
import { expect, test } from './fixtures';
import { DESKTOP, MOBILE } from './helpers/settle';

/**
 * UI invariants for R83's web half (the rut refusal) and R84 (the
 * species-invalid bedding layer), `docs/EVIDENCE.md` Pass 7.
 *
 * Kept in its own file rather than appended to `ui-invariants.spec.ts`
 * (the same reasoning `auth-invariants.spec.ts` states for itself): these
 * screens need a signed-in session and a mocked `/api/properties*` response,
 * neither of which `ui-invariants.spec.ts`'s helpers set up, and there is no
 * real backend in this sandbox to talk to for real.
 *
 * Per CLAUDE.md's fourth non-negotiable, every assertion here is against
 * *rendered* state — a real `toBeDisabled()`, a forced click that provably
 * does nothing, text actually painted on screen — never just "the prop was
 * set" or "the element exists in the DOM". A refusal that compiles and a
 * layer that greys out in `lib/layers.test.ts` prove the data is right; this
 * file proves a hunter looking at the real, rendered screen gets the honest
 * answer and cannot tap past it.
 */

const USER = {
  id: 'user-hd320-1',
  email: 'hunter@ridgeline.test',
  displayName: 'HD 320 Hunter',
  unitSystem: 'IMPERIAL' as const,
  createdAt: '2025-01-01T00:00:00.000Z',
};

const AUTH_KEY = 'ridgeline.auth.v1';
const PROPERTY_KEY = `ridgeline.currentPropertyId.${USER.id}`;

/** A cached session nowhere near expiry, so no proactive refresh fires. */
function storedAuth() {
  return {
    accessToken: 'access-hd320',
    refreshToken: 'refresh-hd320',
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    user: USER,
  };
}

/**
 * Seed `localStorage` **before any app script runs** — `AuthContext` derives
 * its initial state synchronously at first paint (`lib/api/AuthContext.tsx`),
 * so seeding after boot would test the second render, not the cold start a
 * real hunter reopening the app actually gets. Mirrors
 * `offline-durability.spec.ts`'s `seedSession`.
 */
async function seedSession(page: Page, propertyId: string): Promise<void> {
  await page.addInitScript(
    ({ auth, authKey, propertyKey, propertyId }) => {
      localStorage.setItem(authKey, JSON.stringify(auth));
      localStorage.setItem(propertyKey, propertyId);
    },
    { auth: storedAuth(), authKey: AUTH_KEY, propertyKey: PROPERTY_KEY, propertyId },
  );
}

/**
 * A property row shaped to satisfy both `PropertySummaryDto` (the list
 * endpoint) and `PropertyDetailDto` (the detail endpoint) at once, so one
 * fixture can answer both mocked routes below.
 */
function property(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'prop-x',
    name: 'X',
    description: null,
    areaHectares: 3200,
    centerLat: 45.5,
    centerLng: -111.9,
    timezone: 'America/Denver',
    ownerId: USER.id,
    createdAt: '2025-01-01T00:00:00.000Z',
    _count: { waypoints: 0, observations: 0 },
    targetSpecies: null,
    rut: null,
    memberships: [
      { role: 'OWNER', user: { id: USER.id, displayName: USER.displayName, email: USER.email } },
    ],
    terrainProfile: null,
    boundary: null,
    ...overrides,
  };
}

const ELK_PROPERTY = property({
  id: 'prop-elk-1',
  name: 'Tobacco Root Ridge',
  targetSpecies: 'ELK',
  rut: {
    supported: false,
    species: 'elk',
    reason:
      'No rut model for elk — this photoperiod curve is fitted to whitetail breeding data only (docs/EVIDENCE.md Pass 7).',
  },
});

const WHITETAIL_PROPERTY = property({
  id: 'prop-wt-1',
  name: 'Home 80',
  targetSpecies: 'WHITETAIL',
  rut: {
    supported: true,
    phase: 'chasing',
    daysFromPeak: -6,
    confidence: 0.9,
    note: 'Sit all day near doe bedding.',
  },
});

const UNSTATED_PROPERTY = property({
  id: 'prop-unstated-1',
  name: 'Back Forty',
  targetSpecies: null,
  rut: null,
});

/** Mocks the whole `/api` surface as healthy and instant — there is no real backend in this sandbox. */
async function mockApi(page: Page, properties: Record<string, unknown>[]): Promise<void> {
  await page.route('**/api/**', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api/, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/auth/me') return json(USER);
    if (path === '/properties') return json(properties);
    if (path.startsWith('/properties/')) {
      const id = path.split('/')[2];
      const match = properties.find((p) => p.id === id);
      return match ? json(match) : json({ message: 'not found' }, 404);
    }
    // `useDemSourceCoverage` (mounted unconditionally by `MapWorkspace`, for
    // the Layers sheet's "no 1 m data here" DEM-source picker copy) fires on
    // every load and expects a `DemCoverageDto` object, not the catch-all `[]`
    // below — an array has no `.oneMeter`, and `LayersSheet` reading
    // `.oneMeter.available` off it throws and unmounts the whole tree with no
    // error boundary to catch it. That crash was the actual cause of this
    // file's early flakiness (the Layers sheet vanishing mid-test) until it
    // was found via `page.on('pageerror', …)` — every endpoint a screen under
    // test can reach during its lifetime needs a shape-correct mock, not just
    // the ones a given test means to exercise.
    if (path === '/terrain/dem/coverage') {
      const lng = Number(url.searchParams.get('lng') ?? 0);
      const lat = Number(url.searchParams.get('lat') ?? 0);
      return json({
        lng,
        lat,
        oneMeter: { available: false, project: null, elevationMeters: null, utmZone: null },
        recommendedSource: 'terrarium',
        resolutionNote: 'mocked for e2e — no real DEM coverage service here',
      });
    }
    return json([]);
  });
}

/**
 * Boot the map workspace signed in, far enough to use the Layers sheet.
 *
 * Deliberately not `helpers/settle.ts`'s `gotoAndSettle`: that waits for
 * every map source (including the satellite basemap) to finish loading, and
 * `offline-durability.spec.ts` already found that host blocked by this
 * sandbox's egress proxy. Nothing in this file needs a painted basemap —
 * only the drawer, which is open by default (`App.tsx`'s `MapWorkspace`
 * initialises `drawerTab` to `'layers'`).
 */
async function gotoWorkspace(
  page: Page,
  viewport: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto('/');
  await page.getByTestId('map-canvas').waitFor({ state: 'visible', timeout: 60_000 });
}

for (const viewport of [DESKTOP, MOBILE]) {
  test.describe(`${viewport.width}px — bedding likelihood greys out for an elk property (R84)`, () => {
    test('is disabled, names the actual finding, and a forced tap does nothing', async ({
      page,
    }) => {
      await seedSession(page, ELK_PROPERTY.id as string);
      await mockApi(page, [ELK_PROPERTY]);
      await gotoWorkspace(page, viewport);

      const bedding = page.getByRole('checkbox', { name: /Bedding likelihood/ });
      await expect(bedding).toBeVisible();

      // The rendered-state assertion this whole file exists for: not "the
      // prop was set", but that a real click cannot check this box.
      await expect(bedding).toBeDisabled();
      await bedding.click({ force: true }).catch(() => undefined);
      await expect(bedding).not.toBeChecked();

      const reason = page.locator('#layer-bedding-desc');
      await expect(reason).toBeVisible();
      await expect(reason).toContainText('Millspaugh');
      // Never dressed as a graded assumption (`lib/layers.ts`'s
      // `speciesCaveat` doc comment) — the absence of a model is not the
      // same claim as `Confidence`'s "assumed" grade, and rendering both on
      // the same disabled row would blur that distinction on screen.
      await expect(page.locator('.rl-toggle:has(#layer-bedding-desc)')).not.toContainText(
        'Assumption',
      );
    });
  });

  test.describe(`${viewport.width}px — whitetail behaviour is unchanged (R84 regression guard)`, () => {
    test("a stated whitetail property never mentions species in bedding's blocked reason", async ({
      page,
    }) => {
      await seedSession(page, WHITETAIL_PROPERTY.id as string);
      await mockApi(page, [WHITETAIL_PROPERTY]);
      await gotoWorkspace(page, viewport);

      const bedding = page.getByRole('checkbox', { name: /Bedding likelihood/ });
      await expect(bedding).toBeVisible();

      // Still blocked (no wind set yet — unrelated to species), but for the
      // pre-existing reason, never the elk one.
      await expect(bedding).toBeDisabled();
      const reason = page.locator('#layer-bedding-desc');
      await expect(reason).not.toContainText('Millspaugh');
      await expect(reason).toContainText('wind direction');
    });
  });
}

test.describe('desktop — "not stated" is not treated as "not whitetail" (R84 regression guard)', () => {
  test('a property with no stated target species never gets the elk-only reason', async ({
    page,
  }) => {
    await seedSession(page, UNSTATED_PROPERTY.id as string);
    await mockApi(page, [UNSTATED_PROPERTY]);
    await gotoWorkspace(page, DESKTOP);

    const bedding = page.getByRole('checkbox', { name: /Bedding likelihood/ });
    await expect(bedding).toBeVisible();
    const reason = page.locator('#layer-bedding-desc');
    await expect(reason).not.toContainText('Millspaugh');
  });
});

// ---------------------------------------------------------------------------
// R83's web half — the rut refusal actually renders, and never as a phase
// ---------------------------------------------------------------------------

async function gotoSignedIn(
  page: Page,
  path: string,
  viewport: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto(path);
}

for (const viewport of [DESKTOP, MOBILE]) {
  test.describe(`${viewport.width}px — the R83 rut refusal renders on the property detail screen`, () => {
    test('shows "No rut model for elk" with the real reason, never a whitetail phase', async ({
      page,
    }) => {
      await seedSession(page, ELK_PROPERTY.id as string);
      await mockApi(page, [ELK_PROPERTY]);
      await gotoSignedIn(page, `/properties/${ELK_PROPERTY.id}`, viewport);

      // `exact: true` deliberately: `FormattedRutUnsupported.reason` (rendered
      // just below, as its own paragraph) begins with the same words as the
      // headline by construction — both start "No rut model for elk" — so a
      // substring match here would ambiguously hit both and prove nothing
      // about which one actually rendered.
      const headline = page.getByText('No rut model for elk', { exact: true });
      await expect(headline).toBeVisible();
      // Rendered-state, not DOM-state: prove it is actually painted with a
      // real box, not display:none/zero-size behind a stale conditional.
      const box = await headline.boundingBox();
      expect(box, 'refusal headline has no bounding box — is it actually painted?').not.toBeNull();
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.height).toBeGreaterThan(0);

      await expect(
        page.getByText('fitted to whitetail breeding data only', { exact: false }),
      ).toBeVisible();

      const bodyText = await page.locator('.property-screen__body').innerText();
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
        expect(
          bodyText,
          `refusal screen must never render the whitetail phase word "${phase}"`,
        ).not.toContain(phase);
      }
    });
  });

  test.describe(`${viewport.width}px — the R83 rut refusal renders on the properties list screen`, () => {
    test('shows the refusal chip, never a phase chip, for an elk property', async ({ page }) => {
      await seedSession(page, ELK_PROPERTY.id as string);
      await mockApi(page, [ELK_PROPERTY]);
      await gotoSignedIn(page, '/properties', viewport);

      await expect(page.getByText('Tobacco Root Ridge')).toBeVisible();
      const chip = page.getByText('No rut model for elk', { exact: false });
      await expect(chip).toBeVisible();
      const box = await chip.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThan(0);

      const listText = await page.getByTestId('property-list').innerText();
      for (const phase of ['Seeking', 'Chasing', 'Peak breeding']) {
        expect(listText).not.toContain(phase);
      }
    });
  });
}

test.describe('desktop — whitetail rut behaviour is unchanged (R83 regression guard)', () => {
  test('a whitetail property still renders its real phase, not a refusal', async ({ page }) => {
    await seedSession(page, WHITETAIL_PROPERTY.id as string);
    await mockApi(page, [WHITETAIL_PROPERTY]);
    await gotoSignedIn(page, `/properties/${WHITETAIL_PROPERTY.id}`, DESKTOP);

    await expect(page.getByText('Chasing', { exact: true })).toBeVisible();
    await expect(page.getByText('No rut model', { exact: false })).toHaveCount(0);
  });
});
