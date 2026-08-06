import type { Page } from '@playwright/test';

/**
 * The interactive surface this suite holds to the app's own contract:
 * buttons, links, form controls and anything explicitly marked as a button
 * via ARIA.
 *
 * Deliberately scoped to `.map-chrome`, `.rl-sheet` and `.rl-popover` (the
 * caller passes these in as `roots`) rather than the whole document. MapLibre
 * mounts its own attribution/scale controls inside the map container as a
 * sibling of that chrome, and this app's touch-target and focus-ring
 * guarantees are a `@hunt-maps/design` contract this app's own code can meet
 * — they are not something this suite can hold a vendored map library to
 * without editing files outside this agent's territory. See the summary for
 * the one thing that scoping hides (the attribution link is ~13px tall).
 */
export const INTERACTIVE_SELECTOR = 'button, a[href], input, [role="button"]';

export interface InteractiveElementInfo {
  tag: string;
  type: string | null;
  /** Best-effort accessible name, for readable failure messages. */
  name: string;
  disabled: boolean;
  /** The element's own painted box. */
  rect: { x: number; y: number; width: number; height: number };
  /**
   * The box a real tap actually has to land in. For a checkbox/radio wrapped
   * in a `<label>` this is the label's box, not the ~18px input glyph — a
   * browser toggles the input when you tap anywhere in its label, and a
   * touch-target check that only measured the glyph would report a false
   * violation on every native-pattern control while missing the real one:
   * see `ui-invariants.spec.ts`'s touch-target test for what this labelled
   * box turns out to actually measure in this app.
   */
  effectiveRect: { x: number; y: number; width: number; height: number };
  /**
   * Whether `document.elementFromPoint` at the centre of `rect` resolves to
   * this element or a descendant of it — the direct test for the bug this
   * whole suite is named after: a control that paints on top but hit-tests
   * to something else underneath.
   *
   * Only meaningful when `reachable` is true. `elementFromPoint` is
   * viewport-relative and returns `null` for any point outside the current
   * viewport, so a control below the fold in a scrolling panel (e.g. the
   * Layers sheet body) would otherwise report a false "unclickable" — that
   * failure has nothing to do with clipping, it just has not been scrolled
   * to yet. See `reachable`.
   */
  hitOk: boolean;
  /**
   * False only when the element's centre is still outside the viewport
   * *after* scrolling it into view (`scrollIntoView({ block: 'center' })`) —
   * i.e. no scrollable ancestor exists that can ever bring it on screen. That
   * is a real, distinct defect (present in the DOM, permanently unreachable
   * by any input method) and callers should report it separately from a
   * `hitOk: false` clipping failure so the two causes are never confused.
   */
  reachable: boolean;
  /**
   * True when this element sits behind the currently open sheet/popover and
   * is not part of it — i.e. it is *deliberately* unreachable right now
   * (the mobile bottom sheet covers the rail behind it by design, see
   * `apps/web/src/index.css` around the `data-sheet-open` rules) rather than
   * accidentally clipped. Callers should skip `hitOk` for these rather than
   * fail on them, and that is the one intentional gap in this invariant —
   * see the spec file for how it is bounded so it cannot also swallow a real
   * regression of the clipping bug.
   */
  coveredByOpenOverlay: boolean;
}

export async function auditInteractiveElements(
  page: Page,
  roots: string[],
): Promise<InteractiveElementInfo[]> {
  return page.evaluate(
    ({ roots, selector }: { roots: string[]; selector: string }) => {
      // The Layers sheet and a wind/time popover can now be open at once
      // (App.tsx tracks them as independent state, on purpose — sweeping the
      // wind dial while the layer list is open is the product's flagship
      // move). When both are present, the popover is the one actually
      // painted on top (it has the higher `z-index`, `packages/design/src
      // /styles.css`), so *it* is what a covered sheet control is really
      // hidden behind. Picking "whichever selector matches first" here would
      // silently pick the sheet and then wrongly assert hit-testability for
      // sheet controls that the popover is genuinely, intentionally sitting
      // on top of right now.
      const overlayCandidates = Array.from(document.querySelectorAll('.rl-sheet, .rl-popover'));
      const overlay = overlayCandidates.sort(
        (a, b) =>
          parseInt(window.getComputedStyle(b).zIndex, 10) -
          parseInt(window.getComputedStyle(a).zIndex, 10),
      )[0];
      const overlayRect = overlay ? overlay.getBoundingClientRect() : null;

      const seen = new Set<Element>();
      const out: InteractiveElementInfo[] = [];

      for (const rootSelector of roots) {
        for (const root of Array.from(document.querySelectorAll(rootSelector))) {
          const candidates = root.matches(selector)
            ? [root, ...Array.from(root.querySelectorAll(selector))]
            : Array.from(root.querySelectorAll(selector));

          for (const el of candidates) {
            if (seen.has(el)) continue;
            seen.add(el);

            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            let rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;

            let effectiveRect = rect;
            const input = el as HTMLInputElement;
            if (
              el.tagName === 'INPUT' &&
              (input.type === 'checkbox' || input.type === 'radio')
            ) {
              const label = el.closest('label');
              if (label) effectiveRect = label.getBoundingClientRect();
            }

            // The part of `el` that is actually painted somewhere: its own
            // rect, intersected with every clipping ancestor's box (any
            // ancestor with `overflow: hidden|auto|scroll` on the relevant
            // axis — the Layers sheet's `.rl-sheet__body` is exactly this)
            // and finally with the browser viewport itself. A first version
            // of this helper checked only against the viewport, which missed
            // exactly the case that mattered: a row scrolled just past the
            // *sheet's own* clipped edge still has `rect.top < window
            // .innerHeight`, so it read as "already visible" and was hit-
            // tested at its unscrolled — and therefore actually invisible,
            // clipped-away — position. That produced false failures that
            // looked identical to the real clipping bug, which is exactly
            // the kind of wrong-but-confident result this suite exists to
            // prevent someone else from shipping.
            const visibleRect = (element: Element) => {
              const r = element.getBoundingClientRect();
              let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
              let ancestor = element.parentElement;
              while (ancestor && ancestor !== document.documentElement) {
                const cs = window.getComputedStyle(ancestor);
                const clipsX = cs.overflowX === 'hidden' || cs.overflowX === 'auto' || cs.overflowX === 'scroll';
                const clipsY = cs.overflowY === 'hidden' || cs.overflowY === 'auto' || cs.overflowY === 'scroll';
                if (clipsX || clipsY) {
                  const ar = ancestor.getBoundingClientRect();
                  box = {
                    left: clipsX ? Math.max(box.left, ar.left) : box.left,
                    right: clipsX ? Math.min(box.right, ar.right) : box.right,
                    top: clipsY ? Math.max(box.top, ar.top) : box.top,
                    bottom: clipsY ? Math.min(box.bottom, ar.bottom) : box.bottom,
                  };
                }
                ancestor = ancestor.parentElement;
              }
              box = {
                left: Math.max(box.left, 0),
                top: Math.max(box.top, 0),
                right: Math.min(box.right, window.innerWidth),
                bottom: Math.min(box.bottom, window.innerHeight),
              };
              return box;
            };
            const isVisible = (box: { left: number; top: number; right: number; bottom: number }) =>
              box.right > box.left && box.bottom > box.top;

            let visible = visibleRect(el);

            // Not currently painted anywhere — scroll it into view exactly
            // like a real tap would have to (`scrollIntoView` walks every
            // scrollable ancestor, not just the window, which is the whole
            // reason it replaces the viewport-only check above), then ask
            // again.
            if (!isVisible(visible)) {
              el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
              rect = el.getBoundingClientRect();
              visible = visibleRect(el);
              if (
                el.tagName === 'INPUT' &&
                (input.type === 'checkbox' || input.type === 'radio')
              ) {
                const label = el.closest('label');
                effectiveRect = label ? label.getBoundingClientRect() : rect;
              } else {
                effectiveRect = rect;
              }
            }

            const reachable = isVisible(visible);
            // Hit-test the centre of the *visible* region, not the raw
            // element box — a partially-clipped-but-still-tappable sliver at
            // an edge is a real, reachable control, and its own untrimmed
            // centre point can sit outside what is actually painted.
            const cx = reachable ? (visible.left + visible.right) / 2 : rect.x + rect.width / 2;
            const cy = reachable ? (visible.top + visible.bottom) / 2 : rect.y + rect.height / 2;
            const hit = reachable ? document.elementFromPoint(cx, cy) : null;
            const hitOk = reachable && Boolean(hit) && (hit === el || el.contains(hit));

            let coveredByOpenOverlay = false;
            if (overlay && overlayRect && !overlay.contains(el)) {
              coveredByOpenOverlay = !(
                rect.right <= overlayRect.left ||
                rect.left >= overlayRect.right ||
                rect.bottom <= overlayRect.top ||
                rect.top >= overlayRect.bottom
              );
            }

            // `??` only falls through on null/undefined, and `.textContent`
            // on a childless `<input>` is `''` — not nullish — so an earlier
            // version of this chain silently stopped there and never reached
            // `.id`, leaving every checkbox in failure output unnamed.
            const name =
              el.getAttribute('aria-label') ||
              el.getAttribute('title') ||
              (el.textContent ?? '').trim().slice(0, 40) ||
              el.id ||
              '';

            out.push({
              tag: el.tagName,
              type: el.getAttribute('type'),
              name,
              // Only form controls and buttons have `.disabled`; a link never
              // does. Checking for the property rather than casting to one
              // element type keeps this honest for the mixed selector above.
              disabled: 'disabled' in el && (el as { disabled: boolean }).disabled === true,
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              effectiveRect: {
                x: effectiveRect.x,
                y: effectiveRect.y,
                width: effectiveRect.width,
                height: effectiveRect.height,
              },
              hitOk,
              reachable,
              coveredByOpenOverlay,
            });
          }
        }
      }
      return out;

      // Local type alias only used inside this evaluate string.
      interface InteractiveElementInfo {
        tag: string;
        type: string | null;
        name: string;
        disabled: boolean;
        rect: { x: number; y: number; width: number; height: number };
        effectiveRect: { x: number; y: number; width: number; height: number };
        hitOk: boolean;
        reachable: boolean;
        coveredByOpenOverlay: boolean;
      }
    },
    { roots, selector: INTERACTIVE_SELECTOR },
  );
}

export interface ChromeTextNode {
  /** Class list for readable failure messages, e.g. `.rl-conditions__label`. */
  selectorHint: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  colorCss: string;
  fontSizePx: number;
  fontWeight: number;
}

/**
 * Every visible "leaf" text element under the given roots — an element that
 * has a non-whitespace text node as a *direct* child, so a `<button>` with a
 * nested `<svg>` icon and no direct text (the icon-only rail buttons) is
 * correctly excluded, while a `<span>` mixing a glyph icon and label text
 * (`Chip`) is correctly included.
 */
export async function collectChromeTextNodes(
  page: Page,
  roots: string[],
): Promise<ChromeTextNode[]> {
  return page.evaluate((roots: string[]) => {
    const seen = new Set<Element>();
    const out: ChromeTextNode[] = [];

    for (const rootSelector of roots) {
      for (const root of Array.from(document.querySelectorAll(rootSelector))) {
        const stack: Element[] = [root];
        while (stack.length > 0) {
          // Non-null: `while` guards on `stack.length > 0`.
          const el = stack.pop() as Element;
          if (seen.has(el)) continue;
          seen.add(el);
          for (const child of Array.from(el.children)) stack.push(child);

          const hasDirectText = Array.from(el.childNodes).some(
            (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0,
          );
          if (!hasDirectText) continue;

          const style = window.getComputedStyle(el);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            parseFloat(style.opacity) === 0
          ) {
            continue;
          }
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          if (
            rect.bottom < 0 ||
            rect.right < 0 ||
            rect.top > window.innerHeight ||
            rect.left > window.innerWidth
          ) {
            continue;
          }

          out.push({
            selectorHint: el.className ? `.${String(el.className).trim().split(/\s+/).join('.')}` : el.tagName,
            text: (el.textContent ?? '').trim().slice(0, 40),
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            colorCss: style.color,
            fontSizePx: parseFloat(style.fontSize),
            fontWeight: parseInt(style.fontWeight, 10) || 400,
          });
        }
      }
    }
    return out;

    interface ChromeTextNode {
      selectorHint: string;
      text: string;
      x: number;
      y: number;
      width: number;
      height: number;
      colorCss: string;
      fontSizePx: number;
      fontWeight: number;
    }
  }, roots);
}

export interface ChromeRects {
  railTopRight: { x: number; y: number; width: number; height: number } | null;
  railBottomLeft: { x: number; y: number; width: number; height: number } | null;
  conditions: { x: number; y: number; width: number; height: number } | null;
  /**
   * The bounding box of `.chrome-bottomleft` as a whole — the rail and the
   * conditions bar together, plus the gap between them. Checking the rail and
   * the conditions bar as two separate rects (below) does not cover that gap,
   * and a sheet whose edge lands *inside* it would pass both of those checks
   * while still visually overlapping the group and creating exactly the
   * elementFromPoint trap this invariant exists to catch. This closes that
   * measurement gap without replacing the two finer-grained checks, which
   * still give a more specific failure message when only one piece collides.
   */
  bottomLeftGroup: { x: number; y: number; width: number; height: number } | null;
  sheet: { x: number; y: number; width: number; height: number } | null;
  popover: { x: number; y: number; width: number; height: number } | null;
}

/** Bounding boxes for the named floating chrome groups, `null` when absent. */
export async function collectChromeRects(page: Page): Promise<ChromeRects> {
  return page.evaluate(() => {
    const rectOf = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      railTopRight: rectOf('.chrome-topright .rl-rail'),
      railBottomLeft: rectOf('.chrome-bottomleft .rl-rail'),
      conditions: rectOf('.rl-conditions'),
      bottomLeftGroup: rectOf('.chrome-bottomleft'),
      sheet: rectOf('.rl-sheet'),
      popover: rectOf('.rl-popover'),
    };
  });
}

/** Whether two axis-aligned rects overlap (touching edges do not count). */
export function rectsOverlap(
  a: { x: number; y: number; width: number; height: number } | null,
  b: { x: number; y: number; width: number; height: number } | null,
): boolean {
  if (!a || !b) return false;
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}
