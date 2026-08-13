/**
 * The gate every other gate in this repository is structurally blind to:
 * **does a terrain layer actually paint, for a real user, over the real
 * internet, from the artifact we actually ship?**
 *
 * Read this before changing anything here, because the value of this file is
 * entirely in what it REFUSES to do.
 *
 * ## Why it exists
 *
 * The founder's report was "nothing fucking works — it's just a satellite map
 * with nothing". At that moment: 880 unit tests green, `pnpm build` clean, all
 * 12 checks green on the last PR, `shipped-artifact` green, and a screenshot
 * gallery showing beautiful shaded relief. Every gate agreed the product
 * worked. The product did not work.
 *
 * Each gate was blind in its own way, and they were blind in the SAME
 * direction, which is why four of them stacked up to zero coverage:
 *
 *  1. **No CI job runs a browser at all.** `ui-invariants` — the suite
 *     `CLAUDE.md` calls mandatory — has never run in CI. Filed, still open.
 *  2. **Every browser run that does happen attaches the DEM relay**
 *     (`e2e/fixtures.ts` → `tools/dem-relay.mjs`), so tiles come from
 *     localhost. The relay exists for a good reason (sandboxed Chromium has
 *     no egress, `BACKLOG R76`) and it means the real tile URL is never once
 *     requested. The only path a user is on is the only path never tested.
 *  3. **Unit tests import source modules**, so they cannot see a build-time
 *     `import.meta.env` inlining. `VITE_DEM_TEMPLATE=""` made every DEM URL
 *     the empty string in every image ever shipped; locally the variable is
 *     unset, the fallback fires, and all tests pass on a code path production
 *     never takes.
 *  4. **`shipped-artifact` greps the served bytes.** That is what caught (3),
 *     and it is genuinely good. But a bundle can contain a perfect tile URL
 *     and still paint nothing — a grep cannot tell you a pixel changed.
 *
 * So: this spec imports `test` from `@playwright/test` **directly, never from
 * `./fixtures`**. That single import is the whole point. Anyone who "fixes" a
 * failure here by switching to the fixtures import has deleted the gate while
 * leaving something green in its place, which is worse than not having it.
 *
 * ## Why it is opt-in, and why that is not a loophole
 *
 * It needs real egress, which the dev sandbox does not have. So it SKIPS
 * unless `RIDGELINE_REAL_NETWORK=1`, and CI sets that. The skip is loud and
 * names the reason. Crucially, when it does run it **fails on zero tile
 * requests** rather than passing vacuously — "we asked for nothing and nothing
 * failed" is exactly how a rendering suite measures an empty map for weeks and
 * reports success.
 */
import { expect, test } from '@playwright/test';

/** Hocking Hills, Ohio — the same relief the screenshot gallery uses. */
const VIEW = '#14/39.4340/-82.5400';

/** The public bucket the default build resolves to. */
const TILE_HOST = 'elevation-tiles-prod';

const REAL = process.env.RIDGELINE_REAL_NETWORK === '1';

test.describe('the artifact a hunter actually loads', () => {
  test.skip(
    !REAL,
    'Needs real internet egress. Set RIDGELINE_REAL_NETWORK=1 (CI does). ' +
      'Deliberately not relay-backed: the relay is what made every previous ' +
      'rendering gate blind to the blank-layer P0.',
  );

  test('elevation is fetched from the real source, and a terrain layer paints', async ({
    page,
  }) => {
    const demRequests: string[] = [];
    const demFailures: string[] = [];
    const demStatuses = new Map<string, number>();

    page.on('request', (r) => {
      if (r.url().includes(TILE_HOST)) demRequests.push(r.url());
    });
    page.on('requestfailed', (r) => {
      if (r.url().includes(TILE_HOST))
        demFailures.push(`${r.failure()?.errorText ?? 'failed'} ${r.url()}`);
    });
    page.on('response', (r) => {
      if (r.url().includes(TILE_HOST)) demStatuses.set(r.url(), r.status());
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${VIEW}`, { waitUntil: 'load' });

    // Give the protocol time to enumerate the viewport's tiles and fetch them.
    await page.waitForTimeout(15_000);

    // 1. The bundle must ASK. Zero requests means the template resolved to
    //    something unusable — the original P0 — and no amount of downstream
    //    assertion would notice, because nothing fails when nothing is asked.
    expect(
      demRequests.length,
      `The page requested ZERO elevation tiles from ${TILE_HOST}. That is the ` +
        `blank-layer P0's exact signature: the DEM template resolved to ` +
        `something that cannot address a tile, so no layer can ever render.`,
    ).toBeGreaterThan(0);

    // 2. The requests must SUCCEED. A 403 (bucket policy) or a CORS/tunnel
    //    failure is invisible to every other gate we have and produces the
    //    identical symptom: satellite fine, every analysis layer blank.
    expect(
      demFailures,
      `Elevation tile requests failed at the network layer. Satellite imagery ` +
        `would still render, so this presents to a user as "the add-ons don't ` +
        `work" with no error on screen.`,
    ).toEqual([]);

    const bad = [...demStatuses.entries()].filter(([, s]) => s >= 400);
    expect(bad, `Elevation tiles returned HTTP errors: ${JSON.stringify(bad)}`).toEqual([]);

    // 3. Something must PAINT. This is the assertion a byte-grep cannot make.
    //    Sampled from the GL framebuffer rather than a DOM query, per
    //    non-negotiable #4: the canvas element existing proves nothing.
    const relief = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return { error: 'no canvas element' as const };
      const gl = (canvas.getContext('webgl2') ??
        canvas.getContext('webgl')) as WebGLRenderingContext | null;
      if (!gl) return { error: 'no webgl context' as const };

      // Sample a horizontal transect across the map, away from the chrome.
      const px = new Uint8Array(4);
      const seen = new Set<string>();
      for (let i = 0; i < 24; i++) {
        gl.readPixels(120 + i * 45, 450, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        seen.add(`${px[0]},${px[1]},${px[2]}`);
      }
      return { distinct: seen.size, sample: [...seen].slice(0, 5) };
    });

    expect(relief, 'No WebGL canvas to sample').not.toHaveProperty('error');

    // A hillshade over real relief varies continuously. A blank map, a solid
    // fill, or a uniform "no data" grey collapses to one or two values — which
    // is precisely what the screenshot gallery photographed for weeks while
    // every assertion passed.
    expect(
      (relief as { distinct: number }).distinct,
      `The map painted ${(relief as { distinct: number }).distinct} distinct ` +
        `colour(s) across a 24-point transect. Real shaded relief varies ` +
        `continuously; 1-2 values means blank, solid, or uniform no-data.`,
    ).toBeGreaterThan(3);
  });
});
