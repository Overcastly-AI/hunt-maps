// `test`/`expect` come from ./fixtures, not @playwright/test: that import is what
// attaches the DEM tile relay and runs the elevation preflight (BACKLOG R76).
import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type maplibregl from 'maplibre-gl';
import { seedTilesForView, clearTiles, jumpTo, chipText, remeasure } from './helpers/offline';

/**
 * Screenshots of what shipped in the R8 / R21 / R11 / R22 pass.
 *
 * Kept separate from screenshots.spec.ts because that file is the standing
 * founder-update set and this one is tied to a single pass. Like that file it
 * doubles as a smoke test: every capture asserts the state it claims to show
 * *before* taking the picture, so a screenshot of the wrong thing fails the run
 * rather than quietly landing in a report.
 */

const OUT = 'screenshots/landed';

/** Hocking Hills, Ohio — sharp relief, real whitetail hill country. */
const VIEW = '#14/39.4340/-82.5400';

async function waitForTiles(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const hook = (window as unknown as { __ridgeline?: { map: maplibregl.Map } }).__ridgeline;
      return Boolean(hook?.map?.isStyleLoaded() && hook.map.areTilesLoaded());
    },
    undefined,
    { timeout: 120_000 },
  );
  await page.waitForTimeout(3000);
}

async function openLayers(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: 'Layers' });
  if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
}

async function toggle(page: Page, label: string): Promise<void> {
  await page.getByRole('checkbox', { name: label, exact: false }).first().click();
}

test.describe('R8 — coverage states', () => {
  test.beforeEach(async ({ page, context }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${VIEW}`);
    await waitForTiles(page);

    // Cut the network once the view has rendered, before any test below seeds
    // the store. This is not scene-setting, it is what makes the seeded state
    // the state under test.
    //
    // `TerrainProtocol.fetchDem` persists every DEM tile it renders ("Persist
    // for offline use" — apps/web/src/lib/map/terrainProtocol.ts), so with a
    // working connection the app refills the store between `seedTilesForView`
    // and the measurement, and a half-seeded device reports COVERED. These
    // three assertions used to pass only because Chromium could not reach the
    // network at all in this sandbox (BACKLOG R76) — the harness was supplying
    // the "no more tiles can arrive" precondition by being broken. Now that DEM
    // tiles really load, the precondition has to be stated.
    //
    // It is also the honest scenario: the hunter reading this badge is the one
    // with no bars.
    await context.setOffline(true);
  });

  test('covered — every tile this view draws from is stored', async ({ page }) => {
    await seedTilesForView(page, 1);
    await openLayers(page);
    await remeasure(page);
    // Assert the state before photographing it. A screenshot captioned
    // "Covered" that shows something else is worse than no screenshot.
    await expect.poll(() => chipText(page), { timeout: 30_000 }).toMatch(/COVERED/i);
    await page.screenshot({ path: `${OUT}/01-covered.png` });
  });

  test('partial — the hatch shows which half of the draw is missing', async ({ page }) => {
    // Clear first: `seedTilesForView` adds, it does not remove, and the render
    // that got us here already persisted every tile in view (see `beforeEach`).
    // Without this, "seed half" means "already had all of them, now with half
    // of them written twice" and the badge correctly reports COVERED.
    await clearTiles(page);
    await seedTilesForView(page, 0.5);
    await openLayers(page);
    await remeasure(page);
    await expect.poll(() => chipText(page), { timeout: 30_000 }).toMatch(/PARTIAL/i);
    await page.screenshot({ path: `${OUT}/02-partial-with-hatch.png` });
  });

  test('not downloaded — the badge does not travel five hundred miles', async ({ page }) => {
    // Seed here, prove Covered, then pan far away. This is the R8 defect
    // reproduced as a picture: the old build stayed green through this jump.
    await seedTilesForView(page, 1);
    await openLayers(page);
    await remeasure(page);
    await expect.poll(() => chipText(page), { timeout: 30_000 }).toMatch(/COVERED/i);
    await page.screenshot({ path: `${OUT}/03a-before-pan.png` });

    // Missouri, ~500 miles west of the seeded Ohio ground.
    await jumpTo(page, -92.5, 38.6);
    await expect.poll(() => chipText(page), { timeout: 30_000 }).toMatch(/NOT DOWNLOADED/i);
    await page.screenshot({ path: `${OUT}/03b-after-pan-not-downloaded.png` });
  });

  test('cold device — nothing stored at all', async ({ page }) => {
    await clearTiles(page);
    await openLayers(page);
    await remeasure(page);
    await expect.poll(() => chipText(page), { timeout: 30_000 }).toMatch(/NOT DOWNLOADED/i);
    await page.screenshot({ path: `${OUT}/04-cold-device.png` });
  });

  test('mobile 390px — where this is actually read', async ({ page, context }) => {
    // This one re-navigates at a phone viewport, so it needs the connection
    // back for the load and cut again before it seeds — same reason as the
    // `beforeEach` above.
    await context.setOffline(false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${VIEW}`);
    await waitForTiles(page);
    await context.setOffline(true);
    await clearTiles(page); // as above: seeding half a full store is still full
    await seedTilesForView(page, 0.5);
    await openLayers(page);
    await remeasure(page);
    await expect.poll(() => chipText(page), { timeout: 30_000 }).toMatch(/PARTIAL/i);
    await page.screenshot({ path: `${OUT}/05-mobile-partial.png` });
  });
});

test.describe('R21/R11/R22 — the corrected bedding layer', () => {
  test('bedding likelihood on a NW wind', async ({ page }) => {
    // Bedding is the most expensive layer in the engine — VRM over a 9x9
    // window, shelter, insolation and the corridor-grade slope stats, all on
    // device. Under swiftshader that comfortably outruns the 180s default.
    test.setTimeout(900_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${VIEW}`);
    await waitForTiles(page);

    // Bedding is disabled until a wind exists — the layer is a leeward model,
    // and CLAUDE.md's rule is to grey out rather than render a default. The
    // first version of this test tried to click it cold and hung for three
    // minutes on a correctly-disabled control, which is the product working.
    await openLayers(page);
    const bedding = page.getByRole('checkbox', { name: /Bedding likelihood/ });
    await expect(bedding).toBeDisabled();
    await page.screenshot({ path: `${OUT}/06a-bedding-greyed-no-wind.png` });

    await page.getByRole('button', { name: /Wind from/ }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'NW', exact: true }).click();
    await waitForTiles(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await openLayers(page);
    await expect(bedding).toBeEnabled();
    await bedding.click();
    await waitForTiles(page);
    await page.getByRole('button', { name: 'Close panel' }).click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/06b-bedding-corrected-nw.png` });
  });
});
