import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

/**
 * The sandbox ships Chromium 1194 but this Playwright expects a newer build, so
 * point at the pre-installed binary rather than downloading one
 * (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` is set in that environment). Guarded by an
 * existence check so the same config still works on a machine with Playwright's
 * own browsers installed — `pnpm --filter @hunt-maps/web test:e2e` has to work
 * with no special setup, everywhere.
 */
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: {
      ...(existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {}),
      // The terrain protocol reads back from the GL framebuffer to detect when
      // analysis tiles have actually painted; without swiftshader there is no
      // GL at all in a headless sandbox.
      args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
      // Software GL is slow; give the analysis worker room.
      timeout: 120_000,
    },
    deviceScaleFactor: 2,
  },
  webServer: {
    command: 'pnpm exec vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    // A preview server left running from an *earlier build* is reused silently,
    // and `vite preview` serves `dist/` — so the suite would report on code that
    // is no longer in the tree. That trap has cost a real investigation before,
    // so the DEM preflight (`e2e/helpers/dem-preflight.ts`) compares the asset
    // hashes the server returns against `dist/index.html` and fails the run with
    // instructions if they differ, rather than leaving the tell to be
    // "the suite finished suspiciously fast".
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

/**
 * ## Why there is no proxy or CA configuration here (BACKLOG R76)
 *
 * The obvious fix for "Chromium cannot fetch DEM tiles in this sandbox" is to
 * hand Chromium the egress proxy and the CA it does not trust. Measured, that
 * does not work — the connection is reset before certificates are even reached:
 *
 *   no proxy                                -> net::ERR_CONNECTION_RESET
 *   proxy: $HTTPS_PROXY                     -> net::ERR_CONNECTION_RESET
 *   proxy: $HTTPS_PROXY + ignoreHTTPSErrors -> net::ERR_CONNECTION_RESET
 *   the same URL from Node (`route.fetch`)  -> 200, 89229 bytes
 *
 * The other obvious fix is to point the app at `tools/dem-relay.mjs` by building
 * with `VITE_DEM_TEMPLATE=http://localhost:8099/{z}/{x}/{y}.png`. That works,
 * but Vite inlines the value at build time, so it means the suite would only
 * ever test a bundle whose DEM URL the harness supplied — and a harness that
 * rewrites the app's DEM template can never catch a broken DEM template. That
 * is exactly the P0 fixed in `454c8f2`.
 *
 * So the transport is fixed, and only the transport: `e2e/fixtures.ts` attaches
 * `e2e/helpers/tile-relay.ts` to every browser context, which performs
 * off-origin requests from Node (which does trust the CA, via
 * `NODE_EXTRA_CA_CERTS`) and returns them to the page with the upstream headers
 * intact. The app resolves its own tile URLs exactly as it does in production;
 * if that resolution is broken, no request matches and the preflight fails the
 * run with the diagnosis.
 */
