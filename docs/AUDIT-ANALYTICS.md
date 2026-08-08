# Analytics audit — statistical honesty

Owner: `analytics-auditor`. Findings only; no application code is changed here.
Each finding names the file:line, the failure a hunter would experience, and a
concrete fix with an owner.

---

## Pass 1 — 2026-08-08 — live match share (saved-filter editor)

**Scope.** The one user-facing number in the new filter editor: *"N% of the
view"*. Traced from `MatchShare.tsx` through `useLiveMatchShare.ts`,
`predicateUtils.ts`, `POST /terrain/filters/evaluate`, `TerrainService.evaluateArea`,
`evaluateFilter`, and into the field producers (`computeSurface`, `classifyWeiss`,
`classifyWood`, `detectBenches`) and the DEM assembly (`gridForBBox`, `fillVoids`).
Also checked the adjacent availability statistic (`TerrainProfile`) because that
is the number this one will eventually be read next to.

**Verdict.** The gating logic in the hook is sound and the wording is unusually
careful — this is not a chart with a `GROUP BY` and no denominator. But the
`R56` refusal is drawn around the *syntax* `not` rather than around the
*property* "this predicate can match a cell the engine never measured", and
there are two other predicates reachable from the editor's own controls that
have that property. The statistic also silently changes meaning with the zoom
level, and its denominator disagrees with the denominator of every other
availability figure in the product.

Ship-blocking: **F1, F2**. Everything else is queued work.

---

### F1 — HIGH — "Not on a bench" is a negation the `R56` guard does not recognise; unmeasured ground counts as a match

- `packages/terrain/src/analysis/landform.ts:707` — `detectBenches` does
  `if (!Number.isFinite(s) || s > maxBench) continue;`, leaving `flag[i] = 0`.
  An unmeasurable cell and a measured non-bench cell are the same value.
- `packages/terrain/src/filters/terrainFilter.ts:212-216` — the bench branch
  returns `(arr[i] === 1) === predicate.isBench`, so `isBench: false` returns
  `true` on every void cell.
- `apps/web/src/components/filters/PredicateLeafEditors.tsx:252-259` — the
  **"Not on a bench"** button produces exactly that predicate. It is one of two
  buttons in the bench control, not an obscure path.
- `apps/web/src/components/filters/predicateUtils.ts:85-91` — `containsNegation`
  returns `false` for it, so `useLiveMatchShare.ts:88` does not refuse, and
  `MatchShare.tsx:79-97` renders a confident percentage.

**What the hunter gets.** A filter of "not on a bench" — alone, or as an operand
of an `any` group — over a viewport that reaches the edge of DEM coverage. Every
cell the engine could not measure is counted as a match, in the percentage *and*
in the map layer painted from the same predicate. The share is inflated by
exactly the ground nobody knows anything about, and the `R56` callout that would
have warned them (`PredicateNode.tsx:148-165`) does not fire, because there is
no `not` node in the tree. This is the failure `R56` exists to prevent, arriving
through the door the guard does not watch.

Note that a conjunction usually rescues it: `all: [slope 12–25, not-a-bench]`
excludes voids because the slope clause abstains. The exposure is bench-false
alone, or under `any`, or with only other void-tolerant clauses.

**Fix.** Replace `containsNegation` with `mayMatchVoid(predicate)`, returning
true for `not`, for `{kind:'bench', isBench:false}` and for F2's case, and use
it at both `useLiveMatchShare.ts:88` and `PredicateNode.tsx:148`. The durable
fix is in the engine: give `detectBenches` a third value (`2 = not measurable`,
set wherever `Number.isFinite(surface.slope[i])` is false) so the filter can
tell "we looked, no bench" from "we did not look" — the same correction
`WoodFeature.Unknown = 6` already made for Wood.
Owners: `frontend-builder` (gate), `terrain-scientist` (sentinel).

---

### F2 — HIGH — "Also match flat ground" matches unmeasured ground, against an explicit documented contract

- `packages/terrain/src/analysis/surface.ts:144` — an unmeasurable cell gets
  `aspect[i] = -1`, the **same value** as a genuinely flat cell.
- `packages/terrain/src/analysis/surface.ts:80-86` states the contract in
  terms: `-1` "deliberately covers **two** cases — a genuinely flat cell, and a
  cell whose window was not measurable... Distinguishing the two is `slope`'s
  job... **Never branch on `aspect` alone to decide whether a cell was
  measured.**"
- `packages/terrain/src/filters/terrainFilter.ts:193-201` branches on `aspect`
  alone: `if (a < 0 || !Number.isFinite(a)) return predicate.includeFlat === true;`
  It never reads `fields.slope`. So `includeFlat: true` matches every void cell.
- `apps/web/src/components/filters/PredicateLeafEditors.tsx:142-149` exposes it
  as a checkbox labelled *"Also match flat ground (no measurable downslope
  direction)"* — a label that describes both cases, so the user has no way to
  know they just opted into unmeasured ground.
- `containsNegation` does not see it; the share is computed and displayed.

**What the hunter gets.** Ticks a reasonable-sounding box on an aspect filter
and the percentage jumps, because the DEM gap on the north side of the view is
now "flat ground". Worse than F1 because the copy actively tells them this is
the correct box for flat ground.

**Fix.** `evaluateAt`'s aspect branch must consult `fields.slope`:
`aspect < 0 && Number.isFinite(slope)` is flat and honours `includeFlat`;
`aspect < 0 && !Number.isFinite(slope)` is unmeasured and returns `false`
regardless. `requiredMetrics` must then add `slope` for any `aspect` predicate
so the field is present. Until that lands, gate `includeFlat: true` in
`mayMatchVoid` per F1. Owner: `terrain-scientist`; needs a regression test on a
synthetic grid with a NODATA block.

---

### F3 — MEDIUM-HIGH — the denominator includes voids, the response never says how many, and the void count is not reproducible

- `apps/api/src/terrain/terrain.service.ts:162-166` returns
  `matchShare: matchFraction(mask)` and `cellCount: mask.length` — every cell in
  the extent, measured or not.
- `apps/api/src/terrain/dem.service.ts:286-300` — each upstream tile fetch ends
  `.catch(() => undefined)`. A transient failure degrades that tile to NODATA
  silently. `dem.service.ts:324` then `fillVoids()`, which fabricates elevation
  ~8 cells into every hole (`packages/terrain/src/dem/grid.ts:157-188`) —
  those cells are neither measured nor excluded; they are *invented* and can
  match.
- `apps/web/src/components/filters/MatchShare.tsx:91-92` states the choice
  ("Cells with no elevation data count as non-matches in this figure, not as
  measured ground") and reports the **total** cell count — but never the
  unmeasured count, which is the only number that makes the caveat actionable.

**What the hunter gets.** Two problems. (a) They cannot distinguish "12% of
fully-mapped ground" from "12% of ground that is 40% void" — the second is not
12% of anything they can walk. (b) The number is not reproducible: the same
filter over the same viewport can return a different percentage a minute later
because one upstream tile 404'd, and nothing anywhere says so. A statistic that
changes when nothing the user did changed is worse than a coverage-dependent
constant, because they will attribute the change to their own edit.

The brief asks whether a measured-cells-only share would be more honest. **Yes,
and the repo already agrees with itself on this:**
`apps/api/src/analytics/analytics.module.ts:278-289` (`shareOf`) excludes
non-finite cells from `total`. Two availability statistics from the same engine
currently use two different denominators.

**Fix.** In `evaluateArea`, run a second pass with a validity predicate — "every
metric in `requiredMetrics(predicate)` is finite at this cell" — and return
`measuredCellCount` alongside `cellCount`. Cost is one extra pass of the same
shape as `evaluateFilter`, negligible against `analyze`. Report the
measured-only share as the headline and the coverage as context:
*"12% of measured ground — 6% of the view could not be measured."* Note the
definition must be per-predicate, not `grid.hasData`, because the quorum guards
(`TPI_MIN_DATA_FRACTION`, VRM, the bench ring) abstain on cells that *do* have
elevation. Owner: `backend-builder` + `terrain-scientist`.

Sub-item, low: `apps/web/src/lib/api/types.ts:528-532` declares
`EvaluateFilterResult` with an `[key: string]: unknown` index signature and no
`cellCount`, so `useLiveMatchShare.ts:116` casts and defaults to `0`. If the
server field is ever renamed the UI renders "0 cells total" next to a live
percentage with no type error. Type the DTO properly.

---

### F4 — MEDIUM-HIGH — the share is resolution-dependent, and the resolution is neither pinned nor shown

- `apps/web/src/components/filters/useLiveMatchShare.ts:103` —
  `Math.min(16, Math.max(8, Math.round(viewport.zoom)))`. Cell size varies by
  ~256× in area across z8–z16.
- The predicate's meaning moves with it. `packages/terrain/src/pipeline.ts:180,183`
  set TPI radii of 3 and 20 **cells**; `packages/terrain/src/analysis/landform.ts:728`
  sets the bench ring at 8 **cells**; Wood's curvature tolerance is derived from
  `cellSize`. "Midslope ridge" and "bench" are different physical features at
  z11 and z15.
- `apps/web/src/components/filters/MatchShare.tsx:88-90` mentions zoom **only
  when it had to clamp**. Inside 8–16 the number changes with the scroll wheel
  and the caption is silent.
- `terrain.service.ts:165` already returns `cellSizeM`. The hook discards it
  (`useLiveMatchShare.ts:114-124`).

**What the hunter gets.** Scrolls out one notch to see more of the property, and
"14%" becomes "9%". Nothing tells them the question changed. They conclude the
filter is unstable, or worse, they trust whichever number they saw first.

**Fix.** Pin evaluation to a fixed zoom. **z13** is the right choice because it
is what `TerrainProfile` uses (`analytics.module.ts:64`), which puts the two
availability figures on one footing. The extent stays the viewport; only the
resolution is pinned. Then print the cell size unconditionally: *"12% of the
view, measured on 9 m cells."* If a variable zoom is retained instead, the
caption must state the zoom every time, not only on clamp. Owner:
`frontend-builder`, with `terrain-scientist` confirming z13 is adequate for
bench/saddle detection at typical property scale.

---

### F5 — MEDIUM — `TerrainProfile`, the availability denominator the whole selection stack rests on, is the property's bounding box, not its boundary

Outside the match-share feature, found while checking what this number will be
compared against. It is the denominator named in `CLAUDE.md` non-negotiable #5.

- `apps/api/src/analytics/analytics.module.ts:75-88` —
  `const bbox = await this.geometry.boundsOf(boundary);` then
  `gridForBBox(bbox, ...)` and `shareOf(...)`. No polygon clip anywhere.
- `apps/api/src/prisma/geometry.service.ts:71-85` — `boundsOf` is
  `ST_XMin/ST_YMin/ST_XMax/ST_YMax`. A rectangle.
- `analytics.module.ts:71-73` refuses without a boundary, saying
  "Availability-corrected analytics need one" — then uses only its envelope.

**What the hunter gets.** On a compact, roughly square property, nothing. On an
L-shaped parcel, a riverfront strip, or anything long on the diagonal, the
availability distribution includes a large area of ground they do not own and
have never hunted. Every Manly ratio in `packages/shared/src/analytics/selection.ts`
is then biased — toward *under*-selection of whatever terrain is
over-represented outside the boundary. The chi-square is computed against a
denominator describing the neighbour's ground. This is the exact error the
non-negotiable was written to prevent, one level up from the histogram.

**Fix.** Rasterise the boundary ring into a cell mask in grid coordinates
(scanline fill, ~50 lines, pure, no PostGIS round-trip per cell) and pass it to
`shareOf` and to the bench count. Add a regression test on an L-shaped polygon
where the bbox share and the polygon share provably differ. Owners:
`backend-builder` + `terrain-scientist`; `analytics-auditor` signs off.

---

### F6 — MEDIUM — three incompatible denominators for the same kind of quantity; the false comparison is not live yet, but nothing prevents it

The brief asks whether the match share is a *use* or an *availability*
statistic. It is availability — the property's own terrain distribution — which
is legitimate and needs no selection ratio. **That part is correct.** No screen
currently places it next to a use statistic: `PropertyDetailScreen.tsx` renders
no selection analytics (only a reference at line 129). So there is no live
defect. But the trap is set:

| number | extent | resolution | voids |
| --- | --- | --- | --- |
| filter match share | map viewport rectangle | `round(zoom)`, 8–16 | **included** as non-matches |
| `TerrainProfile.slopeShares` / `aspectShares` / `landformShares` | property **bounding box** (F5) | fixed z13 | **excluded** (`shareOf`) |
| `TerrainProfile.benchShare` | property bounding box | fixed z13 | **included** (F7) |

The moment a movement-analytics screen prints "62% of your sightings were on
benches" anywhere near "benches are 8% of this property" or a filter's "12% of
the view", a user will do the division in their head and arrive at a selection
ratio nobody computed, with no confidence interval and no expected-count check —
`analyzeSelection`'s entire discipline bypassed by page layout.

**Fix.** Two parts. (1) Reconcile the denominators — F3, F4, F5 together do
this. (2) Establish a UI rule: a use figure and an availability figure may only
appear in the same view via `analyzeSelection`, with its interval and its
`significant` field rendered. Anything else keeps them on separate screens.
Record it in `docs/ARCHITECTURE.md`. Owner: `frontend-builder`; enforced by this
audit on every subsequent pass.

---

### F7 — LOW — `benchShare` uses a different denominator from its three siblings in the same DTO

`apps/api/src/analytics/analytics.module.ts:116` and `:129` —
`benchCount / result.bench!.length` counts every cell, including unmeasurable
ones, as "not a bench". This is F1's conflation again, and it disagrees with
`slopeShares`/`aspectShares`/`landformShares` computed twelve lines above via
`shareOf`, which exclude them. Understates bench availability wherever the
property's bounding box overhangs DEM coverage — which, per F5, is exactly where
the bounding box adds area. Fix alongside F1's bench sentinel.

---

### F8 — LOW — precision theatre in the sub-1% branch

`apps/web/src/components/filters/MatchShare.tsx:80` —
`toFixed(matchShare < 0.01 ? 2 : 1)`. The two-decimal branch is the least
defensible one: below 1% the figure is dominated by precisely the cells whose
status is least certain — the ~8-cell ring of fabricated elevation `fillVoids`
diffuses into every hole (`grid.ts:157-188`) and the abstention bands of the
quorum guards. "0.35% of the view" claims a resolution the method does not have.
The one-decimal branch above 1% is defensible on sampling grounds (a z13
viewport is 10⁵–10⁶ cells) but not until F4 is fixed, because that decimal
currently moves with the zoom.

**Fix.** Below 1%, render `<1%` or one significant figure. Above 1%, whole
percent until F3/F4 land. Owner: `frontend-builder`.

---

### F9 — LOW — the `R56` copy blames the user's downloads for a server-side data gap

`apps/web/src/components/filters/PredicateNode.tsx:158-162` ("the edge of your
downloaded ground", "terrain you have not downloaded") and
`apps/web/src/components/filters/MatchShare.tsx:27-29`.

This evaluation runs server-side (`terrain.controller.ts:216-238`). Its voids
come from upstream DEM coverage and from the swallowed per-tile fetch failure at
`dem.service.ts:300` — not from the user's offline region downloads. A hunter
reading this concludes "download more tiles and the number will be right", which
is not the remedy and costs them twenty minutes on a tile download that changes
nothing. Reword to "ground the elevation data does not cover".

---

### F10 — LOW — test gap that would have caught F1 and F2

`apps/web/src/components/filters/useLiveMatchShare.test.tsx:76-88` covers a
top-level `not` only. Nesting is covered separately and correctly at
`apps/web/src/components/filters/predicateUtils.test.ts:30-42`, so the guard
itself is proven. What is missing is a test asserting that *any predicate which
can match an unmeasured cell* is refused — bench-false and `includeFlat: true`
are the two cases. That test fails today, which is the point of writing it.

---

## What survived scrutiny

Recorded because a clean result is a result, and because several of these are
better than the surrounding codebase.

- **`containsNegation` is airtight for `not` nodes.** `predicateUtils.ts:85-91`
  walks the whole AST — `not` short-circuits true, `all`/`any` recurse, and no
  other predicate kind has children, so there is nothing to miss. Nested
  negation is tested (`predicateUtils.test.ts:30-42`). The brief's specific
  worry about nesting is unfounded. F1/F2 are a different failure: the guard is
  complete for what it looks for, and looks for the wrong thing.
- **The refusals genuinely refuse.** All four gates run before the debounce
  timer is created (`useLiveMatchShare.ts:84-100`), and the tests assert
  `evaluate` was never called, not merely that a message rendered
  (`useLiveMatchShare.test.tsx:63-110`). Showing nothing rather than a bad
  number is implemented as claimed.
- **Stale-response discard is correct**, including the subtle case: the request
  id is incremented at the top of the effect (`useLiveMatchShare.ts:82`), so an
  in-flight response is invalidated even when the newer edit produces a
  *refusal* state rather than a new request. A weaker implementation would let a
  superseded number land on top of a negation warning.
- **Offline is distinguished from a server error** (`:128-135`), and the offline
  copy's claim that map rendering still works offline is **true** — filter
  layers render through `lib/map/terrainProtocol.ts:144` into
  `workers/terrain.worker.ts:162`, on-device. Verified, not taken on trust.
- **Scoping to "the view on screen" rather than "your property"** is the right
  call and is stated in the caption. It is more honest than `TerrainProfile`,
  which claims the property and delivers its envelope (F5).
- **`WeissLandform.Unknown` and `WoodFeature.Unknown` are deliberately excluded
  from the pickers** (`landformOptions.ts:1-17`), with a doc comment naming this
  exact defect class. The author had the right instinct and applied it in two
  of four places; F1 and F2 are the other two.
- **The `advice` copy is honest** (`terrain.controller.ts:231-236`): a filter
  matching a third of the ground is told it has not narrowed anything down,
  rather than being dressed up as a finding.
- **The engine's abstention discipline is genuinely strong** and is what makes
  the "voids are non-matches" claim true for most predicates: slope and
  curvature return `NaN` (`surface.ts:143, 206-211`), TPI abstains on quorum and
  centroid offset (`landform.ts:306, 323, 343`), Weiss returns `Unknown` with a
  comment about the invented canyon band it once produced (`landform.ts:482-485`),
  Wood returns `Unknown = 6` rather than `Planar` (`landform.ts:631-634`).
  F1/F2 are the two arrays that did not get a third state.
- **`analyzeSelection` was spot-checked and is conservative** — reports
  intervals, refuses `significant` on thin expected counts
  (`packages/shared/src/analytics/selection.ts:25, 90-175`). Not re-audited this
  pass; no change since it was written.
- No `eval` surface; the predicate is validated on both sides
  (`terrainFilter.ts:253-286`, `predicateUtils.ts:171-173`).

## Priority queue

1. **F1**, **F2** — ship blockers. `R56` is live through two editor controls the
   guard does not cover.
2. **F3**, **F4** — the number's denominator and resolution. Fix together; both
   change the caption.
3. **F5** — the availability denominator for the whole selection stack.
4. **F6** — the layout rule, once 3–5 land.
5. **F7**, **F8**, **F9**, **F10** — copy, precision, consistency, tests.
