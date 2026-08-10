/**
 * The invariant behind "deployed the new version and the UI did not update".
 *
 * A release reached GHCR, the container ran the new image, and users still saw
 * the previous build. Nothing was red: CI passed, the image published, the
 * server served exactly what it was asked for. The defect lived entirely in
 * cache headers, which no test looked at.
 *
 * Two rules make a deploy visible, and they only work as a pair:
 *
 *  1. `index.html` must revalidate. It is the only unhashed file naming the
 *     hashed bundles. With no explicit `Cache-Control`, browsers apply
 *     heuristic freshness and serve it without asking, so it keeps pointing at
 *     the previous /assets/ hashes — which really are immutable, and really do
 *     stay cached for a year.
 *  2. Anything else fetched by a fixed URL — the service worker, its
 *     registration shim, the manifest — must not be stored either. A cached
 *     worker script pins a client to a generation that no longer exists.
 *
 * These assert the shipped nginx config rather than a mock of it: the file in
 * this repo is the file baked into the image (`apps/web/Dockerfile`), so it is
 * the actual artifact under test.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const conf = readFileSync(resolve(__dirname, '../../nginx.conf'), 'utf8');

/**
 * Every `location` block in the config, as `{ selector, body }`.
 *
 * Parsed rather than pattern-matched. The first version of this helper built a
 * regex out of the filename and drowned in backslashes — `sw.js` had to become
 * `sw\\.js` to survive both a JS string and a regex, and the assertions that
 * "passed" were matching the literal backslashes inside nginx's own regex
 * selector (`location ~ ^/(sw\.js|...)`) by coincidence rather than testing
 * anything. Comparing plain substrings against the selector text removes the
 * whole class of mistake.
 */
function locations(): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  const re = /location\s+([^{]+)\{([^}]*)\}/g;
  for (const m of conf.matchAll(re)) {
    out.push({ selector: m[1].trim(), body: m[2] });
  }
  return out;
}

/**
 * Body of the first location block whose selector mentions `needle`.
 *
 * Backslashes are stripped from the selector first: a regex location writes
 * `sw\.js`, and the point here is which *paths* a block covers, not how nginx
 * happens to spell them.
 */
function blockFor(needle: string): string | null {
  const unescape = (s: string) => s.replace(/\\/g, '');
  return locations().find((l) => unescape(l.selector).includes(needle))?.body ?? null;
}

describe('nginx cache headers keep a deploy visible', () => {
  it('serves index.html with an explicit revalidate directive', () => {
    const block = blockFor('index.html');
    expect(block, 'no location block covering index.html in nginx.conf').not.toBeNull();
    expect(block).toMatch(/add_header\s+Cache-Control\s+"[^"]*no-cache/);
  });

  it('never lets index.html be served immutable or long-lived', () => {
    const block = blockFor('index.html') ?? '';
    expect(block).not.toMatch(/immutable/);
    // `expires` anything other than 0/-1/epoch would hand out a future
    // Expires header and defeat the no-cache above.
    const expires = block.match(/expires\s+([^;]+);/)?.[1]?.trim();
    if (expires !== undefined) expect(expires).toMatch(/^(0|-1|epoch)$/);
  });

  it.each(['sw.js', 'registerSW.js', 'manifest.webmanifest'])('forbids storing %s', (file) => {
    const block = blockFor(file);
    expect(block, `${file} is not covered by a no-store location block`).not.toBeNull();
    expect(block).toMatch(/add_header\s+Cache-Control\s+"[^"]*no-store/);
  });

  it('still caches hashed assets aggressively — that part was never the bug', () => {
    const block = blockFor('/assets/');
    expect(block).not.toBeNull();
    expect(block).toMatch(/immutable/);
  });
});
