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

---

## Ready

| # | Item | Pri | Size | Owner | Rationale |
|---|------|-----|------|-------|-----------|
| R1 | Property boundary drawing on the map | P0 | M | `frontend-builder` + `map-builder` | Nothing works without a boundary: it is the availability denominator for every selection analytic. Currently API-only. |
| R2 | Saved-filter visual editor with live match share | P0 | L | `frontend-builder` | The core interaction of the product is currently reachable only through the API. Presets are visible but not editable. |
| R3 | Waypoint placement + type-aware forms | P0 | M | `frontend-builder` | Stands and cameras are the second thing a user does after drawing a boundary. |
| R4 | Offline region picker UI | P0 | M | `offline-steward` | Estimation and warnings exist server-side with no way to trigger them. This is the headline feature with no front door. |
| R5 | Observation capture, field-optimised | P1 | M | `frontend-builder` | Gloved, one-handed, dark. Feeds every analytic. |
| R6 | Terrain long-press readout | P1 | S | `map-builder` | API complete; the card is a stub. Cheapest visible win available. |
| R7 | Corridor solve UI | P1 | L | `map-builder` | Differentiating capability, currently API-only. |

## Next

| # | Item | Pri | Size | Rationale |
|---|------|-----|------|-----------|
| N1 | PAD-US public-land layer | P1 | M | 🔴 scorecard gap; table stakes for public-land hunters |
| N2 | Weather API integration | P1 | M | 🔴 gap; manual condition entry will not be done consistently, and every weather analytic depends on it |
| N3 | NLCD layer + corridor resistance wiring | P1 | M | Resistance mapping exists in the engine but nothing supplies the raster |
| N4 | Movement analytics dashboard | P1 | L | API complete; the deep-analytics promise is invisible |
| N5 | Parcel / ownership layer | P2 | L | 🔴 gap; likely needs a commercial data source — evaluate first |
| N6 | Contour generation from DEM | P2 | M | Users expect contours on a hunting map |
| N7 | Hunting-party sharing UI | P2 | M | 🟡 roles exist server-side |
| N8 | Replace Tobler with a cervid energetics curve | P1 | M | `docs/EVIDENCE.md`: the corridor cost model is parameterised from a **human** hiking function. Brockway (red deer, 2.6 J·kg⁻¹·m⁻¹) and Fancy & White (caribou ascent cost, 40–45% upslope efficiency) make a cervid curve buildable today. Highest-value evidence upgrade available. |
| N9 | Model escape terrain (≥10% slope) as facilitating movement | P1 | S | Landscape-genomics work found gene flow over longer distances where ≥10% slope was available. The cost surface currently penalises all grade monotonically. |
| N10 | Surface `Confidence` chips on bedding, thermal and scent outputs | P1 | S | Three headline layers rest on 🔴 Assumed parameters. The design system primitive exists; the layers do not use it. Claiming more than we know is the one thing that costs us the trust moat. |
| N11 | Source or honestly grade the scent-dispersion model | P2 | M | 400 m at a 25° half-angle has no source. Either find a dispersion model or grade it Assumed in the UI. |
| N12 | Handle mobile vs sedentary bucks | P2 | M | GPS-collar work: ~⅓ of bucks are "mobile" (mean 6,530 ha) and will not be described by any property-scoped model. The app currently implies every deer is resident. |
| N13 | Scope models per species, or narrow the claim to whitetail | P1 | M | Every biological parameter in the engine is whitetail-derived, but the product claims "deer or other large game". Silent borrowing across mule deer/elk/blacktail is wrong. |

## Investigate

| # | Question | Why it matters |
|---|----------|----------------|
| I1 | Do bench thresholds need to scale with regional relief? | A bench in the Driftless is not a bench in the Rockies. Fixed thresholds may be wrong outside the Midwest. |
| I2 | Does rut calibration converge within one season? | Currently needs ≥3 chasing observations; unproven that a normal user produces enough. |
| I3 | Can we obtain GPS-collar data for validation? | Would move the bedding and corridor models from well-motivated to demonstrated. Highest-value research step available. |
| I4 | Sub-canopy structure for corridor resistance | NLCD at 30 m misses regen thickets and CRP edges, which matter more to deer than the NLCD class. |
| I6 | Can we obtain GPS-collar telemetry for model validation? | Would settle bedding slope, corridor use, shelter thresholds and the resistance table in one dataset — more red rows in `docs/EVIDENCE.md` than everything else combined. |
| I5 | Enforce geometry NOT NULL via transaction + deferred constraint trigger | Geometry columns are nullable because Prisma cannot create rows with required `Unsupported()` columns and a bare NOT NULL would reject the insert. Today the invariant is upheld only by service code. |

## Done — recent

- [x] Terrain engine with 140 closed-form tests (Phase 0)
- [x] PostGIS backend, auth, RBAC, terrain/analytics/offline APIs (Phase 1)
- [x] MapLibre PWA with on-device analysis and OPFS tile storage (Phase 1)
- [x] Fixed: curvature plan/profile sign inversion (would have inverted every
      draw/spur layer and made the thermal-sink filter select ridge tops)
- [x] Fixed: `standardize()` amplifying float noise into fake landform classes
      on uniform ground
- [x] Fixed: `sunTimes()` returning a negative day length west of Greenwich
