# Analytics audit — statistical honesty

Owner: `analytics-auditor`. Findings only; no application code is changed here.
Each finding names the file:line, the failure a hunter would experience, and a
concrete fix with an owner.

**Latest pass: Pass 2 — 2026-08-12**, branch `claude/project-goal-clarification-qkyana`,
at `b8d8f6e`. Pass 1 (2026-08-08) is preserved below as a status table only —
every row is marked SHIPPED, SUPERSEDED or STILL LIVE against current `main`.

---

## Pass 2 — 2026-08-12 — the whole stack: every number a user can reach

**Scope.** Both sides, as briefed. API: `AnalyticsService.terrainProfile` and
`.movement`, `TerrainService.evaluateArea`/`.samplePoint`,
`ObservationsService.stampTerrain`, `PropertiesService.list`/`.get`. Shared:
`analyzeSelection`, `describeSelection`, `selectionRatioInterval`,
`bucketRelativeToSolar`, `pressureTrendLabel`, `sightingsPerSit`, `rut.ts`.
Web: `MatchShare`, `useLiveMatchShare`, `TerrainReadout`, `LayersSheet`,
`EvidenceLegend`, `PropertyDetailScreen`, `PropertiesListScreen`,
`BlankSitQuickLog`, `ObservationForm`/`List`, `layers.ts`, `moonPhase.ts`.

**Verdict.** `R70` is genuinely fixed and pinned by a falsifiable test — that is
a real result and the largest single correction this product has made to its own
denominator. But the pass found something worse than the bug `R70` closed: the
availability side is now clean and the **use** side is not. Observations are
stamped on a different grid than the availability distribution is computed on,
flat ground is silently binned as north-facing, and unclassifiable ground is a
landform category that `describeSelection` will name out loud as a preference.

The failure mode has moved. Pass 1 found a denominator that measured the wrong
ground. Pass 2 finds numerators that measure the wrong thing, and an effort
denominator that is not one.

Ship-blocking before any movement-analytics screen exists: **A1, A2, A3, A4**.
None of these is on screen today (no web surface consumes
`useMovementAnalytics` — verified by grep across `apps/web/src`), which is the
only reason they are not P0-with-a-user-attached. They are all reachable from
`GET /analytics/movement` right now.

---

### A1 — CRITICAL — flat ground is counted as **north-facing** in every aspect selection ratio

CONFIRMED, reproduced.

The chain, four files, each individually defensible:

- `packages/terrain/src/analysis/surface.ts:144` — a flat cell gets
  `aspect = -1`. Documented, correct, and the contract at `:80-86` says so.
- `apps/api/src/terrain/terrain.service.ts:212` — `samplePoint` returns
  `aspectDeg: result.aspect?.[i]` **raw**. It does not translate `-1`.
- `apps/api/src/observations/observations.module.ts:276` — `stampTerrain` writes
  `aspectDeg: finite(s.aspectDeg)`. `-1` is finite, so `-1` is persisted as the
  observation's aspect.
- `apps/api/src/analytics/analytics.module.ts:233-236` — `movement` feeds
  `r.aspectDeg ?? NaN` into `analyzeSelection` with `ASPECT_OCTANTS`.
- `packages/shared/src/analytics/selection.ts:58-69` — `binIndex` on the
  wrapping north bin evaluates `value >= 337.5 || value < 22.5`. **`-1 < 22.5`
  is true.** Flat ground lands in bin 0, `N`.

Verified directly: `binIndex(ASPECT_OCTANTS, -1) === 0`, and
`ASPECT_OCTANTS[0].label === 'N'`.

The asymmetry is what makes it a defect rather than noise.
`analytics.module.ts:104` builds the _availability_ side as
`(v) => (v < 0 ? -1 : bandIndex(ASPECT_OCTANTS, v))`, so flat cells are
**correctly excluded from the denominator**. Flat observations therefore enter
the numerator as north, while flat area never enters the north denominator.

**What the hunter gets.** Every sighting on a food plot, a field edge, a valley
floor, a bench top, a logging deck — the places deer are most often _seen_ — is
recorded as north-facing. The north bin's used-count inflates, its area share
does not, and the Manly ratio for north rises without bound as the property gets
flatter. The app then tells the hunter, with a chi-square behind it, that their
deer select north-facing slopes. That is the single most doctrinally-loaded
claim in whitetail hunting, and the software would be manufacturing it out of
level ground. A hunter acts on that: they move a stand to the north side of the
ridge. Worse than a missing feature, because it agrees with what they already
half-believe.

Note the same repo gets this right on the client path:
`apps/web/src/lib/map/pointQuery.ts:17-23, 53-64` carries a three-state
`Reading<T>` specifically so `'flat'` never collapses into a number, and
`TerrainReadout.tsx:293` renders `Flat`. Two conventions, one codebase, and the
server-side one is the one that feeds the statistics.

**Fix.** Three defensible options; pick one and write it down.
(1) Preferred — `samplePoint` returns `aspectDeg: undefined` when
`aspect < 0 && Number.isFinite(slope)` is _flat_, and adds a separate
`isFlat: boolean` column so flat is recorded as the real finding it is;
`movement` then bins flat observations into a `Flat` bin whose availability is
the `aspect === -1` share currently discarded at `analytics.module.ts:104`.
(2) Cheapest correct — clamp at the stamp: store `null` for `aspectDeg` when the
sample is `-1`, so flat observations drop out of the aspect analysis entirely
(matching the availability side's treatment). Loses information, but is honest.
(3) Do **not** "fix" this in `binIndex` — the wrap logic is right and other
callers depend on it.
Regression test: an observation stamped `aspectDeg: -1` must not appear in the
`N` bin. Owners: `backend-builder` (stamp), `schema-architect` (the `isFlat`
column if option 1).

---

### A2 — CRITICAL — `Unknown` is a landform bin, and the plain-language readout will name it as a preference

CONFIRMED, reproduced end to end.

- `packages/terrain/src/analysis/landform.ts:409-410` — `WeissLandform.Unknown = 0`.
  It is the _first_ enum value, so it is index 0 of any array keyed by class.
- `apps/api/src/analytics/analytics.module.ts:107` —
  `shareOf(result.weiss!, 11, (v) => v, mask)`. `weiss` is a `Uint8Array`, so
  `Number.isFinite(v)` is **always true** and the `Unknown` cells are counted
  into `total`. Unmeasurable ground becomes a landform class with an area share.
- `analytics.module.ts:238-249` — `landformBins` is built by mapping over those
  11 shares, so bin 0 is labelled `WEISS_LABELS[0]` = **`'Unknown'`**, and
  observations stamped class 0 arrive as `0 + 0.5 = 0.5`, which lands in it.
- `packages/shared/src/analytics/selection.ts:224-235` — `describeSelection`
  ranks bins by selection ratio and prints the top one by name.

Reproduced with the shipped functions, no mocks: with an availability share of
0.10 for `Unknown` and 90 of 300 observations stamped `Unknown`, the shipped
readout string is verbatim

> `Unknown is used 3.0× more than its share of the ground would predict (90 of 300 observations). Class 10 is the least used.`

with `significant: true`.

**What the hunter gets.** A sentence asserting that deer select for ground the
engine could not classify. There is no interpretation of that sentence which is
true. It is the worst possible output of a module whose entire purpose is to
avoid overclaiming, and it is produced by the one function in the codebase
written to be the honest voice.

Two secondary effects worth stating because they will confuse whoever fixes
this:

- **It also suppresses real findings.** At a realistic n the `Unknown` bin's
  expected count is small, `allExpectedOk` goes false at
  `selection.ts:151`, and `significant` is withheld for the _entire_ analysis.
  Probed at n=60 with a 5% Unknown share: expected = 3, and the whole landform
  analysis silently degrades to "No clear pattern beyond what the terrain mix
  alone would produce". The refusal is correct behaviour firing for an incorrect
  reason, which is the hardest kind of bug to notice.
- **It costs a degree of freedom.** `usableBins` at `selection.ts:150` counts
  the `Unknown` bin, inflating `df` and so raising the critical value. That
  direction is conservative, so it is not harmful — but it is not intentional.

Also inconsistent within one function: an observation with `landformClass = null`
maps to `-0.5` and is correctly excluded, while one stamped `Unknown` is
included. "Never stamped" and "stamped as unknowable" get opposite treatment.

**Fix.** Drop index 0 from both sides. `landformShares` should be computed with
a `toBin` that returns `-1` for `WeissLandform.Unknown` (matching what `shareOf`
does for non-finite slope twelve lines above, and what the bench loop at
`:116-124` already does for `BenchFlag.Unknown`), and `landformBins` should be
built from classes 1..10 only. Regression test: a fixture where 30% of cells are
`Unknown` must produce a `SelectionAnalysisDto` with no bin labelled `Unknown`,
and `describeSelection` must never return a string containing it. Owner:
`backend-builder`; `analytics-auditor` signs off on the test.

---

### A3 — HIGH — use is measured at z14, availability at z13; every Manly ratio compares two different measurements of the same ground

CONFIRMED. Not in `docs/BACKLOG.md` — new this pass.

- `apps/api/src/observations/observations.module.ts:263-270` — `stampTerrain`
  calls `this.terrain.samplePoint(lng, lat, **14**, ...)`. Hard-coded.
- `apps/api/src/analytics/analytics.module.ts:64` —
  `async terrainProfile(propertyId: string, zoom = **13**)`. The only caller
  (`movement`, `:193`) takes the default.

So the numerator of every selection ratio is sampled on ~7.3 m cells and the
denominator on ~14.6 m cells (at 40°N), a **4× difference in cell area**. This
matters three ways, in increasing order of severity:

1. **Slope is scale-dependent.** A coarser DEM systematically flattens Horn
   slope — this is one of the best-established results in terrain analysis. So
   `slopeShares` (z13) is biased toward the flat bands relative to the z14
   values it is dividing. Every steep band's selection ratio is biased **up**
   and every flat band's **down**, uniformly, on every property.
2. **The Weiss classes are not the same classes.** `packages/terrain/src/pipeline.ts:180,183`
   set TPI radii of 3 and 20 **cells**. At z13 the large neighbourhood is ~293 m;
   at z14 it is ~146 m. "Midslope drainage" is answering a different question on
   each side of the division. `byLandform` divides a count of one classification
   by the area share of another.
3. **It is invisible.** Both numbers are real, both are computed by the same
   validated engine, and nothing in the DTO or the readout says the two sides
   were measured at different resolutions. `terrainProfile.cellSizeM` is
   returned (`analytics.module.ts:292`) and describes only the denominator.

**What the hunter gets.** A systematic, one-directional bias toward "your deer
prefer steep ground" on every property, of a magnitude nobody has measured,
presented with a chi-square. This is `CLAUDE.md`'s fifth non-negotiable failing
one level below where it was written — the availability distribution is now the
right _ground_ (`R70`) but still the wrong _resolution_.

**Fix.** Pin both to one zoom and make it a named constant both modules import,
not two defaults that happen to agree. z14 is the better target for the stamp
(a point sample wants resolution) but the profile is a full raster pass over a
property and z14 costs 4× the tiles; if z13 is chosen for cost, the stamp must
move to z13 too and the readout must say so. Either way, add
`demZoom` to the comparison: `TerrainProfile.demZoom` already exists in the
schema, and `Observation` already captures `demSource` provenance in spirit
(`observations.module.ts:150-153` argues for exactly this) — record the stamp
zoom on the observation and have `movement` **refuse to compute a selection
ratio when the two disagree**, rather than computing a biased one. Owners:
`terrain-scientist` (which zoom, and by how much slope shifts between them —
this wants a measured number, not an argument), `backend-builder` (plumbing),
`schema-architect` (the column).

---

### A4 — HIGH — `sightingsPerSit` is not an effort denominator; with no blank sits it is exactly 1.0

CONFIRMED by reading.

`apps/api/src/analytics/analytics.module.ts:215-221`:

```ts
const sightings = rows.filter(
  (r) =>
    !r.isBlankSit && (r.kind === 'SIGHTING' || r.kind === 'TRAIL_CAMERA' || r.kind === 'HARVEST'),
);
const subject = options.matureOnly ? sightings.filter(isMature) : sightings;
const sits = rows.filter((r) => r.kind === 'SIT' || r.isBlankSit).length + sightings.length;
```

Five distinct defects in three lines:

1. **Every sighting adds a sit.** A morning where the hunter saw six deer and
   logged them as six rows is six sits. A hunter with no blank sits logged gets
   `sightingsPerSit = sightings / sightings = ` **exactly 1.0**, forever, on
   every property. The flagship effort metric degenerates to a constant for
   precisely the user who has not yet adopted the blank-sit habit — i.e. the
   user the metric exists to educate.
2. **Trail-camera photos count as sits.** `TRAIL_CAMERA` is in the `sightings`
   filter, so it is in both numerator and denominator. The form's own copy
   (`apps/web/src/components/observations/meta.ts:32`) says "one camera can
   carry many photos over a season" — a card pull of 300 photos adds 300 to
   `sitCount`. A camera is a 24/7 passive detector; it is not effort of the same
   kind as a sit and cannot share a denominator with one.
3. **`matureOnly` shrinks the numerator and not the denominator.** The
   denominator still includes every non-mature sighting, so the mature rate is
   depressed in proportion to how many does the hunter logged. Toggling the
   switch changes what the ratio _is_, not just what it counts.
4. **A non-blank `SIT` row's sighting is invisible.** `ObservationForm`
   deliberately supports a sit that saw something —
   `apps/web/src/components/observations/ObservationForm.tsx:91`
   (`sitShowsSpecies = kind === 'SIT' && !isBlankSit`), and
   `ObservationList.tsx:50-53` renders "Sit — saw {species}". That row's animal
   is **excluded from the numerator** (kind is not SIGHTING/TRAIL_CAMERA/HARVEST)
   and **included in the denominator**. Two UI paths for the same event, and
   they move the metric in opposite directions.
5. **`sitMinutes` is captured and never read.** Written at
   `observations.module.ts:217`, asked for in the field at
   `BlankSitQuickLog.tsx:96-107` ("how long you were actually on stand"), and
   read by nothing. Six thirty-minute sits and six all-day sits are the same
   denominator today.

**What the hunter gets.** The one number that carries the product's whole
argument for logging blanks — `BlankSitQuickLog.tsx:77` promises it in terms:
_"Recording the blanks is what turns 'sightings per sit' into a real number
instead of a measure of how often you went out"_ — is currently a measure of how
often they went out, or 1.0.

**Fix.** A sit must be a first-class entity, not something inferred from a row
filter. Minimum viable: `sits = count of rows where kind === 'SIT'` (blank or
not), full stop; sightings from a non-blank `SIT` row join the numerator;
`TRAIL_CAMERA` is excluded from both and gets its own camera-nights denominator
or no rate at all; `matureOnly` filters only the numerator, which is then
correct because the denominator no longer contains sightings. Then report
`sightingsPerSit` alongside `sitCount` **and** a coverage statement — "6
sightings across 12 sits" is the honest rendering, not "0.5". Longer term,
`sitMinutes` gives hours-on-stand as the better denominator. Owners:
`backend-builder`, with `schema-architect` if a sit becomes its own record.

---

### A5 — HIGH — three activity distributions ship as raw counts, and the contract already says one of them should not

CONFIRMED.

- `apps/api/src/analytics/analytics.module.ts:251-262, 278-282` —
  `byPressureTrend` and `byWindDirection` are built by counting `subject` into a
  `Map` and returning `{label, count}`. No availability denominator, no effort
  denominator.
- **`packages/shared/src/domain.ts:257` declares
  `byPressureTrend: Array<{ label: string; count: number; sightingsPerSit?: number }>`.**
  The contract has the effort-normalised field. The implementation never
  populates it. The type is optional, so nothing fails.
- `analytics.module.ts:270-277` — `relativeToSunrise` / `relativeToSunset` are
  `bucketRelativeToSolar` output: counts of observations per 30-minute bucket
  from solar noon-reference, with **no exposure denominator**.

The solar one is the most dangerous of the three because it is the most
persuasive. A hunter sits the first two hours of light and the last two hours of
light. A histogram of their sightings against minutes-from-sunrise will peak at
dawn and dusk **regardless of what the deer did**, because that is when the
observer was present. It is the "70% of the property is gentle slope" error with
time on the x-axis instead of terrain, and it will produce the single most
confident-looking chart in the product.

Pressure trend is the same error with weather on the axis: it measures how often
the barometer was falling while the hunter happened to be out.

**Credit where due:** the front-end client already refuses to be the one that
ships this. `apps/web/src/lib/api/analytics.ts:1-11` and
`apps/web/src/lib/api/types.ts:416-426` both carry an explicit instruction not
to chart `byWindDirection`/`byPressureTrend` as raw counts and to route any new
chart past this audit first. That is exactly the right instinct and it is why
this is HIGH and not CRITICAL. But a doc comment is not a guard, and the fields
are on a public REST response.

**Fix.** The data to fix two of the three is already collected.
`ConditionsFields` is rendered inside `BlankSitQuickLog`
(`BlankSitQuickLog.tsx:109-115`), so blank sits carry `pressureTrend3h` and
`windFromDeg`. So: bucket **sits** by trend band and by wind octant, and return
`sightingsPerSit` per band — which is precisely the field `domain.ts:257`
already declares. For the solar buckets, a per-bucket exposure denominator needs
a sit _interval_, which today's schema cannot express (`observedAt` plus
`sitMinutes` is ambiguous about which end the timestamp is). Until it can, the
solar chart must either be labelled as "when you were out and saw something",
not "when deer move", or not ship. Owners: `backend-builder`;
`schema-architect` for the sit interval.

---

### A6 — HIGH — the rut model overclaims south of ~38°N, and the list screen strips the caveat off entirely

CONFIRMED. `R9` is filed with a sourced region table; this **confirms and
sharpens it** with the specific numbers a user sees, and adds three defects
`R9` does not cover.

The model is photoperiod, never lunar — verified.
`packages/shared/src/rut.ts:1-21` states the position and the code holds it;
`moonPhase.ts` records the moon as a _fact_ and predicts nothing from it (see
"What survived scrutiny"). There is no lunar predictor anywhere in this repo.
That part is clean and should stay that way.

The problem is the confidence attached to the latitude formula.
`packages/shared/src/rut.ts:73-79`:

```ts
if (lat >= 40) return 319; // ~15 Nov
if (lat >= 34) return 319 + Math.round((40 - lat) * 1.2);
return 326 + Math.round((34 - lat) * 3.5);
```

Worked through for two real properties at **the same latitude**, 33.5°N:

|                           | model says peak      | agency says peak  | error    |
| ------------------------- | -------------------- | ----------------- | -------- |
| Mississippi delta         | DOY 327 = **23 Nov** | MDWFP, ~**1 Jan** | ~39 days |
| South Carolina lowcountry | DOY 327 = **23 Nov** | SCDNR, **30 Oct** | ~24 days |

The model returns one number for both because latitude is the only input, and
`R9`'s research finding is that the functional class is wrong, not the
coefficients. Concretely, on 30 October the SC hunter opens the app and reads
`Pre-rut` with the note _"stay out of bedding"_ (`rut.ts:142-143`) during their
actual peak breeding week. On 23 November the MS hunter reads `Peak breeding`
with _"Lockdown... often the worst week to sit"_ during their pre-rut. Both are
the exact "burn a vacation day on the wrong week" harm the module's own doc
comment says it exists to prevent (`rut.ts:10-12`).

`rutConfidence(33.5)` returns **0.65**, which
`apps/web/src/components/properties/propertyFormat.ts:39` renders as
**"Moderate confidence"**. A 39-day error is not moderate confidence.

Three defects `R9` does not currently cover, all CONFIRMED:

- **The list screen renders the phase with no confidence chip at all.**
  `apps/web/src/components/properties/PropertiesListScreen.tsx:101-105` renders
  `<Chip tone="neutral">{rut.phase}</Chip>` and nothing else.
  `PropertyDetailScreen.tsx:111-113` renders phase + confidence + note. Same
  reading, two screens, and the glanceable one — the one a hunter actually looks
  at over coffee — has had every qualification removed. `formatRut` returns the
  confidence object; the list simply does not use it.
- **The list and the detail can disagree about the phase for the same property
  on the same day.** `apps/api/src/properties/properties.module.ts:79` calls
  `readRut(new Date(), { latitude: p.centerLat })` with **no `offsetDays`**;
  `:101-104` calls it **with** `property.rutOffsetDays`. A property calibrated
  by −10 days shows `Chasing` in the list and `Seeking` on the detail page.
- **`southernHemisphere` is never passed.** `rut.ts:104` supports it;
  neither call site sets it, and `peakBreedingDayOfYear` takes `Math.abs(lat)`.
  A property at −33° gets the northern-hemisphere calendar, i.e. six months
  wrong, labelled with whatever confidence the absolute latitude earns. Latent
  today (no southern properties), and a one-line fix, but it fails silently and
  in the most confident possible direction.

**Fix.** `R9` as filed (region table, `unknown` when no region matches, drop
`rutConfidence` below 36°N to ~0.15) is the right shape — confirmed, do not
re-scope it. Add to it: (a) render the confidence chip on the list card; (b)
pass `rutOffsetDays` in `list()`; (c) pass `southernHemisphere: centerLat < 0`,
or refuse. And when `R9`'s `unknown` phase lands, both screens need a rendering
for it that is not a blank chip. Owners: `terrain-scientist` /
`game-biologist` for `R9` proper; `frontend-builder` for (a);
`backend-builder` for (b) and (c).

---

### A7 — MEDIUM-HIGH — `R72` confirmed: fabricated elevation reaches the availability denominator, and the response cannot say how much

CONFIRMED as filed. `R72` is accurate and the fix it proposes is the right one.
Quantified here, as asked, and with a verdict on what it does and does not
invalidate.

- `apps/api/src/terrain/dem.service.ts:286-300` — `blitTile` ends
  `.catch(() => undefined)`. A transient upstream failure degrades that tile to
  NODATA with no signal to anyone.
- `dem.service.ts:324` — `grid.fillVoids()` then diffuses elevation ~8 cells
  into every hole (`packages/terrain/src/dem/grid.ts:157-188`). Those cells are
  **finite**, so `shareOf` counts them (`analytics.module.ts:328-337` skips only
  `!Number.isFinite`).

**Quantified.** For a lost 256 px tile: the fabricated rim is
256² − 240² = 7,936 cells, **12.1% of that tile**; the remaining 87.9% stays
`NaN` and is correctly excluded. In `terrainProfile`'s typical 3×3 mosaic
(589,824 interior cells) one lost tile therefore contributes ~1.3% of all cells
as invented ground, and — because `fillVoids` interpolates from the rim — that
ground is artificially _smooth_, so the bias is toward the flat slope band.

So the fabrication itself is small: **≈1–1.5 percentage points on a share, per
lost tile, biased flat.** The reproducibility failure is much larger: the same
request loses an entire tile's real terrain from the denominator, and if that
tile is unrepresentative (a bluff, a river bottom) the share can move by up to
its full 1/9 weight — **≈11 points at a 3×3 mosaic** — between two consecutive
requests, with nothing anywhere indicating that anything happened.

**Does it invalidate a currently-shipping number?** Partly, and the honest
answer has two halves:

- **Method: no.** It does not invalidate the `R70` correction, the Manly ratios,
  or the chi-square. Those are correct given their inputs.
- **Reproducibility: yes, for two numbers on screen today.**
  `PropertyDetailScreen.tsx:120-124` renders `meanSlopeDeg` and `benchShare`
  from `TerrainProfile`, and `MatchShare.tsx:80-93` renders the filter share.
  Any of the three can differ between two identical requests because of network
  luck, and no caveat on any of those screens covers that cause. `TerrainProfile`
  is additionally _cached_ (`analytics.module.ts:65-67`), so a degraded
  computation is persisted and served for the life of the `sourceVersion` — the
  transient becomes permanent. That is the sharpest consequence and `R72` does
  not currently say it.

**Fix.** `R72` as written — a second mask marking fabricated cells, excluded
from statistics while still feeding the 3×3 kernels, plus an affected-fraction
field on the response. Add one item: when the fabricated (or NODATA) fraction is
above a threshold, `terrainProfile` should **refuse to persist** rather than
cache a degraded profile. Confirm `R72`'s P1/S sizing. Owner: `backend-builder`.

---

### A8 — MEDIUM — `R70` verified fixed; but three denominator conventions still coexist in one function

`R70` is **SHIPPED and correct.** Verified at
`apps/api/src/analytics/analytics.module.ts:82-90` (`rasterizeMask` threaded
into every share), `apps/api/src/prisma/geometry.service.ts:114-136` +
`fillPolygonEvenOdd` (even-odd scanline, handles MultiPolygon and holes), and —
the part that matters — `apps/api/src/analytics/analytics.module.spec.ts:115-187`,
which pins the fix with a **falsifiable** assertion on an L-shaped fixture
(envelope 0.5487 flat vs clipped 0.9877; the test asserts the gap exceeds 0.3,
and its own comment notes that "shares sum to 1" would have passed throughout
the life of the bug). That is the right kind of regression test and it should be
the template for A1 and A2. Every Manly ratio and chi-square downstream inherits
the corrected denominator, because all four shares are computed from the same
`mask` — verified by reading `:95-124`, not assumed.

What remains: **three different rules for the same question inside `terrainProfile`.**

| statistic                     | unmeasurable cells                                         |
| ----------------------------- | ---------------------------------------------------------- |
| `slopeShares`, `aspectShares` | **excluded** (`shareOf`, `:331` non-finite skip)           |
| `landformShares`              | **included** as a class (A2)                               |
| `benchShare`                  | **excluded** (`:121`, `BenchFlag.Unknown` skip — F7's fix) |

Fixing A2 collapses this to one rule. Until then, `landformShares` is not
comparable to its three siblings in the same DTO.

Two sub-items, both LOW, both latent:

- `analytics.module.ts:126-130` — `grid.range()` is deliberately left
  un-clipped, with a comment saying so. Correct call for `R70`'s scope, and
  `minElevationM`/`maxElevationM` are not currently rendered anywhere in the web
  app (verified). The moment they are, they describe the envelope while
  everything beside them describes the parcel.
- A boundary that rasterises to an empty mask (a parcel smaller than a cell, or
  a coordinate-order error) produces `total === 0`, so `shareOf` returns all
  zeros (`:338`), `analyzeSelection` gets `availableShares` summing to 0, every
  `selectionRatio` is `undefined`, `df` is 0, and `describeSelection` reports
  "No clear pattern beyond what the terrain mix alone would produce". A
  catastrophic input degrades into the reassuring message. It should throw.

---

### A9 — MEDIUM — `GET /analytics/terrain-profile` has no access check

CONFIRMED. `apps/api/src/analytics/analytics.module.ts:374-378`:

```ts
@Get('terrain-profile')
async profile(@CurrentUser() user: AuthedUser, @Query('propertyId') propertyId: string) {
  if (!propertyId) throw new BadRequestException('propertyId is required.');
  return this.analytics.terrainProfile(propertyId);
}
```

`user` is bound and never used. `AnalyticsService.terrainProfile` does no
`access.require` of its own — `movement` does it at `:192`, which is what makes
the omission look deliberate rather than missing. Any authenticated user can
read any property's terrain distribution, and can trigger an uncached full
raster pass (a 3×3 tile fetch plus `analyze`) for an arbitrary property id.

In scope for this audit because it is a number reaching a user with no right to
it; the amplification half belongs to `engineering-auditor`, to whom this is
referred. Fix is one line: `await this.access.require(user.id, propertyId)`.
Owner: `backend-builder`.

---

### A10 — MEDIUM — the confidence interval exists, is tested, and never reaches a user

CONFIRMED by grep across the repo.

`packages/shared/src/analytics/selection.ts:196-209` implements
`selectionRatioInterval`, with a doc comment that is the clearest statement of
this role's purpose anywhere in the codebase:

> _"A bin with three observations can easily show w = 2.4 ('deer strongly prefer
> this!') with an interval spanning 0.7 to 8.0 — i.e. no evidence of anything.
> Showing the interval is the difference between analytics and a horoscope."_

Its only callers are its own tests (`selection.test.ts:135-150`). It is not
called by `analyzeSelection`; `HistogramBin` (`domain.ts:215`) has no interval
field; the API response therefore carries `selectionRatio` as a **bare point
estimate**; and `describeSelection` prints `3.0× more` with no interval beside
it. The brief for this role names showing intervals rather than bare point
estimates as a requirement, and the code that satisfies it is written, tested,
and disconnected.

**Fix.** Add `ratioLower`/`ratioUpper` to `HistogramBin`, populate them in
`analyzeSelection` from the existing function, and make `describeSelection`
print the interval on its headline claim — _"used 3.0× more than its share of
the ground would predict (95% CI 1.8–5.1; 90 of 300 observations)"_. When the
interval spans 1.0, the sentence must not say "more than" at all. Owner:
`backend-builder` with `analytics-auditor` on the wording.

---

### A11 — MEDIUM — `R71` confirmed unfixed, and here is the honest presentation

CONFIRMED unchanged since Pass 1. `R71` is accurate as filed; confirming rather
than re-filing, and answering the brief's question about what honest looks like.

- `apps/web/src/components/filters/useLiveMatchShare.ts:103` —
  `Math.min(16, Math.max(8, Math.round(viewport.zoom)))`. ~256× range in cell
  area. Bench ring (`landform.ts:728`) and TPI radii (`pipeline.ts:180,183`) are
  in **cells**, so the predicate's meaning moves with the scroll wheel.
- `apps/web/src/components/filters/MatchShare.tsx:88-90` — the zoom is mentioned
  **only when it had to clamp**. Inside 8–16 the number changes silently.
- `apps/api/src/terrain/terrain.service.ts:162-166` — returns `cellSizeM`;
  `useLiveMatchShare.ts:114-124` discards it.
- `apps/api/src/terrain/terrain.service.ts:164` — `cellCount: mask.length`, every
  cell in the extent. No `measuredCellCount`, so `MatchShare.tsx:91-92`'s caveat
  ("cells with no elevation data count as non-matches") names the choice but
  gives the user no number with which to act on it.
- `MatchShare.tsx:80` — `toFixed(matchShare < 0.01 ? 2 : 1)`. Two decimals below
  1%, where the figure is dominated by `fillVoids`' fabricated rim (A7) and the
  quorum guards' abstention bands.
- `apps/web/src/lib/api/types.ts:528-532` — `EvaluateFilterResult` still has an
  `[key: string]: unknown` index signature and no `cellCount`, so the hook casts
  and defaults to `0` at `:116-120`. A server-side rename renders "0 cells
  total" beside a live percentage with no type error.

**The honest presentation**, concretely, since the brief asks for it:

> **12% of measured ground** — 6% of this view could not be measured.
> Measured on 9 m cells across the map view on screen.

Four changes behind it: pin the zoom to **z13** so the filter share and
`TerrainProfile` are on one footing (`analytics.module.ts:64`); make the
headline a **measured-only** share, computed with a validity predicate that
tests every metric in `requiredMetrics(predicate)` at each cell — not
`grid.hasData`, because the quorum guards abstain on cells that _do_ have
elevation; print `cellSizeM` **unconditionally**, not just on clamp; round to
whole percent, or `<1%` below one. Owners: `frontend-builder` +
`backend-builder`; `terrain-scientist` confirms z13 is adequate for bench and
saddle detection at property scale.

---

### A12 — MEDIUM — the evidence-grade vocabulary is desktop-only; the chip that needs it is not

CONFIRMED.

- `packages/design/src/components/dock.tsx:138-167` — `EvidenceLegend` renders
  all four grades with a gloss. Good component, correct sourcing (it reads
  `Confidence`'s own maps rather than a second copy).
- `packages/design/src/components/dock.tsx:183-190` — it lives inside
  `DockFooter`.
- `apps/web/src/App.tsx:840-876` — `DockFooter` renders **only when
  `isDesktop`**. The mobile branch (`:875`) renders `drawerContent` alone.

So on a phone — the device this product is explicitly designed around ("in
hollows with no bars, on public land in the dark") — the bedding row shows a
chip reading **`? Assumption`** in the `critical` tone with no legend anywhere on
the device explaining what the word means.

Compounding it: `Confidence`'s `note` is passed to `Chip` as a **`title`
attribute on a `<span>`** (`packages/design/src/components/primitives.tsx:328-339`).
`title` requires hover. There is no hover on a touch device, and `title` on a
non-interactive `span` is announced inconsistently by screen readers. The
qualification is therefore unreachable on mobile by any means.

Third, smaller: the note itself understates the finding.
`LayersSheet.tsx:167` says _"the slope term behind this score is a defensible
estimate"_ (singular), while `lib/layers.ts:166-175` and
`TerrainReadout.tsx:371` both correctly say _"the slope, ring-radius and cover
terms"_ — and `docs/EVIDENCE.md` grades **seven** bedding constants 🔴 Assumed
(`BEDDING_RING_MIN_SLOPE_DEG`, `BEDDING_VRM_FULL_COVER`, `DEFAULT_VRM_RADIUS_CELLS`,
`DEFAULT_RING_RADIUS_CELLS`, `BEDDING_RING_SOFTNESS_DEG`, the cover floor, the
shelter floor). Two of the three notes are right; the one on the layer list is
the weakest and it is the one most users will see.

**Fix.** Render `EvidenceLegend` in the mobile drawer as well — inside
`LayersSheet`, once, below the hunting group, so it appears next to the only
chip that uses it. Make the note reachable without hover: a `<details>`, a tap
target, or inline hint text under the row. Align `LayersSheet.tsx:167`'s wording
with `layers.ts`'s. Owners: `frontend-builder`, with `game-biologist` on the
note's wording.

---

### A13 — MEDIUM — evidence grades are applied correctly; `insolation`'s problem is a missing term, not a missing chip

The grade discipline **holds**, and this is a clean result worth stating
plainly.

`apps/web/src/lib/layers.ts:40-55` states the rule in terms — _"Never set this
for measured geometry... a grade chip on one implies a doubt that does not
exist, and grading everything is identical to grading nothing"_ — and the
catalogue obeys it. Verified layer by layer: `slope`, `aspect`, `weiss`,
`wood`, `bench`, `multiHillshade`, `satellite`, `topo`, `insolation` all carry
**no** `grade`; `bedding` alone carries `grade: 'assumed'` (`:175`), with a
comment deriving it from `docs/EVIDENCE.md` and from the correct rule (a claim
is as strong as its weakest input). `LayersSheet.tsx:164-169` renders the chip
only when `layer.grade` is set. `TerrainReadout.tsx:33-40` applies the same rule
independently in the readout — fact line ungraded, bedding row graded — and says
why. `LayersSheet.test.tsx` reportedly iterates the array and fails CI on drift.
Two components, one rule, no leakage onto measured geometry.

**`insolation` — the borderline case, resolved.** It should **not** get a
`Confidence` chip, but its blurb is wrong.

- `packages/terrain/src/analysis/solar.ts:44-112` is NOAA solar position —
  exact physics, accurate to well under a degree, and
  `slopeInsolation` (`:123-146`) is a closed-form cosine-of-incidence. There is
  no biological parameter in it. A grade chip would be a category error, and
  would import doubt about arithmetic that has none.
- But `packages/terrain/src/analysis/solar.ts:159-167` states that `castShadows`
  **is not wired into `analyze()` at all** (`R27`), and `pipeline.ts:213-218`
  confirms it: `result.insolation = slopeInsolation(surface, sun)` with no
  shadow mask. `docs/EVIDENCE.md:1005-1008` says the same thing in the same
  words — the field "currently reads as fully sunlit".
- `apps/web/src/lib/layers.ts:150-151` nonetheless calls the layer **"Direct sun
  for the selected date and time."**

So at 07:10 in November, the bench behind a ridge — the exact case the module's
own doc comment says "is exactly the case that matters" (`solar.ts:121`) —
renders as receiving direct sun, because nothing computed the ridge. That is a
false statement about geometry, not a weak estimate, and the honest remedy is a
correction to the sentence, not a chip:

> **Sun angle** — how squarely each slope faces the sun for the selected date
> and time. Does **not** yet account for ridges casting shadow, so ground behind
> a ridge at low sun reads brighter than it is.

Once `R27` lands, the blurb reverts to "direct sun" and the layer needs no
grade, permanently. Owners: `frontend-builder` (blurb, now),
`terrain-scientist` (`R27`).

---

### A14 — LOW — `cellSizeM` renders as a raw float

`apps/web/src/components/properties/PropertyDetailScreen.tsx:121` —
`Computed from a {property.terrainProfile.cellSizeM} m DEM`. `cellSizeM` is
`grid.cellSize` from `pixelSizeMeters()`, an unrounded double, so this renders
something like `14.639225641251 m DEM`. Twelve significant figures on a quantity
that (a) is a Web Mercator approximation and (b) varies across the property with
latitude — the stored value is the cell size at the mosaic **centre** only.
Round to one decimal, and consider "≈15 m". Owner: `frontend-builder`.

---

### A15 — LOW — `count` is ignored, so "sightings" means "rows"

`Observation.count` (`apps/api/prisma/schema.prisma:235`) is collected by both
forms and read by no analytic. `subject.length` at
`analytics.module.ts:268, 271` counts rows. A row recording seven does counts
as one.

This is arguably **correct** for the selection analytics — one location is one
observation, and weighting a bin by group size would violate the independence
the chi-square assumes. It is **misleading** for `sightingsPerSit`, where a
hunter will read "sightings" as deer. The defect is the shared vocabulary, not
the arithmetic. Name the two quantities differently (`sightingEvents` vs
`animalsSeen`) or state the convention on screen.

Related, same file: `packages/shared/src/analytics/selection.ts:225` —
`describeSelection` filters to `b.count > 0` before choosing the "least used"
bin, so a bin used **zero** times is invisible. Total avoidance is the strongest
signal in the dataset and it is the one that cannot be reported.

---

## Pass 1 status — 2026-08-08, re-checked 2026-08-12

Every Pass 1 finding, verified against current `main` rather than assumed. Full
Pass 1 text is in git history at the commit that introduced this file.

| Pass 1          | What it was                                                                               | Status now                                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1** HIGH     | "Not on a bench" matched unmeasured ground                                                | **SUPERSEDED** — engine fixed             | `2b75795`. `BenchFlag` is tri-state (`landform.ts:686-696`), `Unknown = 2`. The number is no longer wrong.                                                                                                                                                                                                                                                                                                                                   |
| **F2** HIGH     | "Also match flat ground" matched unmeasured ground                                        | **SUPERSEDED** — engine fixed             | `2b75795`. `matchesNoAspect` (`terrainFilter.ts:238-242`) consults `fields.slope`; `requiredMetrics` adds `slope` to every aspect predicate (`terrainFilter.ts:190-196`). Measured 6.05% → 0%.                                                                                                                                                                                                                                               |
| F1/F2 residue   | The UI guard is still `containsNegation` — syntax, not the property                       | **STILL LIVE**, downgraded HIGH → **LOW** | `useLiveMatchShare.ts:88`, `predicateUtils.ts:85-91`. `R69`'s UI half. Now defence-in-depth only: the engine no longer matches voids, so the guard's blind spot has nothing to let through. Worth doing before a third void-tolerant predicate is added; not urgent.                                                                                                                                                                         |
| **F3** MED-HIGH | Denominator includes voids and fabricated cells; not reproducible                         | **STILL LIVE**, split                     | Fabrication half = `R72`, confirmed and quantified as **A7**. `measuredCellCount` half = `R71`, confirmed as **A11**. Sub-item (untyped `EvaluateFilterResult`) also still live — `types.ts:528-532`.                                                                                                                                                                                                                                        |
| **F4** MED-HIGH | Share is resolution-dependent, resolution not shown                                       | **STILL LIVE**                            | `useLiveMatchShare.ts:103`, `MatchShare.tsx:88-90` unchanged. `R71`. See **A11**.                                                                                                                                                                                                                                                                                                                                                            |
| **F5** MEDIUM   | `TerrainProfile` was the bounding box, not the boundary                                   | **SHIPPED ✅**                            | `R70`, `0e429a1`. Verified at `analytics.module.ts:82-90` and pinned by `analytics.module.spec.ts:115-187` (0.5487 → 0.9877, falsifiable). See **A8**.                                                                                                                                                                                                                                                                                       |
| **F6** MEDIUM   | Three incompatible denominators; the false comparison is not live but nothing prevents it | **STILL LIVE, and the trap has moved**    | Still no movement screen (no consumer of `useMovementAnalytics` anywhere in `apps/web/src` — grepped). `benchShare` and `TerrainProfile` are now consistent and boundary-clipped, so the remaining mismatch is the filter share's viewport/zoom/void conventions (A11) plus the new z13-vs-z14 mismatch (**A3**), which is a strictly worse version of the same problem because it is _inside_ one analysis rather than between two screens. |
| **F7** LOW      | `benchShare` counted unmeasurable cells as "not a bench"                                  | **SHIPPED ✅**                            | `analytics.module.ts:116-124` skips `BenchFlag.Unknown` and documents why, including the "adds two per void cell" trap.                                                                                                                                                                                                                                                                                                                      |
| **F8** LOW      | Two-decimal precision below 1%                                                            | **STILL LIVE**                            | `MatchShare.tsx:80`. `R71`. See **A11**.                                                                                                                                                                                                                                                                                                                                                                                                     |
| **F9** LOW      | `R56` copy blames the user's downloads for a server-side gap                              | **STILL LIVE**, verbatim                  | `PredicateNode.tsx:157-164` ("the edge of your downloaded ground", "terrain you have not downloaded"); `MatchShare.tsx:27-29`. Evaluation is server-side (`terrain.controller.ts:216-238`); the voids come from upstream coverage and `dem.service.ts:300`. A hunter reads this and spends twenty minutes on a tile download that changes nothing. Still the cheapest fix on this list.                                                      |
| **F10** LOW     | No test asserting "any predicate that can match a void is refused"                        | **STILL LIVE**                            | `useLiveMatchShare.test.tsx` covers top-level `not` only. Less valuable now that the engine is fixed, but it is the test that pins the _property_ rather than the syntax.                                                                                                                                                                                                                                                                    |

---

## What survived scrutiny

Recorded because a clean result is a result.

- **No lunar rut predictor exists, anywhere.** Grepped the whole repo.
  `rut.ts:1-21` states the photoperiod position and the code holds it: phase is
  a function of date, latitude and a user-calibrated offset, full stop.
  `apps/web/src/components/observations/moonPhase.ts` is the only lunar code and
  its header pre-empts exactly this audit — it **records** the moon as an
  observation condition and predicts nothing from it, correctly reasoning that
  the rule is about using moon phase to predict behaviour. It also correctly
  declines a `Confidence` chip on the grounds that a measurement is not a claim.
  That is the right call and the right justification.
- **Barometric pressure is modelled as trend, not absolute.**
  `selection.ts:273-280` — `pressureTrendLabel(trend3h)` bands a 3-hour delta in
  hPa. `Observation` carries both `pressureHpa` and `pressureTrend3h`
  (`schema.prisma:248-249`) and the analytic reads only the trend. Matches the
  literature; no absolute-pressure analytic anywhere.
- **"Peak rut = best hunting" is explicitly refused.** `rut.ts:44-52` and
  `:148-150` — the `PeakBreeding` note reads _"Lockdown... daylight movement
  drops — this is often the worst week to sit despite the name."_ The highest
  guidance goes to `Chasing`, which is correct. This is the product being
  actively unhelpful to its own marketing, which is the point.
- **`analyzeSelection` refuses significance below usable expected counts, and
  the refusal genuinely fires.** `selection.ts:147-163` — `allExpectedOk` goes
  false the moment any bin's expected count drops below 5, and `significant` is
  returned `undefined` rather than a p-value. Probed live: 60 observations
  across 11 landform bins produced `chiSquare = 255.8` (enormous) and
  `significant: undefined`, and `describeSelection` reported "No clear pattern".
  The module declines to use a statistic it computed. That is the behaviour the
  product's whole position rests on and it works.
- **`describeSelection`'s thin-data refusal is real.** `selection.ts:218-220` —
  below 10 observations it returns _"Only N observations — too few to read a
  pattern from. Keep logging."_ Exactly the stated position, in the product's
  own voice.
- **`R70`'s regression test is the right kind of test.**
  `analytics.module.spec.ts:22-24` explicitly notes that "a test that merely
  asserted 'shares sum to 1' would have passed throughout the life of this bug"
  and then asserts a 30-point movement instead. This should be the template for
  A1's and A2's tests.
- **Solar-relative bucketing is the right axis.** `selection.ts:238-267` bins
  against sunrise/sunset, never clock time, with the December-vs-September
  argument stated. The axis is correct; the missing denominator (A5) is a
  separate defect and does not undermine the choice.
- **The web client refuses to be the one that ships the raw-count chart.**
  `apps/web/src/lib/api/analytics.ts:1-11` and `types.ts:416-426` both name
  `byWindDirection`/`byPressureTrend` as uncorrected and instruct the next
  builder to route a chart past this audit first. A doc comment is not a guard,
  but the instinct is right and it is why A5 is not CRITICAL.
- **Evidence grades never touch measured geometry.** Verified layer by layer —
  see A13. Two components apply the rule independently and neither leaks.
- **The `advice` copy is honest.** `terrain.controller.ts:229-236` — a filter
  matching a third of the ground is told it has not narrowed anything down.
- **Boundary edits invalidate the cached profile.**
  `apps/api/src/properties/properties.module.ts:151-154` deletes the
  `TerrainProfile` when the boundary is redrawn. Checked specifically because
  `sourceVersion` (`analytics.module.ts:66`) keys only on DEM source and zoom,
  so a stale post-`R70` denominator was a plausible failure. It is handled.
- **The engine's abstention discipline remains strong** — `NaN` from slope and
  curvature, quorum abstention in TPI, `WeissLandform.Unknown`,
  `WoodFeature.Unknown`, and now `BenchFlag.Unknown`. A2 is not a failure of
  that discipline; it is the analytics layer failing to _honour_ it.

---

## Priority queue

1. **A1**, **A2** — CRITICAL. Both produce a specific false claim about deer
   behaviour, both are one small change plus one test, and A2's test can be
   written as a string assertion on `describeSelection`.
2. **A3** — HIGH. Structural, needs a decision (which zoom) before code.
   Blocks any honest movement screen.
3. **A4**, **A5** — HIGH. The effort denominator. A4 is the number the product
   argues for on screen; A5's contract already declares the field it is missing.
4. **A6** — HIGH. Confirms `R9` and adds three cheap fixes (list-card chip,
   `offsetDays` in `list()`, `southernHemisphere`) that do not wait on `R9`'s
   research.
5. **A7** (`R72`), **A11** (`R71`) — MEDIUM-HIGH. Confirmed as filed; do not
   re-scope. A7 gains one item: refuse to _cache_ a degraded profile.
6. **A9** — MEDIUM. One line, and it is a real authorisation gap.
7. **A10**, **A12**, **A13** — MEDIUM. Intervals to the user; the legend to
   mobile; the insolation blurb.
8. **A8** sub-items, **A14**, **A15**, and Pass 1's **F9**, **F10**, F1/F2
   residue — LOW. F9 is the cheapest genuine user-facing improvement on the
   whole list.

**Counts:** 2 CRITICAL · 4 HIGH · 7 MEDIUM (incl. 1 MEDIUM-HIGH) · 5 LOW.
Pass 1: 3 SHIPPED, 2 SUPERSEDED, 6 STILL LIVE.
