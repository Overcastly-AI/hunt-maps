/**
 * The browser-side network relay every e2e run gets by default (BACKLOG R76).
 *
 * ## The failure this exists to end
 *
 * Chromium in this sandbox cannot reach the internet *at all*. Not "cannot
 * verify the proxy's certificate" — the connection is reset before TLS even
 * matters, with or without `--proxy-server` and with or without
 * `ignoreHTTPSErrors`. Measured, not assumed:
 *
 *   no proxy                  -> net::ERR_CONNECTION_RESET
 *   --proxy-server=$HTTPS_PROXY -> net::ERR_CONNECTION_RESET
 *   ... + ignoreHTTPSErrors   -> net::ERR_CONNECTION_RESET
 *   Node (`route.fetch`)      -> 200, 89229 bytes
 *
 * So every DEM tile request died inside the browser while `curl` to the same
 * URL worked, and *every* rendering test in this suite has been measuring an
 * empty map. That is not a harness annoyance: a blank layer is indistinguishable
 * from a broken layer, so the suite could not tell "no tiles because the harness
 * is broken" from "no tiles because we shipped a bug" — which is exactly how a
 * P0 (every Docker image built with an empty `VITE_DEM_TEMPLATE`, so
 * `demTileUrl()` returned `""` and no terrain layer could ever render) survived
 * for months with 330 green web tests. Fixed in `454c8f2`; found by the founder
 * opening the app.
 *
 * ## Why interception rather than pointing the app at `tools/dem-relay.mjs`
 *
 * `VITE_DEM_TEMPLATE` is inlined by Vite at **build** time, so aiming the app
 * at the local relay means rebuilding the bundle with a test-only DEM URL. That
 * has two costs, and the second one is disqualifying:
 *
 *  1. `vite preview` serves `dist/`, and `reuseExistingServer` will happily
 *     reuse a preview of a different build — the stale-bundle trap.
 *  2. A harness that *rewrites the app's DEM template* can never catch a broken
 *     DEM template. The empty-template P0 would still be invisible.
 *
 * This relay only fixes the transport. The app resolves its own tile URLs
 * exactly as it does in production; if that resolution is broken (empty
 * template, missing `{z}/{x}/{y}`, wrong host) no request ever matches the DEM
 * pattern here and `assertDemPipelineHealthy` fails the run. Node performs the
 * fetch because Node — unlike Chromium here — trusts the sandbox CA
 * (`NODE_EXTRA_CA_CERTS`) and honours `HTTPS_PROXY`.
 *
 * On a developer's machine with real internet this is a transparent
 * pass-through with a disk cache: `route.fetch()` performs the ordinary
 * request, and upstream headers (crucially `Access-Control-Allow-Origin`, which
 * the terrain protocol needs to read tile pixels back off a canvas) are
 * forwarded verbatim.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext, Route } from '@playwright/test';

/**
 * How a DEM tile request is recognised on the wire.
 *
 * Deliberately matched against the *known elevation host and path*, not against
 * whatever the app happens to request: if someone changes the DEM source
 * without updating this, the preflight fails with "no DEM tile requests seen",
 * which is a loud, accurate complaint rather than a silent pass. Override with
 * `E2E_DEM_URL_PATTERN` when pointing the app at a different elevation source.
 */
export const DEM_URL_PATTERN = new RegExp(
  process.env.E2E_DEM_URL_PATTERN ?? 'elevation-tiles-prod|/terrarium/',
  'i',
);

/**
 * The other half of the DEM story since `9e781ab`: `DEM_SOURCES` in
 * `apps/web/src/lib/map/demSource.ts` now offers two USGS 3DEP sources served
 * by our own API (`/api/terrain/dem/<source>/{z}/{x}/{y}.png`), which are
 * *same-origin* and therefore never touch the relay.
 *
 * They are still elevation, so they are still counted. Without this, the day
 * someone switches the default source (or a spec picks 3DEP in the source
 * picker `map-builder` is building) the preflight would see zero matching
 * requests and accuse the product of having no DEM template at all — a
 * confidently wrong diagnosis, which is the one thing a gate like this must
 * never produce.
 */
export const API_DEM_URL_PATTERN = /\/api\/terrain\/dem\//i;

/** Requests to these are the app's own origin and must not be relayed. */
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;

/** Shared with `tools/dem-relay.mjs`'s cache in spirit, separate on disk. */
const CACHE_DIR = process.env.E2E_TILE_CACHE_DIR ?? join(tmpdir(), 'ridgeline-e2e-tiles');

export interface TileTraffic {
  /** Every off-origin request the page made, by host, with status counts. */
  byHost: Map<string, Map<string, number>>;
  /** Requests whose URL matched `DEM_URL_PATTERN`. */
  demRequested: number;
  /** ...of those, how many came back 2xx with a non-trivial body. */
  demOk: number;
  /** ...and how many failed (non-2xx, threw, or an implausibly small body). */
  demFailed: number;
  /** Total DEM bytes delivered to the browser this test, over `demBytesSampled`
   * responses. Only relayed (off-origin) tiles are weighed — a same-origin 3DEP
   * tile from our own API never passes through the relay's hands. */
  demBytes: number;
  demBytesSampled: number;
  /** First DEM failure, verbatim, for the error message. */
  firstDemFailure: string | null;
  /**
   * Non-navigation requests the page made *to its own document URL*.
   *
   * This is the empty-`VITE_DEM_TEMPLATE` fingerprint. `demTileUrl()` returns
   * `""` for every tile, `fetch("")` resolves relative to the current document,
   * and the app cheerfully downloads its own `index.html` where a PNG should
   * be — 200 OK, no exception thrown, no elevation anywhere.
   */
  selfFetches: number;
  /** Set by the patched `context.setOffline`; relayed requests respect it. */
  offline: boolean;
}

function emptyTraffic(): TileTraffic {
  return {
    byHost: new Map(),
    demRequested: 0,
    demOk: 0,
    demFailed: 0,
    demBytes: 0,
    demBytesSampled: 0,
    firstDemFailure: null,
    selfFetches: 0,
    offline: false,
  };
}

function record(traffic: TileTraffic, host: string, outcome: string): void {
  const forHost = traffic.byHost.get(host) ?? new Map<string, number>();
  forHost.set(outcome, (forHost.get(outcome) ?? 0) + 1);
  traffic.byHost.set(host, forHost);
}

interface CachedResponse {
  status: number;
  contentType: string;
  allowOrigin: string | null;
  bodyBase64: string;
}

function cachePath(url: string): string {
  return join(CACHE_DIR, `${createHash('sha1').update(url).digest('hex')}.json`);
}

function readCache(url: string): CachedResponse | null {
  const file = cachePath(url);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as CachedResponse;
  } catch {
    // A truncated cache entry is not worth a test failure — refetch instead.
    return null;
  }
}

function writeCache(url: string, entry: CachedResponse): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cachePath(url), JSON.stringify(entry));
  } catch {
    // Caching is an optimisation. Losing it must never fail a test.
  }
}

/**
 * A DEM tile smaller than this is not elevation.
 *
 * A terrarium tile is tens of kB; an error page, a redirect stub or the app's
 * own `index.html` is under a kB. The size check is what stops "the server
 * answered 200" from being mistaken for "elevation arrived" — the empty-
 * template bug produced exactly that: a 200 response containing HTML.
 */
const MIN_PLAUSIBLE_DEM_BYTES = 2048;

/**
 * Route every off-origin request through Node, and report what happened.
 *
 * Returns the live traffic record — read it *after* the page has settled.
 */
export function attachTileRelay(context: BrowserContext): TileTraffic {
  const traffic = emptyTraffic();

  // `context.setOffline(true)` emulates offline inside the browser's network
  // stack, but interception happens before that stack, so a relayed request
  // would keep succeeding and quietly make every offline test vacuous — the
  // suite would "prove" the no-signal path works while the tiles were being
  // handed to it over a wire. Track the flag and abort instead.
  const patchable = context as BrowserContext & {
    setOffline: (offline: boolean) => Promise<void>;
  };
  const setOffline = patchable.setOffline.bind(context);
  patchable.setOffline = async (offline: boolean): Promise<void> => {
    traffic.offline = offline;
    await setOffline(offline);
  };

  // Same-origin elevation (the 3DEP sources our own API serves) never reaches
  // the route handler's relay branch, so it is counted here instead. Status
  // only: reading the body of an arbitrary response mid-navigation is racy, and
  // a byte count is a nice-to-have where "did elevation arrive" is the point.
  context.on('response', (response) => {
    if (!API_DEM_URL_PATTERN.test(response.url())) return;
    traffic.demRequested++;
    if (response.ok()) traffic.demOk++;
    else {
      traffic.demFailed++;
      traffic.firstDemFailure ??= `${response.url()} -> HTTP ${response.status()} from our own API`;
    }
  });

  void context.route('**/*', async (route: Route) => {
    const request = route.request();
    const url = request.url();

    if (LOCAL_ORIGIN.test(url)) {
      // Same-origin: the app shell, the API, the `ridgeline://` protocol's own
      // traffic. Left entirely alone — but counted, because a *fetch* for the
      // document URL is the empty-DEM-template fingerprint (see `selfFetches`).
      // `request.frame()` *throws* for service-worker-initiated requests rather
      // than returning null (and this app registers a service worker, so those
      // are routed here too), which is why this asks first.
      const frameUrl = request.serviceWorker() ? '' : request.frame().url();
      const sameAsDocument = frameUrl !== '' && frameUrl.split('#')[0] === url.split('#')[0];
      if (sameAsDocument && request.resourceType() !== 'document') traffic.selfFetches++;
      await route.fallback();
      return;
    }

    const isDem = DEM_URL_PATTERN.test(url);
    if (isDem) traffic.demRequested++;
    const host = new URL(url).host;

    if (traffic.offline) {
      record(traffic, host, 'offline');
      if (isDem) {
        traffic.demFailed++;
        traffic.firstDemFailure ??= `${url} — context is offline (this is expected inside an offline test)`;
      }
      await route.abort('internetdisconnected');
      return;
    }

    const cached = readCache(url);
    if (cached) {
      record(traffic, host, `${cached.status} (cache)`);
      const body = Buffer.from(cached.bodyBase64, 'base64');
      if (isDem) {
        traffic.demOk++;
        traffic.demBytes += body.byteLength;
        traffic.demBytesSampled++;
      }
      await route.fulfill({
        status: cached.status,
        contentType: cached.contentType,
        headers: cached.allowOrigin ? { 'access-control-allow-origin': cached.allowOrigin } : {},
        body,
      });
      return;
    }

    try {
      // `maxRetries` covers the proxy's occasional reset; without it a single
      // flaky tile shows up as a missing patch of terrain, which is the one
      // symptom this whole file exists to make impossible to misread.
      const response = await route.fetch({ timeout: 45_000, maxRetries: 2 });
      const body = await response.body();
      record(traffic, host, String(response.status()));

      if (isDem) {
        if (response.ok() && body.byteLength >= MIN_PLAUSIBLE_DEM_BYTES) {
          traffic.demOk++;
          traffic.demBytes += body.byteLength;
          traffic.demBytesSampled++;
        } else {
          traffic.demFailed++;
          traffic.firstDemFailure ??=
            `${url} -> HTTP ${response.status()}, ${body.byteLength} bytes ` +
            `(a real terrarium tile is tens of kB)`;
        }
      }

      if (response.ok() && body.byteLength > 0 && body.byteLength < 8 * 1024 * 1024) {
        writeCache(url, {
          status: response.status(),
          contentType: response.headers()['content-type'] ?? 'application/octet-stream',
          allowOrigin: response.headers()['access-control-allow-origin'] ?? null,
          bodyBase64: body.toString('base64'),
        });
      }

      await route.fulfill({ response, body });
    } catch (error) {
      record(traffic, host, 'threw');
      if (isDem) {
        traffic.demFailed++;
        traffic.firstDemFailure ??= `${url} -> ${String(error).split('\n')[0]}`;
      }
      await route.abort('failed');
    }
  });

  return traffic;
}

/** One-line-per-host summary, for failure messages. */
export function describeTraffic(traffic: TileTraffic): string {
  if (traffic.byHost.size === 0) return '    (the page made no off-origin requests at all)';
  return [...traffic.byHost.entries()]
    .map(
      ([host, outcomes]) =>
        `    ${host}: ` +
        [...outcomes.entries()].map(([outcome, n]) => `${outcome} x${n}`).join(', '),
    )
    .join('\n');
}
