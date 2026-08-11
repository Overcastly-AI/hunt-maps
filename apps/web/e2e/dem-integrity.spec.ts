/**
 * DEM integrity — the invariants that would have caught the empty-template P0
 * (BACKLOG R76, commit 454c8f2).
 *
 * ## The bug these exist for
 *
 * Every Docker image ever built declared `ARG VITE_DEM_TEMPLATE=""`, so
 * `demTileUrl()` returned `""`, no elevation ever loaded, and hillshade, slope,
 * aspect, landform, bedding and corridors all rendered blank. Nothing threw.
 * 330 web tests were green. The founder found it by opening the app.
 *
 * Two separate blind spots let that happen, and both are closed here:
 *
 *  1. **The harness was measuring an empty map anyway.** Chromium cannot reach
 *     the network in this sandbox, so DEM fetches died inside the browser and
 *     every rendering test had been looking at a blank canvas — a blank layer
 *     was indistinguishable from a broken layer. `helpers/tile-relay.ts` fixes
 *     the transport; `helpers/dem-preflight.ts` fails the whole run the moment
 *     elevation stops arriving, so the suite can never quietly go back to
 *     measuring nothing.
 *  2. **Nothing asserted that terrain actually paints.** Existence assertions
 *     (`the canvas is visible`, `the checkbox is checked`, `the worker returned
 *     a buffer`) are all true on a build with no elevation whatsoever. The tests
 *     below assert rendered pixels against real elevation instead: toggling a
 *     terrain layer must change a large fraction of the map, the change must
 *     vary across the frame the way ridges and draws do, and the slope ramp must
 *     land in several distinct colour bands.
 *
 * Non-vacuity is proven, not argued: built with `VITE_DEM_TEMPLATE=""` — the
 * exact broken configuration — these fail, and the numbers they print are
 * ~0 against ~90 for a healthy build. See the thresholds' comments.
 */

import { expect, test } from './fixtures';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Page } from '@playwright/test';
import { DESKTOP, MOBILE, VIEW, waitForTiles } from './helpers/settle';
import {
  captureTerrainFrame,
  distinctHueBands,
  frameDelta,
  type Rect,
  type TerrainFrame,
} from './helpers/terrain-pixels';

/**
 * The patch of map every measurement below uses: the top-right of the canvas.
 *
 * One rule that works on both viewports without branching. The layers panel is
 * a left drawer on desktop and a bottom sheet on mobile, so the top-right
 * quadrant is map on both, whether or not a panel is open — which keeps the
 * measurement about terrain rather than about chrome that happened to be over
 * it. The rail buttons live bottom-left and the zoom controls top-right corner,
 * so the rect stops short of the right edge too.
 */
async function mapPatch(page: Page): Promise<Rect> {
  const box = await page.getByTestId('map-canvas').boundingBox();
  if (!box) throw new Error('The map canvas has no bounding box — did the map mount at all?');
  return {
    x: box.x + box.width * 0.4,
    y: box.y + box.height * 0.08,
    width: box.width * 0.5,
    height: box.height * 0.37,
  };
}

/**
 * Capture frames until the pixels stop moving.
 *
 * Not a fixed sleep: on-device analysis under swiftshader takes as long as it
 * takes, and a clock either races a slow machine (producing a false "painted
 * nothing", which is indistinguishable from the real regression this file
 * hunts) or wastes a minute on a fast one. If the layer never paints, two
 * identical flat reads end this immediately — a genuinely broken build still
 * fails fast.
 */
async function settledFrame(page: Page, rect: Rect): Promise<TerrainFrame> {
  const deadline = Date.now() + 120_000;
  let previous = await captureTerrainFrame(page, rect);
  let quiet = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    const next = await captureTerrainFrame(page, rect);
    quiet = frameDelta(previous, next, 2).changedPct < 0.5 ? quiet + 1 : 0;
    previous = next;
    if (quiet >= 2) break;
  }
  return previous;
}

async function openLayers(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Layers' });
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
}

async function closeLayers(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: 'Close panel' });
  if (await close.isVisible()) await close.click();
  await page.waitForTimeout(600); // the sheet's own slide-out transition
}

async function toggleLayer(page: Page, label: string): Promise<void> {
  await openLayers(page);
  await page.getByRole('checkbox', { name: label, exact: false }).first().click();
  await waitForTiles(page);
  await closeLayers(page);
}

test.describe('DEM integrity — terrain layers paint real elevation', () => {
  // Real elevation, real on-device analysis, software GL: minutes, not seconds.
  test.setTimeout(900_000);

  for (const viewport of [DESKTOP, MOBILE]) {
    test(`${viewport.width}px — shaded relief paints elevation-shaped structure`, async ({
      page,
      tileTraffic,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/${VIEW}`);
      await page.getByTestId('map-canvas').waitFor({ state: 'visible' });
      await waitForTiles(page);
      await closeLayers(page);

      const rect = await mapPatch(page);
      const withRelief = await settledFrame(page, rect);

      // Toggling the layer off is what makes this independent of the basemap.
      // An absolute "the map looks interesting" metric passes on satellite
      // imagery alone while every terrain layer is blank; a differential can
      // only be large if the *terrain layer itself* put something on screen.
      await toggleLayer(page, 'Shaded relief');
      const withoutRelief = await settledFrame(page, rect);
      const delta = frameDelta(withRelief, withoutRelief);

      // eslint-disable-next-line no-console
      console.log(
        `[R76] ${viewport.width}px relief delta: changed ${delta.changedPct.toFixed(1)}% of cells, ` +
          `mean ${delta.meanAbs.toFixed(1)}, spread ${delta.stdev.toFixed(1)}; ` +
          `DEM tiles ok ${tileTraffic.demOk}, failed ${tileTraffic.demFailed}`,
      );

      // Measured: healthy build ~90-100% of cells change. Broken build
      // (VITE_DEM_TEMPLATE="") measures 0.0% — the layer paints nothing, so
      // toggling it does nothing. 40% is far below the real signal and far
      // above anything a stray tooltip or attribution repaint could produce.
      expect(
        delta.changedPct,
        `turning shaded relief off changed only ${delta.changedPct.toFixed(1)}% of the map — ` +
          'the layer is painting no elevation. That is the 454c8f2 failure: a canvas, a checked ' +
          'checkbox, and no DEM behind either.',
      ).toBeGreaterThan(40);

      // Structure, not a wash: shading follows ridges and draws, so the
      // per-cell change has a wide spread. A uniform tint over the viewport
      // would clear the differential above but not this.
      expect(
        delta.stdev,
        `the change was almost uniform (spread ${delta.stdev.toFixed(1)}) — that is a flat ` +
          'wash over the map, not relief computed from a DEM.',
      ).toBeGreaterThan(5);

      // And the network agrees with the pixels: elevation really was fetched.
      expect(tileTraffic.demOk, 'no DEM tile was delivered during this test').toBeGreaterThan(0);
      if (tileTraffic.demBytesSampled > 0) {
        // Only relayed (off-origin) tiles are weighed; a same-origin 3DEP tile
        // from our own API is counted but not measured, so this is conditional
        // rather than dishonestly averaging over responses it never saw.
        expect(
          tileTraffic.demBytes / tileTraffic.demBytesSampled,
          'DEM responses averaged under 2 kB — those are error pages, not elevation tiles',
        ).toBeGreaterThan(2048);
      }
    });
  }

  test('slope paints several ramp classes, because real ground has several', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`/${VIEW}`);
    await page.getByTestId('map-canvas').waitFor({ state: 'visible' });
    await waitForTiles(page);
    await closeLayers(page);

    const rect = await mapPatch(page);
    const beforeSlope = await settledFrame(page, rect);

    await toggleLayer(page, 'Slope angle');
    const withSlope = await settledFrame(page, rect);

    const bands = distinctHueBands(withSlope);
    const delta = frameDelta(beforeSlope, withSlope);
    // eslint-disable-next-line no-console
    console.log(
      `[R76] slope: saturated ${withSlope.saturatedPct.toFixed(1)}% (relief-only baseline ` +
        `${beforeSlope.saturatedPct.toFixed(1)}%), ${bands} hue bands, ` +
        `changed ${delta.changedPct.toFixed(1)}% of cells`,
    );

    // Measured: healthy build paints saturated colour over 77-82% of the patch;
    // the relief-only baseline is 0.00% because multi-directional hillshade is
    // grey (`max == min` at every pixel). Broken build: 0.00% either way. This
    // is `R32`'s invariant applied to the layer a hunter reaches for first.
    expect(
      withSlope.saturatedPct,
      `the slope ramp covered ${withSlope.saturatedPct.toFixed(2)}% of the map patch — ` +
        'a colour ramp that paints no colour means no elevation reached the engine.',
    ).toBeGreaterThan(20);

    // The honest part: several *distinct* bands, i.e. several slope classes. A
    // single flat fill — a constant surface, or a ramp collapsed onto one end
    // of its domain, which is exactly how `R32` shipped an invisible layer —
    // would clear a coverage threshold while telling a hunter nothing true
    // about the ground.
    //
    // Measured on this view: the `slope-flat` blue covers 64.4% of the patch
    // and the `slope-sidehill` teal 15.8%, with the warm bedding/steep/wall end
    // of the ramp under 1% each (this crop of Hocking Hills is mostly gentle
    // ground and sidehill). Both dominant bands sit an order of magnitude above
    // the 1%-of-patch cut, so the count is stable rather than marginal; a
    // broken build measures 0 bands.
    expect(
      bands,
      `the slope ramp landed in only ${bands} hue band(s) — real terrain at this view spans ` +
        'flat ground and sidehill travel grade at minimum, so fewer than two means the ramp ' +
        'is not reading real elevation.',
    ).toBeGreaterThanOrEqual(2);
  });
});

/**
 * The harness guarding the harness.
 *
 * The relay and the preflight only apply to specs that import `./fixtures`. A
 * new spec written against `@playwright/test` out of habit would silently opt
 * out of both, get no DEM tiles, and go green against a blank map — which is
 * precisely the failure R76 is about, reintroduced one file at a time.
 */
test('every spec opts into the DEM relay and preflight', async () => {
  // `test.info().file` rather than a cwd-relative path: the suite is run both
  // from `apps/web` and from the repo root via pnpm filters.
  const dir = dirname(test.info().file);
  const offenders = readdirSync(dir)
    .filter((f) => f.endsWith('.spec.ts'))
    .filter((f) => {
      const source = readFileSync(join(dir, f), 'utf8');
      return !/from '\.\/fixtures'/.test(source);
    });

  expect(
    offenders,
    `these specs import test/expect straight from @playwright/test, so they run without the ` +
      `tile relay and without the DEM preflight — every rendering assertion in them is ` +
      `measuring a blank map: ${offenders.join(', ')}`,
  ).toEqual([]);
});
