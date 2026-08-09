# Product audit — Ridgeline

Independent product audits. Newest first. Written by `product-auditor`, which
deliberately does not read the engineering audit first.

The operating question is always the same: **would a serious whitetail hunter
switch to this and never go back?**

---

# 2026-08-07 — The left-hand chrome: rails, grouping, and growth

**Scope:** the floating map controls — `apps/web/src/App.tsx:250-307`,
`apps/web/src/index.css:37-171`, and `.rl-rail` / `.rl-conditions` /
`.rl-sheet--drawer` in `packages/design/src/styles.css`. Prompted by a direct
usability complaint from the founder, who uses this daily: *"Left side bar is
really hard to work with. If a full left hand nav design revamp is needed then
let's do it."* Treated as a finding to explain, not a hypothesis to test.

**Relationship to the 2026-08-06 pass below.** That pass's §3 *"Transient
controls vs persistent panels"* and its recommendation #5 *"Uncouple wind/time
from the layers sheet"* cover adjacent ground and were **landed** — `App.tsx`
now tracks sheet and popover state independently (`App.tsx:42-54`). This
section **extends** §3 to the controls themselves rather than the panels they
open, and reports that recommendation #5's stated goal — layer list and wind
editor usable at once — **is still not achieved on a phone**, for a layout
reason §3 did not examine. Recommendation #9 ("delete the fake grip") is
unrelated and stands. Where this section and §3 disagree on where a control
should live, this section supersedes.

**Verdict: the founder is right, and the complaint is bigger than the rail.
Revamp — but it is a re-container, not a rewrite** (one new primitive in
`packages/design`, ~40 lines of `App.tsx`, one CSS constant deleted).

## Sourcing note

`WebSearch` worked this session. `WebFetch` was **egress-blocked on every
competitor domain** — `support.onxmaps.com`, `help.gaiagps.com`,
`blog.caltopo.com`, `osmand.net` and `www.onxmaps.com/pdf` all returned
`EGRESS_BLOCKED`, and `raw.githubusercontent.com` returned 200. So the channel
map from the prior pass still holds, with one addition: **search works even
where fetch does not.**

Two tiers of citation, tagged inline and never mixed:

- **Primary, read from source.** `NWACus/avy` (cloned, `--depth 1
  --filter=blob:none`, grepped) and `osmandapp/OsmAnd` (layout XML via
  `raw.githubusercontent.com`, HTTP 200 confirmed).
- **`[snippet]`.** Vendor support-article text surfaced in search results but
  **not fetched and not read in full** — onX Hunt, Gaia GPS, HuntStand,
  CalTopo. Treat as a design prompt. A `[snippet]` is *not* grounds for a build
  decision on its own, and no recommendation below rests on one.

Nothing here is `[recalled]`. Every claim I could not source to one of those two
tiers was dropped rather than softened — including the entire CalTopo redesign
rationale, which is blocked and whose search snippet was too thin to use.

## The finding that matters most — and it was not on the brief

**On a phone, opening Layers hides wind, time and thermals. The product's
flagship interaction is therefore unavailable on the primary field device — and
the invariant suite records that as intentional.**

`apps/web/screenshots/07-mobile-sheet.png` shows it at 390px: the sheet is open,
and the `ConditionsBar` and the entire bottom-left rail are gone underneath it.

Three things make this invisible to the team rather than obvious:

1. `apps/web/src/index.css:161-170` documents the occlusion as *"a deliberate,
   temporary occlusion by a panel the user can dismiss"* — true as a statement
   about z-order, wrong as a product decision, because the thing occluded is the
   one control the panel's own content depends on.
2. `apps/web/e2e/ui-invariants.spec.ts:140-148` **whitelists** it in the
   hit-testability audit: an element covered by the open sheet is skipped rather
   than failed.
3. Invariant **group 4 (no chrome collisions) is desktop-only by construction**
   — `ui-invariants.spec.ts:399`, `test.describe('4. No chrome collisions
   (desktop)')`. Nothing measures the mobile arrangement at all.

So three separate mechanisms each independently decided this was fine.

`App.tsx:42-53` states the opposite intent in a doc comment: the sheet and the
popovers were deliberately decoupled because the flagship move — *"sweeping the
wind dial and watching leeward bedding likelihood repaint live"* — "needs the
layer toggle and the wind editor open at once." On desktop that half-works;
`apps/web/screenshots/04b-desktop-wind-popover.png` shows the wind popover
covering the Topo row, the LiDAR relief row and the Terrain Analysis heading
anyway. On mobile it does not work at all.

### The eight-interaction walkthrough

New user, phone, wants leeward bedding — the one thing no competitor has:

1. Sheet is open on load (`App.tsx:64`, `sheetOpen` defaults `true`). Scroll
   past Satellite / Topo / LiDAR relief. `07-mobile-sheet.png` shows only ~2.5
   rows fit — the sheet is capped at `62vh` (`packages/design/src/tokens.ts:236`,
   `layout['sheet-max-height']`).
2. Reach Terrain Analysis. Bedding is disabled with *"Set a wind direction first
   — without one this layer would render against a default, which would be
   misleading rather than merely wrong."*
   (`apps/web/src/components/LayersSheet.tsx:128-130`). **This is correct and
   honest and is the best moment in the app.**
3. The wind control is underneath the sheet you are reading.
4. **Close the sheet.** Forced, and forced only by this layout.
5. Tap Wind. 6. Set NW. 7. Dismiss popover.
8. Tap Layers, scroll back down, toggle bedding.

Eight interactions with a mandatory panel-close in the middle. On desktop the
same journey is five with no close.

**This is the argument that the layout is not cosmetic.** It is costing the
product its time-to-first-insight moment on the device it is actually used on,
and the moment it costs is the one the whole product exists for. The prior
pass's §5 identified time-to-first-insight as "the finding that matters most";
this is the same finding, reached from the chrome instead of the content.

## Ratings (hunter's perspective, /10)

| Dimension | Desktop | Mobile |
| --- | --- | --- |
| Discoverability of the three controls | 4 | **2** |
| Grouping / information architecture | 3 | 3 |
| Reachability one-handed at 05:30 | 6 | **2** |
| Map area preserved (the map is the product) | 6 | **2** |
| Honesty of the state shown | 4 | 4 |
| Survives roadmap growth to nine controls | **1** | **1** |
| **Overall left-hand chrome** | **4** | **2** |

`ConditionsBar`, by contrast, rates a **9**. It is the best-designed element in
the app and it is the template for the fix, not a thing to change.

## Findings

### F1 — The "rail" is not a rail. It is the orphaned bottom of the Layers drawer.

`.rl-sheet--drawer` sits at `left: var(--space-3)`
(`packages/design/src/styles.css:185`). `.chrome-bottomleft` is `justify-self:
start` inside a `.map-chrome` with `padding: var(--space-3)`
(`apps/web/src/index.css:42,63-66`). **Identical left edge, 12px apart
vertically.** In `04b-desktop-wind-popover.png` the sheet's left edge and the
rail's left edge are the same pixel column.

To a user this is not "a drawer and a rail." It is one object roughly 850px tall
running floor-to-ceiling down the left side. The founder's phrase — "left side
bar" — is literally accurate: there is no separate rail in the perceived UI, and
any fix framed as "redesign the rail" will miss what he is looking at.

### F2 — On mobile the rail is a full-width slab that is 88% empty and eats map pans.

`apps/web/src/index.css:154-159` sets `flex-direction: column-reverse;
align-items: stretch; justify-self: stretch`. `.rl-rail__btn` is fixed at `width:
var(--space-touch)` (`packages/design/src/styles.css:140`).

Result, plainly visible in `apps/web/screenshots/08-mobile-map.png`: a 366×134px
glass panel with three 44px icons pinned to its left edge and **322px (88%) of
dead glass**. `.map-chrome > * { pointer-events: auto }`
(`apps/web/src/index.css:54`) makes the whole slab hit-testable, so the bottom
quarter of the screen — exactly where a thumb rests — cannot pan the map.

Total bottom chrome at the suite's own `MOBILE` viewport of 390×844
(`apps/web/e2e/helpers/settle.ts:16`):

```
12px  padding-bottom       (--space-3)
134px rail                 (3 x 44px buttons + 2 x 1px gap)
12px  gap                  (--space-3)
58px  ConditionsBar
= 216px = 25.6% of the viewport
```

A quarter of the screen, to show three unlabelled glyphs and three readouts.

### F3 — The mobile stacking order contradicts its own comment.

`apps/web/src/index.css:143-146` states: *"Wind and time are the two things a
hunter re-checks constantly, so they get the bottom edge — the only part of a
large phone a thumb reaches reliably."*

`column-reverse` places the **first** DOM child last. `App.tsx:266` renders
`<Rail>` first and `<ConditionsBar>` second. So **the rail gets the bottom edge
and the ConditionsBar sits above it** — confirmed in `08-mobile-map.png`, where
the conditions row is at y≈1258-1375 and the rail slab is below it at
y≈1390-1660 (2× device pixels).

The stated field rationale is inverted in practice. No test covers it, because
group 4 is desktop-only.

### F4 — Icon-only, and the only affordance is a `title` that never fires on touch.

`packages/design/src/components/primitives.tsx:49-50` sets both `aria-label` and
`title`, with the comment *"the tooltip is what makes them learnable for
everyone else."* `title` is correct for a mouse and is **inert on every touch
device**. In the field the user has three unlabelled glyphs and no way to learn
them.

The download glyph is the dangerous one. An arrow-into-a-tray, floating over a
map, reads equally as "download this map for offline" (right), "export a GPX"
(wrong), or "collapse this panel" (wrong). Getting it wrong costs either a
20-minute download you did not want or — worse — *not* starting the one you did.

Every source I could actually read writes the word:

- **NWACus/avy** — the NWAC avalanche app; safety-critical, offline-capable,
  used in the field on a phone — renders a literal `<Text style={styles.label}>
  {label}</Text>` under every tab icon at `fontSize: 10`
  (`components/content/navigation/AnimatedBottomTabBar.tsx:26,101-102`) for its
  three tabs Map / Observations / Weather
  (`components/screens/navigation/BottomTabs.tsx:64,78,92`). It also passes
  `tabBarHeight` down into the map view (`BottomTabs.tsx:131`) so the map knows
  how much of itself the chrome is occupying — a detail Ridgeline has no
  equivalent of. *(primary source, cloned and read)*
- **osmandapp/OsmAnd** — `OsmAnd/res/layout/map_hud_bottom.xml` is a
  `bottom_controls_container` of stacked `<include>` slots, i.e. the bottom edge
  is the app's real control surface. *(primary source, fetched and read)*
- **Gaia GPS** ships a user-facing setting literally named **"Add Menu Button
  Labels"** — labels are a shipped feature, not an oversight. `[snippet]`
- **onX Hunt**'s mobile bottom toolbar is four named items: Location, Offline
  Maps, My Content, Tools. `[snippet]`
- **HuntStand** uses a labelled `TOOLS` entry alongside a `+`. `[snippet]`

### F5 — Three different verbs share one undifferentiated column, and the active state lies.

`App.tsx:267-293` puts three categorically different things into identical 44px
squares with identical `aria-pressed` amber treatment
(`packages/design/src/styles.css:155-158`):

- **a panel toggle** — Layers
- **an armed map tool** — Add waypoint
- **a long-running background task** — Save this area for offline use

The task is the honesty failure. `regions.active` — the download running *right
now* — is passed **only** to `RegionPicker` (`App.tsx:328`), which unmounts when
`pickerOpen` is false (`App.tsx:323`). Close the panel and a twenty-minute
download has **zero presence anywhere in the UI**. Meanwhile the rail button
glows amber for `active={pickerOpen}` (`App.tsx:286`) — which means *panel is
open*, not *download is running*. The one persistent signal the user gets about
the download is reporting the wrong variable.

Set against `CLAUDE.md`'s own line — *"Losing a region the user waited twenty
minutes for, discovered blank in the field, is the worst failure this product
has"* — the chrome currently gives that task no surface at all. The prior pass's
§4 audited the download *flow*; this is about its absence from the chrome once
the flow's panel is dismissed.

### F6 — The dead button, and it is the middle one.

`App.tsx:281-283`:

```tsx
<RailButton label="Add waypoint" onClick={() => undefined}>
  <PinIcon />
</RailButton>
```

No `disabled`, no `aria-disabled`, full hover styling
(`packages/design/src/styles.css:150-153`), full 44px target, and a `title` that
promises "Add waypoint." `PinIcon` has no other consumer in `apps/web`.

It sits **between** the two live controls, so the natural middle-of-the-stack
first tap is the one that does nothing. In a product whose second
non-negotiable is *"never be confidently wrong about terrain,"* a control that
claims a capability it does not have is that same defect class relocated from
the map to the chrome — and it is the second thing a new user touches.

### F7 — The rail cannot grow, and its height is a magic constant in a different file.

`apps/web/src/index.css:106-109`:

```css
@media (min-width: 861px) {
  .rl-sheet--drawer {
    bottom: calc(var(--space-touch) * 3 + var(--space-6) * 2);
  }
```

The `* 3` **is** "three buttons," encoded in a file that does not contain the
buttons. Adding a fourth silently overlaps the drawer with the rail unless
someone remembers to edit an unrelated rule in an unrelated package's consumer.
The file's own comment acknowledges the coupling — *"This app's own rail stacks
three buttons in that corner"* — which makes it documented, not fixed.

`docs/ROADMAP.md:115-117` adds property-boundary drawing, waypoint placement and
observation capture. Corridor solve and saved-filter editing follow. Nine
buttons is `9 × 44 + 8 × 1 = 404px`:

- Desktop 900px: the drawer drops from 708px to ~470px of usable height.
- Mobile 390×844: a full-width 404px slab is **48% of the phone**.

The rail does not survive nine. It does not survive four.

The only app I could read that has genuinely faced this abandoned fixed stacks:
**OsmAnd** anchors map buttons to the four screen corners on an auto-arranging
grid, lets users drag them, and lets users add their own `[snippet]` —
corroborated as a direction by the stacked-slot structure of
`map_hud_bottom.xml` *(primary)*. That is an escape hatch from a layout problem,
not a solution to it; see "What NOT to build."

### F8 — Top-right is the wrong corner for the most-used field control.

`App.tsx:251-263`. "Go to my location" is the one control pressed while walking,
in the dark, one-handed, possibly holding a bow. It is in the hardest corner of a
6.7" phone to reach with either thumb.

Meanwhile zoom `+`/`−` on a touch map are near-dead weight — pinch is the
gesture, and MapLibre already handles it — and they are occupying the
second-best real estate on the screen. onX puts Location in the **bottom**
toolbar `[snippet]`; Gaia lets the user move its add button to whichever side
they hold the phone `[snippet]`.

### F9 — Drift markers: a dead slot and a dead token.

- `.chrome-bottomright` is fully styled (`apps/web/src/index.css:73-77`)
  including a mobile `display: none` (`index.css:168-170`) and a reserved grid
  area (`index.css:48-51`), and is **never rendered** — no `chrome-bottomright`
  appears in any `.tsx` in `apps/web/src`.
- `--layout-rail-gap: 12px` (`packages/design/src/tokens.ts:237`,
  `packages/design/src/tokens.css:108`) has **zero consumers**; `.rl-rail`
  hardcodes `gap: 1px` (`packages/design/src/styles.css:131`).

Individually trivial. Together they say the chrome layer was designed once and
never revisited while four features landed on top of it — which is the actual
root cause of everything above.

## Recommendation: revamp, and here is the structure

I costed the timid option honestly: label the three buttons, delete the dead
one, fix the mobile full-width slab, fix the column order. That is an afternoon
and it fixes F2, F3, F4 and F6.

**I am rejecting it**, for exactly one reason: it does not touch F7. The rail's
height remains a function of the feature count, so the same complaint returns at
feature four, five and six, and each return costs another hand-edit to
`index.css:108`. Fix the container, not the symptoms.

**The principle.** `ConditionsBar` already solved this problem correctly: a
horizontal bar of labelled cells **whose height does not depend on how many
cells it has**, always visible, stating its value, saying "Not set" when it does
not know. Give the other three kinds of thing the same treatment and delete the
rail.

### The information architecture — three kinds, three containers, not one column

| Kind | Members (today → roadmap) | Container |
| --- | --- | --- |
| **Panels** | Layers, Offline → Filters, Property | **One** drawer button; tabs *inside* the drawer |
| **Map tools** (armed, modal) | *(none live)* → Waypoint, Boundary, Observation, Corridor | **One** primary action → tray |
| **Background tasks** | Region download | Not a button. A status cell, present only when running |
| **Conditions** | Wind, Time, Thermals | `ConditionsBar` — unchanged |

Three controls today. Three controls at nine features. That is the whole point,
and it is the part the "four fixes" option cannot deliver.

This respects the drawer-slot invariant at `App.tsx:272-276` — one `.rl-sheet`
at a time, tabs *inside* it rather than a second sheet — and the tool tray is
deliberately not a `.rl-sheet`, so the `elementFromPoint` trap that comment
guards against cannot be reintroduced from this direction.

### Mobile — 390 × 844

```
┌──────────────────────────────────────────┐
│                                          │
│                  MAP                     │  ← +78px reclaimed
│                                          │
│                                    ( ⌖ ) │  ← locate, right edge, y≈62%
│                                          │
├──────────┬──────────────┬────────────────┤
│   [≡]    │     [+]      │      [↓]       │  Command bar     56px
│  LAYERS  │    MARK      │  OFFLINE 43%   │  3 cells @ 122px
├──────────┴──────────────┴────────────────┤  gap             12px
│ ◈ WIND FROM │ DATE & TIME │   THERMALS   │  ConditionsBar   58px
│   315° NW   │ Aug 6 6:04  │    Rising    │  ← bottom edge (F3 fixed)
└──────────────────────────────────────────┘
```

- Bottom chrome **~138px vs 216px today — 78px of map returned** — while every
  control *gains* a word.
- Cells 122 × 56px. Comfortably over the 44px gloved floor
  (`packages/design/src/tokens.ts:160`), and wide enough that the label is real
  text rather than a truncation.
- Labels use `--text-xs` / `--font-condensed` / uppercase / `--track-label` —
  deliberately the same recipe as `.rl-conditions__label`
  (`packages/design/src/styles.css:332-338`) so the two rows read as one system
  rather than two bolted-together widgets. No new visual values; all tokens.
- **Zoom `+`/`−` removed below 861px.** Pinch is the gesture. This deletes the
  mobile top-right rail entirely.
- **Locate** becomes a single 56px circular button on the **right edge at ~62%
  viewport height** — inside the right-thumb arc, clear of the sheet, clear of
  the command bar. Deliberately above the 44px floor because it is pressed while
  moving.
- **The sheet must stop covering the ConditionsBar.** Cap
  `--layout-sheet-max-height` so the sheet's top edge clears the 58px conditions
  row instead of running to `bottom: 0`
  (`packages/design/src/styles.css:230-237`). This single change is what makes
  the wind-sweep flagship possible on a phone.

### Desktop — 1440 × 900

Same command bar, one horizontal row, inside the existing `.chrome-bottomleft`
flex row alongside the ConditionsBar:

```
┌────────────────────────────────────────────────────────────────────────┐
│ ┌──────────┐                                                    ┌────┐ │
│ │  LAYERS  │                                                    │ +  │ │
│ │  DRAWER  │                    MAP                             │ −  │ │
│ │  (360px) │                                                    │ ⌖  │ │
│ │          │                                                    └────┘ │
│ │          │                                                           │
│ └──────────┘                                                           │
│ ┌──────────┬────────┬─────────────┐ ┌───────────┬───────────┬────────┐ │
│ │ ≡ LAYERS │ + MARK │ ↓ OFFLINE   │ │ ◈ WIND    │ DATE&TIME │THERMALS│ │
│ └──────────┴────────┴─────────────┘ └───────────┴───────────┴────────┘ │
└────────────────────────────────────────────────────────────────────────┘
                        56px, one row, forever
```

- Command-bar height **56px, one row, independent of control count**.
- `.rl-sheet--drawer`'s bottom offset drops from `calc(var(--space-touch) * 3 +
  var(--space-6) * 2)` = 180px to `calc(56px + var(--space-6))` ≈ 80px. **The
  drawer gains ~100px of height and the `* 3` magic constant dies** — F7 fixed
  structurally rather than by discipline.
- Top-right rail keeps `+` / `−` / locate on desktop. Mouse users expect it and
  it costs nothing there.
- Trigger stability (`ui-invariants.spec.ts` group 2) is preserved by
  construction: the command bar reserves its own fixed height and nothing
  translates, which is the property `index.css:79-104` fought to establish.

### The tool tray, and the one detail that beats onX on the ground

`MARK` opens a tray — **not** the drawer — containing Waypoint · Boundary ·
Observation · Corridor. Every future map tool goes there and the bar's width
never changes.

When a tool is armed, **the map shows a fixed centre crosshair** and the command
bar is replaced by a two-cell strip: `PLACE HERE` (primary) / `CANCEL`.

Centre-crosshair placement, **not** tap-to-place. onX and HuntStand both appear
to use tap-to-place `[snippet]`, and tap-to-place has a defect nobody markets:
**your finger covers the pixel you are aiming at**, and a gloved fingertip
occludes roughly 20mm of screen. Dragging the map under a fixed crosshair keeps
the target in clear sight and turns the commit into a large, unambiguous,
gloved-thumb button. This is the detail that makes the revamp worth doing rather
than merely tidy, and it is a genuine on-the-ground improvement over the
incumbents rather than a copy of them.

### The download, as a task rather than a button

The `OFFLINE` cell states its own truth: idle → `OFFLINE`; running → progress
ring plus `43%`; just finished → `SAVED`; failed → `FAILED` in warn tone. That
gives a running download the persistent surface it has none of today (F5),
removes the misleading `active={pickerOpen}` amber (F5), and reuses the existing
`Chip` tone vocabulary in `packages/design`.

## What NOT to build

Being explicit, because two of these are tempting and one is already half-built:

- **User-repositionable buttons (the OsmAnd answer).** A settings screen, a
  persistence model and a collision solver, to work around a layout that is
  wrong. Ridgeline has one screen and one job. Get the layout right instead.
- **A hamburger / main menu (onX's top-left `[snippet]`).** There is nothing to
  put in it. Ridgeline is a map, not an account portal.
- **Long-press tooltips as the answer to icon-only.** A workaround for the wrong
  decision. Write the word under the icon.
- **A permanent desktop sidebar.** `packages/design/src/components/
  primitives.tsx:70-76` already argues this correctly — a permanent sidebar
  costs a third of the screen forever, and the map is the product. Do not
  reopen it.
- **Compass mode, north-up toggle, rangefinder.** Not on the roadmap and not
  what was complained about.
- **Zoom buttons on mobile.** Delete them. They cost the best corner on the
  screen to duplicate a gesture every user already has.

## Prioritised recommendations

Continuing the numbering from the 2026-08-06 pass, which ends at #14.

### 15 — Delete the dead "Add waypoint" button · XS · `frontend-builder`

`App.tsx:281-283`. Fixes **F6**. Ship a real waypoint tool or ship nothing;
`disabled` with a stated reason would be more honest than today but a hunting
app's second control being greyed out on first run is a poor first impression.
Independent of everything else here — do it now.

### 16 — Stop the mobile sheet covering the ConditionsBar, and test it · S · `frontend-builder` + `field-qa`

Fixes **the headline finding** and part of **F2**. Cap
`--layout-sheet-max-height` so the sheet clears the conditions row
(`packages/design/src/styles.css:230-237`). **Must land with a mobile collision
invariant** — group 4 is desktop-only at `ui-invariants.spec.ts:399`, which is
precisely why this survived. Per `CLAUDE.md`: the fix and the invariant that
would have caught it are two commits' worth of work. This is the item that
changes what a hunter can actually do on a phone.

### 17 — `CommandBar` primitive in `packages/design` · M · `frontend-builder`

Labelled cells, horizontal, fixed height, with a task-status cell variant.
Fixes **F1, F2, F3, F4, F5, F7**. All values from tokens; label typography
reuses the `.rl-conditions__label` recipe so the two bars read as one system.

### 18 — Replace the rail with `CommandBar`; delete the `* 3` constant · S · `frontend-builder`

`App.tsx:265-294` and `apps/web/src/index.css:106-109`. Fixes **F1, F7**. The
drawer's bottom offset becomes a function of the bar's fixed height rather than
of the button count — this is the change that stops the complaint recurring.

### 19 — Mobile: drop zoom buttons, move locate to the right-edge thumb arc · S · `frontend-builder`

`App.tsx:251-263`. Fixes **F8**. 56px circular button, right edge, ~62%
viewport height.

### 20 — Drawer tabs (Layers / Offline) inside the single drawer slot · M · `frontend-builder`

Fixes the panel half of **F5** and is the growth path for Filters and Property.
Must preserve the one-sheet-at-a-time invariant at `App.tsx:272-276` — tabs
inside one `.rl-sheet`, never two stacked.

### 21 — Tool tray + centre-crosshair placement · M · `map-builder` + `frontend-builder`

Lands with waypoint capture (`docs/ROADMAP.md:116`). The growth container for
every future map tool, and the one place this design is better on the ground
than the incumbents rather than merely equal to them.

### 22 — Delete `.chrome-bottomright` and `--layout-rail-gap`, or use them · XS · `frontend-builder`

`apps/web/src/index.css:73-77,168-170`; `packages/design/src/tokens.ts:237` and
`tokens.css:108`. Fixes **F9**. Housekeeping, but it is the drift that produced
everything above.

**Sequencing.** #15 and #16 are independently shippable and worth landing before
the revamp. #17 → #18 is the structural core. #19-#22 follow in any order.

## Two things that are not criticisms

`ConditionsBar` is genuinely excellent and this work must not touch it. The
reasoning at `packages/design/src/components/primitives.tsx:122-131` — wind and
time are not settings, they change what every layer *means*, and burying that in
a panel would make the map quietly ambiguous — is the best product thinking in
the repository. The command bar proposed above is a copy of it, not a
replacement for it.

And **bottom-left for Layers is not the mistake.** HuntStand puts its map-layers
control in the bottom-left too `[snippet]`. The corner is conventional and fine.
The mistake is everything that got stacked on top of it without anyone asking
whether it belonged in the same column.

---

# 2026-08-06 — Interaction patterns from serious outdoor and map applications

**Scope:** what Ridgeline's UI should learn from avalanche forecast products,
offline-map downloaders, and the bottom-sheet baseline every user's muscle memory
is trained on. Audited against the current `apps/web` UI as of this date.

**Revised the same day, second pass.** The first pass had no network access and
labelled itself accordingly. This revision found a working research channel for
the most important comparison — the two reference avalanche products are open
source — and has rewritten §2 and recommendation #8 from source rather than
memory. It also **deletes or downgrades** the claims about closed products it
still cannot check. Read the sourcing note before citing anything here.

## Sourcing note — read this before trusting a citation

**Second pass, 2026-08-06.** The first pass could not do any live research and
said so. This pass got partway. What changed and what did not:

**Still blocked.** Egress policy allows GitHub-family hosts only. `avalanche.org`,
`caltopo.com`, `gaiagps.com`, `fatmap.com`, `en.wikipedia.org` and every search
engine still return `403` at CONNECT; `WebSearch`/`WebFetch` are not enabled in
this context; the GitHub search API is repository-scoped. Verified by probe, not
assumed.

**What worked.** `git clone` over HTTPS to `github.com` and
`raw.githubusercontent.com` both succeed for arbitrary public repositories. That
turned out to be enough for the section that matters most, because **the two
reference avalanche products are open source**. Everything in the avalanche
sections below is now quoted from source files and shipped help text that were
cloned and read today, not recalled.

Primary sources actually read (all cloned at `--depth 1` on 2026-08-06):

| Source | What it is | Files read |
|---|---|---|
| [`NWACus/avy`](https://github.com/NWACus/avy) (MIT, © Northwest Avalanche Center) | The official NWAC / US National Avalanche Center forecast app. Implements NAPADS. | [`components/DangerRose.tsx`](https://github.com/NWACus/avy/blob/main/components/DangerRose.tsx), [`components/SeverityNumberLine.tsx`](https://github.com/NWACus/avy/blob/main/components/SeverityNumberLine.tsx), [`components/AvalancheProblemLikelihoodLine.tsx`](https://github.com/NWACus/avy/blob/main/components/AvalancheProblemLikelihoodLine.tsx), [`components/AvalancheProblemSizeLine.tsx`](https://github.com/NWACus/avy/blob/main/components/AvalancheProblemSizeLine.tsx), [`components/AvalancheProblemCard.tsx`](https://github.com/NWACus/avy/blob/main/components/AvalancheProblemCard.tsx), [`content/helpStrings.ts`](https://github.com/NWACus/avy/blob/main/content/helpStrings.ts), [`types/nationalAvalancheCenter/schemas.ts`](https://github.com/NWACus/avy/blob/main/types/nationalAvalancheCenter/schemas.ts) |
| [`albina-euregio/albina-website`](https://github.com/albina-euregio/albina-website) | The EUREGIO `avalanche.report` platform (Tyrol / South Tyrol / Trentino). EAWS-conformant; its glossary content is republished from `avalanches.org`. | [`app/components/icons/exposition-icon.tsx`](https://github.com/albina-euregio/albina-website/blob/master/app/components/icons/exposition-icon.tsx), `app/components/icons/warn-level-icon.tsx`, `app/components/bulletin/bulletin-danger-rating.tsx`, `app/components/bulletin/bulletin-problem-item.tsx`, `public/content/education/danger-scale/en.html`, `public/content/education/handbook/en.html`, `app/components/bulletin/bulletin-glossary-en-content.json` |
| [`material-components/material-components-android`](https://github.com/material-components/material-components-android) | The written spec behind the bottom-sheet muscle memory on Android. | [`docs/components/BottomSheet.md`](https://github.com/material-components/material-components-android/blob/master/docs/components/BottomSheet.md) |
| [`organicmaps/organicmaps`](https://github.com/organicmaps/organicmaps) | A shipping offline-map app with a mature region-download flow. Used as a **stand-in** for Gaia/onX, which are closed. | [`data/strings/strings.txt`](https://github.com/organicmaps/organicmaps/blob/master/data/strings/strings.txt) |

**Still unverified, and now marked as such in the text.** CalTopo, Gaia GPS,
FATMAP, onX Hunt, HuntStand, Komoot, Strava, Google Maps and Apple Maps are all
closed products with no reachable documentation from here. Claims about them are
labelled **[recalled]** where they survive, and several first-pass claims have
been **deleted outright** rather than left standing — including the Gaia
layer-catalogue size and the FATMAP/Strava status. A `[recalled]` claim is
prior working knowledge, is fine as a design prompt, and is **not** adequate
grounds for a build decision on its own.

**The research changed the headline recommendation.** The first pass proposed a
"bedding rose" with wedges *shaded by modelled likelihood*. Both reference
products deliberately do not do that — see §2, which has been rewritten, and the
full spec in recommendation #8.

**Findings about our own code were verified against the source in the first pass
and are unchanged here.**

## What we studied

| Product | Why it is the relevant comparison | Evidence status |
|---|---|---|
| **Avalanche forecast products** — NAPADS as implemented by the US National Avalanche Center; EAWS as implemented by the EUREGIO `avalanche.report` platform | The closest analogue to our problem: modelled and judged risk presented honestly to people making life-safety decisions on terrain. The danger scale, the aspect/elevation rose, the separation of likelihood from size, and the scale-of-validity statement. **This is the important one and it is now fully sourced.** | ✅ **Read today** — [`NWACus/avy`](https://github.com/NWACus/avy), [`albina-euregio/albina-website`](https://github.com/albina-euregio/albina-website) |
| **Google Maps / Apple Maps** | The baseline every user's muscle memory is trained on. Bottom sheets with detents, floating controls, what a control that opens a panel is *expected* to do. | ⚠️ Partially — the underlying **Material** bottom-sheet spec was read; the two products themselves were not reachable |
| **Offline region download** | How size, progress and failure are communicated. Gaia and onX are the products hunters actually use; both are closed. | ⚠️ **Substituted** — [`organicmaps/organicmaps`](https://github.com/organicmaps/organicmaps) shipping strings read today. Gaia/onX specifics are **[recalled]** |
| **CalTopo** | The power-user backcountry mapping tool. Composable base layers, per-overlay opacity, custom layer URLs, unapologetic density. Users are SAR professionals. | ❌ **[recalled]** — `caltopo.com` unreachable |
| **Gaia GPS** | The mobile map-first pattern at scale: a large searchable layer catalogue separated from a short active stack. | ❌ **[recalled]** — `gaiagps.com` unreachable |
| **FATMAP** | 3D terrain and slope-angle shading for avalanche terrain; curated map modes rather than a catalogue. | ❌ **[recalled]** — `fatmap.com` unreachable |
| **Komoot / Strava** | Route-planning interaction and elevation-profile presentation; the map↔profile crosshair link. | ❌ **[recalled]** |
| **onX Hunt / HuntStand** | The incumbents we are trying to displace. Studied mainly for what not to copy. | ❌ **[recalled]** |

## Ratings

| Area | Rating | One-line verdict |
|---|---|---|
| Layer management at scale | **B−** | Well-organised for 10 layers, with real craft in the blurbs and exclusivity rules — but it does not scale to a filter library, and it is a wall of prose on a phone. |
| Presenting modelled/uncertain output | **D** | The `Confidence` primitive is built, exported, documented — and used in **zero** places in the app. Bedding renders in the same confident visual grammar as slope. This is the moat, and it is currently invisible. |
| Transient controls vs persistent panels | **B** | `ConditionsBar` + anchored `Popover` is genuinely excellent and better than the incumbents. Undermined by one state variable that makes the flagship interaction impossible. |
| Offline download flow | **F** | The download button is `onClick={() => undefined}`. The "Offline ready" chip is a global boolean sampled once at mount and will lie to a user standing on uncached ground. |
| Time to first insight | **D+** | A new user is shown a beautiful map that tells them nothing they did not already know. There is no moment where the app *reads the ground for them*. |
| Field experience (gloved, dark, one-handed) | **C+** | 44 px touch floor, glass material, colour never load-bearing alone — all correct at the token level. Then a fake drag handle, a sheet that hides the conditions bar on mobile, and no night mode. |

---

## Findings by question

### 1. Layer management at scale

**What the good ones do.** *Everything in this subsection is* **[recalled]** —
CalTopo, Gaia and FATMAP were all unreachable. Treat it as a design prompt, not
as evidence. The specific numbers the first pass carried (Gaia's catalogue size)
have been deleted rather than left standing.

The single most transferable idea is the one Gaia GPS gets right and almost
everyone else gets wrong: **separate "what is on" from "what exists".** Gaia's
layer UI is two surfaces — a short, ordered, per-layer-opacity *active stack* you
can reorder and delete from, and a larger searchable, categorised *catalogue* you
add from. The active stack stays a handful of items long forever; the catalogue
can grow without the panel becoming a wall, because you only visit it when you
are adding something.

CalTopo takes the opposite bet and it also works, for a different reason. Its
list is dense, flat, and little is hidden behind progressive disclosure — but its
*top-level* list stays short because layers are **compositional**: one topo entry
with toggleable sub-layers rather than six top-level entries. The lesson is not
"be dense"; it is **density is fine, unpredictability is not**. CalTopo's users
tolerate a wall because the wall never moves and every control is one click deep.

FATMAP goes the third way: a handful of curated *modes*, not a layer list. Right
answer for a mainstream audience, wrong answer for ours.

**Deleted from the first pass:** a claim about FATMAP's current status inside
Strava. It could not be verified from here, it was doing no work in the argument,
and a product audit that cannot check a fact should not assert it.

**Where Ridgeline actually is.**

`apps/web/src/lib/layers.ts` is one of the better-reasoned files in the
repository. The header comment states the cartographic rules and the code
enforces them — `exclusive` on the four continuous ramps, base-layer radio
behaviour, `LAYER_GROUPS` with a hint per group. `toggleLayer()` enforcing
one-ramp-at-a-time rather than trusting the user is exactly right, and better
than CalTopo, which will happily let you composite three ramps into mud.

Three problems, in order of severity.

**(a) It is a wall of prose on a phone.** `LayersSheet` renders all ten layers,
all groups expanded, with every `blurb` always visible. The blurbs average
around 25 words. That is roughly 250 words of body copy in a sheet whose mobile
`max-height` is a fraction of the viewport. "Bedding likelihood" — the flagship
layer, the one that embodies advantage #1 — is **last in the list**, behind
about three phone-screens of scrolling. At 05:30 with gloves on, the most
differentiating thing this product does is three scrolls deep.

The blurbs are a genuine advantage and must not be deleted. The fix is
disclosure, not deletion: show the blurb for the row that is on or focused,
collapse the rest to the label plus a swatch. Keep the full text one tap away
and keep it in the DOM for screen readers.

**(b) There is no design for the case that matters.** Ten fixed layers do not
need search. **An unbounded saved-filter library does.** The vision document is
explicit that the filter library is the user's scouting IP and the source of
switching costs — which means a committed user has twenty to fifty of them, and
`LayersSheet` renders saved filters as an undifferentiated flat list with no
search, no favourites, no recency, no folders, and no way to create one (`New
filter` is `onClick={() => undefined}`).

Apply the Gaia split *asymmetrically*: the ten analysis layers stay a curated,
grouped, always-visible short list. Saved filters get search, favourites,
recently-used, and eventually folders. **Do not build a catalogue browser for
ten items** — that is fake sophistication and it would make the fixed layers
harder to reach in exchange for solving a problem we do not have.

**(c) No summary of the current state.** When the sheet is closed there is
nothing on screen that says what is on. Every serious mapping tool has some
version of this. A one-line active-stack summary in the rail, or a badge count
on the layers button, costs almost nothing.

**Not worth copying:** drag-to-reorder for the ten analysis layers. The
exclusivity rules and the documented stacking order (imagery → hillshade →
ramp → discrete) already determine a correct z-order, and letting a user put
slope under hillshade produces a worse map with no upside. Reorder matters for
**saved filters only**, where the user's colour choices genuinely compete.

---

### 2. Presenting modelled and uncertain output

This is the section that matters most, and it is where Ridgeline currently
scores worst against its own stated values.

**What avalanche forecasting actually does — now sourced.**

Avalanche forecasting is the mature discipline for publishing a judgement about
terrain to people who will act on it and can be killed by it being wrong. The
first pass reasoned about it from memory and got two things wrong. Here is what
the shipping code and shipping help text say.

**(i) Ordinal, never continuous; four redundant channels.** Both scales are five
levels, and both attach more than a colour to each level. NAPADS, quoted from
NWAC's shipped `dangerScaleDetail` help string:

> The North American Public Avalanche Danger Scale (NAPADS) is a system that
> rates avalanche danger and provides general travel advice based on the
> likelihood, size, and distribution of expected avalanches. It consists of five
> levels … 1 - Low, 2 - Moderate, 3 - Considerable, 4 - High, 5 - Extreme.
> … Although the danger ratings are assigned numerical levels, **the danger
> increases exponentially between levels.**

— [`avy/content/helpStrings.ts`](https://github.com/NWACus/avy/blob/main/content/helpStrings.ts)

That last clause is the sentence to steal. They number the levels and then
immediately warn the reader **not to do arithmetic on the numbers**. An ordinal
scale that looks like a cardinal one is a trap, and they defuse it in the help
text rather than hoping nobody notices.

EAWS resolves the first pass's `[verify]` marker and diverges in one place: level
5 is **"Very high"**, not "Extreme". Each level carries a numeral, a name, a
one-line *situation phrase*, a description, and a **"Recommendations for
backcountry recreationists"** block:

> Danger level 3 – Considerable · *Critical avalanche situation* … **The most
> critical situation for backcountry recreationists.** Use terrain efficiently
> and select best possible route and with minimal exposure. Avoid very steep
> slopes with the aspect and elevation indicated…

— [`albina-website/public/content/education/danger-scale/en.html`](https://github.com/albina-euregio/albina-website/blob/master/public/content/education/danger-scale)

**And EAWS publishes the base rate of every level.** Level 1: "Forecast for
around 20 % of the winter season. Around 5 % of avalanche fatalities." Level 2:
~50 % of the season, ~30 % of fatalities. Level 3: ~30 % of the season, **~50 %
of fatalities**. Level 4: "only a few days throughout the winter", ~10 % of
fatalities. Level 5: "Very rarely forecast."

This is the most quietly radical thing in either product and no hunting app does
anything like it. Publishing how often a class is issued *and* what share of bad
outcomes it accounts for lets the user calibrate. It is the same instinct as this
project's use-vs-availability rule, applied to the legend instead of the chart.
**Ridgeline should publish the base rate of every bedding class on the current
property**: "prime covers 4 % of this ground" is worth more than the colour.

Ridgeline currently renders `bedding` as a continuous colour ramp over a
multiplicative composite whose weakest inputs are graded 🔴 **Assumed** in
`docs/EVIDENCE.md` (`idealSlopeDeg: 22`, the 30° shelter saturation, the
ruggedness/4 m cover term; the leeward `cos(aspect − windFrom)` term is 🟡
Doctrine). A smooth ramp over that is a precision claim we cannot support.
**Band it** — three or four ordinal classes with hunter-language names and a
sentence each. Banding is not dumbing down; it is refusing to publish decimal
places we do not have.

**(ii) The rose is a binary mask, not a heatmap. The first pass had this wrong.**

This is the correction that matters. The first pass proposed a bedding rose with
wedges "shaded by modelled bedding likelihood". **Neither reference product
shades its rose by magnitude.** Both use it as a presence/absence mask over the
terrain space, and put the ordinal magnitude somewhere else entirely.

NWAC's rose is 8 aspects × 3 elevation bands = 24 sectors, and every sector is
filled with one flat grey or left transparent:

```tsx
// avy/components/DangerRose.tsx
<Path d={paths[location]} stroke={'rgb(81, 85, 88)'} strokeWidth={10}
      fill={locations.includes(location) ? 'rgb(200, 202, 206)' : 'transparent'} />
```

The shipped explanation is unambiguous — *"The diagram **will be filled with
black where the Avalanche Problem may exist**"* — and it also documents the ring
order, which is inverted relative to what most people guess:

> You can view the diagram as you would a mountain on a topographic map. The
> **outer ring** represents the **Below Treeline** elevation band, middle ring
> Near Treeline, and the **inner ring Above Treeline**. The diagram is oriented
> like a compass, with the top wedges representing north aspects, the left wedges
> representing west.

EAWS is even more reduced: 8 aspects, **no elevation rings at all**, one flat
blue fill (`#19ABFF`), and only N and S labelled
([`exposition-icon.tsx`](https://github.com/albina-euregio/albina-website/blob/master/app/components/icons/exposition-icon.tsx)).
Elevation is carried by a *separate* icon with an explicit threshold — "above
2200 m", "treeline", or a band "1800–2400 m" — and danger level by a *third*
icon, a mountain split above/below one elevation line showing at most two levels
(`warn-level-icon.tsx`, `bulletin-danger-rating.tsx`). The EAWS handbook: *"The
blue-marked segments of a wind rose are indicators of those aspects."*

**Why they refuse to shade it.** The rose answers *where*; the scale answers *how
bad*. Colouring 24 cells by magnitude produces a field nobody can read at a
glance and implies the model resolves danger at 24 aspect×elevation combinations,
which it does not. Our bedding model does not resolve at 24 combinations either.

**Two details worth copying exactly.** First, **every cell is stroked, including
the empty ones** — the unselected sectors are drawn as outlines, so the full
24-cell grid is always present. You always see the denominator. That is the
use-vs-availability principle rendered as a graphic, and it costs one line of
code. Second, the elevation band *names* are a parameter
(`ElevationBandNames` is passed into `AnnotatedDangerRose`), because different
forecast centres use different vocabulary for the same bands.

A bedding rose is still the single best idea in this audit. The encoding is
different from what the first pass proposed. Full spec in recommendation #8.

**(iii) Likelihood and size are separate axes — but distribution is not a third
one.** The first pass said "likelihood is reported separately from consequence",
which is right, and implied distribution is an independent third axis, which is
wrong. NWAC's help text:

> **Likelihood** … *combines* the spatial distribution of the Problem and the
> sensitivity or ease of triggering an avalanche.

So distribution is folded *into* likelihood, and *also* drawn separately on the
rose — deliberately shown twice, once as a component of the ordinal and once as a
map of where. Size is genuinely independent and never multiplied in.

**The uncertainty encoding the first pass missed entirely: the ordinal is
published as a range.** `AvalancheProblemSizeLine` takes `size: number[]` — a
`[from, to]` pair — and `SeverityNumberLine` renders it as a **bar spanning
several labels**, with every covered label bold and the rest greyed:

```ts
// avy/components/SeverityNumberLine.tsx
export interface SeverityNumberLineRange { from: number; to: number; }
```

A forecaster who is unsure between "Large" and "Very Large" publishes *both* and
the graphic shows a two-cell bar. This is a far better answer to model
uncertainty than a confidence chip bolted onto a point estimate, and it is
directly transferable to a banded bedding class. EAWS does the complementary
thing and **truncates the top of the scale**: sizes 3, 4 and 5 all map to the
same visual class (`textInfoToClass` in `bulletin-problem-item.tsx`), because
above a point the distinction stops changing what you do.

**(iv) Confidence — partially confirmed, and one first-pass claim corrected.**
`High / Moderate / Low` is real and is in the national data model:

```ts
// avy/types/nationalAvalancheCenter/schemas.ts
export const DangerConfidence = { High: 'high', Moderate: 'moderate', Low: 'low' } as const;
export const DangerTrend      = { Increasing: …, Steady: …, Decreasing: … } as const;
```

Two corrections. It sits on the `danger_rating` object **alongside a trend**, and
it is optional (`.or(z.string().length(0))`). And there is **no structured
"reason" field** — the first pass asserted confidence is published "with the
reason", and I could not verify that. The justification lives in free prose
(`bottom_line`, `terrain_use`, `avalanche_problems_comments`). So: the three-level
vocabulary is confirmed and worth adopting verbatim; the claim that a machine-
readable justification accompanies it is withdrawn.

The **trend** field is a free idea we should take. EAWS ships the same thing as
`tendency` (*increasing / steady / decreasing*, "expected trend for the following
day"). Bedding has an obvious analogue: thermal phase turns over twice a day and
the wind forecast moves. "Bedding likelihood on these faces is **decreasing** —
the thermal switches in 40 minutes" is a sentence no hunting app can currently
produce and our engine already has the inputs for.

**(v) The scale-of-validity statement — the best single sentence in either
product, and we have no equivalent.**

> The danger level always applies to a **region with an area of >100 km²** and
> **not to a specific individual slope**. The avalanche danger described on
> avalanche.report is always a forecast with uncertainties. **It should always be
> checked on site.**

They render a per-region colour on a map and then state in plain words the
resolution at which that colour is meaningful — which is much coarser than the
pixels imply. Ridgeline renders bedding at DEM resolution and implicitly claims
per-pixel truth. We do not have per-pixel truth. Every judgement layer and the
bedding rose should carry a one-line extent-and-resolution statement. It costs a
sentence and it is the difference between a forecast product and a toy.

**And here is where all of (i)–(v) lands against our own build.** The evidence
grades are written, the vocabulary is chosen, the primitive exists —
`docs/EVIDENCE.md` is precisely the register that (iv) describes, and the
`Confidence` primitive is precisely the chip it should be rendered as. And:

```
$ grep -rn "Confidence" apps/web/src/
(no matches)
```

The primitive is defined at `packages/design/src/components/primitives.tsx:467`,
exported, carries a thoughtful doc comment about being a design-system primitive
"so that showing the evidence grade is the path of least resistance" — and is
used in **zero** places in the application. The register grades nine parameters
🔴 Assumed. A user of the current build sees none of that. The product's
deepest claimed moat, "honest analytics", is presently a markdown file.

**(vi) When the model has nothing to say, the graphic is removed — not drawn
empty.** Verified, and it is more decisive than the first pass claimed. The EAWS
handbook:

> If no particular avalanche problem predominates (often the case at danger level
> 1 – low) **this information is omitted** and a favourable avalanche situation
> is declared.

Not a greyed rose. Not 24 empty cells for the user to interpret. The diagram is
withdrawn and replaced by a positive statement in words. This is the pattern for
degradation, and it is the basis of the low-confidence behaviour in the rose spec
below.

Ridgeline already has the right instinct here — `blockedReason` on `ToggleRow`
and the missing-wind path are genuinely good, and better than most commercial
products. Credit where due. What is missing is the second half: when the *inputs*
are present but the *model cannot discriminate*, we currently draw a flat map and
say nothing.

**The cartographic rule nobody in hunting apps follows, and we should.**
**[recalled]** for the competitor half — I could not reach FATMAP, CalTopo or
Gaia. What I *can* evidence is the discipline's own separation: EAWS draws the
aspect rose, the elevation threshold and the danger level as **three separate
graphics** (`exposition-icon`, `elevation-icon`, `warn-level-icon`) rather than
one composite colour, and the terrain-fact products (slope-angle shading, ATES
ratings) are published as different artefacts entirely. Different visual
language, different layer, never composited into one colour.

Ridgeline currently renders `slope` (Horn 1981, validated against closed-form
surfaces, unambiguously fact) and `bedding` (a multiplicative composite of three
invented constants) **in the same visual grammar**: a continuous translucent
raster ramp. Nothing in the pixels tells the user which is which. That is the
most serious overclaim in the app today, and it is a rendering decision, not a
maths decision.

**Recommendation: give judgement layers their own material.** Modelled outputs
should render with a visibly different fill — soft-edged, desaturated, or
stippled/hatched — so that even a user who never reads a chip has their eye told
"this is an interpretation". Fact layers stay crisp and banded. Then:

**Where the `Confidence` chip should and should not go.** Chips everywhere
become wallpaper and stop being read; that failure is as real as omitting them.
An opinionated rule:

- **Fact layers get no chip.** Hillshade, slope, aspect, landform, saddles,
  benches. These are published, peer-reviewed algorithms validated against
  analytic surfaces. Badging them "Measured" devalues the badge that matters.
- **Judgement layers always get a chip, at the weakest grade of their inputs.**
  Bedding (🔴 Assumed — `idealSlopeDeg`), thermal phase (🟡 Doctrine), scent cone
  (🔴 Assumed), corridor cost (🔵 Inferred, human-fitted Tobler), rut phase
  (🟢/🔵 by latitude, and `rutConfidence()` already degrades below 38°N).
- **The chip is tappable and opens the evidence note**, with the citation, from
  `docs/EVIDENCE.md`. Which means the register's content has to ship as data in
  `packages/shared`, not just as prose in `docs/` — otherwise it is unavailable
  in the field, which is where the user is when they decide to trust it.
- **Four surfaces:** the layer row in the sheet, the on-map legend for the
  active judgement layer, each derived value in the terrain readout card, and
  every number in any analytics view.

**Staleness.** Every avalanche forecast leads with issued time and expiry —
"valid until 6pm". Ridgeline's wind is a value a user typed at some point and
never expires. If a bedding layer is being rendered against a wind set six hours
ago, or against a time-scrub position hours from now, the map should say so on
its face. Cheap, and it is the difference between a tool and a toy.

---

### 3. Transient controls vs persistent panels

**The rule the good apps converge on.** Stated as sharply as I can. The *rule* is
my judgement; the **Examples** column is **[recalled]** except where noted, since
Google Maps, Apple Maps, CalTopo and Gaia were unreachable. The bottom-sheet row
is backed by the Material spec read today.

| Surface | Use when | Examples |
|---|---|---|
| **Persistent chip / bar** | The state *changes what the map means* and the user must never be unsure which state is on. | Transit time selectors; avalanche forecast date |
| **Anchored popover** | Editing one value, content under ~1 screen, must not move the map or its own trigger. | Google Maps layer toggle; CalTopo per-layer opacity |
| **Bottom sheet with detents** | Content the user reads *while looking at the map*; map must stay interactive and pan the target above the sheet. | Apple/Google place cards; Gaia waypoint detail |
| **Full drawer / modal** | Irreversible, committing, or long-running; the map is irrelevant to the decision. | Offline download commit; delete; share |

**Ridgeline gets the top two better than the incumbents.** `ConditionsBar` is
the best thing in this UI and I want to be unambiguous about it. Putting wind,
time and thermal phase in permanent chrome — with the doc comment explaining
that these are not settings but the thing that changes what every layer *means*
— is a genuinely original piece of product thinking and it is correct. So is the
`Popover` doc comment at `primitives.tsx:504`, which records why the wind editor
stopped being a drawer: it moved its own trigger and had no spatial relationship
to it. That is the right instinct and the right level of documentation.

**Then one line of state throws it away.**

```ts
type Panel = 'layers' | 'wind' | 'time' | null;   // apps/web/src/App.tsx:38
```

Three unrelated surfaces share one slot, so they are mutually exclusive. The
consequence: **you cannot have the layers sheet open and change the wind.** But
the single highest-value interaction this product offers — the thing that makes
a hunter say "nothing else does this" — is *turn on bedding likelihood, then
sweep the wind through the compass and watch which hillsides light up*. Today
that is: open layers → enable bedding → close layers → open wind → change →
close → reopen layers to check the legend. The layers sheet and the wind popover
are different classes of surface under the rule above; they should be
independent state.

It is worse on a phone. The desktop drawer is deliberately inset
(`bottom: calc(var(--space-touch) + var(--space-6))`) so it clears the
conditions bar — good, deliberate, documented. But at `max-width: 860px` the
sheet goes full-width to `bottom: 0` and **covers the conditions bar entirely**.
So on the device a hunter actually carries, opening the layers panel hides the
wind and thermal state — precisely the state needed to interpret the layer being
turned on. Apple and Google solved this fifteen years ago with detents.

**The grip is a lie — and the platform spec makes it worse than the first pass
said.** `Sheet` renders `<div className="rl-sheet__grip" />` and the mobile
stylesheet gives it the exact 36×4 px pill of a native drag handle. There is no
pointer handling anywhere in `primitives.tsx`.

Material's bottom-sheet documentation, which was read today, defines the states
we are imitating — `STATE_COLLAPSED` ("visible but only showing its peek
height"), `STATE_HALF_EXPANDED`, `STATE_EXPANDED`, `STATE_HIDDEN` — and, more
pointedly, documents the drag handle as an **accessibility** component:

> Drag handle … provides accessibility commands to expand and collapse the
> attached bottom sheet … [screen reader users] can use the expanded and
> collapsed states as well as double tapping to hide.
> — [`docs/components/BottomSheet.md`](https://github.com/material-components/material-components-android/blob/master/docs/components/BottomSheet.md)

So our pill is not merely a dead gesture target for sighted users; it is the
visual signature of a control that is *supposed to carry* expand/collapse
semantics, rendered as a bare `div` with no role, no actions and no handler. It
fails sighted users and assistive-tech users in different ways at the same time.
An affordance that does not work is worse than no affordance, because it teaches
the user the app is broken in the first ten seconds.

Material also specifies the handle's touch region as **at least 48 dp tall**;
ours is a 4 px pill inside no padded hit area, which is below our own 44 px touch
floor even if it were wired up. Either implement detents or delete the pill
today — and detents are worth building, because a **peek** detent (active-layer
summary + top-layer opacity, conditions bar still visible) is exactly the state
a hunter wants while comparing a layer against the ground.

**The inspect card is the wrong surface.** `App.tsx:245` renders a floating
`role="dialog"` card at a fixed position with no relationship to the point that
was tapped, no marker drawn on the map, and no map offset. Both baseline maps
put a pin at the point and slide the map so the pin stays visible above the
sheet. Terrain readout is textbook peek-detent bottom-sheet content. (It also
currently shows only latitude and longitude — a readout that reads back the
coordinate the user just tapped. `BACKLOG R6`.)

---

### 4. The offline download flow

**What a good one looks like, distilled.**

Gaia and onX are closed and were unreachable, so their specifics are
**[recalled]**. In their place I read the shipping user-facing strings of
[Organic Maps](https://github.com/organicmaps/organicmaps/blob/master/data/strings/strings.txt),
a mature offline-map app whose whole product is this flow. It is a *named-region*
downloader rather than a draw-a-box one, so it evidences items 2 and 4–6 well and
says nothing about 1, 3 or 7.

1. **The region is drawn on the map by direct manipulation** — drag a box, or
   buffer a route/boundary. Never picked from a list of named tiles. **[recalled]**
   that Gaia and onX both do this; unevidenced here, and Organic Maps is a
   counter-example that works fine because its regions are administrative.
2. **Size and count stated before and during commit**, in units the user cares
   about. Organic Maps ships `downloader_percent = "%@ (%@ of %@)"` — percentage
   plus downloaded-of-total — and `downloader_of = "%1$d of %2$d"` for the queue.
   Note that the existence of `country_status_download_without_size` ("Download
   Map") as a *separate string from the default* means the sized variant is the
   norm and the unsized one is the fallback when size is unknown.
   It also pre-flights space (`downloader_no_space_title` = "Not enough space",
   `downloader_no_space_message` = "Please delete any unnecessary data") and
   pre-flights the *network*: `download_over_mobile_header` = "Download over a
   cellular network connection?" / "This could be considerably expensive with
   some plans or if roaming." A hunter on a truck hotspot at the trailhead cares
   about that as much as about megabytes.
3. **Detail depth expressed as a consequence, not a z-level.** "Detail down to
   about 1:5,000 — individual trees" beats "max zoom 16". My judgement, not
   sourced; no reference product exposes a zoom ceiling to compare against.
4. **Progress survives backgrounding, and is resumable.** Evidenced: Organic Maps
   ships a dedicated notification channel for the downloader
   (`notification_channel_downloader` = "Map downloader") and an explicit
   `downloader_hide_screen` = "Hide Screen" — you are *invited* to leave, and the
   download continues under a notification. A 20-minute download killed by a
   phone locking is the classic failure and they designed it out.
5. **Failures are loud, specific and retryable in place.**
   `download_has_failed` = **"Download has failed. Tap to try again."** — the
   error *is* the retry control. `downloader_status_failed` = "Failed" is a
   first-class status in the region list alongside "Downloaded", "Queued" and
   "Update", so a partially-failed region is visibly labelled in the manager and
   never reads as complete. This is exactly the failure CLAUDE.md names as the
   worst this product has.
6. **Storage accounting and eviction.** `maps_storage_free_size` =
   "%1$@ free of %2$@", a "Downloaded maps" list, a selectable storage volume
   (internal / shared / SD / external), and a delete guarded by a consequence
   warning — `downloader_delete_map_dialog` = "All of your map edits will be
   deleted with the map."
7. **Coverage drawn on the map itself** — a hatched or outlined overlay showing
   which part of the current view is downloaded. My judgement; not evidenced by
   Organic Maps, whose regions are administrative polygons that are always drawn.
   It matters most for us precisely *because* our regions are arbitrary boxes:
   it is the only way a user can answer "am I covered where I am going" without
   guessing.

**One thing worth stealing that is not in the UI at all.** Organic Maps ships a
developer setting called `setting_emulate_bad_storage` — "Emulate bad storage".
A shipped fault-injection toggle for the exact failure class we have declared our
worst. `offline-integrity-loop` should have one; a storage failure you can
reproduce on demand is a storage failure you can test.

**Where Ridgeline is.** Nothing exists in the UI:

```tsx
<RailButton label="Save this area for offline use" onClick={() => undefined}>
```

Server-side estimation and honest pre-download warnings are built (ROADMAP
Phase 1), so this is a missing front door, not a missing capability. `BACKLOG R4`
has it as P0/M. Agreed — with the additions above, especially (7).

**One defect here is worse than "missing" and should be fixed regardless of R4.**

```ts
void openTileStore().then((s) => s.stats()).then((s) => setOfflineReady(s.tileCount > 0));
```

`offlineReady` is a **global** boolean, sampled **once at mount**, and it drives
a chip in the layers sheet that says *"Offline ready — elevation for this area is
stored on this device. Analysis layers work with no signal."* The words "this
area" are in the string. The value has nothing to do with the current area. Pan
five hundred miles and it still reads green. Download one tile in Ohio, drive to
Kansas, and the app tells you you are covered.

By the project's own priority order — "anything that leaves a user without a map
in the field: critical always" and "anything confidently wrong is worse than
missing" — this is the highest-priority item in this audit. It must become a
per-viewport coverage query, and it should be paired with the map-level coverage
overlay from (7) so the answer is spatial rather than binary.

**The thing to say out loud in this flow.** **[recalled]** — Gaia and onX both
make you choose *which layers* to download, because they cache rendered tiles.
The architectural contrast is real regardless of their exact current UI: any
product that caches *rendered* tiles must ask which ones, and any product that
caches elevation does not. Ridgeline caches
elevation, so there is no such step — one download unlocks every layer, any
wind, any date. That is a structurally better flow *and* the clearest possible
demonstration of architectural advantage #3. The download sheet should say it in
one sentence, at the moment the user is comparing us to what they already pay
for.

---

### 5. Time to first insight (not in the brief; it is the finding that matters most)

A new user opens the current build. The map centres on a hardcoded
`{ lng: -82.54, lat: 39.43 }`, satellite and hillshade are on, the layers sheet
is open. It is a good-looking map. **It tells them nothing they did not already
know.** To learn anything they must know which layer to turn on, and to reach
the flagship layer they must first know that wind is a prerequisite, set it, and
scroll to the bottom of the list.

Every competitor has the same weakness, so this is not a gap — it is an opening.
We have an engine that computes saddles, benches, landform position and leeward
bedding on-device with no signal. Nobody else can do what follows:

**"Read this ground" — one tap, and the app tells the user something true about
their property they did not know.** Run the standing battery over the current
viewport or property boundary and produce a short findings list:

> - **4 saddles.** Two connect the north and south ridge systems — the likeliest
>   crossings on the property.
> - **11 benches**, 9 of them on east-facing slopes.
> - **On tonight's NW wind**, leeward bedding concentrates on the two
>   south-east-facing points off the main ridge. *Field doctrine — the slope
>   preference behind this is an assumption. Why?*
> - Only 6% of this property is over 30°. This is gentle ground; corridor
>   analysis will be weaker here than in hill country.

Each line taps to fly there and turn on the relevant layer. That is the moment a
hunter decides this is a different kind of product. Time to first insight goes
from "learn the layer taxonomy" to one tap, and every claim carries its evidence
grade, which turns the honesty policy from a constraint into the demo.

It also gracefully handles the honest negative — *"this ground is too flat for
the bedding model to say much"* — which no competitor will ever tell you and
which is worth more trust than ten confident hotspots.

---

## Prioritised recommendations

Ranked by "would a serious hunter switch to this and never go back". Items 1–3
are the ones that decide it.

| # | Recommendation | Size | Owner | Why it ranks here |
|---|---|---|---|---|
| 1 | Per-viewport offline coverage truth | S–M | `offline-steward` | The app currently lies about the one thing it cannot lie about |
| 2 | Deploy `Confidence` + separate fact from judgement cartography | M | `frontend-builder` + `map-builder` + `game-biologist` | The moat is a markdown file; make it visible |
| **2b** | **Scale-of-validity + base-rate line on every judgement layer** | **XS** | `frontend-builder` | **New this pass.** Two sentences. Directly lifted from EAWS's ">100 km², not a specific individual slope" and its per-level base rates. Best value-per-hour in this audit; ship it inside #2 |
| 3 | "Read this ground" first-run analysis | M–L | `map-builder` + `frontend-builder` | Time to first insight goes to one tap; nobody else can build it |
| 4 | Offline region picker (`R4`) with coverage overlay | M | `offline-steward` | Headline feature with no front door |
| 5 | Uncouple wind/time from the layers sheet | S | `frontend-builder` | One line of state blocks the flagship interaction |
| 6 | Legends for every continuous ramp | S | `map-builder` | Four ramps ship with no key at all |
| 7 | Band the bedding output; kill the continuous ramp | S–M | `terrain-scientist` + `map-builder` | A smooth ramp over three Assumed constants is a precision claim we cannot support |
| 8 | Bedding rose for the current wind | M | `map-builder` + `terrain-scientist` | Answers "where do I hang a stand on a NW wind" in one glance |
| 9 | Delete the fake grip now; detents next | S / M | `frontend-builder` | A dead affordance in the first ten seconds |
| 10 | Collapse blurbs; group accordions; active-stack summary | S | `frontend-builder` | Bedding is three phone-screens deep |
| 11 | Terrain readout as a peek sheet with a map marker | S–M | `map-builder` | Wrong surface; also `R6` |
| 12 | Staleness/validity marking on modelled output | S | `frontend-builder` | Borrowed straight from forecast expiry |
| **12b** | **Bedding *trend* — increasing / steady / decreasing** | **S** | `terrain-scientist` + `frontend-builder` | **New this pass.** Both reference products ship a forward-looking trend beside the current value (`DangerTrend` in the NAC schema, `tendency` in EAWS). Our thermal model already has the inputs; no hunting app can say "this is about to switch" |
| 13 | Saved-filter search, favourites, recently-used | M | `frontend-builder` | Only after `R2` — build creation first |
| 14 | Night mode / red-light theme | S–M | `frontend-builder` | 05:30 in the dark is the actual use case |

### 1 — Per-viewport offline coverage truth · S–M · `offline-steward`

Replace the mount-time global boolean with a coverage query for the current
viewport at the current zoom, recomputed on `moveend` (debounced). Three states,
not two: **Covered** / **Partial — *n*% of this view** / **Not downloaded**. Add
a map-level overlay drawing the covered extent as a hatched region so the answer
is spatial, and reachable without opening any panel. Fix the chip's tooltip
string, which currently promises something the value does not mean.

*Done when:* pan from a covered area to an uncovered one with the sheet open and
the chip changes; airplane-mode the device over uncovered ground and the UI says
so before the layer fails.

### 2 — Deploy `Confidence` and split fact from judgement · M · `frontend-builder` + `map-builder` + `game-biologist`

Three parts, and the third is the one nobody will think of:

1. **Chips.** Judgement layers only, at the weakest input grade, in four places
   (layer row, on-map legend, terrain readout value, analytics number). Fact
   layers get nothing. Tapping opens the evidence note with its citation.
2. **Evidence as shipped data.** Move the grade + one-line justification +
   source URL for each parameter out of `docs/EVIDENCE.md` prose and into a typed
   record in `packages/shared`, with a test asserting every graded parameter in
   the engine has an entry. The register becomes machine-readable, the doc
   generates from it, and the notes are available offline — where the user is
   when they decide whether to trust the map.
3. **A separate material for modelled layers.** Judgement rasters render
   soft-edged or stippled; fact rasters stay crisply banded. Tokens for both go
   in `packages/design`. This is what makes the distinction survive a user who
   never reads a chip.

Closes `BACKLOG N10` and materially advances `N11`.

### 2b — Scale-of-validity and base-rate lines · XS · `frontend-builder`

New this pass; the cheapest item in the audit, and it should ship inside #2. Two
sentences on every judgement layer's legend and on the bedding rose:

- **Validity.** *"Summarises the current view (≈1.4 km²) at 10 m resolution. Not
  a per-slope prediction — check it on the ground."* Direct lift of EAWS's *"The
  danger level always applies to a region with an area of >100 km² and not to a
  specific individual slope … It should always be checked on site."*
- **Base rate.** *"Prime covers 4 % of this ground."* Direct lift of EAWS
  publishing how often each danger level is issued and what share of fatalities
  it accounts for. It is also already a by-product of the availability
  distribution we compute for selection analytics, so the number is nearly free.

*Done when:* no judgement layer can be rendered without both lines present.

### 3 — "Read this ground" · M–L · `map-builder` + `frontend-builder`

One rail button, or the empty state of a fresh property. Runs the standing
battery over the viewport/boundary on-device and emits five to eight plain-
English findings with counts, each tapping to fly-to and enable the relevant
layer, each carrying its evidence grade. Must include honest negatives.

*Dependency, and the reason this is M–L not M:* the engine produces rasters;
findings need discrete features with centroids and counts (saddle extraction,
bench clustering, aspect histograms over the boundary). Some of that is a real
piece of `terrain-scientist` work. Scope a v1 to what can be counted cheaply
from existing raster outputs and grow it.

### 4 — Offline region picker · M · `offline-steward` (`BACKLOG R4`)

Drag-a-box on the map; live tile count, megabytes and time estimate as the box
changes; detail depth as a consequence sentence, not a z-level; explicit
persistent-storage status; resumable progress that survives backgrounding;
loud, specific, retryable failures; a region manager with sizes and last-used;
and the coverage overlay from #1. Include the one-line statement that this
single download unlocks every layer, any wind, any date.

### 5 — Uncouple wind/time from the layers sheet · S · `frontend-builder`

Split `type Panel` into an independent sheet state and an independent conditions-
editor state. Then, on mobile, make the sheet stop covering the conditions bar —
which is #9's peek detent, or as a stopgap cap the sheet's `max-height` so the
bar clears it.

*Done when:* bedding is on, the layers sheet is open with its legend visible,
and sweeping the wind through eight cardinal buttons visibly moves the layer
without closing anything.

### 6 — Legends for every continuous ramp · S · `map-builder`

`slope` and `wood` have legends. `aspect`, `weiss`, `insolation` and `bedding`
have none — and they are the four ramps a user is least able to decode by
intuition. A colour ramp without a key is decoration. Aspect in particular is
cyclic and unreadable without a compass key. Add `legend` entries in
`layers.ts`, and promote the active layer's legend to an on-map corner element
so it is visible with the sheet closed.

### 7 — Band the bedding output · S–M · `terrain-scientist` + `map-builder`

Replace the continuous ramp with three or four ordinal classes and a sentence
each, avalanche-scale style. Pair with the `Confidence` chip from #2. If a
continuous field is genuinely wanted for the corridor solver's attraction term,
keep it internally and band it only for display — the honesty problem is a
rendering problem.

**Two additions from this pass's research.** First, **publish the class as a
range when it is not resolvable to one level** — NWAC forecasters do exactly this
for avalanche size (`SeverityNumberLine` takes `{from, to}` and draws a bar
spanning cells) and it is a much more honest uncertainty encoding than a point
estimate with a caveat attached. Never round up. Second, when naming the classes,
add NAPADS's own warning against arithmetic on ordinals — *"the danger increases
exponentially between levels"* — in whatever form suits us. If we number the
bedding classes 1–4, someone will average them.

### 8 — Bedding rose · M · `map-builder` + `terrain-scientist`

Rewritten after reading the two reference implementations. **The first pass's
encoding was wrong** — it proposed wedges shaded by continuous modelled
likelihood, and neither NWAC nor EAWS shades a rose by magnitude (§2(ii)). This
is the buildable spec.

**Purpose.** One glance, one question: *on today's wind, which faces should I be
looking at — and is that actually different from the ground I have?*

**Geometry**

- **8 aspect octants**, N at top, E at right, W at left. Matches both reference
  products and the compass. `aspectOctant()` in
  `packages/terrain/src/analysis/surface.ts` already returns exactly
  `N/NE/E/SE/S/SW/W/NW` plus `'flat'`, so the binning is free.
- **3 concentric rings = slope bands**, not elevation. Whitetail bedding is not
  an elevation-banded problem. Suggested bands `<12°` / `12–25°` / `>25°`, which
  puts the vision document's own example filter ("12–25°") on the middle ring.
- **Ring order must be argued, not copied.** NWAC puts the *highest* elevation
  band at the centre because the diagram is "a mountain seen from above" — a
  metaphor that carries the inversion. Our rings are slope and we have no such
  metaphor, so copying the inversion would be cargo-culting. Put **gentlest at
  the centre, steepest outside** (radius reads as steepness, which is at least
  weakly intuitive) **and label the rings on the diagram**. Justification: ring
  order is the single thing NWAC's help text spends the most words explaining,
  which is direct evidence that it is the part users get wrong.
- 24 cells. **Every cell is always stroked, including empty ones.** The
  denominator is always on screen. One line of code; it is the
  use-vs-availability rule as a graphic.
- **Never rotate the rose to the wind.** North stays at the top always. A rose
  that rotates destroys the only fixed reference the user has.
- **The rose is a read-out, not a control.** Deliberate cut from the first pass,
  which proposed tapping a wedge to filter the map. Twenty-four targets inside a
  ~120 px glyph cannot meet the 44 px touch floor, and the inner ring can never
  meet it at any reasonable size. Aspect/slope selection already belongs to the
  filter UI. Do not invent a gloved-hands hit-testing problem to save one tap.

**Encoding**

- **No continuous ramp.** Cell state is one of four: *unmarked*, *possible*,
  *likely*, *prime* — the same banding as recommendation #7, so the rose and the
  map speak one language.
- **Fill pattern carries the class, not hue alone** (design-system rule: colour
  is never load-bearing alone). Unmarked = outline only. Possible = light
  stipple. Likely = solid at ~45 % tone. Prime = solid at full tone. **Three
  fills is the ceiling** at ~16 px per cell; do not add a fourth.
- **What a cell's value means, and this is the load-bearing decision: the share
  of *that cell's own area* that meets the bedding threshold — not the cell's
  share of all prime area.** If 40 % of the property faces SE, an unnormalised
  rose lights up SE for no reason except that there is more SE. That is precisely
  the sightings-by-slope-band error CLAUDE.md forbids, drawn as a flower. The
  legend must say which one it is: *"% of this face that qualifies."*
- **Wind arrow drawn outside the ring, on the perimeter**, never through the
  centre (an arrow through the middle reads as an aspect selection). Label it
  with the *from* bearing in words — "Wind from NW" — because EAWS found it
  necessary to state the convention explicitly in its own glossary
  (*"Wind direction indicates the direction the wind originates or comes from"*),
  and getting this backwards inverts the entire product.

**Legend and text — four channels, matching the danger scale's practice**

1. The rose (*where*).
2. An ordinal headline naming the best class present: *"Prime bedding on SE and S
   faces, 12–25°."*
3. **A decision sentence** — the hunting analogue of "Recommendations for
   backcountry recreationists", which is the most valuable line on any avalanche
   product. *"Approach from the NW; those faces are downwind of your entry."*
   Without this the rose is a diagram; with it, it is an answer.
4. A **base-rate line**, lifted from EAWS publishing how often each danger level
   is issued: *"Prime covers 4 % of this ground."* A hunter who knows the class
   is rare treats it differently from one who does not.
5. A `Confidence` chip at the **weakest input grade** — for bedding that is 🔴
   **Assumption** (`idealSlopeDeg: 22`), tappable to the evidence note.
6. A **scale-of-validity line**, the direct lift of EAWS's ">100 km², not a
   specific individual slope": *"Summarises the current view (≈1.4 km²) at 10 m
   resolution. Not a per-slope prediction — check it on the ground."* Cheapest
   high-value sentence in this entire audit.

**How it degrades — four distinct cases, all with precedent**

| Case | Behaviour | Precedent |
|---|---|---|
| **Wind unset** | Do not draw filled cells. Draw the empty 24-cell outline with *"Set today's wind to see bedding by aspect."* | Our own `blockedReason`, which is already right |
| **Ground cannot discriminate** (e.g. <10 % of view over 12°) | **Remove the rose entirely.** Replace with words: *"This ground is too gentle for the bedding model to separate faces. Nothing here is prime."* Never draw 24 empty cells and let the user infer. | EAWS: *"If no particular avalanche problem predominates … this information is omitted and a favourable avalanche situation is declared."* |
| **Class not resolvable to one level** | Publish a **range**, never round up. Headline reads *"possible–likely"*; the cell renders at the **lower** fill with a hatched outer edge. | `SeverityNumberLine`'s `{from, to}`: NWAC forecasters publish avalanche size as a span across ordinal cells |
| **Too little of that face in view** | Distinct third state: outline with a centre dot = *"too little of this face here to say"*. Must not read as *"none"*. Confusing "no prime ground" with "no ground" is the classic error; `selectionRatioInterval()` in `packages/shared/src/analytics/selection.ts` already gives the interval machinery to pick the threshold. | The stroked-empty-cell convention in `DangerRose.tsx`, extended |

**Dimensions**

- Compact read-out: **112–128 px** diameter, on-map corner beside the active
  layer legend when `bedding` is on. Ring labels omitted at this size; the
  headline sentence carries the meaning.
- Expanded: **240–280 px** in the "Read this ground" card and the terrain
  readout, with ring labels, the base-rate line, the validity line and the chip.
- `aspectRatio: 1`, SVG, no animation, no 3D. It must render identically in the
  worker-driven offline path.

**Non-goals.** No elevation ring. No fourth class. No rotation. No tap targets.
No animated transitions when the wind changes — the fill states should snap, so
that sweeping the wind through the compass reads as a *comparison*, not a movie.

**Where it goes.** On-map corner element (output), and in "Read this ground"
(#3). **Not** in `ConditionsBar` — that bar is input, and mixing the two is the
mistake this UI has otherwise avoided.

### 9 — Delete the fake grip now; detents next · S then M · `frontend-builder`

Remove `.rl-sheet__grip` from `Sheet` today, or wire pointer handling today.
Then build three detents — peek (active-layer summary + top-layer opacity,
conditions bar visible), half, full — with the map staying interactive at peek.

### 10 — Layer sheet density · S · `frontend-builder`

Blurb visible for enabled/focused rows only, collapsed elsewhere with an info
affordance, full text kept in the DOM for assistive tech. Group headers become
accordions remembering their state. Add an active-stack summary line, and a
count badge on the layers rail button.

### 11 — Terrain readout as a peek sheet · S–M · `map-builder` (`BACKLOG R6`)

Marker at the tapped point, map offsets to keep it visible, values grouped
fact-then-judgement, each judgement value carrying its `Confidence` chip.

### 12 — Staleness marking · S · `frontend-builder`

Timestamp the wind when set. If the render time is more than a couple of hours
from the wind's timestamp, or the time scrub is far from now, mark the
conditions bar and any wind-dependent legend. Model output with a shelf life
shown on its face is what separates a forecast product from a toy.

### 12b — Bedding trend · S · `terrain-scientist` + `frontend-builder`

New this pass. Both reference products publish a **direction of travel** next to
the current value, not just the value: `DangerTrend` (`increasing / steady /
decreasing`) in the NAC schema, and `tendency` in EAWS with the tooltip
"expected trend for the following day".

Ours is easier and more useful, because our driver is deterministic rather than
forecast: thermal phase turns over twice a day at times the solar model already
computes. Evaluate bedding at now and at now + 1 h, classify the delta into the
same three words, and put it beside the class. *"Prime on SE faces — decreasing;
the thermal switches in about 40 minutes"* is a sentence no hunting app on the
market can produce, it costs one extra evaluation of an engine that already runs
on-device, and it converts a static map into something with a clock on it.

Sequence it after #7 — a trend on an unbanded continuous ramp is meaningless.

### 13 — Saved-filter management · M · `frontend-builder`

Search, favourites, recently-used, colour swatch, per-filter opacity, reorder.
**Sequenced after `R2`** — a library UI for a library nobody can add to is the
wrong order.

### 14 — Night mode · S–M · `frontend-builder`

The stated use case is 05:30 in the dark. A red/amber low-luminance theme that
preserves dark adaptation, with the map style dimmed and imagery desaturated.
Tokens already being the single source of truth makes this cheap. Every serious
astronomy and marine app has it; no hunting app does, and hunters are the
population that walks in before daylight by definition.

---

## What we should NOT copy

**Sourcing:** this whole section describes *competitor* behaviour and is therefore
**[recalled]** except where it cites our own repo. That is a weaker basis for
"build this" than for "do not build this" — a decision not to build survives being
wrong about a competitor's current UI. Where a claim rests on a fact about the
world rather than about a product, it is flagged inline.

**onX's and HuntStand's deer-movement forecast meters.** Solunar/lunar-derived
activity dials. `docs/VISION.md` and `docs/EVIDENCE.md` already rule this out on
the evidence — the register records moon-phase non-effect as a **measured
negative result** and acts on it by exclusion. Worth restating here as a
*product* judgement, not just a scientific one: the meter is the most-used
feature in those apps and copying it would be the single fastest way to destroy
the only advantage that cannot be cloned in a sprint.

**Gaia's large searchable layer catalogue, applied to our ten layers.** Right
pattern, wrong cardinality. Search belongs on saved filters. Building a
catalogue browser for ten items adds a navigation level in front of the thing
the user came for.

**FATMAP-grade 3D terrain.** **[recalled]** as to FATMAP; the argument is about
our sport and our offline budget and stands without it. Beautiful, and correct
for its sport: in ski
mountaineering the terrain is visible from kilometres away and the planning
problem is a whole-face, whole-couloir judgement. Whitetail hunting is a 2D,
sub-100 m, sub-canopy problem where the decisive features — a bench, a saddle,
an inside corner of a field edge — read *better* on multi-directional hillshade
than on an oblique 3D view, because 3D hides exactly the micro-terrain that
matters behind the near slope. The cost is real too: 3D means terrain meshes and
draped textures in the offline budget, which directly attacks advantage #3.
`ROADMAP` Phase 5 lists 3D above viewshed; **that ordering is wrong**. Viewshed
from a stand answers a question a hunter asks every single time they hang one
("what can see me, and what can I see"). 3D answers "this looks nice". Demote
3D below viewshed, and be willing to never build it.

**Strava-style aggregated activity heatmaps.** Technically straightforward,
commercially tempting, and an active harm. A heatmap of where hunters walk
discloses stand locations, concentrates pressure on public land, and creates a
safety and conflict problem on private ground. The argument that aggregate
location data becomes individually identifying at low density is a general
property of the data, not a claim about any one product — and hunting ground is
*always* low density, which is the whole point. (The first pass cited a specific
Strava incident as the canonical example. **Unverifiable from here, so the
citation is withdrawn**; the argument does not need it and is stronger without a
fact I cannot check.) Never build it, and say so in `VISION.md` alongside the
lunar predictor.

**Komoot-style auto-routing as the primary route interaction.** Our corridor
solver models **deer** movement. Komoot's grammar — a line with a start pin, an
end pin, and an elevation profile — reads unambiguously as "the route *you*
take". A hunter who confuses "deer will move here" with "walk here" has just
walked their scent up the travel corridor and blown the property. Keep the
corridor's visual language deliberately unlike a navigation route (band, not
line; no start/end pins; no turn list). Access routing is a **different solve**
— minimise scent exposure and visual detection — and when we build it, it should
look like a route, because it is one.

**Google/Apple's automatic recentring and generous animation.** In the field a
map that moves without being asked is a hazard, and continuous animation costs
battery a hunter cannot recharge. Locate should fly once, on request, and then
leave the map alone. The existing `prefers-reduced-motion` handling is the right
instinct; extend it to a deliberate low-power posture.

**CalTopo's "nothing is explained" density, wholesale.** Its audience trained on
it professionally. The blurbs in `layers.ts` are a real advantage over every
competitor and should be defended — the fix in #10 is disclosure, not deletion.

**Any pattern requiring an online account check.** **[recalled]** — Gaia and onX
gate downloaded maps behind subscription validation that phones home. I could not
verify the current behaviour of either, and the rule does not depend on it:
a self-hosted product must never ship a code path
where the map stops working because a server could not be reached. This is worth
an explicit test in the offline-integrity loop, not just a principle.

---

## Two things worth saying that are not criticisms

Audits skew negative, so: `ConditionsBar` — the decision that wind, time and
thermal phase are permanent chrome rather than settings buried in a panel — is
better product thinking than anything the incumbents ship, and the `Popover`
doc comment explaining why the wind editor stopped being a drawer is the kind of
reasoning most teams never write down. And `blockedReason` on `ToggleRow`, which
makes "refuse to render against a default, and say why" the path of least
resistance rather than something every screen must remember, is a design-system
decision that will still be paying off in three years.

The gap is not taste or judgement. It is that the honesty machinery is built and
not yet plugged in, and the offline machinery is built and has no front door.
