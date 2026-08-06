# Backlog — Ridgeline

Maintained by `backlog-groomer` from the auditors, `field-qa`, and git history.
The build loop pulls from **Ready**.

## Priority order for this product

1. Anything that leaves a user without a map in the field — **critical always**
2. Anything confidently wrong (inverted layer, overclaimed statistic) — wrong is
   worse than missing
3. Work that flips a 🔴 row on the VISION.md scorecard
4. New capability on the four structural advantages
5. Everything else

**This pass (2026-08-06)** reconciled `docs/EVIDENCE.md` (rewritten by
`game-biologist` — two citations retracted, a 1000× units error caught, a fully
parameterised Tobler replacement delivered) and `docs/AUDIT-PRODUCT.md`
(rewritten by `product-auditor` — two verified P0 UI defects, a fully sourced
avalanche-forecast interaction spec). `docs/AUDIT-ENGINEERING.md`,
`docs/AUDIT-ANALYTICS.md` and `docs/QA-FIELD.md` do not exist yet in this repo
— nothing to reconcile from them this pass. Merges and closures are called out
inline below; see the end of this pass's orchestrator report for the full
diff.

**Caution for anyone pulling a UI item below:** three agents are in flight in
`apps/web/**` and `packages/design/**` fixing defects found by the new
`apps/web/e2e/ui-invariants.spec.ts` suite (Layers button shifting 372px,
sub-44px touch targets, chrome contrast below AA). Check current file
territory before starting any item tagged `frontend-builder` or `map-builder`
below to avoid colliding with that in-flight work.

---

## Ready

| # | Item | Pri | Size | Owner | Rationale |
|---|------|-----|------|-------|-----------|
| R8 | Fix `offlineReady` global boolean → real per-viewport coverage truth | P0 | S–M | `offline-steward` | Verified: `apps/web/src/components/LayersSheet.tsx` samples tile count **once at mount** and renders it behind *"Offline ready — elevation for **this area** is stored on this device."* Pan 500 miles and it still reads green. This is the exact field failure CLAUDE.md names as the worst this product has, and it is currently shipping. Replace with a coverage query recomputed on `moveend` (debounced): Covered / Partial — n% of this view / Not downloaded, plus a hatched map overlay of the covered extent. No dependencies — ship ahead of R4. |
| R1 | Property boundary drawing on the map | P0 | M | `frontend-builder` + `map-builder` | Nothing works without a boundary: it is the availability denominator for every selection analytic. Currently API-only. |
| R4 | Offline region picker UI | P0 | M | `offline-steward` | Estimation and warnings exist server-side with no front door. Pair with R8's coverage overlay and state in one sentence that this is an elevation-only download that unlocks every layer, any wind, any date — the clearest demo of advantage #3. |
| R2 | Saved-filter visual editor with live match share | P0 | L | `frontend-builder` | The core interaction of the product is currently reachable only through the API. Presets are visible but not editable. |
| R3 | Waypoint placement + type-aware forms | P0 | M | `frontend-builder` | Stands and cameras are the second thing a user does after drawing a boundary. |
| R12 | Remove the retracted Gowen & de Smet citation; close `N9` as not-supported | P1 | XS | `terrain-scientist` | `docs/EVIDENCE.md` retracted the citation behind "escape terrain ≥10% slope facilitates movement" — it is a human least-cost-path study validated with a Fitbit, and "escape terrain" is a mountain-sheep concept quantified at 40–79% slope, not 10%, where whitetail escape into cover rather than onto grade. Present in `docs/RESEARCH.md:149`, `.claude/workflows/evidence-integrity-loop.md:57`, and the (now-superseded) `N9` row below. Grep and remove everywhere; do **not** build `N9`. Consequence of not doing it: a fabricated ungulate finding stays live as citable justification for the next agent to build the wrong feature. |
| N8 | Replace Tobler with the cervid energetics curve | P1 | M | `terrain-scientist` | **Promoted — now fully parameterised and ready to build.** `C₀ = 2.6, k_up = 26, k_dn = 8 J·kg⁻¹·m⁻¹`, `R_min = 0.55` floor, full `R(s)` table validated against goat/caribou treadmill data across −10%…+11% grade, defensible by linear extrapolation to ±40%, cap at ±60% with low-confidence beyond that. Switches `stepCost` from time to energy — the correct currency for a bed-to-feed move. Highest-value engine item on the board per `docs/EVIDENCE.md`. **Why the register earns its keep:** the previous draft of this same fix carried a 1000× units error (Fancy & White recorded as "5.9 kcal" instead of "5.9 cal ≈ 23 J" per kg per vertical metre) that would have made every uphill step effectively impassable — caught one implementation away from shipping. |
| R9 | Fix the rut model south of ~36–38°N | P1 | M | `terrain-scientist` (sourced by `game-biologist`) | Two corrections in one slice: (1) `peakBreedingDayOfYear` 319→314 at ≥40°N (best measured value is DOY 312–314, not 319). (2) The latitude-interpolation south of 38°N is a monotone function of latitude and *cannot* be right — Mississippi (33°N, mean conception 1 Jan) and Texas Gulf Prairies (28°N, peaks 30 Sep) are three months apart at nearly the same latitude; our model is currently 36 days early in Mississippi and 74 days late on the north Texas coast. Ship a region lookup seeded from MDWFP/TPWD published breeding-date data; absent a match, return phase *unknown* rather than a wrong date. Drop `rutConfidence` for <36°N from 0.65 to ~0.15. Consequence of not doing it: the app confidently tells a Mississippi or Texas hunter a rut phase that is a month or more wrong — CLAUDE.md ranks "confidently wrong" above missing. |
| R11 | Reformulate the bedding slope term (gentle pad × steep ring) | P1 | S–M | `terrain-scientist` | Verified contradiction: `beddingLikelihood` peaks its slope term at 22° **on the bed cell itself**, while `detectBenches` defines a bench as a cell ≤8° surrounded by ground ≥18°, and the engine's own doctrine block says bucks bed on benches. A deer lies down on a level pad embedded in steep surrounding ground — one cell, not two properties of the same cell. Replace the single-cell Gaussian with `gauss(slope, ideal=8°, tol=8°) × sigmoid(ringSlope, min=15°)`, reusing the ring geometry `detectBenches` already computes. Stays 🔴 Assumed on the constants — this is a shape fix, not a citation — but stops the flagship layer contradicting its own bench detector on the same map. No dependencies; `detectBenches` shipped in Phase 0. |
| R13 | Fix the scent-cone stability inversion (ordering only) | P1 | S | `terrain-scientist` | Verified: `apps/api/src/waypoints/waypoints.module.ts:286-290` gives the thermal (sinking, stable) cone a **wider** half-angle (30°) than the synoptic cone (25°) — backwards. Stable, stratified conditions produce the narrowest plume; unstable daytime conditions produce the widest. Reorder `halfAngle` by phase (sinking = narrowest … rising = widest ≈ today's 25°) without inventing absolute σ_y magnitudes, which stay 🔴 pending a read of the EPA ISC3 / NRC RG 1.145 tables (tracked separately in `N11`). Closes the actionable half of `N11`. Consequence of not doing it: a hunter is told the calmest, most scent-concentrated evening/night sit is the safest wind — precisely backwards. |
| R19 | Asymmetric thermal transition window | P1 | S | `terrain-scientist` | Slope-flow literature: katabatic flow "develops rapidly soon after sunset" (short window); anabatic flow must "gradually erode the cold pool" after sunrise (long window). Our symmetric ±45 min is wrong on both ends. Ship the evidence register's interim values, `{ morning: 90, evening: 30 }` minutes — 🔵 on the asymmetry, still 🔴 on the exact counts. File the elevation-dependent phase (ridges flip before valleys drain) as a separate follow-on, not in this slice. Consequence of not doing it: thermal-driven layers (bedding, scent) flip at the wrong moment on both ends of the day, worst in the morning where the true window runs 2–4× longer than modelled. |
| R10 | Deploy `Confidence` chips + evidence as shipped data + judgement-layer material | P1 | M | `frontend-builder` + `map-builder` + `game-biologist` | **Closes `N10` and process-debt `P2` — merged, do not build separately.** Four of five headline layers (bedding, thermal phase, scent cone, corridor cost) are driven by 🔴/🔵 parameters and `grep -rn "Confidence" apps/web/src/` returns zero matches — the primitive exists in `packages/design`, is documented, and is used nowhere. Scope: (1) chips on judgement layers only, at the *weakest* input grade, tappable to an evidence note, in four surfaces — layer row, on-map legend, terrain readout, analytics numbers; (2) move each parameter's grade + justification + source + **region** out of `docs/EVIDENCE.md` prose into a typed record in `packages/shared`, with a test asserting every graded engine parameter has an entry, so the note is available offline where the decision actually happens; (3) a visually distinct material for judgement rasters (soft-edge/stippled) vs crisp fact rasters, so the distinction survives a user who never taps a chip. Consequence of not doing it: the product's stated moat — honest analytics — is a markdown file nobody in the field ever sees. |
| R14 | Scale-of-validity + base-rate line on every judgement layer | P1 | XS | `frontend-builder` | Ship inside R10. Two sentences, directly lifted from EAWS: *"Summarises the current view (≈1.4 km²) at 10 m resolution — not a per-slope prediction, check it on the ground"* and *"Prime covers 4% of this ground"* (nearly free — it's the availability distribution already computed for selection analytics). Cheapest value-per-hour item across both audits this pass. Consequence of not doing it: DEM-resolution pixels get read as a per-slope prediction, the single most common way a judgement layer gets mistaken for fact. |
| R15 | Uncouple the wind/time editors from the layers sheet | P1 | S | `frontend-builder` | `type Panel = 'layers' \| 'wind' \| 'time' \| null` (`apps/web/src/App.tsx:38`) makes three unrelated surfaces mutually exclusive, blocking the single highest-value interaction this product offers — turn on bedding, sweep the wind, watch which hillsides light up. On mobile (`max-width: 860px`) the sheet also covers `ConditionsBar` entirely, hiding the exact state needed to interpret the layer just turned on. Split into independent sheet/editor state. |
| R16 | Delete the fake sheet drag handle | P1 | S | `frontend-builder` | Verified: `.rl-sheet__grip` renders a native-looking 36×4px pill with zero pointer handling. Material's own bottom-sheet spec documents the handle as an **accessibility** component carrying expand/collapse actions — ours fails sighted and assistive-tech users identically, and teaches a new user the app is broken in the first ten seconds. Delete today, or wire real pointer handling; the full three-detent sheet is a separate, larger follow-on (`N20`). Check current territory of the in-flight UI-defect agents before touching `Sheet`. |
| R17 | Legends for aspect / weiss / insolation / bedding ramps | P1 | S | `map-builder` | `slope` and `wood` have legends; four ramps — including the flagship — do not, and aspect is cyclic and unreadable without a compass key. Add `legend` entries in `layers.ts`; promote the active layer's legend to an on-map corner element visible with the sheet closed. |
| R18 | Band the bedding output; kill the continuous ramp | P1 | S–M | `terrain-scientist` + `map-builder` | A smooth ramp over three 🔴 Assumed constants (`idealSlopeDeg`, the 30° shelter saturation, the ruggedness/4m cover term) is a precision claim the model cannot support. Replace with 3–4 ordinal classes, hunter-language names, publish a range rather than rounding up where the class is not resolvable to one level (avalanche-size-style), never number the classes without NAPADS's own warning that "danger increases exponentially between levels." Pairs with R10's chip. **Blocks `N17` (bedding rose) and `N18` (bedding trend), which are sequenced after this ships.** |
| R5 | Observation capture, field-optimised | P1 | M | `frontend-builder` | Gloved, one-handed, dark. Feeds every analytic. |
| R6 | Terrain readout → rebuild as a peek-detent bottom sheet | P1 | S–M | `map-builder` | Verified: `App.tsx:245` renders a floating `role="dialog"` at a fixed position with no relationship to the tapped point, no marker on the map, no map offset — and it currently shows only latitude/longitude. Rebuild as a peek-detent sheet: marker at the tapped point, map offsets to keep it visible, values grouped fact-then-judgement with `Confidence` chips on judgement values (couples to R10, does not block starting). |
| R7 | Corridor solve UI | P1 | L | `map-builder` | Differentiating capability, currently API-only. |
| R20 | Storage fault-injection toggle ("emulate bad storage") | P2 | S | `offline-steward` | Organic Maps ships `setting_emulate_bad_storage` as a developer setting. CLAUDE.md names losing a downloaded region as this product's worst failure, and `offline-integrity-loop` currently has no way to provoke it on demand. Consequence of not doing it: the worst-failure class is only ever found by accident, never by a repeatable test. |

## Next

| # | Item | Pri | Size | Owner | Rationale |
|---|------|-----|------|-------|-----------|
| N1 | PAD-US public-land layer | P1 | M | `schema-architect` + `map-builder` | 🔴 scorecard gap; table stakes for public-land hunters |
| N2 | Weather API integration | P1 | M | `backend-builder` | 🔴 gap; manual condition entry will not be done consistently, and every weather analytic depends on it |
| N3 | NLCD layer + corridor resistance wiring | P1 | M | `backend-builder` + `terrain-scientist` | Resistance mapping exists in the engine but nothing supplies the raster; pairs with `I4`'s Lilly et al. 2025 values |
| N4 | Movement analytics dashboard | P1 | L | `frontend-builder` | API complete; the deep-analytics promise is invisible |
| N15 | Snow term in the cost surface | P1 | M | `terrain-scientist` | Parker et al. 1984 (mule deer/elk, canonical cervid parameterisation) and Sullender et al. 2023: net locomotion cost rises exponentially with sinking depth. `docs/EVIDENCE.md` calls this the single largest missing physical driver in the corridor model — bigger than the Tobler substitution — and it interacts with land cover (50cm fresh snow costs far more in a clearcut than under canopy). Sequence after `N8` ships; the snow term composes with the energetics curve rather than the old Tobler function. |
| N16 | Temperature as a first-class movement covariate | P1 | M | `backend-builder` + `terrain-scientist` | Webb et al. 2010: temperature explains ~55% of movement variation, ahead of relative humidity and precipitation and more than any other weather variable — we surface pressure trend (weak, season/hour-specific) and not temperature. Add temperature and temperature-departure-from-seasonal-normal. Deps: `N2` for live data; can prototype against manual entry sooner. |
| N19 | "Read this ground" first-run analysis | P1 | M–L | `map-builder` + `frontend-builder` | One tap runs the standing battery over the viewport/boundary and emits plain-English findings (saddle count, bench count + dominant aspect, tonight's leeward concentration, "only 6% of this property is over 30°") each tapping to fly-to + enable the relevant layer, each carrying its evidence grade. Nobody else can build this — clearest demonstration of advantage #1, and it gracefully handles the honest negative no competitor will say. Deps: needs discrete-feature extraction (saddle/bench clustering with centroids and counts) — real new `terrain-scientist` work, not a UI wrapper on existing rasters. Scope v1 to what's cheaply countable from current raster outputs. |
| N20 | Bottom-sheet detents (peek / half / full) | P1 | M | `frontend-builder` | Follow-on to `R16`. Peek detent (active-layer summary + top-layer opacity, `ConditionsBar` still visible), half, full; map stays interactive at peek. Material's spec: the handle carries expand/collapse a11y actions, which ours currently has none of. |
| N21 | Layer sheet density — collapse blurbs, accordion groups, active-stack summary | P1 | S | `frontend-builder` | `LayersSheet` renders all ten layers expanded with ~250 words of always-visible blurb; bedding — the flagship layer — sits three phone-screens down. Blurb visible for the enabled/focused row only, collapsed elsewhere (kept in the DOM for screen readers), group accordions remembering state, active-stack summary + count badge on the rail button. |
| N13 | Scope models per species, or narrow the claim to whitetail | P1 | M | `game-biologist` + `terrain-scientist` | `docs/EVIDENCE.md` now ships a full per-parameter transfer table: energetics/anisotropy/slope-flows genuinely cross-species (body-mass or physics models), but bedding slope, leeward geometry, winter-conifer, rut timing and home-range scale do not transfer and the product currently claims "deer or other large game." Either narrow the UI copy to whitetail, or implement the per-species allometric re-run for the three green-row parameters. |
| N5 | Parcel / ownership layer | P2 | L | `schema-architect` + `backend-builder` | 🔴 gap; likely needs a commercial data source — evaluate first |
| N6 | Contour generation from DEM | P2 | M | `terrain-scientist` + `map-builder` | Users expect contours on a hunting map |
| N7 | Hunting-party sharing UI | P2 | M | `frontend-builder` | 🟡 roles exist server-side |
| N11 | Source the scent-dispersion σ_y magnitude (EPA ISC3 / NRC RG 1.145) | P2 | M | `terrain-scientist` | Narrowed scope — the stability-ordering defect is fixed by `R13`. What remains: read the regulatory Pasquill–Gifford σ_y tables to replace the still-🔴 400m draw distance and the absolute half-angle values per stability class, rather than inventing them. Deps: `R13` ships first. |
| N17 | Bedding rose for the current wind | P1 | M | `map-builder` + `terrain-scientist` | Full spec in `docs/AUDIT-PRODUCT.md` §recommendation 8: 8 aspect octants × 3 slope-band rings (not elevation), 4-state fill by pattern not hue (unmarked/possible/likely/prime), every cell stroked including empty ones, normalised to % of that face's *own* area (never raw share of prime — the use-vs-availability rule as a graphic), wind arrow on the perimeter labelled with the *from* bearing, degrades to words when the ground can't discriminate or wind is unset. Deps: `R18` (banding) ships first — a rose over a continuous ramp is meaningless. |
| N18 | Bedding trend (increasing / steady / decreasing) | P2 | S | `terrain-scientist` + `frontend-builder` | Both reference avalanche products publish a forward-looking direction beside the current value (`DangerTrend` in NWAC's schema, `tendency` in EAWS). Our thermal model already computes phase transitions, so evaluating bedding at now and now+1h is one extra pass of an engine that already runs on-device. Deps: `R18` ships first. |
| N12 | Handle mobile vs sedentary bucks | P2 | M | `terrain-scientist` + `game-biologist` | Now properly cited: central Mississippi, 30 collared bucks — 67% sedentary (mean 361 ha) vs 33% mobile (mean 6,530 ha), an eighteen-fold difference. A third of the population will not be described by any property-scoped model, and the app currently implies every deer is resident. |
| N14 | Curvature noise floor tied to DEM vertical accuracy | P2 | S | `terrain-scientist` | The scale-aware Wood threshold fixed the speckle on dissected terrain (8.4% → 56% planar), but a coarse DEM over low-relief farmland still over-classifies ridge/channel because resampling noise dominates real curvature there. |
| N22 | Saved-filter search, favourites, recently-used | P2 | M | `frontend-builder` | Only after `R2` — a library UI for a library nobody can add to yet is the wrong order. |
| N23 | Staleness/validity marking on modelled output | P2 | S | `frontend-builder` | Wind is a value typed once and never expires; if render time is hours from the wind's timestamp (or the time-scrub is far from now) mark `ConditionsBar` and any wind-dependent legend. Every avalanche forecast leads with issued/expiry time; we have no equivalent — the difference between a forecast product and a toy. |
| N24 | Night mode / red-light theme | P2 | S–M | `frontend-builder` | 05:30 in the dark is the literal stated use case and no hunting app ships this; tokens already being the single source of truth makes it cheap. |

## Process debt

| # | Item | Pri | Rationale |
|---|------|-----|-----------|
| P1 | Orchestrator must delegate rather than implement | P0 | The fifteen-agent org was bypassed on every task of the initial build. One perspective, no independent review, no adversarial QA — every UI defect so far was found by the founder looking at a screenshot. Now written into CLAUDE.md and `.claude/README.md`; needs to actually hold. |

*(Former `P2` — "deploy the `Confidence` chip in the UI" — merged into `R10` this pass; it is now urgent enough to belong in Ready, not process debt.)*

## Investigate

| # | Question | Owner | Why it matters |
|---|----------|-------|-----------------|
| I1 | Do bench thresholds need to scale with regional relief? | `terrain-scientist` | A bench in the Driftless is not a bench in the Rockies. Fixed thresholds may be wrong outside the Midwest — same regional-labelling gap `R10` surfaces generally. |
| I2 | Does rut calibration converge within one season? | `terrain-scientist` | Currently needs ≥3 chasing observations; unproven that a normal user produces enough. More load-bearing now that `R9` makes `offsetDays` calibration the primary mechanism south of ~36–38°N rather than a refinement. |
| I3 | Can we obtain GPS-collar telemetry for model validation? | `terrain-scientist` + `game-biologist` | Would settle bedding slope, bench/ring geometry, corridor use and shelter thresholds in one dataset — more red rows in `docs/EVIDENCE.md` resolved than everything else on this board combined. *(Merged with the former `I6`, which asked the same question.)* |
| I4 | Obtain NLCD resistance values from Lilly et al. 2025 (*Landscape Ecology*, whitetail, NLCD-based, validated) rather than the 15 hand-picked multipliers currently used | `terrain-scientist` | Cheapest possible fix for the single largest 🔴 Assumed row in the engine — the abstract was readable, the value table was not. Secondary/longer-term: NLCD's 30m grid still misses sub-canopy structure (regen thickets, CRP edges, cutover) that matters more to deer than the class itself. |
| I5 | Enforce geometry NOT NULL via transaction + deferred constraint trigger | `schema-architect` | Geometry columns are nullable because Prisma cannot create rows with required `Unsupported()` columns and a bare NOT NULL would reject the insert. Today the invariant is upheld only by service code. |
| I7 | Is `min(1, slope/30)` thermal strength backwards? | `terrain-scientist` | LES literature finds katabatic max speed *decreases* with slope angle over gentle slopes (3–6°); the classical Prandtl solution gives no speed-slope dependence at all. Our monotonic-increasing term has no support in either direction. **Caveat: do not invert blindly** — the LES result is for pure katabatic flow over gentle slopes and does not straightforwardly extrapolate to a 20° Appalachian sidewall. Measure or leave it; grade the layer 🔴 either way until real data (a proper LES run, or `I3`'s collar data) settles the sign. |

## Closed — not building

- **`N9` — model escape terrain (≥10% slope) as facilitating movement.** Closed
  as not-supported, not implemented. The citation was retracted (`docs/EVIDENCE.md`
  — it is a human Fitbit-validated least-cost-path study, not ungulate work) and
  the concept itself is mountain-sheep-specific, quantified at 40–79% slope where
  it is measured at all. Removal of the stray citation from docs/workflows is
  tracked as `R12`. If moderate slope should facilitate movement, the defensible
  route is the anisotropic sidehill effect already in the engine (oblique travel
  lowers experienced grade), not a slope-threshold bonus.

## Done — recent

- [x] Terrain engine with 140 closed-form tests (Phase 0)
- [x] PostGIS backend, auth, RBAC, terrain/analytics/offline APIs (Phase 1)
- [x] MapLibre PWA with on-device analysis and OPFS tile storage (Phase 1)
- [x] Fixed: curvature plan/profile sign inversion (would have inverted every
      draw/spur layer and made the thermal-sink filter select ridge tops)
- [x] Fixed: `standardize()` amplifying float noise into fake landform classes
      on uniform ground
- [x] Fixed: `sunTimes()` returning a negative day length west of Greenwich
- [x] `docs/EVIDENCE.md` re-audited end to end: retracted two false 🟢
      citations (the Gowen & de Smet human-locomotion paper cited for escape
      terrain; a Mossy Oak blog post cited for the rut/moon-phase finding),
      caught a 1000× units error in the Tobler-replacement candidate before it
      shipped, and delivered a fully parameterised cervid energetics curve
      (`N8`) ready to implement
- [x] `docs/AUDIT-PRODUCT.md` second pass: found working research channel
      (open-source avalanche forecast apps), rewrote the bedding-rose and
      confidence-encoding recommendations from primary source, verified two P0
      UI defects (`offlineReady` lying about coverage; the fake sheet grip)
