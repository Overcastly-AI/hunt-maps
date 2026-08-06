import type { Locator, Page } from '@playwright/test';
import type maplibregl from 'maplibre-gl';

/**
 * Hocking Hills, Ohio — the same deep link `screenshots.spec.ts` uses. Sharp
 * relief means real DEM tiles actually render something at this zoom, and
 * reusing the exact view means the local DEM relay cache (localhost:8099)
 * that spec already warms is warm for these tests too.
 */
export const VIEW = '#14/39.4340/-82.5400';

export const DESKTOP = { width: 1440, height: 900 } as const;
/** The breakpoint where the layers sheet flips from a left drawer to a
 * bottom sheet (`apps/web/src/index.css` `@media (max-width: 860px)`). */
export const NARROW = { width: 860, height: 900 } as const;
export const MOBILE = { width: 390, height: 844 } as const;

/**
 * Wait until MapLibre reports idle *and* the on-device analysis worker has
 * produced tiles.
 *
 * Intentionally duplicated from `screenshots.spec.ts` rather than imported:
 * that file is a different agent's territory in this task, and importing
 * across an in-flight file boundary would couple two specs that need to be
 * editable independently. `map.areTilesLoaded()` is the one honest "settled"
 * signal — reading back the GL framebuffer gives false negatives because the
 * drawing buffer is cleared between frames without `preserveDrawingBuffer`.
 */
export async function waitForTiles(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const hook = (window as unknown as { __ridgeline?: { map: maplibregl.Map } }).__ridgeline;
      return Boolean(hook?.map?.isStyleLoaded() && hook.map.areTilesLoaded());
    },
    undefined,
    { timeout: 120_000 },
  );
  // On-device analysis resolves asynchronously behind the tile request.
  await page.waitForTimeout(1500);
}

/** Navigate to the shared deep link, at a given viewport, and wait for the
 * map to have something real painted before any invariant is measured. */
export async function gotoAndSettle(
  page: Page,
  viewport: { width: number; height: number } = DESKTOP,
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto(`/${VIEW}`);
  await page.getByTestId('map-canvas').waitFor({ state: 'visible' });
  await waitForTiles(page);
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Poll an element's bounding box until it stops changing.
 *
 * Ridgeline's chrome moves via both CSS transitions (the sheet slide,
 * `apps/web/src/index.css`) and keyframe animations (the popover scale-in,
 * `packages/design/src/styles.css`), so there is no single DOM event that
 * reliably fires once "the layout is done moving" — `transitionend` alone
 * misses animations and fires once per animated property, and a fixed sleep
 * either races a slow render or wastes time on a fast one. Polling the real
 * geometry is the one condition that is honest regardless of *how* something
 * is moving, and it is what every invariant below waits on before measuring.
 */
export async function waitForRectStable(
  locator: Locator,
  opts: { timeoutMs?: number; quietMs?: number; pollMs?: number } = {},
): Promise<Box | null> {
  const { timeoutMs = 4000, quietMs = 120, pollMs = 40 } = opts;
  const start = Date.now();
  let last: Box | null = null;
  let stableSince = Date.now();

  while (Date.now() - start < timeoutMs) {
    const box = await locator.boundingBox();
    if (box === null) return null; // detached or not currently rendered
    if (
      last &&
      Math.abs(box.x - last.x) < 0.5 &&
      Math.abs(box.y - last.y) < 0.5 &&
      Math.abs(box.width - last.width) < 0.5 &&
      Math.abs(box.height - last.height) < 0.5
    ) {
      if (Date.now() - stableSince >= quietMs) return box;
    } else {
      stableSince = Date.now();
    }
    last = box;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(
    `Element never settled within ${timeoutMs}ms — it was still moving when the timeout hit.`,
  );
}

/** Straight-line distance between two boxes' top-left corners, in CSS px. */
export function boxDelta(a: Box, b: Box): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
