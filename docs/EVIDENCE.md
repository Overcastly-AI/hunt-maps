# Evidence register

Every biological parameter the models encode, with the evidence behind it.
Owned by [`game-biologist`](../.claude/agents/game-biologist.md).

## Why this file exists

The engine is full of numbers that look authoritative. `idealSlopeDeg: 22`.
`minSurroundSlopeDeg: 18`. A Tobler hiking function fitted to *humans* deciding
how a *deer* routes. Each one renders a confident colour on a map somebody uses
to decide where to sit before daylight.

`terrain-scientist` verifies those numbers are applied correctly.
`analytics-auditor` verifies the statistics are honest. Until this register
existed, **nothing checked whether a whitetail actually beds at 22°.**

An `Assumed` grade is not a failure. Hiding one is.

## Grades

| Grade | Means |
|-------|-------|
| 🟢 **Measured** | Direct empirical measurement in peer-reviewed work on this or a closely related species |
| 🔵 **Inferred** | Derived from measured findings by stated reasoning |
| 🟡 **Doctrine** | Consistent, widely-reported field practice; no measurement behind it |
| 🔴 **Assumed** | A number chosen because the code needed one |

**Current state: 4 Measured · 5 Inferred · 6 Doctrine · 9 Assumed.**
Nine red rows is the honest starting position, not a target we have hit.

---

## Locomotion and movement cost

### 🔵 Anisotropic travel cost — `corridor/cost.ts`
**Claim:** movement cost depends on grade *along the direction of travel*, not
on slope alone.

**Evidence:** Biologging across six mountain-ungulate species found animals
**travel obliquely so the angle any individual experiences is lower than the
angle of the topography**, and that travel speed affects cost of transport, with
most species slowing on steeper inclines. That is a direct empirical statement
that ungulates route to manage *experienced* grade — exactly what an isotropic
cost surface cannot express.
[Steep slopes, shallow angles (Can. J. Zool. 2024)](https://cdnsciencepub.com/doi/10.1139/cjz-2024-0095)

**Assessment:** the strongest-supported modelling decision in the engine.
Promote from Inferred to Measured once we cite per-species cost-of-transport
curves rather than the qualitative finding.

### 🔵 Tobler-shaped speed function — `toblerSpeed()`
**Current:** `6 · exp(−3.5 · |grade + 0.05|)` — Tobler's hiking function, fitted
to **humans**.

**Evidence for the substitution:** red deer treadmill work measured the energy
cost of horizontal locomotion above standing at **2.6 J·kg⁻¹·m⁻¹**, at 7° and 14°
gradients across 44–173 m/min.
[Brockway & Gessaman, *Q J Exp Physiol* 1977](https://pubmed.ncbi.nlm.nih.gov/243923/)
Caribou work puts the cost of ascent at **5.9 kcal per kg per vertical metre on
a 14.3° incline**, with **upslope efficiency 40–45%** and downslope efficiency
*decreasing* with body size.
[Fancy & White, *Can. J. Zool.* 1987](https://cdnsciencepub.com/doi/10.1139/z87-018)

**Assessment: this is a real gap.** Tobler's *shape* — peak at a slight
downhill, steep uphill penalty, moderate steep-downhill penalty — is defensible
for any large terrestrial walker, and the ungulate literature supports the
downhill-penalty term specifically (efficiency falls with body size). But the
*coefficients* are human. A cervid-parameterised curve is buildable today from
Brockway and Fancy & White.

**Action:** `BACKLOG N8` — replace with a cervid energetics curve. This is the
highest-value evidence upgrade available.

### 🟢 Escape terrain ≥10% slope
**Evidence:** landscape-genomics work found gene flow occurred over longer
distances where escape terrain — areas of at least 10% slope — was available.
[Testing least-cost path models (PLOS One 2020)](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0239387)

**Assessment:** supports treating moderate slope as facilitating rather than
purely resisting movement. **Not yet implemented** — the current cost surface
penalises all grade monotonically.
**Action:** `BACKLOG N9`.

### 🔴 `impassableSlopeDeg: 55`
No literature located for a whitetail refusal threshold. Chosen as "steeper than
anything a deer routinely crosses". Plausible, unsupported.

### 🔴 NLCD resistance table — `NLCD_RESISTANCE`
Fifteen hand-assigned multipliers (woody wetlands 0.85, row crops 2.8, …). The
*ordering* is defensible doctrine; the *magnitudes* are invented. Resistance
surfaces are normally parameterised from telemetry or landscape genetics, and we
have done neither.
**Action:** `BACKLOG I4` — and note NLCD's 30 m grid misses sub-canopy structure
(regen thickets, CRP edges) that matters more to deer than the NLCD class.

---

## Bedding

### 🔴 `idealSlopeDeg: 22`, `slopeToleranceDeg: 14`
**The weakest number in the engine, and it drives a headline layer.**

A literature search for whitetail bed-site slope-angle selection returned no
study reporting a preferred bed-site *gradient in degrees*. Bed-site work
reports cover type, snow depth, thermal exposure and aspect — not slope angle.

The 22° centre is an inference from field doctrine that deer bed on ridge points
and benches with a downhill view, and from the observation that beds occur on
grade rather than on flats or cliffs. It is not measured.

**Assessment:** the Gaussian shape is fine and the tolerance is honestly wide.
But this must be surfaced with a `Confidence` chip graded `Assumed`, and it must
not be presented as a measured preference.
**Action:** `BACKLOG N10` — surface the grade in the bedding layer UI. Longer
term, this is precisely what collar data would settle (`I3`).

### 🟡 Leeward bedding — `cos(aspect − windFrom)`
**Claim:** bucks bed on the leeward side to watch downwind and smell upwind.

Consistently reported across the hunting literature — leeward hillsides, leeward
sides of benches and points, ridge endings on the downwind side.
[Whitetail Properties](https://www.whitetailproperties.com/knowledge-center/terrain-specific-deer-hunting-tactics-from-ridges-to-swamps) ·
[Whitetail Partners](https://www.whitetailpartners.com/post/mastering-topographic-maps-will-make-you-a-better-deer-hunter)

Partially corroborated by peer-reviewed winter work: deer select sites with
**decreased wind velocity**, and conifer stands buffer convective heat loss.
[Lang & Gates 1985](https://www.originalwisdom.com/wp-content/uploads/bsk-pdf-manager/2019/04/Lang-and-Gates_1985_Selection-of-Sites-for-Winter-Night-Beds-by-White-tailed-Deer.pdf)

**Assessment:** wind shelter as a bed-site criterion is measured. The specific
*leeward-aspect* geometry, and the scent-advantage rationale, are doctrine.
Strong doctrine, but doctrine.

### 🔴 Terrain shelter: 30° upwind horizon = full shelter
TOPEX-style shelter indices are established in forestry wind-exposure work; the
30° saturation point is our own choice. Unsupported.

### 🔴 Cover term: ruggedness / 4 m
"4 m of local relief in a 3×3 window is plenty of broken ground." Invented.

### 🟢 Winter thermal cover — **a finding that corrected an assumption**
A long-term assessment of female whitetail winter habitat use found dense
conifer cover functions **more importantly as snow shelter than as thermal
cover**, and that at all four study sites deer made **greater daytime use
(55–>80% probability) of open vegetation at the lowest daily minimum
temperatures** — i.e. they moved *into the open* for solar radiation when it got
coldest.
[A Long-Term Assessment… (PLOS One 2013)](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0065368)

**Assessment:** this is the most useful thing in this register. It directly
**supports the date-aware insolation layer** as a late-season bedding predictor,
and it **warns against** a naive "thermal cover = dense conifer" layer, which we
have not built and now should not build in that form. Recorded so nobody adds it
later thinking it is obvious.

---

## Thermals and scent

### 🟡 Thermals rise when warming, sink and pool when cooling
Universal in the hunting literature and physically sound (slope-driven buoyancy
flows are established boundary-layer meteorology). No cervid-specific study
measuring the effect on deer behaviour was located.

### 🟡 Thermal hubs
Low points collecting thermals from several directions, where deer gather
information before committing to a direction.
[NA Deer Hunter](https://nadeerhunter.com/how-to-hunt-mountain-bucks/)
Doctrine. Not currently modelled as a distinct layer.

### 🔴 Transition window ±45 min around sunrise/sunset
Our choice, deliberately wide because the switch is reported as gradual and
unreliable. No measurement.

### 🔴 Thermal strength saturates at 30° slope
Invented saturation point.

### 🔴 Scent cone: 400 m, 25° half-angle
No source. Scent dispersion is a real atmospheric-transport problem and this is
a cartoon of it. The widening-wedge *shape* is right (plumes disperse
laterally); the numbers are not.
**Action:** `BACKLOG N11` — either source a dispersion model or grade the output
`Assumed` in the UI.

---

## Rut timing

### 🟢 Peak breeding is photoperiod-driven, mid-November across the northern range
Consistently reported: peak breeding occurs roughly 10–20 November every year
**regardless of temperature, moon phase or barometric pressure**.
[Mossy Oak](https://www.mossyoak.com/our-obsession/blogs/deer/predicting-whitetail-movement-new-tech-or-old-school)
Implemented as day-of-year 319 at ≥40°N.

### 🟢 Moon phase does **not** drive the rut — *modelled by exclusion*
Scientific research overwhelmingly confirms the moon's phase has no direct
impact on the peak of the rut or on deer movement; nocturnal illumination may
have a small effect on next-day activity.
[Mossy Oak](https://www.mossyoak.com/our-obsession/blogs/deer/predicting-whitetail-movement-new-tech-or-old-school)

**This is a measured negative result and we act on it.** Moon phase is recorded
as an observation covariate so users can test it against their own data, and is
never used as a predictor.

### 🔵 Latitude shift — southern herds breed later and over a flatter window
Widely reported; our specific interpolation (`319 + (40 − lat) · 1.2` down to
34°N, then `326 + (34 − lat) · 3.5`) is our own curve fitted to that qualitative
pattern. `rutConfidence()` correctly degrades below 38°N.
**Assessment:** the direction is supported, the coefficients are ours.

### 🟡 Peak breeding is often the *worst* week to sit (lockdown)
Strong, consistent doctrine. Surfaced in `PHASE_NOTES` because hunters routinely
read "peak rut" as "best hunting".

### 🔴 Phase window boundaries (seeking −21 to −10 d, chasing −10 to −2 d, …)
Our own partition of a continuous process. Ordering is doctrine; the day counts
are invented.

---

## Weather covariates

### 🟡 Barometric pressure — *trend*, not absolute
Reported: activity increases as pressure falls, with good movement in the
29.90–30.30 inHg band.
[Mossy Oak](https://www.mossyoak.com/our-obsession/blogs/deer/barometric-pressures-influence-on-whitetail-movement-4) ·
[Bowhunting.com](https://www.bowhunting.com/blog/2018/10/15/does-barometric-pressure-move-deer/)

We model the **3-hour trend** because that is where the reporting is most
consistent. The specific band cutpoints (±1, ±3 hPa) are ours.

### 🔴 Pressure trend band thresholds
Invented cutpoints.

---

## Scale and scope

### 🟢 Home range and core area
GPS-collar studies give real numbers, and they vary enormously:

- Louisiana, 14 adult bucks: fall home range **245–2,852 acres**; annual home
  range and core area averaged **484 ha and 90 ha**.
  [LDWF technical report](https://www.wlf.louisiana.gov/assets/Resources/Publications/Deer/space-use_and_movements_of_adult_male_white-tailed_deer_in_northeastern_louisiana.pdf)
- Central Mississippi, 30 bucks: **67% sedentary** (mean 361 ha) and **33%
  mobile** (mean 6,530 ha) — an eighteen-fold difference in strategy within one
  population.
- MSU Deer Lab, 60 bucks: 27% under 500 acres, 25% over 2,000 acres.
  [MSU](https://www.msstate.edu/newsroom/article/2021/10/msu-deer-study-finds-some-are-travelers-others-homebodies)

**Assessment:** two consequences we are not yet acting on.
1. A ~90 ha core area sets the scale at which corridor analysis is meaningful.
   Our 200,000 ha property ceiling is far above any biologically relevant unit.
2. **Roughly a third of bucks are "mobile"** and will not be described by any
   property-scoped model. The app currently implies every deer is resident.
**Action:** `BACKLOG N12`.

### 🟡 Mature buck = ≥3.5 years
Convention in deer management and in the analytics filter. Widely used; the
threshold itself is conventional rather than derived.

### 🔴 Species scope
The product claims "deer or other large game". Every parameter above is
whitetail-derived. Mule deer, elk and blacktail differ enough that silent
borrowing is wrong.
**Action:** `BACKLOG N13` — either scope the models per species or narrow the
product claim to whitetail.

---

## Geomorphometry (not biology, recorded for completeness)

These are 🟢 **Measured** in the sense that they are published, peer-reviewed
algorithms implemented to specification, and `terrain-scientist` validates them
against closed-form surfaces: Horn (1981) slope/aspect, Evans–Young quadratic
curvature, Weiss (2001) multi-scale TPI, Wood (1996) morphometric features,
Riley (1999) TRI, Zakšek/Oštir sky-view factor.

Their *biological interpretation* — that a Wood `Pass` is a deer crossing, that
a Weiss class 2 is a travel corridor — is 🟡 **Doctrine**, and that distinction
is the whole point of this register.

---

## Priority actions

| # | Action | Grade change | Backlog |
|---|--------|--------------|---------|
| 1 | Replace Tobler with a cervid energetics curve (Brockway; Fancy & White) | 🔵 → 🟢 | `N8` |
| 2 | Surface `Confidence` chips on bedding, thermal and scent outputs | — | `N10` |
| 3 | Model escape terrain (≥10% slope) as facilitating, not resisting | 🔴 → 🟢 | `N9` |
| 4 | Scope models per species, or narrow the product claim to whitetail | 🔴 → 🟡 | `N13` |
| 5 | Handle the ~⅓ of bucks that are mobile rather than resident | — | `N12` |
| 6 | Source or honestly grade the scent-dispersion model | 🔴 → 🔵 | `N11` |
| 7 | Obtain GPS-collar data to settle bedding slope, corridor use and shelter | 🔴 → 🟢 | `I3` |

Item 7 would resolve more red rows than everything else combined.
