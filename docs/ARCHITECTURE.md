# Architecture — Ridgeline

## The shape of the system

```
                          ┌──────────────────────────┐
                          │  packages/terrain        │
                          │  DEM analytics engine    │
                          │  ZERO runtime deps       │
                          └────────┬─────────┬───────┘
                                   │         │
              ┌────────────────────┘         └───────────────────┐
              │                                                  │
   ┌──────────▼───────────┐                        ┌─────────────▼──────────┐
   │  apps/api            │                        │  apps/web              │
   │  NestJS + PostGIS    │◄────── REST ──────────►│  MapLibre PWA          │
   │                      │                        │  + analysis Web Worker │
   └──────────┬───────────┘                        └─────────────┬──────────┘
              │                                                  │
   ┌──────────▼───────────┐                        ┌─────────────▼──────────┐
   │  PostgreSQL/PostGIS  │                        │  OPFS tile store       │
   │  + DEM tile cache    │                        │  (IndexedDB fallback)  │
   └──────────────────────┘                        └────────────────────────┘
```

**The engine is imported by both ends.** That is the single most important
structural fact about this codebase. A saved filter must produce byte-identical
output on the API and on a phone at the bottom of a hollow; one implementation
is the only way to guarantee that, and it is why `packages/terrain` has zero
runtime dependencies — it has to survive being bundled into a service worker.

---

## The offline decision

Everything about the client architecture follows from one choice:

> **Cache elevation tiles, not rendered layers.**

Pre-baking rendered analysis tiles would require a variant per layer × per wind
direction × per date. A user wanting "leeward bedding on a NW wind at first light
on 15 November" would have had to download that exact combination in advance.
Combinatorially impossible.

Caching the DEM and computing derived layers on-device means **one region
download unlocks every layer, any wind, any date, with no signal.**

The cost is CPU on the device, which is why the analysis runs in a Web Worker
with transferable pixel buffers and why the engine uses summed-area tables for
large neighbourhoods instead of naive O(r²) kernels.

### Tile pipeline

```
MapLibre requests  ridgeline://slope/14/4370/6323?wind=270
        │
        ▼
TerrainProtocol ── OPFS lookup (hit) ──────────────┐
        │                                          │
        └── miss → fetch DEM upstream → persist ───┤
                                                   ▼
                       centre + 8 neighbour DEM tiles
                                                   │
                                                   ▼
                              Web Worker (@hunt-maps/terrain)
                              decode → assemble haloed grid →
                              analyze → render RGBA
                                                   │
                                                   ▼
                              OffscreenCanvas → PNG → MapLibre
```

The nine-tile fetch is why `HeightGrid` carries a halo. Running a gradient
operator on a bare 256×256 tile produces garbage at every edge, and the user
sees a visible grid of seams across the whole layer — the most common bug in
home-grown hillshade code.

---

## `packages/terrain`

```
dem/
  encoding.ts     Terrarium + Terrain-RGB decode/encode
  tilemath.ts     Web Mercator slippy-tile math, isotropic cell size
  grid.ts         HeightGrid — haloed, void-filling, neighbour stitching
analysis/
  surface.ts      Horn slope/aspect, Evans–Young curvature, TRI
  landform.ts     Multi-scale TPI, Weiss classes, Wood features, benches
  shading.ts      Hillshade, multi-directional, sky-view factor
  solar.ts        NOAA solar position, insolation, shadows, sun times
  wind.ts         Exposure, TOPEX shelter, thermals, bedding likelihood
corridor/
  cost.ts         Anisotropic Tobler cost surface, NLCD resistance
  leastcost.ts    Dijkstra, corridors, pinch points, centrelines
filters/
  terrainFilter.ts  Saveable predicate AST + validation + presets
render/
  ramps.ts        Colour ramps, categorical palettes, compositing
pipeline.ts       analyze() — lazy, memoised; requiredHalo()
```

### Conventions that are load-bearing

- **Isotropic cell size.** Web Mercator is conformal, so scale is identical in x
  and y at any point. That is what lets gradient kernels run on the tile grid
  without reprojecting to UTM. `pixelSizeMeters` includes the `cos(lat)` term —
  omitting it understates slope by 2× at 60°N.
- **Raster row order increases southward.** `dzdx` is east-positive, `dzdy` is
  south-positive, aspect is the **downslope** azimuth clockwise from north.
- **Two curvature sign conventions coexist deliberately.** `plan`/`profile`
  follow ESRI (what a user sees in QGIS); `crossSectional`/`longitudinal` follow
  Wood (what the classifier is defined against). They disagree on `profile` vs
  `longitudinal` by design, there are regression tests pinning it, and the code
  comment says so in capitals — because it was wrong once and nothing crashed.
- **`analyze()` is lazy.** It computes only the requested layers, memoised
  within a call. A full field bundle is tens of milliseconds per tile; the
  layers actually switched on are usually two or three. This is what keeps a
  filter slider at 60fps.

---

## `apps/api`

NestJS module per domain. PostGIS is a hard requirement — every meaningful query
here is spatial, and doing it with float lat/lng columns and bounding boxes falls
apart the moment a property is not axis-aligned.

### Spatial SQL discipline

Prisma cannot model geometry, so geometry columns are `Unsupported("geometry(…)")`
and every spatial read/write goes through **`GeometryService`** — one file. This
concentrates:

- **The injection surface.** Geometry arrives as user-supplied GeoJSON. Every
  value crosses into SQL as a parameter via tagged templates; the two places
  identifiers must be interpolated use a hard-coded whitelist.
- **Validity.** Hand-drawn boundaries from a touchscreen very often
  self-intersect, and an invalid polygon makes every downstream `ST_Intersects`
  throw. `ST_MakeValid` on ingest.
- **SRID and units.** `ST_Area` on a 4326 geometry returns square degrees.
  Casting to `::geography` is mandatory, and getting it wrong silently corrupts
  every availability denominator in the analytics.

### A Prisma constraint worth knowing

Prisma Client **cannot create rows carrying required `Unsupported()` columns** —
the generated create input omits them. Geometry columns are therefore nullable,
and every service writes the geometry in a second statement within the same
request.

They remain nullable *in the database too*, which is worth being explicit about:
a bare `NOT NULL` would reject that first insert, and unlike a foreign key it
cannot be deferred to `COMMIT`. Enforcing the invariant properly requires
wrapping create-then-write in an explicit transaction and adding a
`DEFERRABLE INITIALLY DEFERRED` constraint trigger. That is tracked as backlog
I5 rather than papered over — a constraint that silently does not hold is worse
than an honest absence of one.

### Denormalised terrain on observations

Each observation carries the slope/aspect/landform/bench/ruggedness sampled at
its point when it was recorded. Recomputing that at query time would mean a
raster pass per observation on every analytics load — hundreds of tile fetches
to draw one chart. Stamping it at write time makes the analytics a SQL aggregate.

The trade-off is that the stamp reflects the DEM available when it was recorded,
so `demSource` is captured and a later re-stamp against better LiDAR is
auditable.

---

## `apps/web`

```
lib/offline/tileStore.ts    OPFS → IndexedDB → memory, one interface
lib/map/terrainProtocol.ts  ridgeline:// protocol, cache-first, worker bridge
lib/layers.ts               Layer catalogue + exclusivity rules
workers/terrain.worker.ts   Analysis worker (imports the shared engine)
components/MapView.tsx      MapLibre, anchor-based layer ordering
components/LayerPanel.tsx   Layer stack, wind dial, time scrub
```

### Layer ordering

MapLibre's `addLayer` appends unless given a `beforeId`. Relying on insertion
order means toggling a layer off and on silently promotes it to the top and the
stack reorders under the user. So the style ships six invisible **anchor
layers** and every real layer inserts against the anchor for its group:

```
background → anchor-base → anchor-relief → anchor-analysis
           → anchor-hunting → anchor-saved → anchor-features
```

When wind or date changes, the tile URL changes; `setTiles` re-requests without
removing the layer, so ordering survives a wind scrub.

### Service worker

`vite-plugin-pwa` precaches the app shell (cold start with no signal) and
network-first caches API reads (property, stands and sign still present
offline). **Map tiles are deliberately excluded** from runtime caching — letting
Workbox hoover up every tile the user pans over would fill their storage quota
invisibly and then evict the regions they deliberately saved.

---

## Data flow: a saved filter

```
User builds "leeward benches"
        │
        ▼
TerrainPredicate AST ──► validated ──► persisted (SavedFilter.predicate JSON)
        │                                        │
        │                                        ▼
        │                              shared / imported by others
        ▼                                   (copied, re-validated —
requiredMetrics(predicate)                   a shared filter is inert data,
        │                                     never executable code)
        ▼
analyze(grid, { layers: onlyWhatIsNeeded })
        │
        ▼
evaluateFilter → mask → renderMask → composited tile
        │
        └──► also usable as an attraction field for the corridor solver
```

---

## Testing strategy

| Layer | Approach | Why |
|-------|----------|-----|
| `packages/terrain` | Analytically-known synthetic surfaces — planes of known grade, paraboloids, hyperbolic paraboloids, cones, cut benches | A hillshade that "looks right" proves nothing; a regression fixture just freezes whatever bug existed when it was recorded |
| `packages/shared` | Constructed use/availability distributions where the correct selection ratio is known by hand | The failure being tested for is *statistical*, not mechanical |
| `apps/api` | Unit tests for dependency-free logic; integration against a real PostGIS | Spatial behaviour cannot be mocked meaningfully |
| `apps/web` | Unit tests for layer rules; **manual offline cold-start runs** | Mocked fetches do not catch OPFS quota behaviour, SW activation races, or a partially-populated store |

The engine's tests caught three real defects during the initial build — a
curvature sign inversion, `standardize()` amplifying float noise into fake
landform classes, and `sunTimes()` returning a negative day length west of
Greenwich. None of them would have crashed anything. All three would have
produced a map that was confidently wrong.
