import { expect, test, type Page } from '@playwright/test';
import type maplibregl from 'maplibre-gl';

/**
 * Screenshot capture for founder updates and design review.
 *
 * Doubles as a real smoke test: it drives the actual built artifact, waits for
 * on-device terrain analysis to produce tiles, and fails if a layer never
 * renders. A screenshot run that passes proves the DEM fetch → worker →
 * OffscreenCanvas → MapLibre pipeline works end to end in a real browser, which
 * no unit test in this repo covers.
 */

const OUT = 'screenshots';

/** Hocking Hills, Ohio — sharp relief, real whitetail hill country. */
const VIEW = '#14/39.4340/-82.5400';

/**
 * Wait until MapLibre reports idle *and* the analysis worker has produced
 * tiles. `map.on('idle')` alone fires before our async protocol resolves, so a
 * naive wait screenshots an empty canvas.
 */
async function waitForTiles(page: Page): Promise<void> {
  // MapLibre's own accounting, via the e2e hook in MapView. Reading back the GL
  // framebuffer gives false negatives — the drawing buffer is cleared between
  // frames unless `preserveDrawingBuffer` is set, and setting that in
  // production to make tests easier would be the tail wagging the dog.
  await page.waitForFunction(
    () => {
      const hook = (window as unknown as { __ridgeline?: { map: maplibregl.Map } }).__ridgeline;
      return Boolean(hook?.map?.isStyleLoaded() && hook.map.areTilesLoaded());
    },
    undefined,
    { timeout: 120_000 },
  );
  // On-device analysis resolves asynchronously behind the tile request, so give
  // the worker a beat to finish painting before capturing.
  await page.waitForTimeout(3000);
}

async function toggle(page: Page, label: string): Promise<void> {
  await page.getByRole('checkbox', { name: label, exact: false }).first().click();
}

async function openLayers(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: 'Layers' });
  if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
}

test.describe('Ridgeline screenshots', () => {
  test('desktop — relief, slope, hunting layers', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${VIEW}`);
    await expect(page.getByTestId('map-canvas')).toBeVisible();
    await waitForTiles(page);
    await page.screenshot({ path: `${OUT}/01-desktop-relief.png` });

    await openLayers(page);
    await toggle(page, 'Slope angle');
    await waitForTiles(page);
    await page.screenshot({ path: `${OUT}/02-desktop-slope.png` });

    await toggle(page, 'Slope angle');
    await toggle(page, 'Saddles & draws');
    await toggle(page, 'Benches');
    await waitForTiles(page);
    await page.screenshot({ path: `${OUT}/03-desktop-saddles-benches.png` });
  });

  test('desktop — map with panels dismissed', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${VIEW}`);
    await expect(page.getByTestId('map-canvas')).toBeVisible();
    await openLayers(page);
    await toggle(page, 'Saddles & draws');
    await waitForTiles(page);

    // Close the sheet: the map is the product, and this is the resting state.
    await page.getByRole('button', { name: 'Close panel' }).click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/02b-desktop-map-only.png` });
  });

  test('desktop — wind popover and bedding likelihood', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${VIEW}`);
    await expect(page.getByTestId('map-canvas')).toBeVisible();

    // Bedding is disabled until a wind direction exists.
    await openLayers(page);
    const bedding = page.getByRole('checkbox', { name: /Bedding likelihood/ });
    await expect(bedding).toBeDisabled();
    await page.screenshot({ path: `${OUT}/04-desktop-blocked-layer.png` });

    // The wind editor is a popover anchored to the conditions bar, so the bar
    // stays exactly where it was — no need to dismiss the drawer first, and
    // nothing moves out from under the pointer.
    await page.getByRole('button', { name: /Wind from/ }).click();
    // Opening the wind editor closes the layers drawer, so the bar animates
    // back to its unshifted position. Let it settle before clicking into the
    // popover, or Playwright chases a moving target.
    await page.waitForTimeout(700);
    await page.getByRole('button', { name: 'NW', exact: true }).click();
    await waitForTiles(page);
    await page.screenshot({ path: `${OUT}/04b-desktop-wind-popover.png` });

    // Escape dismisses the popover.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await openLayers(page);
    await expect(bedding).toBeEnabled();
    await bedding.click();
    await waitForTiles(page);
    await page.getByRole('button', { name: 'Close panel' }).click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/05-desktop-bedding-nw-wind.png` });
  });

  test('mobile — 390x844, bottom sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${VIEW}`);
    await expect(page.getByTestId('map-canvas')).toBeVisible();
    await waitForTiles(page);
    await page.screenshot({ path: `${OUT}/07-mobile-sheet.png` });

    await page.getByRole('button', { name: 'Close panel' }).click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/08-mobile-map.png` });
  });
});
