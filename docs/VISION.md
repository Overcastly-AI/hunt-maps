# Vision — Ridgeline

## The thesis

**The best hunting terrain-analytics platform in the world — open, self-hosted,
offline-first.**

Every hunting app on the market ships terrain *visualisation*: LiDAR relief,
slope shading in bands somebody else chose, a 3D view. None ships terrain
*analysis* the user can define, name, save, and reason with.

The operating question every decision answers:
**"Would a serious whitetail hunter switch to this and never go back?"**

## The four structural advantages

### 1. Real analysis, not a shading toggle
An actual DEM/LiDAR engine — Horn slope, Evans–Young curvature, Weiss landform
classes, Wood morphometric features (**saddles**), bench detection, NOAA solar
insolation, thermal phase, leeward bedding likelihood, anisotropic least-cost
movement corridors with pinch-point extraction.

Competitors would have to rebuild their map stack to match this. It is not a
feature they can add in a sprint.

### 2. Saved terrain filters as first-class objects
*"12–25°, facing north-through-east, on a midslope bench, leeward on today's
wind"* is a named, persisted, shareable object. It travels offline. It can be
fed to the corridor solver as an attraction field so generated routes prefer the
ground the user identified.

**This is the user's scouting IP.** Once someone has built a filter library that
matches how they read ground, leaving costs them that library. Fixed slope bands
have no such gravity.

### 3. Offline as the operating assumption
Not a degraded mode — the default. Achieved by caching **elevation** and
computing layers on-device, so one region download unlocks every layer, any
wind, any date, with no signal. A competitor pre-baking rendered tiles cannot
match this without rearchitecting.

### 4. Honest analytics
Use-vs-availability, not raw counts. Confidence stated. Sample size respected.
Photoperiod rut modelling, not lunar astrology. Saying *"only 14 observations —
too few to read a pattern from"* when every competitor would draw a hotspot.

Trust is slow to build and impossible to buy. It is the deepest moat here.

## Would-a-hunter-switch scorecard

| Capability | Incumbents | Ridgeline | Status |
|-----------|-----------|-----------|--------|
| LiDAR shaded relief | ✅ | ⚠️ multi-directional hillshade from a **~10 m** DEM | 🔴 behind |
| Slope-angle shading | ✅ fixed bands | ✅ user-definable bands | ✅ ahead |
| Aspect / sun exposure | ✅ static | ✅ date-aware insolation | ✅ ahead |
| Saddle detection | ❌ manual | ✅ computed | ✅ ahead |
| Bench detection | ❌ manual | ✅ computed | ✅ ahead |
| Leeward bedding model | ❌ | ✅ wind-aware | ✅ ahead |
| Thermal modelling | ❌ | ✅ phase + scent direction | ✅ ahead |
| Movement corridors | ❌ | ✅ anisotropic LCP + pinch points | ✅ ahead |
| Saved terrain queries | ❌ | ✅ the core interaction | ✅ ahead |
| Offline maps | ✅ rendered tiles | ✅ elevation + on-device analysis | ✅ ahead |
| Habitat-selection analytics | ⚠️ raw counts | ✅ use-vs-availability | ✅ ahead |
| Property boundaries / parcels | ✅ | ⬜ | 🔴 behind |
| Public-land layers | ✅ | ⬜ | 🔴 behind |
| Weather integration | ✅ | ⬜ manual entry only | 🔴 behind |
| Trail-camera integration | ✅ | ⬜ | 🔴 behind |
| Mobile native apps | ✅ | ⚠️ PWA | 🟡 partial |
| Sharing / hunting party | ✅ | ⚠️ roles exist, UI pending | 🟡 partial |

> **On the LiDAR row, and why it is red.** It read "✅ parity" for months while
> the app rendered multi-directional hillshade from ~10 m Terrarium tiles and
> labelled it "LiDAR relief" — in the layer list, the PWA manifest and the meta
> description (`a02793d` removed the claim). A hillshade at 10 m is real,
> useful shape; it is not the resolution at which old logging grades and
> micro-benches appear, which is the thing that changed hunting cartography and
> the thing incumbents actually sell. Real 1 m 3DEP now **decodes** with zero
> dependencies and is verified against a real staged product, but nothing
> renders from it yet (`R79`). The row goes green when a hunter sees 1 m ground
> on the map, not before.
>
> **On the rest of this table.** Until `454c8f2`, every containerised build
> shipped with an empty DEM template, so *every* terrain row above — slope,
> aspect, saddles, benches, bedding, corridors — rendered blank in every
> deployed image while this scorecard said "✅ ahead". A row is evidence that
> code exists, not that a hunter has the capability. Treat ✅ as a claim to be
> re-verified against the running artifact, per non-negotiable #6 in
> `CLAUDE.md`.


Red rows outrank new pillars. Being brilliant at analysis and unable to show a
property line is not a switchable product.

## What we will not build

- **Lunar rut predictors.** Breeding is photoperiod-driven; the research is
  clear. Shipping one would degrade every rut-keyed analytic and cost us the
  credibility that advantage #4 depends on.
- **Confident forecasts on thin data.** "Deer will move here at 4pm" is what
  makes competitors untrustworthy.
- **Anything that only works online.** If it needs signal, it is not done.
- **Per-seat pricing on a self-hosted product.** The user's hardware, the user's
  data.
