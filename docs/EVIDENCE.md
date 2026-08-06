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

**Current state: 10 Measured · 5 Inferred · 8 Doctrine · 18 Assumed.**

The red count went *up*. That is the register getting more honest, not the
engine getting worse: the first pass wrote one row per code region, this pass
writes one row per number, and it retracted two citations that did not support
their claims.

> **Reading conditions for this pass.** `WebFetch` was denied at the egress
> proxy for every host attempted, including PubMed, PLOS, Springer, Wiley,
> `fs.usda.gov` and Wikipedia. Everything below was gathered through search
> indexing of abstracts, agency pages and publisher landing pages. **No full
> text was read.** Rows that would change behaviour are marked
> *(abstract only — verify against full text before implementing)*.

---

## Locomotion and movement cost

### 🔵 Anisotropic travel cost — `corridor/cost.ts`
**Claim:** movement cost depends on grade *along the direction of travel*, not
on slope alone.

**Evidence:** biologging across six mountain-ungulate species in the French
Alps found animals **travel obliquely so the angle any individual experiences is
lower than the angle of the topography**, and that models of cost-of-transport
(VeDBA proxy) against slope differ by species and habitat type, with most
species slowing on steeper inclines.
[Steep slopes, shallow angles — *Can. J. Zool.* 2024/25](https://cdnsciencepub.com/doi/10.1139/cjz-2024-0095)

**Assessment:** still the best-supported modelling decision in the engine. The
finding is measured; using it to justify an anisotropic cost surface is our
inference, so this stays 🔵. **Scope:** alpine ungulates (chamois, ibex, mouflon,
red deer, roe deer), not whitetail. The mechanism — route to manage experienced
grade — is not species-specific.

### 🔴 `toblerSpeed()` — Tobler's hiking function *(downgraded from 🔵)*
**Current:** `6 · exp(−3.5 · |grade + 0.05|)`.

**Why this is now red, not blue.** The previous pass graded this 🔵 on the
argument that "Tobler's *shape* — peak at a slight downhill, steep uphill
penalty — is defensible for any large terrestrial walker." **The ruminant
treadmill data contradicts the peak.** Granadina goats walked at −10, −5, 0, +5
and +10 % grades and cost fell *monotonically* across the whole negative range:
**1.91, 2.33, 3.35, 4.68, 6.44 J·kg⁻¹·m⁻¹** respectively.
[Lachica, Prieto & Aguilera 1997, *Br. J. Nutr.*](https://pubmed.ncbi.nlm.nih.gov/9059231/)
No optimum at −5 % appears anywhere in the measured range. The −0.05 offset in
`toblerSpeed` is a human gait artefact and there is no cervid or ruminant
evidence for it.

Second problem: Tobler is a **speed** function and `stepCost` therefore
minimises **time**. The ungulate literature is energetic. A deer moving from bed
to feed is not time-constrained; it is energy- and exposure-constrained.

Quantified consequence of keeping it, at the two grades where ruminant data
actually exists:

- **−10 % descent.** Tobler makes it cost **exactly the same as flat** (1.00×,
  because the function is symmetric about its −5 % peak). The goat treadmill
  measured **0.57× flat**. Tobler over-charges descent by ~75 %.
- **+10 % ascent.** Tobler says 1.42× flat; the goat measured **1.92×**.
  Tobler under-charges ascent by ~26 %.

Both errors push the same way — they flatten the asymmetry between climbing and
descending, which is the *entire* signal a deer corridor model needs. At +45 %
the divergence is worse in the other direction: Tobler charges **33× flat**
against ~8× from the cervid energetics, so it over-penalises steep climbs by
about 4×.

**Action:** `BACKLOG N8` — replace. Parameterised curve given in the next four
rows.

### 🟢 Cervid horizontal locomotion cost `C₀ = 2.6 J·kg⁻¹·m⁻¹`
Net cost of horizontal locomotion above standing, red deer treadmill, measured
at 7° and 14° gradients across 44–173 m·min⁻¹.
[Brockway & Gessaman 1977, *Q. J. Exp. Physiol.*](https://pubmed.ncbi.nlm.nih.gov/243923/)

Cross-check: barren-ground caribou net cost of locomotion was
0.068–0.095 mL O₂·g⁻¹·km⁻¹ — **the lowest of any terrestrial species measured** —
which at 20.1 J·mL⁻¹ O₂ is **1.4–1.9 J·kg⁻¹·m⁻¹**.
[Fancy & White 1987, *Can. J. Zool.* 65](https://cdnsciencepub.com/doi/10.1139/z87-018)
Goats (35 kg) measured 3.35 J·kg⁻¹·m⁻¹, and the incline-running literature
confirms horizontal cost **decreases as a regular function of body mass**.
[Body mass and the energy efficiency of locomotion](https://pubmed.ncbi.nlm.nih.gov/17161970/)

**Recommended value:** `C₀ = 2.6 J·kg⁻¹·m⁻¹`, uncertainty **1.9–3.4**.
Only the *ratio* to the grade terms matters for a cost surface, so absolute
calibration is not load-bearing.

### 🔵 Ascent coefficient `k_up = 26 J·kg⁻¹ per vertical metre`
Two independent ruminant measurements bracket a 70 kg whitetail:

| Species | Mass | Cost to raise 1 kg 1 vertical m | Implied efficiency |
|---|---|---|---|
| Barren-ground caribou | ~100 kg | **23 J** | 43 % |
| Granadina goat | 35 kg | **31.7 J** | 30.9 % |

[Fancy & White 1987](https://cdnsciencepub.com/doi/10.1139/z87-018) ·
[Lachica et al. 1997](https://pubmed.ncbi.nlm.nih.gov/9059231/)

Both are internally consistent: mechanical work is *mgh* = 9.81 J·kg⁻¹·m⁻¹, and
9.81/23 = 43 %, 9.81/31.7 = 31 %. The ordering is what the allometry predicts —
vertical cost is **inversely related to body mass**
([incline-running review](https://pubmed.ncbi.nlm.nih.gov/17161970/)) — so
log-mass interpolation to a 70 kg whitetail gives **26 J·kg⁻¹ per vertical m**
(efficiency 38 %). Uncertainty **23–32**.

> **Units correction to the previous register.** It recorded Fancy & White as
> "5.9 **kcal** per kg per vertical metre". 5.9 kcal is 24 700 J·kg⁻¹·m⁻¹ — a
> 1000× overstatement that would have made every uphill step effectively
> impassable. The correct magnitude is **~5.6 cal ≈ 23 J**. Flagged because it
> was one implementation away from shipping.

🔵 not 🟢 because the interpolation to whitetail mass is ours, and because
Fancy & White measured **only at 4.9–6.0° incline** — everything above ~11 %
grade is extrapolation on an assumed-linear vertical cost.

### 🔵 Descent coefficient `k_dn = 8 J·kg⁻¹ per vertical metre` (a *saving*)
Caribou **recovered 6 J·kg⁻¹ per vertical metre** descending, efficiency 62 %.
Goats recovered **13.2 J·kg⁻¹ per vertical metre**.
Same body-mass ordering, same sources. Log-mass interpolation to 70 kg gives
**8 J·kg⁻¹ per vertical m**, uncertainty **6–13**.

Independent support for the direction: downhill efficiency **decreases with body
size** across species — humans run faster downhill, horses run *slower* downhill
because of forelimb weight-support limits
([incline-running review](https://pubmed.ncbi.nlm.nih.gov/17161970/)). Deer sit
between. The goat data also shows marginal recovery *shrinking* with steepness
(20.4 J per vertical m from 0→−5 %, only 8.4 J from −5→−10 %), so a single
linear coefficient over-credits steep descent.

### 🔴 Downhill floor `R_min = 0.55`
**Unsupported, and the single weakest part of the replacement curve.** Measured
ruminant descent data stops at **−10 % grade**. A linear saving of 8 J per
vertical m drives cost *negative* at about −40 % grade, which is nonsense, so a
floor is structurally required and no cervid measurement sets it. The general
locomotion literature puts downhill mechanical efficiency at **−1.06 to −1.21**
below about −15 % grade (cost keeps falling), with eccentric/braking cost rising
again at extreme declines — but there is no ruminant number for where.

**Principled choice, still 🔴:** set `R_min = 0.55`, which is approximately the
deepest discount ever *measured* in a ruminant (goat, −10 %, 0.57× flat). The
floor then binds at about **−15 % grade**, i.e. the model refuses to extrapolate
a saving beyond the edge of the data rather than inventing one. This is a
defensible policy, not a finding — grade it red and say so in the UI.

### **Implementable curve** (replaces `toblerSpeed`)

Let `s` = signed along-path grade (rise/run), `sinθ = s / √(1+s²)` = vertical
metres per metre of path.

```
e(s)  =  C₀ + k_up · sinθ            s ≥ 0        // 🔵 measured-derived
e(s)  =  C₀ + k_dn · sinθ            s < 0        // 🔵 measured-derived
R(s)  =  max(R_min, e(s) / C₀)                    // dimensionless resistance

C₀ = 2.6      k_up = 26      k_dn = 8      R_min = 0.55   // R_min is 🔴
```

Cost of a step = `R(s) · pathLength · baseResistance`. This is **energy**, not
time, which is the correct currency and a deliberate change from `stepCost`'s
present `dist / speed`.

| grade | angle | **R(s)** proposed | R(s) Tobler today¹ | goat, *measured*² |
|---|---|---|---|---|
| +100 % | 45° | 8.07 | 33.12 | — |
| +58 % | 30° | 6.00 | 7.55 | — |
| +36 % | 20° | 4.42 | 3.57 | — |
| +20 % | 11.3° | 2.96 | 2.01 | — |
| +10 % | 5.7° | **2.00** | 1.42 | **1.92** |
| +5 % | 2.9° | 1.50 | 1.19 | **1.40** |
| 0 | 0° | 1.00 | 1.00 | **1.00** |
| −5 % | −2.9° | 0.85 | 0.84 | **0.70** |
| −10 % | −5.7° | **0.69** | 1.00 | **0.57** |
| −20 % | −11.3° | 0.55 (floor) | 1.42 | — |
| −36 % | −20° | 0.55 (floor) | 2.52 | — |

¹ Normalised to its own flat-ground cost, so the columns are comparable.
² Ratios computed from the five Lachica et al. grade points
(1.91 / 2.33 / 3.35 / 4.68 / 6.44 J·kg⁻¹·m⁻¹ ÷ the level value 3.35).

The proposed curve tracks the measured ruminant ratios to within ~7 % uphill and
is ~20 % *conservative* downhill (it credits less saving than the goat measured,
which is the safe direction). Tobler over-charges a −10 % descent by 75 % and,
past its −5 % peak, gets the direction of the descent effect backwards.

**Dimensionless sanity check for the implementer.** What the cost surface
actually consumes is the ratios `k/C₀`, and both source species agree closely on
the downhill one:

| | `k_up / C₀` | `k_dn / C₀` |
|---|---|---|
| Caribou (~100 kg) | 13.9 | 3.64 |
| Goat (35 kg) | 9.5 | 3.94 |
| **Proposed (70 kg deer)** | **10.0** | **3.08** |

Our `k_dn/C₀` sits slightly below both measurements because it pairs the red deer
`C₀` with a mass-interpolated `k_dn`. Raising `k_dn` to **9.5** would put the
ratio inside the measured bracket, at the cost of the floor binding sooner. Both
choices are within the uncertainty; pick one and record it.

**Validity:** measured between −10 % and +11 % grade (goat and caribou);
defensible by linear extrapolation to roughly ±40 %; beyond that the model is a
guess and the layer should say so. Recommend `terrain-scientist` cap
extrapolation at ±60 % and mark cells beyond it low-confidence rather than
inventing a refusal threshold.

**Species transfer:** derived from Cervidae (caribou) and Bovidae (goat) with
an allometric bridge. It is a *body-mass* model, so it transfers to mule deer
(~70 kg), blacktail (~55 kg) and elk (~250 kg) by re-running the interpolation,
not by reusing 26/8. Elk in particular sit outside the measured mass bracket.

### 🔴 Escape terrain ≥ 10 % slope — **citation retracted, downgraded from 🟢**
The previous register graded this 🟢 Measured, citing "landscape-genomics work
[which] found gene flow occurred over longer distances where escape terrain —
areas of at least 10 % slope — was available."

**That paper is Gowen & de Smet 2020, and it is about humans.** It builds
least-cost paths across a 182-acre nature preserve at Binghamton University and
validates them with a **Fitbit® Surge** worn by a person. There is no ungulate,
no gene flow and no escape terrain in it.
[Testing least cost path models — *PLOS One* 2020](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0239387)

Worse, it is *another human locomotion model* — citing it inside a deer cost
surface compounds exactly the error `N8` exists to fix.

**"Escape terrain" is also the wrong concept for whitetail.** It is a
mountain-sheep term for steep rocky ground used to evade predators, and where it
is quantified it is far steeper than 10 %: desert bighorn ewes and rams
**preferred the steepest slopes available, 40–79 %**, with ~60 % typical.
[Desert bighorn landscape resistance — *PLOS One* 2017](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0176960) ·
[Borderlands Research Institute — Bighorn use of escape cover](https://bri.sulross.edu/big-game/use-of-escape-cover/)
Whitetail escape into **cover**, not onto cliffs. Nothing here transfers.

**Action:** `BACKLOG N9` should be **closed as not-supported**, not implemented.
If we still want moderate slope to facilitate movement, the defensible route is
the anisotropic sidehill effect already in the engine (oblique travel lowers
experienced grade), not a slope-threshold bonus.

### 🔴 `impassableSlopeDeg: 55`
**No literature found, and this is now a settled negative result.** Searched for
cervid slope-refusal thresholds across whitetail, mule deer, elk, red deer and
caribou work; nothing reports a gradient a deer will not cross. Ungulate
locomotion studies stop at treadmill-safe inclines (≤14°), and field studies
report *use* distributions, not refusals.

Retain 55° as a rendering guard, not a biological claim. Do not surface it to
users as "deer will not cross this".

### 🔵 NLCD resistance **ordering** — `NLCD_RESISTANCE`
Upgraded from 🔴 for the ordering only. Regional analysis across the US found
deer occurred at **greater densities in forests and woody wetlands and lower
densities in agricultural and residential development**.
[Hanberry & Hanberry 2021, USFS/*Ecol. Evol.*](https://www.fs.usda.gov/rm/pubs_journals/2021/rmrs_2021_hanberry_b004.pdf)
That supports woody wetlands and forest being cheapest and developed classes
being most expensive. Density is not movement resistance, hence 🔵 not 🟢.

### 🔴 NLCD resistance **magnitudes**
Fifteen hand-picked multipliers (woody wetlands 0.85, row crops 2.8, developed
medium 40, …). Invented. Resistance surfaces are normally optimised against
telemetry or genetics and we have done neither.

A directly relevant precedent exists: a 2025 whitetail study reclassified NLCD
at 30 m into a resistance surface using published permeability values, then
validated the resulting connectivity maps.
[Lilly et al. 2025, *Landscape Ecology*](https://link.springer.com/article/10.1007/s10980-025-02101-4)
*(abstract only — the value table was not readable; obtaining it is the cheapest
possible fix for this row.)*

**Action:** `BACKLOG I4`. Note also that NLCD's 30 m grid misses the sub-canopy
structure — regen thickets, CRP edges, cutover — that matters more to deer than
the NLCD class does.

### 🟢 Snow cost — **measured, and entirely missing from the engine**
Net cost of locomotion **increases exponentially with sinking depth**
([Fancy & White 1987](https://cdnsciencepub.com/doi/10.1139/z87-018)), and the
canonical cervid parameterisation is
[Parker, Robbins & Hanley 1984, *J. Wildl. Manage.* 48:474–488](https://www.scienceopen.com/document?vid=498b669e-584f-4293-b795-4aa7d0c52caf)
for mule deer and elk. Recent work formalises which snow properties actually
gate ungulate movement (depth, density, penetrability).
[Sullender et al. 2023, *Oikos*](https://nsojournals.onlinelibrary.wiley.com/doi/full/10.1111/oik.09925)

**Assessment:** the cost surface has no snow term at all. For a late-season
northern-range user this is the largest missing physical driver in the corridor
model — larger than the Tobler substitution. It also interacts with land cover:
50 cm of fresh snow raised expenditure far more in clearcuts than under canopy.
**Action:** file as a new backlog item.

---

## Bedding

### 🔴 `idealSlopeDeg: 22`, `slopeToleranceDeg: 14` — **settled: no literature exists**
This pass searched specifically and repeatedly for a whitetail bed-site
*gradient*: bed-site microhabitat studies, resource-selection and step-selection
functions with topographic covariates, Appalachian/Ozark/hill-country work,
LiDAR-based bed modelling, and mule deer / blacktail / red deer work that might
transfer. **No study reports a preferred or mean bed-site slope angle for
white-tailed deer.** Recording that definitively so nobody searches it again.

What the bed-site literature actually measures:

- **Cover above the bed.** 140 bed sites vs 100 random: significantly more cover
  immediately above night beds than above random sites.
  [Lang & Gates 1985](https://www.originalwisdom.com/wp-content/uploads/bsk-pdf-manager/2019/04/Lang-and-Gates_1985_Selection-of-Sites-for-Winter-Night-Beds-by-White-tailed-Deer.pdf)
- **Day vs night bed differences and snow depth by aspect** (NE-facing 21.7 cm,
  SE-facing 18.1 cm). Armstrong, Euler & Racey 1983, *J. Wildl. Manage.*
  47:880–884
  ([PDF](https://www.originalwisdom.com/wp-content/uploads/bsk-pdf-manager/2019/04/Armstrong-et-al_1983_Winter-bed-site-selection-by-white-tailed-deer-in-central-Ontario.pdf) —
  server refused retrieval; abstract-level only).
- **Site temperature and canopy closure** were the most influential attributes
  in mule deer bed-site selection across 236 day-beds, 152 forage sites and 439
  random locations. Slope and aspect entered the models but were not the
  drivers.
  [Germaine, Germaine & Boe 2004, *Wildl. Soc. Bull.* 32:554–564](https://www.esf.edu/biology/faculty/documents/Germaineetal2004muledeerdaybedsites.pdf)
- **Slope varies more than it selects.** Red deer resting sites (178 sites,
  7 dGPS collars): females used **steeper** slopes than males, variability in
  slope was higher at night, and **aspect did not vary** by month or between day
  and night.
  [Adrados et al. 2008, *Eur. J. Wildl. Res.* 54:487–494](https://link.springer.com/article/10.1007/s10344-008-0174-y)

Nearest transferable number, and it is 🟡 doctrine not 🟢: **elk are reported to
favour 20–40 % slopes for daily use with preference between 15–30 %, use
declining above 40 % and few above 60 %** — that is **8.5–22°**, centred well
*below* our 22°.
[American Hunter summary of Idaho/Montana work](https://www.americanhunter.org/content/the-right-elk-stuff/)
The primary sources (Thomas 1979 Ag. Handbook 553; Rumble et al. Black Hills
RSF) were not retrievable, so this is secondary reporting of a primary result —
doctrine grade until someone reads them.

> ### The internal contradiction nobody has flagged
> `beddingLikelihood` peaks the slope term at **22°** on the bed cell itself.
> `detectBenches` defines a bench as a cell **≤ 8°** surrounded by ground
> **≥ 18°**. Both are described in the code as "where bucks bed", and the
> engine's own doctrine block for `beddingLikelihood` says the buck is on
> "the leeward side of a ridge, point, or **bench**".
>
> **They cannot both be right.** A deer lies down; a 22° lie is a steep place to
> spend eight hours, and every doctrine source describes the bed itself as a
> flat or gently sloping shelf, point or hub *embedded in* steep ground. The
> physical requirement (a level pad) and the security requirement (steep,
> broken surrounds) apply to **different cells**.
>
> **Recommended reformulation** — and this is the highest-value change in the
> bedding model, larger than tuning 22°:
> ```
> slopeTerm = gauss(slope, ideal = 8°,  tol = 8°)      // the pad itself
>           × sigmoid(ringSlope, min = 15°)             // steep surrounds
> ```
> i.e. reuse the bench geometry `detectBenches` already computes instead of a
> single-cell Gaussian. The numbers stay 🔴 Assumed — but the *shape* stops
> contradicting both our own bench detector and every field description.
> If instead we keep the single-cell Gaussian, honesty demands centring it
> nearer **10–12°** (the elk band, the only transferable evidence) rather than
> 22°, with tolerance ≥ 12°.
>
> **Action:** `BACKLOG N10` (surface the 🔴 chip) plus a new item for the
> reformulation. Longer term this is what collar data settles (`I3`).

### 🟡 Bench geometry — `maxBenchSlopeDeg: 8`, `minSurroundSlopeDeg: 18`
Not previously in the register. Ordering and concept are strong, consistent
doctrine — hill-country deer bed on benches, points and shelves with cover
uphill and a view downhill. The two thresholds are ours. No measurement located.
Note the same regional caveat as everything else here: this is Appalachian /
Ozark / Driftless doctrine and means little in the Texas brush or on flat
agricultural ground.

### 🟢 Wind shelter as a bed-site criterion
Deer select night-bed sites with **decreased wind velocity**, and conifer stands
buffer convective heat loss.
[Lang & Gates 1985](https://www.originalwisdom.com/wp-content/uploads/bsk-pdf-manager/2019/04/Lang-and-Gates_1985_Selection-of-Sites-for-Winter-Night-Beds-by-White-tailed-Deer.pdf)
**Scope: winter, hemlock–northern hardwood, thermal motivation.** It supports
"deer bed out of the wind"; it does not support "deer bed leeward for scent".

### 🟡 Leeward *aspect geometry* — `cos(aspect − windFrom)`
The specific "bed on the leeward face to watch downwind and smell upwind"
geometry, and its scent-advantage rationale, are field doctrine — consistently
reported and internally coherent, with no measurement behind them.
[Whitetail Properties](https://www.whitetailproperties.com/knowledge-center/terrain-specific-deer-hunting-tactics-from-ridges-to-swamps) ·
[Whitetail Partners](https://www.whitetailpartners.com/post/mastering-topographic-maps-will-make-you-a-better-deer-hunter)

Corroborating direction from peer review: red deer daytime habitat selection
favours **denser cover, greater distance from trails and steeper slopes** —
i.e. daytime resting is a security decision, which is the same premise.
[Contrasting daytime habitat selection in wild red deer](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12355003/)

### 🔴 Terrain shelter: 30° upwind horizon = full shelter
TOPEX-style shelter indices are established in forestry wind-exposure work; the
30° saturation point is ours. **No literature found.**

### 🔴 Cover term: `ruggedness / 4 m`
"4 m of local relief in a 3×3 window is plenty of broken ground." Invented.
**No literature found**, and note that TRI is a *terrain* proxy standing in for
*vegetative* concealment, which is what the bed-site literature actually
measures (cover above the bed, canopy closure, concealment). The proxy is the
weaker claim, not the constant.

### 🟢 Winter thermal cover — **re-verified, and it holds**
The previous pass's reading was checked against the abstract and is accurate,
close to verbatim:

- dense conifer cover functions **as snow shelter rather than thermal cover**,
  and snow depth affects survival more than ambient temperature;
- use of dense conifer rose most sharply with increasing snow depth, on the
  sites where it was most available — an energy-conservation strategy;
- **at all four sites deer made greater daytime use (55 to > 80 % probability)
  of open vegetation types at the lowest daily minimum temperatures**, i.e. they
  moved into the open for solar radiation when it got coldest.

[PLOS One 2013](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0065368) ·
[correction, PLOS One 2017](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0178964)
(cite the correction alongside).

**Scope tightened.** 12-year study, **Minnesota**, female deer, VHF + GPS,
deep-snow northern forest range. It supports the date-aware insolation layer
**as a late-season predictor in snow country**. It does **not** license the same
claim in the Appalachians below the persistent snow line, or anywhere in the
South. It still stands as a warning against a naive "thermal cover = dense
conifer" layer, which we have not built and should not.

---

## Thermals and scent

### 🟢 Slope flows exist and invert diurnally — *the physics*
Katabatic (downslope) flows **develop rapidly soon after sunset** as the surface
cools, are strongly unidirectional, last on the order of hours, are most
pronounced on clear nights with light synoptic wind, run 10–30 km·h⁻¹ in a layer
10–100 m deep, and pool as a cold pool in valley bottoms. Anabatic (upslope)
flows initiate after sunrise and **gradually erode that cold pool**.
[Royal Meteorological Society](https://www.rmets.org/metmatters/anabatic-and-katabatic-flow-metmatters-guide-mountain-winds) ·
[UBC ATSC 113 — diurnal slope flows](https://www.eoas.ubc.ca/courses/atsc113/snow/met_concepts/06-met_concepts/06b-diurnal-slope-flows/)

Upgraded from 🟡: this is measured boundary-layer meteorology, not folklore.

### 🟡 Deer *use* thermals to manage scent
Universal in the hunting literature; no cervid study measuring the behavioural
response to slope flows was located. The physics being 🟢 does not make the
behavioural claim 🟢.

### 🟡 Thermal hubs
Low points collecting thermals from several directions, where deer gather
information before committing.
[NA Deer Hunter](https://nadeerhunter.com/how-to-hunt-mountain-bucks/)
Doctrine. Not currently a distinct layer. Note the meteorology *does* support
the underlying convergence — cold-air pooling in concave terrain is exactly the
cold pool above — so this is doctrine resting on real physics.

### 🔴 Transition window: symmetric ±45 min — **the symmetry is wrong**
The slope-flow literature describes an **asymmetric** transition:

| Transition | Reported behaviour | Implication |
|---|---|---|
| Evening | katabatic "develops rapidly soon after sunset" | short window, ~±20–30 min |
| Morning | anabatic must "gradually erode the cold pool" | long window, ~+60–120 min after sunrise |

And it is **elevation-dependent**: ridges flip to rising while the valley bottom
is still draining. A single global phase for the whole DEM is wrong on exactly
the terrain the app is for.

🔵 evidence exists for the asymmetry and the elevation dependence; the specific
minute counts remain 🔴. **Recommended interim:** `transitionMinutes` becomes
`{ morning: 90, evening: 30 }`, both still 🔴, and file the cold-pool
persistence model separately. *(abstract/secondary sources only.)*

### 🔴 Thermal strength saturates at 30° slope — **and the direction may be inverted**
`min(1, slope / 30)` makes thermal strength rise monotonically with slope. That
is not what the slope-flow literature says. In the classical Prandtl analytical
solution the slope angle affects only the **height** of the katabatic wind
maximum, not its **speed**; large-eddy simulation finds both the maximum speed
and its height **decrease with increasing slope angle**.
[Grisogono & Axelsen 2012, *Boundary-Layer Meteorol.* 145:527](https://link.springer.com/article/10.1007/s10546-012-9746-1)

**Caveat, stated rather than hidden:** those results are for *pure* katabatic
flow over **gentle slopes (3–6°)** and do not straightforwardly extrapolate to a
20° Appalachian sidewall. The honest position is that our monotonic term has no
support and at least one line of evidence points the other way. Do not "fix" it
by inverting it — measure or leave it, and grade the layer 🔴.

### 🔴 Scent cone: 400 m at 25° half-angle
No source for either number, and none found. Everything returned for deer
scent-detection distance ("a mile in the right conditions", "quarter mile in a
steady breeze", "cone 10–15° wider per 100 yards") traces to hunting media or
AI-generated content with no measurement behind it. **No cervid
olfactory-detection-distance measurement located. This stays 🔴.**

What *is* real is the atmospheric side. Lateral plume spread σ_y as a function
of downwind distance and **Pasquill–Gifford stability class** is tabulated in
regulatory dispersion guidance
([EPA ISC3 User's Guide](https://gaftp.epa.gov/aqmg/SCRAM/models/other/isc3/isc3v2.pdf) ·
[NRC Regulatory Guide 1.145](https://www.nrc.gov/docs/ML1204/ML12045A197.pdf)),
and outdoor plume statistics are an active measurement field
([odour source distance from plume statistics](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11288670/)).

**The implementable finding — and it says the current code is backwards.**
Plume half-angle ≈ `atan(2·σ_y(x) / x)`, and σ_y grows with instability:
widest under a sunny, light-wind unstable boundary layer; **narrowest at night
under the stable, stratified conditions that produce sinking thermals**. Today
`waypoints.module.ts` uses **400 m at 25°** for the synoptic cone and **250 m at
30°** for the thermal cone — a *wider* cone for the thermal case, which for
evening/night sinking thermals is the stable case and should be the **narrowest**
of the three.

Recommended shape (numbers to be read off the EPA table, not from me):

```
halfAngle(phase) :  Sinking (stable, class E–F)   →  narrowest
                    Transition (neutral, class D) →  intermediate
                    Rising (unstable, class A–C)  →  widest, ≈ today's 25°
```

Everything except the ordering stays 🔴 until someone reads the σ_y tables. The
400 m length should be documented as *"where we stop drawing"*, never as a
detection threshold.
**Action:** `BACKLOG N11`.

### 🔴 Deer scent-detection distance
Not a code parameter today, but implied by the cone. **No literature found.**
Recorded so the next person does not go looking.

---

## Rut timing

### 🟢 Breeding is photoperiod-driven; northern peak is early-to-mid November
Whitetail breeding is controlled by **decreasing photoperiod**. Fetal-aging work
across the Midwestern USA put the **mean estimated conception date at 10
November**, with adults at **8 November**, yearlings **11 November** and fawns
**2 December** — "typical of the Midwest".
[Reproductive characteristics of female white-tailed deer, *Theriogenology* 2017](https://www.sciencedirect.com/science/article/pii/S0093691X1730078X) ·
[INHS PDF](https://wwv.inhs.illinois.edu/files/9714/9012/4498/Reproductive_characteristics_of_female_white-tailed_deer_Odocoileus_virginianus_in_the_Midwestern_USA..pdf)

**This replaces the Mossy Oak citation the previous register used for a 🟢 row.**
Hunting media can support 🟡, never 🟢, and that row was mis-graded on its
source even though its conclusion was right.

### 🔴 `peakBreedingDayOfYear` returns **319** at ≥ 40°N — off by ~5 days
DOY 319 is 15 November. The best measured value at that latitude is **8–10
November = DOY 312–314**. Recommend **`314`**, uncertainty ±4 days, scope
"Midwest / northern range". Illinois sits at ~40°N, which is exactly the branch
boundary, so this is a like-for-like correction.

### 🔴 Latitude interpolation below 40°N — **downgraded from 🔵; the functional form is wrong**
Current: `319 + (40 − lat)·1.2` down to 34°N, then `326 + (34 − lat)·3.5`.
The previous register graded this 🔵 on the grounds that "southern herds breed
later" is widely reported and only the coefficients were ours. **The direction
is right; latitude is not the predictor.** At comparable latitudes:

| Region | ~Lat | Measured peak / mean conception | Our model |
|---|---|---|---|
| Midwest | 40°N | **8–10 Nov** | 15 Nov (DOY 319) |
| Mississippi, statewide | 33°N | **mean 1 January**, SD 13.4 d, mean range 46 d | 26 Nov (DOY 330) |
| Alabama | 32°N | peak for most populations in **January**; conception dates vary **≥ 60 days between populations within a single county** | 29 Nov (DOY 333) |
| Texas — Edwards Plateau | 30°N | **7 Nov** (east), **24 Nov** (central), **5 Dec** (west) | 6 Dec (DOY 340) |
| Texas — Gulf Prairies | 28°N | peaks **30 Sep** (north) and **31 Oct** (south) | 13 Dec (DOY 347) |

[MDWFP deer breeding date map](https://www.mdwfp.com/wildlife-hunting/wildlife-species-program/deer-program/deer-breeding-date-map) ·
[Turner et al. 2019, *Wildl. Soc. Bull.* — Alabama breeding chronology](https://wildlife.onlinelibrary.wiley.com/doi/abs/10.1002/wsb.1031) ·
[TPWD — the rut in white-tailed deer](https://tpwd.texas.gov/huntwild/hunt/planning/rut_whitetailed_deer/)

Two populations at nearly the **same latitude** (Texas Gulf Prairies, 30 Sep;
Mississippi, 1 Jan) breed **three months apart**. Our model is **36 days early
in Mississippi and 74 days late on the north Texas coast** — and it cannot be
both, at any coefficient, because it is monotone in latitude. A monotone function
of latitude cannot represent this — southern rut timing is driven by herd
genetics, restocking history and local conditions, not day length, because the
photoperiod signal itself weakens toward the equator.

**Recommendation:** north of ~38°N keep the photoperiod model (DOY 314 ± 4).
South of it, **stop predicting from latitude**. Ship a region lookup seeded from
state agency breeding-date data (Mississippi and Texas both publish it), and
make `offsetDays` calibration the primary mechanism rather than a refinement.
Absent a region match, return the phase as *unknown* rather than a wrong date —
that is the "say when you do not know" rule in `CLAUDE.md`.

### 🔴 `rutConfidence` thresholds — too generous by a wide margin
Returns **0.65 for 32–38°N**. Mississippi and Alabama are 32–33°N and the model
is a month or more wrong there. 0.65 is not a defensible confidence for a
one-month error. Recommend, until a region lookup exists:

| Latitude | Now | Recommended | Why |
|---|---|---|---|
| ≥ 38°N | 0.90 | 0.90 | supported by fetal-aging data |
| 36–38°N | 0.65 | 0.55 | edge of the tight photoperiod window |
| < 36°N | 0.65 / 0.40 / 0.20 | **0.15**, or refuse to return a date | latitude is not predictive here |

36°N, not 38°N, is the boundary the literature uses: north of ~36° most deer
breed mid-October to mid-December with a November peak; between 28–36° breeding
spans late September to late March and peaks in November, December *or* January
depending on the area. The cutpoints themselves remain 🔴 — they are a policy
choice about how loud to be when we do not know.

### 🟢 Moon phase does not drive the rut — *modelled by exclusion*
48 GPS-collared bucks in Mississippi, two years, 15-minute fixes: bucks averaged
~265 yards·h⁻¹ in daylight and **moon phase and moon position had no
statistically meaningful effect**; bucks respond to rut timing, time of day,
weather and hunting pressure.
[MSU Extension — Lunar legends](https://extension.msstate.edu/publications/lunar-legends-does-the-moon-influence-buck-activity) ·
[MDWFP — Moon myths vs deer reality](https://www.mdwfp.com/wildlife-hunting/private-lands-program/habitat-and-wildlife-information/moon-myths-vs-deer-reality-what-science-says)

**Citation replaced.** The previous register supported this 🟢 row with a Mossy
Oak blog post. The conclusion survives; the sourcing did not.

**Decision recorded, and it is not up for reconsideration:** breeding is
photoperiod-driven, moon phase is not a rut predictor, and a lunar rut feature
would degrade every downstream analytic. If the founder asks again, the answer
is still no. Moon phase is stored as an observation covariate so users can test
it against their own data, and is never used as a predictor.

### 🔵 Moon phase and *movement* — small, real, not worth predicting from
Distinct from the rut question and previously conflated with it. 38 GPS-collared
bucks, 30-minute fixes, Aug–Dec 2010–2012: solunar timing **did** shift activity
odds, and the shift **reversed sign with lunar phase** — near full/new moons
bucks were more likely to be active at moonrise/moonset and less likely at
overhead/underfoot; far from full/new the pattern flipped. The authors note the
hours around sunset remained when deer were most likely to be active.
[Sullivan & Ditchkoff 2016, *J. SE Assoc. Fish Wildl. Agencies*](https://seafwa.org/journal/2016/movement-moon-white-tailed-deer-activity-and-solunar-events)

**Assessment:** a phase-dependent sign reversal on top of a dominant crepuscular
signal is not a usable predictor — it is the shape of a result that will not
replicate, and the larger Mississippi study found no effect. Correct call to
record and not predict. 🔵 because "detectable but negligible" is our inference
from two studies that disagree in strength.

### 🟡 Peak breeding is often the *worst* week to sit (lockdown)
Strong, consistent doctrine, surfaced in `PHASE_NOTES` because hunters routinely
read "peak rut" as "best hunting". No measurement located.

### 🔴 Phase window day counts (seeking −21…−10 d, chasing −10…−2 d, …)
Our own partition of a continuous process. Ordering is doctrine; the day counts
are invented. **No literature found** giving durations for seeking, chasing or
lockdown. Note the one biological anchor that plausibly exists: the doe oestrous
cycle recurs at roughly 28 days, which is what makes a second rut a real
phenomenon and is presumably where the `SecondRut` window (+24 to +38 d) came
from. That is standard whitetail reproductive biology and was **not re-verified
in this pass**; if the build agent wants to lean on it, source it first.

---

## Weather covariates

### 🟡 Barometric pressure — *trend*, not absolute
Peer-reviewed GPS work finds pressure effects that are real but small,
inconsistent, and season/hour-specific: pressure affected female movements in
spring at 01:00 and summer at 02:00, and male movements in winter at 13:00.
[Webb et al. 2010, *Int. J. Ecology*](https://onlinelibrary.wiley.com/doi/10.1155/2010/459610)
A southeastern GPS study likewise found weather condition, temperature, wind
speed, barometric pressure, moon phase, moon position and nocturnal brightness
each affected activity **in some seasons and times of day**.
[Goethlich, Auburn thesis](https://etd.auburn.edu/bitstream/handle/10415/7077/Goethlich_Thesis.pdf?sequence=2&isAllowed=y)

Modelling the trend rather than the absolute remains the right call. Grade
stays 🟡: the effect is measured but so scattered across seasons and hours that
"falling pressure moves deer" as a general rule is not what the data shows.
The hunting-media band (29.90–30.30 inHg) remains 🟡 doctrine.

### 🟢 Temperature is the dominant weather covariate — **and we do not model it**
In the same GPS analysis, **temperature accounted for ~55 % of the differences
in movement**, ahead of relative humidity and precipitation, and influenced
movement more than any other weather variable.
[Webb et al. 2010](https://onlinelibrary.wiley.com/doi/10.1155/2010/459610)

**Assessment:** we surface pressure trend, which is weak, and not temperature,
which is strong. That is the wrong emphasis. **Action:** file a backlog item to
add temperature (and temperature *departure from seasonal normal*, which is what
the doctrine actually claims) as a first-class covariate.

### 🔴 Pressure-trend band cutpoints (±1, ±3 hPa)
Invented. **No literature found** tying deer activity to specific
pressure-tendency magnitudes; the studies above test pressure as a continuous
covariate, not in bands. Keep, but they must not carry a confidence chip above
🔴.

---

## Scale and scope

### 🟢 Home range and core area
GPS-collar studies give real numbers, and they vary enormously:

- Louisiana, 14 adult bucks: fall home range **245–2,852 acres**; annual home
  range and core area averaged **484 ha and 90 ha**.
  [LDWF technical report](https://www.wlf.louisiana.gov/assets/Resources/Publications/Deer/space-use_and_movements_of_adult_male_white-tailed_deer_in_northeastern_louisiana.pdf)
- MSU Deer Lab, 60 bucks: 27 % under 500 acres, 25 % over 2,000 acres.
  [MSU](https://www.msstate.edu/newsroom/article/2021/10/msu-deer-study-finds-some-are-travelers-others-homebodies)

**Consequence we are not acting on:** a ~90 ha core area sets the scale at which
corridor analysis is meaningful. Our 200,000 ha property ceiling is three orders
of magnitude above any biologically relevant unit.

### 🟢 Roughly a third of bucks are mobile, not resident — *now properly cited*
Central Mississippi, 30 adult bucks, GPS 2017–2021: **67 % sedentary (mean home
range 361 ha)** and **33 % mobile (mean 6,530 ha)** — an eighteen-fold
difference in strategy within one population. Mobile bucks' home ranges were
separated by a mean of **7.1 km**, with a mean **78 days** in one segment before
shifting. Sedentary bucks made **5.9 excursions per year**, mobile bucks **0.8**,
peaking in the breeding season and early spring.
[Rutting and rambling — *Ecology and Evolution* 2024](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10862164/)

The previous register carried these numbers with no citation. This is the
primary source.

**Assessment:** a third of the population will not be described by any
property-scoped model, and the app currently implies every deer is resident.
**Action:** `BACKLOG N12`.

### 🟡 Mature buck = ≥ 3.5 years
Management convention, used in the analytics filter. Widely adopted; the
threshold is conventional, not derived.

### 🟡 Species scope — *resolved into a transfer table (was 🔴)*
The product claims "deer or other large game". Every behavioural parameter is
whitetail- or doctrine-derived. Per-parameter transfer, stated rather than
silent:

| Parameter | Mule deer | Blacktail | Elk | Basis |
|---|---|---|---|---|
| Energetics curve (`C₀`, `k_up`, `k_dn`) | ✅ re-run allometry at ~70 kg | ✅ at ~55 kg | ⚠️ ~250 kg is outside the 35–100 kg measured bracket | body-mass model, not species model |
| Anisotropic / oblique travel | ✅ | ✅ | ✅ | measured across six mountain-ungulate species |
| Slope flows & thermal phase | ✅ | ✅ | ✅ | meteorology, not biology |
| Bedding slope & bench geometry | ❌ | ❌ | ❌ | unmeasured for *any* species; elk band differs from our value |
| Leeward bedding geometry | ⚠️ | ⚠️ | ❌ | whitetail hill-country doctrine; elk bedding doctrine differs (north slopes, wallows, timber edges) |
| Winter conifer / insolation finding | ❌ | ❌ | ❌ | Minnesota whitetail, deep snow, female |
| Rut timing model | ❌ | ❌ | ❌ | **elk rut peaks mid-to-late September; mule deer mid-November to December.** DOY 314 is simply wrong for elk |
| Home range / core-area scale | ❌ | ❌ | ❌ | elk range is an order of magnitude larger |
| NLCD resistance table | ❌ | ❌ | ❌ | tuned on eastern-deciduous assumptions |

**Measured species difference we should honour:** where mule deer and whitetail
are sympatric in NE Washington, **white-tailed deer were more likely to occupy
shallower slopes and lower elevations** than mule deer.
[Staudenmaier et al. 2021, *Ecosphere*](https://esajournals.onlinelibrary.wiley.com/doi/10.1002/ecs2.3813)
So a shared bedding-slope constant is measurably wrong for at least one pair of
species we claim to serve.

**Recommendation:** narrow the product claim to **white-tailed deer**, and treat
the three green rows in the table above (energetics, anisotropy, slope flows) as
the only cross-species layers. Per-species modelling is a real roadmap item, not
a copy edit. **Action:** `BACKLOG N13`.

### 🔴 Regional scope is unlabelled everywhere
Not a parameter, but it belongs in the register. Almost every source above is
regional: Minnesota (conifer), central Ontario and Michigan (bed sites),
Illinois (conception dates), Mississippi (home range, moon), Louisiana (space
use), NE Washington (species sympatry), Arizona (mule deer beds), French
Cévennes and the Alps (red deer, oblique travel). **Not one parameter in the
engine is validated in the Appalachians**, which is where the app's default view
sits. Nothing is labelled with its region in code or UI.

---

## Geomorphometry (not biology, recorded for completeness)

These are 🟢 **Measured** in the sense that they are published, peer-reviewed
algorithms implemented to specification, and `terrain-scientist` validates them
against closed-form surfaces: Horn (1981) slope/aspect, Evans–Young quadratic
curvature, Weiss (2001) multi-scale TPI, Wood (1996) morphometric features,
Riley (1999) TRI, Zakšek/Oštir sky-view factor. They are not counted in the
grade tally above.

Their *biological interpretation* — that a Wood `Pass` is a deer crossing, that
a Weiss class 2 is a travel corridor — is 🟡 **Doctrine**, and that distinction
is the whole point of this register.

---

## Priority actions

| # | Action | Grade change | Backlog |
|---|--------|--------------|---------|
| 1 | Replace `toblerSpeed` with the cervid energetics curve above (`C₀ 2.6`, `k_up 26`, `k_dn 8`, floor 0.55), switching the currency from time to energy | 🔴 → 🔵/🟢 | `N8` |
| 2 | **Close `N9` as not-supported.** The escape-terrain citation is a human Fitbit study and the concept is mountain-sheep-specific | 🟢 → 🔴 | `N9` |
| 3 | Fix the rut model south of 38°N: DOY 319 → 314 in the north, region lookup or *unknown* in the south, `rutConfidence` < 36°N down to ~0.15 | 🔵 → 🔴 + 🟢 fix | new |
| 4 | Resolve the bedding contradiction: bench geometry (gentle pad, steep ring) instead of a 22° single-cell Gaussian | 🔴 → 🔴 (honest shape) | new |
| 5 | Surface `Confidence` chips on bedding, thermal, scent and rut outputs — four of the five headline layers are 🔴-driven | — | `N10` |
| 6 | Make the scent cone stability-dependent, and fix the inversion (the night/thermal cone is currently the *widest*) | 🔴 → 🔵 | `N11` |
| 7 | Add a snow term to the cost surface (Parker 1984; Sullender 2023) — the largest missing physical driver | none → 🟢 | new |
| 8 | Add temperature as a first-class covariate; it explains ~55 % of movement variation and we show pressure instead | none → 🟢 | new |
| 9 | Narrow the product claim to white-tailed deer, or scope per species per the transfer table | 🔴 → 🟡 | `N13` |
| 10 | Handle the ~⅓ of bucks that are mobile rather than resident | — | `N12` |
| 11 | Obtain NLCD resistance values from Lilly et al. 2025 rather than inventing them | 🔴 → 🔵 | `I4` |
| 12 | Label every layer with the region its evidence comes from; nothing is validated in the Appalachians | — | new |
| 13 | Obtain GPS-collar data to settle bedding geometry, corridor use and shelter | 🔴 → 🟢 | `I3` |

Item 13 would resolve more red rows than everything else combined. Items 2 and 3
are corrections to things we currently state confidently and wrongly, and should
go first.
