// Minimal local DEM relay, for looking at the real app by hand inside a sandbox
// whose network Chromium cannot reach.
//
// Chromium here cannot reach the internet at all — measured, not assumed:
// ERR_CONNECTION_RESET with no proxy, with `--proxy-server=$HTTPS_PROXY`, and
// with `ignoreHTTPSErrors` on top; the same URL from Node returns 200. So
// browser-side fetches of the DEM host die and every terrain layer renders
// empty, which looks like a broken analysis engine rather than a broken
// network. Node *does* trust the egress CA (NODE_EXTRA_CA_CERTS), so this
// relays through Node over plain HTTP on localhost. Same shape as the API's
// DemService, and it exercises the VITE_DEM_TEMPLATE override the app already
// supports rather than adding a test-only code path.
//
// ## THE PLAYWRIGHT SUITE NO LONGER NEEDS THIS (BACKLOG R76)
//
// `apps/web/e2e/fixtures.ts` attaches `e2e/helpers/tile-relay.ts` to every
// browser context, which performs off-origin requests from Node and hands them
// back to the page. `pnpm --filter @hunt-maps/web test:e2e` therefore gets real
// elevation with no setup, and `e2e/helpers/dem-preflight.ts` fails the run
// loudly if it ever stops arriving. That path deliberately does NOT rewrite the
// app's DEM template — a harness that supplies the tile URL can never catch a
// broken tile URL, which is how the empty-VITE_DEM_TEMPLATE P0 (commit 454c8f2)
// survived months of green tests.
//
// This file remains for the case the interception cannot cover: a plain
// `vite preview` session you drive by hand in a browser.
//
// Usage:
//
//   node tools/dem-relay.mjs &                       # :8099, disk-cached
//   VITE_DEM_TEMPLATE='http://localhost:8099/{z}/{x}/{y}.png' pnpm build
//   cd apps/web && pnpm exec vite preview --port 4173 --strictPort
//
// The VITE_DEM_TEMPLATE override must be set at BUILD time, not run time —
// Vite inlines it. A `pnpm build` without it bakes in the real S3 URL, the
// preview server serves tiles that never arrive, and the invariants run
// against a mapless page.
//
// Note also that playwright.config.ts sets `reuseExistingServer: true`: a
// stale preview server from an earlier build will be silently reused, so
// restart it after every rebuild or the suite reports on code that is no
// longer there. (The DEM preflight now catches that case too — it compares the
// asset hashes the server returns against dist/index.html — but a hand-driven
// preview session has nobody checking.)
//
// `/healthz` answers 200 so a supervisor (or `playwright.config.ts`'s
// `webServer`, if this is ever wired in that way) can wait for readiness
// without asking for a tile and warming the cache with a tile nobody wanted.
import http from 'node:http';
import { execFile } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const CACHE = '/tmp/demcache';
mkdirSync(CACHE, { recursive: true });

http
  .createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
      return;
    }
    const m = req.url.match(/^\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (!m) {
      res.writeHead(400).end('bad tile path');
      return;
    }
    const [, z, x, y] = m;
    const file = `${CACHE}/${z}_${x}_${y}.png`;
    const send = (buf) => {
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(buf);
    };
    if (existsSync(file)) return send(readFileSync(file));

    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
    execFile(
      'curl',
      ['-s', '--max-time', '30', '-o', file, url],
      { maxBuffer: 1 << 26 },
      (err) => {
        if (err || !existsSync(file)) {
          res.writeHead(404).end('upstream miss');
          return;
        }
        send(readFileSync(file));
      },
    );
  })
  .listen(8099, () => console.log('DEM relay on :8099'));
