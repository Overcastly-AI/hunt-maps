# QA — Field Audit: Left-side rail (independent audit #2)

**Auditor:** `field-qa`, second of two independent audits of the same surface
(the first audits information architecture/design; this one audits it as a
hunter uses it — gloved, one-handed, in the dark, on a mid-range phone).
Founder's request: _"Left side bar is really hard to work with. I would like
two agents to audit and work together to fix it. If a full left hand nav
design revamp is needed then let's do it."_ The two audits did not coordinate
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
corner — genuinely _is_ tappable edge-to-edge. Its cells are plain `<button>`s
with no explicit width (`packages/design/src/styles.css:314–326`), so they
size to content and pack the full bar with no dead zone; I confirmed this by
pixel-cropping the same screenshot. That correct, adjacent control trains the
user, in the same gesture, that "wide dark bar = tap anywhere." The rail right
below it looks identical and behaves nothing like it.

**Field cost:** the row this hits hardest is the one that starts a
multi-minute elevation download the entire offline story depends on
(`CLAUDE.md` §1: _"Losing a region the user waited twenty minutes for,
discovered blank in the field, is the worst failure this product has"_). A
hunter taps center-of-row — the natural target on what looks like a wide
button — and nothing happens. There is no confirmation toast and (see Finding 2) no press feedback of any kind, so a miss and a hit feel identical at the
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
  defect is oversized _visual_ affordance around an appropriately-sized
  _real_ target, not an undersized target.
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
adds is _why it's worse than "a missing feature"_:

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

**Compounding with Finding 1:** on mobile this is the _middle_ of three
full-width dead-looking rows, sandwiched between two rows that are each only
~12% live. A hunter reaching for "Save" and landing a little high, or reaching
for "Layers" and landing a little low, both plausibly land on this same dead
row and get the identical silent nothing — three different intents, one
outcome. The first time this happens, the reasonable conclusion is "this rail
doesn't work," which erodes trust in the two controls that _do_ work, right
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
asserts progress display _while the picker is open_. Nothing asserts state
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
  collision is _safe_ generally. I checked two specific things by eye
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

---

---

# QA — Field Audit: Auth, offline write queue, properties/drawer/stand/observation/filter/terrain sheet (2026-08-09)

**Auditor:** `field-qa`, independent of the build. Scope per brief: the
material that shipped in one push — auth + API client + offline write queue
(`clientId`-keyed), properties + boundary drawing, the tabbed drawer
(Layers/Stands/Sightings), stand detail + wind check, observation capture
including the one-button blank-sit log, the saved-filter editor + live match
share, and the terrain-readout peek-detent sheet.

**Environment, stated up front because it shapes every finding below:** no
Postgres, no API process, `docker` unavailable — confirmed (`pg_isready`
failed, `docker ps` had no daemon). `services.arcgisonline.com` (satellite
basemap) is blocked by the egress proxy; `s3.amazonaws.com/elevation-tiles-prod`
(DEM) is reachable. Built with `pnpm -r build` (green) before testing.
**This session shared the sandbox with another live agent** (`code-reviewer`/
build agent fixing `R66`, confirmed via `git status` showing in-flight,
uncommitted changes to `terrainProtocol.ts`/`terrain.worker.ts`/
`ui-invariants.spec.ts` that are not mine) that was continuously running its
own copies of the Playwright suite against the same shared preview server on
:4173 for the entire session. That matters for the invariants-suite result
below — read that caveat before trusting the number.

I did not modify any application code. I wrote and then deleted my own
scratch Playwright specs (`apps/web/e2e/manual-qa*.spec.ts`) used to drive
the real built app through Chromium for every finding below — nothing from
them is left in the tree. Every finding that says "confirmed live" was
personally observed through that harness, not inferred; findings that are
source-only say so explicitly.

## 0. The automated floor — inconclusive, not clean, say so plainly

Ran `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm exec playwright test
ui-invariants --workers=1` as instructed. Result: **20 passed, 53 failed, in
23.8 minutes.** I am **not** reporting those 53 as genuine regressions and
neither should anyone else without a clean rerun: the trailing ~10 failures
are bare `net::ERR_CONNECTION_REFUSED` on `localhost:4173` — the shared
preview server died mid-run — and the failure list is a near-total wipeout
spread evenly across unrelated describe blocks (trigger stability, touch
targets, chrome collisions, focus visibility, contrast, panel density,
offline coverage, layer paint, region picker, glass containers, tabbed
drawer), which is the signature of "the shared server/CPU died partway
through," not "the app broke in 53 independent ways." The suite's own commit
history documents a 32.7-second runtime for a comparable slice; 23.8 minutes
under concurrent load from a second agent's continuous, overlapping test runs
on the same port is not a clean signal. **I did not use this result for any
verdict in this report.** It needs a solo rerun once the sandbox is not
shared, and I'm flagging that as a gap rather than papering over it with a
number that looks authoritative but isn't.

## Findings, ranked by field consequence

### 1. CRITICAL — A backend that answers with an error (not a backend that's unreachable) silently logs the hunter out and clears their session

**What a hunter is trying to do:** reopen the app — any time, not just at the
trailhead — while their self-hosted server is having a bad moment: mid
restart, DB connection pool exhausted, container crash-looping. Signal is
fine. The reverse proxy in front of the app (nginx in `deploy/compose`, or
this sandbox's own `vite preview`, which — I checked — also proxies `/api` to
`:3001` and gets `ECONNREFUSED`) answers with a plain HTTP error. This is not
a rare edge case for a self-hosted product; it is the single most likely
"something's wrong with my server" state a hunter running Ridgeline at home
will ever see.

**Mechanical cause, exact, confirmed live:** `apps/web/src/lib/api/
AuthContext.tsx:84-98`. On every app mount, if a session is cached, a
background `authApi.me()` call confirms it:

```ts
.catch((err) => {
  if (cancelled) return;
  if (err instanceof ApiError && err.kind === 'network') {
    setState((s) => ({ ...s, isOffline: true }));
    return;
  }
  tokenStore.clear();
  setState({ status: 'unauthenticated', user: null, isOffline: false });
});
```

The comment above this code says the intent precisely: _"only a real auth
failure (a 401 that survived a refresh attempt) signs the user out."_ The
code does not implement that. It implements the inverse: **only `kind ===
'network'` is spared; everything else — a bare 500, a 502 from a dead
upstream, a 503, a 429, an `unknown` — clears the token and signs out.**
`classifyHttpError` (`client.ts:101-126`) maps any `status >= 500` to `kind:
'server'`, never `'network'`. A `'server'` response reaches this catch block
and is treated exactly like an invalid session.

**Confirmed live, two ways:**

- **Deterministic repro** (`page.route('**/api/**', route => route.fulfill({
status: 502, ... }))` — no CDP-level network blocking, a real HTTP response):
  before, `localStorage['ridgeline.auth.v1']` holds a valid cached session.
  After boot: `localStorage.getItem('ridgeline.auth.v1')` → **`null`**.
  Navigating to `/properties` (a `RequireAuth`-gated route) → **redirected to
  `/login`**. The Stands tab shows _"Sign in to log stands, cameras and
  markers."_
- **This sandbox's real dead-backend behaviour**, unmodified: `vite preview`
  proxies `/api` to `:3001`, gets `ECONNREFUSED`, and answers the browser with
  a bare `500`. Booting the app with a cached session against this exact,
  unmodified environment reproduces the identical sign-out.

**Field cost:** the hunter did nothing wrong. Their phone has full bars. They
reopen the app and are looking at a login form for a backend that is, by
definition, unreachable right now — the one thing they cannot do anything
about from a stand. This is the exact scenario `CLAUDE.md` names by name
("does it come back signed in, or does it ask for a password with no signal?
That specific failure would end the hunt before it starts") except it is
_not_ "no signal" — the code's `isOffline: true` branch for genuine signal
loss is correctly implemented and **I confirmed it works** (finding 3 below,
same test harness: a truly offline reload, via `context.setOffline(true)`,
correctly keeps the cached user signed in). It is specifically "signal fine,
server unwell" that fails, and for a self-hosted app that is not a corner
case — it is Tuesday.

**Fix shape** (not prescribing implementation, flagging the inversion): gate
on `err.kind === 'auth'` to sign out, not on `err.kind !== 'network'` to stay
signed in. Every other kind (`server`, `unknown`, `validation`, `forbidden`,
`not_found`) should behave like `network` here — none of them mean the
session is invalid.

**Not caught by the invariant suite** — there is no invariant that exercises
auth-against-a-failing-backend at all; this is a state-machine defect, not a
rendering one. Proposed invariant: an e2e test that seeds a cached session,
mocks every `/api/**` route to return `502`, boots the app, and asserts the
user is still shown as signed in (`isOffline: true` surfaced somewhere, never
a bounce to `/login`).

---

### 2. CRITICAL — Genuinely offline writes are not reliably queued; a write can vanish with zero trace, worse than "queued and idempotent" implies

**What a hunter is trying to do:** the flagship interaction this product is
built around — end a sit with zero sightings, tap "Save blank sit," in a
blind with actually no bars (`navigator.onLine === false`, not just a slow
connection).

**What I expected**, from `CLAUDE.md` ("every write is queued and
idempotent") and `lib/api/offlineQueue.ts`'s own doc comment ("Every write
hook... tries the real request first. Only a `kind: 'network'` `ApiError`...
falls back to queueing"): the write attempts, `fetch` throws, `apiFetch`
classifies it `kind: 'network'`, the hook's `catch` calls `enqueue()`, the
item lands in `localStorage['ridgeline.offlineQueue.v1']`, and the UI can
show it as a "queued" record (`useQueuedIds`, wired into `ObservationList`).

**What actually happens, confirmed live, two independent ways:**

- **Realistic**: signed in, a real property mocked, on the Blank Sit form,
  `await context.setOffline(true)` (Playwright's real network-offline
  emulation), tap Save. Result: the Save button reads **"Saving…" and never
  resolves** for as long as I waited (1.5–3s per run). `localStorage
['ridgeline.offlineQueue.v1']` stays **`null`** the entire time — not
  populated, not even attempted. Reconnecting later, the write _does_
  eventually succeed (POST count went from 0 to 1) — but only because the
  app was still open and the original `mutate()` call was still alive,
  waiting.
- **Deterministic, to rule out any Playwright network-emulation artifact**:
  left the real network and the mocked backend **completely healthy** (every
  `/api` route mocked to answer instantly and successfully) and forced only
  `navigator.onLine` to `false` via `Object.defineProperty` — exactly the
  signal both React Query's `onlineManager` and the app's own online/offline
  handling key off, with **no actual network interference at all**. Tapped
  Save. Result: **`POST /api/observations` was hit zero times** — the
  request was never even attempted, proven because the mock route (which
  would answer in milliseconds) never fired. `ridgeline.offlineQueue.v1`
  stayed `null`. The button stayed on "Saving…" indefinitely. Then, standing
  in for a hunter's phone getting backgrounded and reclaimed by the OS (very
  common for PWAs) or force-quit before signal returns, I reloaded the page
  — still with the write never having reached the queue. **After reload,
  `ridgeline.offlineQueue.v1` is still `null`. The write left no trace
  anywhere. It is gone.**

**Root cause:** `@tanstack/react-query` v5's default `networkMode: 'online'`
applies to **mutations**, not just queries. `queryClient.ts` sets
`mutations: { retry: false }` with no `networkMode` override, so the default
applies. When `navigator.onLine` is `false`, React Query pauses the mutation
**before invoking `mutationFn`** — the exact function whose `try/catch`
around `apiFetch` is where `offlineQueue.ts`'s `enqueue()` gets called. The
whole catch-and-persist-to-`localStorage` mechanism the doc comments describe
is real code that is reachable, correctly written, and unit-tested in
isolation (`offlineQueue.test.ts`) — but it is **downstream of a gate that
never lets execution reach it** for the single most common real offline
case. It only fires for the much narrower situation of "`navigator.onLine`
is (still) `true`, but this specific request's `fetch()` throws anyway" (a
real but comparatively rare partial-connectivity edge case) — not for "the
phone genuinely has no signal," which is the scenario the whole feature is
named for.

**Why this is worse than "the queue is unfinished":** `offlineQueue.ts`'s own
doc comment is candid that conflict resolution and retry-with-backoff are
unfinished, and that's a fair, stated scope cut. This is different — it is
not an unfinished corner of a working mechanism, it is the mechanism's
primary trigger being unreachable in the primary scenario, while every
surrounding signal (a `localStorage`-backed queue exists, `clientId` is
generated, `useQueuedIds` renders queued items in the list) suggests to
whoever reads the code — and to the hunter looking at "Saving…" — that it's
working. `CLAUDE.md` calls a silently-vanishing write "the worst outcome this
product can produce — worse than refusing." This is that outcome, and it is
also the quietest possible version of it: no error, no toast, no queued
badge, just a spinner that looks like progress right up until the app closes.

**Field cost:** a hunter logs a blank sit or a sighting with genuinely no
bars, closes the app (or it gets killed in the background, or the battery
dies) before signal returns, and the observation never existed. Every
downstream selection analytic this product's whole differentiator rests on
(`CLAUDE.md` §5, Manly selection ratios against availability) is quietly
undercounting effort exactly where signal is worst — which, for public land
in a hollow, correlates with exactly the stands worth analysing.

**Fix shape** (not prescribing implementation): either set `networkMode:
'always'` (or `'offlineFirst'`) on the mutations that need `offlineQueue.ts`
reachable while offline, so `mutationFn` always runs and its own `try/catch`
gets the chance to classify and enqueue; or move the offline detection ahead
of React Query entirely (check `navigator.onLine` inside the mutation
function and enqueue directly, never relying on the library's pause). Either
way, the fix needs a test that forces `navigator.onLine = false` and asserts
`ridgeline.offlineQueue.v1` gains an entry _before_ reconnecting — the exact
gap this finding exposes.

**Not caught by the invariant suite** — this is a data-durability defect, not
a rendering one, out of scope for `ui-invariants.spec.ts` by design.
`offlineQueue.test.ts` and `useOfflineRegions.test.ts` exist but (I checked)
test the queue's own persistence/replay logic in isolation with a
synthetic `ApiError` — they do not exercise the real trigger path through a
live `useMutation` with React Query's actual `networkMode` behaviour, which
is exactly where this gap lives. Proposed invariant/test: an integration test
that mounts the real `ObservationsSheet` behind the real `QueryClient`, sets
`navigator.onLine = false`, submits a blank sit, and asserts the queue gained
an entry synchronously — not "eventually succeeds once reconnected while the
tab happens to stay open."

---

### 3. HIGH — Going offline (or hitting a backend error) wipes the hunter's remembered property and tells them, falsely, that they have none

**What a hunter is trying to do:** reopen the app with no signal, at the
trailhead or mid-hunt, and get straight to logging against their own
property — which the app already promises via `currentProperty.ts`'s own doc
comment ("a hunter reopening the app at the trailhead should not have to
reselect their own property every time").

**Confirmed live:** signed in with a cached session and a persisted
`ridgeline.currentPropertyId.<user>` pointing at a real property, first
loaded once online (so the PWA shell installs), then `context.setOffline
(true)` and reloaded — a completely ordinary "relaunch the app with no
signal" sequence. Result: the Sightings tab shows

> _"Sightings & sits needs a property first — **create one** and draw its
> boundary once."_

— a **factually wrong** statement (the hunter has a property; the app simply
couldn't check) that then links to a flow (`/properties/new`, drawing a
boundary) which itself needs a live connection and cannot possibly succeed
offline. And `localStorage['ridgeline.currentPropertyId.<user>']`, which held
the correct id before the reload, comes back **`null`** afterward — the
remembered choice is gone, not just temporarily unavailable.

**Mechanical cause:** `lib/currentProperty.ts:95-115`. The effect that
restores a persisted property id gates only on `propertiesQuery.isLoading`:

```ts
if (propertiesQuery.isLoading) return; // wait for the real list before trusting anything
const stillExists = properties.some((p) => p.id === persisted);
if (stillExists) {
  setPropertyId(persisted);
} else {
  writePersisted(user.id, null);
  setPropertyId(null);
}
```

`isLoading` in TanStack Query v5 is `isPending && isFetching` — it is
**`false`** both when a fetch genuinely succeeds _and_ when a fetch is
paused offline with no cached data (`fetchStatus: 'paused'`, not
`'fetching'`) _and_ when a fetch has exhausted its retries and settled into
an error state. All three land here as "not loading," and the code cannot
tell "I successfully confirmed this property doesn't exist" apart from "I
never got an answer." It treats both as the latter — the property gets
deleted from the user's own remembered state and they're told (see finding
1's sibling failure mode) they have none.

**Field cost:** lower than findings 1–2 because nothing server-side is lost —
the property still exists, and reselecting it once signal returns is
mechanically possible (assuming the picker itself becomes reachable, which
also needs a successful fetch). But the _message_ is actively harmful in the
moment: it tells an offline hunter to go create a new property and redraw a
boundary, which cannot work offline and, if attempted later online without
realising the original property already exists, risks a duplicate property
with a fresh (wrong) `TerrainProfile` denominator for every future analytic.

**Fix shape:** distinguish `propertiesQuery.isSuccess` from
`isError`/paused-with-no-data before treating an absence from `properties` as
authoritative; only clear the persisted id on a _confirmed_ successful fetch
that doesn't contain it.

**Not caught by the invariant suite** — again a state-derivation defect, not
a rendering one.

---

### 4. MEDIUM — The waypoints list shows "No waypoints yet" and "Loading…" at the same time, so a still-pending fetch looks identical to a confirmed-empty property

**Source-confirmed**, `apps/web/src/components/waypoints/WaypointsSheet.tsx:
125-128`:

```tsx
{isLoading && <p className="rl-hint">Loading…</p>}
{isError && <p className="rl-hint">Could not load waypoints. Showing what is cached, if anything.</p>}
<WaypointList waypoints={waypoints ?? []} ... />
```

`WaypointList` renders its own "No waypoints yet" empty-state copy
(`WaypointList.tsx:24`) purely from an empty array, with no `isLoading` gate
of its own. `waypoints ?? []` means "we have no data yet" and "we confirmed
there is nothing" render identically. I observed this directly (screenshot,
`STANDS & MARKERS` panel showing "Loading…" immediately above "No waypoints
yet. Mark your stands..." simultaneously) while a mocked request was
deliberately slow. If a real fetch stalls or a offline-paused query never
resolves, a hunter with real stands already logged would see "No waypoints
yet" with no visual distinction from a fetch that's still in flight.

**Field cost:** moderate, cosmetic-adjacent but genuinely confusing — a
hunter checking "did my stand save" gets an answer that reads as confirmed-no
when the honest answer is "don't know yet."

**Fix shape:** gate `WaypointList`'s empty-state render on `!isLoading`
(mirroring what `ObservationList`/other lists in this codebase likely already
do — worth checking for the same shape elsewhere).

**Proposed invariant:** none of the six `ui-invariants.spec.ts` failure
classes cover "two mutually-exclusive states rendered simultaneously" — this
is a new shape worth naming (e.g., "loading and empty states never coexist
in the DOM for the same list").

---

### 5. MEDIUM, source-confirmed (live repro blocked by a test-harness flake, disclosed) — the Wind Check's own success-state copy claims offline capability it doesn't have

`WindCheckCard.tsx`'s file header calls this **"the flagship answer"** on a
stand's detail view. Its "no wind set" state is honest and well-written
("Set a wind direction... without one, this would be a guess rendered as an
answer" — genuinely good). But the mechanism behind it, confirmed by
`lib/api/waypoints.ts:34,46-53`, is `apiFetch<WaypointWindCheckDto>(
`/waypoints/${id}/wind-check?wind=...`)` — a live server round trip, not a
computation against the on-device DEM cache the way slope/aspect/landform
analysis is. Yet the card's own success-state copy says:

> _"Blends the wind you set with modelled thermal drift for this slope and
> time of day. **Resolves against the elevation on this device, so it works
> with no signal.**"_

That sentence is not true of the code path that produced the number it's
printed under. `CLAUDE.md`'s first non-negotiable is explicit that the
engine is shared client/server specifically so "a saved filter must produce
identical output on the laptop at camp and the phone at the bottom of a
draw" — the wind check, arguably the single most field-critical readout in
the app ("can I hunt this stand today"), is the one place I found that
breaks that pattern. Going genuinely offline does _not_ silently show a
stale/wrong answer — `isError` correctly falls back to a different, accurate
message ("Could not reach the wind check right now. Terrain and layers still
work offline") — so this is not a confidently-wrong-terrain defect in the
CLAUDE.md §2 sense. It's narrower: the copy on the _working_ path overstates
what the mechanism does, and the flagship interaction is the one place in
this app that goes fully dark exactly when a hunter standing at their own
stand with no bars needs it most.

**Disclosure on rigor:** I confirmed the network-call mechanism by source
(the `apiFetch` call is unambiguous) and confirmed the property/auth
plumbing needed to reach a live stand detail screen works via the same
mocking harness used for findings 1–3. I ran out of time chasing an
unexplained Playwright-route-interception flake specific to this one test
(a route registered exactly the same way that worked in three other tests in
this session stopped intercepting requests in this one, and I could not
isolate why within a reasonable budget, likely sandbox resource contention
from the concurrently-running second agent) — so I did **not** get a final
screenshot of the "offline, wind already set" state live. I'm reporting the
mechanism as confirmed by source and the copy claim as directly
contradicting it, and flagging the live "what does it actually render while
offline with a wind already set" screenshot as **not personally verified** —
a build agent should confirm the `isError` branch is what actually shows
(strongly likely given the source) rather than something worse.

---

## What's confirmed working — say this plainly too

- **Genuine signal loss keeps the hunter signed in.** A fully-offline reload
  (`context.setOffline(true)`, real CDP-level network blocking, not just the
  `navigator.onLine` flag) correctly hits `AuthContext`'s `kind === 'network'`
  branch: the cached user stays signed in, `isOffline` is surfaced, no bounce
  to `/login`. This is the one piece of the auth/offline picture that works
  exactly as designed — findings 1–2 are specifically about the cases
  _adjacent_ to this one, not this one itself.
- **The offline coverage badge is honest and specific.** Loading the app on a
  never-downloaded view shows _"NOT DOWNLOADED"_ with _"None of this view's
  elevation is on this device. Analysis layers here need a connection until
  you save this area. Checked all 15 tiles at zoom 14."_ — exact, not vague,
  and it correctly disables the Bedding Likelihood checkbox with _"Set a wind
  direction first — without one this layer would render against a default,
  which would be misleading rather than merely wrong."_ Good honesty pattern,
  confirmed live, screenshot on file.
- **Relief/hillshade gives real terrain context with zero basemap imagery.**
  In this sandbox, satellite/topo tiles are unreachable but DEM tiles are —
  and confirmed live, a stand-detail screenshot showed a fully legible
  grey-scale hillshade (ridgelines, draws) with **no basemap raster loaded at
  all**. That's the offline-elevation-only story working as intended: a
  hunter with cached DEM and no imagery still gets a readable terrain
  surface, not a black rectangle. (The one case that _is_ a black rectangle —
  a view whose elevation was never downloaded at all — is correctly labelled
  "NOT DOWNLOADED," not silently blank.)
- **`MatchShare` (the saved-filter live match share) is the best-handled
  honesty surface in this pass.** Source-reviewed in full
  (`components/filters/MatchShare.tsx`): eight distinct, correctly-worded
  states — empty, negation-unreliable (explicitly hides the number rather
  than show a known-wrong one — "A hidden statistic is the honest choice"),
  needs-wind, no-view, loading, **offline** ("Match share needs a connection
  — try again once you have signal. Everything else about this filter,
  including how it renders on the map, still works offline"), error, and
  result (which itself states its own zoom-mismatch and treats no-data cells
  as non-matches explicitly rather than silently). Nothing to fix here; if
  anything this is the model the property-gate and wind-check copy above
  should be brought in line with.
- **A failed save doesn't discard what the hunter typed.** `BlankSitQuickLog`
  and `ObservationForm` keep their own local component state; a mutation
  error (`create.isError`) shows inline (_"Could not save — try again"_)
  without unmounting the form or clearing sit-length/notes/conditions — so
  the _"signal's fine, server errored"_ sibling of finding 2 at least doesn't
  destroy the typed note, only requires the hunter to notice the message and
  retry. This does not help the true-offline case in finding 2 (that one
  never reaches this error state at all — it hangs on "Saving…" instead).
- **Cold start against a genuinely dead backend never white-screens or hangs
  forever.** Every screen I drove against this sandbox's real
  no-database/no-API state rendered _something_ — a specific error message,
  a gate, a spinner that resolved to a state — never a bare crash, blank
  white page, or unhandled exception in the console. That baseline
  robustness is real and worth stating alongside the sharper findings above.

## What I did not get to

- The full offline write queue's **conflict** path (a 409 from a concurrent
  edit) — not exercised this session; `offlineQueue.ts`'s own doc comment
  already discloses no merge UI exists yet, so I didn't spend the budget
  re-confirming a known, stated gap.
- Boundary drawing (`BoundaryEditor`/`PropertyBoundaryEditScreen`) end to end
  — blocked by the same "no backend" constraint for anything past the
  drawing interaction itself, and lower priority than the auth/queue findings
  above given the time available.
- A clean, uncontaminated run of `ui-invariants` (see §0) — needs a solo
  rerun.
- Reconnect-and-sync-exactly-once for a queue item that _did_ make it into
  `localStorage` (the narrow case where `navigator.onLine` stayed true but a
  request still failed) — I confirmed items enqueue and later flush via the
  `online` listener in principle (source, `offlineQueue.ts`'s `flushQueue`/
  `initOfflineQueue`), but did not specifically test double-flush safety
  (queueing the same clientId twice, flushing twice concurrently) live.
