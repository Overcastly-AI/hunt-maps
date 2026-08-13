// `test`/`expect` come from ./fixtures, not @playwright/test: that import is what
// attaches the DEM tile relay and runs the elevation preflight (BACKLOG R76).
import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type maplibregl from 'maplibre-gl';

/**
 * Screenshot capture for founder updates and design review.
 *
 * Doubles as a real smoke test: it drives the actual built artifact, waits for
 * on-device terrain analysis to produce tiles, and fails if a layer never
 * renders. A screenshot run that passes proves the DEM fetch → worker →
 * OffscreenCanvas → MapLibre pipeline works end to end in a real browser, which
 * no unit test in this repo covers.
 *
 * Desktop shots exercise `DesktopRail.tsx` (Direction C, the founder's pick
 * off three chrome directions, 2026-08-11) — a permanent rail with no open/
 * close toggle, so there is no `setLayers`-style helper here for desktop;
 * every layer chip is just clicked directly by its accessible name, which is
 * unchanged from the mobile sheet (`LayerChip`/`ToggleRow` both render a real
 * `<input type="checkbox">` under that name).
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

test.describe('Ridgeline screenshots — desktop (thin dense rail, Direction C)', () => {
  test('desktop — relief, slope, hunting layers', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${VIEW}`);
    await expect(page.getByTestId('map-canvas')).toBeVisible();
    await waitForTiles(page);
    // The wide desktop view, chrome and all — the rail is permanent, so this
    // *is* the resting state, not a "panels dismissed" variant of it.
    await page.screenshot({ path: `${OUT}/01-desktop-relief.png` });

    await toggle(page, 'Slope angle');
    await waitForTiles(page);
    await page.screenshot({ path: `${OUT}/02-desktop-slope.png` });

    await toggle(page, 'Slope angle');
    await toggle(page, 'Saddles & draws');
    await toggle(page, 'Benches');
    await waitForTiles(page);
    await page.screenshot({ path: `${OUT}/03-desktop-saddles-benches.png` });
  });

  test('desktop — wind popover and bedding likelihood', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${VIEW}`);
    await expect(page.getByTestId('map-canvas')).toBeVisible();

    // Bedding is disabled until a wind direction exists.
    const bedding = page.getByRole('checkbox', { name: /Bedding likelihood/ });
    await expect(bedding).toBeDisabled();
    await page.screenshot({ path: `${OUT}/04-desktop-blocked-layer.png` });

    // The wind editor is a popover anchored to the rail's own Wind row, opening
    // leftward (`align="end"`) so it never runs off the right edge of the
    // screen. Nothing else in the rail moves when it opens.
    await page.getByRole('button', { name: /Wind from/ }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'NW', exact: true }).click();
    await waitForTiles(page);
    await page.screenshot({ path: `${OUT}/04b-desktop-wind-popover.png` });

    // Escape dismisses the popover.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await expect(bedding).toBeEnabled();
    await bedding.click();
    await waitForTiles(page);
    await page.screenshot({ path: `${OUT}/05-desktop-bedding-nw-wind.png` });
  });
});

test.describe('Ridgeline screenshots — mobile (bottom sheet, unchanged)', () => {
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
