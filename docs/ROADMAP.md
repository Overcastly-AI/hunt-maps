# Roadmap — Ridgeline

**Current focus: Phase 2 — property workflows and field capture.**

---

## ✅ Phase 0 — Terrain engine foundation

The analytics engine, validated against analytically-known surfaces.

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
      colour a hunter would act on:
      - the cover term was Riley TRI, which correlates with slope *by
        construction*, so every steep cell was rewarded twice — once by the
        slope term and again by "cover". Replaced with Sappington VRM over a
        9×9 window (summed-area, O(n), radius-independent), which is the
        alternative Sappington et al. 2007 built for exactly this reason.
      - the slope term was a Gaussian peaking at 22°, which contradicted
        `detectBenches`' own geometry and told a user a 10° shelf was worse
        bedding than a 22° sidehill. Now monotone, half-max at 12°, sharing
        `ringSlopeStats` with `detectBenches` so the two cannot drift again.
      - the only aspect term was leeward geometry, season-blind, so on a south
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

- [x] **P0 SHIPPED — `offlineReady` replaced with per-viewport coverage truth**
      (`BACKLOG R8`). The boolean was sampled once at mount and rendered behind
      "elevation for **this area** is stored on this device"; it stayed green
      five hundred miles away. Now six states, each claiming exactly one thing:
      `Checking…` (nothing — and no code path carries a previous view's answer
      into a new one), `Covered` (every tile this view draws from, no rounding
      slack — 34 of 35 is Partial), `Partial — n%` with a hatched extent on the
      map, `Detail missing` (covered at this zoom, gaps at z15 — works now,
      blank when you zoom in), `Not downloaded`, and `Storage unreadable`
      (deliberately *not* collapsed into "0% covered" — those call for
      different actions).
      - The needed-tile set is derived **once**, in `lib/map/demTiles.ts`, and
        `demTileKey()` is shared with `terrainProtocol.fetchDem`, so the
        coverage probe and the actual fetch cannot look in different places.
        A disagreement there would have replaced R8's lie with a subtler one.
      - Exact when it can be (~8–35 tiles for a real viewport, every one
        probed); stride-sampled above 256, and then the label *says* so with
        an `≈` prefix rather than presenting an estimate as a count.
      - Five e2e invariants at 1440px **and** 390px, asserted on rendered
        state. Verified to fail against the defect: with the mount-sampled
        boolean restored, the recorded chip sequence after a 500-mile offline
        pan was `["COVERED"]`; with the fix, `["CHECKING…","NOT DOWNLOADED"]`.
      - Three further defects found and fixed en route, all invisible to the
        unit suite: the overlay **never installed offline at all** (it gated on
        `isStyleLoaded()`, which is false while any source has tiles in flight
        — permanently, with no signal — then retried on an event that had
        already fired); `syncLayers` deleted the overlay on any layer toggle
        because it shares the `rl-*` prefix; and the probe cap could overrun
        itself, which is not a cap on a phone mid-pan.
      - Verified by hand through a real browser on the path that actually
        matters: download, **close the page**, go offline, **cold load**.
        Not `navigator.onLine`, and not a warm context.
      Still open: neighbour tiles outside the view are not counted, so a hunter
      standing exactly on a download boundary can see a seam the badge did not
      warn about (`BACKLOG R34`). `R4`, the region picker that lets a hunter act
      on any of this, shipped in the same phase — see below.
- [x] **Map chrome fixed at the root — `BACKLOG R42`/`R43`/`R45`.** The
      founder reported the left rail as "really hard to work with"; two
      independent audits found *different* causes and both are closed.
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
- [ ] Property boundary drawing and editing on the map *(🔴 scorecard gap)*
- [ ] Waypoint placement UI — stands, cameras, sign — with type-aware forms
- [ ] Observation capture optimised for gloved, one-handed, in-the-field use
- [ ] Saved-filter editor: build a predicate visually, see match share live
- [x] **Offline region picker — `BACKLOG R4`, the front door `R8` was missing.**
      `R8` shipped honest coverage reporting and the button to act on it was
      `onClick={() => undefined}`. Pick an area, see the estimate, download
      resumably, watch the badge go `Covered`.
      - The picker, `R8`'s coverage probe and the analysis fetch path all
        enumerate tiles through **one** function, so what you download and what
        the badge counts cannot diverge.
      - Sends `layers: ['elevation']` — the truth — and therefore exposes that
        our own API has no elevation byte cost and reports 10× low. Size comes
        from a figure **measured off 114 real tiles**; a 361-tile region
        estimated 36.1 MB and stored 36,835,835 bytes.
      - Resume re-probes every planned tile rather than trusting a cursor: a
        dead battery and a browser eviction look identical from outside and
        both must be repaired.
      - Cold-started **offline**, from nothing, over downloaded ground —
        hillshade rendered from cached elevation. Persistent storage was
        refused here and the chip says so rather than assuming.
      Web tests 63 → 115, invariants 34 → 49. Its own invariants caught three
      real defects, including a download button that hit-tested to `null`
      below the fold and an action bar that was visible and unclickable.
- [ ] Corridor UI: pick two areas, solve, see band + pinch points
- [ ] Terrain readout on long-press (API exists; UI pending — rebuild as a
      peek-detent sheet with a map marker, not the current floating dialog)
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
- [ ] Deploy the `Confidence` primitive into the app — it exists in
      `packages/design`, is documented, and is used in **zero** places in
      `apps/web` (`BACKLOG R10`)

## ⬜ Phase 3 — Closing the scorecard gaps

- [ ] Public-land boundaries (PAD-US) *(🔴)*
- [ ] Parcel / ownership layer *(🔴)*
- [ ] Weather integration — auto-populate conditions on observations *(🔴)*
- [ ] NLCD land-cover layer wired into corridor resistance
- [ ] Contour generation from the DEM
- [ ] Hunting-party sharing UI (roles exist server-side) *(🟡)*

## ⬜ Phase 4 — Deep analytics

- [ ] Movement analytics dashboard (API exists; UI pending)
- [ ] Stand performance ranking, effort-normalised
- [ ] Access-route scent analysis — walk-in exposure scoring
- [ ] Season-over-season comparison
- [ ] Rut calibration surfaced from the user's own observation history
- [ ] Trail-camera import and photo-derived observations *(🔴)*

## ⬜ Phase 5 — Depth and reach

- [ ] 3D terrain view with vertical exaggeration
- [ ] Viewshed analysis from a stand position
- [ ] Native mobile wrappers *(🟡)*
- [ ] Filter sharing marketplace
- [ ] GPS-collar dataset validation of the bedding and corridor models
