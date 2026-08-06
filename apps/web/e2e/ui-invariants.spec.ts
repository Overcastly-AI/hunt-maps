import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  auditInteractiveElements,
  collectChromeRects,
  collectChromeTextNodes,
  rectsOverlap,
} from './helpers/dom-audit';
import { contrastRatio, estimateBackground, parseCssColor, requiredContrastRatio } from './helpers/contrast';
import { gridPoints, samplePixels } from './helpers/pixels';
import { boxDelta, DESKTOP, gotoAndSettle, MOBILE, NARROW, waitForRectStable, type Box } from './helpers/settle';

/**
 * UI invariants.
 *
 * Ridgeline's 221 unit tests never touch a real browser layout, so they are
 * structurally blind to a whole class of defect: something that paints
 * correctly and passes every prop/state assertion, but that a person with a
 * mouse, a keyboard or a gloved thumb cannot actually operate. The bug that
 * motivated this file is exactly that shape — `.rl-conditions` clipped a
 * popover with `overflow: hidden`; the popover's buttons still painted (an
 * ancestor's clip does not change `getBoundingClientRect()`) but
 * `document.elementFromPoint()` at their centre resolved to the map canvas
 * underneath. Visible and unclickable. Every test below asserts something a
 * screenshot review or a unit test cannot: what a real click lands on, what
 * moves when you press something, and what a real human eye can read.
 *
 * Run with:
 *   cd apps/web && PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
 *     pnpm exec playwright test ui-invariants
 */

async function measureBox(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Trigger has no bounding box — is it actually visible?');
  return box;
}

async function closeLayersSheet(page: Page): Promise<void> {
  const closeBtn = page.getByRole('button', { name: 'Close panel' });
  if (await closeBtn.isVisible()) {
    await closeBtn.click();
    await waitForRectStable(page.locator('.chrome-bottomleft'));
  }
}

// ---------------------------------------------------------------------------
// 1. Hit-testability
// ---------------------------------------------------------------------------
//
// The direct regression test for the motivating bug: every visible
// interactive element's own centre point must resolve, via
// `elementFromPoint`, back to itself (or a descendant — an icon inside a
// button, for instance). An element whose bounding box says "here" while the
// browser's hit-test says "somewhere else" is a control a real tap will miss.
//
// The one deliberate exception: an element that sits behind the currently
// open Layers sheet or Wind popover and is not part of it. On a phone the
// bottom sheet covers the rail behind it rather than sliding it clear
// (documented in `apps/web/src/index.css`) — that is intentional occlusion by
// a higher, later-painted panel, not the clipping bug. `auditInteractiveElements`
// tells these two cases apart by checking whether the *un-hit* element is
// geometrically inside the currently-open overlay's own DOM subtree: a
// control that is part of the popover/sheet is always asserted normally (that
// is exactly where a clipping regression would reappear); a control merely
// covered by it is skipped. This cannot silently swallow a repeat of the
// original bug, because the original bug's buttons *were* inside the
// clipping ancestor's subtree.
//
// A second, unrelated reason `elementFromPoint` can miss a real control:
// `elementFromPoint` is viewport-relative and returns `null` for anything
// currently scrolled out of view. A control below the fold of the Layers
// sheet's scrolling body is not clipped, just not scrolled to yet, and an
// invariant that could not tell the two apart would be a blind spot in the
// exact suite built to remove them. `auditInteractiveElements` scrolls an
// off-screen candidate into view before hit-testing it, and only reports it
// as a *different*, genuine defect (`reachable: false`) if it is still
// off-screen afterwards — see that helper and the two separate assertions
// below.
test.describe('1. Hit-testability', () => {
  const states: Array<{ name: string; setup: (page: Page) => Promise<void> }> = [
    { name: 'closed', setup: closeLayersSheet },
    { name: 'layers open', setup: async () => {} }, // default state after load
    {
      name: 'wind popover open',
      setup: async (page) => {
        await closeLayersSheet(page);
        await page.getByRole('button', { name: /Wind from/ }).click();
        await waitForRectStable(page.locator('.rl-popover'));
      },
    },
  ];

  for (const viewport of [DESKTOP, MOBILE]) {
    for (const state of states) {
      test(`${viewport.width}px — ${state.name}`, async ({ page }) => {
        await gotoAndSettle(page, viewport);
        await state.setup(page);

        const elements = await auditInteractiveElements(page, ['.map-chrome', '.rl-sheet']);
        expect(elements.length, 'expected at least some interactive chrome to audit').toBeGreaterThan(0);

        const candidates = elements.filter((el) => !el.coveredByOpenOverlay);

        // Class 2: genuinely unreachable — still off-screen after scrolling
        // it into view, i.e. no scrollable ancestor can ever reach it. This
        // is a different defect from the motivating bug (present but
        // permanently unreachable, rather than visible-but-hit-tests-wrong)
        // and is reported with its own message so the two are never confused.
        const unreachable = candidates.filter((el) => !el.reachable);
        expect(
          unreachable,
          unreachable
            .map(
              (f) =>
                `"${f.name}" (${f.tag}${f.type ? `[type=${f.type}]` : ''}) is still outside the ` +
                `viewport after scrollIntoView — no scrollable ancestor can reach it.`,
            )
            .join('\n'),
        ).toEqual([]);

        // Class 4 (the motivating bug): reachable, on-screen, but its centre
        // hit-tests to something other than itself — visible and unclickable.
        const clipped = candidates.filter((el) => el.reachable && !el.hitOk);
        expect(
          clipped,
          clipped
            .map(
              (f) =>
                `"${f.name}" (${f.tag}${f.type ? `[type=${f.type}]` : ''}) paints at ` +
                `(${Math.round(f.rect.x)}, ${Math.round(f.rect.y)}) but elementFromPoint at its ` +
                `centre resolves to something else — visible and unclickable.`,
            )
            .join('\n'),
        ).toEqual([]);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 2. Trigger stability
// ---------------------------------------------------------------------------
//
// Clicking a control must not move that control out from under the pointer
// that just pressed it. Each case records the trigger's box, clicks it,
// waits for any animation to actually finish (`waitForRectStable` — see that
// helper for why a fixed sleep can't stand in for this), and re-measures the
// same trigger.
test.describe('2. Trigger stability', () => {
  test('rail buttons with no panel side-effects do not move on click', async ({ page }) => {
    await gotoAndSettle(page, DESKTOP);
    await closeLayersSheet(page);

    for (const name of ['Zoom in', 'Zoom out', 'Go to my location']) {
      const trigger = page.getByRole('button', { name });
      const before = await measureBox(trigger);
      await trigger.click();
      await waitForRectStable(trigger);
      const after = await measureBox(trigger);
      expect(boxDelta(before, after), `"${name}" moved ${boxDelta(before, after).toFixed(1)}px on click`).toBeLessThanOrEqual(4);
    }
  });

  test('opening the wind popover from a closed panel does not move the trigger', async ({ page }) => {
    // This is the case the Popover redesign was built for: no sheet is open,
    // so nothing needs to slide out of the way, and the popover is sized to
    // its own content and anchored in place (`packages/design/src/components
    // /primitives.tsx`, the `Popover` doc comment explains the three ways the
    // old full-height drawer got this wrong).
    await gotoAndSettle(page, DESKTOP);
    await closeLayersSheet(page);

    const trigger = page.getByRole('button', { name: /Wind from/ });
    const before = await measureBox(trigger);
    await trigger.click();
    await waitForRectStable(trigger);
    const after = await measureBox(trigger);
    expect(boxDelta(before, after), `Wind trigger moved ${boxDelta(before, after).toFixed(1)}px on click`).toBeLessThanOrEqual(4);
  });

  // --- The two cases below are expected to currently FAIL. See the summary
  // for the real defect they catch: `.chrome-bottomleft` (Rail + ConditionsBar
  // together) is translated 372px by `apps/web/src/index.css` whenever the
  // Layers sheet is open, and both the Layers button and the Wind button live
  // inside that same translated group. Opening *or* closing the sheet moves
  // its own trigger — the exact failure class this suite exists to catch,
  // reproduced via a different code path than the one already fixed for the
  // wind/time editors themselves.

  test('opening the Layers sheet must not move the Layers button itself', async ({ page }) => {
    await gotoAndSettle(page, DESKTOP);
    await closeLayersSheet(page); // start closed, so the click below is a clean *open*

    const trigger = page.getByRole('button', { name: 'Layers' });
    const before = await measureBox(trigger);
    await trigger.click();
    await waitForRectStable(trigger);
    const after = await measureBox(trigger);

    expect(
      boxDelta(before, after),
      `Layers button moved ${boxDelta(before, after).toFixed(1)}px horizontally when the sheet it ` +
        `opens slid its own trigger sideways with it (apps/web/src/index.css, the ` +
        `"data-sheet-open" translateX rule on .chrome-bottomleft).`,
    ).toBeLessThanOrEqual(4);
  });

  test('opening the wind popover while the Layers sheet is open must not move the Wind trigger', async ({ page }) => {
    // Default load state: `panel === 'layers'`, sheet already open.
    await gotoAndSettle(page, DESKTOP);
    await waitForRectStable(page.locator('.chrome-bottomleft'));

    const trigger = page.getByRole('button', { name: /Wind from/ });
    const before = await measureBox(trigger);
    await trigger.click(); // panel switches to 'wind', which closes the sheet underneath it
    await waitForRectStable(trigger);
    const after = await measureBox(trigger);

    expect(
      boxDelta(before, after),
      `Wind trigger moved ${boxDelta(before, after).toFixed(1)}px because opening it closed the ` +
        `Layers sheet and retracted the same 372px translate that opening the sheet applies — the ` +
        `historical "wind editor slid the conditions bar out from under the cursor" bug, now caused ` +
        `by the Layers trigger's own open/close instead of anything wind-specific.`,
    ).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// 3. Touch targets
// ---------------------------------------------------------------------------
//
// Every interactive element is at least 44x44 CSS px — this app is operated
// with gloves on. The one documented exception is a range slider's *height*
// (28px is the accepted glove-friendly minimum for a drag track, matching
// `.rl-range` in `packages/design/src/styles.css`); its width is still held
// to the full 44px floor. Checkbox/radio inputs are measured by their
// *effective* box — the wrapping `<label>`, which is the box a browser
// actually honours a tap against — not the ~18px glyph alone.
test.describe('3. Touch targets (>= 44x44 CSS px, gloved)', () => {
  for (const viewport of [DESKTOP, MOBILE]) {
    test(`${viewport.width}px`, async ({ page }) => {
      await gotoAndSettle(page, viewport);
      // The layers sheet's toggles are the largest population of controls in
      // the app, so check with it open.
      const elements = await auditInteractiveElements(page, ['.map-chrome', '.rl-sheet']);
      expect(elements.length).toBeGreaterThan(0);

      const violations = elements
        .filter((el) => !el.disabled) // a disabled control's footprint still matters, but keep the signal to controls a user can actually act on right now
        .map((el) => {
          const isRange = el.tag === 'INPUT' && el.type === 'range';
          const minHeight = isRange ? 28 : 44;
          const minWidth = 44;
          const ok = el.effectiveRect.width >= minWidth && el.effectiveRect.height >= minHeight;
          return { el, ok, minWidth, minHeight };
        })
        .filter((r) => !r.ok);

      expect(
        violations,
        violations
          .map(
            (v) =>
              `"${v.el.name}" (${v.el.tag}${v.el.type ? `[type=${v.el.type}]` : ''}) is ` +
              `${Math.round(v.el.effectiveRect.width)}x${Math.round(v.el.effectiveRect.height)}px, ` +
              `needs >= ${v.minWidth}x${v.minHeight}px.`,
          )
          .join('\n'),
      ).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. No chrome collisions
// ---------------------------------------------------------------------------
//
// The floating map controls must never overlap each other's bounding boxes —
// two glass surfaces stacked on top of one another is unreadable and the
// underneath one becomes an elementFromPoint trap for whatever is on top.
// Desktop only: on a phone the Layers sheet is designed to cover the bottom
// rail while open rather than push it aside (see the hit-testability comment
// above), which is an *intentional* overlap, not a collision to flag.
test.describe('4. No chrome collisions (desktop)', () => {
  test('nothing open', async ({ page }) => {
    await gotoAndSettle(page, DESKTOP);
    await closeLayersSheet(page);
    await assertNoCollisions(page);
  });

  test('layers sheet open', async ({ page }) => {
    await gotoAndSettle(page, DESKTOP);
    await waitForRectStable(page.locator('.rl-sheet'));
    await assertNoCollisions(page);
  });

  test('wind popover open', async ({ page }) => {
    await gotoAndSettle(page, DESKTOP);
    await closeLayersSheet(page);
    await page.getByRole('button', { name: /Wind from/ }).click();
    await waitForRectStable(page.locator('.rl-popover'));
    await assertNoCollisions(page);
  });
});

async function assertNoCollisions(page: Page): Promise<void> {
  const rects = await collectChromeRects(page);
  const named: Array<[string, typeof rects.sheet]> = [
    ['rail (top-right)', rects.railTopRight],
    ['rail (bottom-left)', rects.railBottomLeft],
    ['conditions bar', rects.conditions],
    ['layers sheet', rects.sheet],
    ['wind/time popover', rects.popover],
  ];
  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      const [nameA, rectA] = named[i];
      const [nameB, rectB] = named[j];
      expect(
        rectsOverlap(rectA, rectB),
        `${nameA} and ${nameB} overlap: ${JSON.stringify(rectA)} vs ${JSON.stringify(rectB)}`,
      ).toBe(false);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Focus visibility
// ---------------------------------------------------------------------------
//
// Tabbing to a control must produce a visible change — an outline or a box
// shadow — or a keyboard user (and anyone who has ever had to use this app
// with the map covered by a stand rail and a phone jammed against a tree)
// has no idea where they are. Scoped to `.map-chrome`/`.rl-sheet`/
// `.rl-popover`: MapLibre's own attribution control is outside this app's
// design-system contract (see `dom-audit.ts`).
test.describe('5. Focus visibility', () => {
  test('layers sheet — every tab stop has a visible focus indicator', async ({ page }) => {
    await gotoAndSettle(page, DESKTOP);
    await waitForRectStable(page.locator('.rl-sheet'));
    await page.getByRole('button', { name: 'Layers' }).focus();

    const stops = await tabThroughChrome(page);
    expect(stops.length, 'expected to walk more than a couple of tab stops').toBeGreaterThan(3);
    const unmarked = stops.filter((s) => !s.ok);
    expect(
      unmarked,
      unmarked.map((s) => `"${s.name}" (${s.tag}) received focus with no visible outline or box-shadow.`).join('\n'),
    ).toEqual([]);
  });

  test('wind popover — every tab stop has a visible focus indicator', async ({ page }) => {
    await gotoAndSettle(page, DESKTOP);
    await closeLayersSheet(page);
    await page.getByRole('button', { name: /Wind from/ }).click();
    await waitForRectStable(page.locator('.rl-popover'));
    await page.getByRole('button', { name: /Wind from/ }).focus();

    const stops = await tabThroughChrome(page);
    expect(stops.length).toBeGreaterThan(3);
    const unmarked = stops.filter((s) => !s.ok);
    expect(
      unmarked,
      unmarked.map((s) => `"${s.name}" (${s.tag}) received focus with no visible outline or box-shadow.`).join('\n'),
    ).toEqual([]);
  });
});

interface FocusStop {
  tag: string;
  name: string;
  ok: boolean;
}

/**
 * Tab forward from wherever focus currently is, recording each stop's
 * visible-indicator state, until focus leaves the app's own chrome or loops
 * back on itself. Bounded by both conditions rather than a fixed count, so
 * it neither stops early on a long panel nor spins forever on a focus trap
 * bug.
 */
async function tabThroughChrome(page: Page, maxStops = 60): Promise<FocusStop[]> {
  const stops: FocusStop[] = [];
  let previousKey: string | null = null;

  for (let i = 0; i < maxStops; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      const inChrome = el?.closest('.map-chrome, .rl-sheet, .rl-popover');
      if (!el || el === document.body || !inChrome) return null;

      const style = window.getComputedStyle(el);
      const hasOutline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
      const hasBoxShadow = style.boxShadow !== 'none';
      const rect = el.getBoundingClientRect();

      return {
        key: `${el.tagName}.${el.className}@${Math.round(rect.x)},${Math.round(rect.y)}`,
        tag: el.tagName,
        name: el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 30) ?? el.id,
        ok: hasOutline || hasBoxShadow,
      };
    });
    if (!info) break; // left the chrome entirely
    if (info.key === previousKey) break; // looped back to the same stop
    previousKey = info.key;
    stops.push({ tag: info.tag, name: info.name, ok: info.ok });
  }
  return stops;
}

// ---------------------------------------------------------------------------
// 6. No horizontal page scroll
// ---------------------------------------------------------------------------
//
// `index.css` sets `overflow: hidden` on `html`/`body` deliberately — the map
// handles its own panning, and the page itself is never meant to scroll. If
// some panel or long label pushes `scrollWidth` past `clientWidth` anyway,
// the app gains a horizontal scrollbar or a dead strip a gloved thumb can
// drag the whole page with, which fights the map's own pan gesture.
test.describe('6. No horizontal page scroll', () => {
  for (const viewport of [DESKTOP, NARROW, MOBILE]) {
    test(`${viewport.width}px`, async ({ page }) => {
      await gotoAndSettle(page, viewport);
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        overflow.scrollWidth,
        `documentElement.scrollWidth (${overflow.scrollWidth}) exceeds clientWidth ` +
          `(${overflow.clientWidth}) at ${viewport.width}px — the page can scroll horizontally.`,
      ).toBeLessThanOrEqual(overflow.clientWidth);
    });
  }
});

// ---------------------------------------------------------------------------
// 7. Contrast of rendered text (WCAG AA)
// ---------------------------------------------------------------------------
//
// Sampled from an *actual screenshot*, not computed CSS — a computed
// `background-color` cannot account for `backdrop-filter: blur()` glass
// sitting over a live map, but a rendered pixel already has. See
// `helpers/contrast.ts#estimateBackground` for the one real approximation
// left after that: separating "glyph ink" pixels from "background" pixels in
// a small/dense label is a heuristic, not exact, and it is documented there
// as biased toward *passing*, never toward a false failure — so a failure
// this test reports is trustworthy.
test.describe('7. Chrome text contrast (WCAG AA)', () => {
  test('layers sheet', async ({ page }) => {
    await gotoAndSettle(page, DESKTOP);
    await waitForRectStable(page.locator('.rl-sheet'));
    await assertChromeContrast(page, ['.map-chrome', '.rl-sheet']);
  });

  test('conditions bar and wind popover', async ({ page }) => {
    await gotoAndSettle(page, DESKTOP);
    await closeLayersSheet(page);
    await page.getByRole('button', { name: /Wind from/ }).click();
    await waitForRectStable(page.locator('.rl-popover'));
    await assertChromeContrast(page, ['.map-chrome']);
  });
});

async function assertChromeContrast(page: Page, roots: string[]): Promise<void> {
  const nodes = await collectChromeTextNodes(page, roots);
  expect(nodes.length, 'expected some visible chrome text to audit').toBeGreaterThan(0);

  const pointsPerNode = nodes.map((n) => gridPoints(n, 5, 4));
  const flatSamples = await samplePixels(page, pointsPerNode.flat());

  const violations: string[] = [];
  let cursor = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const count = pointsPerNode[i].length;
    const samples = flatSamples.slice(cursor, cursor + count);
    cursor += count;

    const textColor = parseCssColor(node.colorCss);
    const background = estimateBackground(samples, textColor);
    const ratio = contrastRatio(textColor, background);
    const required = requiredContrastRatio(node.fontSizePx, node.fontWeight);

    // Small epsilon for anti-aliasing / rounding noise at the sampling grid,
    // not to hide a real shortfall.
    if (ratio < required - 0.05) {
      violations.push(
        `"${node.text}" (${node.selectorHint}, ${node.fontSizePx}px/${node.fontWeight}) measures ` +
          `${ratio.toFixed(2)}:1 against its sampled background, needs ${required}:1.`,
      );
    }
  }
  expect(violations).toEqual([]);
}

// ---------------------------------------------------------------------------
// 8. Panel density
// ---------------------------------------------------------------------------
//
// An open panel whose content fills less than ~40% of the chassis it is
// given is the tell for a small control placed in a container sized for a
// long list — literally what the wind/time editors looked like before they
// became popovers sized to their own content (see the `Popover` doc comment
// in `packages/design/src/components/primitives.tsx`). Density = content
// height / the panel's own allocated height, capped at 100% once content
// needs to scroll (a scrolling long list is dense by definition, not sparse).
test.describe('8. Panel density (>= 40% of chassis)', () => {
  test('layers sheet — a genuinely long, scrolling list', async ({ page }) => {
    await gotoAndSettle(page, DESKTOP);
    await waitForRectStable(page.locator('.rl-sheet'));
    const density = await measureDensity(page, '.rl-sheet', '.rl-sheet__body');
    expect(density, `Layers sheet content fills only ${(density * 100).toFixed(0)}% of its chassis`).toBeGreaterThanOrEqual(0.4);
  });

  test('wind popover — sized to its own content, not an oversized chassis', async ({ page }) => {
    await gotoAndSettle(page, DESKTOP);
    await closeLayersSheet(page);
    await page.getByRole('button', { name: /Wind from/ }).click();
    await waitForRectStable(page.locator('.rl-popover'));
    const density = await measureDensity(page, '.rl-popover', '.rl-popover__body');
    expect(density, `Wind popover content fills only ${(density * 100).toFixed(0)}% of its chassis`).toBeGreaterThanOrEqual(0.4);
  });
});

async function measureDensity(page: Page, panelSelector: string, bodySelector: string): Promise<number> {
  return page.evaluate(
    ({ panelSelector, bodySelector }: { panelSelector: string; bodySelector: string }) => {
      const panel = document.querySelector(panelSelector);
      const body = document.querySelector(bodySelector);
      if (!panel || !body) throw new Error(`Panel or body not found: ${panelSelector} / ${bodySelector}`);
      const chassisHeight = panel.getBoundingClientRect().height;
      // scrollHeight already accounts for content taller than the visible
      // body (it needs to scroll, i.e. it is at least as dense as its
      // chassis); clientHeight covers the "shorter than its chassis" case.
      const contentHeight = Math.max(body.scrollHeight, body.clientHeight);
      return Math.min(contentHeight, chassisHeight) / chassisHeight;
    },
    { panelSelector, bodySelector },
  );
}
