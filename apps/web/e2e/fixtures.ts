/**
 * The `test` every spec in this suite imports (BACKLOG R76).
 *
 * Two things happen here that nothing in a spec should have to remember:
 *
 *  1. **Every browser context gets the tile relay.** Chromium in this sandbox
 *     cannot reach the internet, so without it every DEM fetch dies inside the
 *     browser and every rendering test measures an empty map. See
 *     `helpers/tile-relay.ts` for the measurements behind that claim.
 *  2. **Every worker runs the DEM preflight first.** If elevation cannot reach
 *     the browser, the run stops with a diagnosis instead of producing a
 *     suite-wide field of blank-canvas results that look like a product defect.
 *
 * Specs import `{ test, expect }` from here instead of `@playwright/test`. That
 * import is the whole opt-in: a spec that forgets it silently loses both
 * guarantees, which is why there is an invariant asserting no spec does
 * (`dem-integrity.spec.ts`).
 */

import { test as base, expect } from '@playwright/test';
import { assertDemPipelineHealthy } from './helpers/dem-preflight';
import { attachTileRelay, type TileTraffic } from './helpers/tile-relay';

export interface RidgelineFixtures {
  /** Live record of what the page fetched off-origin. Read after settling. */
  tileTraffic: TileTraffic;
}

export interface RidgelineWorkerFixtures {
  /** Runs once per worker, before the first test. Throws to fail the run. */
  demPreflight: void;
}

const trafficByContext = new WeakMap<object, TileTraffic>();

export const test = base.extend<RidgelineFixtures, RidgelineWorkerFixtures>({
  demPreflight: [
    async ({ browser }, use, workerInfo) => {
      const baseURL = workerInfo.project.use.baseURL;
      if (!baseURL) throw new Error('DEM preflight: no baseURL configured for this project.');
      // `config.rootDir` is the directory holding playwright.config.ts, which is
      // where `dist/` lives — used for the stale-preview-server check.
      const { summary } = await assertDemPipelineHealthy(
        browser,
        baseURL,
        workerInfo.config.rootDir,
      );
      // eslint-disable-next-line no-console
      console.log(`[R76] ${summary}`);
      await use();
    },
    { scope: 'worker', auto: true },
  ],

  context: async ({ context }, use) => {
    trafficByContext.set(context, attachTileRelay(context));
    await use(context);
  },

  tileTraffic: async ({ context }, use) => {
    const traffic = trafficByContext.get(context);
    if (!traffic) throw new Error('Tile relay was not attached to this context.');
    await use(traffic);
  },
});

export { expect };
