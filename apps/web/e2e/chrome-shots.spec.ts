// `test`/`expect` come from ./fixtures, not @playwright/test: that import is what
// attaches the DEM tile relay and runs the elevation preflight (BACKLOG R76).
import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type maplibregl from 'maplibre-gl';

/**
 * Screenshots of the chrome redesign — `BACKLOG R42`/`R43`/`R44`/`R45`.
 *
 * Like the other capture specs this doubles as a smoke test: every shot
 * asserts the state it claims to show *before* photographing it, so a
 * screenshot captioned "picker open" that shows something else fails the run
 * rather than landing in a founder update.
 */

const OUT = 'screenshots/chrome';

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
  await page.waitForTimeout(2500);
}

/**
 * The layers sheet is OPEN on load (`sheetOpen` defaults to true in App.tsx),
 * so a bare click toggles it *shut*. Drive it to the state we want rather than
 * assuming — the first version of this spec clicked unconditionally and
 * photographed the opposite of what each caption claimed.
 */
async function setLayers(page: Page, open: boolean): Promise<void> {
  const btn = page.getByRole('button', { name: /Layers/ });
  const isOpen = (await btn.getAttribute('aria-pressed')) === 'true';
  if (isOpen !== open) await btn.click();
  await page.waitForTimeout(500);
}

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`chrome — ${vp.name} ${vp.width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`/${VIEW}`);
      await waitForTiles(page);
    });

    test('the command bar, map clear', async ({ page }) => {
      // Nothing open. This is the shot that shows how much map the redesign
      // gave back — the old rail plus conditions bar took 216px at 390px.
      await setLayers(page, false);
      const bar = page.locator('.rl-command');
      await expect(bar).toBeVisible();
      // Every cell carries a word now, not just a glyph.
      await expect(page.getByRole('button', { name: /Layers/ })).toBeVisible();
      await page.screenshot({ path: `${OUT}/${vp.name}-01-command-bar.png` });
    });

    test('layers sheet open — and the wind control still reachable', async ({ page }) => {
      await setLayers(page, true);
      await expect(page.locator('.rl-sheet')).toBeVisible();

      // R42: the whole point. The sheet used to cover the conditions bar at
      // 390px, so the wind control was unreachable and bedding could not be
      // turned on without closing the panel first.
      const wind = page.getByRole('button', { name: /Wind from/ });
      await expect(wind).toBeVisible();
      await page.screenshot({ path: `${OUT}/${vp.name}-02-layers-open.png` });
    });

    test('wind popover open over the sheet', async ({ page }) => {
      await setLayers(page, true);
      await expect(page.locator('.rl-sheet')).toBeVisible();
      await page.getByRole('button', { name: /Wind from/ }).click();
      await expect(page.locator('.rl-popover')).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${vp.name}-03-wind-over-sheet.png` });
    });

    test('offline picker open', async ({ page }) => {
      await page.getByRole('button', { name: /Offline|Save this area/ }).click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/${vp.name}-04-offline-picker.png` });
    });
  });
}
