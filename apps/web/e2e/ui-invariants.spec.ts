import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  auditInteractiveElements,
  collectChromeRects,
  collectChromeTextNodes,
  measureGlassSurplus,
  rectsOverlap,
} from './helpers/dom-audit';
import {
  contrastRatio,
  estimateBackground,
  parseCssColor,
  requiredContrastRatio,
} from './helpers/contrast';
import { canvasSaturationCoverage, gridPoints, samplePixels } from './helpers/pixels';
import {
  boxDelta,
  DESKTOP,
  gotoAndSettle,
  MOBILE,
  NARROW,
  VIEW,
  waitForRectStable,
  waitForTiles,
  type Box,
} from './helpers/settle';
import {
  chipColor,
  chipText,
  clearRegions,
  clearTiles,
  failTileWritesAfter,
  hitTestInPlace,
  jumpTo,
  observeChipLabels,
  openRegionPicker,
  remeasure,
  renderedText,
  renderedFeatureCount,
  seedTilesForView,
  storedTileCount,
  tokenColor,
} from './helpers/offline';

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

/**
 * Poll real screenshots of `box` until the saturated-pixel coverage stops
 * changing, instead of trusting a fixed settle delay after `waitForTiles`.
 *
 * `waitForTiles`'s own doc explains why a GL framebuffer readback is not a
 * safe "painted" signal here: `map.areTilesLoaded()` only proves MapLibre
 * finished *fetching* a source's tiles, and the fixed sleep after it is a
 * guess at how long the GPU needs to actually composite that into a frame.
 * That guess held on a fast, idle machine and produced a false "0.15%,
 * painted nothing" reading — indistinguishable from the real `R32`/`R66`
 * regression this suite exists to catch — on a slower or more loaded one,
 * where the composite genuinely had not landed yet when the single
 * `page.screenshot()` fired. Measuring the actual pixels twice in a row
 * rather than once on a clock removes the guess entirely: if the layer never
 * paints, coverage stays flat near the noise floor and this still returns
 * promptly (two flat reads in a row), so a genuinely broken layer fails just
 * as fast as before.
 */
async function waitForCoverageStable(
  page: Page,
  box: Box,
  opts: { timeoutMs?: number; pollMs?: number; quietReads?: number } = {},
): Promise<number> {
  const { timeoutMs = 60_000, pollMs = 500, quietReads = 2 } = opts;
  const start = Date.now();
  let last: number | null = null;
  let stableCount = 0;
  for (;;) {
    const pct = await canvasSaturationCoverage(page, box);
    if (last !== null && Math.abs(pct - last) < 0.01) {
      stableCount++;
      if (stableCount >= quietReads) return pct;
    } else {
      stableCount = 0;
    }
    last = pct;
    if (Date.now() - start >= timeoutMs) return pct;
    await page.waitForTimeout(pollMs);
  }
}

async function closeLayersSheet(page: Page): Promise<void> {
  const closeBtn = page.getByRole('button', { name: 'Close panel' });
  if (await closeBtn.isVisible()) {
    await closeBtn.click();
    await waitForRectStable(page.locator('.chrome-bottomleft'));
  }
}

// ---------------------------------------------------------------------------
// 0. Regression guard — clipped-ancestor hit-testing
// ---------------------------------------------------------------------------
//
// A synthetic, app-independent pin for `dom-audit.ts`'s own logic, not a
// product invariant — but it earns its place here for the same reason the
// rest of this file exists: a reviewer of this very suite once hit-tested a
// Layers-sheet row at its raw, unscrolled position (well inside the 900px
// *window*, but past the sheet body's own 707px scroll clip) and reported it
// as two real app defects. Neither existed; the mistake was a viewport-only
// visibility check, exactly the shape of bug `auditInteractiveElements` is
// built to avoid. This fixture pins both branches directly so a future
// refactor that reintroduces a viewport-only check fails immediately, rather
// than waiting for someone to rediscover the mistake by eye against the real
// app. Uses `page.setContent` — no app, no DEM tiles, no navigation — so it
// runs in well under a second.
test.describe('0. Regression guard — clipped-ancestor hit-testing', () => {
  test('a control past its scrolling ancestor clip is scrolled and hit-tested at its real, visible position', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    await page.setContent(`
      <div id="scroller" style="position:absolute;top:10px;left:10px;width:300px;height:200px;overflow-y:auto;">
        <div style="height:1000px;position:relative;">
          <button style="position:absolute;top:600px;left:10px;width:100px;height:44px;">Clipped</button>
        </div>
      </div>
      <button style="position:fixed;top:-9999px;left:10px;width:100px;height:44px;">Unreachable</button>
    `);

    const results = await auditInteractiveElements(page, ['body']);
    const clipped = results.find((r) => r.name === 'Clipped');
    const unreachable = results.find((r) => r.name === 'Unreachable');
    if (!clipped || !unreachable) {
      throw new Error(
        'Fixture setup failed — expected both a "Clipped" and an "Unreachable" button in the audit.',
      );
    }

    // The button's raw flow position (scroller top 10px + 600px down = 610px)
    // is well inside the 700px window, but the scroller only shows its first
    // 200px (10-210px) before clipping. `reachable` must come from scrolling
    // it into its *own* clipping ancestor, not from a window-bounds check.
    expect(
      clipped.reachable,
      'a control past a scrolling ancestor clip should be reachable via scrollIntoView',
    ).toBe(true);
    expect(
      clipped.hitOk,
      "a control scrolled into its clipping ancestor's view should hit-test to itself, not a stale position",
    ).toBe(true);

    // `position: fixed` ignores every ancestor's scroll offset, so no amount
    // of scrolling can ever bring it into the viewport — the genuine class-2
    // case (present in the DOM, permanently unreachable) this helper must
    // still catch, so the fix above cannot be loosened into "always assume
    // reachable" without this failing.
    expect(
      unreachable.reachable,
      'a position:fixed control off the top of the viewport has no scrollable ancestor that can reach it',
    ).toBe(false);
  });
});

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
// The one remaining deliberate exception: an element that sits behind the
// currently open Wind/Time popover and is not part of it — a control on the
// Layers sheet the popover is legitimately floating over (group 4's "layers
// sheet and wind popover both open" allows exactly this pair, and the
// separate "every control in the popover is clickable" test proves the
// popover, not the sheet, wins the hit test there). `auditInteractiveElements`
// tells that apart from a real clipping regression by checking whether the
// *un-hit* element is geometrically inside the currently-open overlay's own
// DOM subtree: a control that is part of the popover/sheet is always
// asserted normally (that is exactly where a clipping regression would
// reappear); a control merely covered by a deliberately-floating popover is
// skipped. This cannot silently swallow a repeat of the original bug,
// because the original bug's buttons *were* inside the clipping ancestor's
// subtree.
//
// Until BACKLOG R42, there was a second exception here: on a phone, the
// Layers sheet ran to `bottom: 0` and covered `.chrome-bottomleft` (the rail
// and the ConditionsBar) outright while open, which included the Wind
// control every wind-dependent layer needs — so the flagship "sweep the wind
// while the layer list is open" move was unreachable on the one device this
// product is used on (`docs/AUDIT-PRODUCT.md`, 2026-08-07 pass). That
// occlusion is gone: the mobile sheet now reserves clearance for
// `.chrome-bottomleft` instead of painting over it
// (`apps/web/src/index.css`), so nothing in the persistent chrome should ever
// be `coveredByOpenOverlay` again. Group 4 below (now run at MOBILE as well
// as DESKTOP) is the direct geometric proof of that — it fails loudly if a
// future change reintroduces the overlap, rather than this test silently
// re-widening its own exemption to match.
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
    {
      // The offline region picker (R4). It shares the drawer slot with the
      // Layers sheet and carries the app's only sticky-positioned element, so
      // it is the panel most likely to reintroduce the clipping bug.
      name: 'region picker open',
      setup: async (page) => {
        await openRegionPicker(page);
        await waitForRectStable(page.locator('.rl-sheet'));
      },
    },
  ];

  for (const viewport of [DESKTOP, MOBILE]) {
    for (const state of states) {
      test(`${viewport.width}px — ${state.name}`, async ({ page }) => {
        await gotoAndSettle(page, viewport);
        await state.setup(page);

        const elements = await auditInteractiveElements(page, ['.map-chrome', '.rl-sheet']);
        expect(
          elements.length,
          'expected at least some interactive chrome to audit',
        ).toBeGreaterThan(0);

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
      expect(
        boxDelta(before, after),
        `"${name}" moved ${boxDelta(before, after).toFixed(1)}px on click`,
      ).toBeLessThanOrEqual(4);
    }
  });

  test('opening the wind popover from a closed panel does not move the trigger', async ({
    page,
  }) => {
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
    expect(
      boxDelta(before, after),
      `Wind trigger moved ${boxDelta(before, after).toFixed(1)}px on click`,
    ).toBeLessThanOrEqual(4);
  });

  // --- Regression guards for a real defect this suite caught. `.chrome-
  // bottomleft` (Rail + ConditionsBar together) used to be translated 372px
  // by `apps/web/src/index.css` whenever the Layers sheet opened, and both
  // the Layers button and the Wind button lived inside that same translated
  // group — so opening *or* closing the sheet moved its own trigger, the
  // exact failure class this suite exists to catch, reproduced via a
  // different code path than the one already fixed for the wind/time
  // editors themselves. Fixed by reserving vertical clearance for the sheet
  // instead of displacing the trigger's group (`apps/web/src/index.css`) and
  // by decoupling the sheet's open state from the popovers' (`App.tsx`), so
  // opening one no longer force-closes the other. These two tests now pass
  // honestly; keep them, they are what would catch a repeat.

  // `390px — tapping the Layers cell must not move the Layers button itself`,
  // below, used to run at DESKTOP too. `BACKLOG R63` retired that half: the
  // desktop dock is persistent chrome, not a togglable sheet behind a
  // `CommandBar` "Layers" button — there is no such button to test once the
  // dock is expanded (`App.tsx`'s `chrome-command-bar-wrap--dock-open`
  // hides the whole bar there). The claim this test made is still real on a
  // phone, where `CommandBar` is the *only* way to reach the drawer, so it
  // is rescoped rather than deleted; the desktop half of "does the trigger
  // move" is the new dock test directly below it, which asks the equivalent
  // question of the control that actually exists there now.
  test('390px — tapping the Layers cell must not move the Layers button itself', async ({
    page,
  }) => {
    await gotoAndSettle(page, MOBILE);
    await closeLayersSheet(page); // start closed, so the click below is a clean *open*

    const trigger = page.getByRole('button', { name: 'Layers' });
    const before = await measureBox(trigger);
    await trigger.click();
    await waitForRectStable(trigger);
    const after = await measureBox(trigger);

    expect(
      boxDelta(before, after),
      `Layers button moved ${boxDelta(before, after).toFixed(1)}px when the drawer it opens ` +
        `slid its own trigger sideways with it.`,
    ).toBeLessThanOrEqual(4);
  });

  /**
   * The desktop dock's own version of trigger stability (`BACKLOG R63`,
   * `docs/design/PLAN-direction-a.md` §f: "collapsing/expanding the dock
   * must not move the conditions cluster or the top-right rail").
   *
   * There is no single "trigger" to re-measure here the way the old Layers
   * button had one — collapsing the dock removes the trigger that opened it
   * from the DOM outright (`CommandBar`'s "Layers" cell only exists while
   * the dock is *already* collapsed) and replaces it with a different
   * control in a different place. So the claim this test actually makes is
   * the one the plan states directly: the chrome that is *not* the dock —
   * the conditions cluster and the top-right rail — must never move,
   * through a full collapse-then-reopen cycle. `apps/web/src/index.css`
   * makes this true by reserving `layout.dock-width` as a permanent left
   * margin for `.chrome-bottomleft`, whether the dock is currently expanded
   * or collapsed, rather than only while it is expanded — see that rule's
   * own comment for the reasoning. This test is the direct proof.
   */
  test('1440px — collapsing then expanding the dock must not move the conditions cluster or the top-right rail', async ({
    page,
  }) => {
    await gotoAndSettle(page, DESKTOP);
    await waitForRectStable(page.locator('.rl-dock'));

    const conditions = page.locator('.rl-conditions');
    const rail = page.locator('.chrome-topright .rl-rail');
    const before = { conditions: await measureBox(conditions), rail: await measureBox(rail) };

    await page.getByRole('button', { name: 'Collapse dock' }).click();
    await waitForRectStable(page.locator('.rl-dock'));
    const collapsed = { conditions: await measureBox(conditions), rail: await measureBox(rail) };
    expect(
      boxDelta(before.conditions, collapsed.conditions),
      `conditions cluster moved ${boxDelta(before.conditions, collapsed.conditions).toFixed(1)}px when the dock collapsed`,
    ).toBeLessThanOrEqual(1);
    expect(
      boxDelta(before.rail, collapsed.rail),
      `top-right rail moved ${boxDelta(before.rail, collapsed.rail).toFixed(1)}px when the dock collapsed`,
    ).toBeLessThanOrEqual(1);

    await page.getByRole('button', { name: 'Layers, stands and sightings' }).click();
    await waitForRectStable(page.locator('.rl-dock'));
    const reopened = { conditions: await measureBox(conditions), rail: await measureBox(rail) };
    expect(
      boxDelta(before.conditions, reopened.conditions),
      `conditions cluster moved ${boxDelta(before.conditions, reopened.conditions).toFixed(1)}px when the dock re-expanded`,
    ).toBeLessThanOrEqual(1);
    expect(
      boxDelta(before.rail, reopened.rail),
      `top-right rail moved ${boxDelta(before.rail, reopened.rail).toFixed(1)}px when the dock re-expanded`,
    ).toBeLessThanOrEqual(1);
  });

  test('opening the wind popover while the Layers sheet is open must not move the Wind trigger', async ({
    page,
  }) => {
    // Default load state: sheet already open. Opening the wind popover no
    // longer force-closes it (App.tsx tracks them independently), and both
    // should now end up open at once — the flagship "sweep the wind while
    // watching the layer list" move this app is built around.
    await gotoAndSettle(page, DESKTOP);
    await waitForRectStable(page.locator('.chrome-bottomleft'));

    const trigger = page.getByRole('button', { name: /Wind from/ });
    const before = await measureBox(trigger);
    await trigger.click();
    await waitForRectStable(trigger);
    const after = await measureBox(trigger);

    expect(
      boxDelta(before, after),
      `Wind trigger moved ${boxDelta(before, after).toFixed(1)}px when its popover opened.`,
    ).toBeLessThanOrEqual(4);
    await expect(page.locator('.rl-sheet'), 'the Layers sheet should stay open').toBeVisible();
    await expect(page.locator('.rl-popover'), 'the wind popover should have opened').toBeVisible();
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
  const panels: Array<{ name: string; setup: (page: Page) => Promise<void> }> = [
    // The layers sheet's toggles are the largest population of controls in
    // the app, and it is open by default.
    { name: 'layers sheet', setup: async () => {} },
    // The region picker's segmented area/detail rows are the app's densest row
    // of buttons — four across a 360px drawer — which is exactly where a
    // sub-44px control appears without anyone noticing.
    { name: 'region picker', setup: openRegionPicker },
  ];

  for (const viewport of [DESKTOP, MOBILE]) {
    for (const panel of panels) {
      test(`${viewport.width}px — ${panel.name}`, async ({ page }) => {
        await gotoAndSettle(page, viewport);
        await panel.setup(page);
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
  }
});

// ---------------------------------------------------------------------------
// 4. No chrome collisions
// ---------------------------------------------------------------------------
//
// The floating map controls must never overlap each other's bounding boxes —
// two glass surfaces stacked on top of one another is unreadable and the
// underneath one becomes an elementFromPoint trap for whatever is on top.
//
// Run at MOBILE, unchanged (`BACKLOG R37`) — the mobile chrome this group
// checks (`CommandBar` toggling a floating sheet) is untouched by the desktop
// dock (`BACKLOG R63`). Until `BACKLOG R42` this group was desktop only, on
// the reasoning that the mobile Layers sheet was *designed* to cover the
// bottom rail while open — an intentional overlap, not a collision to flag.
// That reasoning is why nothing here ever measured the mobile arrangement,
// and it is also why nobody noticed the mobile sheet covered the one control
// (Wind) every wind-dependent layer needs, making the product's flagship
// move unreachable on a phone. R42 removed the overlap instead of
// re-justifying it, so there is nothing left to exempt: the mobile chrome
// must hold the exact same "nothing collides" contract the desktop chrome
// always has, at every state below. The last two cases cover the sheet and a
// popover open together — see those tests for the one pair excluded from the
// check and why, and note that pairing was *impossible* to reach on a phone
// before R42 (the popover's trigger was covered by the sheet it now opens
// over).
//
// DESKTOP used to share this exact loop and was retired to its own block
// below ("4b") rather than re-run as-is — re-running it unmodified against
// the dock would have passed for the wrong reason. `PERSISTENT` below
// requires `command bar` to be *present* (`rectOf` returning a non-null
// rect), but `CommandBar` is now `display: none` on desktop whenever the
// dock is expanded (`chrome-command-bar-wrap--dock-open`,
// `apps/web/src/index.css`) — its element is still in the DOM, so
// `getBoundingClientRect()` returns a real, non-null, all-zero rect rather
// than `null`. `expectPresent`'s check is `.not.toBeNull()`, so that
// zero-area rect would have silently satisfied it, and a zero-area rect
// never overlaps anything by construction (`rectsOverlap`'s own math) — the
// exact "a rect the selector failed to find... would make this invariant
// pass for the wrong reason" trap this very file's own comment on
// `assertNoCollisions` already names, reached from a new direction. "4b"
// asserts the dock's states honestly instead, including a positive check
// that a hidden command bar is genuinely zero-area rather than merely
// omitted from the list.
// The four persistent chrome groups that exist in every state this group and
// "4b" below check — passing their names to `assertNoCollisions`'s
// `expectPresent` means a rect that comes back `null` (its selector matched
// nothing) is a loud failure, not a silent "nothing to overlap". Hoisted
// above both describe blocks so "4b" does not need its own, possibly
// drifting, copy.
const PERSISTENT = ['rail (top-right)', 'command bar', 'conditions bar', 'chrome-bottomleft group'];

test.describe('4. No chrome collisions', () => {
  for (const viewport of [MOBILE]) {
    test(`${viewport.width}px — nothing open`, async ({ page }) => {
      await gotoAndSettle(page, viewport);
      await closeLayersSheet(page);
      await assertNoCollisions(page, { expectPresent: PERSISTENT });
    });

    test(`${viewport.width}px — layers sheet open`, async ({ page }) => {
      await gotoAndSettle(page, viewport);
      await waitForRectStable(page.locator('.rl-sheet'));
      await assertNoCollisions(page, { expectPresent: [...PERSISTENT, 'layers sheet'] });
    });

    test(`${viewport.width}px — wind popover open`, async ({ page }) => {
      await gotoAndSettle(page, viewport);
      await closeLayersSheet(page);
      await page.getByRole('button', { name: /Wind from/ }).click();
      await waitForRectStable(page.locator('.rl-popover'));
      await assertNoCollisions(page, { expectPresent: [...PERSISTENT, 'wind/time popover'] });
    });

    test(`${viewport.width}px — region picker open`, async ({ page }) => {
      await gotoAndSettle(page, viewport);
      await openRegionPicker(page);
      await waitForRectStable(page.locator('.rl-sheet'));
      await assertNoCollisions(page, { expectPresent: [...PERSISTENT, 'layers sheet'] });
    });

    /**
     * Only one panel may occupy the drawer slot.
     *
     * The Layers sheet and the region picker are both `.rl-sheet--drawer` and
     * are absolutely positioned at identical coordinates. Two of them open at
     * once would overlap *exactly*, and the one underneath becomes an
     * `elementFromPoint` trap for every control in the one on top — the same
     * failure the popover/sheet stacking bug produced, reached from a new
     * direction. Asserted on the rendered DOM rather than on App's state,
     * because the state being right is not what a user experiences.
     */
    test(`${viewport.width}px — opening the region picker closes the Layers sheet, and vice versa`, async ({
      page,
    }) => {
      await gotoAndSettle(page, viewport); // Layers open by default
      await expect(page.locator('.rl-sheet')).toHaveCount(1);

      // Clicked directly rather than through `openRegionPicker`, which closes the
      // Layers sheet first for the benefit of narrow viewports — that would
      // defang the very thing this asserts.
      await page.getByRole('button', { name: 'Save this area for offline use' }).click();
      await waitForRectStable(page.locator('.rl-sheet'));
      await expect(page.locator('.rl-sheet')).toHaveCount(1);
      await expect(page.getByTestId('region-elevation-story')).toBeVisible();

      await page.getByRole('button', { name: 'Layers' }).click();
      await waitForRectStable(page.locator('.rl-sheet'));
      await expect(page.locator('.rl-sheet')).toHaveCount(1);
      await expect(page.getByTestId('region-elevation-story')).toHaveCount(0);
    });

    // Layers and a popover are independent state (App.tsx) and can both be
    // open at once — the product's flagship move is sweeping the wind dial
    // while watching the layer list. Before R42 this pairing was reachable at
    // DESKTOP only: on a phone the sheet physically covered the Wind trigger,
    // so there was no way to *open* the popover while the sheet was open in
    // the first place. The four *persistent* chrome groups (the top-right
    // rail, the command bar, the conditions bar, their bottom-left container)
    // must still never collide with anything, sheet included, at either
    // viewport. The one pair
    // excluded here is the sheet and the popover themselves: a popover is, by
    // definition, a transient overlay anchored to its trigger and free to
    // float over other panels — the same way a native `<select>` dropdown is
    // allowed to cover page content beneath it. That is a different thing
    // from two *persistent* glass panels landing on top of one another, which
    // is what this invariant exists to catch.
    test(`${viewport.width}px — layers sheet and wind popover both open`, async ({ page }) => {
      await gotoAndSettle(page, viewport); // sheet already open by default
      await page.getByRole('button', { name: /Wind from/ }).click();
      await waitForRectStable(page.locator('.rl-popover'));
      await expect(page.locator('.rl-sheet')).toBeVisible();
      await assertNoCollisions(page, {
        allow: [['layers sheet', 'wind/time popover']],
        expectPresent: [...PERSISTENT, 'layers sheet', 'wind/time popover'],
      });
    });

    /**
     * The invariant that the `allow` above needs to be safe.
     *
     * Whitelisting an overlap says "these two are *meant* to share space". It
     * says nothing about which one a click lands on, and that is a separate
     * question decided by stacking contexts rather than by rectangles. This
     * exact pair passed the collision test while every control in the popover
     * was dead: `.rl-popover` sets `z-index: 25` against a sheet at 20, but
     * `.rl-conditions` creates a stacking context with `backdrop-filter`, and
     * `.rl-sheet` is a *sibling* of `.map-chrome` rather than a descendant — so
     * the comparison that actually decided paint order was `.map-chrome`'s 10
     * against the sheet's 20. That fix (`.map-chrome { z-index: 30 }`) used to
     * be scoped to desktop, on the reasoning that the mobile sheet was meant to
     * sit on top of the rail/conditions row anyway; R42 made it unconditional,
     * so this is now the direct proof it also holds at MOBILE, where the pairing
     * was unreachable before R42 at all.
     *
     * So: whenever an overlap is deliberately allowed, the thing on top must be
     * proven to be on top by hit-testing, not assumed from its z-index.
     */
    test(`${viewport.width}px — every control in the popover is clickable while the sheet is open`, async ({
      page,
    }) => {
      await gotoAndSettle(page, viewport); // sheet already open by default
      await page.getByRole('button', { name: /Wind from/ }).click();
      await waitForRectStable(page.locator('.rl-popover'));
      await expect(page.locator('.rl-sheet')).toBeVisible();

      const dead = await page.evaluate(() => {
        const popover = document.querySelector('.rl-popover');
        if (!popover) throw new Error('popover not open');
        const out: Array<{ label: string; hit: string }> = [];
        for (const el of popover.querySelectorAll('button, input, select, a[href]')) {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          if (!(hit === el || el.contains(hit))) {
            out.push({
              label: (el.textContent ?? '').trim().slice(0, 16) || el.tagName,
              hit: hit ? `${hit.tagName}.${hit.className}` : 'null',
            });
          }
        }
        return out;
      });

      expect(
        dead,
        dead
          .map((d) => `popover control "${d.label}" is painted but a click there lands on ${d.hit}`)
          .join('\n'),
      ).toEqual([]);

      // And prove it end to end: Playwright's actionability check fails on an
      // intercepted click, so this would have caught the defect on its own —
      // and on a phone, this exact click is the flagship "sweep the wind"
      // move R42 was about, performed with the Layers sheet still open.
      await page.getByRole('button', { name: 'NW', exact: true }).click({ timeout: 5000 });

      // R42's actual prize: with the sheet still open and wind now set,
      // bedding (which every wind-dependent layer correctly refuses to render
      // without one) must have gone from disabled to enabled with no panel
      // ever closed in between.
      await expect(page.getByRole('checkbox', { name: /Bedding likelihood/ })).toBeEnabled();
    });
  }
});

// ---------------------------------------------------------------------------
// 4b. No chrome collisions — the desktop dock (BACKLOG R63)
// ---------------------------------------------------------------------------
//
// The desktop half of group 4, rewritten rather than re-run — see that
// group's own comment for exactly why re-running it unmodified would have
// passed for the wrong reason once `CommandBar` can be present-but-invisible.
test.describe('4b. No chrome collisions — desktop dock', () => {
  test('1440px — dock expanded (default): nothing collides, and the command bar is genuinely inert, not just excluded from this check', async ({
    page,
  }) => {
    await gotoAndSettle(page, DESKTOP); // dock expanded, Layers tab, by default
    await waitForRectStable(page.locator('.rl-dock'));

    const rects = await collectChromeRects(page);

    // The positive half of "genuinely inert". `CommandBar`'s wrapper is
    // `visibility: hidden`, not `display: none` — the first version of this
    // rule used `display: none` and this very test caught the regression it
    // caused: removing the wrapper from `.chrome-bottomleft`'s flex row
    // reflowed `ConditionsBar` 208px left the instant the dock expanded,
    // failing the trigger-stability test directly above this one.
    // `visibility: hidden` keeps the box in flow (so nothing reflows) while
    // removing it from hit-testing and the accessibility tree — asserted
    // here as "a tap at its centre lands on the map, not the button", the
    // same rendered-state proof this whole file insists on rather than
    // trusting the CSS property name alone.
    expect(
      rects.commandBar,
      'CommandBar should still be in the DOM, occupying its normal box',
    ).not.toBeNull();
    const commandBarHit = await page.evaluate((rect) => {
      const el = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return el ? `${el.tagName}.${el.className}` : 'null';
    }, rects.commandBar!);
    expect(
      commandBarHit,
      `expected a tap where the command bar sits to miss it while the dock is expanded, landed on ${commandBarHit}`,
    ).not.toMatch(/rl-command/);

    expect(rects.dock, 'expected the dock to be present').not.toBeNull();
    expect(
      rects.dock!.width,
      'dock should hold close to its declared 300px width while expanded',
    ).toBeGreaterThan(250);

    // The generic matrix, minus `command bar` (genuinely absent right now,
    // proven above) and plus the nested Layers `.rl-sheet`, which is real
    // here (default tab).
    await assertNoCollisions(page, {
      expectPresent: [
        'rail (top-right)',
        'conditions bar',
        'chrome-bottomleft group',
        'layers sheet',
      ],
    });

    // The dock's own pairings — not in the generic matrix at all (a nested
    // or overlaying `.rl-sheet` is *expected* to sit inside/above the dock's
    // own bounds, so folding `dock` into that matrix would fail for a
    // non-defect reason; see `collectChromeRects`' own doc comment on
    // `dock`). What must never happen is the dock landing on top of the
    // *persistent* chrome its own reserved margin exists to keep clear of.
    for (const [name, rect] of [
      ['top-right rail', rects.railTopRight],
      ['conditions bar', rects.conditions],
      ['chrome-bottomleft group', rects.bottomLeftGroup],
    ] as const) {
      expect(rect, `expected to find "${name}"`).not.toBeNull();
      expect(
        rectsOverlap(rects.dock, rect),
        `dock and ${name} overlap: ${JSON.stringify(rects.dock)} vs ${JSON.stringify(rect)}`,
      ).toBe(false);
    }
  });

  test('1440px — dock collapsed: the command bar re-appears in exactly the reserved spot, and nothing collides', async ({
    page,
  }) => {
    await gotoAndSettle(page, DESKTOP);
    await page.getByRole('button', { name: 'Collapse dock' }).click();
    await waitForRectStable(page.locator('.rl-dock'));

    const rects = await collectChromeRects(page);
    expect(
      rects.dock,
      'the dock stays mounted while collapsed — it animates width, it does not unmount (see its own doc comment on why)',
    ).not.toBeNull();
    expect(rects.dock!.width, 'collapsed dock should hold ~0 width').toBeLessThanOrEqual(1);

    expect(rects.commandBar, 'command bar should be visible again once collapsed').not.toBeNull();
    expect(
      (rects.commandBar?.width ?? 0) > 0 && (rects.commandBar?.height ?? 0) > 0,
      `command bar should have real, positive area once the dock is collapsed, was ${JSON.stringify(rects.commandBar)}`,
    ).toBe(true);

    await assertNoCollisions(page, { expectPresent: PERSISTENT });
  });

  /**
   * §c gap 1's own resolution, proven end to end: the offline picker opens
   * as an overlay *above* the dock (the dock stays mounted underneath it,
   * not collapsed), and a click on the picker's own controls lands on the
   * picker — never falls through to the dock it is covering.
   */
  test('1440px — the offline picker opens as a real overlay above the dock, and its controls are what a click lands on', async ({
    page,
  }) => {
    await gotoAndSettle(page, DESKTOP); // Layers tab open, one .rl-sheet (nested)
    await expect(page.locator('.rl-sheet')).toHaveCount(1);

    await page.getByRole('button', { name: 'Download this area' }).click();
    await waitForRectStable(page.locator('.rl-sheet'));

    // Still exactly one `.rl-sheet` — the nested drawer's own unmounted the
    // instant `drawerSlotShowsTabs` (`App.tsx`) turned false, so there is
    // never a second one for the picker's to stack on top of.
    await expect(page.locator('.rl-sheet')).toHaveCount(1);
    await expect(page.getByTestId('region-elevation-story')).toBeVisible();

    const rects = await collectChromeRects(page);
    expect(rects.dock, 'the dock stays mounted and expanded underneath the picker').not.toBeNull();
    expect(
      rects.dock!.width,
      'the dock must not have collapsed just because the picker opened',
    ).toBeGreaterThan(250);
    // The overlap this arrangement predicts, and exactly why `dock` is
    // deliberately absent from the generic pairwise matrix above: the
    // picker is *meant* to paint over the dock's own space, not stand
    // beside it.
    expect(
      rectsOverlap(rects.sheet, rects.dock),
      'expected the offline picker to overlap the dock it is covering',
    ).toBe(true);

    // And the overlap is real, not just geometric — the same hit-test proof
    // group 4's "every control in the popover is clickable" already runs
    // for the wind popover, applied here to the picker sitting over the
    // dock instead.
    const dead = await page.evaluate(() => {
      const sheet = document.querySelector('.rl-sheet');
      if (!sheet) throw new Error('sheet not open');
      const out: Array<{ label: string; hit: string }> = [];
      for (const el of sheet.querySelectorAll('button, input, select, a[href]')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        if (!(hit === el || el.contains(hit))) {
          out.push({
            label: (el.textContent ?? '').trim().slice(0, 16) || el.tagName,
            hit: hit ? `${hit.tagName}.${hit.className}` : 'null',
          });
        }
      }
      return out;
    });
    expect(
      dead,
      dead
        .map((d) => `picker control "${d.label}" is painted but a click there lands on ${d.hit}`)
        .join('\n'),
    ).toEqual([]);
  });

  /**
   * The dock's own version of "only one panel may occupy the drawer slot"
   * (group 4's mobile/original test, above) — restated for a model where
   * closing the picker does not need to remember which tab to reopen,
   * because `drawerTab` was never touched while it was open
   * (`openOfflinePicker`'s own doc comment in `App.tsx`).
   */
  test('1440px — closing the offline picker restores whichever tab was showing, with no extra `.rl-sheet` ever mounted', async ({
    page,
  }) => {
    await gotoAndSettle(page, DESKTOP);
    await page.getByRole('tab', { name: 'Stands' }).click();
    await waitForRectStable(page.locator('.rl-drawer'));
    await expect(page.getByRole('tab', { name: 'Stands', selected: true })).toBeVisible();

    await page.getByRole('button', { name: 'Download this area' }).click();
    await waitForRectStable(page.locator('.rl-sheet'));
    await expect(page.locator('.rl-sheet')).toHaveCount(1);
    // The tab strip is part of the nested drawer, which unmounted along with
    // its Sheet.
    await expect(page.getByRole('tablist')).toHaveCount(0);

    await page.getByRole('button', { name: 'Close panel' }).click(); // RegionPicker's own close
    await waitForRectStable(page.locator('.rl-drawer'));
    await expect(page.locator('.rl-sheet')).toHaveCount(1);
    await expect(page.getByRole('tab', { name: 'Stands', selected: true })).toBeVisible();
  });
});

async function assertNoCollisions(
  page: Page,
  opts: { allow?: Array<[string, string]>; expectPresent?: string[] } = {},
): Promise<void> {
  const allow = new Set((opts.allow ?? []).map(([a, b]) => [a, b].sort().join('|')));
  const rects = await collectChromeRects(page);
  const named: Array<[string, typeof rects.sheet]> = [
    ['rail (top-right)', rects.railTopRight],
    ['command bar', rects.commandBar],
    ['conditions bar', rects.conditions],
    // NOTE: `chrome-bottomleft group` is deliberately absent from this list.
    // It is the *container* of the command bar and the conditions bar, so it
    // overlaps both of them by construction and a pairwise check against it
    // can only ever fail. It still appears in `expectPresent` below, which is
    // what actually guards against a selector silently matching nothing — the
    // reason it was added in the first place.
    ['layers sheet', rects.sheet],
    ['wind/time popover', rects.popover],
  ];

  // Presence and overlap are deliberately checked against *different* lists.
  // Everything the app renders should be assertable as present, including
  // container elements — but a container can only ever "overlap" its own
  // children, so it must not enter the pairwise matrix.
  const presence: Array<[string, typeof rects.sheet]> = [
    ...named,
    ['chrome-bottomleft group', rects.bottomLeftGroup],
  ];

  // A rect the selector failed to find comes back `null`, and `rectsOverlap`
  // treats `null` as "nothing to overlap with" — so a future rename or a
  // layout change that stops a selector matching would make this invariant
  // pass for the wrong reason: it would have stopped looking, not confirmed
  // there is no collision. Anything the caller says must exist in this state
  // is asserted present before the loop runs at all.
  for (const requiredName of opts.expectPresent ?? []) {
    const entry = presence.find(([name]) => name === requiredName);
    if (!entry)
      throw new Error(
        `assertNoCollisions: no rect named "${requiredName}" — check the caller's spelling.`,
      );
    expect(
      entry[1],
      `expected to find "${requiredName}" in this state, but its selector matched nothing — ` +
        `a missing rect silently reads as "no collision", which would hide a real regression.`,
    ).not.toBeNull();
  }

  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      const [nameA, rectA] = named[i];
      const [nameB, rectB] = named[j];
      if (allow.has([nameA, nameB].sort().join('|'))) continue;
      expect(
        rectsOverlap(rectA, rectB),
        `${nameA} and ${nameB} overlap: ${JSON.stringify(rectA)} vs ${JSON.stringify(rectB)}`,
      ).toBe(false);
    }
  }

  // The command bar and the conditions bar are checked above as two separate
  // rects, which does not cover the gap *between* them — a sheet edge landing
  // inside that gap would pass both of those checks while still visually
  // overlapping the bottom-left cluster as a whole. Checking
  // `.chrome-bottomleft`'s own bounding box against the sheet closes that
  // gap. Not run against the popover or folded into the loop above: the
  // popover is anchored to a cell *inside* this same group and legitimately
  // overlaps its own row's neighbour (the command bar) the same way it
  // overlaps the sheet — see the "both open" test's comment for why that
  // specific pairing is allowed.
  if (rects.bottomLeftGroup && rects.sheet) {
    expect(
      rectsOverlap(rects.bottomLeftGroup, rects.sheet),
      `chrome-bottomleft (command bar + conditions bar) and layers sheet overlap: ` +
        `${JSON.stringify(rects.bottomLeftGroup)} vs ${JSON.stringify(rects.sheet)}`,
    ).toBe(false);
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
    // The starting point used to be `CommandBar`'s "Layers" button — on
    // desktop that control is `visibility: hidden` whenever the dock is
    // expanded (`BACKLOG R63`; the layers sheet is open by default, which is
    // exactly this test's own setup), so focusing it is no longer a
    // meaningful starting point there. The `TabBar` tab of the same name is
    // always real and focusable whenever the layers sheet itself is showing,
    // on both the desktop dock and the mobile drawer.
    await page.getByRole('tab', { name: 'Layers' }).focus();

    const stops = await tabThroughChrome(page);
    expect(stops.length, 'expected to walk more than a couple of tab stops').toBeGreaterThan(3);
    const unmarked = stops.filter((s) => !s.ok);
    expect(
      unmarked,
      unmarked
        .map((s) => `"${s.name}" (${s.tag}) received focus with no visible outline or box-shadow.`)
        .join('\n'),
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
      unmarked
        .map((s) => `"${s.name}" (${s.tag}) received focus with no visible outline or box-shadow.`)
        .join('\n'),
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
 *
 * `.rl-drawer` joined the scoped roots alongside `.map-chrome`/`.rl-sheet`/
 * `.rl-popover` when the desktop dock landed (`BACKLOG R63`) — `TabBar`
 * (Layers/Stands/Sightings) is a sibling of the nested `.rl-sheet`, not a
 * descendant of it, so a starting anchor inside the tab strip (which the
 * dock now requires — see the "layers sheet" focus test's own comment for
 * why `CommandBar`'s "Layers" button is no longer a usable one) could never
 * record a single stop without this: the very next tab press lands on
 * another tab, still outside every previously-scoped root, and the loop
 * would exit immediately having recorded nothing.
 */
async function tabThroughChrome(page: Page, maxStops = 60): Promise<FocusStop[]> {
  const stops: FocusStop[] = [];
  let previousKey: string | null = null;

  for (let i = 0; i < maxStops; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      const inChrome = el?.closest('.map-chrome, .rl-sheet, .rl-popover, .rl-drawer');
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

  test('region picker', async ({ page }) => {
    // The picker carries the app's longest body copy — the elevation-only
    // sentence and the server's download warnings — over glass on a live map.
    // Both are sentences a hunter has to actually read at 22:00 to make a
    // decision, and both sit on the one surface in the app with a `sticky`
    // element and a second background colour behind it.
    await gotoAndSettle(page, DESKTOP);
    await openRegionPicker(page);
    await assertChromeContrast(page, ['.map-chrome', '.rl-sheet']);
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
    expect(
      density,
      `Layers sheet content fills only ${(density * 100).toFixed(0)}% of its chassis`,
    ).toBeGreaterThanOrEqual(0.4);
  });

  test('wind popover — sized to its own content, not an oversized chassis', async ({ page }) => {
    await gotoAndSettle(page, DESKTOP);
    await closeLayersSheet(page);
    await page.getByRole('button', { name: /Wind from/ }).click();
    await waitForRectStable(page.locator('.rl-popover'));
    const density = await measureDensity(page, '.rl-popover', '.rl-popover__body');
    expect(
      density,
      `Wind popover content fills only ${(density * 100).toFixed(0)}% of its chassis`,
    ).toBeGreaterThanOrEqual(0.4);
  });

  /**
   * The dock's own density claim (`BACKLOG R63`,
   * `docs/design/PLAN-direction-a.md` §f: "a dock that shrinks to nothing
   * over time as other chrome grows is exactly the F7-class defect
   * (`docs/AUDIT-PRODUCT.md`) the old rail died of"). A fixed 300px panel is
   * a different shape of claim from the two tests above — "content fills
   * ≥40% of whatever height it was given" says nothing about whether the
   * *width* itself is still what was promised. This reads the same token
   * the component itself is built from (`layout.dock-width`,
   * `packages/design/src/tokens.ts`) rather than hard-coding `300`, so a
   * deliberate token change never has to touch this file, and only a
   * regression that makes the *rendered* dock disagree with its own
   * declared width fails it.
   */
  test('1440px — the dock holds its declared width, expanded, rather than a percentage of something else', async ({
    page,
  }) => {
    await gotoAndSettle(page, DESKTOP);
    await waitForRectStable(page.locator('.rl-dock'));

    const declaredWidth = await page.evaluate(() => {
      const px = getComputedStyle(document.documentElement).getPropertyValue('--layout-dock-width');
      return parseFloat(px);
    });
    expect(
      declaredWidth,
      'expected --layout-dock-width to resolve to a real px figure',
    ).toBeGreaterThan(0);

    const dockWidth = await page
      .locator('.rl-dock')
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(
      dockWidth,
      `dock rendered at ${dockWidth.toFixed(1)}px, expected within 1px of the declared ${declaredWidth}px`,
    ).toBeGreaterThanOrEqual(declaredWidth - 1);
  });
});

async function measureDensity(
  page: Page,
  panelSelector: string,
  bodySelector: string,
): Promise<number> {
  return page.evaluate(
    ({ panelSelector, bodySelector }: { panelSelector: string; bodySelector: string }) => {
      const panel = document.querySelector(panelSelector);
      const body = document.querySelector(bodySelector);
      if (!panel || !body)
        throw new Error(`Panel or body not found: ${panelSelector} / ${bodySelector}`);
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

// ---------------------------------------------------------------------------
// 9. Offline coverage describes the view on screen
// ---------------------------------------------------------------------------
//
// The failure class here is the one CLAUDE.md names as the worst this product
// has: the app telling a hunter that ground is downloaded when it is not. It
// used to do exactly that. The Layers sheet sampled `store.stats().tileCount
// > 0` once at mount and rendered the result behind the words "Offline ready —
// elevation for **this area** is stored on this device". One tile anywhere on
// earth made every view read green, and it stayed green after panning five
// hundred miles. A hunter reads that at the trailhead, walks in at 04:30, and
// the analysis engine has nothing to compute from.
//
// Every unit test in the app passed throughout, and so would `getByRole` — the
// chip rendered, the text was legible, the colour was right for the value it
// was given. The value was the lie. So the invariant has to be behavioural:
// **put real tiles on the device for this view, prove the badge says Covered,
// go offline, pan somewhere with nothing stored, and prove the badge never
// says Covered again.** That sequence fails against the old code at the last
// step, and it is the only assertion in this file that would have.
//
// Nothing here is mocked. `helpers/offline.ts` writes real PNG tiles into the
// real OPFS store through the app's own tile-key derivation, and the pan
// happens with the browser context genuinely offline, so no tile can sneak in
// from the network at the destination.
test.describe('9. Offline coverage describes the view on screen', () => {
  // The chip renders `text-transform: uppercase`, so these are what a hunter
  // actually reads. Asserted in rendered casing deliberately — comparing
  // against the source string would be checking what we passed in, not what
  // was painted.
  const COVERED = 'COVERED';
  const NOT_DOWNLOADED = 'NOT DOWNLOADED';

  for (const viewport of [DESKTOP, MOBILE]) {
    test(`${viewport.width}px — a badge earned here is not carried five hundred miles`, async ({
      page,
      context,
    }) => {
      await gotoAndSettle(page, viewport);
      await waitForRectStable(page.locator('.rl-sheet'));

      // 1. A genuinely cold device, then a genuinely downloaded region.
      await clearTiles(page);
      const seeded = await seedTilesForView(page, 1);
      expect(seeded.written, 'fixture should have written tiles').toBeGreaterThan(0);
      await remeasure(page);

      await expect.poll(() => chipText(page), { timeout: 15_000 }).toBe(COVERED);

      // Rendered state, not DOM state: the chip must actually be painted in the
      // "ok" token colour. A class name proves what we asked for; the computed
      // colour is what the user's eye receives.
      expect(await chipColor(page)).toBe(await tokenColor(page, '--color-ok'));

      // 2. No signal, then five hundred miles west — Ohio to Missouri, the pan
      // that used to change nothing at all.
      await context.setOffline(true);
      await jumpTo(page, -92.54, 39.43);

      // 3. The assertion that fails against the old code. Not just the final
      // label: *no frame* after the pan may claim this ground is covered.
      const labels = await observeChipLabels(page, 4000);
      expect(
        labels,
        `after panning 500 miles offline the badge showed: ${labels.join(' → ')}. ` +
          `"Covered" in that sequence means the app told a hunter that ground with no stored ` +
          `elevation is ready to use with no signal.`,
      ).not.toContain(COVERED);

      await expect.poll(() => chipText(page), { timeout: 15_000 }).toBe(NOT_DOWNLOADED);
      expect(await chipColor(page)).toBe(await tokenColor(page, '--color-warn'));

      // And the sheet's full sentence agrees with the chip — the two are
      // rendered from one description, and a drift between them would be the
      // original defect reappearing in the half nobody checks.
      await expect(page.getByTestId('coverage-detail')).toContainText('None of this view');

      await context.setOffline(false);
    });
  }

  test('a half-stored view says Partial and draws where the data ends', async ({ page }) => {
    // "Partial — 43%" tells a hunter they have a problem; the overlay tells them
    // which half of the draw they are missing, which is the part that matters
    // when they are standing in it. Asserted through `queryRenderedFeatures`,
    // which reports what the GL renderer actually drew — a source whose data
    // was set but whose layer never made it into the style comes back empty.
    await gotoAndSettle(page, DESKTOP);
    await waitForRectStable(page.locator('.rl-sheet'));

    await clearTiles(page);
    await seedTilesForView(page, 0.5);
    await remeasure(page);

    await expect.poll(() => chipText(page), { timeout: 15_000 }).toContain('PARTIAL');
    expect(await chipColor(page)).toBe(await tokenColor(page, '--color-warn'));

    await expect
      .poll(() => renderedFeatureCount(page, 'rl-offline-coverage-fill'), { timeout: 15_000 })
      .toBeGreaterThan(0);
  });

  test('a cold device says Not downloaded, and never "ready"', async ({ page }) => {
    await gotoAndSettle(page, DESKTOP);
    await clearTiles(page);
    await remeasure(page);

    await expect.poll(() => chipText(page), { timeout: 15_000 }).toBe(NOT_DOWNLOADED);
    // Nothing measured means nothing to draw. An overlay left over from a
    // previous view would be a hatch that lags the map by one pan.
    expect(await renderedFeatureCount(page, 'rl-offline-coverage-fill')).toBe(0);
  });

  test('the coverage overlay survives a layer toggle', async ({ page }) => {
    // `syncLayers` removes any `rl-*` layer it does not recognise, and the
    // overlay lives under the same prefix — so toggling any layer used to tear
    // the hatch off the map while the badge still said "Partial". Visible,
    // correct text, and the thing that told you *where* silently gone.
    await gotoAndSettle(page, DESKTOP);
    await waitForRectStable(page.locator('.rl-sheet'));

    await clearTiles(page);
    await seedTilesForView(page, 0.5);
    await remeasure(page);
    await expect
      .poll(() => renderedFeatureCount(page, 'rl-offline-coverage-fill'), { timeout: 15_000 })
      .toBeGreaterThan(0);

    await page.getByRole('checkbox', { name: /Bench/i }).first().click();

    await expect
      .poll(() => renderedFeatureCount(page, 'rl-offline-coverage-fill'), { timeout: 15_000 })
      .toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 10. A layer that paints nothing must fail
// ---------------------------------------------------------------------------
//
// `BACKLOG R32`: 166 terrain unit tests and every invariant above were green
// while the shipped bedding layer covered **0.00%** of the map canvas —
// `beddingLikelihood`'s realised range (measured on a real ridge-and-draw DEM:
// max 0.1386, p99 0.1217) sits entirely in the bottom slice of `HEAT_RAMP`'s
// absolute `[0, 1]` domain, so every pixel rendered functionally transparent.
// Every gate that exists checks that the checkbox is checked, the worker
// returned a buffer, or the DOM painted *something* — none of them look at
// what colour actually landed on screen, which is the exact blind spot
// `CLAUDE.md`'s "assert against rendered state" rule exists for. This is that
// assertion for a whole layer instead of one control: enable it, wait for it
// to actually render, and count saturated pixels in the real screenshot.
test.describe('10. Layer paint coverage — a layer that paints nothing must fail', () => {
  // Bedding is the most expensive layer in the engine (VRM over a 9x9 window,
  // shelter, and the corridor-grade slope stats, all on-device); under
  // swiftshader that comfortably outruns the suite's default per-test budget.
  test.setTimeout(900_000);

  for (const viewport of [DESKTOP, MOBILE]) {
    test(`${viewport.width}px — bedding likelihood, NW wind, paints visible colour over the relief`, async ({
      page,
    }) => {
      await gotoAndSettle(page, viewport);

      // On a narrow viewport the Layers sheet is a bottom drawer that covers
      // the rail behind it rather than sliding it clear (documented on
      // `closeLayersSheet` above), so the Wind trigger is unreachable while
      // it is open. Start from a known, closed state on every viewport
      // rather than branching the flow by width.
      await closeLayersSheet(page);

      // Bedding is a leeward model and stays disabled with no wind set
      // (CLAUDE.md: grey out an input-starved layer rather than render a
      // default) — set one before trying to enable the layer.
      await page.getByRole('button', { name: /Wind from/ }).click();
      await waitForRectStable(page.locator('.rl-popover'));
      await page.getByRole('button', { name: 'NW', exact: true }).click();
      await waitForTiles(page);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Layers' }).click();
      const bedding = page.getByRole('checkbox', { name: /Bedding likelihood/ });
      await expect(bedding).toBeEnabled();
      await bedding.click();
      await waitForTiles(page);

      // Close the layers sheet / any open popover so what gets measured is the
      // map, not chrome sitting on top of it.
      await closeLayersSheet(page);
      await page.keyboard.press('Escape');
      await waitForRectStable(page.locator('.chrome-bottomleft'));

      const mapBox = await measureBox(page.getByTestId('map-canvas'));
      const coveragePct = await waitForCoverageStable(page, mapBox);
      // eslint-disable-next-line no-console
      console.log(
        `[R32 invariant] bedding saturated-pixel coverage at ${viewport.width}px: ${coveragePct.toFixed(2)}%`,
      );

      // The regression this guards: 0.00%, measured the same way, on the
      // build this ticket was filed against. 1% is well below what the fixed
      // domain rescale actually produces on either viewport this suite
      // covers (desktop framing shows more of the leeward, saturated side of
      // the terrain than the narrower mobile crop does, so the two numbers
      // differ — both clear 1% by a wide margin) but is comfortably above
      // the ~0.1% floor of stray UI-icon colour (the wind compass glyph,
      // mainly) this metric picks up even when the layer paints nothing at
      // all — see BACKLOG R32.
      expect(
        coveragePct,
        `bedding likelihood painted saturated colour over only ${coveragePct.toFixed(2)}% of the map ` +
          `canvas at ${viewport.width}px — BACKLOG R32 regressed. (0.00-0.1% is the failure this guards; ` +
          `UI-icon noise alone measures well under 1%.)`,
      ).toBeGreaterThan(1);
    });
  }
});

// ---------------------------------------------------------------------------
// 11. The offline region picker actually saves ground (BACKLOG R4)
// ---------------------------------------------------------------------------
//
// `R8` shipped honest coverage reporting: the app now tells a hunter, truthfully,
// that the ground under their view is not downloaded. For one release it then
// offered them nothing to do about it — the rail button was
// `onClick={() => undefined}`, a literal no-op. Honest bad news with no remedy
// is a worse product than the lie it replaced, for anyone who reads that chip
// at the trailhead.
//
// Every test below fails against that build, because there is no panel to open.
// More usefully, they are written to fail against the *plausible wrong
// versions* of this feature as well:
//
//  - a Download button that renders but sits below the fold of a scrolling
//    panel (this happened; it was found by hand-hit-testing, not by a unit
//    test, and `hitTestInPlace` is the assertion that would have caught it);
//  - a tile count and a byte figure sourced from different moments, so the
//    button reads "12 tiles · about 11 MB" (this happened too);
//  - a download that completes without the coverage badge noticing, because
//    R8's probe memo was never invalidated;
//  - a region that reads "Saved" and is not there after a reload;
//  - a storage failure that stops the download silently.
test.describe('11. Offline region picker (R4)', () => {
  // Real tiles over the network into a real OPFS store, plus a full reload.
  test.setTimeout(900_000);

  test.beforeEach(async ({ page }) => {
    await gotoAndSettle(page, DESKTOP);
    await clearTiles(page);
    await clearRegions(page);
  });

  /**
   * The failure class this repo keeps paying for, aimed at the one control
   * that matters most.
   *
   * `auditInteractiveElements` scrolls a candidate into view before hit-testing
   * it, which is right for auditing a long panel and wrong for a primary
   * action: "reachable if you scroll" is not "tappable". This hit-tests where
   * the button actually sits, on the frame the panel opens, at both viewports.
   */
  for (const viewport of [DESKTOP, MOBILE]) {
    test(`${viewport.width}px — the download button is tappable one-handed with no scrolling`, async ({
      page,
    }) => {
      await gotoAndSettle(page, viewport);
      await clearRegions(page);
      await openRegionPicker(page);

      const hit = await hitTestInPlace(page, 'region-download');
      expect(hit.found, 'the picker rendered no download button at all').toBe(true);
      expect(
        hit.ok,
        `the Download button paints at ${Math.round(hit.width)}x${Math.round(hit.height)}px but a ` +
          `tap at its centre lands on ${hit.hit}. A hunter should not have to scroll a panel ` +
          `one-handed in the dark to find the only button that matters.`,
      ).toBe(true);
      expect(hit.height, 'gloved minimum').toBeGreaterThanOrEqual(44);
      expect(hit.width).toBeGreaterThanOrEqual(44);
    });
  }

  /**
   * The estimate has to be shown before committing, and it has to be coherent.
   *
   * Tile count grows 4× per zoom level and nobody's intuition handles that, so
   * both figures are asserted to move together and to actually quadruple. The
   * specific defect pinned here was found by hand: the tile count updated the
   * instant the detail level changed while the byte figure lagged a step
   * behind, producing "Download 12 tiles · about 11 MB" — two numbers from
   * different moments, one of them ten times wrong, on the control about to be
   * pressed.
   */
  test('the estimate is on the button, and the two figures never disagree', async ({ page }) => {
    await openRegionPicker(page);

    const readButton = async (): Promise<{ tiles: number; mb: number }> => {
      const text = await page.getByTestId('region-download').innerText();
      const m = text.match(/Download ([\d,]+) tiles · about ([\d.]+) (kB|MB|GB)/);
      if (!m) throw new Error(`Download button does not quote an estimate: "${text}"`);
      const scale = m[3] === 'GB' ? 1000 : m[3] === 'kB' ? 1 / 1000 : 1;
      return { tiles: Number(m[1].replace(/,/g, '')), mb: Number(m[2]) * scale };
    };

    const seen: Array<{ z: number; tiles: number; mb: number }> = [];
    for (const z of [13, 14, 15]) {
      await page.getByRole('button', { name: `Detail to zoom ${z}` }).click();
      // Deliberately short. The point is that the two figures are derived from
      // one synchronous computation and cannot be caught mid-drift; a generous settle
      // would hide exactly the defect this pins.
      await page.waitForTimeout(150);
      const button = await readButton();
      const detail = await page.getByTestId('region-estimate').innerText();
      // The panel's own figures and the button's must be the same numbers.
      expect(
        detail.replace(/[\s\n]+/g, ' '),
        `the estimate panel and the Download button disagree at z${z}`,
      ).toContain(button.tiles.toLocaleString());
      seen.push({ z, ...button });
    }

    // Roughly 4× per level, in both figures. "Roughly" because a viewport's
    // tile ranges round outward differently at each zoom.
    for (let i = 1; i < seen.length; i++) {
      expect(
        seen[i].tiles,
        `z${seen[i].z} planned ${seen[i].tiles} tiles against z${seen[i - 1].z}'s ` +
          `${seen[i - 1].tiles} — a detail level that does not multiply the download is not ` +
          `telling the user what it costs.`,
      ).toBeGreaterThan(seen[i - 1].tiles * 2);
      expect(seen[i].mb).toBeGreaterThan(seen[i - 1].mb * 2);
    }
  });

  /** The one sentence that explains why these megabytes are worth more than a competitor's. */
  test('the picker states the elevation-only story in plain language', async ({ page }) => {
    await openRegionPicker(page);
    const story = page.getByTestId('region-elevation-story');
    await expect(story).toBeVisible();
    const text = await story.innerText();
    expect(text.toLowerCase()).toContain('elevation');
    // The claim that distinguishes this from every competitor's cache of
    // rendered layer tiles: one download, any wind, any date.
    expect(text.toLowerCase()).toMatch(/any wind/);
    expect(text.toLowerCase()).toMatch(/any date/);
  });

  /**
   * The whole point of the ticket: a download makes R8's badge honestly say
   * Covered, and it is still true after the app has been closed and reopened
   * with no signal.
   *
   * This is the cold start that matters — not "works after I used it online",
   * but "boots from nothing, no signal, app closed since yesterday". The reload
   * happens with the browser context genuinely offline, so nothing can sneak in
   * over the network to rescue it.
   */
  test('a completed download makes the badge say Covered, and it survives an offline reload', async ({
    page,
    context,
  }) => {
    await openRegionPicker(page);
    await expect(page.getByTestId('region-download')).toBeEnabled();
    await page.getByTestId('region-download').click();

    // Wait for the run to finish: the progress panel disappears and the region
    // lands in the list.
    await expect
      .poll(async () => (await page.getByTestId('region-progress').count()) === 0, {
        timeout: 300_000,
      })
      .toBe(true);
    await expect.poll(() => renderedText(page, 'region-list')).toContain('SAVED');
    expect(await storedTileCount(page)).toBeGreaterThan(0);

    // R8's badge must now agree. If `invalidateCoverageCache()` were not
    // called on completion, this would sit on the pre-download verdict for up
    // to twenty seconds and a hunter would be told the download did nothing.
    await page.getByRole('button', { name: 'Layers' }).click();
    await expect.poll(() => chipText(page), { timeout: 60_000 }).toBe('COVERED');
    expect(await chipColor(page)).toBe(await tokenColor(page, '--color-ok'));

    // --- the cold start ---------------------------------------------------
    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('.rl-sheet', { timeout: 120_000 });

    await expect.poll(() => chipText(page), { timeout: 120_000 }).toBe('COVERED');
    await expect(page.getByTestId('coverage-detail')).toContainText('no signal');

    // And the saved-areas list is readable with no signal, because it is a
    // device record rather than a server one. A hunter checking "did that
    // finish?" at the trailhead has no bars.
    await openRegionPicker(page);
    await expect.poll(() => renderedText(page, 'region-list')).toContain('SAVED');
    await expect(page.getByTestId('region-estimate-source')).toContainText('on this device');

    await context.setOffline(false);
  });

  /**
   * Stopping must keep what was downloaded.
   *
   * A cancel that threw away 4 GB of progress would be a worse failure than
   * offering no cancel at all — a hunter on hotel wifi will background the tab,
   * lose the connection, and come back. The region is left `Unfinished` with a
   * real partial count, and resuming finishes it.
   */
  test('stopping keeps what has downloaded, and resuming finishes it', async ({ page }) => {
    await openRegionPicker(page);
    // The doubled box, so there is a run long enough to interrupt.
    await page.getByRole('button', { name: 'Double' }).click();
    await page.waitForTimeout(300);
    await page.getByTestId('region-download').click();

    await expect(page.getByTestId('region-cancel')).toBeVisible({ timeout: 60_000 });
    // Let some tiles actually land before pulling the plug.
    await expect.poll(() => storedTileCount(page), { timeout: 120_000 }).toBeGreaterThan(0);
    await page.getByTestId('region-cancel').click();

    await expect
      .poll(() => renderedText(page, 'region-list'), { timeout: 60_000 })
      .toContain('UNFINISHED');
    const kept = await storedTileCount(page);
    expect(kept, 'a cancel that discards progress is worse than no cancel').toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Resume' }).click();
    await expect
      .poll(async () => (await page.getByTestId('region-progress').count()) === 0, {
        timeout: 600_000,
      })
      .toBe(true);
    await expect.poll(() => renderedText(page, 'region-list')).toContain('SAVED');
    expect(await storedTileCount(page)).toBeGreaterThan(kept);
  });

  /**
   * Degrade loudly.
   *
   * A device that fills up mid-download must say so, in words the user can act
   * on, and the app must stay usable. Silently stopping at 60% and reporting
   * "Saved" is the single worst outcome this product has: it is discovered in
   * the field, in the dark, with no way to fix it.
   *
   * The disk write is the only thing stubbed — everything from the download
   * loop through to the rendered alert is the production path.
   */
  test('running out of storage produces a visible, actionable failure', async ({ page }) => {
    await openRegionPicker(page);
    await failTileWritesAfter(page, 5);
    await page.getByTestId('region-download').click();

    const alert = page.getByRole('alert').filter({ hasText: /ran out of storage/ });
    await expect(alert, 'a quota failure must not be swallowed').toBeVisible({ timeout: 120_000 });
    // Actionable, not just alarming: it has to tell them what survived and
    // what to do next.
    await expect(alert).toContainText(/kept/);
    await expect.poll(() => renderedText(page, 'region-list')).toContain('FAILED');

    // …and the app is still usable. A storage failure that wedges the UI would
    // strand a hunter with neither the region nor the map.
    const layers = await hitTestInPlace(page, 'map-canvas');
    expect(layers.found).toBe(true);
    await page.getByRole('button', { name: 'Layers' }).click();
    await expect(page.locator('.rl-sheet')).toBeVisible();
  });

  /**
   * The panel must never claim persistent storage it did not get.
   *
   * Chromium in this suite refuses `navigator.storage.persist()`, so the chip
   * reads "Evictable" and the warning is shown — which is the correct, honest
   * answer and the one the assertion pins. Assuming a grant is how a region a
   * hunter waited twenty minutes for silently disappears overnight.
   */
  test('the storage chip reports what the browser actually granted', async ({ page }) => {
    await openRegionPicker(page);
    const chip = page.getByTestId('region-storage-chip');
    await expect(chip).toBeVisible();
    const granted = await page.evaluate(() => navigator.storage?.persisted?.() ?? false);
    await expect
      .poll(() => renderedText(page, 'region-storage-chip'), { timeout: 30_000 })
      .toBe(granted ? 'PERSISTENT' : 'EVICTABLE');
    if (!granted) {
      await expect(
        page.getByText(/did not grant persistent storage/),
        'an ungranted request must be stated, not assumed away',
      ).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// 12. Glass containers paint no more than their interactive children (R43, R44)
// ---------------------------------------------------------------------------
//
// The failure class this guards is distinct from both "1. Hit-testability"
// and "3. Touch targets", and neither of those caught it: `.chrome-bottomleft`
// stretched `.rl-rail` to the full width of its mobile corner (~366px on a
// 390px phone), but `.rl-rail__btn` held a *definite* 44px width, so a flex
// item with a definite size never stretched. Each button stayed a correctly
// 44×44, unobstructed, hit-testable island — every existing check passed —
// pinned to the left edge of ~322px of otherwise-identical dark glass that
// belonged to no button at all (`docs/QA-FIELD.md` finding 1). A gloved tap
// anywhere else in that bar landed on nothing, with no border, divider or
// gradient to say why, right next to `.rl-conditions__cell` — genuinely
// tappable edge-to-edge — training the thumb to expect the same rule here.
//
// The check: for a shared-background glass container with more than one
// interactive child, the container's own box must not exceed the union of
// its children's boxes by more than a small tolerance (padding/border, not
// slack for dead space) in either dimension. Run at MOBILE as well as
// DESKTOP — the defect this pins was mobile-only by construction
// (`.chrome-bottomleft`'s `align-items: stretch` override only fires under
// the 860px breakpoint), so a desktop-only version of this check would never
// have caught it.
//
// `.rl-rail` in `.chrome-bottomleft` was replaced by `CommandBar`'s `.rl-
// command` (BACKLOG R44) — the same field-audit constraint applies to its
// cells (`.rl-command__cell`), which is why this group covers it rather than
// trusting the new primitive by construction. `.chrome-topright .rl-rail`
// (zoom/locate) is untouched by R44 and still exercises the original R43
// regression directly.
test.describe('12. Glass container painted surface matches its interactive children (R43, R44)', () => {
  // Generous, not tight: covers `.rl-glass`'s 1px border on each side (2px)
  // plus a few px of sub-pixel/rounding noise. It is nowhere near the ~322px
  // surplus the regression this pins actually produced.
  const TOLERANCE_PX = 12;

  const containers: Array<{ name: string; container: string; children: string }> = [
    {
      name: 'command bar',
      container: '.chrome-bottomleft .rl-command',
      children: '.rl-command__cell',
    },
    { name: 'top-right rail', container: '.chrome-topright .rl-rail', children: '.rl-rail__btn' },
    { name: 'conditions bar', container: '.rl-conditions', children: '.rl-conditions__cell' },
  ];

  for (const viewport of [DESKTOP, MOBILE]) {
    for (const c of containers) {
      test(`${viewport.width}px — ${c.name}`, async ({ page }) => {
        await gotoAndSettle(page, viewport);
        await closeLayersSheet(page);
        await waitForRectStable(page.locator(c.container));

        const { container, childUnion } = await measureGlassSurplus(page, c.container, c.children);
        expect(
          container,
          `${c.name}: container selector "${c.container}" matched nothing`,
        ).not.toBeNull();
        expect(
          childUnion,
          `${c.name}: no visible children matched "${c.children}" to compare against`,
        ).not.toBeNull();

        const widthSurplus = container!.width - childUnion!.width;
        const heightSurplus = container!.height - childUnion!.height;

        expect(
          widthSurplus,
          `${c.name} is ${widthSurplus.toFixed(1)}px wider than the union of its own interactive ` +
            `children (container ${container!.width.toFixed(1)}px vs children ${childUnion!.width.toFixed(1)}px) — ` +
            `that surplus is glass a gloved tap can land on that does nothing.`,
        ).toBeLessThanOrEqual(TOLERANCE_PX);
        expect(
          heightSurplus,
          `${c.name} is ${heightSurplus.toFixed(1)}px taller than the union of its own interactive children.`,
        ).toBeLessThanOrEqual(TOLERANCE_PX);
      });
    }
  }

  /**
   * `TabBar` (`docs/design/PLAN-direction-a.md` §f: "extend this group's
   * coverage to the new `Dock` primitive explicitly, at both viewports") —
   * the exact same hairline-cells-of-equal-flex-share shape as `CommandBar`
   * and the top-right rail above, and genuinely untested by this group
   * until now even though it shipped before the dock did (the tabbed
   * drawer, `d7d861c`). It lives inside `Dock` on desktop and inside the
   * standalone `.rl-drawer` on mobile — the loop above cannot reach it
   * because every one of its cases calls `closeLayersSheet` first, which is
   * exactly what makes `TabBar` disappear (there is nothing to switch tabs
   * *within* once the drawer/dock is closed).
   */
  test.describe('tab bar', () => {
    for (const viewport of [DESKTOP, MOBILE]) {
      test(`${viewport.width}px`, async ({ page }) => {
        await gotoAndSettle(page, viewport); // drawer/dock open, TabBar visible, by default
        await waitForRectStable(page.locator('.rl-tabbar'));

        const { container, childUnion } = await measureGlassSurplus(
          page,
          '.rl-tabbar',
          '.rl-tabbar__tab',
        );
        expect(
          container,
          'tab bar: container selector ".rl-tabbar" matched nothing',
        ).not.toBeNull();
        expect(
          childUnion,
          'tab bar: no visible children matched ".rl-tabbar__tab" to compare against',
        ).not.toBeNull();

        const widthSurplus = container!.width - childUnion!.width;
        const heightSurplus = container!.height - childUnion!.height;
        expect(
          widthSurplus,
          `tab bar is ${widthSurplus.toFixed(1)}px wider than the union of its own tabs (container ` +
            `${container!.width.toFixed(1)}px vs tabs ${childUnion!.width.toFixed(1)}px).`,
        ).toBeLessThanOrEqual(TOLERANCE_PX);
        expect(
          heightSurplus,
          `tab bar is ${heightSurplus.toFixed(1)}px taller than the union of its own tabs.`,
        ).toBeLessThanOrEqual(TOLERANCE_PX);
      });
    }
  });

  /**
   * The dock's own collapse control (desktop only — there is no dock at
   * MOBILE to check). A single-cell row rather than a multi-cell one, which
   * makes it a narrower claim than the others above: there is no *sibling*
   * cell for a stretch bug to leave stranded, only the question of whether
   * the row's own painted background matches the button's real hit area —
   * still the same failure class (a container bigger than what it paints
   * buttons for), just with one child instead of several.
   */
  test('1440px — dock collapse-control row', async ({ page }) => {
    await gotoAndSettle(page, DESKTOP);
    await waitForRectStable(page.locator('.rl-dock'));

    const { container, childUnion } = await measureGlassSurplus(
      page,
      '.rl-dock__collapse-row',
      '.rl-dock__collapse',
    );
    expect(container, 'dock collapse row: container selector matched nothing').not.toBeNull();
    expect(childUnion, 'dock collapse row: no visible "Collapse dock" button found').not.toBeNull();

    const widthSurplus = container!.width - childUnion!.width;
    const heightSurplus = container!.height - childUnion!.height;
    expect(
      widthSurplus,
      `dock collapse row is ${widthSurplus.toFixed(1)}px wider than the "Collapse dock" button itself.`,
    ).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(
      heightSurplus,
      `dock collapse row is ${heightSurplus.toFixed(1)}px taller than the "Collapse dock" button itself.`,
    ).toBeLessThanOrEqual(TOLERANCE_PX);
  });
});

// ---------------------------------------------------------------------------
// 13. Tabbed drawer — Layers / Stands / Sightings share the one drawer slot
// ---------------------------------------------------------------------------
//
// The Layers cell now opens a drawer with a `TabBar` (`@hunt-maps/design`)
// switching between three panels — `docs/AUDIT-PRODUCT.md` rec 20, and the
// mount point `WaypointsSheet`/`ObservationsSheet`/`FilterLibrary`/
// `FilterEditor` were built for but nothing wired up until this pass. Every
// invariant this file already holds the Layers sheet to applies just as
// hard here: one panel in the slot at a time, a full unmount on switch (not
// a second `.rl-sheet` hidden underneath), 44px tab targets, and —
// non-negotiably — the wind/date/thermals row (`R42`) staying reachable no
// matter which tab is open. Bedding is a leeward model; if Stands or
// Sightings could cover the wind control the way the pre-R42 sheet once did,
// the flagship "sweep the wind, watch bedding repaint" move would be
// impossible on a phone again, just reached from a new tab instead of the
// old single sheet.
//
// This sandbox's egress proxy blocks `services.arcgisonline.com` (the
// default satellite layer's host), so `waitForTiles` — which polls
// `map.areTilesLoaded()` — never resolves; a real run stalled past two
// minutes on a single case. `gotoDrawer` below is this group's own
// settle helper: it waits for the chrome to mount and quiet down, never for
// map pixels, which is honest for what every assertion here actually reads
// (DOM geometry and hit-testing, not the basemap).
test.describe('13. Tabbed drawer (Layers / Stands / Sightings)', () => {
  async function gotoDrawer(
    page: Page,
    viewport: { width: number; height: number } = DESKTOP,
  ): Promise<void> {
    await page.setViewportSize(viewport);
    await page.goto(`/${VIEW}`);
    await page.getByTestId('map-canvas').waitFor({ state: 'visible' });
    await page.getByRole('tab', { name: 'Layers' }).waitFor({ state: 'visible' });
    await waitForRectStable(page.locator('.rl-drawer'));
  }

  const TAB_NAMES = ['Layers', 'Stands', 'Sightings'] as const;

  for (const viewport of [DESKTOP, MOBILE]) {
    test(`${viewport.width}px — all three tabs are reachable, and switching fully unmounts the previous panel`, async ({
      page,
    }) => {
      await gotoDrawer(page, viewport);

      // Opens on Layers by default (unchanged from the pre-tab behaviour).
      await expect(page.getByRole('tab', { name: 'Layers', selected: true })).toBeVisible();
      await expect(page.getByText('Saved filters')).toBeVisible();

      for (const name of TAB_NAMES) {
        await page.getByRole('tab', { name }).click();
        await waitForRectStable(page.locator('.rl-drawer'));
        await expect(page.getByRole('tab', { name, selected: true })).toBeVisible();

        // The direct proof the previous tab's panel was unmounted, not
        // merely hidden underneath — exactly the shape of the
        // `elementFromPoint` trap `CommandBar`'s own doc comment names.
        // Two stacked `.rl-sheet`s at this drawer's coordinates would both
        // match this selector.
        await expect(page.locator('.rl-drawer .rl-sheet')).toHaveCount(1);
      }

      // Content unique to Layers must be gone once we have left it.
      await expect(page.getByText('Saved filters')).toHaveCount(0);
    });

    test(`${viewport.width}px — R42: wind, date and thermals stay reachable on every tab`, async ({
      page,
    }) => {
      await gotoDrawer(page, viewport);

      for (const name of TAB_NAMES) {
        await page.getByRole('tab', { name }).click();
        await waitForRectStable(page.locator('.rl-drawer'));

        // Present and geometrically clear of the drawer...
        await assertNoCollisions(page, {
          expectPresent: [
            'rail (top-right)',
            'command bar',
            'conditions bar',
            'chrome-bottomleft group',
            'layers sheet',
          ],
        });

        // ...and a real tap on each actually lands on the control, not on
        // the drawer painted over it — the two-stage check `docs/AUDIT-
        // PRODUCT.md`'s "bounding box ignores a clip, elementFromPoint does
        // not" lesson exists for. `.rl-sheet` is excluded from `roots`
        // deliberately: this asserts the *conditions row*, which is a
        // sibling of the drawer, not a descendant of it.
        const elements = await auditInteractiveElements(page, ['.rl-conditions']);
        expect(
          elements.length,
          'expected the wind/date/thermals cells to be auditable',
        ).toBeGreaterThan(0);
        const broken = elements.filter((el) => !el.reachable || !el.hitOk);
        expect(
          broken,
          broken
            .map(
              (f) =>
                `"${f.name}" in the conditions row is not cleanly hit-testable while the "${name}" tab is open`,
            )
            .join('\n'),
        ).toEqual([]);

        // The flagship move itself: opening the wind popover from this tab
        // must actually work, not just look present.
        await page.getByRole('button', { name: /Wind from/ }).click();
        await waitForRectStable(page.locator('.rl-popover'));
        await expect(page.locator('.rl-popover')).toBeVisible();
        // `exact: true` — the drawer's own "Close panel" button is also on
        // screen at the same time and its accessible name contains "Close"
        // as a substring, which Playwright's default `name` match would
        // otherwise treat as a hit too.
        await page.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(page.locator('.rl-popover')).toHaveCount(0);
      }
    });

    test(`${viewport.width}px — hit-testability holds on every tab`, async ({ page }) => {
      await gotoDrawer(page, viewport);

      for (const name of TAB_NAMES) {
        await page.getByRole('tab', { name }).click();
        await waitForRectStable(page.locator('.rl-drawer'));

        const elements = await auditInteractiveElements(page, ['.map-chrome', '.rl-drawer']);
        expect(elements.length, `expected interactive chrome on the "${name}" tab`).toBeGreaterThan(
          0,
        );

        const unreachable = elements.filter((el) => !el.reachable);
        expect(
          unreachable,
          unreachable
            .map(
              (f) =>
                `"${name}" tab: "${f.name}" is unreachable (no scrollable ancestor can reach it).`,
            )
            .join('\n'),
        ).toEqual([]);

        const clipped = elements.filter(
          (el) => el.reachable && !el.hitOk && !el.coveredByOpenOverlay,
        );
        expect(
          clipped,
          clipped
            .map(
              (f) =>
                `"${name}" tab: "${f.name}" paints but elementFromPoint resolves elsewhere — visible and unclickable.`,
            )
            .join('\n'),
        ).toEqual([]);
      }
    });

    test(`${viewport.width}px — every control on every tab meets the 44x44 gloved-tap floor`, async ({
      page,
    }) => {
      await gotoDrawer(page, viewport);

      for (const name of TAB_NAMES) {
        await page.getByRole('tab', { name }).click();
        await waitForRectStable(page.locator('.rl-drawer'));

        const elements = await auditInteractiveElements(page, ['.rl-drawer']);
        expect(
          elements.length,
          `expected interactive controls on the "${name}" tab`,
        ).toBeGreaterThan(0);

        const violations = elements
          .filter((el) => !el.disabled)
          .map((el) => {
            const isRange = el.tag === 'INPUT' && el.type === 'range';
            const minHeight = isRange ? 28 : 44;
            const ok = el.effectiveRect.width >= 44 && el.effectiveRect.height >= minHeight;
            return { el, ok, minHeight };
          })
          .filter((r) => !r.ok);

        expect(
          violations,
          violations
            .map(
              (v) =>
                `"${name}" tab: "${v.el.name}" (${v.el.tag}) is ` +
                `${Math.round(v.el.effectiveRect.width)}x${Math.round(v.el.effectiveRect.height)}px, needs >= 44x${v.minHeight}px.`,
            )
            .join('\n'),
        ).toEqual([]);
      }
    });
  }

  test('desktop — the Stands and Sightings tabs state a property is required rather than guessing one, while signed out', async ({
    page,
  }) => {
    // This sandbox has no backend at all, so "signed out" is the only
    // reachable state here — but it is also the one CLAUDE.md is strictest
    // about: nothing may be assumed about *whose ground* a stand or sighting
    // belongs to. `useCurrentProperty` (`apps/web/src/lib/currentProperty.ts`)
    // never fabricates a property id, and these two tabs must say so rather
    // than silently rendering against one.
    await gotoDrawer(page, DESKTOP);

    await page.getByRole('tab', { name: 'Stands' }).click();
    await waitForRectStable(page.locator('.rl-drawer'));
    await expect(page.getByRole('heading', { name: 'Stands & markers' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

    await page.getByRole('tab', { name: 'Sightings' }).click();
    await waitForRectStable(page.locator('.rl-drawer'));
    await expect(page.getByRole('heading', { name: 'Sightings & sits' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

    // And the rest of the chrome — Layers, Offline, wind/time — must still
    // work from here; being signed out must never strand the map itself.
    await page.getByRole('tab', { name: 'Layers' }).click();
    await waitForRectStable(page.locator('.rl-drawer'));
    await expect(page.getByText('Saved filters')).toBeVisible();
  });

  // This sandbox has no backend, so every case in this file runs signed out
  // — there is no reachable path here to actually authenticate and open
  // `FilterLibrary`, which is exactly why `LayersSheet.tsx`'s `canCreateFilters`
  // gate matters: "New filter" calling an endpoint that will just 401 is the
  // control CLAUDE.md's "say when an input is missing" rule exists to
  // prevent, applied to auth instead of terrain. What *is* verifiable here is
  // that the gate itself renders — the control is replaced by a stated reason
  // rather than left clickable-but-doomed.
  test('desktop — "New filter" is replaced by a stated reason while signed out, not a doomed control', async ({
    page,
  }) => {
    await gotoDrawer(page, DESKTOP);

    await expect(page.getByRole('button', { name: 'New filter' })).toHaveCount(0);
    await expect(page.getByText('Sign in to build and save your own filters')).toBeVisible();
    // The built-in presets are the point of the degrade — still usable with
    // no account at all.
    await expect(page.getByText('Bedding benches')).toBeVisible();
  });

  test('desktop — the drawer slot itself never holds two panels at once, across every reachable transition', async ({
    page,
  }) => {
    // The mechanism `FilterLibrary`/`FilterEditor` rely on when they do take
    // over the slot (`App.tsx`: `{drawerSlotShowsTabs && …}`, `{filterEditorTarget
    // && …}`, mutually exclusive by construction) is the same one already
    // proven by every tab switch above: exactly one `.rl-sheet` on screen,
    // ever. Restated here against the Offline picker, which *is* reachable
    // with no backend, as the end-to-end proof for that mechanism rather
    // than trusting the JSX condition by inspection alone.
    //
    // The entry point is the dock's own "Download this area" button, not
    // `CommandBar`'s "Offline" cell — `BACKLOG R63`. That cell is
    // `visibility: hidden` on desktop whenever the dock is expanded (the
    // state `gotoDrawer` leaves this test in), and a real click there would
    // never become actionable — the first version of this test hung on
    // exactly that click for the full suite timeout, which is the strongest
    // possible proof the old assertion was testing chrome that no longer
    // exists rather than a real regression.
    await gotoDrawer(page, DESKTOP);
    await expect(page.locator('.rl-sheet')).toHaveCount(1);

    await page.getByRole('button', { name: 'Download this area' }).click();
    await waitForRectStable(page.locator('.rl-sheet'));
    await expect(page.locator('.rl-sheet')).toHaveCount(1);
    // Opening Offline unmounts the nested drawer's own `.rl-sheet` (the
    // guard is `drawerSlotShowsTabs`, `App.tsx`) — TabBar goes with it, since
    // there is nothing to switch tabs *within* while a sibling panel owns
    // the slot. The dock chassis itself (header, this same Offline Coverage
    // section, footer) stays mounted and expanded underneath, unlike the
    // old drawer-only model this test used to check.
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await expect(page.locator('.rl-dock')).toBeVisible();

    // Closed via the picker's own close control — `drawerTab` was never
    // touched while it was open (`openOfflinePicker`'s doc comment), so the
    // tab strip reappears the instant the picker's `.rl-sheet` does not,
    // with nothing to "re-open".
    await page.getByRole('button', { name: 'Close panel' }).click();
    await waitForRectStable(page.locator('.rl-drawer'));
    await expect(page.locator('.rl-sheet')).toHaveCount(1);
    await expect(page.getByRole('tablist')).toBeVisible();
  });
});
