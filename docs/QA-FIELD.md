# QA — Field Audit: Left-side rail (independent audit #2)

**Auditor:** `field-qa`, second of two independent audits of the same surface
(the first audits information architecture/design; this one audits it as a
hunter uses it — gloved, one-handed, in the dark, on a mid-range phone).
Founder's request: *"Left side bar is really hard to work with. I would like
two agents to audit and work together to fix it. If a full left hand nav
design revamp is needed then let's do it."* The two audits did not coordinate
— that independence is the point.

**Scope:** `apps/web/src/App.tsx` (chrome markup, ~L250–307), `apps/web/src/index.css`
(`.map-chrome`, `.chrome-topright`, `.chrome-bottomleft`), `packages/design/src/styles.css`
(`.rl-rail`, `.rl-rail__btn`, `.rl-conditions`), `packages/design/src/components/primitives.tsx`,
`apps/web/e2e/ui-invariants.spec.ts`, `apps/web/e2e/helpers/dom-audit.ts`, and the
committed screenshots in `apps/web/screenshots/` (real terrain renders, not mockups,
at 390×844 and 1440×900).

## Method — read this before the findings

**I did not build, restart the dev/preview server, or run Playwright.** Another
agent was mid-flight on `apps/web/src/App.tsx`, `index.css` and `MapView.tsx`
during this audit, and a rebuild or preview restart would have destroyed their
in-flight test run. Every finding below is one of two things:

1. **Read from source, with the CSS cascade worked through by hand** — which
   rule wins, why, and what it computes to at a given viewport. Where this is
   the basis for a finding, it is stated as such.
2. **Measured against the committed screenshots** in `apps/web/screenshots/`
   (real terrain, real renders) — cropped and pixel-measured where precision
   mattered.

Where I could not do either — i.e. where confirming something would have
required tapping the live app — **I say so explicitly and do not report it as
verified.** That distinction has already mattered on this project: a false
pass is worse than no pass, and a finding that quietly hardens from "probable"
to "confirmed" on its way into this file is a real cost to whoever reads it
next.

---

## Findings, ranked by field consequence

### 1. CRITICAL — Mobile bottom-left rail is a false affordance: ~85% of its painted surface is not part of any button

**What a hunter is trying to do:** tap "Save this area for offline use" (or
Layers, or the waypoint pin) on a 390px phone, one gloved thumb, in a hurry —
e.g. leaving cell coverage and starting the elevation download before losing
signal.

**Mechanical cause, exact:**

`apps/web/src/index.css:154–159`, the mobile-only (`@media (max-width: 860px)`)
override for the bottom-left chrome group:

```css
.chrome-bottomleft {
  grid-area: bottom;
  flex-direction: column-reverse;
  align-items: stretch;
  justify-self: stretch;
}
```

`align-items: stretch` stretches `.rl-rail` — which sets no explicit width
(`packages/design/src/styles.css:128–134`) — to the full width of the
container (~366px on a 390px phone, after padding). But `.rl-rail__btn` sets
an explicit `width: var(--space-touch)` (44px, `packages/design/src/styles.css:136–141`).
A flex item with a definite size does not stretch, so each button stays 44px
wide and — with no `align-items`/`justify-content` override on `.rl-rail`
itself to center or distribute it — sits pinned to the left edge of a glass
panel now roughly 8× wider than it is.

**Confirmed visually** in the committed screenshot `apps/web/screenshots/08-mobile-map.png`
(390×844, real terrain): three continuous, full-width dark glass bars —
Layers / Add waypoint / Save this area — each with its icon left-aligned in a
44px zone and roughly 320px of visually identical dark glass to its right that
belongs to no `<button>` at all. Cropped and zoomed, there is no seam, border,
gradient or divider anywhere in the paint that distinguishes the live 44px
from the dead ~320px — it reads as one continuous pressable surface per row.

**What makes this dangerous rather than merely untidy:** `.rl-conditions__cell`
— the wind/time/thermals bar sitting directly above this rail, in the same
corner — genuinely *is* tappable edge-to-edge. Its cells are plain `<button>`s
with no explicit width (`packages/design/src/styles.css:314–326`), so they
size to content and pack the full bar with no dead zone; I confirmed this by
pixel-cropping the same screenshot. That correct, adjacent control trains the
user, in the same gesture, that "wide dark bar = tap anywhere." The rail right
below it looks identical and behaves nothing like it.

**Field cost:** the row this hits hardest is the one that starts a
multi-minute elevation download the entire offline story depends on
(`CLAUDE.md` §1: *"Losing a region the user waited twenty minutes for,
discovered blank in the field, is the worst failure this product has"*). A
hunter taps center-of-row — the natural target on what looks like a wide
button — and nothing happens. There is no confirmation toast and (see Finding
2) no press feedback of any kind, so a miss and a hit feel identical at the
moment of the tap. The hunter may walk into the field believing the download
started when it never did.

**Not caught by the invariant suite — and precisely why, so nobody assumes it
is guarded:**
- `1. Hit-testability` (`ui-invariants.spec.ts:166–235`) samples
  `document.elementFromPoint` only at the **center of each interactive
  element's own `getBoundingClientRect()`**. The button's own rect is
  correctly 44×44 and unobstructed, so `hitOk` is `true`. The test never
  samples the visually-implied larger surface.
- `3. Touch targets` (`ui-invariants.spec.ts:342–386`) asserts
  `effectiveRect ≥ 44×44`, which the button also passes trivially — the
  defect is oversized *visual* affordance around an appropriately-sized
  *real* target, not an undersized target.
- `4. No chrome collisions` is desktop-only, and in any case is the wrong
  shape of check: this is not two chrome groups landing on each other, it is
  one group whose painted surface wildly exceeds its interactive surface.

**Proposed invariant** (new, not a re-find): for any `.rl-glass` container
that shares one continuous background across multiple interactive children —
today that's `.rl-rail`; watch for more if the rail is rebuilt — assert the
container's own bounding box does not exceed the union of its children's
bounding boxes by more than a small tolerance (~8–12px, enough for padding),
in either dimension, **at MOBILE (390×844) as well as DESKTOP**. This defect
is invisible above the 860px breakpoint because `.chrome-bottomleft` only gets
the `align-items: stretch` override under that width — a desktop-only version
of this check would never have caught it, and did not.

---

### 2. HIGH — "Add waypoint" is dead, and nothing in this app tells you a tap registered at all

`apps/web/src/App.tsx:281`: `<RailButton label="Add waypoint" onClick={() => undefined}>`.
Confirmed dead by source — this was already flagged going in; what this audit
adds is *why it's worse than "a missing feature"*:

- **No `:active` state exists anywhere in `packages/design/src/styles.css`.**
  I grepped the whole file for `:active` and got zero matches. `.rl-rail__btn`
  defines `:hover` (`styles.css:150–153`, irrelevant on a touchscreen, which
  doesn't fire hover) and `[aria-pressed='true']` (`styles.css:155–158`, only
  set for the Layers/Save toggles via the `active` prop — not this button).
  There is no press feedback, anywhere in this design system, for a plain
  tap on a touch device.
- The only identification of the control's purpose is `title`/`aria-label`
  (`packages/design/src/components/primitives.tsx:49–50`), both of which
  require hover to surface as a tooltip — meaningless on touch.

So the full experience of tapping this control, gloved, one-handed, is:
no visual flash, no toast, no map change, nothing. The only way to learn it's
broken is to have already expected a pin to appear and to notice one didn't —
which assumes knowledge the icon-only control never gave you.

**Compounding with Finding 1:** on mobile this is the *middle* of three
full-width dead-looking rows, sandwiched between two rows that are each only
~12% live. A hunter reaching for "Save" and landing a little high, or reaching
for "Layers" and landing a little low, both plausibly land on this same dead
row and get the identical silent nothing — three different intents, one
outcome. The first time this happens, the reasonable conclusion is "this rail
doesn't work," which erodes trust in the two controls that *do* work, right
when they're needed.

---

### 3. `.inspect-card` at `bottom: 68px` — likely overlaps the mobile rail, but this is inferred from source arithmetic, not visually confirmed

**Status: unverified. Do not treat this as a confirmed defect.** I could not
tap the map and screenshot the result without touching the dev server another
agent was using. This is arithmetic from source, reported as a specific,
falsifiable risk — not an observation.

`apps/web/src/index.css:350–358`:
```css
.inspect-card {
  position: absolute;
  left: var(--space-3);
  bottom: calc(var(--space-touch) + var(--space-6));  /* 44px + 24px = 68px, fixed on every viewport */
  width: min(340px, calc(100% - var(--space-6)));
  ...
  z-index: 15;
}
```

That 68px offset reads like it was calibrated for a single 44px-tall row
(matching the desktop rail: one vertical column of buttons plus the
conditions bar). On mobile, the bottom-left group is now, per Finding 1's own
geometry: conditions bar (~44px) + `--space-3` gap (12px) + the three-row rail
(44px×3 + 1px×2 gaps ≈ 134px) ≈ **~190px tall**, occupying roughly the bottom
200px of the screen once `.map-chrome`'s own 12px padding is added.

The inspect card (opened by tapping a point on the map, `App.tsx:340–363`)
holds a title/close row, a two-row lat/lng `<dl>`, and a hint paragraph — a
plausible rendered height in the 150–220px range. Anchored 68px off the bottom
edge, its top edge lands somewhere around y≈575–625 on an 844px viewport,
which overlaps the ~y≈642-and-below band the bottom-left chrome group now
occupies. The two ranges are close enough, given the uncertainty in my height
estimate, that I cannot rule out overlap, and the arithmetic suggests it is
likely.

**Why this is worth recording even unconfirmed:** `.inspect-card` appears in
**no collision test at any viewport** — I grepped both `ui-invariants.spec.ts`
and `dom-audit.ts` for `inspect` and got zero matches. This isn't a mobile
coverage gap specifically; the element isn't tracked anywhere. Tapping the map
for a terrain readout, then reaching for Save or Layers right after, is an
entirely ordinary sequence — if the card does overlap the rail, it breaks
exactly the interaction that's likely to follow a readout.

**The one-tap check a build agent should run to settle this:** load the app
at 390×844, tap a point on the visible terrain to open the inspect card, and
check by eye (or `getBoundingClientRect`) whether `.inspect-card` overlaps
`.chrome-bottomleft`. If it does, either give `.inspect-card` a taller
`bottom` offset on mobile — mirroring the `@media (min-width: 861px)`
clearance override that already exists for `.rl-sheet--drawer` for this exact
reason (`index.css:106–109`) — or reposition the card. Separately, add
`.inspect-card` to the collision check's tracked rects and run that check at
`MOBILE` as well as `DESKTOP`.

---

### 4. MEDIUM — No persistent indicator that an offline download is running, once you leave the Region Picker panel

Traced through the data flow:

- `regions.active` — the live `{ clientId, progress }` state from
  `apps/web/src/lib/offline/useOfflineRegions.ts:81` — reaches **exactly one
  consumer**: `<RegionPicker active={regions.active} .../>` at `App.tsx:328`.
- `RegionPicker` only renders while `pickerOpen` is `true`, and `pickerOpen`
  is forced `false` the instant you tap Layers (`App.tsx:270–277`, which
  calls `setPickerOpen(false)`) or tap the Save rail button again to close it
  (`App.tsx:287–290`).
- The rail's own Save button receives only `active={pickerOpen}`
  (`App.tsx:284–293`) — its highlighted state means **"is this panel
  currently open,"** not **"is a download currently running."**

The moment you navigate away to check anything else while a region downloads
— a completely natural thing to do while waiting on a multi-minute job — the
Save icon reverts to its plain, unhighlighted look, and there is no progress
ring, badge, or percentage anywhere in the persistent chrome.

**Field cost:** this touches `CLAUDE.md` §1 directly — not by losing the
download (it keeps running in the hook regardless of what's mounted — I
confirmed `useOfflineRegions` is called once at the `App` level, independent
of `RegionPicker`'s mount state) but by making its progress **invisible** the
moment you look away. The hunter cannot tell, from the chrome alone, whether
the thing they started 15 minutes ago is still running, finished, or silently
died, without deliberately reopening that one specific panel again.

**Not caught by the suite:** test group `11` (offline region picker) only
asserts progress display *while the picker is open*. Nothing asserts state
visibility after navigating away from it.

---

## What's already fine / already guarded

Recorded so nobody re-fixes a solved problem or re-audits a covered path:

- **`.rl-conditions` (the wind/time/thermals bar) does not have the Finding-1
  stretch bug.** Its cells are plain `<button>`s with no explicit width, so
  they size to content and pack the full bar edge-to-edge with no dead zone —
  confirmed by pixel-cropping `apps/web/screenshots/08-mobile-map.png`. This
  is the pattern the rail should be rebuilt to match, not a place that needs
  fixing itself.
- **Contrast** (rail icons, conditions bar text, against the dark glass) is
  covered by the automated WCAG AA check (`7. Chrome text contrast`,
  `ui-invariants.spec.ts:735–758`, scoped to `.map-chrome`). Nothing in the
  screenshots suggested a problem — dark navy/charcoal throughout, amber
  accent, no blown-out whites. Dark adaptation on this chrome looks fine; I
  did not need to re-verify this by eye.
- **Trigger stability** (rail buttons don't move when clicked, including
  across the Layers-sheet-open transition that used to displace them via a
  `translateX`, see `index.css:84–94`) is explicitly tested
  (`2. Trigger stability`) and the code comments document the real prior
  incident this fixed. Not re-litigating it.
- **Sheet-covers-rail on mobile is intentional and, from the one committed
  screenshot I have (`apps/web/screenshots/07-mobile-sheet.png`), looks
  clean** — full occlusion, no partial-overlap seam. I only have that one
  state confirmed by screenshot; I did not exercise every open/close
  permutation live, so I am not claiming the whole matrix is clean — only
  that this one capture is.
- **Chrome collision (rail vs. conditions bar) at desktop is genuinely
  tested and passing**, and the desktop screenshot
  (`apps/web/screenshots/04b-desktop-wind-popover.png`) confirms the rail
  renders as a correctly compact 44px column there. The Finding-1 stretch bug
  is real and mobile-only precisely because the `align-items: stretch`
  override only fires under the 860px breakpoint — desktop was never at risk.
- **Mobile chrome collision is genuinely untested** (tracked as `BACKLOG
  R37`) — I want to be precise that I did not independently verify mobile
  collision is *safe* generally. I checked two specific things by eye
  (conditions-bar fill, and the one sheet-open screenshot) and both were
  clean; beyond that, mobile collision should be treated as unknown, not
  passing.

---

## Note to the sibling (IA/design) audit

Any redesign of this rail must do one of two things, or it will reintroduce
Finding 1 in a new shape:

1. **Keep fixed-width buttons and fix the stretch** — give `.rl-rail` (or its
   mobile replacement) an explicit width on mobile instead of letting it
   inherit `align-items: stretch` from `.chrome-bottomleft`, so the glass
   background never exceeds the buttons it contains; or
2. **If every control becomes genuinely full-width** (bigger mobile targets is
   a reasonable goal on its own), build each one the way `.rl-conditions__cell`
   is already built — a `<button>` with no explicit `width`, sized by its own
   content and padding within a flex row, so the painted surface and the
   interactive surface are the same rectangle by construction.

This note is directly load-bearing: the IA audit has proposed a full-width
command bar for this corner. A well-meant "make mobile targets bigger" revamp
that copies today's `.rl-rail__btn` pattern (explicit fixed width, inside a
container that stretches) would reproduce exactly this defect — just with
wider dead strips instead of narrower ones. The fix is to build new mobile
controls the `.rl-conditions__cell` way from the start.

---

## Summary ranking (for the build agent)

1. **Finding 1** (mobile rail false affordance) — root cause is one CSS rule;
   fix by giving `.rl-rail` an explicit mobile width, or rebuilding its
   buttons the `.rl-conditions__cell` way. Highest field cost: it sits
   directly on the Save-this-area control the offline story depends on.
2. **Finding 2** (dead waypoint button) — wire it up, or remove it from the
   rail until it's real. A permanently dead icon is worse than a two-icon
   rail, and it actively degrades trust in the two controls next to it.
3. **Finding 3** (`.inspect-card` offset) — unconfirmed; run the one-tap check
   at 390×844 described above before treating it as real. Cheap to fix once
   confirmed.
4. **Finding 4** (no persistent download indicator) — real, lower urgency
   than 1–2 since the download itself isn't lost, only its visibility while
   it runs.
