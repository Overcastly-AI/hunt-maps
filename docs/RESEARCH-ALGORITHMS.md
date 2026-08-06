# Research: algorithm and simulation directions for the terrain engine

An open-ended survey, commissioned by the founder, of algorithms and simulations
Ridgeline could adopt. Written by `terrain-scientist`. **This is a research
document, not a plan and not an implementation.** Nothing here is filed; the
items that survive should go to `backlog-groomer`.

`docs/RESEARCH.md` is the "why we built what we built". This is the "what we
could build next, and what we should refuse to build".

---

## 0. How this pass was done, and its limits

**Stated up front because it bounds every citation below.**

- **`WebSearch` was not available in this context.** The brief said it was; the
  tool reports `WebSearch exists but is not enabled in this context`. Whoever
  commissions the next pass should confirm it is actually enabled, because it
  would materially improve the biological-transfer questions here.
- **`WebFetch` is blocked at the egress gateway for every host** (consistent
  with `docs/EVIDENCE.md`'s reading conditions). Confirmed additionally that
  `arxiv.org`, `api.crossref.org`, `ncbi.nlm.nih.gov`, `gaftp.epa.gov` and
  `api.github.com` are all unreachable via `curl` too.
- **What did work:** `curl https://raw.githubusercontent.com/…` and
  `git clone --depth 1 --filter=blob:none` of public repositories. So every
  citation below was obtained by **reading the source or documentation of a
  reference implementation** — GRASS GIS, SAGA, WhiteboxTools, RichDEM,
  Circuitscape.jl, Omniscape.jl, WindNinja, SMRF, topocalc, gdistance.
- **Consequence:** no primary paper was read in full. Citations are therefore
  *bibliographic references verified against a reference implementation that
  cites them*, not verified findings. Where I am reasoning from first
  principles rather than a source, it says so. Where I am recalling a citation
  I could not verify in this pass, it says that too.
- **The compute numbers in this document are measured**, on this machine, in
  Node, on a 256×256 grid. They are not phone numbers. Mid-range-phone
  JavaScript on typed arrays typically runs 3–8× slower than desktop Node;
  every budget below states the desktop figure and applies that derate
  explicitly rather than hiding it.

---

## 1. Findings about the current engine that shape everything below

Five things surfaced while reading `packages/terrain/src` end to end. They are
not proposals; they are facts about the shipped code that change which
proposals are worth making. **Each is independently checkable, and three of
them are defects.**

### 1.1 `castShadows()` is exported and called nowhere — insolation ignores terrain shadow

`analyze()` computes `insolation` from `slopeInsolation()` alone.
`dailyInsolation()` likewise. `castShadows()` appears in no pipeline, no API
route, and no test. `grep -rn "castShadows" packages apps` returns only its own
definition and the generated `.d.ts`.

The doc comment in `solar.ts` says exactly why this matters:

> *"a slope can face the sun perfectly and still be in shade at 07:00, which is
> exactly the case that matters."*

So the insolation layer currently reports a bench under a rim as fully sunlit at
first light. That is the failure class the repo's second non-negotiable names —
confident, plausible, and wrong in the one hour of the day the layer exists for.
**Fixing it is a prerequisite for anything solar or thermal**, and §5.3 makes it
nearly free.

### 1.2 The corridor solver has a measured 8.24 % directional bias

`leastcost.ts` uses 8-connectivity. `stepCost` weights diagonals correctly by
`hypot(dx,dy)`, so this is not a diagonal-weighting bug — it is the classic
**metrication error**: an 8-connected path cannot travel at an arbitrary angle,
only at multiples of 45°, so it pays for the zig-zag.

Derivation (first principles): to move one Euclidean unit at angle θ ∈ [0°,45°]
you need `a = sinθ` diagonal steps and `b = cosθ − sinθ` cardinal steps, costing
`cosθ + (√2−1)·sinθ`. That is maximised at `tanθ = √2−1`, i.e. **θ = 22.5°**,
where it equals **1.08239**.

Measured, by running Dijkstra on a flat unit-cost grid and taking the worst
ratio of accumulated cost to Euclidean distance over a ring:

| Connectivity | max path / Euclidean | worst angle |
|---|---|---|
| 8-neighbour (**what we ship**) | **1.0824 (+8.24 %)** | 22.4° |
| 16-neighbour (knight's move) | 1.0275 (+2.75 %) | 12.6° |
| 32-neighbour | 1.0131 (+1.31 %) | 9.0° |

Closed form for the 8-neighbour case: 1.0824. The measurement matches to four
decimals.

This means our corridors are systematically biased toward the eight compass
octants — a corridor genuinely running at 22° is charged 8 % more than one
running at 0° or 45°, and the corridor mask, the pinch points and the traced
centrelines all inherit it. GRASS `r.cost` ships exactly this fix as its
`-k` "knight's move" flag, documented as *"may be used to improve the accuracy
of the output"* (`raster/r.cost/r.cost.html`, OSGeo/grass).

### 1.3 `skyViewFactor()` does not compute either standard definition of sky-view factor

The code accumulates `cos(h_φ)` over 16 azimuths, where `h_φ` is the horizon
elevation angle, and documents the result as *"the fraction of the hemisphere
visible from each cell, 0..1"*, citing Zakšek/Oštir.

Deriving the two standard quantities from horizon angles (first principles):

- Solid angle of visible sky in an azimuth sector `dφ` above horizon `h` is
  `(1 − sin h)·dφ`; the hemisphere is `2π`. So the **geometric hemisphere
  fraction is `mean(1 − sin h_φ)`**.
- The projected (cosine-weighted) solid angle for that sector is
  `(1 − sin²h)/2 · dφ`; the hemisphere projects to `π`. So the **radiative view
  factor is `mean(cos² h_φ)`**.

Ours is `mean(cos h_φ)`, which is neither. For a cell ringed by a 30° horizon:
geometric = 0.500, radiative = 0.750, **ours = 0.866**. All three agree at
`h = 0` and `h = 90°`, which is why nothing looks obviously broken; in between,
ours systematically reports enclosed terrain as more open than it is — the wrong
direction for a layer documented as a **cold-air-pooling proxy**.

Closed-form check on an unobstructed tilted plane (Dozier & Frew's inclined-plane
result, `(1 + cos S)/2`):

| plane slope | ours | `(1+cos S)/2` |
|---|---|---|
| 0° | 1.0000 | 1.0000 |
| 20° | 0.9846 | 0.9698 |
| 30° | 0.9647 | 0.9330 |
| 45° | 0.9173 | 0.8536 |

I am *not* asserting the intended definition is wrong — as a monotone relief
index the current form is serviceable. I am asserting the **documented claim
does not match the computation**, and that a physically-defined SVF is available
for the same cost (§5.3). Verify against Zakšek, Oštir & Kokalj (2011) before
changing anything.

### 1.4 `computeThermals()` produces a per-cell scent field that nothing renders

`computeThermals()` is called only from `wind.test.ts`. The API's stand
wind-check (`apps/api/src/waypoints/waypoints.module.ts`) uses `thermalPhaseAt()`
— a **single global phase for the entire DEM**. `docs/EVIDENCE.md` already says
that is wrong on exactly our terrain:

> *"ridges flip while the valley bottom is still draining. A single global phase
> for the whole DEM is wrong on exactly the terrain the app is for."*

So the *shape* of the spatial thermal layer already exists in the engine and is
wired to nothing. §5.2 is largely about replacing its strength term (which
`BACKLOG I7` flags as possibly inverted) and connecting it.

### 1.5 A halo larger than the tile is silently wrong, and 500 m radii cross that line

`assembleGrid` blits the centre tile plus 8 neighbours. If `requiredHalo()`
returns more than `tileSize`, the outer halo is never written and stays at the
`NODATA` sentinel, `-32768` — **a finite number**. `skyViewFactor`,
`terrainShelter` and `castShadows` all guard with `Number.isFinite(zr)`, which
passes for `-32768`, so the unwritten halo reads as *"terrain 33 km below you"* —
i.e. "no obstruction". The layer does not crash, it silently reports open ground.

This matters immediately for `BACKLOG R23` (shelter radius → 500 m). At z=14,
40°N, `pixelSizeMeters` = **7.32 m**, so 500 m = **68 cells** — fine. At z=15 it
is 137 cells — fine. **At z=16 it is 273 cells, which exceeds the 256-cell
halo the 9-tile fetch can supply**, and the operator degrades to "open" without
saying so. Anything in this document with a several-hundred-metre radius
inherits this constraint. Two honest fixes: assert `requiredHalo() <= tileSize`
and throw, or widen the fetch to 5×5 for those layers.

---

## 2. Measured compute budget

All on a 256×256 interior, Node, this machine. Phone estimate = ×3–8.

| Operation | measured (desktop) | phone estimate | verdict |
|---|---|---|---|
| 8-neighbour matrix-free Laplacian mat-vec | **1.20 ms** | 4–10 ms | ~250–500 needed for a CG solve → **precompute** |
| `skyViewFactor` style ray-march, r=24, 16 dirs (**what we ship**) | **301 ms** | 0.9–2.4 s | already the most expensive layer we have |
| same, r=50 (500 m), 32 dirs | **1089 ms** | 3–9 s | not shippable as-is |
| **monotone horizon sweep, 32 directions, unlimited radius** | **94 ms** | 0.3–0.8 s | ~12× faster **and exact** — see §5.3 |
| priority-flood depression fill | **17 ms** | 50–140 ms | cheap |
| D8 flow-direction + flow accumulation | **27 ms** | 80–220 ms | cheap |

The headline: **the ray-marchers are the bottleneck, and they are replaceable by
a single shared O(n) sweep that is both faster and more accurate.** That one
observation reorders most of the shortlist.

---

## 3. Ranked shortlist

Ranked by (value to a hunter) × (feasibility under zero-deps / offline /
mid-range-phone). Deep dives for the top three in §5; the founder's two named
candidates get equivalent depth in §6 regardless of rank.

| # | Candidate | Hunting question it answers that we cannot answer today | Value | Feasibility | Trustworthy? |
|---|---|---|---|---|---|
| 1 | **Hydrological flow routing** — priority-flood fill, D8/D∞, flow accumulation, HAND, drainage + ridge skeleton | *Where do the draws actually run, where do they join, how far above the creek am I, which spur connects these two benches* | High | High | **Yes** — pure geometry, closed-form testable, no biology |
| 2 | **Terrain-resolved thermal (slope-flow) field** | *Which way does my scent go from this stand at 17:30, and how fast* | **Highest** | Medium-high | Physics 🟢; coefficients empirical — must ship a grade |
| 3 | **Horizon-map precompute** (Dozier & Frew) | Makes shadowed insolation, 500 m shelter, wind-direction scrubbing, openness and geomorphons all cheap | High (indirect) | **Very high** | **Yes** — pure geometry |
| 4 | **Randomised shortest paths / circuit-theoretic corridors** | *Where is movement funnelled, across all plausible routes, not one optimal line* | High | Medium | Yes for the maths; the resistance surface stays 🔴 |
| 5 | **Winstral `Sx` terrain wind field** | *Is this bench actually in the lee, on today's bearing, and how hard is the wind there* | High | Medium-high | Partly — gives **speed**, not deflection. Say so |
| 6 | **16-neighbour Dijkstra** | Removes a measured 8.24 % directional bias from corridors | Modest | **Trivial** | Yes |
| 7 | **Geomorphons** (Jasiewicz & Stepinski) | A saddle detector that does not depend on a curvature tolerance | Medium-high | High (free once #3 lands) | Yes |
| 8 | **Multiscale DEV** (Lindsay, integral images) | *At what scale does this cell stand out* — answers `I1` (benches vs regional relief) principled | Medium | **Very high** | Yes |
| 9 | **Parameter-ensemble uncertainty layer** | *How much of this map survives the fact that four of its constants are 🔴* | Medium-high | High | Yes, and it is honesty made visible |
| 10 | **Viewshed** (already `ROADMAP` Phase 5) | *Can deer see my silhouette from the bedding area* | Medium | High | **Only bare-earth** — see §7 |

**Sequencing note that cuts across the ranking:** #6 is an afternoon and #3 is
a couple of days, and #3 is a hard dependency of #2, #5, #7 and a large speedup
for #10. Do those two first whatever the ranking says.

---

## 4. Rejected, with reasons

Recorded so they are not re-proposed.

### ❌ WindNinja-style mass-consistent 3D wind model
The founder named this as *"arguably the highest-value item in the whole app"*.
The **goal** is right; **this algorithm cannot deliver it here.**

It minimises departure from an initial wind field subject to `∇·(ρu) = 0`, via a
Sasaki (1958, 1970) variational formulation solved as an elliptic PDE by finite
elements on a 3D hexahedral mesh with a Jacobi-preconditioned CG solver.
Forthofer's thesis (shipped in the repo as `doc/forthofer_thesis.pdf`) records
runtimes of **1–15 minutes per simulation on a single-processor computer** —
against 0.5–1.5 hours for the full CFD alternative.

Three independent killers:
1. **It is 3D.** A 256×256 tile with 20 vertical layers is 1.3 M unknowns per
   solve, versus 65 k for the 2D solves in this document. Mesh generation over
   terrain is itself non-trivial code.
2. **One solve per wind bearing per stability class.** The offline promise is
   "one DEM download unlocks any wind" — a model that must be re-solved for
   every bearing the user scrubs to breaks that unless we precompute a
   sixteen-bearing library, which is sixteen 3D solves per region.
3. **It answers a question we cannot pose.** Its value comes from initialising
   with a real mesoscale forecast field. We have a single user-typed bearing.

**What to do instead:** §6.2. Winstral `Sx` is the computationally-honest 2D
member of the same family and comes with a published skill score.

### ❌ Omniscape (moving-window Circuitscape)
Omniscape runs a full Circuitscape solve **per target pixel**, summing the
resulting current maps (`docs/src/algorithm.md`, Circuitscape/Omniscape.jl). At
65 k pixels × ~1 s per solve that is hours per tile. It is an HPC tool for
continental connectivity. The property-scale question is a *pairwise* one
(bedding ↔ food), which is one solve — §6.1.

### ❌ Lagrangian particle / puff scent dispersion
Requires a 3D turbulent wind field (rejected above) plus a turbulence closure.
The 2D Gaussian-plume version is **already filed** as `BACKLOG R13` (fix the
stability-ordering inversion) and `N11` (source the σ_y magnitudes from EPA
ISC3 / NRC RG 1.145). Do those. The only genuinely *new* extension worth
considering later is making the plume **follow the drainage network** in the
sinking phase rather than travelling in a straight line — which is a downstream
consumer of §5.1 and §5.2, not a dispersion model of its own.

### ❌ Agent-based / individual-based movement simulation
The brief asked me to be sceptical, and the scepticism holds.

An ABM needs a movement kernel (step length and turn-angle distributions) and a
habitat-selection function. We have neither: `BACKLOG I3` ("can we obtain
GPS-collar telemetry?") is open, and `docs/EVIDENCE.md` grades essentially every
behavioural parameter that would enter such a model 🟡 or 🔴 — `idealSlopeDeg`,
the shelter saturation, the cover term, the NLCD magnitudes.

The failure mode is specific and severe: an ABM produces **animated deer moving
across the map**, which is maximally persuasive and completely unfalsifiable.
That is precisely what `docs/RESEARCH.md` §1 criticises Spartan Forge for
("Prediction is opaque — no way to see what it is based on"), and what
`VISION.md` refuses under "Confident forecasts on thin data". Building one would
trade the product's only durable moat for a demo.

**Revisit if and only if `I3` closes.** With real collared tracks, the correct
first step is not an ABM but an **integrated step-selection function** fitted to
those tracks — which also happens to be the principled way to derive a
resistance surface for §6.1, replacing the 15 invented NLCD multipliers.

### ❌ Machine-learned movement prediction from user observations
Same objection plus §5 of `CLAUDE.md`: a model trained on sighting counts
without an availability denominator learns the property, not the deer. Sample
sizes are in the tens.

### ❌ Monte Carlo over **DEM vertical error**
Legitimate technique, wrong target here. 3DEP LiDAR bare-earth vertical RMSE is
of order 10 cm; the biological parameters carry uncertainties of tens of
percent. Propagating the small one while the large one is unmodelled would be
theatre. See #9 for the version worth doing.

---

## 5. Deep dives — the top three

### 5.1 Hydrological flow routing and the drainage / ridge skeleton

**What it computes.** A depression-filled surface, a flow-direction field, an
upslope contributing area (flow accumulation), and from those: a stream network,
a ridge network (the same algorithm on the inverted DEM), Strahler order, and
Height Above Nearest Drainage.

**What it answers that we cannot answer today.** Everything about drainage that
is currently answered by a *pointwise* classifier. `WeissLandform.MidslopeDrainage`
tells you a cell looks like a draw. It does not tell you which draw, where it
goes, where two draws join (a junction is a funnel), how far above the creek you
are, or which spur runs between two benches. The bench-and-connect speed-scouting
technique described in `docs/RESEARCH.md` §3 is *literally a skeleton-building
exercise*, and we compute no skeleton. It also feeds:

- `N19` "Read this ground" — a countable, nameable feature set with centroids.
- `N6` contours — same vectorisation machinery.
- §5.2 — the katabatic model needs upslope fetch length, which is a flow-routing
  quantity.
- **HAND** (Rennó et al. 2008) — "how far above the creek am I" is how hunters
  actually describe slope position, and it is a strictly better normaliser for
  bench thresholds than absolute elevation (`BACKLOG I1`).

**Inputs.** The DEM. Nothing else. **We already have everything.**

**Cost.** Measured: 17 ms fill + 27 ms accumulation per 256² tile, desktop;
50–220 ms phone. Cache it like any other derived field.

**The one hard constraint, and it is architectural.** *Flow accumulation is not
tile-local.* A draw's contributing area lives upstream, possibly far outside the
tile plus halo. Computing it per tile with a 20-cell halo produces an
accumulation field that is wrong by an unbounded factor and — worse — **wrong
differently on each side of a tile seam**, which is the visible-seam failure
`grid.ts` warns about, in a form that no halo size fixes.

Two honest options:

1. **Property/region scope (recommended).** Compute it once over the whole
   offline region mosaic at download time and store the derived rasters
   alongside the DEM tiles. `ARCHITECTURE.md` already establishes this path —
   *"Corridor solving over whole-property DEM mosaics"*. This does **not**
   violate "cache elevation, never rendered layers": what is cached is a
   *derived elevation-domain field*, wind- and date-independent, exactly like
   the DEM itself. One field, not a variant per condition.
2. **Tile-local with an honest name.** Cap the contributing area at the halo and
   call it *local flow convergence*, not *flow accumulation*, and never draw it
   as a stream network. Cheaper, and correct about what it is.

Recommendation: build (1), and make the tile path read the cached region field.

**Algorithm sketch** (all zero-dependency, all typed arrays):

```
1. fill(z)           Priority-Flood (Barnes, Lehman & Mulla 2014):
                       push all boundary cells into a min-heap;
                       pop lowest, for each unvisited neighbour raise it to
                       max(z_nb, z_popped + ε) and push.
                     O(n log n). Guarantees no interior sinks and, unlike naive
                     fill, terminates in one pass.
                     ε must exceed the DEM quantum — Terrarium is 1/256 m —
                     or the "filled" surface still has flats.

2. flats             Barnes, Lehman & Mulla 2014a: assign drainage direction
                     over flat surfaces by combining a gradient away from
                     higher terrain with a gradient toward lower terrain.
                     Skipping this is the classic source of parallel-stripe
                     artefacts across flat ground.

3. dir(z)            D8 (O'Callaghan & Mark 1984) for a crisp network, or
                     D∞ (Tarboton 1997) for a hillslope-realistic diverging
                     field. Recommendation: D∞ for the continuous
                     contributing-area field, D8 for the vectorised network,
                     because a fractional network cannot be traced as a line.

4. accum             Topological (indegree-zero queue) accumulation — no
                     recursion, no stack depth risk, O(n).

5. network           Threshold accum > T, thin, trace to polylines, assign
                     Strahler order. T is the only judgement call in the whole
                     pipeline and it is a *cartographic* one, not a biological
                     one — expose it, do not bake it.

6. ridges            Steps 1–5 on -z. Ridge accumulation is the spur skeleton.

7. HAND              For each cell, follow its flow path to the first network
                     cell; HAND = z(cell) - z(that cell). Rennó et al. 2008.
```

**Reference implementations read:** RichDEM (`r-barnes/richdem`, README lists
every algorithm with its citation); WhiteboxTools
(`jblindsay/whitebox-tools`, `hydro_analysis/dinf_flow_accum.rs` →
Tarboton 1997, `fd8_flow_accum.rs` → Freeman 1991,
`elevation_above_stream.rs` → Rennó et al. 2008,
`breach_depressions_least_cost.rs` → Lindsay & Dhun 2015).

Note the **breaching** alternative (Lindsay & Dhun 2015): rather than filling a
depression, cut a channel out of it. On LiDAR this is usually the better choice
because most "depressions" are road culverts and skid trails, not real basins —
and filling them erases the very micro-topography the LiDAR advantage exists
for. Worth evaluating both.

**What must be validated against known-answer surfaces before it ships:**

| Surface (in `testing/synthetic.ts`) | Exactly-known answer |
|---|---|
| `plane(0, -g)` (falls south) | Every D8 direction is due south. Accumulation at row `r` equals `r+1` **exactly** (integers). Fill modifies **zero** cells — assert bit-equality with the input. |
| `saddle(k)` (hyperbolic paraboloid) | Flow diverges from the col along the two falling axes. **Accumulation at the saddle cell is exactly 1** — nothing drains into it. Sharp, and it pins the same convention `surface.test.ts` pins. |
| `channel(concavity, northGrade)` | All flow converges to the axis column. Off-axis accumulation is exactly 1; on-axis at row `r` is exactly `(r+1)·W` for a symmetric V. |
| `plane` with one cell lowered by δ | Priority-Flood raises **exactly one** cell, by exactly δ+ε. Assert the count of modified cells is 1. |
| `paraboloid(k>0)` (a closed pit) | The whole basin fills to the rim minimum; the flat-resolution step must then produce a *radial*, not striped, direction field. This is the test that catches a missing step 2. |
| `cone(s)` (rises to centre) | Radially symmetric divergence: accumulation must be invariant under 90° rotation of the grid to within one cell. |
| **Any surface, including real LiDAR** | Global invariants: `Σ accumulation over all outlets == n`; `accum ≥ 1` everywhere; accumulation is monotone non-decreasing downstream. These three catch nearly every implementation bug and cost nothing. |

**Degenerate cases that must be handled explicitly** (per non-negotiable 5): a
perfectly flat field has no drainage direction at all — return a defined
"undrained" sentinel, never an arbitrary direction; a plateau with a single
outlet must route to it, not spiral; `NODATA` must terminate a flow path rather
than propagate.

**Halo:** `requiredHalo()` cannot express "the whole catchment". This operator
must not go through the per-tile path — see the architectural constraint above.

---

### 5.2 Terrain-resolved thermal (slope-flow) field

**What it computes.** Per cell: the direction air is moving and its speed,
during the katabatic (sinking) and anabatic (rising) regimes — replacing the
single global `ThermalPhase` plus `min(1, slope/30)` strength.

**What it answers that we cannot answer today.** *"It's 17:20, I'm on this
bench, where does my scent go and how fast, and when does the draw below me turn
over?"* Today the whole DEM has one phase and strength rises monotonically with
local slope — a term `BACKLOG I7` flags as possibly **inverted**, since LES work
finds katabatic maximum speed *decreasing* with slope angle over gentle slopes.

**The model, and why it is a good fit.** WindNinja's diurnal slope-flow model
(`src/ninja/cellDiurnal.cpp`, **public domain** — the header states it is US
federal government work not subject to copyright) is not a PDE. It is
**closed-form algebra per cell**:

```
downslope (katabatic), Qh < 0:
    Le = 0.05 · Δz / (Cd + Ce)
    S  = [ (−Qh · g · L · sinα) / (ρ · cp · T · (Cd + Ce)) ]^(1/3)
         · [ 1 − exp(−L / Le) ]^(1/3)

upslope (anabatic), Qh > 0:
    S  = [ (Qh · g · Δz) / ((Cd_up + Ce_up) · ρ · cp · T) ]^(1/3)

direction: upslope   → azimuth = aspect − 180, elevation = +slope
           downslope → azimuth = aspect,       elevation = −slope
```

where `L` is the along-slope distance to the hilltop (downslope) or valley
bottom (upslope), `Δz` the elevation change over it, `Qh` the surface sensible
heat flux, and WindNinja's defaults are `Cd_down = 0.0001`,
`Ce_down = 0.01`, `Cd_up = 0.2`, `Ce_up = 0.2`.

Three properties make this the right candidate:

1. **The direction term is already what we compute.** `computeThermals()`
   already returns `aspect` for sinking and `aspect + 180` for rising. Only the
   strength changes.
2. **Strength depends on `L` — the fetch — not on local slope.** That is the
   answer to `I7`: our monotone-in-slope term has no support because *slope is
   not the driver*; the length of the drainage path above you is. A long, gentle
   hollow drains harder than a short steep face, which is exactly what hunters
   describe and exactly what our current term gets backwards.
3. **`L` is a flow-routing quantity**, which is why §5.1 sequences first: walk
   the D8 path uphill to the divide and accumulate distance and drop.

**Sanity check against an independent source.** Running the formula with
WindNinja's defaults on plausible Appalachian geometry:

| `Qh` (W m⁻²) | `L` (m) | `sinα` | `S` |
|---|---|---|---|
| −100 | 1000 | 0.20 | 3.31 m/s (**11.9 km/h**) |
| −100 | 2000 | 0.15 | 3.98 m/s (**14.3 km/h**) |
| −60 | 400 | 0.30 | 2.16 m/s (7.8 km/h) |
| −30 | 200 | 0.35 | 1.38 m/s (5.0 km/h) |

`docs/EVIDENCE.md` grades katabatic flows 🟢 and records them running
**10–30 km h⁻¹ in a layer 10–100 m deep** (RMetS; UBC ATSC 113). The model,
with no tuning, lands inside that range on long slopes and just below it on
short ones. That is a real cross-check, from a source that knows nothing about
this formula. It also shows the model is **dimensionally correct**: the bracket
has units m³ s⁻³ and its cube root is m s⁻¹ — verify that in a test, because a
units error here is precisely the class of bug `EVIDENCE.md` caught at 1000× in
the Fancy & White row.

**Inputs, and what we are missing.** `L`, `Δz`, `sinα`, `aspect`, `slope` — all
from the DEM (given §5.1). `ρ`, `cp`, `T` — standard, weakly sensitive.
**`Qh`, the sensible heat flux, is the gap.** WindNinja derives it from a
radiation balance needing cloud cover, air temperature, albedo, Bowen ratio and
surface roughness. We have none of those offline.

Honest options, in order of increasing honesty:
- Treat `Qh` as a **user-set intensity** ("clear and calm" / "overcast and
  breezy") mapped to a small table of values, and grade it 🔴.
- Derive a *relative* `Qh` field from what we do have: net radiation scales with
  the insolation the cell received, and cooling begins when the cell **loses the
  sun** — which is `castShadows()`, currently unwired (§1.1), evaluated across
  the afternoon. That gives a genuinely spatial cooling-onset field: the east
  face starts draining an hour before the west face. This is the most
  hunting-relevant output in the whole document and it is computable from the
  DEM alone.
- Note the model is most useful **as a ratio field** — which draw drains
  hardest, which bench turns over first — where the absolute `Qh` cancels.
  **Ship the ratio, not the metres per second**, until `Qh` has a real source.

**Cost.** One uphill/downhill walk per cell (bounded by the flow path) plus
constant-time algebra. Same order as §5.1's accumulation: tens of ms desktop.

**Validation against known-answer surfaces:**

| Surface | Exactly-known answer |
|---|---|
| `plane(0, -g)` | Sinking azimuth == aspect == 180° for every cell. `L` at row `r` is the distance to the north edge, so `S(r)` has a **closed form** — assert it cell by cell, not just its ordering. |
| Flat plane | `L = 0`, `sinα = 0` → `S == 0` **exactly**, not `NaN`, not `0/0`. Also `Qh = 0` → `S == 0`. |
| `saddle(k)` | Drainage converges along the falling axis and diverges along the rising axis; the convergence multiplier must be > 1 on one and == 1 on the other. |
| `hillsideWithBench` | The bench must show *lower* `S` than the slope above it (fetch continues but `sinα` collapses) — the physical claim that a bench is a place where sinking air slows and lingers, which is the doctrine the layer exists to encode. |
| dimensional | `S` for `Qh=−100, L=1000, sinα=0.2, T=283, ρ=1.2, cp=1005, Cd+Ce=0.0101` must equal **3.31 m/s** to 2 d.p. Pin it. |

**Evidence obligations.** This adds parameters, so `game-biologist` must grade
them before it ships. The physics is 🟢. `Cd`, `Ce` and the `0.05` in `Le` are
WindNinja's, and **I could not identify the primary reference for this scaling
in this pass** — the source file cites none, and the shipped thesis covers the
mass-consistent model, not the diurnal one. It has the form of a bulk/hydraulic
katabatic model; whoever implements this must find and read the primary source
first. Do not let the coefficients enter the register as 🟢 on the strength of
"WindNinja does it".

**Also fold in, since it is the same file:** `BACKLOG R19`'s measured
forward-offset transition windows (`morning: 110`, `evening: 35`). This model
gives them a spatial dimension — onset is per-cell once cooling onset is
per-cell.

---

### 5.3 Horizon-map precompute

**What it computes.** For each cell, the horizon elevation angle in each of
*k* azimuths (typically 16–32), stored once as `k` Float32 planes.

**Why it is on the list despite computing nothing new by itself.** Four shipped
or wanted operators are all secretly the same computation, each ray-marching
independently and each truncated at a different radius:

| Operator | today | with a horizon map |
|---|---|---|
| `skyViewFactor` | 301 ms/tile, r=24, non-standard formula | `mean(1 − sin h_φ)` — **O(k) lookups**, exact, standard |
| `castShadows` | O(n·r) per sun position, **and unwired** | `lit = sunAlt > h_at(sunAzimuth)` — O(1) per cell **per time step** |
| `terrainShelter` | O(n·r), one bearing, r=20 cells = 146 m | O(1) per bearing → **wind scrubbing becomes free**, and 500 m costs nothing extra |
| Winstral `Sx` (§6.2) | not built | it *is* the horizon map, by definition |
| Geomorphons (#7) | not built | ternary pattern from zenith/nadir horizons — nearly free |
| Openness (Yokoyama) | not built | positive/negative openness are horizon means |

Measured: the current 16-direction r=24 march costs **301 ms/tile**; a 32-direction
r=50 march costs **1089 ms**. A monotone horizon sweep over 32 directions costs
**94 ms** — and is **not radius-truncated**, so it is strictly more accurate.
That is ~12× on the like-for-like comparison and ~3× on the one we ship, while
also fixing §1.1 and §1.3 and making the time-scrub and wind-scrub interactive.

**Algorithm.** Along a single profile, the set of horizon points seen looking in
one direction is the **upper convex hull of the profile scanned from the far end
back** — maintainable with a monotone stack in O(n) amortised. (First
principles; this is why the classic algorithm is linear.) The standard reference
is Dozier, Bruno & Downey (1981), *A faster solution to the horizon problem*,
Computers & Geosciences 7:145–151 — **cited from memory; I could not verify this
one against a source in this pass** and it must be confirmed before it goes in a
doc comment. What I *did* verify: `USDA-ARS-NWRC/topocalc` implements
`horizon()` "based on Dozier and Frew 1990", ported from the IPW `hor1f` kernel,
and gets arbitrary azimuths by **skewing and transposing the grid so every
direction becomes a row** (`topocalc/skew.py`, `topocalc/horizon.py`). Note
topocalc's port simplified `hor1f` to a quadratic inner scan; write the monotone
version, not that one.

Then, from Dozier & Frew (1990), the slope-aware sky-view factor
(`topocalc/viewf.py` reproduces their equation 7b):

```
Vd ≈ (1/2π) ∮ [ cos(S)·sin²(H_φ) + sin(S)·cos(φ − A)·(H_φ − sin H_φ cos H_φ) ] dφ
```

and the terrain configuration factor `tcf = (1 + cos S)/2 − Vd`, which is what
you need for terrain-reflected radiation. Both are per-cell O(k) once the
horizon map exists.

**Storage.** 32 directions × 256² × Float32 = **8 MB per tile**. That is far too
much to cache. Three mitigations, in order of preference: (a) keep it in the
worker for the lifetime of a tile's analysis and discard it — it is a *shared
intermediate*, not a cached product, and it already pays for itself within a
single `analyze()` call that wants shadows + shelter + SVF; (b) quantise to
Uint8 over 0–90° (0.35° resolution) → 2 MB; (c) reduce to 16 directions → 1 MB
at Uint8. Recommendation: (a) + (c). **Do not put it in the offline store** —
that would be caching a rendered intermediate, and it is derivable in 94 ms.

**Validation against known-answer surfaces:**

| Surface | Exactly-known answer |
|---|---|
| `plane(0, -g)` | Horizon looking uphill = `atan(g)`; looking downhill = 0; at azimuth θ from uphill = **`atan(g·cosθ)`**. Assert all 32 directions in closed form. |
| `cone(s)` rising to centre | From any cell, the horizon toward the apex is the apex itself, at exactly `atan(s)`; away from it, 0. |
| flat | Every horizon is 0; SVF is exactly 1; every cell is lit for any positive sun altitude. |
| `plane` at slope S, unobstructed | Dozier & Frew SVF must equal **`(1 + cos S)/2`** — 0.9330 at 30°, 0.8536 at 45°. This is the test the current implementation fails (§1.3). |
| shadows on `plane` | A cell is lit iff `sunAltitude > atan(g·cos(sunAz − uphillAz))`. Exact, and testable across a whole simulated day. |

**Halo:** an unlimited-radius horizon is not tile-local either, but it degrades
*gracefully and conservatively* — a truncated profile can only under-estimate
the horizon, i.e. report a cell as more exposed than it is. That is a safe
direction for a shelter layer and an unsafe one for a shadow layer. Size the
halo from the tallest plausible local relief (`grid.range()` gives it) rather
than a constant, and **fix §1.5 first** or the halo silently reads as open.

---

## 6. The two you named

Both were named in the brief as leading candidates. Both survive. Both need
their form changed, and the reason is the same in each case: **our cost surface
and our terrain are anisotropic, and the canonical algorithm for each is not.**

### 6.1 Circuit theory — yes, but as randomised shortest paths, not Circuitscape

**The case for.** It is strong and the brief states it correctly. A least-cost
path is one line; circuit theory models all paths in parallel, weighted by how
good they are, and current density *is* the pinch-point map. Ours
(`findPinchPoints`) is a geometric width heuristic — it measures the minimum
chord of the corridor mask over 8 orientations, which is a proxy for funnelling,
not a measure of it.

**Why plain Circuitscape is the wrong member of the family for us.** A resistor
network is **undirected**: conductance from *i* to *j* equals conductance from
*j* to *i*. Our whole corridor thesis is that it does not —
`accumulateCost(..., reverse)` exists specifically because climbing out of a
creek costs more than dropping into it, and `docs/RESEARCH.md` §5 calls reusing
the forward field "a common shortcut" that "biases every corridor downhill".
Adopting circuit theory as-is would force us to symmetrise the cost surface,
throwing away the single best-supported modelling decision in the engine
(`EVIDENCE.md` grades anisotropic travel cost 🔵 on biologging across six
mountain-ungulate species).

**Randomised shortest paths keeps both.** RSP (Saerens, Yen, Fouss & Achbany
2009, *Neural Computation* 21(8):2363–2404 — verified in `gdistance`'s own
reference block) has a temperature parameter θ that interpolates continuously:

- **θ → ∞**: collapses to the least-cost path — what we ship today.
- **θ → 0**: becomes a pure random walk, which is *equivalent to circuit theory*
  — what the brief asks for.
- **in between**: the continuum. And θ is exactly the honest knob for "deer are
  not optimisers, but they are not drunkards either".

Crucially, RSP's transition matrix `W = P ∘ exp(−θ·C)` **need not be symmetric**.
Asymmetric costs are native.

**The algorithm, concretely** (read from `cran/gdistance`, `R/probPassage.R`,
`.randomShPaths` / `.probPass`, itself ported from Saerens' Matlab):

```
C[i→j]   = stepCost(i, j)              // our existing anisotropic cost
P[i→j]   = reference random-walk transition (row-normalised conductance)
W        = P ∘ exp(−θ · C)             // Hadamard product, ASYMMETRIC

Wj       = W with the goal set's rows zeroed (absorbing)
z_fwd    = (I − Wj)⁻¹ · e_goal          //  "expected weight onward to B"
z_bwd    = (I − Wj)⁻ᵀ · e_source        //  "expected weight back from A"
zAB      = e_sourceᵀ · z_fwd

N[i→j]   = z_bwd[i] · Wj[i→j] · z_fwd[j] / zAB     // expected passages on arc
passage(cell) = Σ_j N[cell→j]                       // the map we render
```

Two observations that make this genuinely feasible here:

1. **The two solves mirror `computeCorridor` exactly.** `z_bwd` and `z_fwd` are
   the soft-min analogues of `accumulateCost(A, forward)` and
   `accumulateCost(B, reverse)`; `N ∝ z_bwd·W·z_fwd / zAB` is the soft analogue
   of `excess = a + b − optimal`. Same structure, softened. The corridor code
   does not get replaced; it gets a second mode.
2. **No sparse-matrix library is needed.** `(I − Wj)` is a fixed 8-neighbour
   grid stencil, and because `Wj` is sub-stochastic its spectral radius is < 1,
   so the **Neumann series converges**: `z ← e + Wᵀz`, iterated. That is a
   matrix-free stencil sweep, measured at **1.20 ms/iteration** on 256²
   (§2). No dependency, no factorisation, no `Matrix` package.

**Cost.** Unpreconditioned iterative convergence on a 256² grid needs of order
250–500 sweeps → **0.3–0.6 s desktop, 1.5–5 s phone**, twice (forward and
backward). That is a **precompute**, not a live layer — but the corridor solve
is *already* a user-initiated action (`BACKLOG R7`, "pick two areas, solve"), so
this fits the existing interaction without changing the offline story. If it
needs to be faster later, a cascadic coarse-to-fine start (solve at 64², prolong,
refine) typically cuts iterations by an order of magnitude and is ~60 lines.

**The numerical hazard, stated because it produces silent nonsense.**
`exp(−θ·C)` underflows to zero for large `θ·C`, and then `z` is all zeros,
`zAB` is zero, and `N` is `0/0`. `gdistance` guards this explicitly — it checks
`zcij < 1e-300` and returns an all-zero raster. **An all-zero corridor rendered
as a colour ramp is a map that says "no movement anywhere", confidently.** The
implementation must (a) subtract the least-cost value so costs are relative
before exponentiating, (b) assert convergence and residual, and (c) **refuse to
render** — grey out, per non-negotiable 3 — rather than emit a degenerate field.

**Validation against known answers:**

| Case | Exactly-known answer |
|---|---|
| uniform-cost grid, θ large | Passage field collapses onto the existing Dijkstra path. Compare cell-for-cell against `leastCostPath` — a **cross-check between two independent algorithms**, which is stronger than either alone. |
| any surface, any θ | **Flow conservation**: net passage is divergence-free at every non-terminal cell, and total net current out of the source is exactly 1. This is a Kirchhoff identity and it catches almost every indexing bug. |
| 1-D chain of *n* unit resistors, θ→0 | Effective resistance is exactly *n*. |
| symmetric cost surface, θ→0 | Reciprocity: `R_eff(A,B) == R_eff(B,A)` to solver tolerance. |
| **asymmetric** cost surface | Reciprocity must **fail**, and in the right direction — the uphill solve must cost more. This is the test that proves we did not accidentally symmetrise. |
| barrier maze | A single-cell-wide gap must carry 100 % of the passage. Trivially known, and it is the pinch-point claim. |

**Adjacent framework worth knowing:** spatial absorbing Markov chains (Fletcher
et al. 2019, *Ecology Letters*, doi:10.1111/ele.13333, implemented in the `samc`
R package). Same `(I − Q)⁻¹` machinery, but the outputs are *"expected time to
reach the food source"* and *"expected number of visits to this cell"* — which
are arguably more legible to a hunter than current density. If someone builds
the solver for RSP, these come almost free from it.

**What stays 🔴 regardless.** None of this improves the resistance surface. The
15 hand-picked NLCD multipliers (`EVIDENCE.md`, `BACKLOG I4`) are still invented,
and a prettier algorithm on an invented surface is a prettier wrong answer. **Do
`N8` (cervid energetics curve) and `I4` before or alongside this**, not after.

### 6.2 Terrain wind fields — yes, via Winstral `Sx`, and it only gets you half

**The case for is unarguable.** Every wind-dependent layer we ship —
`windExposure`, `terrainShelter`, `beddingLikelihood`, the scent cone, the stand
wind-check — assumes one bearing everywhere. In broken terrain that is wrong at
the scale of a single hollow, and broken terrain is the product's whole target.

**The viable algorithm.** Winstral & Marks' terrain-parameter wind model, read
from `USDA-ARS-NWRC/smrf` (`smrf/utils/wind/model.py`,
`smrf/distribute/wind/winstral.py`):

- **`Sx`** ("maxus", maximum upwind slope): for each cell and each of *k*
  bearings, the maximum slope from that cell to any cell along the upwind search
  vector within `dmax`. **Positive = sheltered, negative = exposed.** This is
  *the same quantity* our `terrainShelter` already computes, and it is *the
  horizon map of §5.3* — the source comment even says the calculation "can be
  increased by using the techniques from the horizon function".
- Averaged over a window of bearings, to capture obstacles adjacent to the
  exact upwind line.
- **`Sb`**, an upwind break-in-slope parameter, combined with `Sx` to delineate
  lee-side deposition zones — i.e. *where the flow separates behind a crest*.
  That is the "swirl behind the ridge" every hunting article describes, and it
  is a computable terrain parameter.
- A piecewise-cubic mapping from `Sx` to a **wind-speed multiplier** on the
  flat-terrain wind (the exact coefficients are in `winstral.py:243–271`).

**Why it earns a place where the mass-consistent model does not:**

- Zero dependencies, O(n) per bearing given §5.3's horizon map, and the whole
  16- or 32-bearing library precomputes once per region alongside the DEM —
  which means **wind scrubbing stays instant and the offline promise holds**.
- It has a published skill score. Winstral, Marks & Gurney 2009, *Hydrological
  Processes* 23(17):2526–2535: the model *"explained 69 % of the observed
  variance with a mean absolute prediction error of 0.8 m/s, 19 % of the
  observed wind mean"*, across three instrumented mountain sites. (Abstract read
  from `smrf/docs/references.bib`.) Compare that with the entirely unmeasured
  30°-horizon-equals-full-shelter constant we ship today (`EVIDENCE.md`, 🔴).
- `Sx` also directly supersedes `BACKLOG R23`: the distance-limited TOPEX result
  (500 m optimum) is the same family of parameter and the same search.

**The honest limitation, and it is the important sentence in this section.**
`Sx` gives **speed**, not **direction**. It will tell a hunter this bench sits in
a 40 %-reduced wind on a NW bearing. It will *not* tell them the wind arrives
from the west there because the hollow channels it. Directional deflection is
what a mass-consistent or CFD model buys, and it is the thing we cannot afford.

The cheap partial answer is the MicroMet terrain-adjustment: a speed weighting
from slope-in-the-wind-direction plus curvature, and a direction diversion term
driven by the same curvature — Liston & Elder (2006), *A meteorological
distribution system for high-resolution terrestrial modeling (MicroMet)*,
Journal of Hydrometeorology 7(2):217–234. **I could not verify this citation or
its coefficients against any reference implementation reachable in this pass** —
`gdistance`, `smrf` and `topocalc` do not contain it and MeteoIO is not mirrored
on GitHub. It is recalled, not verified. If it checks out, it is attractive
because it needs only `slope`, `aspect` and `curvature`, all of which we already
compute; if it does not, ship `Sx` for speed and **say plainly in the UI that
direction is the synoptic bearing, unmodified**. Do not interpolate a deflection
we cannot source.

**Validation:** on `plane`, `Sx` is exactly `atan(g·cos(θ − uphillAz))` for
every bearing — same closed form as §5.3, which is the point. On `ridge()`, the
lee-side cell immediately behind the crest must have the maximum `Sx` for the
crest-normal bearing, and `Sb` must flag exactly the break-in-slope row. On flat
ground `Sx == 0` for all bearings and the multiplier is exactly 1 — the
degenerate case that must not produce a speckled "shelter" field.

---

## 7. The rest of the shortlist, briefly

**#6 — 16-neighbour Dijkstra.** Add 8 knight offsets to `NEIGHBOURS` in
`leastcost.ts`; the metrication error drops from 8.24 % to 2.75 % (§1.2), and
the closed-form test is three lines. **One real hazard**: a knight's move jumps
*over* a cell, so a one-cell-wide hard barrier (a cliff band, a fence line) can
be leapt. Guard it — reject the step if either intermediate cell is
non-finite-cost. Cost is ~2× the relaxations. This is the highest
value-per-hour item in the document.

**#7 — Geomorphons** (Jasiewicz & Stepinski 2013, *Geomorphology* 182:147–156;
verified in both `OSGeo/grass` `r.geomorphon.html` and
`jblindsay/whitebox-tools` `geomorphons.rs`). Classifies each cell by the
8-tuple ternary pattern of its line-of-sight neighbours (higher / lower / equal)
within a search radius, using zenith **and** nadir angles. 498 distinct
geomorphons reduce to 10 named forms — one of which is **saddle**. Two reasons
to care: it is *scale-flexible by a single radius parameter* rather than by a
curvature tolerance (which is what `BACKLOG N14` is about, and what
`WoodOptions.gradientChangePerCell` is a workaround for), and it becomes nearly
free once §5.3 exists, since the zenith/nadir angles *are* the horizon map.
Given that saddles are described in `VISION.md` as the highest-value single
feature on a topo map, a second independent saddle detector that agrees or
disagrees with `WoodFeature.Pass` is worth having on its own.

**#8 — Multiscale DEV** (Lindsay, Cockburn & Russell 2015, *Geomorphology*
245:51–61; verified in `whitebox-tools` `dev_from_mean_elev.rs` and
`multiscale_topographic_position_image.rs`). `DEV = (z − mean_r) / sd_r` — a
local z-score — evaluated across a range of radii, reporting per cell the
*scale at which it stands out most* and by how much. The integral-image
formulation makes it cost-invariant with radius; we already use summed-area
tables in `computeTpi`, and this needs only a second SAT of `z²`. It is the
principled answer to `BACKLOG I1` ("do bench thresholds need to scale with
regional relief?") — instead of picking a radius, report the one the terrain
picks. **Watch the degenerate case**: dividing by `sd_r` is exactly the
`standardize()` trap that already bit this repo once; the same noise floor
applies, and it applies *per window*, not globally.

**#9 — Parameter-ensemble uncertainty layer.** The brief suggested Monte Carlo
over the 🔴 parameters. I would do something cheaper and more legible: not random
sampling, but a small **deterministic ensemble at the uncertainty bounds
`EVIDENCE.md` already publishes** — `k_up` 23/26/32, `k_dn` 6/8/13, `R_min`,
`idealSlopeDeg` 12 vs 22, shelter saturation, cover normaliser. Evaluate the
layer at each corner (or a Latin-hypercube subset), and render **agreement**:
the fraction of the ensemble that classes a cell as prime. Cells prime under
every parameterisation are genuinely prime; cells prime under one are an
artefact of a guess. That is 8–32 evaluations of a per-cell function — tens of ms
— and it is `VISION.md` advantage #4 rendered as a raster instead of a chip.
Sequence after `R18` (banding), because agreement over a continuous ramp is
meaningless.

**#10 — Viewshed.** Already `ROADMAP` Phase 5. Algorithm guidance: GRASS
`r.viewshed` uses the Haverkort, Toma & Zhuang radial sweep (ACM JEA 13, 2009),
which is the right choice for a single-observer viewshed and models terrain as
bilinearly interpolated rather than blocky. For our purposes the §5.3 horizon map
gives a *cheaper approximate* viewshed for free (visible iff the target's
elevation angle exceeds the horizon in its azimuth), exact along the sampled
azimuths and interpolated between. **The honest caveat must ship with the
layer**: a bare-earth viewshed answers "is there terrain between us", not "can
the deer see me". Under leaf-on timber the terrain answer is almost always yes
and almost always irrelevant. Ship it as *terrain intervisibility*, never as
*"deer can see you here"*.

---

## 8. Already filed — deliberately not re-proposed

Checked against `docs/BACKLOG.md` so this document does not create duplicates:

| Idea | Already tracked as |
|---|---|
| Scent-cone stability ordering / σ_y magnitudes | `R13`, `N11` |
| Cervid energetics replacing Tobler | `N8` |
| Snow term in the cost surface | `N15` |
| NLCD resistance magnitudes from Lilly et al. 2025 | `I4` |
| Bedding slope re-centring / bench-geometry reformulation | `R11` |
| Slope double-count via TRI → VRM | `R21` |
| Season-aware solar aspect in bedding | `R22` |
| Shelter radius → 500 m | `R23` (see §1.5 — it crosses the halo limit at z≥16) |
| Asymmetric thermal transition windows | `R19` (§5.2 gives it a spatial dimension) |
| Is `min(1, slope/30)` backwards? | `I7` (§5.2 argues the premise is wrong: fetch, not slope) |
| Curvature noise floor | `N14` (§7 #7 offers a different route) |
| Bench thresholds vs regional relief | `I1` (§7 #8 offers a principled route) |
| Contours | `N6` (shares vectorisation with §5.1) |
| Viewshed | `ROADMAP` Phase 5 |
| Confidence chips / banding | `R10`, `R14`, `R18` (#9 depends on these) |

**Three items in §1 are new and are defects, not research**, and should be filed
as such by whoever grooms this: shadows unwired from insolation (§1.1), the
8.24 % corridor grid bias (§1.2), and the sky-view definition mismatch (§1.3).
The halo-overflow silent-degradation (§1.5) is a latent one that `R23` will
trip.

---

## 9. Sources

Every citation below was verified in this pass by reading the source or
documentation of a reference implementation, **except the three marked
`[unverified]`**, which are recalled and must be confirmed before they justify a
design decision or enter a doc comment.

**Connectivity**
- Saerens, Yen, Fouss & Achbany 2009, *Randomized shortest-path problems: two
  related models*, Neural Computation 21(8):2363–2404 — via `cran/gdistance`
  `R/probPassage.R` reference block; algorithm read from the same file.
- McRae, Dickson & Keitt 2008, *Using circuit theory to model connectivity in
  ecology, evolution, and conservation*, Ecology 89:2712–2724 — same block.
- Fletcher et al. 2019, doi:10.1111/ele.13333 — via `cran/samc` `DESCRIPTION`.
- Circuitscape.jl — solver strategy (`docs/src/compute.md`), Laplacian
  construction (`src/core.jl`), and raster→graph conductance averaging
  (`src/raster/pairwise.jl`: cardinal `(x+y)/2`, diagonal `(x+y)/(2√2)`).
- Omniscape.jl — moving-window algorithm (`docs/src/algorithm.md`).
- GRASS `r.cost` — knight's-move accuracy note (`raster/r.cost/r.cost.html`).

**Hydrology / geomorphometry**
- Barnes, Lehman & Mulla 2014, *Priority-flood*, Computers & Geosciences
  62:117–127; and 2014a, *An efficient assignment of drainage direction over flat
  surfaces*, 62:128–135 — via `r-barnes/richdem` README.
- Tarboton 1997, Water Resources Research 33(2):309–319 (D∞); Freeman 1991,
  Computers & Geosciences 17(3):413–422 (FD8); Rennó et al. 2008, Remote Sensing
  of Environment 112(9):3469–3481 (HAND); Lindsay & Dhun 2015, IJGIS 29:1–15
  (least-cost breaching) — all via `jblindsay/whitebox-tools` source headers.
- Jasiewicz & Stepinski 2013, *Geomorphons*, Geomorphology 182:147–156 — via both
  `OSGeo/grass` `r.geomorphon.html` and `whitebox-tools` `geomorphons.rs`.
- Lindsay, Cockburn & Russell 2015, Geomorphology 245:51–61 — via `whitebox-tools`
  `multiscale_topographic_position_image.rs`.
- Yokoyama, Shirasawa & Pike 2002, *Visualizing topography by openness*, PE&RS
  68:257–265 — via `saga-gis` `topographic_openness.cpp` reference block.
- Wood 1996 (thesis) — via `OSGeo/grass` `r.param.scale.html`; already ours.

**Radiation / horizon / wind**
- Dozier & Frew 1990 — sky-view factor eq. 7b and the horizon method, via
  `USDA-ARS-NWRC/topocalc` `viewf.py` / `horizon.py`.
- `[unverified]` Dozier, Bruno & Downey 1981, *A faster solution to the horizon
  problem*, Computers & Geosciences 7:145–151.
- Hofierka & Šúri 2004, Transactions in GIS 8(2):175–190 — via GRASS
  `r.horizon.html` / `r.sun.html`.
- Winstral, Elder & Davis 2002, J. Hydrometeorology 3(5):524–538 (`Sx`, `Sb`);
  Winstral, Marks & Gurney 2009, Hydrological Processes 23(17):2526–2535 (69 %
  variance, 0.8 m/s MAE) — abstracts via `USDA-ARS-NWRC/smrf`
  `docs/references.bib`; implementation via `smrf/distribute/wind/winstral.py`.
- `[unverified]` Liston & Elder 2006, *MicroMet*, J. Hydrometeorology
  7(2):217–234.
- Forthofer, Butler & Wagenbrenner 2014, Int. J. Wildland Fire 23:969–931 — the
  WindNinja citation, from `firelab/windninja` `CITATION`.
- Forthofer 2007 MS thesis — mass-consistent formulation (Sasaki variational
  method), runtimes, FEM/Jacobi-CG solver; read from
  `firelab/windninja` `doc/forthofer_thesis.pdf`.
- WindNinja diurnal slope-flow model — `firelab/windninja`
  `src/ninja/cellDiurnal.cpp` (`compute_S`, `compute_UVW`) and
  `src/ninja/WindNinjaInputs.cpp` (default coefficients). **Public domain.**
  `[unverified]` primary reference for the scaling — none is cited in the source
  and it must be found before the coefficients are graded.

**First-principles derivations in this document** (no source; shown so they can
be checked): the 8-connected metrication bound `cos θ + (√2−1) sin θ`, maximum
1.08239 at 22.5° (§1.2); the two sky-view definitions `mean(1 − sin h)` and
`mean(cos² h)` from solid-angle and projected-solid-angle integration (§1.3);
the O(n) horizon sweep as an upper-convex-hull monotone stack (§5.3); the
dimensional check that the katabatic bracket has units m³ s⁻³ (§5.2).

---

## 10. What I am still uncertain about

Stated per the brief, because uncertainty hidden is not fine.

1. **`Qh` is the load-bearing unknown in §5.2**, and it is the one input we do
   not have offline. Everything else in that model is geometry. If the shadow-
   derived relative field does not work out, the layer must ship as a *relative
   ranking* only, and I do not know yet how legible that is to a user.
2. **The WindNinja slope-flow coefficients have no primary reference I could
   find.** The magnitudes are plausible against an independently-cited speed
   range, which is encouraging but is not the same as knowing where they came
   from.
3. **The Liston & Elder MicroMet citation and its coefficients are recalled, not
   verified.** That matters because it is the only cheap route to wind
   *direction* deflection, and §6.2's honesty depends on whether it holds up.
4. **I have not measured the skew/transpose overhead** for off-axis horizon
   directions. The 94 ms figure is for axis-aligned sweeps; the real cost with
   32 arbitrary azimuths will be higher — my guess is 2–3×, still well inside
   budget, but it is a guess.
5. **Iteration counts for the RSP solve are estimated, not measured.** The
   per-iteration cost is measured (1.20 ms); how many iterations θ-dependent
   convergence actually needs on real terrain I do not know, and it could be
   materially worse for small θ where the operator is closest to singular.
6. **Whether `mean(cos h)` was a deliberate choice in `skyViewFactor` or a slip.**
   I have flagged the mismatch between the doc comment and the computation; I
   have *not* established which one is wrong. Do not let anyone "fix" it without
   reading Zakšek et al. 2011 first — that is exactly the pattern that produced
   the curvature sign inversion.
7. **The trustworthiness assessments in §3 are about the *algorithms*, not the
   *interpretations*.** Flow accumulation is exact; "a Strahler-2 draw is a
   travel corridor" is 🟡 doctrine, and `game-biologist` owns that line, not me.
   Every candidate here that draws a colour on a map inherits that split.
