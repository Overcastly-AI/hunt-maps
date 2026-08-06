// Minimal local DEM relay, for running the real app inside a sandbox whose
// egress proxy Chromium does not trust.
//
// Chromium's own certificate store does not trust the sandbox's egress proxy
// CA, so browser-side HTTPS to the DEM host resets and every terrain layer
// renders empty — which looks like a broken analysis engine rather than a
// broken network. Node *does* trust it (NODE_EXTRA_CA_CERTS), so this relays
// through Node over plain HTTP on localhost. Same shape as the API's
// DemService, and it exercises the VITE_DEM_TEMPLATE override the app already
// supports rather than adding a test-only code path.
//
// Usage — needed for the screenshot suite, the UI invariants, and any manual
// look at the real app:
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
// longer there.
import http from 'node:http';
import { execFile } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const CACHE = '/tmp/demcache';
mkdirSync(CACHE, { recursive: true });

http
  .createServer((req, res) => {
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
