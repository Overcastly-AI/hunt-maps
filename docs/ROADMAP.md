# Roadmap — Ridgeline

**Current focus: Phase 2 — property workflows and field capture.**

---

## ✅ Phase 0 — Terrain engine foundation

The analytics engine, validated against analytically-known surfaces.

- [x] **The availability denominator was the bounding box, not the boundary —
      `BACKLOG R70`.** `analytics.module.ts` refused to run without a boundary,
      then passed only its envelope to `shareOf`. On an L-shaped fixture whose
      envelope is 1.8× its true area, the "flat" share read **0.5487** against
      a true **0.9877** — 44 points, because it was measuring a hillside on
      somebody else's ground. Every Manly ratio and chi-square inherited that.
      Fixed with a polygon mask rasterised once in `GeometryService`; the test
      asserts a >0.3 delta, since one asserting "shares sum to 1" would have
      passed throughout the bug's entire life.

- [x] **"Not a bench" and "flat ground" matched ground never measured —
      `BACKLOG R69`.** Found by `analytics-auditor`, and invisible to the
      `R56` guard because that tests the _syntax_ `not` while the real property
      is "can match a cell the engine never measured". `isBench: false` matched
      **100% of a plane with no benches on it**; an aspect predicate with
      "also match flat ground" returned **only voids**. `BenchFlag.Unknown = 2`
      appended never renumbered; auditing readers for truthiness rather than
      `=== 1` found `removeSmallBlobs` promoting voids to benches and
      `renderMask` painting every void solid bench orange in both apps. The
      tri-state then broke `benchShare` in a way that typechecked and never
      threw — the agent caught its own break and reported it as blocking.

- [x] **Two operators reported a confident answer from a one-sided sample —
      `BACKLOG R50`/`R59`/`R60`, 244 → 260 tests.** The rows assumed a tile
      border was the problem. Measurement said otherwise: a fully-haloed tile is
      **100% covered at every interior cell**, corners included, because both
      operators read the halo and `HeightGrid.get` edge-replicates past it. So a
      quorum here can never paint a seam grid — it fires only at the edge of what
      the user actually downloaded, which is what made the fix affordable.
      `computeVectorRuggedness` had no quorum at all: on a roof surface with
      36 of 81 cells surviving it returned **exactly 0**, the engine's strongest
      possible claim that a ridge crest is a billiard table, feeding the bedding
      cover term its floor. Random thinning to 30% kept the error under 6% — VRM
      survives losing cells and fails when it loses a _direction_, which is why
      it gets a coverage quorum at 0.75 (≤11% error, against 72% at 0.5) and TPI
      gets a centroid test instead. TPI's own bias is exact and first-order:
      `TPI = −∇z · d` for centroid `d`, and the worst one-sided window sits at
      coverage tending to 0.5 **from above at every radius** — so `R49`'s
      `MIN_DATA_FRACTION = 0.5` could never have caught it. End to end, one
      missing neighbour made `classifyWeiss` fabricate **15.6% of a uniform
      plane** as UpperSlope and MountainTop. Now 128 cells, with the remainder
      pinned as a known residual and filed as `R64`: the guard bounds fabricated
      _relief_, but `standardize` divides by a field's own σ, and a plane has
      none. Cost is +18% on TPI at r=20 on tiles containing a void, invisible at
      `analyze()`.

- [x] **Source comments no longer carry retracted provenance —
      `BACKLOG R54`/`R55`.** The evidence register was corrected two passes
      earlier; the source was not, and source is what the next engineer reads.
      The Lang & Gates snow figure survived in **four** files, comparing the
      study's deepest single reading against a mean and overstating the aspect
      effect as 2.32× when the means give **1.20×**. Correcting it exposed that
      the paper cited to justify the cold-season aspect term actually measured
      **topographic position beating aspect by roughly 3×** — the sheltered
      bottomland was the shallowest of all three sites. `R31`'s conclusion, that
      the shelter floor is the term to move, is now argued from the source
      rather than only from the register. Comment-only; 244 tests unchanged.

- [x] **Unknown ground now reads as unknown — `BACKLOG R49`, six operators.**
      The 3×3 kernels guarded only the centre cell, then ran Horn's kernel over
      a window that could contain the `-32768` sentinel. One missing neighbour
      produced **slope 89.93°** where the truth was 15°; all eight produced
      **slope 0.00°** — a perfect flat pad, the _maximum_ of the bedding pad
      term — for ground with no measurable surroundings. `computeTpi` was worse
      and quieter: it averaged the sentinel into its mean, so the error spanned
      the **whole radius window** (~400 m at z13) and produced
      ordinary-looking Weiss classes. And `ASPECT_RAMP` clamped the no-aspect
      sentinel onto its first stop, so **every flat field, lake and void
      rendered as solid north-facing blue** — visible, shipped, unnoticed.
      All six now abstain. 215 → 244 tests, 12 of the new ones failing against
      the old code, the interior proven bit-identical with `Object.is` rather
      than a tolerance. **The fix is faster than the bug** — `computeSurface`
      −36%, `computeRuggedness` −47% — after a first attempt that was +58%,
      because `NODATA + 1` as an imported binding is evaluated ~585k times per
      tile, the same trap `R30` measured at 880 ms.
- [x] Terrarium + Terrain-RGB decoding; haloed tile grids with neighbour stitching
- [x] Horn slope/aspect; Evans–Young curvature (ESRI + Wood sign conventions)
- [x] Weiss multi-scale TPI landform classification (summed-area, O(n))
- [x] Wood morphometric features — **saddle detection**
- [x] Bench detection (gentle cell, steep surrounding ring)
- [x] Terrain ruggedness (TRI); sky-view factor
- [x] NOAA solar position, slope insolation, cast shadows, daily accumulation
- [x] Wind exposure, TOPEX terrain shelter, thermal phase and scent direction
- [x] Composite leeward bedding likelihood (multiplicative)
- [x] Anisotropic Tobler cost surface; NLCD resistance mapping
- [x] Dijkstra least-cost paths; cost-weighted-distance corridors
- [x] Pinch-point detection; corridor centreline tracing
- [x] Saved terrain filter AST with validation; 7 doctrine-encoding presets
- [x] 140 unit tests against closed-form synthetic surfaces
- [x] **Bedding model corrected — `BACKLOG R21`, `R11`, `R22`, 166 tests.**
      Three defects in `beddingLikelihood`, all of which rendered a confident
      colour a hunter would act on: - the cover term was Riley TRI, which correlates with slope _by
      construction_, so every steep cell was rewarded twice — once by the
      slope term and again by "cover". Replaced with Sappington VRM over a
      9×9 window (summed-area, O(n), radius-independent), which is the
      alternative Sappington et al. 2007 built for exactly this reason. - the slope term was a Gaussian peaking at 22°, which contradicted
      `detectBenches`' own geometry and told a user a 10° shelf was worse
      bedding than a 22° sidehill. Now monotone, half-max at 12°, sharing
      `ringSlopeStats` with `detectBenches` so the two cannot drift again. - the only aspect term was leeward geometry, season-blind, so on a south
      wind in January it pointed at north-facing ground — the deepest snow
      and coldest aspect on the property. Now blended with a solar-aspect
      term weighted by temperature, and a **no-op when temperature is
      unset**, asserted bit-identical rather than approximately equal.
      Not closed by this: shelter still dominates the cold-season answer
      (`BACKLOG R31`), and the layer renders dimmer because `HEAT_RAMP` is
      absolute while the model is ordinal (`R32`).

## ✅ Phase 1 — Full-stack foundation

- [x] PostGIS data model: properties, waypoints, observations, filters,
      corridors, offline regions, DEM cache, change log
- [x] `GeometryService` — all spatial SQL in one parameterised place
- [x] JWT auth with rotating hashed refresh tokens; constant-time login
- [x] Property-level RBAC (owner/manager/hunter/observer), 404-not-403
- [x] Terrain API: analysis tiles, filter stacks, point queries, area evaluation
- [x] Corridor solving over whole-property DEM mosaics
- [x] Habitat-selection analytics with availability correction and chi-square
- [x] Photoperiod rut model with per-property calibration
- [x] Stand wind-check blending synoptic wind with modelled thermals
- [x] Offline region estimation with honest pre-download warnings
- [x] MapLibre PWA with `ridgeline://` on-device analysis protocol
- [x] OPFS tile store with IndexedDB fallback; persistent-storage request
- [x] Layer catalogue with exclusivity rules and missing-input handling
- [x] Docker Compose (PostGIS + Redis + API + web); CI
- [x] `packages/design` — design system decoupled from the app: tokens as the
      single source of truth, `tokens.css` generated from `tokens.ts`, drift
      guarded in CI, WCAG-AA and colourblind luminance separation asserted by test
- [x] `ui-integrity-loop` + `catching-ui-defects` skill + automated UI invariants —
      UI recognised as a distinct silent-failure class alongside terrain and offline
- [x] Deep-linkable map positions (`#zoom/lat/lng`) and a Playwright screenshot
      suite that doubles as the only end-to-end proof of the DEM → worker →
      canvas → MapLibre pipeline
- [x] `game-biologist` agent + `docs/EVIDENCE.md` — every biological parameter
      graded Measured / Inferred / Doctrine / Assumed with sources

## 🚧 Phase 2 — Property workflows and field capture

The gap between "the engine is right" and "a hunter can use it on Saturday".

- [x] **`R90` — the desktop rail (Direction C), replacing the drawer the
      founder called "really hard to work with".** Measured: the old drawer
      was `width: 360px`, pinned top-left, running to the command bar — 24.6%
      of a 1440×900 window permanently hidden while open, and the only route
      to Layers/Stands/Sightings, so in practice it stayed open. The founder
      reviewed three chrome directions and picked C: a 240px translucent rail
      (`rgb(10 15 20 / 0.86)`, `blur(10px)` — new `glass['bg-rail']`/
      `['blur-rail']` tokens) docked to the right edge, full height, with
      everything reachable **with no scrolling** — base map as a Sat/Topo
      segmented control, layers as a two-column grid of compact `LayerChip`s
      (label + state dot, blurb moved to hover/focus rather than deleted —
      `demSourceHonesty.test.ts`/`layers.test.ts` still exercise the same real
      strings), elevation source as a registry-driven segmented control, then
      Wind/Thermals/Time rows and a Layers/Stands/Sightings segmented control
      pinned to the bottom. Zoom/locate/offline and MapLibre's scale +
      attribution move to a cluster left of the rail — attribution used to
      default to `'bottom-right'` unconditionally, which the rail would have
      painted straight over (`MapView.tsx`'s new `scaleAnchor` prop pins both
      controls to the same corner, mobile unchanged). Mobile (`≤860px`) is
      untouched byte-for-byte — `useIsDesktopChrome` mounts a genuinely
      different component tree (`DesktopRail.tsx`) above 860px rather than
      reflowing the same one, so `LayersSheet`'s full sentences, opacity
      sliders and legends stay exactly as they were for the drawer/bottom-sheet
      chassis. New invariants (`ui-invariants.spec.ts` groups 4b, 14, 15, 16)
      assert the rail's control population never needs to scroll at 1440×900
      **and** 1280×800, that no chrome surface may cover more than 20% of the
      viewport width (proven non-vacuous against a synthetic 360px drawer,
      which measures 25%), and that wind/date/thermals and the docked Stands/
      Sightings panel behave exactly like the old tabbed drawer did. Caught a
      real bug along the way: the rail's own `overflow: hidden` clipped the
      wind popover's hit-testing (`N`/`S` on the compass hit-tested to the map
      canvas underneath) — the exact class of defect this suite exists for,
      fixed the same way `.rl-conditions` already documents (no
      `overflow: hidden` on a container something anchors a popover inside).
      `species-invariants.spec.ts`'s R84 blocked-chip test now also covers the
      desktop chip (hover-reveal reason, disabled checkbox, forced click
      provably does nothing) alongside the unchanged mobile `ToggleRow` case.

- [x] **`R92` — the rail's two-up chip grid was truncating most labels it
      showed** (founder review of `01-desktop-relief.png`, same day: "Saddles
      & dr...", "Bedding likeli...", all seven saved-filter names). Collapsing
      to one column, the founder's own proposed fix, was measured and does not
      fit either budget viewport — the two grids need ~910px of content
      height against a ~589–689px box, a shortfall nothing else in the rail
      can close. Fixed by letting `.rl-chip-row__text` wrap onto a second line
      inside the same 44px-floor row instead of truncating (a single line of
      `--text-xs` never used that floor's full headroom), plus three small
      measured trims elsewhere in the rail's own spacing to buy back the room
      the wrap needs at 1280×800. New invariant (`ui-invariants.spec.ts` group
      14b) asserts no rail label's `scrollWidth` exceeds its `clientWidth`,
      proven non-vacuous against both the pre-fix layout and a synthetic
      fixture; groups 14 and 15 (fit, no-scroll, coverage ceiling) still pass
      unchanged and un-tuned.

- [x] **`R83`'s web half, plus `R84` — the rut refusal actually renders, a
      hunter can state a target species, and the elk-invalid bedding layer
      greys out.** Closes the gap the previous entry left open. `PropertyRutReading`
      (`lib/api/types.ts`) is now the real `RutResult` union from
      `@hunt-maps/shared` — `RutReading | RutUnsupported` — so a caller that
      reaches for `.phase` on the refusal branch fails to compile rather than
      rendering `undefined` or a stale whitetail phase; `propertyFormat.ts#formatRut`
      returns a matching discriminated `FormattedRut`, and `PropertyDetailScreen`/
      `PropertiesListScreen` render an explicit "No rut model for elk" (with the
      real reason) instead of silently showing nothing, which is what an elk
      property got before this pass. `targetSpecies` — added server-side in the
      previous entry but unreachable from the UI — now has a control: a select
      on `PropertyCreateScreen` and an inline one on `PropertyDetailScreen`,
      both offering **"Not stated" as a first-class, un-nagged choice**, and
      neither offering a path back to it once a species is set (matching
      `PropertiesService.update`'s own contract — there is no `targetSpecies:
null` on the wire). **`R84`** (`docs/EVIDENCE.md` Pass 7 §2 — Millspaugh
      et al. 1998 found slope did not discriminate elk bed sites from random
      ground at all): the bedding likelihood layer now greys out via the exact
      `ToggleRow.blockedReason` mechanism a missing wind direction already
      uses (`lib/layers.ts`'s new `speciesCaveat`/`speciesBlockedReason`),
      naming the actual finding rather than a shrug, and deliberately **not**
      dressed as a `Confidence` "assumed" chip — an absent model is a different
      claim than a graded guess. "Not stated" is verified to leave whitetail
      behaviour byte-identical (a regression this pass pins explicitly). New
      Playwright suite `species-invariants.spec.ts` proves this against
      rendered state (a real `toBeDisabled()`, a forced click that provably
      does nothing, painted text) at 390px and desktop, not just the unit
      tests. **`R85` (corridor greying) is not shippable yet**: there is no
      corridor UI in `apps/web` to grey out — "Corridor UI: pick two areas,
      solve, see band + pinch points" below is still unbuilt — so the
      species-blocking mechanism is ready (`speciesBlockedReason` is generic
      over any `LayerDefinition`) but has nothing to attach to until that lands.

- [x] **`Property.targetSpecies` — the second half of `R83`'s P0.** `93a29ca`
      made `readRut` refuse for species it has no evidentiary basis for, but
      `Property` had no species field, so `PropertiesService.list`/`get`
      still always resolved to the whitetail overload — an elk property, the
      founder's own Montana HD 320, kept rendering a whitetail-calendar rut
      phase as fact. Added `Property.targetSpecies Species?` (migration
      `20260811000000_property_target_species`), threaded through
      `PropertiesService` via `propertyRut()`. **The default is nullable, not
      `WHITETAIL`, and deliberately so** — see the migration's own comment:
      defaulting existing rows to whitetail would have re-asserted the exact
      assumption that caused the bug. `centerLat === null` or
      `targetSpecies === null` both withhold the reading (`rut: null`) rather
      than falling back to `readRut`'s species-omitted default, per
      CLAUDE.md's "say when you do not know". A stated species — elk, above
      all — now reaches `readRut`'s refusal (`RutUnsupported`) and it
      actually reaches the API response. `CreatePropertyDto`/`UpdatePropertyDto`
      gained an optional `targetSpecies` so an owner can state one.
      Verified against both an empty database and one seeded with pre-existing
      property rows. **Web is not yet wired**: `apps/web/src/lib/api/types.ts`'s
      `PropertyRutReading` needs to become the `RutResult` union,
      `propertyFormat.ts`'s `formatRut` needs a `supported: false` branch, and
      `PropertyDetailScreen.tsx`/`PropertiesListScreen.tsx` need to render it —
      tracked as the remainder of `R83` for `frontend-builder`/`map-builder`.

- [x] **1 m LiDAR is tap-reachable — an elevation source picker, not a rebuild.**
      `R79`'s second half. `LayersSheet` gains an Elevation source section with
      three rows sourced from the `DEM_SOURCES` registry, so the copy cannot
      drift from the honesty guards. Coverage is **answered, not assumed** — a
      hook calls `GET /terrain/dem/coverage` for the map centre with the same
      staleness discipline as `useViewportCoverage`, and the 1 m row reads
      "No 1 m data here" **only on a definite negative**; "checking" and "server
      unreachable" never masquerade as absence. Switching persists a runtime
      override and reloads, so all ~10 files reading `DEM_SOURCE` as a plain
      constant agree by construction rather than by discipline, and the picker
      warns _before_ the switch that offline regions do not carry over.
      **A real overclaim was caught on the way in:** `VITE_DEM_TEMPLATE` won over
      `DEM_SOURCE` unconditionally, so a hunter tapping "1 m LiDAR" on a
      self-hosted deployment with a Terrarium mirror configured would have kept
      fetching Terrarium under a LiDAR label — `a02793d`'s overclaim through a
      second door. The template override now applies only while `terrarium` is
      active, pinned by a regression test verified failing against the old
      logic. The `multiHillshade` blurb no longer denies LiDAR service once a
      LiDAR source is active; its guard was previously green only by vacuity.
      Web tests 343 → 362, and the picker was verified **in the built Docker
      image**, not the source tree.

- [x] **The layers actually render — every deployed image had no DEM at all.**
      The founder's report was "none of the layers are working", and it was
      exactly true. `ARG VITE_DEM_TEMPLATE=""` left the variable defined and
      **empty** in every image; `demSource.ts` used `??`, which falls back only
      on null/undefined, so Vite inlined `""` and every tile URL resolved to the
      empty string. No elevation, therefore no hillshade, slope, aspect,
      landform, bedding or corridors — and **nothing threw**. Proven by grepping
      the built bundle: unset → the Terrarium URL is present; `=""` → zero
      occurrences. It survived because that configuration exists only inside the
      container: dev and CI leave the variable unset, so every web test passes
      against a code path production never takes. Fixed at the resolver, at the
      Dockerfile, and with a loud failure for a template that cannot address a
      tile. The structural gap it exposed — CI never builds or runs the image —
      is tracked as `R81`.

- [x] **Real USGS 3DEP elevation is decodable — the reader, not the wiring.**
      `R77`, first half. Verified against a real staged product rather than a
      fixture: a 10012² float32 COG, LZW with the floating-point predictor,
      EPSG:26916 — two range requests (8 KB header, ~570 KB tile) returned
      84.45–87.00 m in 870 ms out of a 485 MB raster. Zero dependencies, so the
      Transverse Mercator is closed-form (Snyder PP 1395, round-trip pinned to
      ~1 cm). **The datum risk was measured and disproved:** 196 points in each
      of three relief classes gave sub-metre, sign-inconsistent offsets with
      scatter growing with relief — resampling error, not a ~30 m datum step, so
      both sources are orthometric and no geoid conversion is needed.
      **Explicitly not finished:** the modules are now exported, but nothing
      _renders_ from them yet — the map still draws Terrarium, and no `readRange`
      is wired to `fetch` in the worker or to the API. 1 m coverage is
      addressable only given an acquisition project, because USGS's own index for
      it is a 1.9 GB GeoPackage. Where no project is known the answer is "no 1 m
      data here", never a silent fall back to 10 m dressed up as LiDAR. Terrain
      tests 283 → 337, including a `CogReader` suite that samples a closed-form
      plane exactly, reads outside the raster and inside voids as NODATA rather
      than interpolating, and pins that the raw `-999999` sentinel never escapes
      as a finite elevation — the finite-NODATA class this repo has been bitten
      by six times.

- [x] **A deploy is actually visible — cache headers, not code.** Reported from
      the field: the release was published and the UI did not change. Nothing
      was red — CI passed, `release.yml` published `hunt-maps-web:latest`, the
      container ran the new image. The defect was entirely in cache policy.
      `index.html` is the only unhashed file naming the hashed bundles, and it
      carried **no `Cache-Control` at all**, so browsers applied heuristic
      freshness and served it without asking; it then pointed at the previous
      `/assets/` hashes, which are correctly `immutable` for a year. A correct
      release was therefore invisible to anyone who had already loaded the site,
      **and stayed invisible**. Fixed at both layers, because either alone still
      fails: `nginx.conf` now revalidates `index.html` and refuses to store
      `registerSW.js` and the manifest alongside `sw.js`; and `swUpdate.ts`
      reloads once when a service worker _replaces_ an existing one, which is
      what makes `registerType: 'autoUpdate'` reach a tab that is already open.
      Deliberately narrow — it cannot fire on first install, cannot fire
      offline, and queued writes survive it because the queue lives in
      IndexedDB. 6 new assertions read the shipped `nginx.conf` (the same file
      baked into the image); proven non-vacuous by reverting the config, 3 red.
      321 web tests.

- [x] **The doors actually open — the tabbed drawer.** The three panels were
      built, tested, and mountable by nothing. `App.tsx` now tracks a
      `drawerTab` rather than a `sheetOpen` boolean, with a `TabBar` primitive
      switching Layers / Stands / Sightings **inside the one drawer slot** —
      not a third `CommandBarCell`, per the note that block has carried since
      `R44`, because two stacked `.rl-sheet`s overlap exactly and the lower one
      becomes an `elementFromPoint` trap. Switching tabs fully unmounts the
      previous panel, and the invariant asserts `.rl-drawer .rl-sheet` is
      always exactly 1. **`propertyId` is never fabricated** — null until the
      user picks, persisted per user so a shared device cannot leak one
      account's choice into another, and re-validated against the live list so
      a deleted property falls back to asking. Filing a hunter's observations
      against someone else's ground is the failure that prevents. 11 new
      invariants prove wind/date/thermals stay reachable on **every tab at
      390×844** — `R42`'s lesson, held. `Button variant="link"` was fixed at
      source after two agents worked around the same sub-44px box
      independently.

- [x] **The product has doors — properties, stands, observations and the
      saved-filter editor.** 163 → **308 tests** in one wave, three agents on
      disjoint territories. Boundary drawing refuses a self-intersecting or
      degenerate ring **client-side, by name**, rather than round-tripping into
      `ST_MakeValid`'s silent repair — a repaired boundary is a different piece
      of ground than the one that was drawn. Redrawing one requires an explicit
      acknowledgement every time, because `PropertiesService.update`
      unconditionally drops the cached `TerrainProfile` and every availability
      denominator is keyed to it. `BlankSitQuickLog` is one button, because if
      logging a zero-sighting sit takes a form nobody logs one and every
      sightings-per-sit number downstream measures how often somebody went out
      instead. The filter editor's `MatchShare` refuses to call its endpoint at
      all rather than show a number it cannot stand behind.

      Property routes are wired; the stands, observations and filter panels are
                                                  built and tested but **not yet reachable** — the `CommandBar` documents
                                                  that a fourth and fifth cell is the wrong answer and they belong as tabs
                                                  in the single drawer slot, which is a design decision rather than
                                                  plumbing. Tracked, not forgotten.
                                  built and tested but **not yet reachable** — the `CommandBar` documents
                                  that a fourth and fifth cell is the wrong answer and they belong as tabs
                                  in the single drawer slot, which is a design decision rather than
                                  plumbing. Tracked, not forgotten.

- [x] **The app can finally call its own backend — and a terrain readout that
      says when it does not know.** `apps/web` had **no API client, no auth and
      no query layer**: 39 backend routes across properties, waypoints,
      observations, filters, analytics and offline had no caller, which is why
      this looked like a product with a strong engine and no doors. React Query
      and React Router had been dependencies, unused, since the app was
      scaffolded. Now: a single `apiFetch` with typed `ApiError` kinds,
      single-flighted token refresh (the refresh tokens rotate, so two
      concurrent 401s would otherwise log a user out), an offline write queue
      keyed on `clientId` that keeps a 409 conflict rather than resolving or
      dropping it, and login/register screens. **A network failure never reads
      as a signed-out failure** — the distinction is pinned by test, because
      conflating them puts a login screen in front of someone with no bars.
      Alongside it, `R6`: the terrain readout as a peek-detent sheet, with a
      `Reading<T>` type carrying the engine's abstention semantics to the pixel
      so `flat` (a real measurement) never renders as `unmeasured` (a data gap).
      120 → 163 unit tests, plus a new 20-assertion `auth-invariants` suite.

      Three defects found by rendered-state harnesses that every DOM query
                                                  passed: a voided cell rendering **`-107507 ft`** because
                                                  `Number.isFinite(-32768)` is `true` — the same finite-sentinel
                                                  misconception as `R49`, now confirmed in all three packages; a
                                                  drag/click race where the browser's synthetic `click` after `pointerup`
                                                  made a dismiss-drag also fire a tap-toggle; and a register-screen link
                                                  measuring 35×44 px against the 44 px gloved-use floor.
                                  passed: a voided cell rendering **`-107507 ft`** because
                                  `Number.isFinite(-32768)` is `true` — the same finite-sentinel
                                  misconception as `R49`, now confirmed in all three packages; a
                                  drag/click race where the browser's synthetic `click` after `pointerup`
                                  made a dismiss-drag also fire a tap-toggle; and a register-screen link
                                  measuring 35×44 px against the 44 px gloved-use floor.

- [ ] **Front-end direction chosen: A, "The Field Instrument" — `BACKLOG R63`.**
      The brief was that the UI "looks generic" and "doesn't feel considered" —
      identity and craft, not information architecture. Three concepts were built
      blind and a fourth explored as a hybrid; the founder chose A unmodified.
      `docs/design/direction-a-instrument.html` is the spec,
      `docs/design/PLAN-direction-a.md` the plan. Worth recording that **B and C
      converged independently** on chrome drawn as if printed on the map sheet,
      inside a neatline — which is what made A, the dark instrument panel, the
      genuinely different option rather than one of three variations. The
      exploration paid for itself in two findings that outlive it: both sibling
      files shipped a defect invisible to every DOM query — B painted every layer
      row's name on top of its description, from a `line-height: 0` that
      inherited into every text box, and D rendered on-map text in paper ink over
      a mid-grey raster. Both are now new invariant classes in the plan. And D
      established that a light theme over a frozen map has **two grounds, not
      one** — the panel's and the raster's — so one ink token cannot serve both;
      anyone attempting a day mode later inherits that.

      **Slices 1–2 shipped** (`f56241a`): the `plate` token group — a new group
                                  rather than a `glass` variant, or `Popover` inherits a blur change
                                  nobody asked for — and the first `Confidence` chip, on the bedding
                                  row, closing `R61`'s "used in exactly zero places" for one surface
                                  with a regression test so it cannot drift back.

                      **Slice 3, the `Dock`, is committed at `0947a43` and not accepted.**
                                  `code-reviewer` returned "do not merge as-is" on four blocking
                                  items, and the plan's §c content model — the always-visible Base /
                                  Relief / Terrain-analysis sections that are the *reason* a dock
                                  earns 300px — was not built. What shipped is the existing tabbed
                                  drawer nested inside a new chassis, which shrank the desktop Layers
                                  panel from ~780px to a 320px nested scroller: the first real
                                  desktop screenshot shows **one** layer row before the fold, out of
                                  ten. The chassis itself is sound work (`overflow-y: auto` from day
                                  one, `inert` on collapse, a labelled collapse control per F4) and
                                  the reconciliation reasoning — that the tabbed drawer post-dates
                                  §c — is correct and worth keeping. The open decision is whether to
                                  build §c's content model or restore the drawer to full height;
                                  it is the founder's, and it is open. Blockers tracked as `R80`.

                      Recorded because it cost this pass real time: the commit claimed
                                  screenshots it could not have taken. `chrome-shots.spec.ts` drove
                                  the chrome by `role=button` "Layers", which the dock makes
                                  `visibility: hidden` — correctly out of the accessibility tree, so
                                  the locator matched zero elements and all four desktop captures hung
                                  the full 180s timeout. **A UI commit that cannot photograph itself
                                  has no visual gate at all**, and the stale shots left on disk showed
                                  the chrome the commit had just deleted. Fixed here; the four real
                                  shots are in `apps/web/screenshots/chrome/`.

- [x] **P0 SHIPPED — `offlineReady` replaced with per-viewport coverage truth**
      (`BACKLOG R8`). The boolean was sampled once at mount and rendered behind
      "elevation for **this area** is stored on this device"; it stayed green
      five hundred miles away. Now six states, each claiming exactly one thing:
      `Checking…` (nothing — and no code path carries a previous view's answer
      into a new one), `Covered` (every tile this view draws from, no rounding
      slack — 34 of 35 is Partial), `Partial — n%` with a hatched extent on the
      map, `Detail missing` (covered at this zoom, gaps at z15 — works now,
      blank when you zoom in), `Not downloaded`, and `Storage unreadable`
      (deliberately _not_ collapsed into "0% covered" — those call for
      different actions). - The needed-tile set is derived **once**, in `lib/map/demTiles.ts`, and
      `demTileKey()` is shared with `terrainProtocol.fetchDem`, so the
      coverage probe and the actual fetch cannot look in different places.
      A disagreement there would have replaced R8's lie with a subtler one. - Exact when it can be (~8–35 tiles for a real viewport, every one
      probed); stride-sampled above 256, and then the label _says_ so with
      an `≈` prefix rather than presenting an estimate as a count. - Five e2e invariants at 1440px **and** 390px, asserted on rendered
      state. Verified to fail against the defect: with the mount-sampled
      boolean restored, the recorded chip sequence after a 500-mile offline
      pan was `["COVERED"]`; with the fix, `["CHECKING…","NOT DOWNLOADED"]`. - Three further defects found and fixed en route, all invisible to the
      unit suite: the overlay **never installed offline at all** (it gated on
      `isStyleLoaded()`, which is false while any source has tiles in flight
      — permanently, with no signal — then retried on an event that had
      already fired); `syncLayers` deleted the overlay on any layer toggle
      because it shares the `rl-*` prefix; and the probe cap could overrun
      itself, which is not a cap on a phone mid-pan. - Verified by hand through a real browser on the path that actually
      matters: download, **close the page**, go offline, **cold load**.
      Not `navigator.onLine`, and not a warm context.
      Still open: neighbour tiles outside the view are not counted, so a hunter
      standing exactly on a download boundary can see a seam the badge did not
      warn about (`BACKLOG R34`). `R4`, the region picker that lets a hunter act
      on any of this, shipped in the same phase — see below.
- [x] **Map chrome fixed at the root — `BACKLOG R42`/`R43`/`R45`.** The
      founder reported the left rail as "really hard to work with"; two
      independent audits found _different_ causes and both are closed.
      Opening Layers on a phone had been hiding the wind control, so the
      wind-sweep — the interaction no competitor has — could not be performed
      on the device this product is for; it took eight steps with a mandatory
      panel-close, and now takes three with none. Separately the mobile rail
      was ~88% dead space that looked pressable (a definite-width flex child
      in a stretched container), surplus 322.0px → 2.0px, with `:active`
      states added across the design system where there had been none for any
      button. Invariants 49 → **62**: collision checking now runs at both
      viewports instead of desktop-only, and a new group compares painted
      surface against interactive surface — the gap that let a control look
      three times larger than it was.
- [x] **The rail is gone — `CommandBar`, `BACKLOG R44`.** The structural half
      of the founder's "left side bar is really hard to work with": the P0
      symptoms shipped first, this removes why they were possible. The drawer's
      clearance used to be `calc(var(--space-touch) * N + ...)` where N _was_
      the button count, hand-written in a file that did not contain the
      buttons — so a fourth button silently overlapped, and `R42` had to
      duplicate that arithmetic into three places. It is now one token,
      independent of cell count. Cells are `flex: 1 1 0` with no explicit
      width, which makes `R43`'s dead-zone defect **structurally impossible**
      rather than merely fixed, and every control now carries a visible word
      instead of an icon and a `title` that touch devices never show. Bottom
      chrome at 390px: 216px → ~128px, ~88px of map back.
- [x] Property boundary drawing and editing on the map — `BoundaryEditor.tsx`,
      `PropertyBoundaryEditScreen.tsx`, `PropertyBoundaryPreview.tsx`
- [x] Waypoint placement UI — stands, cameras, sign — with type-aware forms
      (`WaypointForm.tsx`, `WaypointsSheet.tsx`, `WindCheckCard.tsx`)
- [x] Observation capture optimised for gloved, one-handed, in-the-field use
      (`ObservationForm.tsx`, `BlankSitQuickLog.tsx`, `ConditionsFields.tsx`)
- [x] Saved-filter editor: build a predicate visually, see match share live
      (`FilterEditor.tsx`, `PredicateNode.tsx`, `MatchShare.tsx`,
      `useLiveMatchShare.ts`) — **the moat, and it is built**
- [x] **Offline region picker — `BACKLOG R4`, the front door `R8` was missing.**
      `R8` shipped honest coverage reporting and the button to act on it was
      `onClick={() => undefined}`. Pick an area, see the estimate, download
      resumably, watch the badge go `Covered`. - The picker, `R8`'s coverage probe and the analysis fetch path all
      enumerate tiles through **one** function, so what you download and what
      the badge counts cannot diverge. - Sends `layers: ['elevation']` — the truth — and therefore exposes that
      our own API has no elevation byte cost and reports 10× low. Size comes
      from a figure **measured off 114 real tiles**; a 361-tile region
      estimated 36.1 MB and stored 36,835,835 bytes. - Resume re-probes every planned tile rather than trusting a cursor: a
      dead battery and a browser eviction look identical from outside and
      both must be repaired. - Cold-started **offline**, from nothing, over downloaded ground —
      hillshade rendered from cached elevation. Persistent storage was
      refused here and the chip says so rather than assuming.
      Web tests 63 → 115, invariants 34 → 49. Its own invariants caught three
      real defects, including a download button that hit-tested to `null`
      below the fold and an action bar that was visible and unclickable.
- [ ] Corridor UI: pick two areas, solve, see band + pinch points
- [x] Terrain readout on long-press, rebuilt as a peek-detent sheet with a map
      marker rather than a floating dialog (`TerrainReadout.tsx`, `R6`)
- [x] `apps/web/e2e/ui-invariants.spec.ts` — automated UI invariants suite:
      **26 tests, all passing** (was 16/24 on its first run). Fixed and
      verified: chrome text now clears WCAG AA measured against a live map
      background (was 2.55:1 against the 4.5:1 requirement), touch targets
      meet the 44px gloved floor, the Layers button no longer moves when its
      own sheet opens, and the layers sheet and wind popover can be open
      together without colliding.

      The suite's own helper was fixed twice. First (`67f0098`) for deciding
                                                              hit-testability against the viewport alone, so a row scrolled just past
                                                              the *sheet's* clipped edge was hit-tested at its unpainted position and
                                                              reported as visible-but-unclickable — a false failure indistinguishable
                                                              from the real clipping bug the suite is named after; it now intersects
                                                              against every clipping ancestor and hit-tests the centre of the visible
                                                              region. Ground truth was measured before accepting the greener result:
                                                              `.rl-sheet__body` clips at y=719, `.rl-rail` sits top-right at y 12–148,
                                                              and no painted control fails a hit test. Then (`7ff42cee`) two more
                                                              guards on the helper itself: a synthetic fixture pinning both branches
                                                              of the clipped-ancestor fix so neither can regress silently, and a check
                                                              that the collision matrix's "no collision" result means a selector
                                                              matched and did not overlap, not that a renamed selector stopped
                                                              matching anything.
                                              hit-testability against the viewport alone, so a row scrolled just past
                                              the *sheet's* clipped edge was hit-tested at its unpainted position and
                                              reported as visible-but-unclickable — a false failure indistinguishable
                                              from the real clipping bug the suite is named after; it now intersects
                                              against every clipping ancestor and hit-tests the centre of the visible
                                              region. Ground truth was measured before accepting the greener result:
                                              `.rl-sheet__body` clips at y=719, `.rl-rail` sits top-right at y 12–148,
                                              and no painted control fails a hit test. Then (`7ff42cee`) two more
                                              guards on the helper itself: a synthetic fixture pinning both branches
                                              of the clipped-ancestor fix so neither can regress silently, and a check
                                              that the collision matrix's "no collision" result means a selector
                                              matched and did not overlap, not that a renamed selector stopped
                                              matching anything.

- [x] Deploy the `Confidence` primitive into the app (`BACKLOG R10`) — now used
      in **15** places across `apps/web`, including `TerrainReadout.tsx` and
      `LayersSheet.tsx`. This row read "used in zero places" long after that
      stopped being true, which is the drift non-negotiable #6 is about.

- [x] **`pnpm dev` starts the API again.** The documented dev loop was dead from
      a clean checkout: `nest start --watch` compiled cleanly, printed "Found 0
      errors", then exited with `Cannot find module '.../dist/main'`. The cause
      is a real consequence of a deliberate choice — `apps/api/tsconfig.json`
      maps `@hunt-maps/*` at the packages' TypeScript _source_ so `tsc --noEmit`
      typechecks without building them first, which pulls those files into the
      program, moves tsc's common source directory to the repo root, and emits
      `dist/apps/api/src/main.js`. The `start` script already hard-coded that
      path; only `nest start` still assumed a flat `dist/`, so the watch loop had
      never worked while `pnpm build` and `pnpm start` both did. Fixed with
      `entryFile` in `apps/api/nest-cli.json`. Same shape as the
      `VITE_DEM_TEMPLATE` bug above — **a configuration nothing in CI
      exercises**, since CI builds and tests but never runs `pnpm dev`.

## ⬜ Phase 3 — Closing the scorecard gaps

- [ ] Public-land boundaries (PAD-US) _(🔴)_
- [ ] Parcel / ownership layer _(🔴)_
- [ ] Weather integration — auto-populate conditions on observations _(🔴)_
- [ ] NLCD land-cover layer wired into corridor resistance
- [ ] Contour generation from the DEM
- [ ] Hunting-party sharing UI (roles exist server-side) _(🟡)_

## ⬜ Phase 4 — Deep analytics

- [ ] Movement analytics dashboard (API exists; UI pending)
- [ ] Stand performance ranking, effort-normalised
- [ ] Access-route scent analysis — walk-in exposure scoring
- [ ] Season-over-season comparison
- [ ] Rut calibration surfaced from the user's own observation history
- [ ] Trail-camera import and photo-derived observations _(🔴)_

## ⬜ Phase 5 — Depth and reach

- [ ] 3D terrain view with vertical exaggeration
- [ ] Viewshed analysis from a stand position
- [ ] Native mobile wrappers _(🟡)_
- [ ] Filter sharing marketplace
- [ ] GPS-collar dataset validation of the bedding and corridor models
