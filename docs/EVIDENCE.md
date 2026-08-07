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

**Current state: 12 Measured · 6 Inferred · 9 Doctrine · 17 Assumed.**
*(Pass 2: 10 · 5 · 8 · 18. Net: two rows left red, one row entered it.)*

Pass 2 wrote one row per number and retracted two citations. Pass 3 reopened
every row pass 2 had closed as a settled negative and worked them with search
rather than with memory. Four rows moved up, one negative result was overturned
outright, and the rows that stayed 🔴 now carry the query list that justifies
them.

> **Reading conditions.**
>
> - `WebFetch` is **blocked at the egress gateway for every host**, verified
>   against PubMed, PLOS, Springer, Wiley, `fs.usda.gov`, `a100.gov.bc.ca` and
>   Wikipedia. A 403 from it says nothing about the source. Do not spend a pass
>   fighting it.
> - `WebSearch` **works and is the instrument that matters.** It returns
>   substantive abstract- and body-level content, not just links, including from
>   open agency PDFs it has indexed.
> - **No full text was read in any pass so far.** Rows that would change
>   behaviour are marked *(abstract/index only — verify against full text before
>   implementing)*.
>
> **Correction to pass 2, recorded because it cost a parameter.** Pass 2 closed
> `idealSlopeDeg` with the words *"no literature exists … recording that
> definitively so nobody searches it again."* That was wrong — not in its
> narrow claim, which survives, but in telling the next pass to stop. Two
> further queries surfaced an explicit agency slope band and a peer-reviewed
> measurement of the functional form. **A negative result that closes a
> question must ship the query list that earned it.** Every 🔴 row below now
> does.

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

### 🔴 `impassableSlopeDeg: 55` — **re-attacked; stays 🔴, and now for a stated reason**
Re-searched with agency and habitat-model documents explicitly in scope. Still
**no source reports a gradient a cervid will not cross.** What pass 3 adds is
*why* that is not an accident:

- The cervid slope literature is **continuous and monotone, not thresholded.**
  Rowland et al. 2018 report a per-percent decline in use (−5.3 % per percent of
  slope) with no breakpoint; reindeer step-selection work carries slope and
  slope² as continuous terms rather than a cutoff. Nobody fits a refusal because
  nobody observes one.
- Where secondary reporting does give a ceiling it is a **use** ceiling, well
  below 55°: elk use "declining above 40 % and few above 60 %" — 60 % is 31°.
- The only hard slope preferences in ungulate work run the *other* way: desert
  bighorn preferred the steepest ground available, 40–79 %.

So 55° is not merely unsupported, it is **~24° above the steepest ground any
cervid source describes as heavily used**, which means in practice it almost
never binds and is not doing biological work anyway.

**Retain as a rendering/numerical guard, not a biological claim.** Do not
surface it to users as "deer will not cross this", and do not draw a hard
boundary on the map at it. If a steepness effect is wanted, it belongs in the
continuous cost curve, which is where the measured evidence lives.

**Queries:** `deer elk slope threshold avoid steep terrain "greater than 60
percent" habitat effectiveness model impassable` · `ungulate step selection
function maximum slope crossed refusal threshold degrees` · `wildlife habitat
model slope thresholds` · plus the cervid-energetics queries from pass 2.

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

### 🟡 `idealSlopeDeg: 22` — **reopened, and the value is wrong at the top end** *(was 🔴 "settled")*

**What changed.** The narrow claim from pass 2 survives twenty-plus queries:
*no peer-reviewed study reports a preferred or mean bed-site slope angle for
white-tailed deer.* But pass 2 concluded from that that nothing constrains the
number. **Two source classes do**, and both put 22° at or above the top of the
plausible band rather than at its centre.

**1. An explicit agency slope band exists.** The British Columbia Wildlife
Habitat Ratings species account for *Odocoileus virginianus* defines whitetail
winter range as areas of **10–45 % slope, with a south and/or west aspect**,
below 1500 m in shallow-to-moderate snowpack zones or below 1000 m in deep
snowpack zones.
[BC WHR — White-tailed Deer, *Odocoileus virginianus*](https://a100.gov.bc.ca/pub/acat/documents/r1535/whr_4162_modvi_1096575452158_68741ea2adba46dcb522d7a9f909273a.pdf) ·
[second BC WHR account, same species](https://a100.gov.bc.ca/pub/acat/documents/r1583/whr_4069_modvi_1117056211990_ad101d33f76a47c38b67f114e5fbb078.pdf)

**10–45 % is 5.7°–24.2°.** Band centre ≈ **15°**. Our 22° sits in the top
quartile of the agency band, not at its middle.

Graded 🟡 and not higher, deliberately: WHR ratings are an expert rating
standard, the snippet indexing indicates the criteria derive from US Forest
Service guidelines rather than from BC telemetry, and — importantly — this is a
**winter-range polygon criterion for a whole range unit**, not a measurement of
the cell a deer lies down on. It is also the BC southern interior, which is
mule-deer-adjacent Douglas-fir country, not Appalachian hardwoods. It is
nonetheless the only numeric slope band any agency publishes for this species,
and it is reproducible across two independent WHR documents.

**2. The functional form is measured, and it is not a peak.** In the largest
modelling effort of its kind, elk summer habitat use **declined monotonically
with slope**: the standardised coefficient for slope was **−0.949**, the
strongest of any predictor in the model — ahead of dietary digestible energy
(0.656), distance to edge (−0.305) and distance to open road (0.300) — and use
fell **5.3 % for each one-percent increase in slope**.
[Rowland et al. 2018, *Wildlife Monographs* 199:1–69](https://wildlife.onlinelibrary.wiley.com/doi/10.1002/wmon.1033) ·
[USFS PNW project page](https://research.fs.usda.gov/pnw/projects/westsideelknutritionandhabitatuse) ·
[Arc-Habcap expert evaluation, PNW-RP-479](https://www.srs.fs.usda.gov/pubs/rp/rp_pnw479.pdf)

That is *elk*, in *western Oregon and Washington*, describing *summer habitat
use* rather than bedding — every one of those is a transfer this register is
supposed to state rather than smuggle. What it establishes is not a value for
whitetail bedding but a **shape**: the best-measured cervid slope response is
monotone-declining with no interior optimum. A Gaussian that *peaks* at 22° and
falls away below it — telling the user a 10° shelf is worse bedding than a 22°
sidehill — is the one shape the measured evidence actively contradicts.

**3. The doctrine is unambiguous and it describes a flat pad**, which pass 2
inferred but did not evidence. Multiple independent field sources describe the
bed itself as level ground *within* steep country: benches are "flat or gently
sloping areas", deer "prefer to bed almost exclusively on flat portions within
the changing topography", and "a flat spot on a steep hillside" is the classic
hill-country bed.
[Whitetail Habitat Solutions](https://www.whitetailhabitatsolutions.com/blog/where-does-a-buck-bed-top-10-spots) ·
[Whitetail Properties — terrain-specific tactics](https://www.whitetailproperties.com/knowledge-center/terrain-specific-deer-hunting-tactics-from-ridges-to-swamps) ·
[HuntStand — finding deer with topo maps](https://www.huntstand.com/fieldnotes/deer/how-to-find-deer-with-topo-maps/)
🟡 Doctrine, as it must be. But it is *consistent* doctrine and it agrees with
the direction of both (1) and (2).

**Recommended replacement, and the uncertainty on it.**

| | Now | Recommended | Basis |
|---|---|---|---|
| `idealSlopeDeg` | 22 | **12** | centre of BC WHR band (15°) pulled down toward the flat-pad doctrine and the monotone elk response |
| `slopeToleranceDeg` | 14 | **10** | ±1σ then spans ~2–22°, covering the BC band's lower ¾ |

This is a **re-centring, not a discovery**. Both numbers stay 🟡 at best — the
band is agency, the shape is cross-species, the pad is doctrine. Do not let the
UI imply otherwise. If the bench reformulation below is implemented instead,
these two constants disappear and this row closes.

**Queries run in this pass, so the next one does not repeat them.** `white-tailed
deer bed-site selection slope degrees percent aspect` · `Armstrong Euler Racey
1983 winter bed-site selection central Ontario slope` · `Ontario Forest
Management Guidelines Provision White-tailed Deer Habitat slope aspect
prescription` · `British Columbia WHR species account Odocoileus virginianus
slope aspect winter range` · `Nova Scotia Special Management Practices
White-tailed Deer wintering area slope` · `"10 to 45% slope" south west aspect
British Columbia` · `white-tailed deer habitat suitability model slope class
percent ratings security cover` · `BC wildlife habitat ratings winter range
slope percent aspect below 1500 m snowpack zones` · `wildlife habitat rating
species code M-ODVI` · `mule deer winter range slope percent "less than 30
percent"` · `Mysterud 1996 bed-site selection roe deer southern Norway summer
slope steepness` · `deer bed site "mean slope" degrees random sites comparison
telemetry` · `white-tailed deer resource selection function slope covariate
degrees Appalachian bedding daytime` · `Lang Gates 1985 winter night beds slope
percent measured variables` · `Uresk characteristics fawn beds Black Hills slope
percent aspect` · `Hyde bed sites fawns south Texas slope topography` · `Maine
deer wintering area habitat management slope aspect criteria` · `GPS collar
bucks diurnal bedding steeper slopes hunting pressure refuge` · `Odocoileus
virginianus topographic position index bench terrace bedding LiDAR validation` ·
`deer elk slope threshold avoid steep terrain habitat effectiveness model` ·
`white-tailed deer bedding flat benches level ground agency habitat guide` ·
`Rowland 2018 elk nutrition habitat use slope coefficient`.

**Leads found but unread** — titles located, full text unreachable. Not a grade,
and not a basis for any upgrade:
- Armstrong, Euler & Racey 1983, *J. Wildl. Manage.* 47:880–884 — day vs night
  winter beds, 45°13'N 78°22'W. Indexes for snow depth by aspect; whether it
  reports a slope angle is unknown.
- Mysterud 1996, *Wildl. Biol.* 2:193–198 — roe deer summer beds, Lier valley,
  Norway. Search returns canopy cover and herb availability as the results;
  **slope does not appear among them**, so this transfer candidate looks empty
  even before the species question.
- Uresk et al. 1999, *Great Basin Nat.* 59:348–352 — 259 fawn beds vs 301 random,
  Black Hills. 8 of 31 habitat variables significant; the 8 that index are all
  vegetation-structural (basal area, veg cover, veg height, canopy < 34 %).
  **No slope variable surfaces**, which is itself weak evidence that slope was
  not among the significant eight.
- Nova Scotia *Special Management Practices for White-tailed Deer* and the
  Ontario stand-and-site forest management guide — both open PDFs, both index
  for aspect and softwood cover, **neither surfaced a slope threshold**.
- Maine IFW is explicit that the gap is real: limited use of *steep* south-slope
  wintering areas occurs, but "their distributions and the conditions under
  which they are occupied are **poorly documented**."
  [Maine DWA guidelines](https://www.maine.gov/ifw/docs/DWA_Guidelines_2.4.10.pdf)

What the bed-site literature actually measures, and it is never the gradient:

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

Second transferable band, 🟡 doctrine: **elk are reported to favour 20–40 %
slopes for daily use with preference between 15–30 %, use declining above 40 %
and few above 60 %** — that is **8.5–22°**, centred well *below* our 22°.
[American Hunter summary of Idaho/Montana work](https://www.americanhunter.org/content/the-right-elk-stuff/)
The primary sources (Thomas 1979 Ag. Handbook 553; Rumble et al. Black Hills
RSF) were not retrievable, so this is secondary reporting of a primary result —
doctrine grade until someone reads them.

**Three independent bands now agree on the centre and disagree with 22°:**

| Source | Class | Band | In degrees | Centre |
|---|---|---|---|---|
| BC WHR whitetail winter range | agency rating | 10–45 % | 5.7–24.2° | **15°** |
| Elk daily-use preference (secondary) | doctrine | 15–30 % | 8.5–16.7° | **12.5°** |
| Rowland 2018 elk summer use | 🟢 measured | monotone declining, no optimum | — | **→ 0°** |
| **Ridgeline today** | — | Gaussian 22 ± 14° | 8–36° | **22°** |

Every external band centres between **12° and 15°**. Ours centres at 22° and its
upper tail runs to 36°, which is beyond where the elk sources report use
essentially ceasing.

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
> ### Pass 3 verdict: the gentle-pad side wins, so this is a re-centring, not a rewrite
>
> The founder asked specifically whether the literature supports a gentle *pad*
> angle, because that decides whether reformulating is cheap or expensive. It
> does, from three directions that do not share a source:
>
> 1. **Measured, cross-species.** Rowland et al. 2018 — cervid habitat use
>    declines monotonically with slope, slope the single strongest predictor.
>    No interior optimum exists in the best-measured cervid slope response.
> 2. **Agency.** The BC WHR band bottoms at 10 % (5.7°) and centres at 15°, and
>    nothing in it excludes gentle ground.
> 3. **Doctrine, independently worded across sources.** "Flat or gently sloping
>    areas", "flat portions within the changing topography", "a flat spot on a
>    steep hillside".
>
> **Nothing found in this pass supports a slope *optimum* at any angle, for any
> cervid.** The contradiction therefore resolves in favour of `detectBenches`,
> and `beddingLikelihood`'s 22° peak is the side that is wrong. Practically
> that means **`detectBenches` keeps its geometry and `beddingLikelihood`
> adopts it** — the engine already computes the right thing in the wrong file.
>
> **Recommended reformulation** — and this is the highest-value change in the
> bedding model, larger than tuning 22°:
> ```
> slopeTerm = gauss(slope, ideal = 8°,  tol = 8°)      // the pad itself
>           × sigmoid(ringSlope, min = 15°)             // steep surrounds
> ```
> i.e. reuse the bench geometry `detectBenches` already computes instead of a
> single-cell Gaussian. The numbers stay 🟡/🔴 — but the *shape* stops
> contradicting our own bench detector, the measured cervid slope response and
> every field description at once.
>
> Better still, drop the Gaussian on the pad entirely and use a **monotone
> decreasing** term, which is the only shape Rowland et al. measured:
> ```
> padTerm = 1 / (1 + (slope / 12°)²)          // 🟡 half-max at 12°, no optimum
> ringTerm = sigmoid(ringSlope, min = 15°)     // 🔴 steep surrounds
> slopeTerm = padTerm × ringTerm
> ```
> A Gaussian centred at 0° is *also* monotone decreasing and would do; what must
> go is the interior peak.
>
> If instead we keep the single-cell Gaussian, honesty demands centring it at
> **12°** with tolerance **10°** per the table above, rather than 22 ± 14.
>
> **Action:** `BACKLOG N10` (surface the 🔴 chip) plus a new item for the
> reformulation. Longer term this is what collar data settles (`I3`).

### 🟡 Bench geometry — `maxBenchSlopeDeg: 8`, `minSurroundSlopeDeg: 18`
Ordering and concept are strong, consistent doctrine — hill-country deer bed on
benches, points and shelves with cover uphill and a view downhill — and pass 3
found that doctrine stated in near-identical terms across independent sources
(above), plus a measured cervid slope response that is monotone-declining and so
is consistent with a gentle pad and inconsistent with the 22° competitor.
**This is now the better-supported of the engine's two bedding-slope models.**

The two thresholds themselves remain ours and unmeasured. `maxBenchSlopeDeg: 8`
sits comfortably inside the BC WHR band's lower half; `minSurroundSlopeDeg: 18`
has nothing behind it at all. Same regional caveat as everything else here: this
is Appalachian / Ozark / Driftless doctrine and means little in the Texas brush
or on flat agricultural ground.

### 🟡 Warm-aspect winter selection — **an aspect driver we do not model at all**
Four independent agency sources prescribe **south- to west-facing** slopes for
winter deer range, which is a *solar* criterion, not a *wind* one:

- BC WHR whitetail winter range: "south and/or west aspect" (with the 10–45 %
  band above), Douglas-fir at low elevation on south-facing slopes with moderate
  to high crown closure as preferred winter habitat.
- Ontario: "south facing slopes are desirable" for whitetail habitat.
  [Ontario forest management guide, stand and site scales](https://docs.ontario.ca/documents/4816/stand-amp-site-guide.pdf)
- Nova Scotia / regional: hardwood stands on south- to west-facing slopes are
  important wintering habitat.
  [NS Special Management Practices — White-tailed Deer](https://novascotia.ca/natr/wildlife/habitats/terrestrial/pdf/SMP_White-tailed_Deer.pdf)
- Maine: in hilly terrain deer yards are often on south-facing slopes "to
  optimize warming from the sun."
  [Maine IFW deer habitat management system](https://www.maine.gov/ifw/docs/species_planning/mammals/whitetaileddeer/habitatmanagement.pdf)

And the mechanism is measured, not asserted: snow was **18.1 cm on the SE-facing
slope against 42.0 cm on the NE-facing slope** in the same study area.
[Lang & Gates 1985](https://www.originalwisdom.com/wp-content/uploads/bsk-pdf-manager/2019/04/Lang-and-Gates_1985_Selection-of-Sites-for-Winter-Night-Beds-by-White-tailed-Deer.pdf)

**Assessment and the conflict it creates.** `beddingLikelihood`'s only aspect
term is `cos(aspect − windFrom)` — pure leeward geometry, season-blind. On a
cold, clear, north-west-wind day the leeward term rewards south-east aspects and
happens to agree; on a south wind in January it rewards north aspects and points
the user at the deepest snow and the coldest ground, against four agencies and a
measured snow-depth difference. The insolation layer already computes what is
needed. **Action:** file a bedding-model item to blend a season/temperature-
weighted solar-aspect term with the leeward term rather than using leeward
alone. Grade 🟡 — the prescriptions are agency-asserted; the snow-depth
mechanism behind them is 🟢.

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

### 🔴 Terrain shelter: 30° upwind horizon = full shelter — *saturation still unsupported, but the search radius now has a measured value*
TOPEX ("topographic exposure") is the established forestry wind-exposure index
and works exactly as we do — exposure at a point from the **height and distance
of the surrounding horizon**, combined into an angle of inflection. So the
*method* is sound and cited.
[Assessing topographic exposure, *Meteorol. Appl.*](https://www.cambridge.org/core/journals/meteorological-applications/article/abs/assessing-topographic-exposure/89F72FFA2C33A084CE96D69E2A3541BB)

**The 30° saturation point remains ours and unsupported.** Searched; nothing in
the windthrow-hazard literature nominates a horizon angle above which shelter is
complete. Stays 🔴.

**But one adjacent parameter moved.** Distance-limited TOPEX was tested against
site windiness at **0.25, 0.5, 0.75, 1.0, 2.0, 3.0 and 10.0 km**, and a limit of
**0.5 km proved superior to all of the others**.
[Potential of distance-limited topex in the prediction of site windiness,
*Forestry* 71:325](https://academic.oup.com/forestry/article-abstract/71/4/325/587495)
🔵 for the radius. Whatever upwind search distance `shelter` currently uses
should be checked against 500 m and, if it differs, changed — this is a measured
optimum for precisely the quantity we compute, and it is free.
*(abstract/index only.)*

**Queries:** `TOPEX topographic exposure index wind shelter horizon angle
threshold forestry` · `GIS wind exposure windthrow hazard rating` ·
`distance-limited topex site windiness`.

### 🔴 Cover term: `ruggedness / 4 m` — **the constant stays 🔴; the concept and the window both moved**
"4 m of local relief in a 3×3 window is plenty of broken ground." The constant is
still invented and no literature sets it. Two things pass 2 got wrong, though:

**1. The proxy is not ours — it is the index's stated design purpose.** TRI was
devised by Riley, DeGloria & Elliot (1999) specifically **to quantify
topographic heterogeneity in wildlife habitats providing concealment for prey
and lookout posts**. Using TRI as a security-cover term is the authors' own
intended application, not our reinterpretation. That is 🔵 for the concept.
[Topographic ruggedness indices in ecology: past, present and future](https://www.researchsquare.com/article/rs-1700794/latest.pdf)

**2. The 3×3 window is probably the wrong scale, and TRI is probably the wrong
index.** Two findings, both implementable:

- **Scale.** "Coarser scales of ruggedness may be more related to viewsheds and
  concealment." A 3×3 window at 10 m DEM resolution measures a 30 m
  neighbourhood — micro-roughness, closer to surface texture than to the broken
  ground a bedded deer uses. Concealment is the coarse-scale signal.
- **Collinearity, and this one is a live defect.** TRI is **strongly correlated
  with slope**; the vector ruggedness measure was developed precisely because it
  "quantifies local variation in terrain **more independently of slope** than
  other methods tested", with VRM and slope then distinguishing *different*
  components of habitat.
  [Sappington, Longshore & Thompson 2007, *J. Wildl. Manage.* 71:1419](https://wildlife.onlinelibrary.wiley.com/doi/10.2193/2005-723)
  `beddingLikelihood` multiplies `slopeTerm × coverTerm(TRI)`. Because TRI
  carries slope inside it, that product **counts slope roughly twice** — a
  steep cell is rewarded once by the Gaussian and again through TRI. This is a
  modelling error independent of any constant, and it compounds the 22° problem
  rather than offsetting it.

**Recommended:** swap TRI for **VRM** in the cover term, evaluate it over a
coarser neighbourhood than 3×3, and re-derive the normalising constant against
the new index — `/ 4 m` is meaningless for VRM, which is dimensionless on 0–1.
Concept 🔵, index choice 🔵, constant 🔴.

**Standing caveat, unchanged:** a *terrain* proxy is still standing in for
*vegetative* concealment, which is what the bed-site literature actually
measures (cover above the bed, canopy closure, visual obstruction). Uresk et al.
found 8 significant variables at 259 fawn beds and every one that indexes is
vegetation-structural. The proxy is the weaker claim, not the constant.

**Queries:** `terrain ruggedness index vegetation concealment deer hiding cover
correlation surrogate` · `Sappington 2007 vector ruggedness measure scale window
size bighorn sheep` · `Riley DeGloria Elliot terrain ruggedness index
topographic heterogeneity`.

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

### 🟢 Transition window: symmetric ±45 min is wrong — **and the correct numbers are now measured** *(was 🔴)*
Pass 2 established the asymmetry from qualitative description and guessed
`{ morning: 90, evening: 30 }`. Pass 3 found the measurements, and they are of
exactly the quantity we model:

| Transition | **Measured onset** | `transitionMinutes` today |
|---|---|---|
| Evening — katabatic onset | **≈ 35 min after sunset**, initiation rate **3× faster** than anabatic; a corroborating study puts the evening transition delay at **at most 30 min** after sunset | ±45 min |
| Morning — anabatic onset | **≈ 110 min after sunrise**, with onset spread over a ~20-min interval between measurement points | ±45 min |

[El Gdachi et al. 2024, *J. Geophys. Res. Atmos.* 129, "Thermodynamic Processes
Driving Thermal Circulations on Slopes"](https://agupubs.onlinelibrary.wiley.com/doi/10.1029/2023JD040431) ·
[Evening transition between anabatic and katabatic regimes in complex terrain](https://www.researchgate.net/publication/308485759_Evening_transition_between_anabatic_and_katabatic_wind_flow_regimes_in_complex_terrain) ·
[Distinguishing time scales of katabatic flow in complex terrain, *Atmosphere* 12:1651](https://www.mdpi.com/2073-4433/12/12/1651)

**Recommended replacement:** `transitionMinutes: { morning: 110, evening: 35 }`,
and the windows should be **forward-offset, not centred** — katabatic onset is
35 min *after* sunset, so an evening window of sunset−45 → sunset+45 spends half
its time in a phase that has not started. Sunset → sunset+35 and sunrise →
sunrise+110 is what the measurements describe.

🟢 for the asymmetry and the magnitudes; the two studies bracket the evening
number at **30–35 min** and only one reports the morning number, so treat
morning 110 as ±30. **Scope, stated:** the 35/110 pair is from Reunion Island —
tropical, maritime, steep volcanic terrain. The corroborating ≤30 min evening
figure is from mid-latitude complex terrain. The *asymmetry* replicates across
both; the exact minutes in an Appalachian hollow in November are unmeasured.

The **elevation dependence** stands and stays 🔵: flow reversal "is not
instantaneous but spaced out by an evening transition characterised by slow
winds, changing wind directions and fluxes close to zero", and ridges flip while
the valley bottom is still draining. A single global phase for the whole DEM is
wrong on exactly the terrain the app is for. File the cold-pool persistence
model separately. *(abstract/index only — verify against full text.)*

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

### 🔴 Deer scent-detection distance — **re-attacked; stays 🔴, and the media numbers are worse than unsupported**
Not a code parameter today, but implied by the cone's 400 m. Re-searched with
olfactometry and threshold-measurement phrasing rather than hunting phrasing.
**No cervid odour-detection-distance measurement exists.** What is measurable —
and is where the media numbers come from — is *anatomy*, which does not convert
to a distance:

- ~**290 million** olfactory receptors vs ~6 million in humans and 100–300
  million in dogs;
- roe deer olfactory epithelium ~**90 cm²** vs ~10 cm² in humans.

Those are real comparative-anatomy figures and they support "deer smell far
better than we do". They do **not** support any metre value, and the "half a
mile / 800–1000 yards in ideal conditions" figure that recurs across hunting
media has **no measurement behind it and no primary source** — it is asserted,
then re-cited. Do not let it into the register at any grade above 🔴, and do not
render 400 m as a detection radius.

Note the asymmetry that makes this worth stating: the olfactometry literature
that *can* measure detection thresholds (automated human-scent olfactometers,
sniff protocols) is a **detection-dog** field. Nobody has put a deer in one.

**Queries:** `deer olfaction detection distance experiment odour threshold
ungulate scent human` · `cervid olfactory acuity measurement olfactometer` ·
`odor detection threshold wildlife` · plus pass 2's scent-cone queries.

---

## Rut timing

> **Pass 4 (`R9`, rut regionalisation) reworked this whole section.** Passes 2
> and 3 established that a latitude-monotone peak-breeding function is the wrong
> functional class and assembled an eight-row seed table. Pass 4 answers the
> three questions the backlog row actually asked — *where is latitude-only
> defensible, where is it wrong and by how many days, and what should the model
> say there* — by scoring the shipped function against **40 published regional
> peaks** and by finding the mechanism paper. Headline: the shipped function is
> within **+1 to +7 days** everywhere at ≥ 37°N, and between **−80 and +131
> days** across the Coastal Plain, the Deep South, Texas and Florida. It is not
> uniformly biased — **the sign of its latitude gradient is wrong in Georgia,
> the Carolinas and Florida, and its magnitude is 6× too small in Alabama.**

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

**Pass 4 added the mechanism and two independent stability checks**, so that
"photoperiod, never lunar" is now supported by physiology and not only by
correlation:

- **Mechanism.** Day length is transduced by the retina and suprachiasmatic
  nucleus into a melatonin signal that activates the reproductive axis under
  short days and inhibits it under long days. Experimentally, artificially long
  days (16L:8D) in autumn **delayed** onset of puberty in Upper Michigan doe
  fawns relative to natural-daylight controls, and melatonin dosing advances
  first oestrus in captive whitetail by **37–119 days**. Photoperiod is
  therefore the *proximate cause*, not a correlate.
  [Verme & Ozoga 1987, *J. Mammalogy* 68:107 — photoperiod and puberty in doe fawns](https://academic.oup.com/jmammal/article-abstract/68/1/107/1040922) ·
  [Out-of-season breeding of captive white-tailed deer, *Theriogenology* (PubMed)](https://pubmed.ncbi.nlm.nih.gov/11071135/) ·
  [Reproductive management in white-tailed deer, *Agroproductividad*](https://revista-agroproductividad.org/index.php/agroproductividad/en/article/download/2063/1687/8266)
- **Inter-annual stability.** Ontario deer–vehicle collisions, 29 years
  (1988–2016), grouped by deer management area: **no evidence of any change in
  rut timing over 29 years**, and the top model for the date of peak collisions
  contained **one parameter — the management area.** Growing-degree-day (a
  weather covariate) was never significant.
  [Deerly departed, *Ecological Informatics / Sci. Total Env.* 2024](https://www.sciencedirect.com/science/article/pii/S2666900524000042)
  This is a *northern-range* result and it says two things at once: timing is
  fixed year to year (photoperiod), **and even in Ontario the only predictor
  that survives is region.**

### 🟢 How precise a "peak" can honestly be — the two dispersions
The register previously used "±4 days" for the northern peak without a source.
It now has one, and the number means something specific.

| Quantity | Value | What it bounds |
|---|---|---|
| SD of a **population's annual mean** conception date, year to year | **4 days**, range 12 days | how repeatable *this herd's* peak is — the calibrated case |
| SD of **individual** conception dates within a wild population | **13.4 days**, mean range **46 days** | how wide the actual breeding spread is — never a "peak day" |
| SD of individual conception dates, **captive** deer (TX + MS) | 13.6 days, mean range 33 days | captive vs wild dispersion is nearly identical |
| Fraction of breeding inside a **21-day window** centred on peak | most of it; total duration 30–45 days | the operational rut window |

[Dye et al. 2012, *Wildl. Soc. Bull.* 36:107–114 — Factors affecting conception date variation](https://wildlife.onlinelibrary.wiley.com/doi/10.1002/wsb.98) ·
[MSU Deer Lab — Ecology of the rut](https://www.msudeer.msstate.edu/ecology-of-the-rut.php)

**Consequence.** A model that has *not* been calibrated to the user's herd
cannot claim better than the region-to-region spread (below, ~±8 days at
≥ 37°N). A model that *has* been calibrated from ≥ 3 seasons of the user's own
observations can claim ±4 days and no better. Any UI that names a single day
without an interval is overclaiming, in the north as well as the south.

### 🔴 `peakBreedingDayOfYear` returns **319** at ≥ 40°N — off by ~5 days
DOY 319 is 15 November. The best measured value at that latitude is **8–10
November = DOY 312–314**. Recommend **`314`**, scope "interior/upland range,
≥ 37°N". Illinois sits at ~40°N, which is exactly the branch boundary, so this
is a like-for-like correction.

**Pass 4: the north is flat in latitude, and 314 is the right constant.** Every
population mean found at 37.5–43°N clusters inside 2–16 November with **no
detectable latitude trend**:

| Region | Lat | Population mean / peak | Model | Error |
|---|---|---|---|---|
| SW Wisconsin (188 GPS bucks + conception) | 43.0°N | breeding window 23 Oct – 12 Nov | 15 Nov | −5 d |
| New Jersey, northern adults | 40.2°N | 3–23 Nov (mid 13 Nov) | 15 Nov | +2 d |
| Midwest (IL/OH/IN) | 40.0°N | **10 Nov** | 15 Nov | **+5 d** |
| West Virginia | 38.8°N | 7–15 Nov | 16 Nov | +5 d |
| Missouri | 38.5°N | 16 Nov | 17 Nov | +1 d |
| Virginia | 37.5°N | 16 Nov | 18 Nov | +2 d |
| Kentucky | 37.5°N | 8–15 Nov | 18 Nov | **+7 d** |

[Hunsaker et al. 2025, *Ecology and Evolution* — breeding season and movement ecology of male whitetail, SW Wisconsin](https://onlinelibrary.wiley.com/doi/full/10.1002/ece3.71589) ·
[NJDEP — biology of the white-tailed deer](https://dep.nj.gov/njfw/hunting/biology-of-the-white-tailed-deer/) ·
[VA DWR — fawning dates are key to rut timing](https://dwr.virginia.gov/blog/virginias-deer-with-justin-folks-fawning-dates-are-key-to-rut-timing/)

**So the right functional class in the north is a constant, not a latitude
ramp** — and the shipped code already uses a constant there, which is the one
part of the function that is structurally correct. Prescription:

```
lat ≥ 37°N (and not in a South/Coastal-Plain region polygon):
    peak = DOY 314 (10 Nov)
    interval = ±8 d   region-to-region spread of population means, from the table above
    (±4 d if the user has ≥ 3 seasons of their own calibration — Dye et al. 2012)
```
The 37°N floor is chosen because every population mean at ≥ 37°N lands inside
8–16 November, and the first counterexample appears at **34.5–35.7°N** (North
Carolina, below). 35–37°N is a reduced-confidence band: the interior holds
(Tennessee 17–25 Nov, E Oklahoma 17 Nov, Arkansas 18 Nov ± 7) but the Atlantic
Coastal Plain at the same latitude does not.
[Oklahoma Academy of Science — breeding season of whitetail in eastern Oklahoma](https://ojs.library.okstate.edu/osu/index.php/OAS/article/view/5012/4682)

### 🔴 Latitude interpolation below 40°N — **the functional form is wrong, and pass 4 measured how wrong**
Current: `319 + (40 − lat)·1.2` down to 34°N, then `326 + (34 − lat)·3.5`.
Pass 2 graded this 🔵 on the grounds that "southern herds breed later" is widely
reported and only the coefficients were ours. Pass 3 downgraded it to 🔴 on the
functional class. **Pass 4 scored it.**

Every published population mean or agency peak found in this pass, with the
shipped function's error at that location. Positive = model predicts breeding
**later** than reality. Errors ≤ 7 days are marked ✅.

| Region | Lat | Published peak / mean conception | Model | Error (d) |
|---|---|---|---|---|
| Midwest (IL/OH/IN) | 40.0 | 10 Nov | 15 Nov | +5 ✅ |
| Missouri | 38.5 | 16 Nov | 17 Nov | +1 ✅ |
| West Virginia | 38.8 | 11 Nov | 16 Nov | +5 ✅ |
| Kentucky | 37.5 | 11 Nov | 18 Nov | +7 ✅ |
| Virginia | 37.5 | 16 Nov | 18 Nov | +2 ✅ |
| Tennessee, central | 35.8 | 17 Nov | 20 Nov | +3 ✅ |
| Tennessee, east | 36.0 | 25 Nov | 20 Nov | −5 ✅ |
| E Oklahoma (Cookson Hills) | 35.7 | 17 Nov | 20 Nov | +3 ✅ |
| Arkansas, statewide | 34.8 | 18 Nov | 21 Nov | +3 ✅ |
| **NC Unit I (west mountains)** | 35.7 | **5 Dec** | 20 Nov | **−15** |
| NC Unit III | 35.5 | 8 Nov | 20 Nov | **+12** |
| **NC Unit V (SE coastal)** | 34.5 | **11 Oct** | 22 Nov | **+42** |
| SC, statewide mean | 33.8 | 30 Oct | 23 Nov | **+24** |
| SC, Lower Coastal Plain | 33.0 | 25 Oct | 26 Nov | **+32** |
| GA — Clarke Co | 33.95 | 13 Nov (DVC wk 11/10–11/16) | 22 Nov | +9 |
| GA — Appling Co | 31.75 | 6 Nov (11/03–11/09) | 30 Nov | **+24** |
| GA — Bacon Co | 31.55 | 30 Oct (10/27–11/02) | 1 Dec | **+32** |
| **GA — Atkinson Co** | 31.30 | **23 Oct (10/20–10/26)** | 1 Dec | **+39** |
| Alabama, north | 34.7 | 19 Nov | 21 Nov | +2 ✅ |
| **Alabama, southwest** | 31.4 | **1 Feb** | 1 Dec | **−62** |
| Mississippi, statewide mean | 32.8 | 1 Jan | 26 Nov | **−36** |
| Mississippi Delta (median) | 33.5 | 27 Dec | 24 Nov | **−33** |
| **Mississippi, SE coastal** | 31.0 | **mid-Feb** | 3 Dec | **−74** |
| Louisiana, areas 4/9 (SE) | 30.7 | early–mid Dec | 4 Dec | −6 ✅ |
| Louisiana, areas 1/5/6 | 31.5 | mid-Jan | 1 Dec | **−45** |
| TX Pineywoods, north | 32.5 | 22 Nov | 27 Nov | +5 ✅ |
| TX Pineywoods, south | 31.0 | 12 Nov | 3 Dec | **+21** |
| TX Cross Timbers, north | 33.5 | 15 Nov | 24 Nov | +9 |
| TX Post Oak Savannah, central | 31.0 | 10 Nov | 3 Dec | **+23** |
| TX Edwards Plateau, east | 30.5 | 7 Nov | 4 Dec | **+27** |
| TX Edwards Plateau, west | 30.0 | 5 Dec | 6 Dec | +1 ✅ |
| TX Trans-Pecos | 30.5 | 8 Dec | 4 Dec | −4 ✅ |
| **TX Gulf Prairies, north** | 29.5 | **30 Sep** | 8 Dec | **+69** |
| TX Gulf Prairies, south | 27.5 | 31 Oct | 15 Dec | **+45** |
| TX South Texas Brush, east | 27.5 | 16 Dec | 15 Dec | −1 ✅ |
| TX South Texas Brush, west | 27.5 | 24 Dec | 15 Dec | −9 |
| FL — Camp Blanding (N) | 29.9 | 2 Nov | 6 Dec | **+34** |
| **FL — Eglin AFB (NW)** | 30.5 | **22 Feb** | 4 Dec | **−80** |
| FL — Tosohatchee (central) | 28.5 | 7 Oct | 11 Dec | **+65** |
| **FL — Rotenberger (S)** | 26.4 | **10 Aug** | 19 Dec | **+131** |

Sources for the rows above, in addition to those already cited:
[NCWRC peak conception dates (PDF)](https://www.ncwildlife.gov/media/4373/download?attachment=) ·
[SCDNR peak breeding dates](https://www.dnr.sc.gov/wildlife/deer/reproductionmap.html) ·
[GA DNR rut map (PDF)](https://georgiawildlife.com/sites/default/files/wrd/pdf/research/Georgia-Rut-Map.pdf) ·
[MDWFP breeding date map](https://www.mdwfp.com/wildlife-hunting/wildlife-species-program/deer-program/deer-breeding-date-map) ·
[MSU Deer Lab — ecology of the rut](https://www.msudeer.msstate.edu/ecology-of-the-rut.php) ·
[Turner et al. 2019, *Wildl. Soc. Bull.* — Alabama breeding chronology](https://wildlife.onlinelibrary.wiley.com/doi/abs/10.1002/wsb.1031) ·
[Outdoor Alabama / WFF county rut map](https://www.outdooralabama.com/node/3171) ·
[LDWF estimated deer breeding periods](https://www.wlf.louisiana.gov/page/deer-breeding-periods) ·
[TPWD — the rut in white-tailed deer](https://tpwd.texas.gov/huntwild/hunt/planning/rut_whitetailed_deer/) ·
[Richter & Labisky 1985, *J. Wildl. Manage.* 49:964–971 — reproductive dynamics among disjunct Florida herds](https://journals.flvc.org/edis/article/view/114365)

**Three separate ways the function fails, each fatal on its own.**

1. **Same latitude, months apart.** At **30.5°N** the published peaks are 7 Nov
   (TX Edwards Plateau east), 8 Dec (TX Trans-Pecos), ~10 Dec (SE Louisiana) and
   **22 Feb** (Eglin AFB, Florida panhandle) — a **107-day spread at one
   latitude**. At **~31°N**: 30 Oct (GA Bacon Co) to **mid-Feb** (SE
   Mississippi) — **108 days**. At **~33°N**: 25 Oct (SC Lower Coastal Plain) to
   1 Jan (Mississippi) — **68 days**. At **27.5°N**, three Texas populations at
   *identical* latitude peak 31 Oct, 16 Dec and 24 Dec — **54 days**. Any
   function of latitude returns one number for all of these.

2. **The sign of the gradient is wrong in the Atlantic South.** The model
   assumes southern ⇒ later. In **Georgia** the four county peaks readable from
   the agency PDF run Atkinson (31.30°N) 23 Oct → Bacon (31.55°N) 30 Oct →
   Appling (31.75°N) 6 Nov → Clarke (33.95°N) 13 Nov: **+7.9 days per degree
   *north***, where the model applies **−3.5 days per degree north**. Wrong sign
   and 11.4 d/° off in magnitude. **North Carolina** is the same: Unit V (SE
   coastal) 11 Oct → Unit I (west mountains) 5 Dec, i.e. the *lowest*-latitude
   unit is **55 days earlier** than the highest, inside a state spanning 2.5° of
   latitude. **South Carolina** likewise runs Lower Coastal Plain 25 Oct → Upper
   Coastal Plain ~1 Nov → Piedmont mid-Nov. **Florida is the extreme case:** the
   *northernmost* site sampled (Eglin AFB, 30.5°N) has the **latest** mean
   breeding date in the state (22 Feb) and the *southernmost* (Rotenberger,
   26.4°N) the earliest (10 Aug) — **196 days apart, inverted**.

3. **Where the sign is right, the magnitude is 6× too small.** Alabama runs
   19 Nov in the north (34.7°N) to 1 Feb in the southwest (31.4°N): a real
   gradient of **−22.4 days per degree north**, against the model's −3.5.

> **The single sentence for the UI, if only one fits:** *South Carolina peaks
> 30 October and Mississippi peaks 1 January — both at ~33°N, 63 days apart —
> and inside Florida alone the range is 10 August to 22 February with the
> northernmost herd the latest of all.*

**Recommendation:** north of **37°N** keep the photoperiod constant (DOY 314,
±8 d uncalibrated / ±4 d calibrated). South of it, **stop predicting from
latitude entirely.** Region lookup, or *unknown*. See the prescription block
below.

### 🔵 Why the South is heterogeneous — **the mechanism, and a correction to this register**
Pass 3 wrote that southern rut timing "is driven by herd genetics, restocking
history and local conditions". **That is stronger than the evidence supports and
is corrected here.** The one study that tested it directly reached a split
result:

Sumners et al. compared mtDNA and microsatellite differentiation between **6
pairs of adjacent populations whose breeding dates differ by a mean of 35 days**
and **4 pairs differing by ≤ 2 days**.

- **Biparental nuclear markers did *not* separate them**: F<sub>ST</sub> = 0.028
  (SD 0.021) for the similar-date pairs vs 0.047 (SD 0.024) for the
  different-date pairs, **P = 0.200**. The straightforward "different stock ⇒
  different rut" story is *not* supported at nuclear loci.
- **mtDNA lineages did differ more** between geographically proximate
  populations with differing breeding dates, implying a **maternal** genetic
  effect maintained by **female philopatry**. The authors advance the restocking
  legacy as a hypothesis — the paper's title ends in a question mark, and so
  should ours.

[Sumners et al. 2015, *J. Wildl. Manage.* 79:1213–1225 — Variable breeding dates among populations of white-tailed deer in the southern United States: the legacy of restocking?](https://wildlife.onlinelibrary.wiley.com/doi/10.1002/jwmg.954)

**Assessment.** The defensible statement is: *the photoperiod cue is universal,
but the **threshold** at which a given maternal lineage responds to it is
heritable and locally fixed by doe site-fidelity, so adjacent herds can differ by
weeks under identical day length.* Graded 🔵 — the differentiation is measured,
the causal attribution to twentieth-century restocking is inference, and the
study's own nuclear-marker test came back negative.

Two corroborating, non-genetic contributors are reported by the agencies and
should be carried as 🟡 rather than dropped: **spring flooding** in the
Mississippi/Atchafalaya bottomlands selecting for late fawning, and
**restocking-source folklore** in Alabama. Neither is quantified.
[MSU Deer Lab — 2011 flood impacts on Delta deer (PDF)](https://www.msudeer.msstate.edu/docs/articles/Potential%20Flood%20Impacts%20on%20Deer%202011%20Flood%20Delta%20Wildlife%20Magazine.pdf) ·
[MDWFP — what triggers the whitetail rut](https://www.mdwfp.com/wildlife-hunting/private-lands-program/habitat-and-wildlife-information/what-triggers-whitetail-rut)

**What this rules out as a modelling shortcut.** Because the effect is carried in
maternal lineage rather than in the environment, it is **not recoverable from any
covariate the engine has** — not latitude, not elevation, not NLCD cover, not
temperature. There is no clever feature that substitutes for the region table.
That is worth stating plainly so a future pass does not try.

### 🟢 Region → peak-breeding lookup — **the seed table, assembled from agency sources**
Pass 2 established that the latitude-monotone form is wrong but left no
implementable alternative. This is that alternative. Every row is a published
agency or peer-reviewed figure; none is interpolated by us.

| Region | ~Lat | Peak conception / breeding | Source class | Source |
|---|---|---|---|---|
| Midwest (IL and neighbours) | 40°N | mean **10 Nov**; adults 8 Nov, yearlings 11 Nov, fawns 2 Dec | 🟢 fetal aging | [*Theriogenology* 2017](https://www.sciencedirect.com/science/article/pii/S0093691X1730078X) |
| South Carolina, statewide | 33.5°N | peak **30 Oct**; **83 %** of does bred **6 Oct – 16 Nov** | 🟢 agency fetal data | [SCDNR peak breeding dates](https://www.dnr.sc.gov/wildlife/deer/reproductionmap.html) |
| Georgia, by county | 31–35°N | county peaks span **20 Oct – mid-Nov** in most of the state, **late Nov–Dec** in the south and coast. Examples: Atkinson **10/20–10/26**, Bacon **10/27–11/02**, Appling **11/03–11/09**, Clarke **11/10–11/16** | 🔵 DVC-derived, **validated against conception dates and GPS movement rates** | [GA DNR rut map (PDF)](https://georgiawildlife.com/sites/default/files/wrd/pdf/research/Georgia-Rut-Map.pdf) · [GA DNR rut map page](https://gadnrle.org/rut-map) · [SEAFWA method paper](https://seafwa.org/journal/2015/using-deer-vehicle-collisions-map-white-tailed-deer-breeding-activity-georgia) |
| Mississippi, statewide | 33°N | mean **1 Jan**, SD 13.4 d, mean range 46 d | 🟢 agency fetal data | [MDWFP breeding date map](https://www.mdwfp.com/wildlife-hunting/wildlife-species-program/deer-program/deer-breeding-date-map) |
| Alabama | 32°N | most populations peak in **January**; conception varies **≥ 60 days between populations within one county** | 🟢 peer-reviewed | [Turner et al. 2019, *WSB*](https://wildlife.onlinelibrary.wiley.com/doi/abs/10.1002/wsb.1031) |
| Texas — Edwards Plateau | 30°N | **7 Nov** east, **24 Nov** central, **5 Dec** west | 🟢 agency | [TPWD](https://tpwd.texas.gov/huntwild/hunt/planning/rut_whitetailed_deer/) |
| Texas — Gulf Prairies | 28°N | **30 Sep** north, **31 Oct** south | 🟢 agency | TPWD, as above |
| Florida, by zone | 25–31°N | zone means span **22 Jul – 31 Jan**; within-area conception spread **9–110 days**, mean 45 d, most does within 60 d | 🟢 agency, biological data collected since 2009 | [FWC statewide rut map (PDF)](https://myfwc.com/media/18766/statewide-rut-map.pdf) · [FWC "the truth about Florida's deer rut"](https://content.govdelivery.com/accounts/FLFFWCC/bulletins/22cf0b1) |

**Pass-4 additions to the seed table.** Twelve further rows, at the resolution
the source publishes. Everything here is fetal-aged conception data unless the
row says otherwise.

| Region | ~Lat | Peak conception / breeding | Source class | Source |
|---|---|---|---|---|
| North Carolina, 5 units | 34–36.5°N | **Unit V 11 Oct · Unit IV 30 Oct · Unit III 8 Nov · Unit II 20 Nov · Unit I 5 Dec**; statewide extremes reported as **4 Oct (east)** to **19 Dec (west)** | 🟢 agency fetal data, county resolution | [NCWRC estimated peak conception dates (PDF)](https://www.ncwildlife.gov/media/4373/download?attachment=) |
| Virginia, statewide | 37.5°N | peak conception ~**16 Nov**; most does in oestrus **10–25 Nov**; peak fawning 16 Jun (2019 and 2020) | 🟢 agency + VADS telemetry | [VA DWR — fawning dates are key to rut timing](https://dwr.virginia.gov/blog/virginias-deer-with-justin-folks-fawning-dates-are-key-to-rut-timing/) · [Virginia Appalachian Deer Study](https://dwr.virginia.gov/blog/the-virginia-appalachian-deer-study-how-fawns-are-faring-west-of-the-blue-ridge-mountains/) |
| West Virginia | 38.8°N | most does bred **7–15 Nov** | 🟡 agency summary, no n given | see the state-summary caveat below |
| Kentucky, statewide | 37.5°N | **8–15 Nov**, tight statewide | 🟡 agency summary of fetal-rate analyses | KDFWR deer-program reports, *seen only in secondary summary — unread* |
| Tennessee, by region | 35–36.5°N | **west 21 Nov · central 17 Nov · east 25 Nov** | 🟡 agency summary | *unread at source* |
| Arkansas, statewide | 34.8°N | mean **18 Nov ± ~7 d**; AGFC publishes deer-zone detail | 🟡 agency summary | *unread at source* |
| E Oklahoma (Cookson Hills, McAlester) | 35.7°N | peak "just prior to **18 Nov**", from testes/epididymal histology, Nov 1972 | 🟢 peer-reviewed | [Oklahoma Acad. Sci.](https://ojs.library.okstate.edu/osu/index.php/OAS/article/view/5012/4682) |
| Alabama, by county | 30.5–35°N | **north 13–25 Nov**; **Black Belt / central late Dec – mid Jan**; **southwest 25 Jan – 8 Feb**. ≥ **60 days** variation *within* single counties | 🟢 peer-reviewed + agency county map | [Turner et al. 2019](https://wildlife.onlinelibrary.wiley.com/doi/abs/10.1002/wsb.1031) · [Outdoor Alabama — WFF rut map](https://www.outdooralabama.com/node/3171) |
| Mississippi, by unit | 30.3–35°N | **late Nov** in NW counties → **mid-Feb** in SE counties (~80 d within one state); Delta median **27 Dec**; statewide mean 1 Jan | 🟢 agency, >20 yr of deer health checks | [MDWFP](https://www.mdwfp.com/wildlife-hunting/wildlife-species-program/deer-program/deer-breeding-date-map) · [MSU Deer Lab](https://www.msudeer.msstate.edu/ecology-of-the-rut.php) |
| Louisiana, 10 deer areas | 29–33°N | **Area 2 peak Nov**; **Areas 4 & 9 (Florida Parishes / SE) peak early–mid Dec**; **Areas 1, 5, 6 late rut in Jan**. Published as two-week peak windows, from fetal measurements | 🟢 agency fetal data, area resolution | [LDWF estimated deer breeding periods](https://www.wlf.louisiana.gov/page/deer-breeding-periods) |
| Texas, all ecoregions | 26–34°N | Pineywoods **N 22 Nov / S 12 Nov** (total 21 Oct–5 Jan) · Post Oak **central 10 Nov / S 11 Nov** (30 Sep–16 Jan) · Cross Timbers **N 15 Nov / S 17 Nov** (13 Oct–17 Dec) · Edwards Plateau **E 7 Nov / central 24 Nov / W 5 Dec** · Trans-Pecos **8 Dec** (4 Nov–4 Jan) · Gulf Prairies **N 30 Sep / S 31 Oct** (**24 Aug**–30 Nov) · South Texas Brush **E 16 Dec / W 24 Dec** (9 Nov–1 Feb) | 🟢 agency, 16 study sites, 2,436 does | [TPWD](https://tpwd.texas.gov/huntwild/hunt/planning/rut_whitetailed_deer/) |
| Florida, 4 disjunct herds (peer-reviewed) | 26–30.5°N | mean breeding: **Rotenberger (S) 10 Aug · Tosohatchee (central) 7 Oct · Camp Blanding (N) 2 Nov · Eglin AFB (NW) 22 Feb** — "as much as **6 months asynchronous** among herds", n = 380 tracts, 1978–1981 | 🟢 peer-reviewed fetal/tract data | [Richter & Labisky 1985, *JWM* 49:964–971](https://journals.flvc.org/edis/article/view/114365) |

**Richter & Labisky is the most important single citation in this section.** It
is peer-reviewed, it is conception-date data rather than an agency map, and it
contains the inversion outright: the **northernmost** Florida herd sampled has
the **latest** mean breeding date in the state. No latitude function of any
degree can fit four points where the extremes are 196 days apart and the sign
alternates.

**The finding that kills latitude, stated as sharply as the data allows.**
Pass 2's example was Texas Gulf (30 Sep) vs Mississippi (1 Jan) at similar
latitudes. The Carolinas make it worse, because they remove the "different
state, different genetics" hand-wave:

> **South Carolina peaks 30 October. Mississippi peaks 1 January.
> Both sit at ~33°N. That is 63 days apart at the same latitude**, and Georgia —
> geographically *between* them — has counties peaking in **late October** and
> other counties peaking in **December**, inside one state.

No function of latitude can produce that. Florida settles it: a single state
spans **six months** of zone mean-conception dates, from 22 July to 31 January —
and the peer-reviewed herd data show the span is **inverted** with respect to
latitude. The `319 + (40 − lat)·1.2` form is not merely mis-parameterised; it is
the wrong functional class, and no coefficient rescues it.

**Implementable shape — pass-4 revision, resolution-tiered and honest at each tier.**
```
peakBreedingDay(lat, lon, userCalibration) -> { doy, ci95Days, tier } | UNKNOWN

  T0  userCalibration present (>= 3 seasons of the user's own logged
      chasing/breeding observations)
        -> calibrated peak,          ci95 = +-4 d    conf 0.90   // Dye 2012
  T1  region polygon hit at county / unit / ecoregion / zone resolution
        -> agency mean conception,   ci95 = +-10 d   conf 0.55
  T2  region polygon hit at STATE resolution only, inside a state whose
      published within-state spread exceeds 30 d (AL, MS, LA, FL, TX, NC, GA)
        -> return the state's RANGE, never its midpoint,
           and mark the reading "regionally variable"   conf 0.25
  T3  lat >= 37 deg N and NOT inside any South/Coastal-Plain region polygon
        -> 314 (10 Nov),             ci95 = +-8 d    conf 0.70   // photoperiod
  T4  35 <= lat < 37 deg N, interior/upland only (TN, AR, E OK, KY plateau)
        -> 321 (17 Nov),             ci95 = +-12 d   conf 0.40
  T5  anything else below 37 deg N with no region match
        -> UNKNOWN. Do not return a date.
  T6  |lat| < 18 deg N
        -> UNKNOWN, permanently. Breeding is effectively aseasonal (see below).
```
Units: `doy` is day-of-year 1–365 with no leap adjustment (the model's existing
convention); `ci95Days` is a half-width in days; `conf` is the redefined
`rutConfidence` below. `southernHemisphere` continues to shift by 182 d and is
applied *after* tier selection.

**Why T2 exists and matters.** A state-level answer is not a weaker answer, it is
usually a *wrong* answer. Alabama's statewide "peak" is meaningless when
conception varies ≥ 60 days inside a single county and the state spans 13 Nov to
8 Feb. In those states the correct output is a **range with a label**, not a
midpoint. Returning "1 January" for all of Mississippi is precisely the
confidently-wrong failure `CLAUDE.md` forbids: it is right in the Delta and
seven weeks early on the coast.

Resolution the sources actually publish, so the polygon layer can be built to
match: **county** — GA (159), NC, AL, MS; **management unit / area** — NC (5
units), LA (10 areas); **ecoregion** — TX (7, with N/S/E/W splits inside
several); **zone** — FL; **state or region** — SC (3 physiographic regions), VA,
KY, TN (3 regions), AR, WV.

**Scope warning that must reach the UI.** Every row in both tables is an agency
or study estimate of a *population mean*, not a date deer breed on. The
dispersion is the story: SD **13.4 days** and mean range **46 days** among
individuals in Mississippi; **9–110 days** within a single Florida area; **≥ 60
days** within one Alabama county; **6 months** among four Florida herds. "Peak
rut is Tuesday" is not a claim any of these sources supports, and the interval
belongs next to the date, not in a tooltip.

#### Unread at source — the honest ledger for the next pass
`WebFetch` is blocked for every host and **`curl` to these hosts fails at CONNECT
with a proxy 403** (retested this pass against `georgiawildlife.com` and
`myfwc.com`; both returned `curl (56) CONNECT tunnel failed, response 403`). The
following are therefore **found but unread** — leads, not grades:

| Source | What is still needed | Why it matters |
|---|---|---|
| [GA DNR rut map PDF](https://georgiawildlife.com/sites/default/files/wrd/pdf/research/Georgia-Rut-Map.pdf) | 155 of 159 county rows | Only **Appling 11/03–11/09, Atkinson 10/20–10/26, Bacon 10/27–11/02** are confirmed — they appear in the PDF's own indexed title text. Clarke 11/10–11/16 came from a pass-3 snippet. **Secondary summaries of this map actively contradict each other**: one says coastal counties peak 10–20 Oct (earliest in the state), another says southern and coastal areas peak "late November or December". Do not code either. |
| [FWC statewide rut map PDF](https://myfwc.com/media/18766/statewide-rut-map.pdf) | the zone table and zone geometry | Florida is the widest-spread state in the register and the only one where the inversion is peer-reviewed. The FWC zones are the implementation surface; Richter & Labisky gives the four anchor points. |
| [NCWRC peak conception dates PDF](https://www.ncwildlife.gov/media/4373/download?attachment=) | per-county dates and per-county sample sizes | The agency itself warns precision varies with n. The 5 unit dates are confirmed in text; the county table is not. |
| KDFWR, TWRA, AGFC deer-program reports | primary fetal data behind the KY / TN / AR rows | Those three rows are 🟡 in the table above purely because they were seen only in secondary summary. |
| [Sumners et al. 2015](https://wildlife.onlinelibrary.wiley.com/doi/10.1002/jwmg.954) full text | which population pairs, and the mtDNA effect size | The mechanism row's 🔵 grade rests on an abstract. |

**A caveat on the Georgia rows specifically that must survive into
implementation.** The GA map's cells are the **peak week of deer–vehicle
collisions**, not conception dates. UGA and GA DNR validated DVC peak against
conception dates **in three counties** and found them "almost identical", and
against GPS hourly movement rates. That validation is real but it is n = 3
counties, so the GA rows are **🔵 inferred (DVC as a rut index)**, not 🟢
measured conception — and this is also the one dataset in the register where
"observable rut" and "mean conception" were found to coincide, which conflicts
with MDWFP's guidance below.
[SEAFWA method paper — using DVCs to map breeding activity in Georgia](https://seafwa.org/journal/2015/using-deer-vehicle-collisions-map-white-tailed-deer-breeding-activity-georgia) ·
[UGA Today — DVCs increase during breeding season](https://news.uga.edu/deer-vehicle-collisions-breeding-season-0915/)

### 🔵 Agency maps report **mean conception**, which is not the huntable peak — and the offset is disputed
The model treats `peakBreedingDayOfYear` as both *the conception mean* and *the
centre of the `PeakBreeding` phase*, and `calibrateOffset` hard-codes
`CHASING_CENTER = -6` days. Three sources measure the gap between mean
conception and peak observable rutting activity, and **they disagree by two
weeks**:

| Source | Offset of observable rut vs mean conception | Basis |
|---|---|---|
| MDWFP, on its own breeding-date map | **−14 d** ("subtract about two weeks from the mean conception date to obtain the simulated peak rut period") | agency guidance over 20 yr of health-check data |
| Hunsaker et al. 2025, SW Wisconsin | **−4 to −6 d** (movement rate topped out 4–8 Nov; conception-derived peak window 23 Oct – 12 Nov, 16 d long) | 188 GPS-collared males, 2017–2020 |
| GA DNR / UGA | **≈ 0 d** (DVC peak and conception peak "almost identical" in 3 counties) | DVC vs fetal aging |

[MDWFP breeding date map](https://www.mdwfp.com/wildlife-hunting/wildlife-species-program/deer-program/deer-breeding-date-map) ·
[Hunsaker et al. 2025, *Ecology and Evolution*](https://onlinelibrary.wiley.com/doi/full/10.1002/ece3.71589) ·
[SEAFWA — DVCs to map breeding activity](https://seafwa.org/journal/2015/using-deer-vehicle-collisions-map-white-tailed-deer-breeding-activity-georgia)

**Assessment.** Our `-6` sits inside the best-instrumented estimate (Wisconsin
GPS), so it is not wrong — but it is *not* settled, and the range **−14 … 0 d**
should be recorded rather than collapsed. Graded 🔵: the offset is measured
three times, by three methods, with no reconciliation. **Do not** silently
subtract 14 days from agency map values when seeding the region table — store
the agency figure as *mean conception* and apply the offset once, explicitly,
at the phase layer, so the two can be re-tuned independently.

### 🟢 The model has a southern edge: below ~14–18°N there is no rut to predict
The reproductive season of white-tailed deer is hypothesised to be **aseasonal
south of about 14–18°N**, where annual variation in day length is small. A test
in a seasonally dry tropical forest in **Costa Rica** found year-round
reproduction, with the relative frequency of reproductive indicators driven by
**rainfall** rather than photoperiod — most births in the dry season, a second
peak late in the wet season.
[Reproduction of white-tailed deer in a seasonally dry tropical forest of Costa Rica: a test of aseasonality, *J. Mammalogy* 2020, 101(1):241](https://academic.oup.com/jmammal/article-abstract/101/1/241/5655750)

`Odocoileus virginianus` ranges to Bolivia and Peru, so this is a real boundary
for a product that takes an arbitrary latitude. **Prescription:** `|lat| < 18°N`
returns UNKNOWN unconditionally with the note *"breeding is effectively
aseasonal at this latitude; rut phase is not defined"*. Currently the model
happily returns `326 + (34 − lat)·3.5`, which at 10°N yields DOY 410 — i.e. it
wraps to mid-February and reports a phase with confidence 0.2.

### 🔵 The `southernHemisphere` 182-day shift is roughly right
Introduced whitetail on **Stewart Island / Rees Valley, New Zealand** (~45–47°S,
liberated 1905) rut **mid-April to early June**, with most fawns born
December–January. Shifting DOY 314 by 182 days gives DOY 131 = **11 May**, which
sits mid-window. Finland's introduced herd (~61°N) is reported to breed
October–November, consistent with the northern constant.
[NZ DOC — white-tailed deer hunting](https://www.doc.govt.nz/parks-and-recreation/things-to-do/hunting/what-to-hunt/deer/white-tail-deer/) ·
[NDA — the strange story behind Finland's white-tailed deer](https://deerassociation.com/the-strange-story-behind-finlands-white-tailed-deer/)

**Assessment:** 🔵 — the shift is a defensible inference from the short-day
breeder mechanism plus two introduced-range observations, neither of which is a
conception-date study. The southern-hemisphere branch should carry
`conf ≤ 0.40` and the note *"introduced range, no conception-date data"*.

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

### 🔴 Peak breeding is the *worst* week to sit (lockdown) — **downgraded from 🟡; GPS data contradicts it**
Pass 2 recorded this as strong consistent doctrine with no measurement. Pass 3
found measurement, and **it points the other way.** Doctrine that has been
tested and failed is not 🟡 doctrine any more; it is a folk claim with
contrary evidence, which is 🔴.

- Fine-scale GPS work on Pennsylvania bucks (15-minute fixes, Oct–Dec) found
  **no evidence of either an "October lull" or a peak-rut lockdown**; during
  peak rut the collared deer were "all over the place."
  [National Deer Association — Is the "lockdown phase" a myth?](https://deerassociation.com/lockdown-phase-myth/)
  **n = 3 bucks, one year, one state.** That is a weak study and it is cited
  here as a *direction*, not a refutation.
- Independently: as the rut progresses, buck **movements increase**, and
  **daytime buck activity increases through the entire breeding period**
  relative to the rest of the year.
  [Boone and Crockett — buck movements during the rut](https://www.boone-crockett.org/white-tailed-deer-buck-movements-during-rut) ·
  [Boone and Crockett — in search of receptive does](https://www.boone-crockett.org/search-receptive-does-what-buck-movements-reveal)
- The mechanism doctrine invokes is real but **short**: a tending bond lasts
  roughly **24 hours**, matching the 24–30 h oestrus below. Individual bucks are
  therefore unavailable in rotation, not the population at once — which produces
  no population-level movement trough.

**Assessment.** The doctrine's premise (bucks tend does) is sound; its inference
(therefore the woods go quiet at peak breeding) does not survive contact with
collar data. `PHASE_NOTES` currently tells the user peak rut may be the worst
week to sit. **That should be softened to record the disagreement rather than
assert either side**, because the evidence is genuinely split: hunters observe
reduced *sightings*, collars measure increased *movement*, and both can be true
if bucks move more but predictably less past known stands. Do not present it as
settled in either direction.

### 🔵 Second-rut window — **the 28-day anchor is now sourced** *(was unverified)*
Pass 2 flagged that `SecondRut` (+24 to +38 d) presumably rests on the doe
oestrous cycle and had not been verified. Verified:

- **Oestrous cycle length: 25–28 days** in white-tailed deer.
- **Oestrus duration: ~24–30 hours**, with ovulation 12–14 h after the end of
  oestrus.
- An unbred doe continues to cycle — **5 to 10 cycles per season (8.06 ± 0.35)**
  in cervids, spanning 105–249 days from first to last.

[Reproductive anatomy and physiology of whitetail deer, Society for
Theriogenology 2011](https://cdn.ymaws.com/www.therio.org/resource/collection/264BC339-D6A8-4DB8-B542-0E9E776570FB/2011_v4_017.pdf) ·
[Reproductive cycles in female cervids](https://veteriankey.com/reproductive-cycles-in-female-cervids/) ·
[Reproductive management in white-tailed deer, *Agroproductividad*](https://revista-agroproductividad.org/index.php/agroproductividad/en/article/download/2063/1687/8266)

**Consequence for the parameter.** A 25–28 day cycle implies a second-rut peak
at **+25 to +28 days**, not a window centred on +31. Our `+24 to +38` is skewed
late by about a week and runs ~4 days past even the widest cycle length.
**Recommended:** `SecondRut = +24 … +31 d`, peak +27. 🔵 rather than 🟢 because
the cycle length is measured but "second rut" as an observable hunting
phenomenon is the doctrine layer on top of it — and note the cycling data above
implies a *third* and *fourth* recurrence too, which nobody hunts, so the
phenomenon's practical size is unmeasured.

### 🔴 The other phase window day counts (seeking −21…−10 d, chasing −10…−2 d, lockdown …)
Our own partition of a continuous process. Ordering is doctrine; the day counts
are invented. **Re-searched; still no source** giving durations for seeking or
chasing. The only durations anyone measures are the two physiological ones now
recorded above — oestrus 24–30 h and the tending bond ~24 h — and neither sets
a multi-day phase boundary. Everything except `SecondRut` stays 🔴.

**Queries:** `white-tailed deer rut seeking chasing tending lockdown duration
days GPS collar breeding chronology phases` · `National Deer Association
lockdown phase myth GPS collar buck movement` · `white-tailed deer estrous cycle
length days estrus duration recurrence peer reviewed`.

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

### 🔴 Pressure-trend band cutpoints (±1, ±3 hPa) — **re-attacked; stays 🔴**
Invented. Re-searched for a pressure *tendency magnitude* tied to deer activity.
**Still no peer-reviewed source.** Every numeric threshold that exists traces to
hunting media, and they are worth recording only so nobody mistakes them for
science later:

- "greatest activity with rapid pressure drops of **4 to 5 tenths of an inch**"
  (≈ **13.5–17 hPa** — an enormous change, roughly a strong frontal passage);
- "greatest feeding between **29.80 and 30.29 inHg**" attributed to an Illinois
  biologist, and the familiar 29.90–30.30 inHg band.

[Mossy Oak — barometric pressure's influence](https://www.mossyoak.com/our-obsession/blogs/deer/barometric-pressures-influence-on-whitetail-movement-4) ·
[MeatEater — does barometric pressure affect deer movement?](https://www.themeateater.com/wired-to-hunt/whitetail-hunting/does-barometric-pressure-affect-deer-movement)

🟡 Doctrine at best, and note the internal problem: **13.5–17 hPa is an order of
magnitude above our ±3 hPa "strong" cutpoint.** If the doctrine were right, our
bands would be firing "strong" on changes the doctrine considers negligible. We
cannot both be right, and neither of us has a measurement.

Against that, the peer-reviewed picture is a null-to-scattered one: a Mississippi
State GPS analysis found no general weather pattern except that **temperature
mattered more than any other variable**, and another study found **no
correlation between hourly male activity and temperature or barometric
pressure** at all.

**Recommended:** keep the bands as a display convenience, never above a 🔴 chip,
and consider whether surfacing pressure at all is defensible when the same
literature says temperature dominates and we do not show it (see the row above).

**Queries:** `deer activity barometric pressure change hPa threshold movement
increase study magnitude` · `barometric pressure tendency deer movement
peer-reviewed` · plus pass 2's Webb/Goethlich queries.

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
| 4 | Resolve the bedding contradiction: bench geometry (gentle pad, steep ring) instead of a 22° single-cell Gaussian. **Pass 3 resolved the direction — the pad side wins, so this is a re-centring, not a rewrite.** Interim if unimplemented: `idealSlopeDeg 22 → 12`, `slopeToleranceDeg 14 → 10` | 🔴 → 🟡 | new |
| 5 | Surface `Confidence` chips on bedding, thermal, scent and rut outputs — four of the five headline layers are 🔴-driven | — | `N10` |
| 6 | Make the scent cone stability-dependent, and fix the inversion (the night/thermal cone is currently the *widest*) | 🔴 → 🔵 | `N11` |
| 7 | Add a snow term to the cost surface (Parker 1984; Sullender 2023) — the largest missing physical driver | none → 🟢 | new |
| 8 | Add temperature as a first-class covariate; it explains ~55 % of movement variation and we show pressure instead | none → 🟢 | new |
| 9 | Narrow the product claim to white-tailed deer, or scope per species per the transfer table | 🔴 → 🟡 | `N13` |
| 10 | Handle the ~⅓ of bucks that are mobile rather than resident | — | `N12` |
| 11 | Obtain NLCD resistance values from Lilly et al. 2025 rather than inventing them | 🔴 → 🔵 | `I4` |
| 12 | Label every layer with the region its evidence comes from; nothing is validated in the Appalachians | — | new |
| 13 | Obtain GPS-collar data to settle bedding geometry, corridor use and shelter | 🔴 → 🟢 | `I3` |
| 14 | **Ship the region → peak-breeding lookup** from the eight-row agency table above; read the GA county and FL zone PDFs at source before implementing | 🔴 → 🟢 | new, blocks 3 |
| 15 | **`transitionMinutes` → `{ morning: 110, evening: 35 }`, forward-offset not centred.** Cheapest measured correction in the register | 🔴 → 🟢 | new |
| 16 | **Fix the slope double-count in `beddingLikelihood`.** `slopeTerm × coverTerm(TRI)` counts slope twice because TRI is slope-correlated; swap TRI for Sappington VRM at a coarser window | 🔴 → 🔵 | new |
| 17 | Set the terrain-shelter upwind search radius to **500 m** (measured optimum for distance-limited TOPEX) | 🔴 → 🔵 | new |
| 18 | Add a season/temperature-weighted **solar-aspect** term to bedding; leeward-only points at the deepest snow on a south wind in January | none → 🟡 | new |
| 19 | `SecondRut` window `+24…+38 d` → **`+24…+31 d`**, peak +27, from the 25–28 d oestrous cycle | 🔴 → 🔵 | new |
| 20 | Soften the `PHASE_NOTES` lockdown claim to record the sightings-vs-movement disagreement rather than assert it | 🟡 → 🔴 | new |

Item 13 would resolve more red rows than everything else combined. Items 2 and 3
are corrections to things we currently state confidently and wrongly, and should
go first. Items 14–17 and 19 are the pass-3 additions that come with a number
attached and are therefore the cheapest to land.

---

## Pass-3 changelog

| Row | Before | After | Why |
|---|---|---|---|
| `idealSlopeDeg: 22` | 🔴 "settled, no literature" | 🟡 with a recommended value of **12°** | BC WHR 10–45 % band + Rowland 2018 monotone slope response + convergent flat-pad doctrine |
| Bedding vs bench contradiction | open, direction unknown | **resolved in favour of the gentle pad** | nothing found supports a slope *optimum* for any cervid |
| Thermal transition window | 🔴 guessed 90/30 min | 🟢 **measured 110/35 min**, forward-offset | El Gdachi et al. 2024 + two corroborating studies |
| Cover term `ruggedness / 4 m` | 🔴 "invented, no literature" | concept 🔵, index choice 🔵, constant 🔴 — **plus a slope double-count defect** | Riley 1999 design intent; Sappington 2007 VRM |
| Terrain shelter radius | not registered | 🔵 **500 m** | distance-limited TOPEX tested against 7 radii |
| `SecondRut` +24…+38 d | unverified | 🔵 **+24…+31 d** | oestrous cycle 25–28 d, sourced |
| Warm-aspect winter selection | not registered | 🟡, and it **conflicts with our leeward-only aspect term** | four agencies + measured 18 vs 42 cm snow by aspect |
| Rut region lookup | "recommended, no data" | 🟢 **eight-row seed table** | SCDNR, GA DNR, MDWFP, TPWD, FWC, Turner 2019 |
| Lockdown doctrine | 🟡 | 🔴 | GPS collar data contradicts it |
| `impassableSlopeDeg: 55` | 🔴 | 🔴 **(with reason)** | the cervid slope literature has no thresholds at all, by construction |
| Scent-detection distance | 🔴 | 🔴 **(with reason)** | only anatomy is measurable; the media metre-values have no primary source |
| Pressure cutpoints | 🔴 | 🔴 **(with reason)** | doctrine's own threshold is ~5× ours; neither is measured |
