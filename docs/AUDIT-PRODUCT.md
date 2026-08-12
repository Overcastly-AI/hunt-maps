# Product audit — Ridgeline

Independent product audits. Newest first. Written by `product-auditor`, which
deliberately does not read the engineering audit first.

The operating question is always the same: **would a serious whitetail hunter
switch to this and never go back?**

---

# 2026-08-12 — The dock, the scorecard, and the things that are not on the map

**Scope, per brief:** the desktop dock (`0947a43`, screenshots `b8d8f6e`);
whether the build's priorities match `docs/VISION.md`'s own scorecard and
whether that scorecard is still honest; the six core workflows end to end;
the saved-filter library as a moat; and a ranked list of what a hunter notices
in the first ten minutes.

**Verdict up front. The dock is not the problem, and neither is the chrome.**
The chrome work of the last two passes largely landed and largely worked — the
rail is gone, the dead button is gone, the mobile sheet stops covering the
wind control, the coverage badge is honest, the offline picker is the best
screen in the app. But this pass went looking for the answer to a hunting
question and found that **the map is empty of everything a hunter puts on a
map.** Stands, sightings, property boundaries and the terrain readout are all
built, all reachable as lists and forms, and **none of them render on the map.**
The reserved MapLibre layer slot for them — `'anchor-features'`,
`apps/web/src/components/MapView.tsx:248-255` — exists and nothing is ever
inserted into it.

A hunter would not switch. Not because of the dock, and not because of a
missing feature on the scorecard. They would open it, tap their stand in the
Stands list, be shown `39.42817, -82.54103` as text
(`apps/web/src/components/waypoints/WaypointDetail.tsx:66`), and close the app.

## Method, and what I could and could not do

Per the brief I ran **no browser, no Playwright, no `pnpm test:e2e`.** Four
kinds of evidence, tagged inline and never mixed:

1. **CONFIRMED (source).** Read from the tree at
   `claude/project-goal-clarification-qkyana`, cited `file:line`.
2. **CONFIRMED (screenshot, measured).** The four desktop captures at
   `apps/web/screenshots/chrome/desktop-0{1,2,3,4}-*.png` (1440×900 at 2× DPI).
   Where a number appears below I measured it off the PNG in Python by
   detecting the full-width divider rules inside the dock column, not by eye;
   the method is stated at the finding. The map is black in all four because
   this sandbox cannot reach basemap tiles — **I have not filed "the map is
   empty" as a cartography finding**, and every judgement below is about
   chrome, copy or geometry.
3. **CONFIRMED (executed).** One finding (F4, thermal phase) I proved by
   running the _shipped, built_ engine under Node against
   `packages/terrain/dist` — not by reading the algorithm. The transcript is
   in the finding.
4. **INFERRED.** Arithmetic or state-machine reasoning from source, with the
   falsifiable one-step check that would settle it. Said plainly, every time.
   The 2026-08-07 pass and `docs/QA-FIELD.md` both did this and it was right
   to; a finding that hardens from "probable" to "confirmed" on the way into
   this file is a real cost to whoever reads it next.

**I did not use the `mobile-*` screenshots as evidence of current state.**
They are from `dffc154` and predate both the tabbed drawer and the dock. Where
one appears below it is used for a single geometry comparison, explicitly
flagged.

**No external research this pass.** `WebSearch`/`WebFetch` were unavailable, and
every question this brief asks is answerable from the tree and the captures.
Nothing below is `[recalled]` competitor behaviour; where I compare to onX or
Gaia I am comparing to a _category expectation_ a hunter arrives with, and I
say so rather than describing a UI I could not open.

---

## Disposition of the prior 22 recommendations

The brief asks which shipped. **Nine shipped, three partially, ten did not.**
Numbering continues from the 2026-08-06 (#1–14) and 2026-08-07 (#15–22) passes.

| #   | Recommendation                                     | Status                                                | Evidence                                                                                                                                                                                                                                                                                                                              |
| --- | -------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Per-viewport offline coverage truth                | ✅ **Shipped — supersede**                            | `lib/offline/coverageLabel.ts`; `desktop-02` renders "Checked all 30 tiles at zoom 15"                                                                                                                                                                                                                                                |
| 2   | Deploy `Confidence`, split fact from judgement     | 🟡 **Partial**                                        | Chip ships on `bedding` only (`lib/layers.ts:175`) and the grade legend is in the dock footer. **Parts 2 and 3 did not ship** — no typed evidence record in `packages/shared` (`ls packages/shared/src` = `analytics/ domain.ts index.ts rut.*`), no separate cartographic material for modelled rasters. `R10` still open, correctly |
| 2b  | Scale-of-validity + base-rate lines                | ❌ **Not shipped — keep**                             | No such copy on any layer legend. Still the cheapest item in this file                                                                                                                                                                                                                                                                |
| 3   | "Read this ground"                                 | ❌ **Not shipped — keep, and promote**                | `BACKLOG N19`, P1. See F1 below: it is now the _only_ thing standing between this product and a five-minute demo that sells itself                                                                                                                                                                                                    |
| 4   | Offline region picker                              | ✅ **Shipped — supersede**                            | `components/RegionPicker.tsx`; `desktop-04`. Best screen in the app                                                                                                                                                                                                                                                                   |
| 5   | Uncouple wind/time from the layers sheet           | ✅ **Shipped — supersede**                            | Independent `popover` state; `desktop-03` shows the wind popover open over the map with the Layers panel fully readable beside it                                                                                                                                                                                                     |
| 6   | Legends for every continuous ramp                  | 🟡 **Partial — keep**                                 | Only `slope` and `wood` carry a `legend` (`lib/layers.ts:93-99,129-134`). **`aspect`, `insolation`, `bench` and `bedding` still ship with no key at all** — including the flagship layer                                                                                                                                              |
| 7   | Band the bedding output                            | ❌ **Not shipped — keep**                             | `packages/terrain/src/render/ramps.ts` exports `HEAT_RAMP` and no bedding band table. A smooth ramp over 🔴 Assumed constants is still a precision claim                                                                                                                                                                              |
| 8   | Bedding rose                                       | ❌ **Not shipped — keep**                             | `BACKLOG N17`                                                                                                                                                                                                                                                                                                                         |
| 9   | Delete the fake grip                               | ❌ **Not shipped — keep**                             | Still a bare `<div className="rl-sheet__grip" />` (`packages/design/src/components/primitives.tsx:208`), still `display: block` under 860px (`styles.css:442-446`), still has no drag handler. A dead affordance in the first ten seconds, on the primary device                                                                      |
| 10  | Layer sheet density                                | ❌ **Not shipped — keep, escalate**                   | `BACKLOG N21`. The dock has made this materially worse, not better — see F5                                                                                                                                                                                                                                                           |
| 11  | Terrain readout as a peek sheet                    | ⚠️ **Built and not connected — keep**                 | `components/TerrainReadout.tsx` is a complete peek/expand sheet with slope, aspect, morphometry and a graded bedding judgement, **and has zero consumers outside its own test file.** `App.tsx:919-943` ships a lat/lng card instead. See F2                                                                                          |
| 12  | Staleness marking                                  | ❌ **Not shipped — keep**                             |                                                                                                                                                                                                                                                                                                                                       |
| 12b | Bedding trend                                      | ❌ **Not shipped — keep**                             | `BACKLOG N18`                                                                                                                                                                                                                                                                                                                         |
| 13  | Saved-filter search / favourites                   | ❌ **Not shipped — keep, reframe**                    | See §5: the problem is no longer discovery inside the library, it is that the library has no gravity yet                                                                                                                                                                                                                              |
| 14  | Night mode / red-light theme                       | ❌ **Not shipped — keep**                             | No theme switch anywhere in `apps/web/src`                                                                                                                                                                                                                                                                                            |
| 15  | Delete the dead "Add waypoint" button              | ✅ **Shipped — supersede**                            | Gone; `desktop-01` shows a two-cell CommandBar (Layers / Offline)                                                                                                                                                                                                                                                                     |
| 16  | Stop the mobile sheet covering ConditionsBar       | ✅ **Shipped — supersede**                            | `apps/web/src/index.css:331-352`, `--rl-mobile-bottom-clearance`. **This was the 2026-08-07 pass's headline finding and it is fixed at the root.** Credit where due                                                                                                                                                                   |
| 17  | `CommandBar` primitive                             | ✅ **Shipped — supersede**                            |                                                                                                                                                                                                                                                                                                                                       |
| 18  | Replace the rail; delete the `* 3` constant        | ✅ **Shipped — supersede**                            | The magic constant is gone from the mobile path; the top-right rail's `* 3` survives, tied to #19                                                                                                                                                                                                                                     |
| 19  | Mobile: drop zoom, move locate to the thumb arc    | ❌ **Not shipped — keep**                             | `BACKLOG R48`. `App.tsx:745-756` still puts zoom `+`/`−`/locate in the top-right rail at every viewport                                                                                                                                                                                                                               |
| 20  | Drawer tabs in one slot                            | ✅ **Shipped, with a variance worth noting**          | Tabs are **Layers / Stands / Sightings**, not the proposed Layers / Offline. Offline became a CommandBar cell plus a dock section. That was the better call for Offline. But it means **Filters never got a tab** — see §5                                                                                                            |
| 21  | Tool tray + centre-crosshair placement             | ❌ **Not shipped — keep, and it is now load-bearing** | A stand's location comes from GPS, the map centre, or two typed decimal fields (`components/waypoints/WaypointForm.tsx:297-345`). There is still no way to place anything by looking at the map                                                                                                                                       |
| 22  | Delete `.chrome-bottomright` / `--layout-rail-gap` | 🟡 **Partial**                                        | `.chrome-bottomright` is `display: none` (`index.css:358-360`) rather than deleted                                                                                                                                                                                                                                                    |

**Two prior findings I am formally withdrawing.** F3 (mobile stacking order
inverted) is now _documented as a deliberate revert_ at `index.css:262-282` —
the swap was tried, the upward-opening wind popover collided with the command
bar, and it was reverted rather than shipped broken. That is the right call and
the right paper trail; the finding stands only as `R51`/`R48`, not against the
current build. And I checked for a duplicated scale bar in `desktop-01` after
misreading the downscaled capture, cropped and brightened the region, and
**there is only one** (`MapView.tsx:157`, a single `ScaleControl` at
bottom-right). Not a finding. Recording the miss because a prior pass's value
came from disclosing exactly this kind of thing.

---

## Ratings — the hunter's perspective, /10

| Dimension                               | Score | The one-line reason                                                                                 |
| --------------------------------------- | ----- | --------------------------------------------------------------------------------------------------- |
| Does it answer a real hunting question? | **3** | It renders inputs to the answer. Nothing composes them into one                                     |
| Time to first insight                   | **2** | Ten layers, a hardcoded Ohio start, and the readout that would explain the ground is unwired        |
| Your own stuff on your own map          | **0** | No stands, no sightings, no boundary render anywhere on the map                                     |
| Offline as a daily driver               | **4** | Elevation is genuinely excellent. Imagery, stands and filters are not there                         |
| Honesty / earned trust                  | **7** | The strongest dimension by far — with two specific breaches (F2, F4) that cost more than their size |
| The saved-filter moat, as shipped       | **2** | Buried below ten layer rows, presets need signal, library does not survive a cold start             |
| The desktop dock, as shipped            | **3** | 17% of its permanent height is what you opened it for                                               |
| Field usability at 05:30, gloved        | **4** | Data entry is metric, typed, and `<select>`-heavy                                                   |
| **Overall: would a hunter switch?**     | **3** | Not yet, and not for a reason on the scorecard                                                      |

For contrast, and unchanged from the prior pass: **`ConditionsBar` and
`RegionPicker` both rate a 9.** Nothing in this audit should touch either.

---

## Findings, ranked by field consequence

### F1 — CRITICAL. Nothing a hunter creates appears on the map. The layer slot for it was reserved and never filled.

**CONFIRMED (source).** `MapView` takes `activeLayers`, `opacities`,
`windFromDeg`, `atUtc`, `filterStackId`, `coverage`, `regionBox` — and **no
property, no waypoints, no observations** (`MapView.tsx:15-61`). Grepping the
whole of `apps/web/src` for `new maplibregl.Marker` returns **zero matches**.
The only `addSource`/`addLayer` calls in `MapView.tsx` (322, 333) are for
basemap and analysis rasters; the coverage hatch and region outline are their
own modules. And the layer-order anchor list at `MapView.tsx:248-255` includes:

```ts
'anchor-saved',
'anchor-features',
```

with the component's own doc comment describing the intended stack as "…then
saved filters, **then waypoints and sign on top**" (`MapView.tsx:66-69`). The
slot is reserved, named, ordered — and empty.

The downstream consequences, each confirmed separately:

- **Stands.** `WaypointList` rows call `onSelect`, which opens `WaypointDetail`
  in the drawer. `WaypointDetail.tsx:66` renders the position as
  `{lat.toFixed(5)}, {lng.toFixed(5)}`. There is no "show on map", no fly-to,
  no marker. Grep for `flyTo|fitBounds|jumpTo` across `apps/web/src` returns
  exactly two hits: the geolocate button (`App.tsx:434`) and `BoundaryEditor`'s
  own locate (`BoundaryEditor.tsx:312`). **Selecting a stand does not move the
  map and does not mark it.**
- **Sightings.** Same. `ObservationList` is a list; nothing plots.
- **Property boundary.** Drawn on a _different_ map, on a different route
  (`/properties/:id/boundary`, `PropertyBoundaryEditScreen`). Selecting a
  property on the main workspace sets `propertyId` for gating and updates the
  dock header's subtitle (`App.tsx:844-848`) — **it does not draw the boundary
  and does not move the map to it.**
- **Corridors.** `useSolveCorridor` (`lib/api/terrain.ts:70`) has **zero
  consumers** in any `.tsx`. The anisotropic least-cost solver — one of the four
  structural advantages in `VISION.md` — has no front door at all.
- **Selection analytics.** `useMovementAnalytics` (`lib/api/analytics.ts:30`)
  has **zero consumers**. The only analytics a hunter can see is two numbers on
  the property detail screen: mean slope and bench share
  (`PropertyDetailScreen.tsx:118-125`).

**Field cost.** This is the finding that decides the operating question. Every
competitor's core loop is _pin your stands, see them on your map, see what you
killed near which one._ Ridgeline can store all three and display none of them
spatially. A hunter evaluating this at their kitchen table on a Thursday night
will not reach the terrain engine, because they will fail the first thing they
try. The 2026-08-06 pass named time-to-first-insight as the finding that
mattered most; this is worse than slow insight, it is a categorical absence —
and unlike that finding it is not an opening on the competition, it is a
prerequisite the competition met a decade ago.

**Not on the board.** I grepped `docs/BACKLOG.md` for every phrasing I could
think of (`waypoints on the map`, `render waypoints`, `stands on the map`,
`pin`, `marker`) and there is **no row for this.** `R63` covers the dock and the
readout card. `N4` ("Movement analytics dashboard", P1, L) covers the analytics
half only. **This should be filed as P0 and it should outrank R63 and R80.**

**The honest counter-argument, and why I reject it.** One could argue the map
is deliberately an _analysis_ surface and the drawer is the _records_ surface,
and that separating them keeps the map clean. That argument would be defensible
if the analysis surface answered a question on its own — but F2 shows it does
not, and a hunter does not experience two surfaces, they experience one app
that cannot show them their stand.

---

### F2 — CRITICAL. Tap the ground and the app tells you where you tapped. The component that answers properly is built, tested, and not connected.

**CONFIRMED (source).** `App.tsx:919-943`, the entire terrain readout:

```tsx
<dl className="readout">
  <dt>Latitude</dt>  <dd>{inspect.lat.toFixed(5)}</dd>
  <dt>Longitude</dt> <dd>{inspect.lng.toFixed(5)}</dd>
</dl>
<p className="rl-hint">
  Readouts resolve against the elevation tiles on this device, so they work with
  no signal.
</p>
```

Two coordinates, and a sentence claiming an on-device elevation resolution that
**this card does not perform** — it renders the `lngLat` the click handler
already had. Nothing in it touches the DEM. That sentence is the same class of
defect as the wind-check copy `docs/QA-FIELD.md` finding 5 caught: honest-
sounding copy attached to a mechanism that isn't running. It is smaller in
consequence and identical in kind, and it sits on the app's most exploratory
gesture.

Meanwhile `apps/web/src/components/TerrainReadout.tsx` is a **finished**
peek/expand sheet: `FactToken`s for slope and aspect (`:291-293`), a `Feature`
row for morphometry (`:237`), a labelled `Bedding likelihood` judgement block
carrying its evidence grade (`:243`), peek/expand detents with correct
`aria-label`s (`:200-225`), and a companion `TerrainReadout.test.tsx`. Grep for
`TerrainReadout` across `apps/web/src` excluding tests: **the only hits are
inside the file itself and two unrelated doc comments.** It has never been
mounted.

**And on a phone you cannot open even the lat/lng card by tapping.** The
inspect handler is bound to `contextmenu` (`MapView.tsx:159`) — right-click on
desktop, long-press on touch. The single most natural gesture on a terrain map,
_tap a spot and tell me about it_, is bound to nothing.

**Field cost.** A hunter's actual question standing over a piece of ground on a
screen is "what is this?" — how steep, which way does it face, is it a bench, is
it leeward right now. The app has computed all of it on-device and shows two
decimal numbers a phone's compass app gives away for free.

**This is the single highest-value unshipped thing in the repository**, because
it is not new work. It is wiring. It is inside `R63` ("the dock, **readout
card**, evidence legend, mobile restyle", P0, size L) — and that bundling is
the problem. **I challenge `R63`'s shape:** the readout card is the highest-
value item in that row and it is queued behind the lowest-value item in it
(F5). Split it out and ship it alone.

---

### F3 — CRITICAL. Offline, there is no picture. Elevation is downloaded; imagery, topo, stands, sightings and saved filters are not.

`CLAUDE.md`'s first non-negotiable — _cache elevation, never rendered layers_ —
is correct, and correct for exactly the reason it gives: a rendered-tile cache
needs a variant per layer × per wind × per date, and elevation needs one. But
it has been applied to things that are not analysis layers, and the result is a
hunter who did everything the app asked and still has nothing in the field.

**Basemap imagery — CONFIRMED (source).** `lib/map/baseSources.ts:21-33` fetches
Satellite from `services.arcgisonline.com` and Topo from `tile.opentopomap.org`,
live, every time. The service worker's `runtimeCaching`
(`apps/web/vite.config.ts:20-32`) matches **only** `/api/(properties|waypoints|
observations|filters)` — and the workbox comment above it says tile caching is
deliberately excluded. `RegionPicker` downloads elevation tiles only. So the
offline picture is: hillshade and analysis rasters over `color.ground`. No
aerial imagery. No roads, no field edges, no water, no logging grades, no
labels. `docs/QA-FIELD.md` confirmed this live from the other direction — a
legible greyscale hillshade with no basemap raster loaded at all — and read it
as a success, which it is _architecturally_. As a product it means a hunter who
saved a region cannot see the CRP edge they were going to set up on.

The picker's copy is true and incomplete: _"This saves elevation, not rendered
layers — so one download gives you every analysis layer, on any wind, on any
date, computed here with no signal"_ (`desktop-04`). It never says the ground
underneath will be black. A hunter reads "Save this area for offline use" as
"this area will be here". **This is precisely `CLAUDE.md` §1's worst failure —
"losing a region the user waited twenty minutes for, discovered blank in the
field" — arriving by a different route than the one that clause anticipated.**

**Stands, sightings and filters — INFERRED, with a strong live corroboration.**
`lib/api/queryClient.ts:82-86` keeps `networkMode: 'online'` for **reads**, with
an explicit rationale: _"a paused query still renders its last good data."_ That
holds within a session. It does not hold on a cold start. React Query v5 with
`networkMode: 'online'` pauses a query **before invoking `queryFn`** once
`navigator.onLine` is false — so `apiFetch` never runs, so the service worker's
30-day `NetworkFirst` cache of exactly these endpoints is **never consulted**,
and `data` is `undefined`. `gcTime` is in-memory and the file says so itself:
_"gone on a full reload."_

This is the same defect class as the mutation bug `field-qa` found and
`R73`/`61a0ca6` fixed by setting `networkMode: 'always'` on mutations. The fix
was applied to writes; reads were left, with a rationale that is true for the
warm case and false for the cold one.

**The live corroboration:** `docs/QA-FIELD.md` finding 3 drove a genuinely
offline reload and observed the property list come back empty and the app say
_"Sightings & sits needs a property first — create one"_. That is this
mechanism, observed. `R75` fixed the _message_ (`propertiesUnverified` now
exists, `lib/currentProperty.ts:97-107`) — it did not make the data reachable.

**The one-step check that settles it:** load the app online so the SW caches
`/api/waypoints`, kill the tab, go offline, cold-start, open the Stands tab.
If it shows the stands, I am wrong. If it shows "No waypoints yet", the
service-worker cache is unreachable behind the pause and `networkMode` on reads
needs the same treatment writes got.

**Field cost, compounded.** At 05:30 with no bars: no imagery, no stands, no
sightings, no saved filters. What survives is elevation, the analysis layers
computed from it, and the wind you set. That is a real and unusual capability —
and it is not a daily driver.

---

### F4 — HIGH. The thermal readout is confidently wrong for the last 30–160 minutes of legal light, on evening sits, west of about 75°W. Proven by running the shipped engine.

**CONFIRMED (executed against `packages/terrain/dist`).**

`sunTimes` (`packages/terrain/src/analysis/solar.ts:272-289`) correctly anchors
its **scan window** on local solar midnight — its doc comment documents the
exact bug that motivated it. But it chooses _which_ day to scan from
`date.getUTCFullYear/Month/Date()`. For any instant between UTC midnight and
local midnight — which in North America is the **evening** — it returns the
_next_ local day's sunrise and sunset. `thermalPhaseAt` then evaluates
`t > sunrise && t < sunset`, sees `t` before tomorrow's sunrise, and answers
`Sinking`.

Run against the built engine:

```
2026-08-07T23:56Z  Hocking Hills OH   sunset 2026-08-08T00:31Z   phase = transition   ✅
2026-08-08T00:26Z  Hocking Hills OH   sunset 2026-08-09T00:29Z   phase = sinking      ❌
```

Those two instants are **thirty minutes apart on the same evening**, and the
second is **five minutes before sunset**. The phase runs `rising → transition →
sinking → (tomorrow) rising`, jumping backwards at UTC midnight. Montana in
archery season is worse because the offset is larger:

```
2026-09-10T23:00Z  45.7N 110.5W (17:00 MDT)  phase = rising   ✅
2026-09-11T01:00Z  45.7N 110.5W (19:00 MDT)  phase = sinking  ❌  (sunset 01:37Z)
```

Thirty-seven minutes of shooting light left and the app says thermals are
sinking.

**And the screenshot shows the failure state shipping.** `mobile-02` reads
**"Aug 8 12:26 AM · Thermals Sinking"** — that is 20:26 local at the map centre,
before sunset. (The mobile captures are stale for chrome; this is a _readout
value_, computed by code that has not changed, so it is usable as evidence
here and I am flagging that I am using it narrowly.)

**Bounded honestly:** the window is `00:00Z → local sunset`, so it is zero when
local sunset falls before UTC midnight. Ohio in gun season is clean (I checked:
`2026-12-01T22:00Z` → `transition`, correct). It bites early-season archery
everywhere, and the Mountain and Pacific West for most of the season.

**Field cost.** Evening thermal switch is _the_ thing an evening hunter manages
scent by — the difference between your scent going up the hill away from the
bedding area and pouring down the draw into it. `CLAUDE.md` §2 is explicit:
_"A layer that is subtly inverted is worse than no layer, because it is
trusted."_ This is that, on the app's most-glanced element, and it also feeds
`computeThermals`' scent azimuth (`wind.ts:234`) — so any thermal-aware layer
inherits it.

**Not on the board.** `R58` is a different thermal finding. File this
separately.

---

### F5 — HIGH. The desktop dock does not earn 300px. Measured: 17% of its permanent height is the thing you opened it for.

The brief asks the product question rather than the review findings, so: **does
a 300px permanent dock earn its width on this product at all?**

**Measured, not estimated.** I detected the full-width divider rules inside the
dock column of `desktop-02-layers-open.png` programmatically (rows where every
sampled pixel across x∈[2,592] is within 14 levels of uniform and brighter than
the plate). They fall at device rows 188, 280, 426, 1008, 1366 → CSS y = 94,
140, 213, 504, 683 on a 900px-tall viewport. Dock right border measured at
device x=596 → 298 CSS px, matching `layout.dock-width: '300px'`
(`packages/design/src/tokens.ts:340`).

| Band                                                                                         | CSS px   | Share of 900 |
| -------------------------------------------------------------------------------------------- | -------- | ------------ |
| `DockHeader` — "RIDGELINE" / "Signed out" / `39.4340° N 82.5400° W`                          | 94       | 10%          |
| `TabBar` — Layers / Stands / Sightings                                                       | 46       | 5%           |
| Layers panel header — "LAYERS", coverage chip, ✕                                             | 73       | 8%           |
| **Layers panel scroll viewport**                                                             | **291**  | **32%**      |
| — of which: coverage sentence (3 lines)                                                      | ~74      | 8%           |
| — of which: "BASE MAP / Pick one" heading                                                    | ~22      | 2%           |
| — of which: **the Satellite row — the only layer visible of ten**                            | **~156** | **17%**      |
| `DockSection` "Offline coverage" — the coverage sentence **again**, plus the download button | 177      | 20%          |
| Evidence-grade legend + "Collapse dock"                                                      | 217      | 24%          |

So of a permanently-occupied 300 × 900 column: **17% is layer content, 28% is
the coverage sentence told twice, 24% is a four-row glossary that never changes,
and 23% is headers and a collapse control.**

Three product observations follow, and they matter more than the arithmetic:

1. **The desktop shows less of the layer list than a phone does.** `mobile-02`
   (stale for chrome, used here only for sheet geometry, which the dock did not
   change) shows Satellite, Topo, and the RELIEF heading on a 390×844 phone.
   `desktop-02` shows Satellite alone on 1440×900. A 3.9× larger screen shows
   0.4× the content. Whatever the dock is for, it is not for seeing more.
2. **The coverage sentence renders twice, 293 CSS px apart, both
   `aria-live="polite"`** (`LayersSheet.tsx:122-124` and `App.tsx:854-866`).
   Every pan announces the same sentence twice to a screen-reader user. This is
   already known (`R80`); what I am adding is that it is not a duplication bug
   so much as **a symptom of the dock having nothing else to put there** — the
   dock needed a section, and the only content available was content the panel
   inside it already showed.
3. **The evidence-grade legend is a glossary, and a glossary is not chrome.**
   Four rows, static, 24% of the dock's height, forever. It answers a question
   asked once. `Confidence`'s own chips are already tappable at the point of
   claim; that is the correct place for this, and it makes the permanent legend
   redundant.

**My answer to the brief's question, argued from workflow rather than the mock.**

A hunter's desktop session is _scouting_, not hunting: big screen, coffee, e-
scouting a new property in September. In that session the things they touch
continuously are **the wind dial, the date scrubber, the layer they are
comparing against, and their stands.** The things they touch once are the
property picker, the offline download, and the evidence glossary.

A permanent dock is the right container for the first group and the wrong one
for the second. Today it holds exactly the wrong set: the header identifies a
property they picked once, the offline section fires a job they start once, the
legend defines terms once — while wind and time live _outside_ it in
`ConditionsBar`, and the layer list, which is the one thing they will touch
fifty times, gets one row.

**So: yes, a dock earns its width on this product — but not this dock, and not
at this content model.** What has to be in it, in priority order:

- **The layer stack, dense.** Ten rows have to be scannable without a nested
  scroller. That means #10 / `N21` (collapse blurbs to the focused row, group
  accordions) is now a _prerequisite_ of the dock, not an independent nicety.
  The plan's §c Base / Relief / Terrain-analysis sections were the right idea
  and not building them is what left one row visible.
- **The terrain readout (F2)**, docked rather than floating, updating as the
  hunter moves the cursor over the ground. _That_ is a thing worth 300px
  permanently, because it changes continuously and it is the answer to the
  question they are asking. It is also the one use of the dock that a phone
  genuinely cannot replicate, which is the only honest argument for a
  desktop-specific surface existing at all.
- **The saved-filter library**, as a peer of the layer stack rather than
  buried under it (§5).
- **Not** the evidence glossary. Not the coverage sentence twice. Not a
  coordinate readout of the map centre to four decimal places, which is a
  number no hunter uses.

Two smaller dock findings while I am here, both CONFIRMED (source):

- **Collapse does not persist.** `const [dockCollapsed, setDockCollapsed] =
useState(false)` (`App.tsx:252`), no storage. Every cold start re-opens a
  300px panel over the map, and `drawerTab` defaults to `'layers'`
  (`App.tsx:211`). A hunter who prefers the map has to collapse it every
  session. This is a two-line fix and it is the cheapest improvement to the
  dock available.
- **The dock overlays the map; it does not shrink it.** `index.css:179-181`
  pads `.map-chrome` by the dock width, but `MapView` fills the viewport and
  MapLibre is given no `padding` option. So the map's centre — where `flyTo`
  lands, and where a future centre-crosshair placement would sit — is 150px
  right of the _visible_ centre. Minor today; it becomes a real aiming error
  the moment #21 ships.

---

### F6 — HIGH. The saved-filter library is not a moat yet, and three specific things stop it becoming one.

`VISION.md` §2: _"Once someone has built a filter library that matches how they
read ground, leaving costs them that library."_ Assessed honestly, the shipped
product is a long way from that gravity, and the distance is not "polish".

**What is genuinely good, and should not be touched.** `FilterEditor` is a real
predicate builder over a validated AST. `MatchShare` is, as `docs/QA-FIELD.md`
found, the best honesty surface in the app — eight distinct states including
one that _hides_ a number it cannot compute correctly. Filter creates and
updates are offline-queued with `clientId` (`lib/api/filters.ts:57-80`). The
plumbing is right.

**Three things stop it having gravity:**

1. **It is not a first-class object in the UI.** It is a section at the
   **bottom** of the Layers tab (`LayersSheet.tsx:185-228`), below all ten layer
   groups. On the shipped desktop dock, reaching it means scrolling a 291px
   nested scroller past ten expanded rows — the _last_ thing in the _last_
   section of the panel that shows one row at a time. Recommendation #20
   shipped Layers / Stands / Sightings; **Filters is the tab that did not get
   made.** For the thing `CLAUDE.md` calls "the moat", that is the wrong
   information architecture, and it is a small change.
2. **The on-ramp needs signal.** `FilterLibrary`'s presets — the working
   examples that teach a new user what a filter even is — come from
   `useFilterPresets` → `GET /filters/presets`, an authenticated server route
   (`lib/api/filters.ts:52`; `FilterLibrary.tsx:41,75-81`). Offline you get
   "Start blank" and an empty predicate tree. The moat's tutorial is online-only.
   Presets are static server data; they should be bundled constants in
   `packages/shared`, available on a cold offline start, and the API route
   should serve the same constants.
3. **The library does not survive a cold start (F3).** Same mechanism. A hunter
   who built five filters at camp, closed the app, and opened it in a hollow
   sees "No saved filters yet. A filter is a terrain query you name and keep…"
   — the empty-state copy, on an account that has five. That is not merely
   missing data; it is the app telling a hunter their scouting IP does not
   exist, which is the precise opposite of the gravity `VISION.md` describes.

**And the payoff is not wired.** `FilterLibrary.tsx:63` promises a filter "can
be handed to the corridor solver later" — `useSolveCorridor` has no consumers
(F1). The strongest reason to build a library is a compounding one: filters
feed corridors, corridors feed stand placement. None of that chain exists in
the UI yet, so today a filter is a coloured overlay you have to re-find.

**Recommendation #13 (search / favourites / recently-used) is superseded by
this finding.** Do not build discovery inside a library nobody has a reason to
fill. Build (1), (2) and (3) first.

---

### F7 — MEDIUM–HIGH. The `VISION.md` scorecard overstates the product in eight rows, and the board's priorities contradict the scorecard's own rule.

The brief asks for this to be challenged rather than accepted. It should be.
The scorecard grades **the engine**; a hunter buys **the product**. Eight rows
change meaning under that substitution.

| Row                           | Scorecard                       | What ships                                                                                                               | Honest mark                                                        |
| ----------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Saddle detection              | ✅ ahead                        | True — `wood` layer, saddles highlighted hardest, with a legend                                                          | ✅ **ahead. Keep.**                                                |
| Bench detection               | ✅ ahead                        | Layer ships, **no legend** (`lib/layers.ts:136-144`)                                                                     | 🟡 ahead but unreadable                                            |
| Slope-angle shading           | ✅ ahead (user-definable bands) | The _layer_ has fixed bands with a good legend; user-definable bands exist only via saved filters, which are buried (F6) | 🟡 **parity in practice**                                          |
| Aspect / sun exposure         | ✅ ahead (date-aware)           | Both ship; **neither has a legend**. Insolation is a bare ramp                                                           | 🟡 ahead, unreadable                                               |
| Leeward bedding model         | ✅ ahead                        | Ships, wind-gated honestly, graded 🔴 Assumed. **No legend, continuous ramp over Assumed constants (#7)**                | 🟡 ahead, and the least readable layer in the app                  |
| Thermal modelling             | ✅ ahead                        | Ships, and is **wrong on evening sits** (F4)                                                                             | 🔴 **currently a liability, not an advantage**                     |
| Movement corridors            | ✅ ahead                        | Engine + API + client hook. **Zero UI** (F1)                                                                             | ⬜ **not in the product**                                          |
| Saved terrain queries         | ✅ ahead (the core interaction) | Ships; buried, online-only on-ramp, does not survive a cold start (F6)                                                   | 🟡 **ahead in capability, not in practice**                        |
| Offline maps                  | ✅ ahead                        | Elevation: genuinely ahead. Imagery/records/filters: absent (F3)                                                         | 🟡 **ahead on one axis, behind on the axis a hunter checks first** |
| Habitat-selection analytics   | ✅ ahead                        | `useMovementAnalytics` has **zero consumers** (F1)                                                                       | ⬜ **not in the product**                                          |
| Sharing / hunting party       | 🟡 partial                      | Correct as marked                                                                                                        | 🟡 keep                                                            |
| Property boundaries / parcels | 🔴 behind                       | Correct — and worse than marked: a boundary you _do_ draw is not rendered on the working map either (F1)                 | 🔴 keep, worsen                                                    |

**Nine of eleven ✅ rows do not survive contact with the shipped app.** That is
not an argument that the engine work was wrong — it is the best engine in this
category and the four structural advantages are real. It is an argument that
**the scorecard is measuring the wrong artifact**, and that measuring the wrong
artifact is how a team ships a world-class terrain engine that cannot show you
your stand. I would add a column: _"Reachable by a hunter in the shipped UI?"_
and re-derive every mark from it.

**On priorities.** `VISION.md` states: _"Red rows outrank new pillars. Being
brilliant at analysis and unable to show a property line is not a switchable
product."_ The board does not implement that rule:

- `N1` PAD-US public land — **P1**
- `N2` Weather API — **P1**
- `N5` Parcel / ownership layer — **P2** _(a 🔴 row, at P2)_
- Trail cameras — **no row at all** that I could find
- `R63` (dock) and `R80` (dock review blockers) — **both P0**

So the two P0s in flight are chrome for a surface whose content model is
unresolved, while three of the four rows `VISION.md` says outrank everything are
P1/P2/absent.

**But I want to be careful here, because I think the stated rule is also
slightly wrong.** Of the four red rows, only _parcels/public land_ is a genuine
switching blocker, and it is genuinely hard (`N5` is right that it likely needs
a commercial data source — that evaluation should start now, because its lead
time is months and nothing else can be sequenced against it until it returns an
answer). Weather is real but partly substitutable: a hunter checks a weather app
anyway, and what Ridgeline needs from weather is a _wind direction it can key
layers to_, which `ConditionsBar` already accepts manually and well. Trail
cameras are an integration surface, not a capability, and I would not build them
before F1.

**F1 outranks all four red rows.** Showing a hunter their own stand on their own
map is not a scorecard row anyone thought to write down, because no product in
the category has ever failed to do it.

---

### F8 — MEDIUM. The data-entry surface is metric, in an app whose scale bar is imperial, for an American whitetail hunter.

**CONFIRMED (source).** `ObservationForm` → `ConditionsFields.tsx:83,93,104,114`:
`Temp (°C)`, `Wind speed (km/h)`, `Pressure (hPa)`, `3h trend (hPa)`.
`WaypointForm.tsx:183`: stand height, _"How high off the ground, **in meters**"_.
Meanwhile `MapView.tsx:157` adds `new maplibregl.ScaleControl({ unit:
'imperial' })`, and the region picker reports _"About 3.3 × 2.1 miles"_
(`desktop-04`). There is no unit preference anywhere in the app.

**Field cost.** A hunter hangs a stand at twenty feet and is asked for meters. A
hunter who saw 38°F is asked for °C. Most will type `20` and `38` and the record
will be wrong — and those records flow into the selection analytics
(`ConditionsFields`' own doc comment says temperature/pressure/wind speed are
the covariates). Silent unit corruption of the analytics denominator is worse
than an empty field. This is small work and it is squarely in the first ten
minutes.

---

### F9 — MEDIUM. Cold start puts every hunter in Hocking Hills, Ohio.

**CONFIRMED (source), one half INFERRED.** `MapView.tsx:139` hardcodes
`center: [-82.54, 39.43]`, and `App.tsx:214` seeds the same. The comment
explains the choice well (sharp relief makes the analysis layers legible on a
first run) and it is a good _first-run_ default.

`MapView.tsx:143` sets `hash: true`, so an in-place reload restores position.
But the PWA manifest's `start_url` is `'/'` (`vite.config.ts:43`), with no hash
— **so launching from the home-screen icon, which is the 05:30 case, opens on
Ohio.** _(INFERRED: I could not launch an installed PWA here. The one-step
check: install to home screen, pan to a saved region, force-quit, relaunch from
the icon, and see whether the hash comes back.)_

**Field cost, and why it is worse than an annoyance.** The offline coverage
badge is per-viewport and honest — so on every cold start it correctly reads
**NOT DOWNLOADED**, because the hunter is looking at Ohio. The first thing the
app says to a hunter who did everything right is that their ground is not
saved. That trains them to ignore the badge, which is the one badge in this app
that must never be ignored. Persist the last view (or the selected property's
centroid) and the badge starts telling the truth on launch.

---

### F10 — MEDIUM. The property gate makes Stands and Sightings unreachable for a new user for reasons that have nothing to do with stands.

**CONFIRMED (source).** `App.tsx:645-680`: both tabs render
`renderPropertyGate(...)` unless `propertyId` is set. Setting it requires
navigating to `/properties` (a full-screen route off the map), creating a
property, and — for the analytics to work — drawing a boundary on a _third_
screen. All of that requires a signed-in user and a live backend.

That is a defensible model for _analytics_ (the availability denominator is
real, and `PropertyDetailScreen.tsx:125-131` refuses to draw charts without it,
which is exactly right). It is the wrong model for _marking a stand_. A hunter's
first useful act in any mapping app is dropping a pin, and here it is behind
account creation, property creation, and a route change.

Combined with F1 (the pin would not appear on the map anyway) and F3 (offline
it would not come back), the whole records half of the product is gated behind
setup that pays off in a list.

---

### F11 — LOW–MEDIUM. Time shown and time modelled use different clocks.

**CONFIRMED (source + screenshot).** `formatWhen` (`App.tsx:1024-1032`) uses
`toLocaleString(undefined, …)` — the **device's** timezone. `thermal`
(`App.tsx:366-381`) computes sun times at the **map centre's** longitude, which
the doc comment explicitly celebrates: _"a hunter scouting ground three states
away needs that ground's sun times."_

Both are individually right and together they produce `desktop-01`'s
**"Aug 11 10:35 PM · Thermals Rising"** — 18:35 local at the Ohio map centre,
rendered in the container's UTC. On a hunter's own ground the two clocks agree
and nothing shows. Scouting out of state — the exact case the code was written
for — the bar contradicts itself, and worse, the date/time _picker_ sets an
instant in the device's zone while the model interprets it at the map's. "Show
me 06:30 Saturday" from home in Central, on a property in Eastern, models 07:30.

Smaller than F4 and the same family: label the time with the zone it is in, and
make the picker explicit about which ground's clock it is setting.

---

## What I would not build

Being explicit, because two of these are on the board and one is tempting.

- **Do not finish the dock to the plan's §c before resolving F1/F2.** The §c
  content model (always-visible Base / Relief / Terrain-analysis sections) is a
  better dock than the one that shipped, and it is still the wrong thing to
  build next, because it fills 300px with layer toggles rather than with the
  answer those toggles are inputs to. Ship the readout into the dock first;
  the section breakdown will look different once something in there changes
  continuously.
- **Do not build trail-camera integration.** A 🔴 scorecard row, and still the
  wrong next move: it is an integration with third-party hardware, it needs
  signal by definition, and it lands on a map that cannot yet show a stand.
- **Do not build recommendation #13** (filter search / favourites /
  recently-used). Superseded by F6.
- **Do not build a native app to close the 🟡 "Mobile native apps" row.** The
  PWA's problems are F1, F2, F3 and F8, none of which a rewrite fixes and all
  of which a rewrite would postpone by a quarter.
- **Do not pre-bake rendered analysis tiles for offline.** `CLAUDE.md` §1 is
  right and F3 is not an argument against it. Cache the **basemap** — one
  variant, no combinatorial explosion — and keep computing analysis on-device.

---

## Prioritised recommendations

Continuing the numbering; the 2026-08-07 pass ended at #22.

| #      | Recommendation                                                                                                 | Size  | Owner                              | Why it ranks here                                                                                                                                          |
| ------ | -------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **23** | **Render stands, sightings and the property boundary on the map**                                              | **M** | `map-builder` + `frontend-builder` | **F1.** The anchor slot exists. This is the difference between a terrain toy and a hunting app, and nothing else on this list matters until it is true     |
| **24** | **Wire `TerrainReadout` into the map; bind it to tap, not long-press**                                         | **S** | `frontend-builder`                 | **F2.** The component is finished and tested. This is wiring, and it is the largest insight-per-hour item in the repository. **Split it out of `R63`**     |
| 25     | Fix `sunTimes`' local-day selection; add an evening-sit regression                                             | S     | `terrain-scientist`                | **F4.** Confidently wrong on the readout that governs scent, in the last hour of light. Pin it with a test at three longitudes and two seasons             |
| 26     | Cache basemap imagery inside the saved region, and say what a download does and does not include               | M     | `offline-steward` + `map-builder`  | **F3.** One variant, no explosion. Until then, the picker must state plainly that imagery is not included                                                  |
| 27     | Make reads reachable offline — `networkMode` on queries, so the SW's `/api` cache is consulted on a cold start | S     | `offline-steward`                  | **F3/F6.** Same defect class as `R73`, fixed for writes and not for reads. Stands, sightings and the filter library all come back for one line plus a test |
| 28     | Persist the last map view (or fly to the selected property) on launch                                          | XS    | `frontend-builder`                 | **F9.** Stops the coverage badge lying on every cold start. Cheapest item here                                                                             |
| 29     | Unit preference (imperial default), and fix the four metric field labels                                       | S     | `frontend-builder`                 | **F8.** Silent unit corruption of the analytics covariates                                                                                                 |
| 30     | Filters become a fourth drawer tab; presets ship as bundled constants                                          | S–M   | `frontend-builder`                 | **F6.** The moat is currently the last section of the last panel, with an online-only tutorial                                                             |
| 31     | Layer density (#10 / `N21`) — now a **prerequisite** of the dock, not a nicety                                 | S     | `frontend-builder`                 | **F5.** One row of ten visible on a 900px screen                                                                                                           |
| 32     | Legends for `aspect`, `insolation`, `bench`, `bedding` (completes #6)                                          | S     | `map-builder`                      | **F7.** Four layers ship with no key, including the flagship                                                                                               |
| 33     | Persist dock collapse; drop the evidence glossary and the centre-coordinate line from the dock                 | XS    | `frontend-builder`                 | **F5.** 24% of the dock's height back, and the map stays where the hunter left it                                                                          |
| 34     | Start the parcel/public-land data-source evaluation now (`N5`, `N1`)                                           | —     | founder + `schema-architect`       | **F7.** Months of lead time and it blocks the only red row that is a genuine switching blocker. Evaluate before it is scheduled                            |
| 35     | Re-derive the `VISION.md` scorecard against a "reachable in the shipped UI?" column                            | XS    | `vision-steward`                   | **F7.** Nine of eleven ✅ rows do not survive the substitution                                                                                             |

**Sequencing.** #23 and #24 first, together — they are the same surface and
they are what make this a hunting app. #25 and #28 are hours of work each and
should go in alongside. #26/#27 are the offline pair and should ship as one
piece with an offline cold-start test. #30–#33 are the dock and the moat, and
they only make sense after #24 has given the dock something worth its width.

## Two things that are not criticisms

**The honesty layer is the best thing in this product and it is not close.**
`describeCoverage`'s refusal to produce a reassuring answer from an absent
measurement; the bedding toggle disabled with _"without one this layer would
render against a default, which would be misleading rather than merely wrong"_;
`MatchShare` hiding a statistic it cannot compute correctly; the region
picker's _"The browser did not grant persistent storage… Check the badge before
you leave"_; the property detail refusing to draw a chart without an
availability denominator. No competitor does any of this, and the four
structural advantages in `VISION.md` rest on it. **None of the findings above
ask for a single one of those to be softened.** F2 and F4 are the two places
where the app fell _below_ that standard, and they are filed as breaches of it,
not as evidence against it.

**And the chrome work landed.** The 2026-08-07 pass's headline finding — that
opening Layers on a phone hid the wind control and cost the flagship
interaction eight interactions with a mandatory panel-close — is fixed at the
root, with the arithmetic moved into named custom properties and a comment
explaining what it prevents. The dead button is gone, the rail is gone, and the
`* 3` magic constant is gone from the mobile path. That is four recommendations
closed properly rather than worked around. The problem this pass found is not
that the chrome work was wrong; it is that it was the wrong thing to be doing
two passes in a row.

---

# 2026-08-07 — The left-hand chrome: rails, grouping, and growth

**Scope:** the floating map controls — `apps/web/src/App.tsx:250-307`,
`apps/web/src/index.css:37-171`, and `.rl-rail` / `.rl-conditions` /
`.rl-sheet--drawer` in `packages/design/src/styles.css`. Prompted by a direct
usability complaint from the founder, who uses this daily: _"Left side bar is
really hard to work with. If a full left hand nav design revamp is needed then
let's do it."_ Treated as a finding to explain, not a hypothesis to test.

**Relationship to the 2026-08-06 pass below.** That pass's §3 _"Transient
controls vs persistent panels"_ and its recommendation #5 _"Uncouple wind/time
from the layers sheet"_ cover adjacent ground and were **landed** — `App.tsx`
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
  CalTopo. Treat as a design prompt. A `[snippet]` is _not_ grounds for a build
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

1. `apps/web/src/index.css:161-170` documents the occlusion as _"a deliberate,
   temporary occlusion by a panel the user can dismiss"_ — true as a statement
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
popovers were deliberately decoupled because the flagship move — _"sweeping the
wind dial and watching leeward bedding likelihood repaint live"_ — "needs the
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
2. Reach Terrain Analysis. Bedding is disabled with _"Set a wind direction first
   — without one this layer would render against a default, which would be
   misleading rather than merely wrong."_
   (`apps/web/src/components/LayersSheet.tsx:128-130`). **This is correct and
   honest and is the best moment in the app.**
3. The wind control is underneath the sheet you are reading.
4. **Close the sheet.** Forced, and forced only by this layout.
5. Tap Wind. 6. Set NW. 7. Dismiss popover.
6. Tap Layers, scroll back down, toggle bedding.

Eight interactions with a mandatory panel-close in the middle. On desktop the
same journey is five with no close.

**This is the argument that the layout is not cosmetic.** It is costing the
product its time-to-first-insight moment on the device it is actually used on,
and the moment it costs is the one the whole product exists for. The prior
pass's §5 identified time-to-first-insight as "the finding that matters most";
this is the same finding, reached from the chrome instead of the content.

## Ratings (hunter's perspective, /10)

| Dimension                                   | Desktop | Mobile |
| ------------------------------------------- | ------- | ------ |
| Discoverability of the three controls       | 4       | **2**  |
| Grouping / information architecture         | 3       | 3      |
| Reachability one-handed at 05:30            | 6       | **2**  |
| Map area preserved (the map is the product) | 6       | **2**  |
| Honesty of the state shown                  | 4       | 4      |
| Survives roadmap growth to nine controls    | **1**   | **1**  |
| **Overall left-hand chrome**                | **4**   | **2**  |

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

`apps/web/src/index.css:143-146` states: _"Wind and time are the two things a
hunter re-checks constantly, so they get the bottom edge — the only part of a
large phone a thumb reaches reliably."_

`column-reverse` places the **first** DOM child last. `App.tsx:266` renders
`<Rail>` first and `<ConditionsBar>` second. So **the rail gets the bottom edge
and the ConditionsBar sits above it** — confirmed in `08-mobile-map.png`, where
the conditions row is at y≈1258-1375 and the rail slab is below it at
y≈1390-1660 (2× device pixels).

The stated field rationale is inverted in practice. No test covers it, because
group 4 is desktop-only.

### F4 — Icon-only, and the only affordance is a `title` that never fires on touch.

`packages/design/src/components/primitives.tsx:49-50` sets both `aria-label` and
`title`, with the comment _"the tooltip is what makes them learnable for
everyone else."_ `title` is correct for a mouse and is **inert on every touch
device**. In the field the user has three unlabelled glyphs and no way to learn
them.

The download glyph is the dangerous one. An arrow-into-a-tray, floating over a
map, reads equally as "download this map for offline" (right), "export a GPX"
(wrong), or "collapse this panel" (wrong). Getting it wrong costs either a
20-minute download you did not want or — worse — _not_ starting the one you did.

Every source I could actually read writes the word:

- **NWACus/avy** — the NWAC avalanche app; safety-critical, offline-capable,
  used in the field on a phone — renders a literal `<Text style={styles.label}>
{label}</Text>` under every tab icon at `fontSize: 10`
  (`components/content/navigation/AnimatedBottomTabBar.tsx:26,101-102`) for its
  three tabs Map / Observations / Weather
  (`components/screens/navigation/BottomTabs.tsx:64,78,92`). It also passes
  `tabBarHeight` down into the map view (`BottomTabs.tsx:131`) so the map knows
  how much of itself the chrome is occupying — a detail Ridgeline has no
  equivalent of. _(primary source, cloned and read)_
- **osmandapp/OsmAnd** — `OsmAnd/res/layout/map_hud_bottom.xml` is a
  `bottom_controls_container` of stacked `<include>` slots, i.e. the bottom edge
  is the app's real control surface. _(primary source, fetched and read)_
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

The task is the honesty failure. `regions.active` — the download running _right
now_ — is passed **only** to `RegionPicker` (`App.tsx:328`), which unmounts when
`pickerOpen` is false (`App.tsx:323`). Close the panel and a twenty-minute
download has **zero presence anywhere in the UI**. Meanwhile the rail button
glows amber for `active={pickerOpen}` (`App.tsx:286`) — which means _panel is
open_, not _download is running_. The one persistent signal the user gets about
the download is reporting the wrong variable.

Set against `CLAUDE.md`'s own line — _"Losing a region the user waited twenty
minutes for, discovered blank in the field, is the worst failure this product
has"_ — the chrome currently gives that task no surface at all. The prior pass's
§4 audited the download _flow_; this is about its absence from the chrome once
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
non-negotiable is _"never be confidently wrong about terrain,"_ a control that
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
The file's own comment acknowledges the coupling — _"This app's own rail stacks
three buttons in that corner"_ — which makes it documented, not fixed.

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
`map_hud_bottom.xml` _(primary)_. That is an escape hatch from a layout problem,
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

| Kind                         | Members (today → roadmap)                                 | Container                                              |
| ---------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| **Panels**                   | Layers, Offline → Filters, Property                       | **One** drawer button; tabs _inside_ the drawer        |
| **Map tools** (armed, modal) | _(none live)_ → Waypoint, Boundary, Observation, Corridor | **One** primary action → tray                          |
| **Background tasks**         | Region download                                           | Not a button. A status cell, present only when running |
| **Conditions**               | Wind, Time, Thermals                                      | `ConditionsBar` — unchanged                            |

Three controls today. Three controls at nine features. That is the whole point,
and it is the part the "four fixes" option cannot deliver.

This respects the drawer-slot invariant at `App.tsx:272-276` — one `.rl-sheet`
at a time, tabs _inside_ it rather than a second sheet — and the tool tray is
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
  control _gains_ a word.
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
time are not settings, they change what every layer _means_, and burying that in
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

| Source                                                                                                                  | What it is                                                                                                                                            | Files read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`NWACus/avy`](https://github.com/NWACus/avy) (MIT, © Northwest Avalanche Center)                                       | The official NWAC / US National Avalanche Center forecast app. Implements NAPADS.                                                                     | [`components/DangerRose.tsx`](https://github.com/NWACus/avy/blob/main/components/DangerRose.tsx), [`components/SeverityNumberLine.tsx`](https://github.com/NWACus/avy/blob/main/components/SeverityNumberLine.tsx), [`components/AvalancheProblemLikelihoodLine.tsx`](https://github.com/NWACus/avy/blob/main/components/AvalancheProblemLikelihoodLine.tsx), [`components/AvalancheProblemSizeLine.tsx`](https://github.com/NWACus/avy/blob/main/components/AvalancheProblemSizeLine.tsx), [`components/AvalancheProblemCard.tsx`](https://github.com/NWACus/avy/blob/main/components/AvalancheProblemCard.tsx), [`content/helpStrings.ts`](https://github.com/NWACus/avy/blob/main/content/helpStrings.ts), [`types/nationalAvalancheCenter/schemas.ts`](https://github.com/NWACus/avy/blob/main/types/nationalAvalancheCenter/schemas.ts) |
| [`albina-euregio/albina-website`](https://github.com/albina-euregio/albina-website)                                     | The EUREGIO `avalanche.report` platform (Tyrol / South Tyrol / Trentino). EAWS-conformant; its glossary content is republished from `avalanches.org`. | [`app/components/icons/exposition-icon.tsx`](https://github.com/albina-euregio/albina-website/blob/master/app/components/icons/exposition-icon.tsx), `app/components/icons/warn-level-icon.tsx`, `app/components/bulletin/bulletin-danger-rating.tsx`, `app/components/bulletin/bulletin-problem-item.tsx`, `public/content/education/danger-scale/en.html`, `public/content/education/handbook/en.html`, `app/components/bulletin/bulletin-glossary-en-content.json`                                                                                                                                                                                                                                                                                                                                                                        |
| [`material-components/material-components-android`](https://github.com/material-components/material-components-android) | The written spec behind the bottom-sheet muscle memory on Android.                                                                                    | [`docs/components/BottomSheet.md`](https://github.com/material-components/material-components-android/blob/master/docs/components/BottomSheet.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| [`organicmaps/organicmaps`](https://github.com/organicmaps/organicmaps)                                                 | A shipping offline-map app with a mature region-download flow. Used as a **stand-in** for Gaia/onX, which are closed.                                 | [`data/strings/strings.txt`](https://github.com/organicmaps/organicmaps/blob/master/data/strings/strings.txt)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

**Still unverified, and now marked as such in the text.** CalTopo, Gaia GPS,
FATMAP, onX Hunt, HuntStand, Komoot, Strava, Google Maps and Apple Maps are all
closed products with no reachable documentation from here. Claims about them are
labelled **[recalled]** where they survive, and several first-pass claims have
been **deleted outright** rather than left standing — including the Gaia
layer-catalogue size and the FATMAP/Strava status. A `[recalled]` claim is
prior working knowledge, is fine as a design prompt, and is **not** adequate
grounds for a build decision on its own.

**The research changed the headline recommendation.** The first pass proposed a
"bedding rose" with wedges _shaded by modelled likelihood_. Both reference
products deliberately do not do that — see §2, which has been rewritten, and the
full spec in recommendation #8.

**Findings about our own code were verified against the source in the first pass
and are unchanged here.**

## What we studied

| Product                                                                                                                                                     | Why it is the relevant comparison                                                                                                                                                                                                                                                                                        | Evidence status                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Avalanche forecast products** — NAPADS as implemented by the US National Avalanche Center; EAWS as implemented by the EUREGIO `avalanche.report` platform | The closest analogue to our problem: modelled and judged risk presented honestly to people making life-safety decisions on terrain. The danger scale, the aspect/elevation rose, the separation of likelihood from size, and the scale-of-validity statement. **This is the important one and it is now fully sourced.** | ✅ **Read today** — [`NWACus/avy`](https://github.com/NWACus/avy), [`albina-euregio/albina-website`](https://github.com/albina-euregio/albina-website)          |
| **Google Maps / Apple Maps**                                                                                                                                | The baseline every user's muscle memory is trained on. Bottom sheets with detents, floating controls, what a control that opens a panel is _expected_ to do.                                                                                                                                                             | ⚠️ Partially — the underlying **Material** bottom-sheet spec was read; the two products themselves were not reachable                                           |
| **Offline region download**                                                                                                                                 | How size, progress and failure are communicated. Gaia and onX are the products hunters actually use; both are closed.                                                                                                                                                                                                    | ⚠️ **Substituted** — [`organicmaps/organicmaps`](https://github.com/organicmaps/organicmaps) shipping strings read today. Gaia/onX specifics are **[recalled]** |
| **CalTopo**                                                                                                                                                 | The power-user backcountry mapping tool. Composable base layers, per-overlay opacity, custom layer URLs, unapologetic density. Users are SAR professionals.                                                                                                                                                              | ❌ **[recalled]** — `caltopo.com` unreachable                                                                                                                   |
| **Gaia GPS**                                                                                                                                                | The mobile map-first pattern at scale: a large searchable layer catalogue separated from a short active stack.                                                                                                                                                                                                           | ❌ **[recalled]** — `gaiagps.com` unreachable                                                                                                                   |
| **FATMAP**                                                                                                                                                  | 3D terrain and slope-angle shading for avalanche terrain; curated map modes rather than a catalogue.                                                                                                                                                                                                                     | ❌ **[recalled]** — `fatmap.com` unreachable                                                                                                                    |
| **Komoot / Strava**                                                                                                                                         | Route-planning interaction and elevation-profile presentation; the map↔profile crosshair link.                                                                                                                                                                                                                           | ❌ **[recalled]**                                                                                                                                               |
| **onX Hunt / HuntStand**                                                                                                                                    | The incumbents we are trying to displace. Studied mainly for what not to copy.                                                                                                                                                                                                                                           | ❌ **[recalled]**                                                                                                                                               |

## Ratings

| Area                                        | Rating | One-line verdict                                                                                                                                                                                                    |
| ------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layer management at scale                   | **B−** | Well-organised for 10 layers, with real craft in the blurbs and exclusivity rules — but it does not scale to a filter library, and it is a wall of prose on a phone.                                                |
| Presenting modelled/uncertain output        | **D**  | The `Confidence` primitive is built, exported, documented — and used in **zero** places in the app. Bedding renders in the same confident visual grammar as slope. This is the moat, and it is currently invisible. |
| Transient controls vs persistent panels     | **B**  | `ConditionsBar` + anchored `Popover` is genuinely excellent and better than the incumbents. Undermined by one state variable that makes the flagship interaction impossible.                                        |
| Offline download flow                       | **F**  | The download button is `onClick={() => undefined}`. The "Offline ready" chip is a global boolean sampled once at mount and will lie to a user standing on uncached ground.                                          |
| Time to first insight                       | **D+** | A new user is shown a beautiful map that tells them nothing they did not already know. There is no moment where the app _reads the ground for them_.                                                                |
| Field experience (gloved, dark, one-handed) | **C+** | 44 px touch floor, glass material, colour never load-bearing alone — all correct at the token level. Then a fake drag handle, a sheet that hides the conditions bar on mobile, and no night mode.                   |

---

## Findings by question

### 1. Layer management at scale

**What the good ones do.** _Everything in this subsection is_ **[recalled]** —
CalTopo, Gaia and FATMAP were all unreachable. Treat it as a design prompt, not
as evidence. The specific numbers the first pass carried (Gaia's catalogue size)
have been deleted rather than left standing.

The single most transferable idea is the one Gaia GPS gets right and almost
everyone else gets wrong: **separate "what is on" from "what exists".** Gaia's
layer UI is two surfaces — a short, ordered, per-layer-opacity _active stack_ you
can reorder and delete from, and a larger searchable, categorised _catalogue_ you
add from. The active stack stays a handful of items long forever; the catalogue
can grow without the panel becoming a wall, because you only visit it when you
are adding something.

CalTopo takes the opposite bet and it also works, for a different reason. Its
list is dense, flat, and little is hidden behind progressive disclosure — but its
_top-level_ list stays short because layers are **compositional**: one topo entry
with toggleable sub-layers rather than six top-level entries. The lesson is not
"be dense"; it is **density is fine, unpredictability is not**. CalTopo's users
tolerate a wall because the wall never moves and every control is one click deep.

FATMAP goes the third way: a handful of curated _modes_, not a layer list. Right
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

Apply the Gaia split _asymmetrically_: the ten analysis layers stay a curated,
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
one-line _situation phrase_, a description, and a **"Recommendations for
backcountry recreationists"** block:

> Danger level 3 – Considerable · _Critical avalanche situation_ … **The most
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
anything like it. Publishing how often a class is issued _and_ what share of bad
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
<Path
  d={paths[location]}
  stroke={'rgb(81, 85, 88)'}
  strokeWidth={10}
  fill={locations.includes(location) ? 'rgb(200, 202, 206)' : 'transparent'}
/>
```

The shipped explanation is unambiguous — _"The diagram **will be filled with
black where the Avalanche Problem may exist**"_ — and it also documents the ring
order, which is inverted relative to what most people guess:

> You can view the diagram as you would a mountain on a topographic map. The
> **outer ring** represents the **Below Treeline** elevation band, middle ring
> Near Treeline, and the **inner ring Above Treeline**. The diagram is oriented
> like a compass, with the top wedges representing north aspects, the left wedges
> representing west.

EAWS is even more reduced: 8 aspects, **no elevation rings at all**, one flat
blue fill (`#19ABFF`), and only N and S labelled
([`exposition-icon.tsx`](https://github.com/albina-euregio/albina-website/blob/master/app/components/icons/exposition-icon.tsx)).
Elevation is carried by a _separate_ icon with an explicit threshold — "above
2200 m", "treeline", or a band "1800–2400 m" — and danger level by a _third_
icon, a mountain split above/below one elevation line showing at most two levels
(`warn-level-icon.tsx`, `bulletin-danger-rating.tsx`). The EAWS handbook: _"The
blue-marked segments of a wind rose are indicators of those aspects."_

**Why they refuse to shade it.** The rose answers _where_; the scale answers _how
bad_. Colouring 24 cells by magnitude produces a field nobody can read at a
glance and implies the model resolves danger at 24 aspect×elevation combinations,
which it does not. Our bedding model does not resolve at 24 combinations either.

**Two details worth copying exactly.** First, **every cell is stroked, including
the empty ones** — the unselected sectors are drawn as outlines, so the full
24-cell grid is always present. You always see the denominator. That is the
use-vs-availability principle rendered as a graphic, and it costs one line of
code. Second, the elevation band _names_ are a parameter
(`ElevationBandNames` is passed into `AnnotatedDangerRose`), because different
forecast centres use different vocabulary for the same bands.

A bedding rose is still the single best idea in this audit. The encoding is
different from what the first pass proposed. Full spec in recommendation #8.

**(iii) Likelihood and size are separate axes — but distribution is not a third
one.** The first pass said "likelihood is reported separately from consequence",
which is right, and implied distribution is an independent third axis, which is
wrong. NWAC's help text:

> **Likelihood** … _combines_ the spatial distribution of the Problem and the
> sensitivity or ease of triggering an avalanche.

So distribution is folded _into_ likelihood, and _also_ drawn separately on the
rose — deliberately shown twice, once as a component of the ordinal and once as a
map of where. Size is genuinely independent and never multiplied in.

**The uncertainty encoding the first pass missed entirely: the ordinal is
published as a range.** `AvalancheProblemSizeLine` takes `size: number[]` — a
`[from, to]` pair — and `SeverityNumberLine` renders it as a **bar spanning
several labels**, with every covered label bold and the rest greyed:

```ts
// avy/components/SeverityNumberLine.tsx
export interface SeverityNumberLineRange {
  from: number;
  to: number;
}
```

A forecaster who is unsure between "Large" and "Very Large" publishes _both_ and
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
`tendency` (_increasing / steady / decreasing_, "expected trend for the following
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
products. Credit where due. What is missing is the second half: when the _inputs_
are present but the _model cannot discriminate_, we currently draw a flat map and
say nothing.

**The cartographic rule nobody in hunting apps follows, and we should.**
**[recalled]** for the competitor half — I could not reach FATMAP, CalTopo or
Gaia. What I _can_ evidence is the discipline's own separation: EAWS draws the
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

**The rule the good apps converge on.** Stated as sharply as I can. The _rule_ is
my judgement; the **Examples** column is **[recalled]** except where noted, since
Google Maps, Apple Maps, CalTopo and Gaia were unreachable. The bottom-sheet row
is backed by the Material spec read today.

| Surface                       | Use when                                                                                                         | Examples                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Persistent chip / bar**     | The state _changes what the map means_ and the user must never be unsure which state is on.                      | Transit time selectors; avalanche forecast date     |
| **Anchored popover**          | Editing one value, content under ~1 screen, must not move the map or its own trigger.                            | Google Maps layer toggle; CalTopo per-layer opacity |
| **Bottom sheet with detents** | Content the user reads _while looking at the map_; map must stay interactive and pan the target above the sheet. | Apple/Google place cards; Gaia waypoint detail      |
| **Full drawer / modal**       | Irreversible, committing, or long-running; the map is irrelevant to the decision.                                | Offline download commit; delete; share              |

**Ridgeline gets the top two better than the incumbents.** `ConditionsBar` is
the best thing in this UI and I want to be unambiguous about it. Putting wind,
time and thermal phase in permanent chrome — with the doc comment explaining
that these are not settings but the thing that changes what every layer _means_
— is a genuinely original piece of product thinking and it is correct. So is the
`Popover` doc comment at `primitives.tsx:504`, which records why the wind editor
stopped being a drawer: it moved its own trigger and had no spatial relationship
to it. That is the right instinct and the right level of documentation.

**Then one line of state throws it away.**

```ts
type Panel = 'layers' | 'wind' | 'time' | null; // apps/web/src/App.tsx:38
```

Three unrelated surfaces share one slot, so they are mutually exclusive. The
consequence: **you cannot have the layers sheet open and change the wind.** But
the single highest-value interaction this product offers — the thing that makes
a hunter say "nothing else does this" — is _turn on bedding likelihood, then
sweep the wind through the compass and watch which hillsides light up_. Today
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
visual signature of a control that is _supposed to carry_ expand/collapse
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
a mature offline-map app whose whole product is this flow. It is a _named-region_
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
   Map") as a _separate string from the default_ means the sized variant is the
   norm and the unsized one is the fallback when size is unknown.
   It also pre-flights space (`downloader_no_space_title` = "Not enough space",
   `downloader_no_space_message` = "Please delete any unnecessary data") and
   pre-flights the _network_: `download_over_mobile_header` = "Download over a
   cellular network connection?" / "This could be considerably expensive with
   some plans or if roaming." A hunter on a truck hotspot at the trailhead cares
   about that as much as about megabytes.
3. **Detail depth expressed as a consequence, not a z-level.** "Detail down to
   about 1:5,000 — individual trees" beats "max zoom 16". My judgement, not
   sourced; no reference product exposes a zoom ceiling to compare against.
4. **Progress survives backgrounding, and is resumable.** Evidenced: Organic Maps
   ships a dedicated notification channel for the downloader
   (`notification_channel_downloader` = "Map downloader") and an explicit
   `downloader_hide_screen` = "Hide Screen" — you are _invited_ to leave, and the
   download continues under a notification. A 20-minute download killed by a
   phone locking is the classic failure and they designed it out.
5. **Failures are loud, specific and retryable in place.**
   `download_has_failed` = **"Download has failed. Tap to try again."** — the
   error _is_ the retry control. `downloader_status_failed` = "Failed" is a
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
   It matters most for us precisely _because_ our regions are arbitrary boxes:
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
void openTileStore()
  .then((s) => s.stats())
  .then((s) => setOfflineReady(s.tileCount > 0));
```

`offlineReady` is a **global** boolean, sampled **once at mount**, and it drives
a chip in the layers sheet that says _"Offline ready — elevation for this area is
stored on this device. Analysis layers work with no signal."_ The words "this
area" are in the string. The value has nothing to do with the current area. Pan
five hundred miles and it still reads green. Download one tile in Ohio, drive to
Kansas, and the app tells you you are covered.

By the project's own priority order — "anything that leaves a user without a map
in the field: critical always" and "anything confidently wrong is worse than
missing" — this is the highest-priority item in this audit. It must become a
per-viewport coverage query, and it should be paired with the map-level coverage
overlay from (7) so the answer is spatial rather than binary.

**The thing to say out loud in this flow.** **[recalled]** — Gaia and onX both
make you choose _which layers_ to download, because they cache rendered tiles.
The architectural contrast is real regardless of their exact current UI: any
product that caches _rendered_ tiles must ask which ones, and any product that
caches elevation does not. Ridgeline caches
elevation, so there is no such step — one download unlocks every layer, any
wind, any date. That is a structurally better flow _and_ the clearest possible
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
>   south-east-facing points off the main ridge. _Field doctrine — the slope
>   preference behind this is an assumption. Why?_
> - Only 6% of this property is over 30°. This is gentle ground; corridor
>   analysis will be weaker here than in hill country.

Each line taps to fly there and turn on the relevant layer. That is the moment a
hunter decides this is a different kind of product. Time to first insight goes
from "learn the layer taxonomy" to one tap, and every claim carries its evidence
grade, which turns the honesty policy from a constraint into the demo.

It also gracefully handles the honest negative — _"this ground is too flat for
the bedding model to say much"_ — which no competitor will ever tell you and
which is worth more trust than ten confident hotspots.

---

## Prioritised recommendations

Ranked by "would a serious hunter switch to this and never go back". Items 1–3
are the ones that decide it.

| #       | Recommendation                                                  | Size   | Owner                                                 | Why it ranks here                                                                                                                                                                                                                                  |
| ------- | --------------------------------------------------------------- | ------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | Per-viewport offline coverage truth                             | S–M    | `offline-steward`                                     | The app currently lies about the one thing it cannot lie about                                                                                                                                                                                     |
| 2       | Deploy `Confidence` + separate fact from judgement cartography  | M      | `frontend-builder` + `map-builder` + `game-biologist` | The moat is a markdown file; make it visible                                                                                                                                                                                                       |
| **2b**  | **Scale-of-validity + base-rate line on every judgement layer** | **XS** | `frontend-builder`                                    | **New this pass.** Two sentences. Directly lifted from EAWS's ">100 km², not a specific individual slope" and its per-level base rates. Best value-per-hour in this audit; ship it inside #2                                                       |
| 3       | "Read this ground" first-run analysis                           | M–L    | `map-builder` + `frontend-builder`                    | Time to first insight goes to one tap; nobody else can build it                                                                                                                                                                                    |
| 4       | Offline region picker (`R4`) with coverage overlay              | M      | `offline-steward`                                     | Headline feature with no front door                                                                                                                                                                                                                |
| 5       | Uncouple wind/time from the layers sheet                        | S      | `frontend-builder`                                    | One line of state blocks the flagship interaction                                                                                                                                                                                                  |
| 6       | Legends for every continuous ramp                               | S      | `map-builder`                                         | Four ramps ship with no key at all                                                                                                                                                                                                                 |
| 7       | Band the bedding output; kill the continuous ramp               | S–M    | `terrain-scientist` + `map-builder`                   | A smooth ramp over three Assumed constants is a precision claim we cannot support                                                                                                                                                                  |
| 8       | Bedding rose for the current wind                               | M      | `map-builder` + `terrain-scientist`                   | Answers "where do I hang a stand on a NW wind" in one glance                                                                                                                                                                                       |
| 9       | Delete the fake grip now; detents next                          | S / M  | `frontend-builder`                                    | A dead affordance in the first ten seconds                                                                                                                                                                                                         |
| 10      | Collapse blurbs; group accordions; active-stack summary         | S      | `frontend-builder`                                    | Bedding is three phone-screens deep                                                                                                                                                                                                                |
| 11      | Terrain readout as a peek sheet with a map marker               | S–M    | `map-builder`                                         | Wrong surface; also `R6`                                                                                                                                                                                                                           |
| 12      | Staleness/validity marking on modelled output                   | S      | `frontend-builder`                                    | Borrowed straight from forecast expiry                                                                                                                                                                                                             |
| **12b** | **Bedding _trend_ — increasing / steady / decreasing**          | **S**  | `terrain-scientist` + `frontend-builder`              | **New this pass.** Both reference products ship a forward-looking trend beside the current value (`DangerTrend` in the NAC schema, `tendency` in EAWS). Our thermal model already has the inputs; no hunting app can say "this is about to switch" |
| 13      | Saved-filter search, favourites, recently-used                  | M      | `frontend-builder`                                    | Only after `R2` — build creation first                                                                                                                                                                                                             |
| 14      | Night mode / red-light theme                                    | S–M    | `frontend-builder`                                    | 05:30 in the dark is the actual use case                                                                                                                                                                                                           |

### 1 — Per-viewport offline coverage truth · S–M · `offline-steward`

Replace the mount-time global boolean with a coverage query for the current
viewport at the current zoom, recomputed on `moveend` (debounced). Three states,
not two: **Covered** / **Partial — _n_% of this view** / **Not downloaded**. Add
a map-level overlay drawing the covered extent as a hatched region so the answer
is spatial, and reachable without opening any panel. Fix the chip's tooltip
string, which currently promises something the value does not mean.

_Done when:_ pan from a covered area to an uncovered one with the sheet open and
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

- **Validity.** _"Summarises the current view (≈1.4 km²) at 10 m resolution. Not
  a per-slope prediction — check it on the ground."_ Direct lift of EAWS's _"The
  danger level always applies to a region with an area of >100 km² and not to a
  specific individual slope … It should always be checked on site."_
- **Base rate.** _"Prime covers 4 % of this ground."_ Direct lift of EAWS
  publishing how often each danger level is issued and what share of fatalities
  it accounts for. It is also already a by-product of the availability
  distribution we compute for selection analytics, so the number is nearly free.

_Done when:_ no judgement layer can be rendered without both lines present.

### 3 — "Read this ground" · M–L · `map-builder` + `frontend-builder`

One rail button, or the empty state of a fresh property. Runs the standing
battery over the viewport/boundary on-device and emits five to eight plain-
English findings with counts, each tapping to fly-to and enable the relevant
layer, each carrying its evidence grade. Must include honest negatives.

_Dependency, and the reason this is M–L not M:_ the engine produces rasters;
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

_Done when:_ bedding is on, the layers sheet is open with its legend visible,
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
add NAPADS's own warning against arithmetic on ordinals — _"the danger increases
exponentially between levels"_ — in whatever form suits us. If we number the
bedding classes 1–4, someone will average them.

### 8 — Bedding rose · M · `map-builder` + `terrain-scientist`

Rewritten after reading the two reference implementations. **The first pass's
encoding was wrong** — it proposed wedges shaded by continuous modelled
likelihood, and neither NWAC nor EAWS shades a rose by magnitude (§2(ii)). This
is the buildable spec.

**Purpose.** One glance, one question: _on today's wind, which faces should I be
looking at — and is that actually different from the ground I have?_

**Geometry**

- **8 aspect octants**, N at top, E at right, W at left. Matches both reference
  products and the compass. `aspectOctant()` in
  `packages/terrain/src/analysis/surface.ts` already returns exactly
  `N/NE/E/SE/S/SW/W/NW` plus `'flat'`, so the binning is free.
- **3 concentric rings = slope bands**, not elevation. Whitetail bedding is not
  an elevation-banded problem. Suggested bands `<12°` / `12–25°` / `>25°`, which
  puts the vision document's own example filter ("12–25°") on the middle ring.
- **Ring order must be argued, not copied.** NWAC puts the _highest_ elevation
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

- **No continuous ramp.** Cell state is one of four: _unmarked_, _possible_,
  _likely_, _prime_ — the same banding as recommendation #7, so the rose and the
  map speak one language.
- **Fill pattern carries the class, not hue alone** (design-system rule: colour
  is never load-bearing alone). Unmarked = outline only. Possible = light
  stipple. Likely = solid at ~45 % tone. Prime = solid at full tone. **Three
  fills is the ceiling** at ~16 px per cell; do not add a fourth.
- **What a cell's value means, and this is the load-bearing decision: the share
  of _that cell's own area_ that meets the bedding threshold — not the cell's
  share of all prime area.** If 40 % of the property faces SE, an unnormalised
  rose lights up SE for no reason except that there is more SE. That is precisely
  the sightings-by-slope-band error CLAUDE.md forbids, drawn as a flower. The
  legend must say which one it is: _"% of this face that qualifies."_
- **Wind arrow drawn outside the ring, on the perimeter**, never through the
  centre (an arrow through the middle reads as an aspect selection). Label it
  with the _from_ bearing in words — "Wind from NW" — because EAWS found it
  necessary to state the convention explicitly in its own glossary
  (_"Wind direction indicates the direction the wind originates or comes from"_),
  and getting this backwards inverts the entire product.

**Legend and text — four channels, matching the danger scale's practice**

1. The rose (_where_).
2. An ordinal headline naming the best class present: _"Prime bedding on SE and S
   faces, 12–25°."_
3. **A decision sentence** — the hunting analogue of "Recommendations for
   backcountry recreationists", which is the most valuable line on any avalanche
   product. _"Approach from the NW; those faces are downwind of your entry."_
   Without this the rose is a diagram; with it, it is an answer.
4. A **base-rate line**, lifted from EAWS publishing how often each danger level
   is issued: _"Prime covers 4 % of this ground."_ A hunter who knows the class
   is rare treats it differently from one who does not.
5. A `Confidence` chip at the **weakest input grade** — for bedding that is 🔴
   **Assumption** (`idealSlopeDeg: 22`), tappable to the evidence note.
6. A **scale-of-validity line**, the direct lift of EAWS's ">100 km², not a
   specific individual slope": _"Summarises the current view (≈1.4 km²) at 10 m
   resolution. Not a per-slope prediction — check it on the ground."_ Cheapest
   high-value sentence in this entire audit.

**How it degrades — four distinct cases, all with precedent**

| Case                                                         | Behaviour                                                                                                                                                                                                                                                                                                                       | Precedent                                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Wind unset**                                               | Do not draw filled cells. Draw the empty 24-cell outline with _"Set today's wind to see bedding by aspect."_                                                                                                                                                                                                                    | Our own `blockedReason`, which is already right                                                                                           |
| **Ground cannot discriminate** (e.g. <10 % of view over 12°) | **Remove the rose entirely.** Replace with words: _"This ground is too gentle for the bedding model to separate faces. Nothing here is prime."_ Never draw 24 empty cells and let the user infer.                                                                                                                               | EAWS: _"If no particular avalanche problem predominates … this information is omitted and a favourable avalanche situation is declared."_ |
| **Class not resolvable to one level**                        | Publish a **range**, never round up. Headline reads _"possible–likely"_; the cell renders at the **lower** fill with a hatched outer edge.                                                                                                                                                                                      | `SeverityNumberLine`'s `{from, to}`: NWAC forecasters publish avalanche size as a span across ordinal cells                               |
| **Too little of that face in view**                          | Distinct third state: outline with a centre dot = _"too little of this face here to say"_. Must not read as _"none"_. Confusing "no prime ground" with "no ground" is the classic error; `selectionRatioInterval()` in `packages/shared/src/analytics/selection.ts` already gives the interval machinery to pick the threshold. | The stroked-empty-cell convention in `DangerRose.tsx`, extended                                                                           |

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
that sweeping the wind through the compass reads as a _comparison_, not a movie.

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
same three words, and put it beside the class. _"Prime on SE faces — decreasing;
the thermal switches in about 40 minutes"_ is a sentence no hunting app on the
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

**Sourcing:** this whole section describes _competitor_ behaviour and is therefore
**[recalled]** except where it cites our own repo. That is a weaker basis for
"build this" than for "do not build this" — a decision not to build survives being
wrong about a competitor's current UI. Where a claim rests on a fact about the
world rather than about a product, it is flagged inline.

**onX's and HuntStand's deer-movement forecast meters.** Solunar/lunar-derived
activity dials. `docs/VISION.md` and `docs/EVIDENCE.md` already rule this out on
the evidence — the register records moon-phase non-effect as a **measured
negative result** and acts on it by exclusion. Worth restating here as a
_product_ judgement, not just a scientific one: the meter is the most-used
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
an inside corner of a field edge — read _better_ on multi-directional hillshade
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
_always_ low density, which is the whole point. (The first pass cited a specific
Strava incident as the canonical example. **Unverifiable from here, so the
citation is withdrawn**; the argument does not need it and is stronger without a
fact I cannot check.) Never build it, and say so in `VISION.md` alongside the
lunar predictor.

**Komoot-style auto-routing as the primary route interaction.** Our corridor
solver models **deer** movement. Komoot's grammar — a line with a start pin, an
end pin, and an elevation profile — reads unambiguously as "the route _you_
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
