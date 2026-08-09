import type { Page } from '@playwright/test';

/**
 * Helpers for exercising offline coverage against the **real** tile store.
 *
 * Nothing here mocks storage. Everything goes through `window.__ridgeline
 * .offline`, which hands back the actual OPFS/IndexedDB store the app uses and
 * the actual tile enumeration the analysis fetch path uses. That matters more
 * here than anywhere else in this suite: the whole defect class is *the UI
 * claiming something the storage does not support*, and a mocked store can only
 * ever confirm that the UI agrees with the mock.
 *
 * The tiles written are real 256×256 PNGs so the analysis worker can decode
 * them — a seeded region that the renderer chokes on would be a different
 * experiment from the one we mean to run.
 */

export interface SeedResult {
  backend: string;
  written: number;
  tileZoom: number;
}

/**
 * Write DEM tiles covering the current view (plus a one-tile apron) into the
 * device's real tile store.
 *
 * `fraction` seeds only the westernmost share of the view's tile columns, which
 * is how the "partial" case is produced: a genuine half-covered draw, not a
 * synthetic percentage.
 */
export async function seedTilesForView(page: Page, fraction = 1): Promise<SeedResult> {
  return page.evaluate(async (share: number) => {
    const hook = (window as unknown as { __ridgeline?: Record<string, any> }).__ridgeline;
    const map = hook?.map;
    const offline = hook?.offline;
    if (!map || !offline) throw new Error('__ridgeline.map / .offline not exposed');

    const b = map.getBounds();
    const bounds = {
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    };
    const tiles: Array<{ z: number; x: number; y: number }> = offline.tilesForView(
      bounds,
      map.getZoom(),
    );
    if (tiles.length === 0) throw new Error('view needs no tiles — bad fixture');

    // Apron: one tile beyond the view on every side, so a re-measure after a
    // one-pixel settle cannot fall off the seeded edge and turn a deliberate
    // "covered" fixture into an accidental "partial" one.
    const z = tiles[0].z;
    const xs = tiles.map((t) => t.x);
    const ys = tiles.map((t) => t.y);
    const x0 = Math.min(...xs) - 1;
    const x1 = Math.max(...xs) + 1;
    const y0 = Math.min(...ys) - 1;
    const y1 = Math.max(...ys) + 1;
    // Seed whole columns from the west, so the covered/missing boundary is a
    // clean vertical line a human can see on the map.
    const cutoff = x0 + Math.max(1, Math.round((x1 - x0 + 1) * share)) - 1;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context to build a fixture tile');
    // Terrarium encodes elevation as (r*256 + g + b/256) - 32768; this is a
    // flat ~200 m plateau. Decodable, and analysis over it is well defined.
    ctx.fillStyle = 'rgb(128, 200, 0)';
    ctx.fillRect(0, 0, 256, 256);
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b2) => (b2 ? resolve(b2) : reject(new Error('toBlob failed'))), 'image/png'),
    );
    const bytes = await blob.arrayBuffer();

    const store = await offline.store();
    let written = 0;
    for (let x = x0; x <= Math.min(x1, cutoff); x++) {
      for (let y = y0; y <= y1; y++) {
        await store.put(offline.tileKey({ z, x, y }), bytes.slice(0));
        written++;
      }
    }

    // The probe memo would otherwise keep answering with the pre-seed result.
    offline.invalidate();
    const stats = await store.stats();
    return { backend: stats.backend as string, written, tileZoom: z };
  }, fraction);
}

/** Wipe the tile store, so a case starts from a genuinely cold device. */
export async function clearTiles(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const hook = (window as unknown as { __ridgeline?: Record<string, any> }).__ridgeline;
    const store = await hook?.offline?.store();
    await store?.clear();
    hook?.offline?.invalidate();
  });
}

/**
 * Force a re-measure without changing the view.
 *
 * `jumpTo` fires `movestart`/`moveend` even when the camera does not actually
 * move, which is exactly the signal the coverage hook listens for — and it
 * avoids nudging the map into needing a tile the fixture did not seed.
 */
export async function remeasure(page: Page): Promise<void> {
  await page.evaluate(() => {
    const map = (window as unknown as { __ridgeline?: { map?: any } }).__ridgeline?.map;
    map?.jumpTo({ center: map.getCenter(), zoom: map.getZoom() });
  });
}

/** Jump the camera somewhere else entirely, without an animation. */
export async function jumpTo(page: Page, lng: number, lat: number): Promise<void> {
  await page.evaluate(
    ({ lng: lo, lat: la }: { lng: number; lat: number }) => {
      const map = (window as unknown as { __ridgeline?: { map?: any } }).__ridgeline?.map;
      map?.jumpTo({ center: [lo, la], zoom: map.getZoom() });
    },
    { lng, lat },
  );
}

/**
 * The chip's **rendered** text, with the decorative glyph stripped.
 *
 * `innerText`, not `textContent`: the chip is `text-transform: uppercase`, so
 * what a hunter actually reads is "COVERED", and `textContent` would report the
 * source string instead. Comparing against the rendered casing is the point —
 * this suite asserts what the user got, not what we passed in.
 */
export async function chipText(page: Page): Promise<string> {
  return (await page.getByTestId('coverage-chip').innerText()).replace(/[●○◐◌!]/g, '').trim();
}

/**
 * Poll the chip's rendered text for `ms`, returning every distinct label seen.
 *
 * This is the shape the R8 invariant needs. Asserting only the *final* label
 * would pass even if the badge flashed a stale "Covered" for a second over
 * ground five hundred miles from anything downloaded — and a hunter glancing at
 * their phone at the trailhead sees exactly that one frame.
 */
export async function observeChipLabels(page: Page, ms = 2500): Promise<string[]> {
  const seen: string[] = [];
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const text = await chipText(page);
    if (seen[seen.length - 1] !== text) seen.push(text);
    await page.waitForTimeout(40);
  }
  return seen;
}

/** Computed colour of the chip, as rendered — not the class name it was given. */
export async function chipColor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="coverage-chip"] .rl-chip');
    if (!el) throw new Error('coverage chip not rendered');
    return getComputedStyle(el).color;
  });
}

/** A design token's resolved value, so a test never hard-codes a colour. */
export async function tokenColor(page: Page, name: string): Promise<string> {
  return page.evaluate((token: string) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${token})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);
}

// ---------------------------------------------------------------------------
// Region picker (R4)
// ---------------------------------------------------------------------------

/**
 * Open "Save for offline" and wait for the panel to be usable.
 *
 * The Layers sheet is closed first. Not defensive tidying: below 861px it is a
 * full-width bottom sheet that deliberately covers the bottom-left rail
 * (documented in `apps/web/src/index.css`), so the rail button this clicks is
 * genuinely unreachable while it is open — the same intentional occlusion the
 * wind trigger has, and the reason `closeLayersSheet` exists in the spec.
 */
export async function openRegionPicker(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: 'Close panel' });
  if (await close.isVisible().catch(() => false)) {
    await close.click();
    await page.waitForTimeout(300);
  }
  await page
    .getByRole('button', { name: 'Save this area for offline use' })
    .click({ timeout: 15_000 });
  await page.waitForSelector('[data-testid="region-download"], [data-testid="region-progress"]');
  // The estimate is debounced; without this the first read can catch the
  // placeholder rather than a number.
  await page.waitForTimeout(700);
}

/**
 * An element's **rendered** text, with decorative status glyphs removed.
 *
 * `toContainText` compares against `textContent`, which reports the source
 * string — so a `text-transform: uppercase` chip that a hunter reads as
 * "UNFINISHED" comes back as "Unfinished" and an assertion written against
 * what is on screen fails for the wrong reason. Same rule as `chipText`: assert
 * what was painted, not what was passed in.
 */
export async function renderedText(page: Page, testId: string): Promise<string> {
  if ((await page.getByTestId(testId).count()) === 0) return '';
  return (await page.getByTestId(testId).innerText()).replace(/[●○◐◌!]/g, '').trim();
}

/** Forget every saved region record, so a case starts from a cold device. */
export async function clearRegions(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.removeItem('ridgeline.offline.regions.v1');
  });
}

export interface HitResult {
  found: boolean;
  ok: boolean;
  width: number;
  height: number;
  /** What `elementFromPoint` resolved to, for a readable failure message. */
  hit: string;
}

/**
 * Hit-test a control **exactly where it currently sits**, with no scrolling.
 *
 * Deliberately different from `auditInteractiveElements`, which scrolls a
 * candidate into view first — the right behaviour for auditing every control in
 * a long panel, and the wrong question for a *primary* action. "Reachable if
 * you scroll a panel one-handed in the dark" is not the same promise as
 * "tappable". This helper asks the second question, and it is the one that
 * caught the download button sitting below the fold of the sheet's scrolling
 * body with `elementFromPoint` returning null at its centre.
 */
export async function hitTestInPlace(page: Page, testId: string): Promise<HitResult> {
  return page.evaluate((id: string) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return { found: false, ok: false, width: 0, height: 0, hit: 'absent' };
    const r = el.getBoundingClientRect();
    const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      found: true,
      ok: target === el || el.contains(target),
      width: r.width,
      height: r.height,
      hit: target ? `${target.tagName}.${String(target.className).slice(0, 40)}` : 'null (off-screen or clipped)',
    };
  }, testId);
}

/**
 * Make the real tile store start refusing writes with a quota error.
 *
 * Patches `put` on the actual store instance the app holds, so everything from
 * the download loop through to the rendered alert is the production path — only
 * the disk write is replaced. Filling a real 1 GB OPFS quota would take longer
 * than the whole suite and would not exercise anything different.
 */
export async function failTileWritesAfter(page: Page, n: number): Promise<void> {
  await page.evaluate(async (limit: number) => {
    const hook = (window as unknown as { __ridgeline?: Record<string, any> }).__ridgeline;
    const store = await hook?.offline?.store();
    if (!store) throw new Error('__ridgeline.offline.store not exposed');
    const original = store.put.bind(store);
    let written = 0;
    store.put = async (key: unknown, data: ArrayBuffer) => {
      if (written++ >= limit) {
        const err = new Error('The quota has been exceeded.');
        err.name = 'QuotaExceededError';
        throw err;
      }
      return original(key, data);
    };
  }, n);
}

/** Tiles currently in the real store, straight from its own stats. */
export async function storedTileCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const hook = (window as unknown as { __ridgeline?: Record<string, any> }).__ridgeline;
    const stats = await (await hook?.offline?.store()).stats();
    return stats.tileCount as number;
  });
}

/**
 * Features the GL renderer is actually drawing for a layer.
 *
 * `queryRenderedFeatures` reflects what was rendered, not what was handed to
 * the source — so an overlay whose data is set but whose layer was removed (or
 * never inserted) comes back empty here and passes nothing.
 */
export async function renderedFeatureCount(page: Page, layerId: string): Promise<number> {
  return page.evaluate((id: string) => {
    const map = (window as unknown as { __ridgeline?: { map?: any } }).__ridgeline?.map;
    if (!map || !map.getLayer(id)) return 0;
    return map.queryRenderedFeatures({ layers: [id] }).length;
  }, layerId);
}
