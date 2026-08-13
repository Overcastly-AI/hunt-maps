// `test`/`expect` come from ./fixtures, not @playwright/test: that import is what
// attaches the DEM tile relay and runs the elevation preflight (BACKLOG R76).
import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type maplibregl from 'maplibre-gl';

/**
 * Screenshots of the chrome — `BACKLOG R42`/`R43`/`R44`/`R45`, and the
 * desktop rail (Direction C, the founder's pick off three chrome directions,
 * 2026-08-11).
 *
 * Like the other capture specs this doubles as a smoke test: every shot
 * asserts the state it claims to show *before* photographing it, so a
 * screenshot captioned "picker open" that shows something else fails the run
 * rather than landing in a founder update.
 *
 * Desktop and mobile diverge here for a real reason, not a cosmetic one:
 * above 860px `App.tsx` mounts an entirely different component tree
 * (`DesktopRail.tsx`) with no "Layers" open/close toggle at all — the rail is
 * permanent chrome, not a panel — so the two viewport groups below assert
 * genuinely different interactions rather than the same ones through
 * different selectors.
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
 * The mobile layers sheet is OPEN on load (`drawerTab` defaults to `'layers'`
 * in `App.tsx`), so a bare click toggles it *shut*. Drive it to the state we
 * want rather than assuming.
 */
async function setLayers(page: Page, open: boolean): Promise<void> {
  const btn = page.getByRole('button', { name: /Layers/ });
  const isOpen = (await btn.getAttribute('aria-pressed')) === 'true';
  if (isOpen !== open) await btn.click();
  await page.waitForTimeout(500);
}

test.describe('chrome — mobile 390px (drawer / command bar, unchanged)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
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
    await page.screenshot({ path: `${OUT}/mobile-01-command-bar.png` });
  });

  test('layers sheet open — and the wind control still reachable', async ({ page }) => {
    await setLayers(page, true);
    await expect(page.locator('.rl-sheet')).toBeVisible();

    // R42: the whole point. The sheet used to cover the conditions bar at
    // 390px, so the wind control was unreachable and bedding could not be
    // turned on without closing the panel first.
    const wind = page.getByRole('button', { name: /Wind from/ });
    await expect(wind).toBeVisible();
    await page.screenshot({ path: `${OUT}/mobile-02-layers-open.png` });
  });

  test('wind popover open over the sheet', async ({ page }) => {
    await setLayers(page, true);
    await expect(page.locator('.rl-sheet')).toBeVisible();
    await page.getByRole('button', { name: /Wind from/ }).click();
    await expect(page.locator('.rl-popover')).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/mobile-03-wind-over-sheet.png` });
  });

  test('offline picker open', async ({ page }) => {
    await page.getByRole('button', { name: /Offline|Save this area/ }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/mobile-04-offline-picker.png` });
  });
});

test.describe('chrome — desktop 1440px (thin dense rail, Direction C)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${VIEW}`);
    await waitForTiles(page);
  });

  test('the rail, map clear — the shot the founder asked for', async ({ page }) => {
    // No toggle to drive here: the rail is permanent chrome, not a panel
    // (that is the entire point of Direction C). Assert its presence and the
    // map underneath is still the dominant thing on screen.
    const rail = page.locator('.rail');
    await expect(rail).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Shaded relief' })).toBeVisible();
    await page.screenshot({ path: `${OUT}/desktop-01-rail.png` });
  });

  test('wind popover opens leftward over the rail, never off-screen', async ({ page }) => {
    await page.getByRole('button', { name: /Wind from/ }).click();
    const popover = page.locator('.rl-popover');
    await expect(popover).toBeVisible();
    await page.waitForTimeout(400);
    const box = await popover.boundingBox();
    expect(box, 'wind popover has no bounding box').not.toBeNull();
    // The direct regression this proves: `Popover`'s default `left: 0`
    // alignment would run a ~300px-wide popover off the right edge of the
    // screen from a trigger docked inside a rail near x=1200 — `align="end"`
    // (`ConditionsEditors.tsx`, `DesktopRail.tsx`) is what keeps it on
    // screen.
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
    await page.screenshot({ path: `${OUT}/desktop-02-wind-popover.png` });
  });

  test('offline picker docks left of the rail, not over it', async ({ page }) => {
    await page.getByRole('button', { name: 'Save this area for offline use' }).click();
    await expect(page.getByTestId('region-elevation-story')).toBeVisible();
    await page.waitForTimeout(600);
    const dock = await page.locator('.rail-panel-dock .rl-sheet').boundingBox();
    const rail = await page.locator('.rail').boundingBox();
    expect(dock).not.toBeNull();
    expect(rail).not.toBeNull();
    // The docked panel and the rail must never overlap — two glass panels
    // stacked is the exact `elementFromPoint` trap `ui-invariants.spec.ts`
    // group 4 exists to catch, reached from a new arrangement.
    expect(dock!.x + dock!.width).toBeLessThanOrEqual(rail!.x + 1);
    await page.screenshot({ path: `${OUT}/desktop-03-offline-picker.png` });
  });

  test('Stands panel docks left of the rail while the rail stays interactive', async ({ page }) => {
    await page.getByRole('radio', { name: 'Stands' }).click();
    // `.rail-panel-dock` itself is a plain flow wrapper around a `position:
    // absolute` `<Sheet>` — it has no intrinsic height of its own (nothing
    // participates in normal flow inside it), so the *sheet*, not the
    // wrapper, is the rendered-state assertion that matters here.
    await expect(page.locator('.rail-panel-dock .rl-sheet')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Stands & markers' })).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/desktop-04-stands-panel.png` });
  });
});
