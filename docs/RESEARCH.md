# Research: mapping features for studying deer

Field research and source review that drove Ridgeline's feature set. This is the
"why" behind the engine; `docs/ARCHITECTURE.md` is the "how".

---

## 1. What the market already does

| App | Terrain capability | Gap |
|-----|--------------------|-----|
| **onX Hunt** | LiDAR-derived shaded relief, 3D with vertical exaggeration; *TerrainX* adds viewsheds, slope aspect, slope angle and highlighted elevation bands | Fixed bands and palettes; no user-definable, saveable terrain query; no corridor solving |
| **Spartan Forge** | LiDAR overlay that sees through canopy; a deer-movement prediction algorithm | Prediction is opaque — no way to see what it is based on or to check it against your own observations |
| **HuntStand / HuntWise / GoHunt** | Topo + LiDAR hybrids, hunting-oriented basemaps | Terrain reading is manual; the app shows the map, the hunter does the analysis |

**The consistent gap:** every product ships terrain *visualisation*. None ships
terrain *analysis* the user can define, name, save, and reason with. That gap is
Ridgeline's thesis.

Sources: [onX LiDAR maps](https://www.onxmaps.com/hunt/app/features/lidar-maps),
[onX aerial imagery & terrain analysis](https://www.onxmaps.com/hunt/app/features/aerial-imagery),
[Spartan Forge](https://apps.apple.com/app/id1562873100),
[HuntStand: finding deer with topo maps](https://www.huntstand.com/fieldnotes/deer/how-to-find-deer-with-topo-maps/),
[GoHunt: topo maps for whitetail](https://www.gohunt.com/browse/tips-and-tricks/maps/using-topographical-maps-to-pinpoint-areas-for-whitetail-hunting).

---

## 2. Why LiDAR specifically changed hunting cartography

The distinction that matters is **bare earth vs surface model**.

- A **surface model** (SRTM, and the AWS Terrarium tiles Ridgeline uses by
  default) includes vegetation. Under timber it describes the top of the canopy.
- **LiDAR bare-earth** (USGS 3DEP, 1 m over much of the US) describes the ground
  the deer actually walk on.

Benches, old logging grades, hand-dug ditches, and subtle saddles are plainly
visible in bare-earth relief and effectively invisible in a canopy-height model.
This is the entire reason LiDAR is a selling point in hunting apps, and it is why
`DemService` treats 3DEP as the preferred source and **refuses to silently fall
back** to a surface model when the user asked for bare earth — a silent
downgrade would quietly degrade every derived layer.

Sources: [USGS 3DEP products & services](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services),
[USGS 3DEP LiDAR on AWS Open Data](https://registry.opendata.aws/usgs-lidar/),
[OpenTopography API access to 3DEP rasters](https://opentopography.org/news/api-access-usgs-3dep-rasters-now-available),
[man guides hunters using LiDAR mapping](https://lancasteronline.com/sports/outdoors/man-guides-hunters-to-game-using-light-sensitive-mapping-technology/article_e4dc94ee-8746-11eb-9677-3f584c7a1693.html).

---

## 3. The terrain features whitetail hunters actually read

This is the doctrine the engine encodes. Each maps to a computable layer.

### Saddles
Low points on a ridgeline. Deer cross ridges through them rather than over the
top **because it costs less energy**. Widely regarded as the highest-value single
feature on a topo map; during the rut, a saddle connecting two doe bedding areas
is the classic all-day sit.

→ Implemented as **Wood's `Pass`** morphometric feature: near-flat slope with
opposite-signed principal curvatures (falls away one way, rises the perpendicular
way). Rendered as the loudest colour on the map, deliberately.

### Benches
Flat shelves on a hillside. Prime bedding in hill country. The standard speed-
scouting technique is to mark every bench and connect them — that skeleton *is*
the property's travel network.

→ No standard GIS tool ships bench detection. Implemented as: locally gentle cell
whose surrounding ring is steep. This correctly rejects valley floors (gentle
cell, gentle ring) and, with a large enough ring radius, ridge tops.

### Midslope drainages
Shallow draws running down a hillside. Cover, a contour to walk, and a thermal
channel in one — the classic travel corridor.

→ **Weiss class 2** (small-scale low, mid-scale neutral), intersected with a
walkable slope band.

### Leeward bedding
A mature buck beds where he can **watch downwind and smell upwind**. In hill
country that resolves to the leeward side of a ridge, point or bench, where wind
curls over the crest and delivers scent from behind him while his eyes cover the
open downhill side.

→ `cos(aspect − windFrom)` **multiplied by** a TOPEX-style upwind shelter term, a
Gaussian on beddable grade, and ruggedness as security cover. Multiplicative
because every term is a *requirement* — an additive score would rank an exposed
flat with good cover as prime bedding, which is exactly backwards.

### Thermals
Air rises upslope when warming and sinks, pooling in draws, when cooling. They
invert twice a day and routinely run **opposite** the forecast wind in the first
and last hour of light. Convergent terrain channels sinking air, which is why a
draw is a scent superhighway at dusk. "Thermal hubs" — low points collecting
thermals from several directions — are where deer gather information before
committing to a direction.

→ Phase from solar position with a deliberately wide ±45 min transition window
(the switch is gradual and unreliable; a crisp flip would give false confidence
during exactly the window that busts the most hunts). Sinking-thermal strength
amplified by negative plan curvature.

### Sun and late-season bedding
Once it turns cold, deer bed where the sun lands. *Which* face wins shifts
through the season as solar declination changes — a static "south-facing" layer
is wrong by November.

→ NOAA solar position, per-cell incidence, cast shadows, and daily accumulated
insolation, all date-aware.

Sources: [Whitetail Partners: mastering topo maps](https://www.whitetailpartners.com/post/mastering-topographic-maps-will-make-you-a-better-deer-hunter),
[Whitetail Properties: terrain-specific tactics](https://www.whitetailproperties.com/knowledge-center/terrain-specific-deer-hunting-tactics-from-ridges-to-swamps),
[Realtree: read topo maps, shoot more bucks](https://realtree.com/deer-hunting/articles/read-topographic-maps-shoot-more-bucks),
[NA Deer Hunter: hunting mountain bucks](https://nadeerhunter.com/how-to-hunt-mountain-bucks/).

---

## 4. Terrain classification methods evaluated

| Method | What it answers | Chosen? |
|--------|-----------------|---------|
| **Horn (1981) 3rd-order** slope/aspect | Steepness and facing | ✅ — it is what ArcGIS/GDAL/QGIS ship, so our numbers match a user's desktop GIS |
| **Evans–Young quadratic fit** curvature | Convex/concave, across and along slope | ✅ — finite differences alone are far too noisy on 1 m LiDAR; the least-squares fit is an implicit smoother |
| **Weiss (2001) multi-scale TPI** | *Where does this sit in the landscape?* | ✅ — the two-scale trick is essential: a single TPI cannot distinguish a small ridge inside a big valley from a big ridge, and that is exactly the difference between a doe-bedding finger and a windswept summit |
| **Wood (1996) morphometric features** | *What shape is this?* (peak/pit/**pass**/ridge/channel/planar) | ✅ — the only one that yields real saddle detection |
| **TRI (Riley 1999)** | Local relief / broken ground | ✅ — used as a security-cover proxy |
| **Sky-view factor (Zakšek/Oštir)** | Openness | ✅ — doubles as a canopy-independent cold-air-pooling proxy |

A note that surprised us and is worth recording: **TPI is provably constant on a
quadratic surface**, so a perfect paraboloid classifies as featureless. That is
correct — Weiss classification is *relative to the analysis window* — but it also
exposed a real bug: standardising a near-constant field amplifies float32 noise
into ±1σ z-scores, speckling visibly flat ground (a big ag field, a lake) with
random "ridge"/"canyon" cells. `standardize()` now has a noise floor tied to DEM
precision.

Sources: [Jenness TPI documentation](https://www.jennessent.com/downloads/TPI_Documentation_online.pdf),
[TPI formula & workflow](https://www.bathyl.com/en/blog/topographic-position-index-explained),
[automated landform classification with GIS](https://www.redalyc.org/journal/2736/273661636012/html/).

---

## 5. Movement corridors

Least-cost path analysis is standard in landscape connectivity work, and the
ungulate literature supports it: cervid movement is predictable from slope,
elevation difference and path length, and "escape terrain" (≥10% slope)
availability shapes gene flow over long distances.

Two adaptations were necessary for hunting scale:

1. **The cost model must be anisotropic.** The usual GIS default ("cost =
   slope") is wrong for deer in a specific way: they are **energy-averse, not
   slope-averse**. A whitetail contours a 25° sidehill all day and refuses to
   climb the same 25°. Slope alone has no notion of direction of travel. Using a
   Tobler-shaped speed function of *along-path* grade is what makes generated
   corridors hug contours, run benches, and funnel through saddles — the same
   lines a hunter draws by hand.

2. **The corridor matters, not the path.** A least-cost *path* is a single line
   and no deer walks a mathematically optimal polyline. The **cost-weighted
   distance corridor** — `accumCost(A→cell) + accumCost(cell→B) − optimal`,
   thresholded — gives the band of near-optimal ground where the trails actually
   are. **Pinch points**, where that band narrows, are the stand-placement
   output; every route has to squeeze through, so a stand there covers
   essentially all the traffic.

Because the cost model is anisotropic, the reverse accumulation genuinely
differs from the forward one (climbing out of a creek bottom costs more than
dropping into it), so it is solved with the step direction flipped rather than by
reusing the forward field. Reusing it — a common shortcut — biases every corridor
downhill.

Sources: [Testing least-cost path models for travel time and kcal expenditure (PLOS One)](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0239387),
[optimising dispersal and corridor models using landscape genetics](https://besjournals.onlinelibrary.wiley.com/doi/full/10.1111/j.1365-2664.2007.01325.x),
[wildlife corridor analysis with GIS modelling](https://mapular.com/glossary/corridor-analysis).

---

## 6. Behavioural covariates — what to model and what to refuse

| Factor | Evidence | Decision |
|--------|----------|----------|
| **Barometric pressure** | Consistent reports of increased activity as pressure *falls*, and good movement in the 29.9–30.3 inHg range | ✅ Model the **3-hour trend**, not the absolute value — the trend is where the evidence actually is |
| **Wind** | Direction governs both access and stand selection; movement often spikes after sustained high wind drops | ✅ First-class input across the whole app |
| **Temperature** | Deer have a comfort range; warm days after winter coats grow suppress daylight movement | ✅ Recorded per observation |
| **Rut timing** | Peak breeding falls in a narrow, **photoperiod-locked** mid-November window across the northern range, essentially regardless of temperature, pressure or moon | ✅ Calendar + latitude model, with per-property calibration from the user's own logged chasing observations |
| **Moon phase** | Research overwhelmingly finds **no direct effect** on rut timing or movement; nocturnal illumination may shift next-day activity slightly | ❌ **Refused as a predictor.** Recorded as an observation covariate so users can test it against their own data, but never used to forecast |

The moon decision is the sharpest one in the product. A lunar rut predictor is
what a competitor ships because it sells; building one would degrade every
rut-keyed analytic and cost the app its credibility. `vision-steward` is
instructed to push back on it, including when the founder asks.

Worth stating plainly because the UI does: **peak breeding is often the worst
week to sit.** Lockdown means bucks are tending does in cover and daylight
movement drops. The high-odds window is *chasing*, which precedes it.

Sources: [Mossy Oak: barometric pressure's influence on whitetail movement](https://www.mossyoak.com/our-obsession/blogs/deer/barometric-pressures-influence-on-whitetail-movement-4),
[Mossy Oak: predicting whitetail movement — new tech or old school](https://www.mossyoak.com/our-obsession/blogs/deer/predicting-whitetail-movement-new-tech-or-old-school),
[Outdoor Life: whitetails by the weather](https://www.outdoorlife.com/whitetails-weather-understanding-deer-behavior/).

---

## 7. Analytics: the mistake to design against

The default "analytics" feature in a hunting app is a bar chart of sightings by
slope band. **It is misleading by construction.** If 70% of a property is gentle
open slope, 70% of sightings will be on gentle open slope, and the chart
confidently reports that deer love gentle open slope. It has measured the
property, not the deer.

The fix is standard wildlife ecology and not difficult: compare **use** against
**availability** via Manly's selection ratio, `w = (share of observations) /
(share of area)`, with a chi-square goodness-of-fit against the availability
distribution. This requires a computed terrain profile for the property, which is
why `TerrainProfile` is materialised and why a property boundary is required
rather than optional.

Two further commitments:

- **Effort normalisation.** Raw counts measure how often the hunter went out.
  Six sightings across twelve sits is a weaker signal than four across four, and
  only sightings-per-sit shows it. This is why blank sits are logged.
- **Solar-relative time.** 07:00 is well after first light in December and well
  before it in September. Binning activity by clock time smears the dawn peak
  across two hours; everything is bucketed against sunrise/sunset instead.

Sample sizes here are small and hunters will over-read them, so the
implementation is deliberately conservative: it reports confidence intervals,
refuses to claim significance below a usable expected-count floor, and says
"only N observations — too few to read a pattern from" in plain language.

---

## 8. Offline architecture

The requirement is absolute: hollows with no bars, public land in the dark,
twenty miles from pavement.

**Storage.** OPFS is the primary store. IndexedDB is the wrong primary at this
scale — writing ~100k small Blob records is slow and the structured-clone round
trip on read shows as visible tile pop-in while panning. OPFS gives near-native
reads with no clone step. IndexedDB remains as a fallback because OPFS is
unavailable in some privacy configurations, and "no offline maps for you" is not
an acceptable answer for the one feature the user is relying on.

**The decision that shaped everything else:** cache **elevation** tiles, not
rendered layers. Pre-baking rendered analysis tiles would need a variant per
layer × per wind direction × per date — combinatorially impossible to download.
Caching the DEM and computing layers on-device means one region download unlocks
*every* layer, *any* wind, *any* date. This is why `@hunt-maps/terrain` has zero
runtime dependencies: it has to run in a browser worker, and it has to be the
same code the server runs so a saved filter cannot mean two different things.

Sources: [MapLibre offline PMTiles plugin](https://github.com/makinacorpus/maplibre-offline-pmtiles),
[OpenMapTiles + service workers PWA maps](https://github.com/reyemtm/pwa-maps),
[gps-map offline viewer](https://github.com/bmcbride/gps-map).

---

## 9. Data sources

| Data | Source | Notes |
|------|--------|-------|
| Elevation (global) | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/), Terrarium encoding | Free, no key, **not** requester-pays. Default, so self-hosting has no per-tile bill |
| Elevation (US, bare earth) | [USGS 3DEP](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services) via OpenTopography | 1/3 arc-second nationally, 1 m LiDAR over much of the country. Public domain |
| Land cover | [NLCD / MRLC](https://www.mrlc.gov/data) | 30 m, annual 1985–2024. Drives corridor resistance |
| Imagery | NAIP; Esri World Imagery | Leaf-off imagery is the useful one for scouting |
| Encodings | Terrarium `h = (R·256 + G + B/256) − 32768`; Terrain-RGB `h = −10000 + (R·65536 + G·256 + B)·0.1` | Both supported |

Sources: [MRLC data](https://www.mrlc.gov/data),
[USGS National Map downloads](https://www.usgs.gov/tools/download-data-maps-national-map),
[Mapbox Terrain-RGB reference](https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-rgb-v1/),
[Mapzen terrain tiles](https://www.mapzen.com/blog/terrain-tile-service/).

---

## 10. Open questions

- **Bench detection thresholds** are currently fixed. They likely need to scale
  with regional relief — a "bench" in the Driftless is not a bench in the Rockies.
- **Corridor resistance** uses NLCD at 30 m. Sub-canopy structure (regen thickets,
  CRP edges) matters more to deer than the NLCD class and is not captured.
- **Rut calibration** currently needs ≥3 logged chasing observations. Whether
  that converges usefully within one season is unproven.
- **Ground truth.** Every terrain claim here is validated against synthetic
  surfaces and published doctrine. Validating against GPS-collared deer data
  would move several of these from "well-motivated" to "demonstrated" — the
  single highest-value research step available.
