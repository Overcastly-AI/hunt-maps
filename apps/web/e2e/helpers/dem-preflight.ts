/**
 * The startup assertion: prove elevation actually reaches the browser before
 * a single invariant is allowed to measure anything (BACKLOG R76).
 *
 * ## Why this is the important half of R76
 *
 * The relay next door makes DEM tiles load. This makes the *absence* of DEM
 * tiles impossible to ignore. Those are different guarantees, and the second is
 * the one that was missing for months: with no elevation, every rendering test
 * in this suite measures an empty map, and an empty map is indistinguishable
 * from a broken product. When the founder reported "none of the layers are
 * working" the suite had nothing to say, because it had been looking at a blank
 * canvas the whole time and calling it green.
 *
 * So this runs once per worker, before any test, and it fails the entire run —
 * loudly, with the specific diagnosis — if the app cannot get elevation. A
 * broken harness now announces itself instead of being mistaken for a broken
 * product, and a broken product (an empty `VITE_DEM_TEMPLATE`, an unusable
 * template, a moved DEM host) fails here rather than being reported as a
 * suspiciously featureless screenshot.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from '@playwright/test';
import { attachTileRelay, describeTraffic, DEM_URL_PATTERN, type TileTraffic } from './tile-relay';

/** Hocking Hills, Ohio — the same view the rest of the suite uses. */
const PREFLIGHT_VIEW = '#14/39.4340/-82.5400';

const RELAY_HINT = [
  '  How elevation is supposed to reach the browser in this sandbox:',
  '    Chromium here cannot reach the internet at all (ERR_CONNECTION_RESET, with or',
  '    without --proxy-server), so e2e/helpers/tile-relay.ts intercepts every off-origin',
  '    request and performs it from Node, which does trust the sandbox CA',
  '    (NODE_EXTRA_CA_CERTS) and honours HTTPS_PROXY.',
  '    - Check both env vars are still set for the Playwright process.',
  '    - Sanity-check the upstream by hand:',
  '        curl -sI https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/4335/6317.png',
  '    - tools/dem-relay.mjs is the equivalent for a manual `vite preview` session.',
].join('\n');

/**
 * Fail if `vite preview` is serving a different build than `dist/` holds.
 *
 * `playwright.config.ts` sets `reuseExistingServer`, so a preview left running
 * from an earlier build is silently reused and the suite reports on code that
 * is no longer there. That trap has already cost one real investigation: a
 * bogus failure lands in 0.3-1.3 s where a real pass takes ~1.3 min, which is
 * the only tell. Comparing the asset hashes the server actually returns against
 * the ones on disk turns it into a sentence instead of a mystery.
 */
export function assertServedBundleIsFresh(html: string, rootDir: string): string | null {
  const distIndex = join(rootDir, 'dist', 'index.html');
  if (!existsSync(distIndex)) return null; // not serving a built bundle — nothing to compare

  const assets = (source: string): string[] =>
    [...source.matchAll(/\/assets\/[A-Za-z0-9._-]+\.(?:js|css)/g)].map((m) => m[0]).sort();

  const onDisk = assets(readFileSync(distIndex, 'utf8'));
  const served = assets(html);
  if (onDisk.length === 0 || onDisk.join() === served.join()) return null;

  return [
    'The preview server is serving a DIFFERENT build than apps/web/dist.',
    '',
    `  dist/index.html references: ${onDisk.join(', ') || '(none)'}`,
    `  the server returned:        ${served.join(', ') || '(none)'}`,
    '',
    '  playwright.config.ts sets `reuseExistingServer`, so a stale `vite preview` from an',
    '  earlier build was reused and every result below would describe code that is no longer',
    '  in the tree. Kill it and let Playwright start a fresh one:',
    '',
    '      pkill -f "vite preview" && pnpm --filter @hunt-maps/web test:e2e',
  ].join('\n');
}

export interface PreflightResult {
  traffic: TileTraffic;
  summary: string;
}

/**
 * Boot the real app in a real browser and prove the first DEM fetch succeeds.
 *
 * Throws with a diagnosis rather than a bare assertion, because the two
 * failures this catches have completely different owners: "the harness cannot
 * reach the network" is mine, "the app never asked for a tile" is the product's.
 */
export async function assertDemPipelineHealthy(
  browser: Browser,
  baseURL: string,
  rootDir: string,
): Promise<PreflightResult> {
  // One retry, because this gate fails the entire run and a gate that cries
  // wolf gets disabled by the third person who hits it. A single flaky page
  // load (Playwright restarts the worker — and relaunches the browser — after
  // any test failure, and the first load in a fresh browser is the one that
  // races) must not be reported as "the app never asked for a tile", which
  // reads as a product accusation. A genuinely broken build fails both
  // attempts, and the second costs a couple of seconds off the warm tile cache.
  try {
    return await preflightAttempt(browser, baseURL, rootDir);
  } catch (first) {
    const result = await preflightAttempt(browser, baseURL, rootDir).catch((second) => {
      throw new Error(
        `${String(second)}\n\nThis was the SECOND consecutive failure — the first said:\n` +
          `${String(first).split('\n').slice(0, 6).join('\n')}`,
      );
    });
    return { ...result, summary: `${result.summary} (passed on retry)` };
  }
}

async function preflightAttempt(
  browser: Browser,
  baseURL: string,
  rootDir: string,
): Promise<PreflightResult> {
  const context = await browser.newContext({
    baseURL,
    // Deliberately small and unscaled: this checks the network, not pixels, and
    // a smaller viewport asks for fewer tiles, so it costs seconds rather than
    // a minute on every run.
    viewport: { width: 900, height: 700 },
    deviceScaleFactor: 1,
  });
  const traffic = attachTileRelay(context);
  const page = await context.newPage();

  try {
    const response = await page.goto(`/${PREFLIGHT_VIEW}`, { timeout: 60_000 });
    if (!response || !response.ok()) {
      throw new Error(
        `DEM preflight: the app itself did not load from ${baseURL} ` +
          `(HTTP ${response ? response.status() : 'no response'}). Nothing below could have run.`,
      );
    }

    const stale = assertServedBundleIsFresh(await response.text(), rootDir);
    if (stale) throw new Error(`DEM preflight: ${stale}`);

    await page
      .getByTestId('map-canvas')
      .waitFor({ state: 'visible', timeout: 60_000 })
      .catch(() => {
        throw new Error(
          'DEM preflight: the map canvas never became visible, so no tile could have been ' +
            'requested. This is an app-boot failure, not a DEM failure — check the browser ' +
            'console for a crash in MapView before looking at elevation.',
        );
      });

    // Wait for elevation to actually arrive rather than for a clock: the app is
    // healthy the moment one real DEM tile has been delivered.
    //
    // The early exit matters as much as the budget. Once MapLibre reports every
    // source settled and ten seconds have passed with still no elevation, more
    // waiting cannot change the verdict — so a broken build fails in seconds
    // instead of burning 90 s per worker, while a slow-but-healthy one keeps
    // the full budget.
    const deadline = Date.now() + 90_000;
    let idleSince: number | null = null;
    while (traffic.demOk === 0 && Date.now() < deadline) {
      const idle = await page.evaluate(() => {
        const hook = (
          window as unknown as {
            __ridgeline?: { map?: { isStyleLoaded(): boolean; areTilesLoaded(): boolean } };
          }
        ).__ridgeline;
        return Boolean(hook?.map?.isStyleLoaded() && hook.map.areTilesLoaded());
      });
      if (!idle) idleSince = null;
      else {
        idleSince ??= Date.now();
        if (Date.now() - idleSince > 10_000) break;
      }
      await page.waitForTimeout(500);
    }

    if (traffic.demOk === 0) {
      throw new Error(demFailureMessage(traffic, baseURL));
    }

    const summary =
      `DEM preflight OK — ${traffic.demOk} elevation tiles, ` +
      `${(traffic.demBytes / 1024 / 1024).toFixed(2)} MB, relayed through Node ` +
      `(${traffic.demFailed} failed).`;
    return { traffic, summary };
  } finally {
    await context.close();
  }
}

function demFailureMessage(traffic: TileTraffic, baseURL: string): string {
  const lines: string[] = [
    '',
    '='.repeat(78),
    'DEM PREFLIGHT FAILED — no elevation tile ever reached the browser.',
    '='.repeat(78),
    '',
    'Every terrain layer in this app is computed on-device from DEM tiles, so with',
    'no elevation the map paints nothing and every rendering assertion below would',
    'be measuring a blank canvas. A blank canvas is indistinguishable from a broken',
    'product, so the run stops here rather than reporting green (BACKLOG R76).',
    '',
    `  app under test:       ${baseURL}`,
    `  DEM requests matched: ${traffic.demRequested}  (pattern ${DEM_URL_PATTERN})`,
    `  DEM requests OK:      ${traffic.demOk}`,
    `  DEM requests failed:  ${traffic.demFailed}`,
    `  first DEM failure:    ${traffic.firstDemFailure ?? '(none recorded)'}`,
    '  off-origin traffic:',
    describeTraffic(traffic),
    '',
  ];

  if (traffic.demRequested === 0) {
    lines.push(
      'DIAGNOSIS: the app never requested a DEM tile at all.',
      '',
      '  This is a PRODUCT failure, not a harness failure. The relay never saw a request',
      '  matching the DEM URL pattern, which means the bundle under test could not build a',
      '  tile URL in the first place.',
      '',
      `  Same-origin fetches of the app's own document URL: ${traffic.selfFetches}`,
      traffic.selfFetches > 0
        ? [
            '  ^ That is the fingerprint of an EMPTY DEM TEMPLATE. `demTileUrl()` returns "",',
            '    `fetch("")` resolves to the page itself, and the app downloads its own',
            '    index.html where a PNG should be: HTTP 200, nothing thrown, no elevation',
            '    anywhere, every terrain layer blank. That exact bug shipped in every Docker',
            '    image for months — see commit 454c8f2 and apps/web/src/lib/map/demSource.ts.',
          ].join('\n')
        : [
            '  ^ Zero does NOT rule out an empty template: `fetch("")` asks for the app shell,',
            '    and the service worker answers that from its precache without touching the',
            '    network, so the relay never sees it. Check demSource.ts and how',
            '    VITE_DEM_TEMPLATE was set at BUILD time regardless.',
          ].join('\n'),
      '',
      '  Remember Vite inlines import.meta.env at build time: rebuild after changing it.',
      '  Both shapes of elevation are watched for: the off-origin terrarium tiles',
      `  (${DEM_URL_PATTERN}) and the same-origin 3DEP tiles our own API serves`,
      '  (/api/terrain/dem/...). If the DEM source moved somewhere else again, update',
      '  DEM_URL_PATTERN in e2e/helpers/tile-relay.ts (or set E2E_DEM_URL_PATTERN).',
    );
  } else {
    lines.push(
      'DIAGNOSIS: the app asked for elevation and every request failed.',
      '',
      '  This is most likely a HARNESS or network failure, not a product bug.',
      '',
      RELAY_HINT,
    );
  }

  lines.push('', '='.repeat(78), '');
  return lines.join('\n');
}
