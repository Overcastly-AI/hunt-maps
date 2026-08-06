---
name: catching-ui-defects
description: Use before shipping any UI change, and when a visual or interaction bug is reported. Defines the failure classes that unit tests structurally cannot catch, and the rendered-state assertions that do catch them.
---

# Catching UI defects

## Why UI needs its own failure class

Every other subsystem in this repo fails in a way a test can see. A wrong slope
value is a number that differs from a closed-form answer. A broken query throws.
A regressed offline path fails a fetch.

**UI defects do not do this.** The DOM reports success. The component rendered.
The props were right. React committed. `getByRole` finds the button, `toBeVisible`
passes, the unit test is green — and the user still cannot click it.

The bug that forced this skill into existence:

> `.rl-conditions` used `overflow: hidden` to round its corners. A popover
> anchored inside it was clipped. The buttons still **painted** — an ancestor's
> clip does not affect `getBoundingClientRect()` — but `elementFromPoint()` at
> their centre returned the map canvas underneath. **Visible and unclickable.**
> 221 unit tests passed.

The lesson generalises: **assert against rendered state, not DOM state.** A DOM
query tells you what you built. Hit-testing, geometry and computed style tell
you what the user got.

## The six failure classes

### 1. Visible but dead
Paints correctly, receives no pointer events. Causes: an ancestor's
`overflow: hidden` clip, `pointer-events: none` inherited from a chrome layer,
a stacking-context trap, a transparent element covering it.

**Detection:** for every interactive element, `document.elementFromPoint(cx, cy)`
must resolve to that element or a descendant of it.

### 2. Present but unreachable
In the DOM and in the layout, but the user cannot get to it: below the fold of a
container that does not scroll, behind a fixed bar, outside the safe area on a
notched phone.

**Detection:** assert every interactive element's rect lies inside the viewport,
or inside a scrollable ancestor that can actually reach it.

### 3. Correct but unusable
Right content, wrong ergonomics: target under 44px, contrast under AA, focus
indicator invisible, hover-only affordance on a touch device.

**Detection:** geometry and computed-style audits. These are cheap and should
run on every interactive element, every build.

### 4. Stable but jumpy
The control moves when you use it. Opening the wind editor slid the conditions
bar 372px — the thing the user had just clicked went out from under their
cursor.

**Detection:** record the trigger's rect, activate it, let animation settle,
assert the rect did not move.

### 5. Right but wrong-shaped
The component works and is the wrong container for its content. ~300px of
controls in a 1200px drawer is not a styling nit — it signals the wrong
component was chosen.

**Detection:** content-height to container-height ratio. Below ~40% on an open
panel, flag it.

### 6. Fine alone, broken together
Each overlay is correct in isolation and they collide when open at once. This is
the most common real-world UI bug and the least covered by component tests,
which by construction render one component.

**Detection:** enumerate the app's overlay states and assert no two visible
chrome elements' rects intersect.

## The rule

**Every one of these was found by a person looking at a screenshot.** That is
the honest baseline and it does not scale. So:

1. When a UI defect is found by eye, **the fix is two commits' worth of work**:
   the fix, and an invariant that would have caught it. Add the invariant to
   `apps/web/e2e/ui-invariants.spec.ts`.
2. **Never tune an assertion until it passes.** If an invariant fails, the
   default assumption is that it found something. Weakening it converts a real
   defect into a permanent blind spot.
3. **Screenshot review is still required**, because classes 5 and 6 have fuzzy
   thresholds and taste is not automatable. The invariants raise the floor; they
   do not replace looking.

## What this does not catch

Be honest about the boundary. Automated invariants cannot tell you that a layout
is ugly, that a hierarchy is confusing, that copy is unclear, or that a control
is in a place nobody will look for it. That is what `field-qa` and screenshot
review are for. The invariants exist so that human attention is spent on
judgement rather than on re-finding mechanical defects.
