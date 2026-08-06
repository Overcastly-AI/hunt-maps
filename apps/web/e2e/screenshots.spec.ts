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

test.describe('Ridgeline screenshots', () => {
  test('desktop — relief, slope, hunting layers', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${VIEW}`);
    await expect(page.getByTestId('map-canvas')).toBeVisible();

    // Default view: satellite + multi-directional LiDAR relief.
    await waitForTiles(page);
    await page.screenshot({ path: `${OUT}/01-desktop-relief.png` });

    // Slope-angle bands.
    await toggle(page, 'Slope angle');
    await waitForTiles(page);
    await page.screenshot({ path: `${OUT}/02-desktop-slope.png` });

    // Saddles + benches stacked over relief.
    await toggle(page, 'Slope angle');
    await toggle(page, 'Saddles & draws');
    await toggle(page, 'Benches');
    await waitForTiles(page);
    await page.screenshot({ path: `${OUT}/03-desktop-saddles-benches.png` });
  });

  test('desktop — wind set, bedding likelihood unlocked', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${VIEW}`);
    await expect(page.getByTestId('map-canvas')).toBeVisible();

    // Bedding is disabled until a wind direction exists — the design system
    // enforces "say when you do not know" rather than rendering a default.
    const bedding = page.getByRole('checkbox', { name: /Bedding likelihood/ });
    await expect(bedding).toBeDisabled();
    await page.screenshot({ path: `${OUT}/04-desktop-blocked-layer.png` });

    // Set a NW wind, which unlocks it.
    const wind = page.getByLabel(/Wind direction in degrees/);
    await wind.fill('315');
    await wind.dispatchEvent('change');
    await expect(bedding).toBeEnabled();

    await bedding.click();
    await waitForTiles(page);
    await page.screenshot({ path: `${OUT}/05-desktop-bedding-nw-wind.png` });
  });

  test('desktop — saved terrain filters', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${VIEW}`);
    await expect(page.getByTestId('map-canvas')).toBeVisible();

    await page.getByRole('checkbox', { name: /Saddles & crossings/ }).click();
    await page.getByRole('checkbox', { name: /Midslope drainages/ }).click();
    await waitForTiles(page);

    // Scroll the panel to the saved-filter section for the capture.
    await page.getByText('Saved filters').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/06-desktop-saved-filters.png` });
  });

  test('mobile — 390x844, panel as bottom sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${VIEW}`);
    await expect(page.getByTestId('map-canvas')).toBeVisible();
    await waitForTiles(page);
    await page.screenshot({ path: `${OUT}/07-mobile-default.png` });

    await toggle(page, 'Saddles & draws');
    await waitForTiles(page);
    await page.screenshot({ path: `${OUT}/08-mobile-saddles.png` });

    // The layer list scrolled down — this is the one-handed reach case.
    await page.getByText('Hunting layers').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/09-mobile-panel.png` });
  });
});
