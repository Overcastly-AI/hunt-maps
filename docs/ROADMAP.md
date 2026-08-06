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

- [ ] **P0 — fix `offlineReady`, a global boolean sampled once at mount that
      tells a hunter an area is downloaded when it is not** (verified defect,
      `BACKLOG R8`; this is the exact field failure CLAUDE.md calls the worst
      this product has)
- [ ] Property boundary drawing and editing on the map *(🔴 scorecard gap)*
- [ ] Waypoint placement UI — stands, cameras, sign — with type-aware forms
- [ ] Observation capture optimised for gloved, one-handed, in-the-field use
- [ ] Saved-filter editor: build a predicate visually, see match share live
- [ ] Offline region picker with the estimate and warnings surfaced
- [ ] Corridor UI: pick two areas, solve, see band + pinch points
- [ ] Terrain readout on long-press (API exists; UI pending — rebuild as a
      peek-detent sheet with a map marker, not the current floating dialog)
- [ ] `apps/web/e2e/ui-invariants.spec.ts` — automated UI invariants suite now
      exists and runs: 24 tests, 16 passing. Found 6 real defects (Layers
      button shifting 372px when the sheet it belongs to opens, 32px toggle
      rows and a 22px link below the 44px gloved-touch floor, chrome text at
      2.55–3.48:1 against the 4.5:1 AA requirement). Fixes are in flight with
      two agents as of this pass; suite not yet fully green, not yet
      committed.
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
