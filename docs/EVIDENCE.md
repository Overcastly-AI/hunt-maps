# Evidence register

Every biological parameter the models encode, with the evidence behind it.
Owned by [`game-biologist`](../.claude/agents/game-biologist.md).

## Why this file exists

The engine is full of numbers that look authoritative. `idealSlopeDeg: 22`.
`minSurroundSlopeDeg: 18`. A Tobler hiking function fitted to _humans_ deciding
how a _deer_ routes. Each one renders a confident colour on a map somebody uses
to decide where to sit before daylight.

`terrain-scientist` verifies those numbers are applied correctly.
`analytics-auditor` verifies the statistics are honest. Until this register
existed, **nothing checked whether a whitetail actually beds at 22°.**

An `Assumed` grade is not a failure. Hiding one is.

## Grades

| Grade           | Means                                                                                   |
| --------------- | --------------------------------------------------------------------------------------- |
| 🟢 **Measured** | Direct empirical measurement in peer-reviewed work on this or a closely related species |
| 🔵 **Inferred** | Derived from measured findings by stated reasoning                                      |
| 🟡 **Doctrine** | Consistent, widely-reported field practice; no measurement behind it                    |
| 🔴 **Assumed**  | A number chosen because the code needed one                                             |

**Current state (white-tailed deer): 14 Measured · 13 Inferred · 10 Doctrine ·
29 Assumed.**
_(Pass 5: 14 · 12 · 9 · 28. Pass 4: 14 · 10 · 9 · 18. Pass 3: 12 · 6 · 9 · 17.
Pass 2: 10 · 5 · 8 · 18.)_

> ## ⚠️ Read this before using any layer for elk or in western mountains
>
> **Every grade in this register above the pass-7 section is a
> _white-tailed deer_ grade.** Pass 7 re-graded the same parameters for **elk
> (_Cervus canadensis_) in steep western terrain**, prompted by a real hunt in
> **Montana HD 320, the Tobacco Root Mountains**, and the answer is different
> almost everywhere. **For elk, the bedding layer and the corridor layer should
> be greyed out, and the rut model should refuse rather than answer.**
>
> Elk state: **6 Measured · 2 Inferred · 1 Doctrine · 16 Assumed/inapplicable**,
> and three of the six 🟢 rows are measurements of things the engine **does not
> have** (distance to motorized route, elevational migration, forage).
>
> Jump to **[Pass 7 — Elk in steep western terrain](#pass-7--elk-in-steep-western-terrain-montana-hd-320-tobacco-root-mtns)**.

**Pass 6 was a single-topic pass: the two bedding _floors_** — `shelterTerm =
0.25 + 0.75·s` and `coverTerm = 0.4 + 0.6·c` — plus the constants `R40` added.
Both floors stay 🔴 **Assumed** and that is the finding, stated plainly: **they
are unfalsifiable guesses that nonetheless decide the layer's output**, because
a floor is the whole statement of how much a missing requirement costs. What
changed is that they are no longer unfalsifiable _in principle_: `1/floor` is the
best-vs-worst **selection ratio** the engine asserts (cover **2.5×**, shelter
**4×**), a quantity `packages/shared` already computes. Three new findings sit
under Bedding — the never-chosen ordering between them, a contrary measured
result on thermal cover (Cook et al. 1998), and a shape problem in the cover term
that contradicts Ridgeline's own leeward rationale.

**The 🔴 count rose by ten and that is the most honest thing in this pass.**
Nine of those ten are not new guesses — they are constants that shipped last
night inside `R11`/`R21`/`R22` and had never been written down. The register did
not get worse; it got accurate. The tenth, `DEFAULT_RING_RADIUS_CELLS = 8`, was
not named in any backlog row either and was found by reading the source.

Pass 2 wrote one row per number and retracted two citations. Pass 3 reopened
every row pass 2 had closed as a settled negative and worked them with search
rather than with memory. Four rows moved up, one negative result was overturned
outright, and the rows that stayed 🔴 now carry the query list that justifies
them.

**Pass 5 was a single-topic pass: `R31`, shelter versus solar aspect in severe
cold**, plus registration of the ten ungraded bedding constants. Its two most
useful outputs are both negative: **this register had been quoting a mean
against a maximum** and inflating the aspect mechanism ~2×, and **no study
exists relating whitetail bed selection to a topographic wind-exposure index**,
which leaves the term that decides the layer's winter answer uncalibrated. The
verdict on `R31` is that the row is right that the behaviour is wrong, and wrong
about why — see its section under Bedding.

**Pass 4 was a single-topic pass: `R9`, rut regionalisation.** It scored the
shipped `peakBreedingDayOfYear` against **40 published regional peaks**, found
the mechanism paper behind southern heterogeneity, **corrected an overclaim this
register itself had made** about restocking genetics, and added seven rows
(🟢 +2, 🔵 +4, 🔴 +1). The 🔴 it added is the most useful thing in it:
`rutConfidence` returns a number that is not the probability of anything.

> **Reading conditions.**
>
> - `WebFetch` is **blocked at the egress gateway for every host**, verified
>   against PubMed, PLOS, Springer, Wiley, `fs.usda.gov`, `a100.gov.bc.ca` and
>   Wikipedia. A 403 from it says nothing about the source. Do not spend a pass
>   fighting it.
> - `WebSearch` **works and is the instrument that matters.** It returns
>   substantive abstract- and body-level content, not just links, including from
>   open agency PDFs it has indexed.
> - **`curl` to non-GitHub hosts fails at CONNECT with a proxy 403**, retested in
>   pass 4 against `georgiawildlife.com` and `myfwc.com`
>   (`curl (56) CONNECT tunnel failed, response 403`). Open agency PDFs are
>   therefore reachable **only** through whatever `WebSearch` has indexed of
>   their text — which for the GA rut map is the first three county rows of the
>   table, embedded in the result title. Mine the snippets; do not fabricate the
>   rest.
> - **No full text was read in any pass so far.** Rows that would change
>   behaviour are marked _(abstract/index only — verify against full text before
>   implementing)_. Pass 4 keeps an explicit **"unread at source" ledger** in the
>   rut section so the next pass knows exactly which five documents to attack
>   first if the egress situation changes.
>
> **Correction to pass 2, recorded because it cost a parameter.** Pass 2 closed
> `idealSlopeDeg` with the words _"no literature exists … recording that
> definitively so nobody searches it again."_ That was wrong — not in its
> narrow claim, which survives, but in telling the next pass to stop. Two
> further queries surfaced an explicit agency slope band and a peer-reviewed
> measurement of the functional form. **A negative result that closes a
> question must ship the query list that earned it.** Every 🔴 row below now
> does.

---

## Locomotion and movement cost

### 🔵 Anisotropic travel cost — `corridor/cost.ts`

**Claim:** movement cost depends on grade _along the direction of travel_, not
on slope alone.

**Evidence:** biologging across six mountain-ungulate species in the French
Alps found animals **travel obliquely so the angle any individual experiences is
lower than the angle of the topography**, and that models of cost-of-transport
(VeDBA proxy) against slope differ by species and habitat type, with most
species slowing on steeper inclines.
[Steep slopes, shallow angles — _Can. J. Zool._ 2024/25](https://cdnsciencepub.com/doi/10.1139/cjz-2024-0095)

**Assessment:** still the best-supported modelling decision in the engine. The
finding is measured; using it to justify an anisotropic cost surface is our
inference, so this stays 🔵. **Scope:** alpine ungulates (chamois, ibex, mouflon,
red deer, roe deer), not whitetail. The mechanism — route to manage experienced
grade — is not species-specific.

### 🔴 `toblerSpeed()` — Tobler's hiking function _(downgraded from 🔵)_

**Current:** `6 · exp(−3.5 · |grade + 0.05|)`.

**Why this is now red, not blue.** The previous pass graded this 🔵 on the
argument that "Tobler's _shape_ — peak at a slight downhill, steep uphill
penalty — is defensible for any large terrestrial walker." **The ruminant
treadmill data contradicts the peak.** Granadina goats walked at −10, −5, 0, +5
and +10 % grades and cost fell _monotonically_ across the whole negative range:
**1.91, 2.33, 3.35, 4.68, 6.44 J·kg⁻¹·m⁻¹** respectively.
[Lachica, Prieto & Aguilera 1997, _Br. J. Nutr._](https://pubmed.ncbi.nlm.nih.gov/9059231/)
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
descending, which is the _entire_ signal a deer corridor model needs. At +45 %
the divergence is worse in the other direction: Tobler charges **33× flat**
against ~8× from the cervid energetics, so it over-penalises steep climbs by
about 4×.

**Action:** `BACKLOG N8` — replace. Parameterised curve given in the next four
rows.

### 🟢 Cervid horizontal locomotion cost `C₀ = 2.6 J·kg⁻¹·m⁻¹`

Net cost of horizontal locomotion above standing, red deer treadmill, measured
at 7° and 14° gradients across 44–173 m·min⁻¹.
[Brockway & Gessaman 1977, _Q. J. Exp. Physiol._](https://pubmed.ncbi.nlm.nih.gov/243923/)

Cross-check: barren-ground caribou net cost of locomotion was
0.068–0.095 mL O₂·g⁻¹·km⁻¹ — **the lowest of any terrestrial species measured** —
which at 20.1 J·mL⁻¹ O₂ is **1.4–1.9 J·kg⁻¹·m⁻¹**.
[Fancy & White 1987, _Can. J. Zool._ 65](https://cdnsciencepub.com/doi/10.1139/z87-018)
Goats (35 kg) measured 3.35 J·kg⁻¹·m⁻¹, and the incline-running literature
confirms horizontal cost **decreases as a regular function of body mass**.
[Body mass and the energy efficiency of locomotion](https://pubmed.ncbi.nlm.nih.gov/17161970/)

**Recommended value:** `C₀ = 2.6 J·kg⁻¹·m⁻¹`, uncertainty **1.9–3.4**.
Only the _ratio_ to the grade terms matters for a cost surface, so absolute
calibration is not load-bearing.

### 🔵 Ascent coefficient `k_up = 26 J·kg⁻¹ per vertical metre`

Two independent ruminant measurements bracket a 70 kg whitetail:

| Species               | Mass    | Cost to raise 1 kg 1 vertical m | Implied efficiency |
| --------------------- | ------- | ------------------------------- | ------------------ |
| Barren-ground caribou | ~100 kg | **23 J**                        | 43 %               |
| Granadina goat        | 35 kg   | **31.7 J**                      | 30.9 %             |

[Fancy & White 1987](https://cdnsciencepub.com/doi/10.1139/z87-018) ·
[Lachica et al. 1997](https://pubmed.ncbi.nlm.nih.gov/9059231/)

Both are internally consistent: mechanical work is _mgh_ = 9.81 J·kg⁻¹·m⁻¹, and
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

### 🔵 Descent coefficient `k_dn = 8 J·kg⁻¹ per vertical metre` (a _saving_)

Caribou **recovered 6 J·kg⁻¹ per vertical metre** descending, efficiency 62 %.
Goats recovered **13.2 J·kg⁻¹ per vertical metre**.
Same body-mass ordering, same sources. Log-mass interpolation to 70 kg gives
**8 J·kg⁻¹ per vertical m**, uncertainty **6–13**.

Independent support for the direction: downhill efficiency **decreases with body
size** across species — humans run faster downhill, horses run _slower_ downhill
because of forelimb weight-support limits
([incline-running review](https://pubmed.ncbi.nlm.nih.gov/17161970/)). Deer sit
between. The goat data also shows marginal recovery _shrinking_ with steepness
(20.4 J per vertical m from 0→−5 %, only 8.4 J from −5→−10 %), so a single
linear coefficient over-credits steep descent.

### 🔴 Downhill floor `R_min = 0.55`

**Unsupported, and the single weakest part of the replacement curve.** Measured
ruminant descent data stops at **−10 % grade**. A linear saving of 8 J per
vertical m drives cost _negative_ at about −40 % grade, which is nonsense, so a
floor is structurally required and no cervid measurement sets it. The general
locomotion literature puts downhill mechanical efficiency at **−1.06 to −1.21**
below about −15 % grade (cost keeps falling), with eccentric/braking cost rising
again at extreme declines — but there is no ruminant number for where.

**Principled choice, still 🔴:** set `R_min = 0.55`, which is approximately the
deepest discount ever _measured_ in a ruminant (goat, −10 %, 0.57× flat). The
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

| grade  | angle  | **R(s)** proposed | R(s) Tobler today¹ | goat, *measured*² |
| ------ | ------ | ----------------- | ------------------ | ----------------- |
| +100 % | 45°    | 8.07              | 33.12              | —                 |
| +58 %  | 30°    | 6.00              | 7.55               | —                 |
| +36 %  | 20°    | 4.42              | 3.57               | —                 |
| +20 %  | 11.3°  | 2.96              | 2.01               | —                 |
| +10 %  | 5.7°   | **2.00**          | 1.42               | **1.92**          |
| +5 %   | 2.9°   | 1.50              | 1.19               | **1.40**          |
| 0      | 0°     | 1.00              | 1.00               | **1.00**          |
| −5 %   | −2.9°  | 0.85              | 0.84               | **0.70**          |
| −10 %  | −5.7°  | **0.69**          | 1.00               | **0.57**          |
| −20 %  | −11.3° | 0.55 (floor)      | 1.42               | —                 |
| −36 %  | −20°   | 0.55 (floor)      | 2.52               | —                 |

¹ Normalised to its own flat-ground cost, so the columns are comparable.
² Ratios computed from the five Lachica et al. grade points
(1.91 / 2.33 / 3.35 / 4.68 / 6.44 J·kg⁻¹·m⁻¹ ÷ the level value 3.35).

The proposed curve tracks the measured ruminant ratios to within ~7 % uphill and
is ~20 % _conservative_ downhill (it credits less saving than the goat measured,
which is the safe direction). Tobler over-charges a −10 % descent by 75 % and,
past its −5 % peak, gets the direction of the descent effect backwards.

**Dimensionless sanity check for the implementer.** What the cost surface
actually consumes is the ratios `k/C₀`, and both source species agree closely on
the downhill one:

|                           | `k_up / C₀` | `k_dn / C₀` |
| ------------------------- | ----------- | ----------- |
| Caribou (~100 kg)         | 13.9        | 3.64        |
| Goat (35 kg)              | 9.5         | 3.94        |
| **Proposed (70 kg deer)** | **10.0**    | **3.08**    |

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
an allometric bridge. It is a _body-mass_ model, so it transfers to mule deer
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
[Testing least cost path models — _PLOS One_ 2020](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0239387)

Worse, it is _another human locomotion model_ — citing it inside a deer cost
surface compounds exactly the error `N8` exists to fix.

**"Escape terrain" is also the wrong concept for whitetail.** It is a
mountain-sheep term for steep rocky ground used to evade predators, and where it
is quantified it is far steeper than 10 %: desert bighorn ewes and rams
**preferred the steepest slopes available, 40–79 %**, with ~60 % typical.
[Desert bighorn landscape resistance — _PLOS One_ 2017](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0176960) ·
[Borderlands Research Institute — Bighorn use of escape cover](https://bri.sulross.edu/big-game/use-of-escape-cover/)
Whitetail escape into **cover**, not onto cliffs. Nothing here transfers.

**Action:** `BACKLOG N9` should be **closed as not-supported**, not implemented.
If we still want moderate slope to facilitate movement, the defensible route is
the anisotropic sidehill effect already in the engine (oblique travel lowers
experienced grade), not a slope-threshold bonus.

### 🔴 `impassableSlopeDeg: 55` — **re-attacked; stays 🔴, and now for a stated reason**

Re-searched with agency and habitat-model documents explicitly in scope. Still
**no source reports a gradient a cervid will not cross.** What pass 3 adds is
_why_ that is not an accident:

- The cervid slope literature is **continuous and monotone, not thresholded.**
  Rowland et al. 2018 report a per-percent decline in use (−5.3 % per percent of
  slope) with no breakpoint; reindeer step-selection work carries slope and
  slope² as continuous terms rather than a cutoff. Nobody fits a refusal because
  nobody observes one.
- Where secondary reporting does give a ceiling it is a **use** ceiling, well
  below 55°: elk use "declining above 40 % and few above 60 %" — 60 % is 31°.
- The only hard slope preferences in ungulate work run the _other_ way: desert
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
[Hanberry & Hanberry 2021, USFS/_Ecol. Evol._](https://www.fs.usda.gov/rm/pubs_journals/2021/rmrs_2021_hanberry_b004.pdf)
That supports woody wetlands and forest being cheapest and developed classes
being most expensive. Density is not movement resistance, hence 🔵 not 🟢.

### 🔴 NLCD resistance **magnitudes**

Fifteen hand-picked multipliers (woody wetlands 0.85, row crops 2.8, developed
medium 40, …). Invented. Resistance surfaces are normally optimised against
telemetry or genetics and we have done neither.

A directly relevant precedent exists: a 2025 whitetail study reclassified NLCD
at 30 m into a resistance surface using published permeability values, then
validated the resulting connectivity maps.
[Lilly et al. 2025, _Landscape Ecology_](https://link.springer.com/article/10.1007/s10980-025-02101-4)
_(abstract only — the value table was not readable; obtaining it is the cheapest
possible fix for this row.)_

**Action:** `BACKLOG I4`. Note also that NLCD's 30 m grid misses the sub-canopy
structure — regen thickets, CRP edges, cutover — that matters more to deer than
the NLCD class does.

### 🟢 Snow cost — **measured, and entirely missing from the engine**

Net cost of locomotion **increases exponentially with sinking depth**
([Fancy & White 1987](https://cdnsciencepub.com/doi/10.1139/z87-018)), and the
canonical cervid parameterisation is
[Parker, Robbins & Hanley 1984, _J. Wildl. Manage._ 48:474–488](https://www.scienceopen.com/document?vid=498b669e-584f-4293-b795-4aa7d0c52caf)
for mule deer and elk. Recent work formalises which snow properties actually
gate ungulate movement (depth, density, penetrability).
[Sullender et al. 2023, _Oikos_](https://nsojournals.onlinelibrary.wiley.com/doi/full/10.1111/oik.09925)

**Assessment:** the cost surface has no snow term at all. For a late-season
northern-range user this is the largest missing physical driver in the corridor
model — larger than the Tobler substitution. It also interacts with land cover:
50 cm of fresh snow raised expenditure far more in clearcuts than under canopy.
**Action:** file as a new backlog item.

---

## Bedding

### 🟡 `idealSlopeDeg: 22` — ⚠️ **SUPERSEDED, kept as the record of why**

> **Pass 5 status note.** `idealSlopeDeg` and `slopeToleranceDeg` **no longer
> exist**: `R11` removed them from `BeddingOptions` and replaced the Gaussian
> with `1/(1+(s/12)²) × sigmoid((ringSlope−15)/4)`. The live parameters are
> registered under _Bedding-model parameters shipped by `R11`/`R21`/`R22`_
> below. Everything in this section remains the reasoning that justified the
> replacement and the evidence the new pad term is graded against — it is
> retained deliberately, because the next agent who wants to reintroduce a slope
> optimum needs to read why one was removed.

**What changed.** The narrow claim from pass 2 survives twenty-plus queries:
_no peer-reviewed study reports a preferred or mean bed-site slope angle for
white-tailed deer._ But pass 2 concluded from that that nothing constrains the
number. **Two source classes do**, and both put 22° at or above the top of the
plausible band rather than at its centre.

**1. An explicit agency slope band exists.** The British Columbia Wildlife
Habitat Ratings species account for _Odocoileus virginianus_ defines whitetail
winter range as areas of **10–45 % slope, with a south and/or west aspect**,
below 1500 m in shallow-to-moderate snowpack zones or below 1000 m in deep
snowpack zones.
[BC WHR — White-tailed Deer, _Odocoileus virginianus_](https://a100.gov.bc.ca/pub/acat/documents/r1535/whr_4162_modvi_1096575452158_68741ea2adba46dcb522d7a9f909273a.pdf) ·
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
[Rowland et al. 2018, _Wildlife Monographs_ 199:1–69](https://wildlife.onlinelibrary.wiley.com/doi/10.1002/wmon.1033) ·
[USFS PNW project page](https://research.fs.usda.gov/pnw/projects/westsideelknutritionandhabitatuse) ·
[Arc-Habcap expert evaluation, PNW-RP-479](https://www.srs.fs.usda.gov/pubs/rp/rp_pnw479.pdf)

That is _elk_, in _western Oregon and Washington_, describing _summer habitat
use_ rather than bedding — every one of those is a transfer this register is
supposed to state rather than smuggle. What it establishes is not a value for
whitetail bedding but a **shape**: the best-measured cervid slope response is
monotone-declining with no interior optimum. A Gaussian that _peaks_ at 22° and
falls away below it — telling the user a 10° shelf is worse bedding than a 22°
sidehill — is the one shape the measured evidence actively contradicts.

**3. The doctrine is unambiguous and it describes a flat pad**, which pass 2
inferred but did not evidence. Multiple independent field sources describe the
bed itself as level ground _within_ steep country: benches are "flat or gently
sloping areas", deer "prefer to bed almost exclusively on flat portions within
the changing topography", and "a flat spot on a steep hillside" is the classic
hill-country bed.
[Whitetail Habitat Solutions](https://www.whitetailhabitatsolutions.com/blog/where-does-a-buck-bed-top-10-spots) ·
[Whitetail Properties — terrain-specific tactics](https://www.whitetailproperties.com/knowledge-center/terrain-specific-deer-hunting-tactics-from-ridges-to-swamps) ·
[HuntStand — finding deer with topo maps](https://www.huntstand.com/fieldnotes/deer/how-to-find-deer-with-topo-maps/)
🟡 Doctrine, as it must be. But it is _consistent_ doctrine and it agrees with
the direction of both (1) and (2).

**Recommended replacement, and the uncertainty on it.**

|                     | Now | Recommended | Basis                                                                                              |
| ------------------- | --- | ----------- | -------------------------------------------------------------------------------------------------- |
| `idealSlopeDeg`     | 22  | **12**      | centre of BC WHR band (15°) pulled down toward the flat-pad doctrine and the monotone elk response |
| `slopeToleranceDeg` | 14  | **10**      | ±1σ then spans ~2–22°, covering the BC band's lower ¾                                              |

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

- Armstrong, Euler & Racey 1983, _J. Wildl. Manage._ 47:880–884 — day vs night
  winter beds, 45°13'N 78°22'W. Indexes for snow depth by aspect; whether it
  reports a slope angle is unknown.
- Mysterud 1996, _Wildl. Biol._ 2:193–198 — roe deer summer beds, Lier valley,
  Norway. Search returns canopy cover and herb availability as the results;
  **slope does not appear among them**, so this transfer candidate looks empty
  even before the species question.
- Uresk et al. 1999, _Great Basin Nat._ 59:348–352 — 259 fawn beds vs 301 random,
  Black Hills. 8 of 31 habitat variables significant; the 8 that index are all
  vegetation-structural (basal area, veg cover, veg height, canopy < 34 %).
  **No slope variable surfaces**, which is itself weak evidence that slope was
  not among the significant eight.
- Nova Scotia _Special Management Practices for White-tailed Deer_ and the
  Ontario stand-and-site forest management guide — both open PDFs, both index
  for aspect and softwood cover, **neither surfaced a slope threshold**.
- Maine IFW is explicit that the gap is real: limited use of _steep_ south-slope
  wintering areas occurs, but "their distributions and the conditions under
  which they are occupied are **poorly documented**."
  [Maine DWA guidelines](https://www.maine.gov/ifw/docs/DWA_Guidelines_2.4.10.pdf)

What the bed-site literature actually measures, and it is never the gradient:

- **Cover above the bed.** 140 bed sites vs 100 random: significantly more cover
  immediately above night beds than above random sites.
  [Lang & Gates 1985](https://www.originalwisdom.com/wp-content/uploads/bsk-pdf-manager/2019/04/Lang-and-Gates_1985_Selection-of-Sites-for-Winter-Night-Beds-by-White-tailed-Deer.pdf)
- **Snow depth by aspect and by topographic position.** ⚠️ **Pass 5 correction —
  this register previously split one study's numbers across two papers and
  mis-stated the effect size.** All three figures are Lang & Gates 1985's own
  study-area means: **bottomland 11.2 cm, SE-facing slope 18.1 cm, NE-facing
  slope 21.7 cm**; 42.0 cm was the _deepest depth recorded during the study_ on
  the NE slope, i.e. a maximum, not a mean. See the R31 verdict below — the
  consequence is material. Armstrong, Euler & Racey 1983, _J. Wildl. Manage._
  47:880–884 is a real and separate paper on day-vs-night winter beds in central
  Ontario
  ([PDF](https://www.originalwisdom.com/wp-content/uploads/bsk-pdf-manager/2019/04/Armstrong-et-al_1983_Winter-bed-site-selection-by-white-tailed-deer-in-central-Ontario.pdf) —
  server refused retrieval; **no numeric result from it has ever been read**, and
  the numbers previously attributed to it here were not its).
- **Site temperature and canopy closure** were the most influential attributes
  in mule deer bed-site selection across 236 day-beds, 152 forage sites and 439
  random locations. Slope and aspect entered the models but were not the
  drivers.
  [Germaine, Germaine & Boe 2004, _Wildl. Soc. Bull._ 32:554–564](https://www.esf.edu/biology/faculty/documents/Germaineetal2004muledeerdaybedsites.pdf)
- **Slope varies more than it selects.** Red deer resting sites (178 sites,
  7 dGPS collars): females used **steeper** slopes than males, variability in
  slope was higher at night, and **aspect did not vary** by month or between day
  and night.
  [Adrados et al. 2008, _Eur. J. Wildl. Res._ 54:487–494](https://link.springer.com/article/10.1007/s10344-008-0174-y)

Second transferable band, 🟡 doctrine: **elk are reported to favour 20–40 %
slopes for daily use with preference between 15–30 %, use declining above 40 %
and few above 60 %** — that is **8.5–22°**, centred well _below_ our 22°.
[American Hunter summary of Idaho/Montana work](https://www.americanhunter.org/content/the-right-elk-stuff/)
The primary sources (Thomas 1979 Ag. Handbook 553; Rumble et al. Black Hills
RSF) were not retrievable, so this is secondary reporting of a primary result —
doctrine grade until someone reads them.

**Three independent bands now agree on the centre and disagree with 22°:**

| Source                               | Class         | Band                           | In degrees | Centre    |
| ------------------------------------ | ------------- | ------------------------------ | ---------- | --------- |
| BC WHR whitetail winter range        | agency rating | 10–45 %                        | 5.7–24.2°  | **15°**   |
| Elk daily-use preference (secondary) | doctrine      | 15–30 %                        | 8.5–16.7°  | **12.5°** |
| Rowland 2018 elk summer use          | 🟢 measured   | monotone declining, no optimum | —          | **→ 0°**  |
| **Ridgeline today**                  | —             | Gaussian 22 ± 14°              | 8–36°      | **22°**   |

Every external band centres between **12° and 15°**. Ours centres at 22° and its
upper tail runs to 36°, which is beyond where the elk sources report use
essentially ceasing.

> ### The internal contradiction nobody has flagged
>
> `beddingLikelihood` peaks the slope term at **22°** on the bed cell itself.
> `detectBenches` defines a bench as a cell **≤ 8°** surrounded by ground
> **≥ 18°**. Both are described in the code as "where bucks bed", and the
> engine's own doctrine block for `beddingLikelihood` says the buck is on
> "the leeward side of a ridge, point, or **bench**".
>
> **They cannot both be right.** A deer lies down; a 22° lie is a steep place to
> spend eight hours, and every doctrine source describes the bed itself as a
> flat or gently sloping shelf, point or hub _embedded in_ steep ground. The
> physical requirement (a level pad) and the security requirement (steep,
> broken surrounds) apply to **different cells**.
>
> ### Pass 3 verdict: the gentle-pad side wins, so this is a re-centring, not a rewrite
>
> The founder asked specifically whether the literature supports a gentle _pad_
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
> **Nothing found in this pass supports a slope _optimum_ at any angle, for any
> cervid.** The contradiction therefore resolves in favour of `detectBenches`,
> and `beddingLikelihood`'s 22° peak is the side that is wrong. Practically
> that means **`detectBenches` keeps its geometry and `beddingLikelihood`
> adopts it** — the engine already computes the right thing in the wrong file.
>
> **Recommended reformulation** — and this is the highest-value change in the
> bedding model, larger than tuning 22°:
>
> ```
> slopeTerm = gauss(slope, ideal = 8°,  tol = 8°)      // the pad itself
>           × sigmoid(ringSlope, min = 15°)             // steep surrounds
> ```
>
> i.e. reuse the bench geometry `detectBenches` already computes instead of a
> single-cell Gaussian. The numbers stay 🟡/🔴 — but the _shape_ stops
> contradicting our own bench detector, the measured cervid slope response and
> every field description at once.
>
> Better still, drop the Gaussian on the pad entirely and use a **monotone
> decreasing** term, which is the only shape Rowland et al. measured:
>
> ```
> padTerm = 1 / (1 + (slope / 12°)²)          // 🟡 half-max at 12°, no optimum
> ringTerm = sigmoid(ringSlope, min = 15°)     // 🔴 steep surrounds
> slopeTerm = padTerm × ringTerm
> ```
>
> A Gaussian centred at 0° is _also_ monotone decreasing and would do; what must
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
winter deer range, which is a _solar_ criterion, not a _wind_ one:

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

And the mechanism is measured, not asserted — but ⚠️ **pass 5 found this
register had overstated it by roughly 2×, and had inverted its own conclusion.**

What Lang & Gates 1985 actually measured across their three study sites:

| Site                                                   | Mean snow depth | Ratio vs NE slope |
| ------------------------------------------------------ | --------------- | ----------------- |
| Bottomland (hemlock, low, sheltered)                   | **11.2 cm**     | 0.52              |
| SE-facing slope (the "warm aspect")                    | **18.1 cm**     | 0.83              |
| NE-facing slope (the "cold aspect")                    | **21.7 cm**     | 1.00              |
| NE-facing slope, _deepest single reading of the study_ | 42.0 cm         | —                 |

[Lang & Gates 1985](https://www.originalwisdom.com/wp-content/uploads/bsk-pdf-manager/2019/04/Lang-and-Gates_1985_Selection-of-Sites-for-Winter-Night-Beds-by-White-tailed-Deer.pdf)
_(figures quoted consistently by two independent searches of the paper's body
text; full text still unread — see reading conditions.)_

**Three corrections follow, and they matter:**

1. The previously-cited "18.1 vs 42.0 cm" compares **a mean against a maximum**.
   The like-for-like aspect effect is 18.1 vs 21.7 cm — a **3.6 cm, 1.20×**
   difference, not the 2.32× this register and `docs/BACKLOG.md` have been
   quoting.
2. In this study the **sheltered bottomland had the shallowest snow of all three
   sites** — 11.2 cm, a 10.5 cm advantage over the NE slope, **~3× larger than
   the aspect effect**. The paper cited here as the mechanism for "go to the sun
   slope" measured topographic position beating aspect on the very variable
   claimed as the mechanism.
3. That bottomland figure confounds aspect, canopy (hemlock), elevation and
   cold-air drainage, so it is **not** a clean topographic-shelter result either.
   The honest reading is that neither term dominates by the margin anyone here
   has been asserting.

The prescriptions themselves (four agencies, south/west aspects) are unaffected
and stand. What does not stand is the claim that a large measured snow-depth gap
justifies weighting aspect above shelter.

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
**Scope: winter, hemlock–northern hardwood, thermal motivation, and — added
pass 5 — _night_ beds specifically.** It supports "deer bed out of the wind"; it
does not support "deer bed leeward for scent".

⚠️ **It also does not calibrate `terrainShelter()`.** Lang & Gates measured wind
velocity _at bed sites_; they did not compute a topographic exposure index, and
this row must not be read as grading the engine's shelter term. Pass 5 searched
for a study relating whitetail bed selection to topographic wind exposure and
**found none** — see the `R31` section. The 🟢 here is for the criterion, not for
any number the engine uses to express it.

### 🟡 Leeward _aspect geometry_ — `cos(aspect − windFrom)`

The specific "bed on the leeward face to watch downwind and smell upwind"
geometry, and its scent-advantage rationale, are field doctrine — consistently
reported and internally coherent, with no measurement behind them.
[Whitetail Properties](https://www.whitetailproperties.com/knowledge-center/terrain-specific-deer-hunting-tactics-from-ridges-to-swamps) ·
[Whitetail Partners](https://www.whitetailpartners.com/post/mastering-topographic-maps-will-make-you-a-better-deer-hunter)

Corroborating direction from peer review: red deer daytime habitat selection
favours **denser cover, greater distance from trails and steeper slopes** —
i.e. daytime resting is a security decision, which is the same premise.
[Contrasting daytime habitat selection in wild red deer](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12355003/)

### 🔴 Terrain shelter: 30° upwind horizon = full shelter — _saturation still unsupported, but the search radius now has a measured value_

TOPEX ("topographic exposure") is the established forestry wind-exposure index
and works exactly as we do — exposure at a point from the **height and distance
of the surrounding horizon**, combined into an angle of inflection. So the
_method_ is sound and cited.
[Assessing topographic exposure, _Meteorol. Appl._](https://www.cambridge.org/core/journals/meteorological-applications/article/abs/assessing-topographic-exposure/89F72FFA2C33A084CE96D69E2A3541BB)

**The 30° saturation point remains ours and unsupported.** Searched; nothing in
the windthrow-hazard literature nominates a horizon angle above which shelter is
complete. Stays 🔴.

**But one adjacent parameter moved.** Distance-limited TOPEX was tested against
site windiness at **0.25, 0.5, 0.75, 1.0, 2.0, 3.0 and 10.0 km**, and a limit of
**0.5 km proved superior to all of the others**.
[Potential of distance-limited topex in the prediction of site windiness,
_Forestry_ 71:325](https://academic.oup.com/forestry/article-abstract/71/4/325/587495)
🔵 for the radius. Whatever upwind search distance `shelter` currently uses
should be checked against 500 m and, if it differs, changed — this is a measured
optimum for precisely the quantity we compute, and it is free.
_(abstract/index only.)_

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
  other methods tested", with VRM and slope then distinguishing _different_
  components of habitat.
  [Sappington, Longshore & Thompson 2007, _J. Wildl. Manage._ 71:1419](https://wildlife.onlinelibrary.wiley.com/doi/10.2193/2005-723)
  `beddingLikelihood` multiplies `slopeTerm × coverTerm(TRI)`. Because TRI
  carries slope inside it, that product **counts slope roughly twice** — a
  steep cell is rewarded once by the Gaussian and again through TRI. This is a
  modelling error independent of any constant, and it compounds the 22° problem
  rather than offsetting it.

**Recommended:** swap TRI for **VRM** in the cover term, evaluate it over a
coarser neighbourhood than 3×3, and re-derive the normalising constant against
the new index — `/ 4 m` is meaningless for VRM, which is dimensionless on 0–1.
Concept 🔵, index choice 🔵, constant 🔴.

**Standing caveat, unchanged:** a _terrain_ proxy is still standing in for
_vegetative_ concealment, which is what the bed-site literature actually
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

## `R31` — does shelter or solar aspect dominate the cold-season bed? _(pass 5)_

**The question as filed.** With `R22`'s season term live, `beddingLikelihood`
scores a leeward-shaded plane **0.0214** against a sun-facing exposed plane
**0.0114** at −12 °C. Aspect swings 1.7×, shelter swings 3.2×, so lee wins by
1.88×. `R31` asks whether the 0.25 shelter floor should rise, whether the aspect
weight should rise, or whether the balance is defensible.

### Verdict: the defect is real, but **the framing that produced it was wrong in three ways**, and the fix is much smaller than the row implies

**1. The evidence for "sun beats shelter" is genuinely split, and must be
recorded as split.** Two peer-reviewed whitetail studies, both northern, point
in opposite directions:

- **Colder → more open ground.** At all four sites, deer made greater _daytime_
  use (55 to > 80 % probability) of open vegetation at the **lowest** daily
  minimum temperatures; use of dense conifer _decreased_ as minimum temperature
  fell on the sites where cover was most available. The authors' own conclusion,
  near-verbatim: the thermal benefits to free-ranging cervids from increased
  daytime exposure to solar radiation in open areas "are likely of greater
  relative value to their energetic balance and fitness than the potential
  thermal benefits associated with dense cover, **particularly when ambient
  temperatures are coldest**." 🟢, Minnesota, female, 12 years, VHF + GPS.
  [PLOS One 2013](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0065368) ·
  [correction 2017](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0178964)
- **Colder → more thermal cover.** Whitetail on Anticosti Island adjusted
  within-home-range selection to thermal conditions: they **selected thermal
  cover during cold-stress periods**, and selection for open areas increased
  during _warmer_ periods. 🟢, Québec, adult females, two contrasted winters.
  [Courbin, Dussault, Veillette, Giroux & Côté 2017, _Behav. Ecol._ 28:1037–1046](https://academic.oup.com/beheco/article/28/4/1037/3745028)
  _(abstract-level only.)_

**Do not pick one.** Both are competent whitetail work in deep-snow range and
they disagree. Anything the engine does here is at best a defensible position
inside a live disagreement, and the `Confidence` chip must say so.

**2. Three of the four "shelter" citations do not support the engine's shelter
term, because they are about a different kind of shelter.** This is the error
that has been propagating.

| Source                            | What it actually prescribes                                                                                                        | Does it support a _terrain_ shelter term?                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Maine IFW DWA guidelines          | Primary Winter Shelter = **softwood crown closure ≥ 70 %**, stand height ≥ 35 ft; Secondary = 50–70 %                              | **No** — canopy closure, invisible to a DEM                            |
| UNH Extension _Good Forestry_ 6.9 | "Functional shelter is provided by softwood stands at least 35 feet tall with softwood crown closure between **65 to 70 percent**" | **No** — canopy                                                        |
| Lang & Gates 1985                 | Deer select night beds with decreased wind velocity, in hemlock bottomland                                                         | Partly — bottomland is topographic, but confounded with hemlock canopy |
| TOPEX / windthrow literature      | The method the engine implements                                                                                                   | Yes for the **method**; says nothing about deer                        |

[Maine DWA guidelines](https://www.maine.gov/ifw/docs/DWA_Guidelines_2.4.10.pdf) ·
[UNH Extension 6.9 Deer Wintering Areas](https://extension.unh.edu/goodforestry/html/6-9.htm)

**No study was found in this pass that measures whitetail winter bed selection
against a _topographic_ wind-exposure index.** That is a genuine negative
result, and it means `shelterTerm` — the term currently swinging 3.2× and
deciding the layer's winter answer — has **no species-specific empirical
calibration at all**. It is a sound method (TOPEX) measuring a quantity nobody
has related to deer beds. Queries run: `terrain sheltered site versus canopy
shelter ungulate winter bed thermal microclimate topographic position lee slope
measured wind` · `TOPEX topographic exposure wildlife habitat model deer winter
range wind shelter index validated` · `deer elk bed leeward slope wind direction
measured selection topographic shelter lee side telemetry study` · `white-tailed
deer GPS collar winter habitat selection topographic wind exposure index heat
load index Appalachian` · `deer use of cover increases with wind speed winter
habitat selection wind chill covariate ungulate GPS` · `deer wintering area
microclimate wind speed reduction percent conifer canopy versus open measured
meters per second`.

**3. The single agency source that speaks to _daytime_ beds says sun, and
Ridgeline's bedding layer is a daytime layer.** Every shelter-dominant citation
in this register is a **night-bed** study (Lang & Gates) or a whole-winter-range
prescription (Maine, UNH). The one source that separates the two:

> "Hardwood stands on south- to west-facing slopes are important for deer
> wintering areas. **During the day, deer often bed in these stands to be warmed
> by the sun's heat.**"
> — [UNH Extension 6.9](https://extension.unh.edu/goodforestry/html/6-9.htm) 🟡

A hunter sits over this layer during shooting light. Grading a daytime layer
against night-bed evidence is the scope error underneath `R31`.

### The magnitudes, so the weighting is not chosen by taste

Both effects have been quantified, and they are **the same order**:

| Effect                                                                                                 | Magnitude                                                                               | Grade | Scope                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Solar radiation reduces metabolic heat production                                                      | **29 % and 42 %** at 780 W·m⁻²; solar heat gain = 14–21 % of intercepted radiant energy | 🟢    | **Ground squirrels**, not cervids — [J. Exp. Biol. 198:1499 (1995)](https://journals.biologists.com/jeb/article-abstract/198/7/1499/6924/Effects-of-Solar-Radiation-and-Wind-Speed-on) |
| Sheltered topography reduces heat loss                                                                 | **~half**                                                                               | 🔵    | Red deer; _secondary reporting, primary unread_                                                                                                                                        |
| Full solar load used in cervid biophysical models                                                      | **400 W·m⁻²**                                                                           | 🟢    | [Parker & Gillingham 1990, _J. Range Manage._](https://web.unbc.ca/~parker/Pubs/Parker%20and%20Gillingham%201990%20J%20Range%20Manage.pdf)                                             |
| Wind at 15 m·s⁻¹ collapses the thermoneutral zone to 4–10 °C **"regardless of incident solar levels"** | wind swamps solar at gale strength                                                      | 🟢    | Parker & Gillingham 1990, mule deer _(abstract-level only)_                                                                                                                            |

**Neither dominates.** ~30–50 % versus ~50 % is parity within the uncertainty of
a cross-species transfer. A model that resolves this into a 1.88× win for either
face is claiming precision nobody has measured.

Two further physics findings that both cut _against_ a large shelter swing in
deep winter specifically:

- **Wind and solar are not separable, and the engine's multiplicative structure
  is right about that.** "Realistic estimates of wind chill cannot be obtained
  unless the effect of solar radiation is taken into account, and failure to
  include solar radiation results not only in omitting solar warming but also in
  omitting **the effects of wind in reducing that warming**." 🟢 (caribou-
  parameterised).
  [A windchill and solar radiation index for homeotherms, _J. Theor. Biol._ (1974)](https://www.sciencedirect.com/science/article/abs/pii/0022519374902070)
  _(abstract-level only.)_ `aspectTerm × shelterTerm` already encodes this
  interaction — **this is a point in the current model's favour and should not
  be refactored away.**
- **Thick winter pelage blunts wind's marginal effect.** "Forced convection has
  a more pronounced effect upon the insulation of **thin** pelages than on
  thicker pelages." A whitetail in December pelage is comparatively
  wind-resistant relative to the same deer in October. 🔵 for the direction;
  general mammalian pelage physics, not _Odocoileus_-specific.

### Concrete prescription

**Do NOT raise `BEDDING_MAX_SOLAR_ASPECT_WEIGHT` above 0.75.** Pushing it toward
1.0 says lee is irrelevant in winter, and Courbin 2017 measures whitetail
selecting thermal cover _during cold stress_. The lee term must not vanish.

**Do raise the shelter floor, on the ramp that already exists.** Ramp it with
`coldBlendWeight` so the model has exactly **one** cold ramp and the two cannot
drift apart:

```
shelterFloor(T) = 0.25 + (0.65 − 0.25) × coldBlendWeight(T) / 0.75
shelterTerm     = shelterFloor(T) + (1 − shelterFloor(T)) × clamp01(shelter[i])
```

| Property         | Value                                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Units**        | dimensionless multiplier on `beddingLikelihood`                                                                                                          |
| **Bounds**       | floor ∈ [0.25, 0.65]; `shelterTerm` ∈ [floor, 1.0]                                                                                                       |
| **Engages at**   | +5 °C (`BEDDING_COLD_ONSET_C`), where `coldBlendWeight` is 0 and the floor is exactly 0.25 — a **true no-op** on the warm path, matching `R22`'s pattern |
| **Saturates at** | −10 °C (`BEDDING_SEVERE_COLD_C`), floor 0.65                                                                                                             |
| **At −12 °C**    | shelter swing falls 3.2× → **1.47×**; aspect swing 1.7× is unchanged; the **sun face wins by ~1.15×**                                                    |

**Falsifiable target for the implementing agent.** Back-solving `R31`'s own
measurement (`shelterTerm` ratio 3.2 with floor 0.25 ⇒ the exposed plane carries
`shelter ≈ 0.083`), the same two planes at −12 °C with floor 0.65 should give:

| Plane               | Today            | Predicted after the fix                                                                     |
| ------------------- | ---------------- | ------------------------------------------------------------------------------------------- |
| Leeward, shaded     | 0.0214           | **0.0214** _(unchanged — a fully sheltered cell sits at `shelterTerm = 1.0` for any floor)_ |
| Sun-facing, exposed | 0.0114           | **≈ 0.0248**                                                                                |
| Ratio               | 1.88× **to lee** | **≈ 1.16× to sun**                                                                          |

If the leeward figure moves at all, the floor was applied to the wrong end of
the term. If the ratio lands above ~1.3×, the floor was set higher than this
register supports — that is an overclaim, not a better fix.

**The 1.15× is the point, and it should not be tuned upward.** The evidence
supports a _narrow_ reversal, not a decisive one. On a real sidehill — an SE
face on a NW wind in January — lee and sun co-vary and that face wins on both
terms decisively, which is the behaviour the four agencies describe. On the
pathological opposing-plane case `R31` measured, the honest answer is "these are
nearly equal, sun slightly ahead in daylight," and 1.15× says that.

**Grades of the prescription, stated separately because they differ:**

- **Direction** (floor rises with cold) — 🔵 **Inferred**: PLOS One 2013's
  measured increase in open-type daytime use as minimum temperature falls, plus
  the thick-pelage convection result, plus UNH 6.9 on daytime beds. Recorded
  against Courbin 2017, which disagrees.
- **Endpoints 0.25 and 0.65** — 🔴 **Assumed.** Chosen to put the shelter swing
  at parity with the measured aspect swing, because the physiology says the two
  effects are the same order. No source sets either number. **A build agent must
  not present this as a measured calibration.**
- **Ramp window** — inherits `coldBlendWeight`'s grades below.

### Three findings that must travel with the fix

1. **Sequence after `R27`, not before.** `slopeInsolation()` is the solar input
   and `castShadows()` is never called (`R27`, verified). A shaded bench
   currently reads as fully sunlit. **Raising the influence of the solar side of
   this trade while the solar field ignores terrain shadow amplifies an existing
   error** — the sun-face score would rise on ground that is in shade at 07:00.
   Land `R27` first.
2. **The engine has no wind speed, and this parameter is a wind-speed
   assumption in disguise.** `windSpeedKph` exists in `packages/shared`
   (`domain.ts:154`) and never reaches `beddingLikelihood`, which takes only
   `windFromDeg`. Parker & Gillingham's "regardless of incident solar levels" at
   15 m·s⁻¹ versus near-irrelevance in calm air means the correct shelter
   weighting **spans the whole plausible range depending on a variable we do not
   read**. Any fixed floor — 0.25 or 0.65 — silently assumes one wind speed for
   every condition. File as the real long-term fix; the floor ramp is the
   interim.
3. **`beddingLikelihood` has no day/night switch, and the literature splits on
   exactly that axis.** Lang & Gates measured _night_ beds; UNH 6.9 prescribes
   south/west slopes for _day_ beds. The layer is used in daylight, so the
   daytime reading is the right default — but that is currently an accident, not
   a decision, and it should be recorded as one.

---

## Bedding-model parameters shipped by `R11` / `R21` / `R22` _(registered pass 5)_

These landed ungraded because the agent that chose them is forbidden from
grading its own values. Registered here for the first time.

### 🔵 `BEDDING_PAD_HALF_MAX_SLOPE_DEG = 12` — pad-term half-max, degrees

`padTerm = 1/(1 + (s/12)²)`, replacing the retracted 22° Gaussian.

**The shape is the strong part and it is 🟢:** Rowland et al. 2018 measured a
**monotone declining** cervid response to slope with no interior optimum, slope
the single strongest predictor. A Gaussian peaking at 22° was the wrong
functional class, not merely mis-centred, and removing it is the most
consequential bedding correction this register has produced.

**The value 12 is 🔵 by the following inference, stated so it can be attacked:**
a half-max at 12° puts the term at **0.20 at 24.2°** (top of the BC WHR
whitetail winter-range band, 10–45 %) and **0.34 at 16.7°** (top of the
secondary elk daily-use preference band, 15–30 %). The kernel therefore spends
its mass across exactly the range two independent sources report as used, and is
nearly exhausted where both report use ceasing. **What this is not:** a measured
half-max. Converting a reported _use band_ into the half-max of a Cauchy kernel
is a transformation no source performed. Scope: BC interior + Idaho/Montana elk;
nothing Appalachian.

### 🔴 `BEDDING_RING_MIN_SLOPE_DEG = 15` — surround-slope sigmoid midpoint, degrees

Nothing measured sets this, and **the justification in the source comment is
wrong on its own terms.** The comment places 15° at "the bottom of the BC WHR
band"; that band is 10–45 %, whose bottom is **5.7°** — 15° is its _centre_.

The deeper problem is a category slip that survives fixing the arithmetic: BC
WHR describes **the slope deer occupy**, not the slope _surrounding_ a bed. Using
a use-band statistic as a surround threshold assumes bed and surround are drawn
from the same distribution, which is the exact assumption the pad/ring split
exists to deny. Its sibling `minSurroundSlopeDeg: 18` in `detectBenches` is
already registered as having nothing behind it; this is the soft version of the
same unsupported number. Stays 🔴. Ordering (surround steeper than pad) is 🟡
doctrine and is well supported; the threshold is not.

### 🔴 `BEDDING_RING_SOFTNESS_DEG = 4` — logistic width, degrees

**Not a biological parameter.** It is a numerical-stability choice preventing
cell-to-cell flicker along breaks of slope, and the code says so. Registered
only so it is not mistaken for one. No literature sought or needed; if it is
ever surfaced in the UI as a biological claim, that is a defect.

### 🔴 `BEDDING_VRM_FULL_COVER = 0.06` — VRM at which the cover term saturates

Flagged by its own author as geometry, not observation (`R33`), and that
assessment is correct and is upheld. VRM ≈ σ²/2 for small dispersion, so 0.06 is
"surface normals vary by roughly ±20° RMS in the window". **A defensible scale
argument is not a measurement**, and no source relates any VRM value to a deer
bed. Queries: `vector ruggedness measure VRM values deer bed site selection
threshold Sappington bighorn 0.06 interpretation`.

**One new observation that sharpens `R33`.** VRM output ranges 0–1 in principle
but **typical values for natural terrain run 0 to about 0.4**
([Sappington et al. 2007](https://wildlife.onlinelibrary.wiley.com/doi/10.2193/2005-723)
and the GRASS/`spatialEco` implementations that follow it). Saturating at 0.06
therefore pins the cover term at its **ceiling across most real hill country**,
so a term intended to discriminate concealment is largely constant over the
ground a hunter is actually looking at — a modelling consequence independent of
whether 0.06 is the "right" number. Worth measuring on a real tile before the
ground-truthing work `R33` asks for.

### 🔴 `DEFAULT_VRM_RADIUS_CELLS = 4` — cover-term window radius (9×9, ≈ 90 m at 10 m cells)

🔵 for the **direction** — "coarser scales of ruggedness may be more related to
viewsheds and concealment" is already in this register, and 9×9 is properly
coarser than the 3×3 it replaced. 🔴 for **4**: no source nominates a window
size for cervid concealment. Sappington et al. 2007 tested multiple window sizes
for bighorn; **their conclusion on scale is found-but-unread** and is the
cheapest available upgrade for this row.

### 🔴 `DEFAULT_RING_RADIUS_CELLS = 8` — surround-ring radius (≈ 80 m at 10 m cells)

Unregistered until now and not named in any backlog row. Same status as the VRM
radius: a scale choice with no source. Registered so it is not invisible.

### 🔴 The two term floors — cover `0.4`, shelter `0.25` _(full treatment, pass 6)_

`beddingLikelihood` is a product of five requirement terms. Two of them carry a
**floor**, written as bare literals inside the loop body rather than as named
constants (`packages/terrain/src/analysis/wind.ts:545` and `:562`):

```
shelterTerm = 0.25 + 0.75 · clamp01(s)     // s = terrainShelter, 0..1
coverTerm   = 0.40 + 0.60 · clamp01(c / BEDDING_VRM_FULL_COVER)
```

A floor is not a tuning knob. In a multiplicative model it is **the entire
statement of how substitutable a requirement is** — how much a cell is allowed
to lose for missing it. Because the other terms multiply through unchanged, the
floor is also what settles which term wins when two disagree, which is the
mechanism `R31` was actually about. Both are 🔴 **Assumed**, and the rest of this
section is the case for that grade, the shape critique, and the falsification
tests.

#### What the floor means in a measurable unit

For `term = f + (1−f)·x` with `x ∈ [0,1]`, the ratio between the best and the
worst cell **on that axis alone**, all other terms held equal, is exactly `1/f`:

| Floor          | Best-vs-worst ratio the engine asserts | Read as                                                                       |
| -------------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| shelter `0.25` | **4.0×**                               | a fully sheltered bed is at most 4× as good as an identical fully exposed one |
| cover `0.40`   | **2.5×**                               | a fully concealed bed is at most 2.5× as good as an identical bare one        |

That reformulation matters because `1/f` is a **selection ratio**, which is a
quantity wildlife studies actually report and which
`packages/shared`'s own selection analytics already compute (Manly ratios against
a `TerrainProfile` availability distribution). The floors are therefore not
unfalsifiable in principle — they are unfalsifiable _today_ because nobody has
published the ratio for either axis, and because the engine has no observation
set to compute it from. That distinction is the difference between a 🔴 with a
test and a 🔴 without one, and it is the main product of this pass.

#### Finding 1 — the ordering the two literals imply has never been chosen, and the evidence contradicts it

Read together, `0.25 < 0.40` says **wind shelter is a stricter requirement for a
bed than concealment cover** (4× vs 2.5×). Nobody decided that. It fell out of
two literals picked independently in different commits. The available evidence
points the other way on both halves of it:

- **Concealment selection at bed sites is measured, repeatedly, across species.**
  Bed sites carry more screening cover than paired random points in every
  bed-site study located this pass (below).
- **The thermal-shelter benefit is the one that has been tested and _failed_.**
  See Finding 3.

An ordering that the engine asserts, that no one chose, and that the literature
leans against, is a defect of exactly the kind this register exists to catch.

#### Finding 2 — what is measured about concealment at bed sites (the cover floor)

All 🟢 for _direction_; none of them yields a substitutability ratio.

| Finding                                                                                                                 | Value                                                                                | Species / scope                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bed-site vegetative cover vs paired random                                                                              | **28.1 % vs 19.9 %** (1991), **36.0 % vs 33.8 %** (1992); veg height 101 cm vs 75 cm | whitetail **fawns**, ponderosa pine, Black Hills SD — [Uresk et al., USFS RMRS](https://www.fs.usda.gov/rm/pubs_other/rmrs_1999_uresk_d001.pdf) _(abstract/snippet level)_                                                        |
| Odds of bed-site selection per 1 cm of understory height                                                                | **OR 1.035** (95 % CI 1.008–1.062)                                                   | whitetail **neonates**, grassland, Northern Great Plains — [Grovenburg et al. 2010, _JWM_](https://wildlife.onlinelibrary.wiley.com/doi/10.1111/j.1937-2817.2010.tb01245.x) _(abstract-level)_                                    |
| Visual obstruction at beds consistently exceeds that at 25 m and at random; ~50 % of beds under or beside a woody plant | direction only                                                                       | ungulate fawn bed-site literature, incl. roe deer — [PMC10682894](https://pmc.ncbi.nlm.nih.gov/articles/PMC10682894/) _(abstract-level)_                                                                                          |
| Site temperature and canopy closure were the **most influential** bed-site attributes                                   | rank, not magnitude                                                                  | **mule deer** day-beds, AZ ponderosa pine, 236 beds vs 439 random — [Germaine et al. 2004, _WSB_ 32:554](<https://wildlife.onlinelibrary.wiley.com/doi/abs/10.2193/0091-7648(2004)32%5B554:COMDDA%5D2.0.CO;2>) _(abstract-level)_ |

**Two things this does not give us.** First, every one of the numeric rows is
**fawn or neonate** work; fawn bed-site selection is a hider-strategy problem and
does not transfer to mature-buck bedding — the transfer is stated here only to be
refused. Second, and more fundamentally, the _closest_ numeric row (Uresk) shows
bed and random distributions **overlapping heavily** — 28 % vs 20 %, and in the
second year 36 % vs 34 %, essentially no separation. A covariate whose means
differ by 1.07–1.41× between used and available sites is not evidence for a 2.5×
best-vs-worst ratio in either direction; it is evidence that the ratio has not
been measured on anything resembling the engine's axis.

**The cover floor `0.4` therefore stays 🔴 Assumed.** Nothing found supports 0.4
over 0.2 or 0.6.

#### Finding 3 — the shelter floor has a _contrary_ measured result, and it is the strongest single result in this section

The nearest thing to a test of "how much does missing shelter cost" is the
thermal-cover literature, and it is negative:

> No positive effect of thermal cover was found on body condition of elk during
> any of four winter-long and two summer-long experiments. **During winter, the
> dense cover units actually provided the most costly energetic environments,
> and the clearcuts the least.** The energetic benefits of thermal cover seem
> inconsequential.
> — Cook et al. 1998, _Wildlife Monographs_ 141, "Relations of forest cover and
> condition of elk: a test of the thermal cover hypothesis in summer and winter",
> as summarised by
> [PNW _Science Findings_ 22](https://www.fs.usda.gov/pnw/sciencef/scifi22.pdf)
> and [Cook et al. 2004, _Thermal cover needs of large ungulates: a review of
> hypothesis tests_](https://www.fs.usda.gov/pnw/pubs/journals/pnw_2004_cook001.pdf)
> _(both abstract/summary level; the monograph itself is found-but-unread)_

Cook et al. 2004 add the methodological point that bears directly on this
register: _"the majority of empirical support for the thermal cover hypothesis is
derived from observational studies of habitat selection"_, i.e. the same class of
evidence the engine's shelter term rests on. And a second, independent negative:
a LiDAR + GPS study of winter habitat selection found temperature and snow height
drove cover selection while **wind speed had no influence at all**
([Ewald et al. 2014, _Forests_ 5:1374](https://doi.org/10.3390/f5061374),
European roe deer, montane, _abstract-level_).

**Four caveats, stated so this is not over-read:**

1. **Species drift.** Cook is elk, Ewald is roe deer. Neither is _Odocoileus
   virginianus_, and elk are markedly more cold-tolerant.
2. **Different kind of shelter.** Both measure _canopy_ thermal cover. The
   engine's `terrainShelter` is a **topographic** exposure index. This is the
   same category slip pass 5 caught in `R31` — recorded here so this pass does
   not commit it in the opposite direction.
3. **Benefit ≠ selection.** Cook measured _whether cover helps_. The bedding
   layer predicts _where deer will be_. An animal can select a resource that
   confers no measurable fitness benefit, and Cook explicitly notes selection
   studies show cover use. For a "where is the deer" layer, selection evidence is
   the right currency and Cook is not decisive.
4. Against these sit Courbin et al. 2017 (whitetail selecting thermal cover under
   cold stress) and Lang & Gates 1985 (whitetail night beds in reduced wind), both
   already in this register.

**Net: the shelter floor `0.25` stays 🔴 Assumed**, and the direction of any
future change is genuinely contested. What has moved is that there is now a
peer-reviewed result pushing the floor **up** (toward "missing shelter costs
little"), which is the same direction `R31` prescribes for cold — reached by a
completely independent route. That is a modest, real corroboration of `R31`'s
direction and **not** of its endpoints.

#### Finding 4 — the linear shape is defensible for shelter and probably wrong for cover

`f + (1−f)·x` is a bounded, **partially compensatory** aggregation operator: it
prevents any one requirement from zeroing the product while still letting it
dominate. That is a recognised design in habitat modelling — the product /
geometric-mean family is the standard "limiting factor" aggregator, chosen
precisely so that a location scores low if any single input is low, in contrast
to the arithmetic mean, which is fully compensatory
([USGS OF 2007-1254, HSI assessment](https://pubs.usgs.gov/of/2007/1254/pdf/OF07-1254_508.pdf);
[Geospatial Suitability Indices toolbox, aggregation methods AM / GM / MLF](https://apps.dtic.mil/sti/trecms/pdf/AD1177555.pdf)
_(both abstract/snippet level)_). The engine's five-way product sits at the
non-compensatory end; the floors are the dial that adds compensation back. **The
existence of floors is 🔵 — sound modelling practice with a real methodological
literature. The values are 🔴.**

Three specific shape criticisms, in decreasing confidence:

1. **The cover term's monotonicity is contradicted by measurement.** `0.4 + 0.6·c`
   says more concealment is always better, saturating at
   `BEDDING_VRM_FULL_COVER`. Two peer-reviewed results say otherwise:
   - Red deer **select intermediate habitat visibility**, from 3D cumulative
     viewsheds built from terrestrial + airborne LiDAR — an interior optimum, not
     a saturating ramp. [Zong, Wang, Skidmore & Heurich 2023, _J. Anim. Ecol._
     92:1306–1319](https://besjournals.onlinelibrary.wiley.com/doi/10.1111/1365-2656.13847)
     _(abstract-level; open-access copy and Dryad data exist and are the cheapest
     upgrade for this row)_
   - **Horizontal visibility, not concealment cover, drove bedsite use and
     predation risk** in whitetail fawns, and a _greater_ field of view **lowered**
     the odds of coyote predation. [Obermoller et al., _JWM_](https://wildlife.onlinelibrary.wiley.com/doi/10.1002/jwmg.70240)
     _(abstract-level; fawns, so scope-limited)_
   - The mechanism is quantified generally: concealment and visibility are
     **inversely related opposing functional properties of the same cover**
     ([Camp et al. 2013, _Ecosphere_](https://esajournals.onlinelibrary.wiley.com/doi/10.1890/ES12-00114.1),
     shrub-steppe, _abstract-level_).

   This is the pass's sharpest finding on shape, and it exposes an **internal
   contradiction in Ridgeline's own model**: the leeward aspect term is justified
   in this register by the doctrine that a buck beds to _watch downhill and smell
   uphill_ — which requires a sightline — while the cover term rewards
   monotonically increasing sightline-breaking ruggedness. The two terms encode
   opposite preferences about the same variable and multiply together.

   ⚠️ **Do not act on this by inverting the cover term.** VRM is terrain
   orientation dispersion; the cited work measures _vegetation_ visibility. The
   honest conclusion is that a monotone-increasing terrain-roughness term is an
   unvalidated proxy for a quantity that is measured to have an interior optimum.

2. **A floor is the right family for shelter.** The requirement is graded (wind
   loading is continuous, not present/absent), the cost of being wrong is
   symmetric, and a hard threshold would make the layer flicker along every break
   of slope — the same argument already recorded for `BEDDING_RING_SOFTNESS_DEG`.
   Linear-in-`x` specifically is 🔴: it says the marginal value of shelter is
   constant, whereas the standard RSF form `w(x) = exp(βx)` says it is constant in
   _log_ odds. The two differ most exactly at the exposed end, which is where the
   floor lives.

3. **Both floors are silently wind-speed assumptions.** Already filed as `R38`;
   restated here because it is a _shape_ claim, not only a value claim. A fixed
   floor asserts the shelter/solar trade is a constant, when Parker & Gillingham
   measured wind swamping solar gain at 15 m·s⁻¹ and being near-irrelevant in calm
   air. The correct object is `f(windSpeedKph)`, not a scalar.

#### What would falsify each — stated so a later pass can settle them

Both floors are, today, **unfalsifiable guesses that nonetheless decide the
layer's output.** These are the observations that would change that, cheapest
first:

| Floor               | Falsifying observation                                                                                                                                                                                                                                                                                                         | Consequence                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| cover `0.4`         | A Manly selection ratio for observed beds across VRM availability bands (this repo already computes these). If used:available for the **top** VRM band ÷ the **bottom** band exceeds **2.5**, the floor is too high; if it is below ~1.3, the term is close to inert and the floor should rise toward 1 or the term be dropped | direct, and computable from Ridgeline's own observation table once enough beds are logged                           |
| cover `0.4`         | Any published RSF reporting a coefficient for a **continuous concealment covariate at adult** deer beds. `exp(β · range)` is directly comparable to `1/f`                                                                                                                                                                      | would move the row to 🔵                                                                                            |
| cover `0.4` — shape | Confirmation that the response has an **interior optimum** in a terrain-visibility (not vegetation) covariate                                                                                                                                                                                                                  | would falsify the _functional class_, as Rowland 2018 did for the 22° Gaussian — a bigger correction than the value |
| shelter `0.25`      | Any study relating whitetail bed selection to a **topographic** wind-exposure index (TOPEX/Sx-class). Still none found after this pass's queries plus pass 5's six                                                                                                                                                             | would move the row to 🔵 or 🟢                                                                                      |
| shelter `0.25`      | A measured used-vs-available ratio for leeward vs windward bed positions at matched slope, aspect and cover                                                                                                                                                                                                                    | if < 4×, the floor is too low                                                                                       |
| shelter `0.25`      | `R38` landing: any demonstration that the ratio varies with wind speed                                                                                                                                                                                                                                                         | falsifies the _scalar_, regardless of its value                                                                     |

**Interim guidance for the build agents, so the 🔴 does not become paralysis:**
leave both values as they are. Do not tune either one without one of the
observations above — a floor moved on taste is strictly worse than a floor left
at a value whose provenance is documented. The two changes that _are_ warranted
now are non-numeric: promote both literals to named exported constants so they
are greppable and overridable (they are currently invisible to every consumer),
and make the `Confidence` chip on the bedding layer say that the cover and
shelter weightings are unmeasured.

**Queries run this pass** (in addition to pass 5's six on topographic shelter),
so a later pass does not redo them: `white-tailed deer bed site visual
obstruction horizontal cover measured versus random sites` · `Odocoileus
virginianus bed site selection concealment cover threshold resource selection
function` · `threshold response habitat selection ungulate non-linear canopy
cover breakpoint deer` · `mature male white-tailed deer daytime bed site
characteristics GPS telemetry measured slope canopy` · `deer bed site logistic
regression odds ratio visual obstruction per unit increase selection` ·
`"selection ratio" white-tailed deer bedding cover type use availability Manly
winter` · `Armstrong Euler Racey 1983 winter bed-site selection central Ontario
results` · `Cook 1998 Wildlife Monographs test of the thermal cover hypothesis
findings` · `Mysterud Ostbye 1999 cover as a habitat element for temperate
ungulates conclusions` · `thermal cover hypothesis rejected ungulate winter
energetics review` · `ungulate selection leeward slopes wind exposure index GPS
collars measured` · `deer resting site selection wind speed reduction percent
selection strength odds ratio winter bed microclimate measured` · `habitat
suitability index model aggregation arithmetic versus geometric mean limiting
factor compensatory` · `white-tailed deer habitat suitability index model HSI
cover component minimum value limiting factor equation` · `hiding cover
definition vegetation hide 90 percent of adult deer at 61 meters` · `Germaine
2004 mule deer day-bed sites canopy closure bed versus random values` · `LiDAR
forest structure GPS telemetry winter habitat selection European roe deer wind
speed no influence` · `deer bed sites canopy closure percent mean at beds versus
random points white-tailed daytime` · `Zong 2023 LiDAR intermediate visibility
forest-dwelling ungulate results` · `deer trade-off concealment versus visibility
bedding intermediate cover predator detection` · `relative importance thermal
cover versus security cover ungulate bed site selection compensatory
substitutable`.

**Found-but-unread, ranked as leads for the next pass:** Cook et al. 1998
_Wildlife Monographs_ 141 (the primary; only agency summaries read here) ·
Mysterud & Østbye 1999, _Wildl. Soc. Bull._ 27:385–394, _Cover as a habitat
element for temperate ungulates_ (a review written on exactly this question) ·
Zong et al. 2023 (open-access PDF and **Dryad datasets** both exist — the only
lead here that could produce a fitted curve rather than a direction) ·
Armstrong, Euler & Racey 1983, _JWM_ 47:880–884, which compared **day and night
beds** in central Ontario and is therefore the single most relevant unread paper
to the day-vs-night gap this register logged in pass 5.

#### 🔴 One agency threshold worth recording, because it is _not_ our shape

Hiding cover is defined across USDA/NRCS and state guidance as **vegetation
capable of hiding 90 % of a standing adult deer from a human at ≤ 200 ft (61 m)**
([Colorado NRCS mule deer fact sheet](https://efotg.sc.egov.usda.gov/references/public/co/muledeer.pdf),
[MSU Deer Lab](https://www.msudeer.msstate.edu/habitat-cover.php)). 🟡 **Doctrine**
— it is a management convention with no measurement behind the 90 %/61 m pair,
and it is asserted rather than derived in every source found. It is registered
here for one reason: it is the discipline's own operational definition of cover
and it is a **step function**, not a ramp. Our cover term is a ramp. Neither is
measured; they are simply different models, and the ramp is the better choice for
a rendered surface for the anti-flicker reason above.

### 🔴 `BEDDING_RING_MIN_DATA_FRACTION = 0.5` — ring data quorum _(new, `R40`; registered pass 6)_

**Not a biological parameter, and it must never be presented as one.** It is a
statistical-honesty threshold: the share of the _in-grid_ ring that must carry
data before the surround term is allowed to speak, below which the cell returns
`NaN`. It says nothing about deer. Graded 🔴 **Assumed** and registered so that
it is visible, exactly as `BEDDING_RING_SOFTNESS_DEG` is.

The constant's own doc comment states that 0.5 "is not a free choice" because
`detectBenches` already requires `samples >= 8` of 16 for the same geometry.
**Reading both sources, that justification is true in the tile interior and false
at the tile border**, which is the region it exists to protect:

|                                                           | `detectBenches` (`landform.ts:441`)                 | `beddingLikelihood` (`wind.ts:604`)                                   |
| --------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| test                                                      | `samples >= 8` — absolute count                     | `samples >= 0.5 · (samples + missing)` — fraction of _available_ ring |
| denominator                                               | all **16** directions, including those off the tile | only directions **inside** the grid                                   |
| at a tile border with 5 in-grid directions, all with data | `5 < 8` → **abstains**                              | `5 ≥ 0.5 × 5` → **speaks**                                            |

The two coincide only when `samples + missing == 16`. This is not a defect —
`R40` deliberately chose not to grey a ring-radius seam around every tile, and
that decision is right and is documented. What is wrong is the _claim of
equivalence_: the two layers **can** disagree about what a shelf is, along every
tile edge, by construction. The value 0.5 is a reasonable quorum with no
derivation; "half the ring answered" is the same convention as `detectBenches`
by coincidence of arithmetic, not by pinning.

**Recommended, non-urgent:** either restate the comment to say the quorum is
_conventionally_ aligned rather than pinned, or make the alignment real by
expressing both as a fraction of the available ring. Filed rather than fixed —
`packages/terrain` is not this agent's territory.

### Cold-blend ramp — `coldBlendWeight`, graded per endpoint

| Constant                          | Value       | Grade                                  | Basis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------- | ----------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BEDDING_COLD_ONSET_C`            | +5 °C       | 🔴 **Assumed**                         | Above **every** measured cervid lower critical temperature found (below), so the ramp begins while the deer is still thermoneutral. Harmless — the weight is near zero there — and it correctly makes the term a no-op through October. But no source sets +5 °C. A secondary summary asserting deer "benefit from increased direct exposure to sun below 5 °C" surfaced in search and **could not be traced to a primary source**; it is not cited here.                                                                                                                                                                                                                                                            |
| `BEDDING_SEVERE_COLD_C`           | −10 °C      | 🔵 **Inferred** — _upgraded this pass_ | Measured LCT for white-tailed deer fawns **fed a natural browse diet: −11.2 °C** (a 40 % rise in thermoneutral heat production moved it from −0.8 °C fasted to −11.2 °C fed), by indirect respiration calorimetry, 18 fasting + 18 on-feed trials. −10 °C sits **1.2 °C** from a measured physiological threshold for this species: below it a fed fawn must catabolise tissue. [Can. J. Zool. (1999)](https://cdnsciencepub.com/doi/10.1139/z99-111) _(abstract-level only.)_ **Caveat: fawns.** Adults have a better surface-to-volume ratio and a lower LCT, so −10 °C is conservative for the mature buck the layer is aimed at. Corroborating band: black-tailed deer winter thermoneutral limits −6 to +18 °C. |
| `BEDDING_MAX_SOLAR_ASPECT_WEIGHT` | 0.75        | 🔴 **Assumed**                         | Chosen so lee never disappears. Defensible, unmeasured, and per the `R31` verdict **should not be raised**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Ramp shape                        | linear in T | 🔴 **Assumed**                         | Nothing measured prescribes linearity. Metabolic cost below LCT _is_ approximately linear in the temperature deficit, which makes linear a reasonable default — recorded as reasoning, not as a source.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### Register-vs-source audit — bedding constants, re-read from the code _(pass 6)_

Read directly from `packages/terrain/src/analysis/wind.ts` and
`.../landform.ts`, not from this register's own account of them.

| Constant                          | Value in source                         | Grade               | Register accurate?                                                                                                                           |
| --------------------------------- | --------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `BEDDING_PAD_HALF_MAX_SLOPE_DEG`  | 12                                      | 🔵                  | ✅ value and rationale match                                                                                                                 |
| `BEDDING_RING_MIN_SLOPE_DEG`      | 15                                      | 🔴                  | ✅ value matches; **the source comment still carries the justification this register retracted in pass 5** (see below)                       |
| `BEDDING_RING_SOFTNESS_DEG`       | 4                                       | 🔴 (not biological) | ✅ source explicitly calls it a shape parameter                                                                                              |
| `BEDDING_VRM_FULL_COVER`          | 0.06                                    | 🔴                  | ✅ source flags itself as geometry, not observation                                                                                          |
| `BEDDING_RING_MIN_DATA_FRACTION`  | 0.5                                     | 🔴 (not biological) | ⚠️ **was unregistered**; now registered above, with its stated pin to `detectBenches` corrected                                              |
| `BEDDING_COLD_ONSET_C`            | 5                                       | 🔴                  | ✅                                                                                                                                           |
| `BEDDING_SEVERE_COLD_C`           | −10                                     | 🔵                  | ⚠️ value matches, but the **source comment does not carry the LCT citation** that earned the 🔵 — it still reads as an unsupported assertion |
| `BEDDING_MAX_SOLAR_ASPECT_WEIGHT` | 0.75                                    | 🔴                  | ⚠️ value matches; **the source comment still quotes the retracted 42.0 cm figure**                                                           |
| shelter floor                     | `0.25` (unnamed literal, `wind.ts:545`) | 🔴                  | ⚠️ not a named constant; see the floors section                                                                                              |
| cover floor                       | `0.40` (unnamed literal, `wind.ts:562`) | 🔴                  | ⚠️ not a named constant; see the floors section                                                                                              |

**Two stale source comments, both retractions this register has already made and
the code has not.** Neither is a computational defect; both are the kind of
confidently-wrong provenance that gets copied forward into the next parameter.

1. `BEDDING_MAX_SOLAR_ASPECT_WEIGHT`'s comment reads _"the mechanism is measured:
   18.1 cm of snow on the SE-facing slope against 42.0 cm on the NE-facing slope
   in the same study area (Lang & Gates 1985)"_. That is the **mean-versus-maximum
   comparison retracted in pass 5**. Lang & Gates' three site means are bottomland
   11.2 / SE 18.1 / NE 21.7 cm — an aspect effect of **1.20×, not 2.32×** — and the
   sheltered bottomland is the shallowest of the three. This register and
   `docs/BACKLOG.md`'s `R31` row both state it correctly; **checked this pass and
   they have not drifted back.** The code comment is the last place the wrong
   figure survives.
2. `BEDDING_RING_MIN_SLOPE_DEG`'s comment places 15° "at the bottom of the BC WHR
   band". That band bottoms at **5.7°**; 15° is its centre. Retracted in pass 5,
   still in the source.

Both are one-line comment edits owned by whoever next touches
`packages/terrain/src/analysis/wind.ts`. Filed, not fixed — not this agent's
territory.

**Also confirmed against the code:** `R31`'s prescribed
`shelterFloor(T) = 0.25 + 0.40 · coldBlendWeight(T)/0.75` has **not shipped**. The
shelter floor is still the fixed literal `0.25`, so every statement in the `R31`
section above remains a prescription rather than a description of the engine.

---

## Thermals and scent

### 🟢 Slope flows exist and invert diurnally — _the physics_

Katabatic (downslope) flows **develop rapidly soon after sunset** as the surface
cools, are strongly unidirectional, last on the order of hours, are most
pronounced on clear nights with light synoptic wind, run 10–30 km·h⁻¹ in a layer
10–100 m deep, and pool as a cold pool in valley bottoms. Anabatic (upslope)
flows initiate after sunrise and **gradually erode that cold pool**.
[Royal Meteorological Society](https://www.rmets.org/metmatters/anabatic-and-katabatic-flow-metmatters-guide-mountain-winds) ·
[UBC ATSC 113 — diurnal slope flows](https://www.eoas.ubc.ca/courses/atsc113/snow/met_concepts/06-met_concepts/06b-diurnal-slope-flows/)

Upgraded from 🟡: this is measured boundary-layer meteorology, not folklore.

### 🟡 Deer _use_ thermals to manage scent

Universal in the hunting literature; no cervid study measuring the behavioural
response to slope flows was located. The physics being 🟢 does not make the
behavioural claim 🟢.

### 🟡 Thermal hubs

Low points collecting thermals from several directions, where deer gather
information before committing.
[NA Deer Hunter](https://nadeerhunter.com/how-to-hunt-mountain-bucks/)
Doctrine. Not currently a distinct layer. Note the meteorology _does_ support
the underlying convergence — cold-air pooling in concave terrain is exactly the
cold pool above — so this is doctrine resting on real physics.

### 🟢 Transition window: symmetric ±45 min is wrong — **and the correct numbers are now measured** _(was 🔴)_

Pass 2 established the asymmetry from qualitative description and guessed
`{ morning: 90, evening: 30 }`. Pass 3 found the measurements, and they are of
exactly the quantity we model:

| Transition                | **Measured onset**                                                                                                                                                 | `transitionMinutes` today |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Evening — katabatic onset | **≈ 35 min after sunset**, initiation rate **3× faster** than anabatic; a corroborating study puts the evening transition delay at **at most 30 min** after sunset | ±45 min                   |
| Morning — anabatic onset  | **≈ 110 min after sunrise**, with onset spread over a ~20-min interval between measurement points                                                                  | ±45 min                   |

[El Gdachi et al. 2024, _J. Geophys. Res. Atmos._ 129, "Thermodynamic Processes
Driving Thermal Circulations on Slopes"](https://agupubs.onlinelibrary.wiley.com/doi/10.1029/2023JD040431) ·
[Evening transition between anabatic and katabatic regimes in complex terrain](https://www.researchgate.net/publication/308485759_Evening_transition_between_anabatic_and_katabatic_wind_flow_regimes_in_complex_terrain) ·
[Distinguishing time scales of katabatic flow in complex terrain, _Atmosphere_ 12:1651](https://www.mdpi.com/2073-4433/12/12/1651)

**Recommended replacement:** `transitionMinutes: { morning: 110, evening: 35 }`,
and the windows should be **forward-offset, not centred** — katabatic onset is
35 min _after_ sunset, so an evening window of sunset−45 → sunset+45 spends half
its time in a phase that has not started. Sunset → sunset+35 and sunrise →
sunrise+110 is what the measurements describe.

🟢 for the asymmetry and the magnitudes; the two studies bracket the evening
number at **30–35 min** and only one reports the morning number, so treat
morning 110 as ±30. **Scope, stated:** the 35/110 pair is from Reunion Island —
tropical, maritime, steep volcanic terrain. The corroborating ≤30 min evening
figure is from mid-latitude complex terrain. The _asymmetry_ replicates across
both; the exact minutes in an Appalachian hollow in November are unmeasured.

The **elevation dependence** stands and stays 🔵: flow reversal "is not
instantaneous but spaced out by an evening transition characterised by slow
winds, changing wind directions and fluxes close to zero", and ridges flip while
the valley bottom is still draining. A single global phase for the whole DEM is
wrong on exactly the terrain the app is for. File the cold-pool persistence
model separately. _(abstract/index only — verify against full text.)_

### 🔴 Thermal strength saturates at 30° slope — **and the direction may be inverted**

`min(1, slope / 30)` makes thermal strength rise monotonically with slope. That
is not what the slope-flow literature says. In the classical Prandtl analytical
solution the slope angle affects only the **height** of the katabatic wind
maximum, not its **speed**; large-eddy simulation finds both the maximum speed
and its height **decrease with increasing slope angle**.
[Grisogono & Axelsen 2012, _Boundary-Layer Meteorol._ 145:527](https://link.springer.com/article/10.1007/s10546-012-9746-1)

**Caveat, stated rather than hidden:** those results are for _pure_ katabatic
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

What _is_ real is the atmospheric side. Lateral plume spread σ_y as a function
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
30°** for the thermal cone — a _wider_ cone for the thermal case, which for
evening/night sinking thermals is the stable case and should be the **narrowest**
of the three.

Recommended shape (numbers to be read off the EPA table, not from me):

```
halfAngle(phase) :  Sinking (stable, class E–F)   →  narrowest
                    Transition (neutral, class D) →  intermediate
                    Rising (unstable, class A–C)  →  widest, ≈ today's 25°
```

Everything except the ordering stays 🔴 until someone reads the σ_y tables. The
400 m length should be documented as _"where we stop drawing"_, never as a
detection threshold.
**Action:** `BACKLOG N11`.

### 🔴 Deer scent-detection distance — **re-attacked; stays 🔴, and the media numbers are worse than unsupported**

Not a code parameter today, but implied by the cone's 400 m. Re-searched with
olfactometry and threshold-measurement phrasing rather than hunting phrasing.
**No cervid odour-detection-distance measurement exists.** What is measurable —
and is where the media numbers come from — is _anatomy_, which does not convert
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
that _can_ measure detection thresholds (automated human-scent olfactometers,
sniff protocols) is a **detection-dog** field. Nobody has put a deer in one.

**Queries:** `deer olfaction detection distance experiment odour threshold
ungulate scent human` · `cervid olfactory acuity measurement olfactometer` ·
`odor detection threshold wildlife` · plus pass 2's scent-cone queries.

---

## Rut timing

> **Pass 4 (`R9`, rut regionalisation) reworked this whole section.** Passes 2
> and 3 established that a latitude-monotone peak-breeding function is the wrong
> functional class and assembled an eight-row seed table. Pass 4 answers the
> three questions the backlog row actually asked — _where is latitude-only
> defensible, where is it wrong and by how many days, and what should the model
> say there_ — by scoring the shipped function against **40 published regional
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
[Reproductive characteristics of female white-tailed deer, _Theriogenology_ 2017](https://www.sciencedirect.com/science/article/pii/S0093691X1730078X) ·
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
  therefore the _proximate cause_, not a correlate.
  [Verme & Ozoga 1987, _J. Mammalogy_ 68:107 — photoperiod and puberty in doe fawns](https://academic.oup.com/jmammal/article-abstract/68/1/107/1040922) ·
  [Out-of-season breeding of captive white-tailed deer, _Theriogenology_ (PubMed)](https://pubmed.ncbi.nlm.nih.gov/11071135/) ·
  [Reproductive management in white-tailed deer, _Agroproductividad_](https://revista-agroproductividad.org/index.php/agroproductividad/en/article/download/2063/1687/8266)
- **Inter-annual stability.** Ontario deer–vehicle collisions, 29 years
  (1988–2016), grouped by deer management area: **no evidence of any change in
  rut timing over 29 years**, and the top model for the date of peak collisions
  contained **one parameter — the management area.** Growing-degree-day (a
  weather covariate) was never significant.
  [Deerly departed, _Ecological Informatics / Sci. Total Env._ 2024](https://www.sciencedirect.com/science/article/pii/S2666900524000042)
  This is a _northern-range_ result and it says two things at once: timing is
  fixed year to year (photoperiod), **and even in Ontario the only predictor
  that survives is region.**

### 🟢 How precise a "peak" can honestly be — the two dispersions

The register previously used "±4 days" for the northern peak without a source.
It now has one, and the number means something specific.

| Quantity                                                           | Value                                 | What it bounds                                              |
| ------------------------------------------------------------------ | ------------------------------------- | ----------------------------------------------------------- |
| SD of a **population's annual mean** conception date, year to year | **4 days**, range 12 days             | how repeatable _this herd's_ peak is — the calibrated case  |
| SD of **individual** conception dates within a wild population     | **13.4 days**, mean range **46 days** | how wide the actual breeding spread is — never a "peak day" |
| SD of individual conception dates, **captive** deer (TX + MS)      | 13.6 days, mean range 33 days         | captive vs wild dispersion is nearly identical              |
| Fraction of breeding inside a **21-day window** centred on peak    | most of it; total duration 30–45 days | the operational rut window                                  |

[Dye et al. 2012, _Wildl. Soc. Bull._ 36:107–114 — Factors affecting conception date variation](https://wildlife.onlinelibrary.wiley.com/doi/10.1002/wsb.98) ·
[MSU Deer Lab — Ecology of the rut](https://www.msudeer.msstate.edu/ecology-of-the-rut.php)

**Consequence.** A model that has _not_ been calibrated to the user's herd
cannot claim better than the region-to-region spread (below, ~±8 days at
≥ 37°N). A model that _has_ been calibrated from ≥ 3 seasons of the user's own
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

| Region                                    | Lat     | Population mean / peak                                     | Model  | Error    |
| ----------------------------------------- | ------- | ---------------------------------------------------------- | ------ | -------- |
| Alberta / western Canada                  | 52–54°N | peak breeding **10–21 Nov** (mid 16 Nov)                   | 15 Nov | −1 d     |
| SW Wisconsin (188 GPS bucks + conception) | 43.0°N  | breeding window 23 Oct – 12 Nov                            | 15 Nov | −5 d     |
| Pennsylvania                              | 41.0°N  | **median conception 11–17 Nov**; 90 % bred 16 Oct – 16 Dec | 15 Nov | ~0 d     |
| New Jersey, northern adults               | 40.2°N  | 3–23 Nov (mid 13 Nov)                                      | 15 Nov | +2 d     |
| Midwest (IL/OH/IN)                        | 40.0°N  | **10 Nov**                                                 | 15 Nov | **+5 d** |
| West Virginia                             | 38.8°N  | 7–15 Nov                                                   | 16 Nov | +5 d     |
| Missouri                                  | 38.5°N  | 16 Nov                                                     | 17 Nov | +1 d     |
| Virginia                                  | 37.5°N  | 16 Nov                                                     | 18 Nov | +2 d     |
| Kentucky                                  | 37.5°N  | 8–15 Nov                                                   | 18 Nov | **+7 d** |

[Hunsaker et al. 2025, _Ecology and Evolution_ — breeding season and movement ecology of male whitetail, SW Wisconsin](https://onlinelibrary.wiley.com/doi/full/10.1002/ece3.71589) ·
[NJDEP — biology of the white-tailed deer](https://dep.nj.gov/njfw/hunting/biology-of-the-white-tailed-deer/) ·
[VA DWR — fawning dates are key to rut timing](https://dwr.virginia.gov/blog/virginias-deer-with-justin-folks-fawning-dates-are-key-to-rut-timing/) ·
[PGC — when is the rut](https://www.pa.gov/agencies/pgc/wildlife/discover-pa-wildlife/white-tailed-deer/when-is-the-rut) ·
[Alberta Wild — white-tailed deer](https://albertawild.com/species/white-tail-deer-hunting/)

**Two rows added in the same pass extend the flat band from 5.5° of latitude to
17°, which is what makes the constant safe to ship.** The table above originally
spanned only 37.5–43°N; **Alberta at 52–54°N peaks 10–21 November, i.e. _later_
than Illinois at 40°N**, and Pennsylvania at 41°N — the largest fetal-aging
dataset in the northeast, road-killed does 2000–2007 — has a median conception
of 11–17 November. Across **37°N to 54°N the peak moves by at most about a week
and does so non-monotonically.** A latitude ramp fitted over that band is
fitting noise. The Alberta row is the weaker of the two (agency/outfitter
summary, no n, index-level) and is carried as corroboration, not as an anchor;
the Pennsylvania row is 🟢 agency fetal aging.

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

| Region                         | Lat   | Published peak / mean conception | Model  | Error (d) |
| ------------------------------ | ----- | -------------------------------- | ------ | --------- |
| Midwest (IL/OH/IN)             | 40.0  | 10 Nov                           | 15 Nov | +5 ✅     |
| Missouri                       | 38.5  | 16 Nov                           | 17 Nov | +1 ✅     |
| West Virginia                  | 38.8  | 11 Nov                           | 16 Nov | +5 ✅     |
| Kentucky                       | 37.5  | 11 Nov                           | 18 Nov | +7 ✅     |
| Virginia                       | 37.5  | 16 Nov                           | 18 Nov | +2 ✅     |
| Tennessee, central             | 35.8  | 17 Nov                           | 20 Nov | +3 ✅     |
| Tennessee, east                | 36.0  | 25 Nov                           | 20 Nov | −5 ✅     |
| E Oklahoma (Cookson Hills)     | 35.7  | 17 Nov                           | 20 Nov | +3 ✅     |
| Arkansas, statewide            | 34.8  | 18 Nov                           | 21 Nov | +3 ✅     |
| **NC Unit I (west mountains)** | 35.7  | **5 Dec**                        | 20 Nov | **−15**   |
| NC Unit III                    | 35.5  | 8 Nov                            | 20 Nov | **+12**   |
| **NC Unit V (SE coastal)**     | 34.5  | **11 Oct**                       | 22 Nov | **+42**   |
| SC, statewide mean             | 33.8  | 30 Oct                           | 23 Nov | **+24**   |
| SC, Lower Coastal Plain        | 33.0  | 25 Oct                           | 26 Nov | **+32**   |
| GA — Clarke Co                 | 33.95 | 13 Nov (DVC wk 11/10–11/16)      | 22 Nov | +9        |
| GA — Appling Co                | 31.75 | 6 Nov (11/03–11/09)              | 30 Nov | **+24**   |
| GA — Bacon Co                  | 31.55 | 30 Oct (10/27–11/02)             | 1 Dec  | **+32**   |
| **GA — Atkinson Co**           | 31.30 | **23 Oct (10/20–10/26)**         | 1 Dec  | **+39**   |
| Alabama, north                 | 34.7  | 19 Nov                           | 21 Nov | +2 ✅     |
| **Alabama, southwest**         | 31.4  | **1 Feb**                        | 1 Dec  | **−62**   |
| Mississippi, statewide mean    | 32.8  | 1 Jan                            | 26 Nov | **−36**   |
| Mississippi Delta (median)     | 33.5  | 27 Dec                           | 24 Nov | **−33**   |
| **Mississippi, SE coastal**    | 31.0  | **mid-Feb**                      | 3 Dec  | **−74**   |
| Louisiana, areas 4/9 (SE)      | 30.7  | early–mid Dec                    | 4 Dec  | −6 ✅     |
| Louisiana, areas 1/5/6         | 31.5  | mid-Jan                          | 1 Dec  | **−45**   |
| TX Pineywoods, north           | 32.5  | 22 Nov                           | 27 Nov | +5 ✅     |
| TX Pineywoods, south           | 31.0  | 12 Nov                           | 3 Dec  | **+21**   |
| TX Cross Timbers, north        | 33.5  | 15 Nov                           | 24 Nov | +9        |
| TX Post Oak Savannah, central  | 31.0  | 10 Nov                           | 3 Dec  | **+23**   |
| TX Edwards Plateau, east       | 30.5  | 7 Nov                            | 4 Dec  | **+27**   |
| TX Edwards Plateau, west       | 30.0  | 5 Dec                            | 6 Dec  | +1 ✅     |
| TX Trans-Pecos                 | 30.5  | 8 Dec                            | 4 Dec  | −4 ✅     |
| **TX Gulf Prairies, north**    | 29.5  | **30 Sep**                       | 8 Dec  | **+69**   |
| TX Gulf Prairies, south        | 27.5  | 31 Oct                           | 15 Dec | **+45**   |
| TX South Texas Brush, east     | 27.5  | 16 Dec                           | 15 Dec | −1 ✅     |
| TX South Texas Brush, west     | 27.5  | 24 Dec                           | 15 Dec | −9        |
| FL — Camp Blanding (N)         | 29.9  | 2 Nov                            | 6 Dec  | **+34**   |
| **FL — Eglin AFB (NW)**        | 30.5  | **22 Feb**                       | 4 Dec  | **−80**   |
| FL — Tosohatchee (central)     | 28.5  | 7 Oct                            | 11 Dec | **+65**   |
| **FL — Rotenberger (S)**       | 26.4  | **10 Aug**                       | 19 Dec | **+131**  |

Sources for the rows above, in addition to those already cited:
[NCWRC peak conception dates (PDF)](https://www.ncwildlife.gov/media/4373/download?attachment=) ·
[SCDNR peak breeding dates](https://www.dnr.sc.gov/wildlife/deer/reproductionmap.html) ·
[GA DNR rut map (PDF)](https://georgiawildlife.com/sites/default/files/wrd/pdf/research/Georgia-Rut-Map.pdf) ·
[MDWFP breeding date map](https://www.mdwfp.com/wildlife-hunting/wildlife-species-program/deer-program/deer-breeding-date-map) ·
[MSU Deer Lab — ecology of the rut](https://www.msudeer.msstate.edu/ecology-of-the-rut.php) ·
[Turner et al. 2019, _Wildl. Soc. Bull._ — Alabama breeding chronology](https://wildlife.onlinelibrary.wiley.com/doi/abs/10.1002/wsb.1031) ·
[Outdoor Alabama / WFF county rut map](https://www.outdooralabama.com/node/3171) ·
[LDWF estimated deer breeding periods](https://www.wlf.louisiana.gov/page/deer-breeding-periods) ·
[TPWD — the rut in white-tailed deer](https://tpwd.texas.gov/huntwild/hunt/planning/rut_whitetailed_deer/) ·
Richter, A. R. & R. F. Labisky 1985, _J. Wildl. Manage._ 49:964–971 —
reproductive dynamics among disjunct white-tailed deer herds in Florida
(**primary; no reachable URL — see the citation-hygiene note under the seed
table**), reported via
[UF/IFAS EDIS — White-tailed Deer of Florida](https://journals.flvc.org/edis/article/view/114365)

**Three separate ways the function fails, each fatal on its own.**

1. **Same latitude, months apart.** At **30.5°N** the published peaks are 7 Nov
   (TX Edwards Plateau east), 8 Dec (TX Trans-Pecos), ~10 Dec (SE Louisiana) and
   **22 Feb** (Eglin AFB, Florida panhandle) — a **107-day spread at one
   latitude**. At **~31°N**: 30 Oct (GA Bacon Co) to **mid-Feb** (SE
   Mississippi) — **108 days**. At **~33°N**: 25 Oct (SC Lower Coastal Plain) to
   1 Jan (Mississippi) — **68 days**. At **27.5°N**, three Texas populations at
   _identical_ latitude peak 31 Oct, 16 Dec and 24 Dec — **54 days**. Any
   function of latitude returns one number for all of these.

2. **The sign of the gradient is wrong in the Atlantic South.** The model
   assumes southern ⇒ later. In **Georgia** the four county peaks readable from
   the agency PDF run Atkinson (31.30°N) 23 Oct → Bacon (31.55°N) 30 Oct →
   Appling (31.75°N) 6 Nov → Clarke (33.95°N) 13 Nov: **+7.9 days per degree
   _north_**, where the model applies **−3.5 days per degree north**. Wrong sign
   and 11.4 d/° off in magnitude. **North Carolina** is the same: Unit V (SE
   coastal) 11 Oct → Unit I (west mountains) 5 Dec, i.e. the _lowest_-latitude
   unit is **55 days earlier** than the highest, inside a state spanning 2.5° of
   latitude. **South Carolina** likewise runs Lower Coastal Plain 25 Oct → Upper
   Coastal Plain ~1 Nov → Piedmont mid-Nov. **Florida is the extreme case:** the
   _northernmost_ site sampled (Eglin AFB, 30.5°N) has the **latest** mean
   breeding date in the state (22 Feb) and the _southernmost_ (Rotenberger,
   26.4°N) the earliest (10 Aug) — **196 days apart, inverted**.

3. **Where the sign is right, the magnitude is 6× too small.** Alabama runs
   19 Nov in the north (34.7°N) to 1 Feb in the southwest (31.4°N): a real
   gradient of **−22.4 days per degree north**, against the model's −3.5.

> **The single sentence for the UI, if only one fits:** _South Carolina peaks
> 30 October and Mississippi peaks 1 January — both at ~33°N, 63 days apart —
> and inside Florida alone the range is 10 August to 22 February with the
> northernmost herd the latest of all._

**Recommendation:** north of **37°N** keep the photoperiod constant (DOY 314,
±8 d uncalibrated / ±4 d calibrated). South of it, **stop predicting from
latitude entirely.** Region lookup, or _unknown_. See the prescription block
below.

### 🔵 Why the South is heterogeneous — **the mechanism, and a correction to this register**

Pass 3 wrote that southern rut timing "is driven by herd genetics, restocking
history and local conditions". **That is stronger than the evidence supports and
is corrected here.** The one study that tested it directly reached a split
result:

Sumners et al. compared mtDNA and microsatellite differentiation between **6
pairs of adjacent populations whose breeding dates differ by a mean of 35 days**
and **4 pairs differing by ≤ 2 days**.

- **Biparental nuclear markers did _not_ separate them**: F<sub>ST</sub> = 0.028
  (SD 0.021) for the similar-date pairs vs 0.047 (SD 0.024) for the
  different-date pairs, **P = 0.200**. The straightforward "different stock ⇒
  different rut" story is _not_ supported at nuclear loci.
- **mtDNA lineages did differ more** between geographically proximate
  populations with differing breeding dates, implying a **maternal** genetic
  effect maintained by **female philopatry**. The authors advance the restocking
  legacy as a hypothesis — the paper's title ends in a question mark, and so
  should ours.

[Sumners et al. 2015, _J. Wildl. Manage._ 79:1213–1225 — Variable breeding dates among populations of white-tailed deer in the southern United States: the legacy of restocking?](https://wildlife.onlinelibrary.wiley.com/doi/10.1002/jwmg.954)

**Assessment.** The defensible statement is: _the photoperiod cue is universal,
but the **threshold** at which a given maternal lineage responds to it is
heritable and locally fixed by doe site-fidelity, so adjacent herds can differ by
weeks under identical day length._ Graded 🔵 — the differentiation is measured,
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

### 🔵 _Why_ the cue loses discriminating power southward — the daylength geometry, computed

The register asserts in several places that "the photoperiod signal itself
weakens toward the equator". That was never quantified, and it is quantifiable
exactly, from spherical astronomy rather than from biology. Computed here for
sunrise-to-sunset daylength with the standard −0.833° refraction/semi-diameter
correction:

| Latitude | Annual daylength amplitude (max − min) | Rate of change at the mid-Nov peak |
| -------- | -------------------------------------- | ---------------------------------- |
| 50°N     | **8.30 h**                             | −2.88 min/day                      |
| 45°N     | 6.85 h                                 | −2.36 min/day                      |
| 40°N     | 5.69 h                                 | −1.95 min/day                      |
| 36°N     | 4.90 h                                 | −1.67 min/day                      |
| 32°N     | 4.19 h                                 | −1.43 min/day                      |
| 28°N     | 3.55 h                                 | −1.21 min/day                      |
| 25°N     | 3.11 h                                 | −1.05 min/day                      |
| 18°N     | ~2.2 h                                 | ~−0.74 min/day                     |
| 10°N     | **1.17 h**                             | −0.39 min/day                      |

_(Reproducible: declination `23.44° · sin(2π(doy−81)/365.24)`, hour angle from
the standard sunrise equation. This is geometry, not a literature value, and it
is stated so it can be checked rather than believed.)_

**What it does and does not explain.** It explains the **southern edge** two rows
below: at 10°N the entire annual swing is ~70 minutes, so there is almost no
signal to entrain to, and the Costa Rica result follows. It explains why
selection on breeding date relaxes southward: the fitness cost of breeding "late"
falls as winters soften.

**It does _not_ explain the Deep South.** At 31°N the annual swing is still
~4 hours and the daily rate of change in mid-November is still ~1.4 min/day —
an ample, unambiguous cue. Deer in south Alabama receive a perfectly good
photoperiod signal and breed in **February** anyway; deer in coastal Georgia
receive the same signal and breed in **October**. That is the point: the cue is
present and adequate everywhere north of ~20°N, so the variation must live in the
_response threshold_, which is the previous row's finding. 🔵 — the geometry is
exact, the inference drawn from it is ours.

### 🟡 The rival explanation — adult sex ratio and buck age structure — is tested and _contradicted between regions_

Before accepting the maternal-lineage account above, the standard competing
hypothesis has to be dealt with, because if a user's own herd management moved
their peak, no static region table would ever be right for them. The literature
splits, cleanly and by region:

| Study                                         | Region                  | Result                                                                                                                                                                                                                                |
| --------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Diefenbach et al. 2019, _JWM_ 83(6):1368–1376 | Pennsylvania, 1999–2006 | Harvest regulation shifted the ≥2.5-yr : 1.5-yr male ratio from **1:3.7 (2002) to 1:1.59 (2006)** — and there was **no evidence of any change in the timing or variability of conception date**, productivity, or offspring sex ratio |
| Clemson-lineage work                          | Southern herds          | Unbalanced sex ratios and young buck age structure reported to **delay and protract** breeding; mature bucks said to biostimulate earlier, more synchronous oestrus                                                                   |
| Northern Michigan                             | Northern herds          | **No** biostimulation effect found                                                                                                                                                                                                    |
| MSU Deer Lab summary                          | Mississippi             | Shifts of **up to 30 days** in peak breeding date attributed to improved buck:doe ratio and age structure                                                                                                                             |

[Diefenbach et al. 2019, _J. Wildl. Manage._](https://wildlife.onlinelibrary.wiley.com/doi/10.1002/jwmg.21712) ·
[USGS record](https://pubs.usgs.gov/publication/70228057) ·
[MSU Deer Lab — ecology of the rut](https://www.msudeer.msstate.edu/ecology-of-the-rut.php)

**Assessment.** Graded 🟡 and explicitly _not_ modelled. The best-designed test —
a real management manipulation with before/after conception data, Pennsylvania —
found **nothing**, and the effect is claimed only where it cannot be separated
from the regional heterogeneity of the previous row. **Do not add a sex-ratio or
age-structure term to the rut model.** Two consequences that _are_ actionable:

1. It reinforces the region table rather than undermining it: the one place a
   30-day management-driven shift is claimed is Mississippi, which is also where
   the maternal-lineage effect is largest. The two are confounded.
2. It is a further argument for `offsetDays` calibration being the primary
   mechanism in the South. If a herd's peak really can move with management, only
   the user's own observations will catch it.

### 🟢 Region → peak-breeding lookup — **the seed table, assembled from agency sources**

Pass 2 established that the latitude-monotone form is wrong but left no
implementable alternative. This is that alternative. Every row is a published
agency or peer-reviewed figure; none is interpolated by us.

| Region                      | ~Lat    | Peak conception / breeding                                                                                                                                                                                       | Source class                                                                  | Source                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Midwest (IL and neighbours) | 40°N    | mean **10 Nov**; adults 8 Nov, yearlings 11 Nov, fawns 2 Dec                                                                                                                                                     | 🟢 fetal aging                                                                | [_Theriogenology_ 2017](https://www.sciencedirect.com/science/article/pii/S0093691X1730078X)                                                                                                                                                                                                             |
| South Carolina, statewide   | 33.5°N  | peak **30 Oct**; **83 %** of does bred **6 Oct – 16 Nov**                                                                                                                                                        | 🟢 agency fetal data                                                          | [SCDNR peak breeding dates](https://www.dnr.sc.gov/wildlife/deer/reproductionmap.html)                                                                                                                                                                                                                   |
| Georgia, by county          | 31–35°N | county peaks span **20 Oct – mid-Nov** in most of the state, **late Nov–Dec** in the south and coast. Examples: Atkinson **10/20–10/26**, Bacon **10/27–11/02**, Appling **11/03–11/09**, Clarke **11/10–11/16** | 🔵 DVC-derived, **validated against conception dates and GPS movement rates** | [GA DNR rut map (PDF)](https://georgiawildlife.com/sites/default/files/wrd/pdf/research/Georgia-Rut-Map.pdf) · [GA DNR rut map page](https://gadnrle.org/rut-map) · [SEAFWA method paper](https://seafwa.org/journal/2015/using-deer-vehicle-collisions-map-white-tailed-deer-breeding-activity-georgia) |
| Mississippi, statewide      | 33°N    | mean **1 Jan**, SD 13.4 d, mean range 46 d                                                                                                                                                                       | 🟢 agency fetal data                                                          | [MDWFP breeding date map](https://www.mdwfp.com/wildlife-hunting/wildlife-species-program/deer-program/deer-breeding-date-map)                                                                                                                                                                           |
| Alabama                     | 32°N    | most populations peak in **January**; conception varies **≥ 60 days between populations within one county**                                                                                                      | 🟢 peer-reviewed                                                              | [Turner et al. 2019, _WSB_](https://wildlife.onlinelibrary.wiley.com/doi/abs/10.1002/wsb.1031)                                                                                                                                                                                                           |
| Texas — Edwards Plateau     | 30°N    | **7 Nov** east, **24 Nov** central, **5 Dec** west                                                                                                                                                               | 🟢 agency                                                                     | [TPWD](https://tpwd.texas.gov/huntwild/hunt/planning/rut_whitetailed_deer/)                                                                                                                                                                                                                              |
| Texas — Gulf Prairies       | 28°N    | **30 Sep** north, **31 Oct** south                                                                                                                                                                               | 🟢 agency                                                                     | TPWD, as above                                                                                                                                                                                                                                                                                           |
| Florida, by zone            | 25–31°N | zone means span **22 Jul – 31 Jan**; within-area conception spread **9–110 days**, mean 45 d, most does within 60 d                                                                                              | 🟢 agency, biological data collected since 2009                               | [FWC statewide rut map (PDF)](https://myfwc.com/media/18766/statewide-rut-map.pdf) · [FWC "the truth about Florida's deer rut"](https://content.govdelivery.com/accounts/FLFFWCC/bulletins/22cf0b1)                                                                                                      |

**Pass-4 additions to the seed table.** Twelve further rows, at the resolution
the source publishes. Everything here is fetal-aged conception data unless the
row says otherwise.

| Region                                    | ~Lat      | Peak conception / breeding                                                                                                                                                                                                                                                                                                                                                                    | Source class                             | Source                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| North Carolina, 5 units                   | 34–36.5°N | **Unit V 11 Oct · Unit IV 30 Oct · Unit III 8 Nov · Unit II 20 Nov · Unit I 5 Dec**; statewide extremes reported as **4 Oct (east)** to **19 Dec (west)**                                                                                                                                                                                                                                     | 🟢 agency fetal data, county resolution  | [NCWRC estimated peak conception dates (PDF)](https://www.ncwildlife.gov/media/4373/download?attachment=)                                                                                                                                                                                                         |
| Virginia, statewide                       | 37.5°N    | peak conception ~**16 Nov**; most does in oestrus **10–25 Nov**; peak fawning 16 Jun (2019 and 2020)                                                                                                                                                                                                                                                                                          | 🟢 agency + VADS telemetry               | [VA DWR — fawning dates are key to rut timing](https://dwr.virginia.gov/blog/virginias-deer-with-justin-folks-fawning-dates-are-key-to-rut-timing/) · [Virginia Appalachian Deer Study](https://dwr.virginia.gov/blog/the-virginia-appalachian-deer-study-how-fawns-are-faring-west-of-the-blue-ridge-mountains/) |
| West Virginia                             | 38.8°N    | most does bred **7–15 Nov**                                                                                                                                                                                                                                                                                                                                                                   | 🟡 agency summary, no n given            | see the state-summary caveat below                                                                                                                                                                                                                                                                                |
| Kentucky, statewide                       | 37.5°N    | **8–15 Nov**, tight statewide                                                                                                                                                                                                                                                                                                                                                                 | 🟡 agency summary of fetal-rate analyses | KDFWR deer-program reports, _seen only in secondary summary — unread_                                                                                                                                                                                                                                             |
| Tennessee, by region                      | 35–36.5°N | **west 21 Nov · central 17 Nov · east 25 Nov**                                                                                                                                                                                                                                                                                                                                                | 🟡 agency summary                        | _unread at source_                                                                                                                                                                                                                                                                                                |
| Arkansas, statewide                       | 34.8°N    | mean **18 Nov ± ~7 d**; AGFC publishes deer-zone detail                                                                                                                                                                                                                                                                                                                                       | 🟡 agency summary                        | _unread at source_                                                                                                                                                                                                                                                                                                |
| E Oklahoma (Cookson Hills, McAlester)     | 35.7°N    | peak "just prior to **18 Nov**", from testes/epididymal histology, Nov 1972                                                                                                                                                                                                                                                                                                                   | 🟢 peer-reviewed                         | [Oklahoma Acad. Sci.](https://ojs.library.okstate.edu/osu/index.php/OAS/article/view/5012/4682)                                                                                                                                                                                                                   |
| Alabama, by county                        | 30.5–35°N | **north 13–25 Nov**; **Black Belt / central late Dec – mid Jan**; **southwest 25 Jan – 8 Feb**. ≥ **60 days** variation _within_ single counties                                                                                                                                                                                                                                              | 🟢 peer-reviewed + agency county map     | [Turner et al. 2019](https://wildlife.onlinelibrary.wiley.com/doi/abs/10.1002/wsb.1031) · [Outdoor Alabama — WFF rut map](https://www.outdooralabama.com/node/3171)                                                                                                                                               |
| Mississippi, by unit                      | 30.3–35°N | **late Nov** in NW counties → **mid-Feb** in SE counties (~80 d within one state); Delta median **27 Dec**; statewide mean 1 Jan                                                                                                                                                                                                                                                              | 🟢 agency, >20 yr of deer health checks  | [MDWFP](https://www.mdwfp.com/wildlife-hunting/wildlife-species-program/deer-program/deer-breeding-date-map) · [MSU Deer Lab](https://www.msudeer.msstate.edu/ecology-of-the-rut.php)                                                                                                                             |
| Louisiana, 10 deer areas                  | 29–33°N   | **Area 2 peak Nov**; **Areas 4 & 9 (Florida Parishes / SE) peak early–mid Dec**; **Areas 1, 5, 6 late rut in Jan**. Published as two-week peak windows, from fetal measurements                                                                                                                                                                                                               | 🟢 agency fetal data, area resolution    | [LDWF estimated deer breeding periods](https://www.wlf.louisiana.gov/page/deer-breeding-periods)                                                                                                                                                                                                                  |
| Texas, all ecoregions                     | 26–34°N   | Pineywoods **N 22 Nov / S 12 Nov** (total 21 Oct–5 Jan) · Post Oak **central 10 Nov / S 11 Nov** (30 Sep–16 Jan) · Cross Timbers **N 15 Nov / S 17 Nov** (13 Oct–17 Dec) · Edwards Plateau **E 7 Nov / central 24 Nov / W 5 Dec** · Trans-Pecos **8 Dec** (4 Nov–4 Jan) · Gulf Prairies **N 30 Sep / S 31 Oct** (**24 Aug**–30 Nov) · South Texas Brush **E 16 Dec / W 24 Dec** (9 Nov–1 Feb) | 🟢 agency, 16 study sites, 2,436 does    | [TPWD](https://tpwd.texas.gov/huntwild/hunt/planning/rut_whitetailed_deer/)                                                                                                                                                                                                                                       |
| Florida, 4 disjunct herds (peer-reviewed) | 26–30.5°N | mean breeding: **Rotenberger (S) 10 Aug · Tosohatchee (central) 7 Oct · Camp Blanding (N) 2 Nov · Eglin AFB (NW) 22 Feb** — "as much as **6 months asynchronous** among herds", n = 380 tracts, 1978–1981                                                                                                                                                                                     | 🟢 peer-reviewed fetal/tract data        | [Richter & Labisky 1985, _JWM_ 49:964–971](https://journals.flvc.org/edis/article/view/114365)                                                                                                                                                                                                                    |

**Richter & Labisky is the most important single citation in this section.** It
is peer-reviewed, it is conception-date data rather than an agency map, and it
contains the inversion outright: the **northernmost** Florida herd sampled has
the **latest** mean breeding date in the state. No latitude function of any
degree can fit four points where the extremes are 196 days apart and the sign
alternates.

> **Citation hygiene, checked because this row carries more weight than any
> other.** The four herd means (Rotenberger 10 Aug · Tosohatchee 7 Oct · Camp
> Blanding 2 Nov · Eglin AFB 22 Feb) and the sampling design (**380 reproductive
> tracts, July 1978 – January 1981, four sites**) were **independently
> re-verified in a separate search this pass** and match. **But the URL attached
> to this citation elsewhere in the section resolves to a UF/IFAS EDIS document
> ("White-tailed Deer of Florida"), not to _JWM_ 49:964–971.** The EDIS document
> is a secondary source reporting Richter & Labisky; the primary paper has no
> reachable URL from this environment and **has not been read**. The grade stays
> 🟢 because the numbers are confirmed by two independent secondary sources
> reporting the same primary study, but the link must not be presented as the
> paper. Do not cite the EDIS URL as if it were the _JWM_ article.

**The finding that kills latitude, stated as sharply as the data allows.**
Pass 2's example was Texas Gulf (30 Sep) vs Mississippi (1 Jan) at similar
latitudes. The Carolinas make it worse, because they remove the "different
state, different genetics" hand-wave:

> **South Carolina peaks 30 October. Mississippi peaks 1 January.
> Both sit at ~33°N. That is 63 days apart at the same latitude**, and Georgia —
> geographically _between_ them — has counties peaking in **late October** and
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
applied _after_ tier selection.

**Why T2 exists and matters.** A state-level answer is not a weaker answer, it is
usually a _wrong_ answer. Alabama's statewide "peak" is meaningless when
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
or study estimate of a _population mean_, not a date deer breed on. The
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

| Source                                                                                                     | What is still needed                              | Why it matters                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GA DNR rut map PDF](https://georgiawildlife.com/sites/default/files/wrd/pdf/research/Georgia-Rut-Map.pdf) | 155 of 159 county rows                            | Only **Appling 11/03–11/09, Atkinson 10/20–10/26, Bacon 10/27–11/02** are confirmed — they appear in the PDF's own indexed title text. Clarke 11/10–11/16 came from a pass-3 snippet. **Secondary summaries of this map actively contradict each other**: one says coastal counties peak 10–20 Oct (earliest in the state), another says southern and coastal areas peak "late November or December". Do not code either. |
| [FWC statewide rut map PDF](https://myfwc.com/media/18766/statewide-rut-map.pdf)                           | the zone table and zone geometry                  | Florida is the widest-spread state in the register and the only one where the inversion is peer-reviewed. The FWC zones are the implementation surface; Richter & Labisky gives the four anchor points.                                                                                                                                                                                                                   |
| [NCWRC peak conception dates PDF](https://www.ncwildlife.gov/media/4373/download?attachment=)              | per-county dates and per-county sample sizes      | The agency itself warns precision varies with n. The 5 unit dates are confirmed in text; the county table is not.                                                                                                                                                                                                                                                                                                         |
| KDFWR, TWRA, AGFC deer-program reports                                                                     | primary fetal data behind the KY / TN / AR rows   | Those three rows are 🟡 in the table above purely because they were seen only in secondary summary.                                                                                                                                                                                                                                                                                                                       |
| [Sumners et al. 2015](https://wildlife.onlinelibrary.wiley.com/doi/10.1002/jwmg.954) full text             | which population pairs, and the mtDNA effect size | The mechanism row's 🔵 grade rests on an abstract.                                                                                                                                                                                                                                                                                                                                                                        |

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

The model treats `peakBreedingDayOfYear` as both _the conception mean_ and _the
centre of the `PeakBreeding` phase_, and `calibrateOffset` hard-codes
`CHASING_CENTER = -6` days. Three sources measure the gap between mean
conception and peak observable rutting activity, and **they disagree by two
weeks**:

| Source                              | Offset of observable rut vs mean conception                                                                  | Basis                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| MDWFP, on its own breeding-date map | **−14 d** ("subtract about two weeks from the mean conception date to obtain the simulated peak rut period") | agency guidance over 20 yr of health-check data |
| Hunsaker et al. 2025, SW Wisconsin  | **−4 to −6 d** (movement rate topped out 4–8 Nov; conception-derived peak window 23 Oct – 12 Nov, 16 d long) | 188 GPS-collared males, 2017–2020               |
| GA DNR / UGA                        | **≈ 0 d** (DVC peak and conception peak "almost identical" in 3 counties)                                    | DVC vs fetal aging                              |

[MDWFP breeding date map](https://www.mdwfp.com/wildlife-hunting/wildlife-species-program/deer-program/deer-breeding-date-map) ·
[Hunsaker et al. 2025, _Ecology and Evolution_](https://onlinelibrary.wiley.com/doi/full/10.1002/ece3.71589) ·
[SEAFWA — DVCs to map breeding activity](https://seafwa.org/journal/2015/using-deer-vehicle-collisions-map-white-tailed-deer-breeding-activity-georgia)

**Assessment.** Our `-6` sits inside the best-instrumented estimate (Wisconsin
GPS), so it is not wrong — but it is _not_ settled, and the range **−14 … 0 d**
should be recorded rather than collapsed. Graded 🔵: the offset is measured
three times, by three methods, with no reconciliation. **Do not** silently
subtract 14 days from agency map values when seeding the region table — store
the agency figure as _mean conception_ and apply the offset once, explicitly,
at the phase layer, so the two can be re-tuned independently.

### 🟢 The model has a southern edge: below ~14–18°N there is no rut to predict

The reproductive season of white-tailed deer is hypothesised to be **aseasonal
south of about 14–18°N**, where annual variation in day length is small. A test
in a seasonally dry tropical forest in **Costa Rica** found year-round
reproduction, with the relative frequency of reproductive indicators driven by
**rainfall** rather than photoperiod — most births in the dry season, a second
peak late in the wet season.
[Reproduction of white-tailed deer in a seasonally dry tropical forest of Costa Rica: a test of aseasonality, _J. Mammalogy_ 2020, 101(1):241](https://academic.oup.com/jmammal/article-abstract/101/1/241/5655750)

`Odocoileus virginianus` ranges to Bolivia and Peru, so this is a real boundary
for a product that takes an arbitrary latitude. **Prescription:** `|lat| < 18°N`
returns UNKNOWN unconditionally with the note _"breeding is effectively
aseasonal at this latitude; rut phase is not defined"_. Currently the model
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
`conf ≤ 0.40` and the note _"introduced range, no conception-date data"_.

### 🔴 The `rutConfidence` scalar has no defined meaning — _new row, pass 4_

`rutConfidence(latitude): number` returns 0.2–0.9 and is documented in code as
"how much to trust the phase at this latitude, 0..1". **Nothing in the codebase
or in this register says what that number is the probability _of_.** An
undefined confidence is worse than none: it cannot be falsified, it cannot be
back-tested against the 40 rows above, and it renders as a chip a hunter reads
as odds. This is a 🔴 row about a number that is not a measurement of anything.

**Prescription — define it first, and the values then follow from measurement
rather than from taste:**

> `rutConfidence` = _the modelled probability that the true population mean
> conception date lies within **±7 days** of the returned date._

±7 d is chosen because it is the half-width of the 21-day window inside which
most breeding occurs (MSU Deer Lab), i.e. the tolerance at which being wrong
still changes where a hunter sits. Once defined this way the value is testable:
score it against the region table and it should be calibrated.

### 🔴 `rutConfidence` thresholds — measurably too generous, and keyed on the wrong variable

Returns **0.65 for 32–38°N**. From the error table, at 32–33°N the shipped model
is off by **+24 d (South Carolina), +32 d (SC Lower Coastal Plain), −33 d
(Mississippi Delta), −36 d (Mississippi statewide)**. A 0.65 confidence on a
one-month error is the single most misleading number in the rut model, because
0.65 reads to a user as "probably right".

Worse, **it is keyed on latitude, which pass 4 shows is not the variable that
predicts the error.** At 30.5°N the model is 4 days out in the Trans-Pecos and
80 days out at Eglin AFB; one latitude, one confidence, a twentyfold difference
in error. Confidence must key on **which tier answered**, not on latitude.

| Tier | Condition                                          | Now                | Recommended                             | Derivation                                                                      |
| ---- | -------------------------------------------------- | ------------------ | --------------------------------------- | ------------------------------------------------------------------------------- |
| T0   | user-calibrated, ≥ 3 seasons                       | n/a                | **0.90**                                | population annual mean SD = 4 d ⇒ P(\|err\| ≤ 7 d) ≈ 0.92 (Dye 2012)            |
| T3   | ≥ 37°N, no region hit                              | 0.90               | **0.70**                                | region-to-region spread of population means ≈ ±8 d ⇒ P(\|err\| ≤ 7 d) ≈ 0.6–0.7 |
| T1   | region hit at county / unit / ecoregion / zone     | n/a                | **0.55**                                | agency map resolution vs ≥ 60 d within-county variation (Turner 2019)           |
| T4   | 35–37°N interior/upland, no region hit             | 0.65               | **0.40**                                | TN/AR/OK cluster 17–25 Nov; NC at the same latitude does not                    |
| T2   | region hit at state resolution only, spread > 30 d | 0.65               | **0.25**, and return a range not a date | AL 13 Nov–8 Feb; MS late Nov–mid Feb                                            |
| T5   | < 37°N, no region hit                              | 0.65 / 0.40 / 0.20 | **refuse — return UNKNOWN**             | errors of −80 to +131 d are observed here                                       |
| T6   | \|lat\| < 18°N                                     | 0.20               | **refuse — UNKNOWN, permanently**       | breeding is aseasonal (Costa Rica)                                              |
| —    | southern hemisphere branch                         | inherits           | **cap at 0.40**                         | introduced range, no conception-date data                                       |

**Pass 3 recommended a floor of 0.15 for < 36°N. Pass 4 replaces that with a
refusal**, because 0.15 is still a number on a chip next to a date, and a date
that can be 131 days wrong should not be shown at all. `CLAUDE.md`: _"Grey out
layers whose inputs are unset rather than rendering a default."_ An
uncharacterised herd in south Georgia is an unset input.

The tier _cutpoints_ (37°N, 35°N, the 30-day state-spread threshold) remain
🔴 — they are a policy choice about how loud to be when we do not know, informed
by but not derived from the table. The **confidence values** attached to them
are now 🔵, derived from measured dispersions.

### 🔴 `calibrateOffset`'s ±14-day rejection clamp — **falsified by this pass's own evidence, and it fails hardest exactly where calibration is the only mechanism left**

_New row, pass 4._ `calibrateOffset()` computes a median offset from the user's
logged chasing observations and then discards it:

```ts
// Refuse implausible calibrations — more likely mislabelled observations
// than a herd that breeds three weeks off the regional norm.
return Math.abs(offset) > 14 ? undefined : offset;
```

The comment states a biological claim — _a herd does not breed three weeks off
the regional norm_ — and **every southern source in this section contradicts
it**:

| Evidence                                                  | Offset that actually occurs                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Sumners et al. 2015 — 6 pairs of **adjacent** populations | mean **35 days** apart                                                                                  |
| Turner et al. 2019 — within a **single Alabama county**   | **≥ 60 days**                                                                                           |
| NDA, summarising the same body of work                    | populations **< 30 miles apart** where the early herd _finishes_ breeding before the late herd _starts_ |
| MDWFP — within Mississippi                                | late Nov → mid-Feb, ~**80 days**                                                                        |
| Richter & Labisky 1985 — within Florida                   | **~6 months** among four herds                                                                          |
| FWC — within a single Florida _area_                      | conception spread **9–110 days**                                                                        |

**Consequence, and it is the worst kind — a silent one.** A hunter in south
Alabama or the Mississippi Delta whose herd genuinely peaks 40 days off the
regional figure logs three seasons of honest chasing observations, and
`calibrateOffset` returns `undefined`. The model then falls back to the regional
default that is 40 days wrong, **with no indication that the user's own data was
computed and thrown away.** `docs/BACKLOG.md` `I2` already promotes `offsetDays`
to the _primary_ mechanism south of ~37°N; a ±14-day clamp makes the primary
mechanism structurally unable to express the southern range it exists to serve.

**Prescription — concrete, with units and bounds:**

```
clamp bound:  ±14 d  ->  ±60 d          // covers the ≥60 d within-county
                                        // variation measured in Alabama
                                        // (Turner 2019); wider than the 35 d
                                        // adjacent-population mean (Sumners 2015)
on |offset| > 60 d:      still reject, and surface the rejection to the user
                         ("your observations imply a peak N days from the
                         regional figure; check the observation dates")
                         — never return `undefined` silently
minimum observations:    keep >= 3, but widen the plausibility test from a
                         fixed clamp to dispersion: reject when the
                         inter-observation spread exceeds ~45 d, which is the
                         measured within-population conception range
                         (Dye et al. 2012, mean range 46 d)
north of 37°N only:      a ±14 d clamp remains defensible — the region-to-region
                         spread of northern population means is ~±8 d, so a
                         14-day rejection band is ~1.75 SD there
```

Graded 🔴 because `14` was chosen by us, not measured; the **replacement 60** is
🔵, inferred directly from Turner et al.'s measured within-county variation. The
latitude-dependence of the clamp is the honest form: the same number cannot be
right in Pennsylvania and in Wilcox County, Alabama.

### 🟢 Moon phase does not drive the rut — _modelled by exclusion_

48 GPS-collared bucks in Mississippi, two years, 15-minute fixes: bucks averaged
~265 yards·h⁻¹ in daylight and **moon phase and moon position had no
statistically meaningful effect**; bucks respond to rut timing, time of day,
weather and hunting pressure.
[MSU Extension — Lunar legends](https://extension.msstate.edu/publications/lunar-legends-does-the-moon-influence-buck-activity) ·
[MDWFP — Moon myths vs deer reality](https://www.mdwfp.com/wildlife-hunting/private-lands-program/habitat-and-wildlife-information/moon-myths-vs-deer-reality-what-science-says)

**Citation replaced.** The previous register supported this 🟢 row with a Mossy
Oak blog post. The conclusion survives; the sourcing did not.

**Pass 4 upgraded the sourcing again, to the strongest form of this test.** The
two citations above measure _movement_; a lunar-rut claim is about _breeding_,
and that has now been tested directly against conception dates rather than
against activity:

> **Moon phase did not accurately predict conception date for either individuals
> or populations of deer**, in captive individuals (Texas and Mississippi) or in
> wild Mississippi populations. Body condition did not influence conception date
> at the population level either.
> [Dye et al. 2012, _Wildl. Soc. Bull._ 36:107–114](https://wildlife.onlinelibrary.wiley.com/doi/10.1002/wsb.98)

Two independent lines now converge: moon phase does not predict when deer breed
(Dye 2012, conception dates), and rut timing has not shifted in 29 years while
lunar phase relative to the calendar has (Ontario DVC, above). **Peer-reviewed,
on the exact quantity a lunar rut predictor would claim to forecast.** The
answer to the founder is still no, and it is now no with a conception-date study
behind it rather than an activity study.

**Decision recorded, and it is not up for reconsideration:** breeding is
photoperiod-driven, moon phase is not a rut predictor, and a lunar rut feature
would degrade every downstream analytic. If the founder asks again, the answer
is still no. Moon phase is stored as an observation covariate so users can test
it against their own data, and is never used as a predictor.

### 🔵 Moon phase and _movement_ — small, real, not worth predicting from

Distinct from the rut question and previously conflated with it. 38 GPS-collared
bucks, 30-minute fixes, Aug–Dec 2010–2012: solunar timing **did** shift activity
odds, and the shift **reversed sign with lunar phase** — near full/new moons
bucks were more likely to be active at moonrise/moonset and less likely at
overhead/underfoot; far from full/new the pattern flipped. The authors note the
hours around sunset remained when deer were most likely to be active.
[Sullivan & Ditchkoff 2016, _J. SE Assoc. Fish Wildl. Agencies_](https://seafwa.org/journal/2016/movement-moon-white-tailed-deer-activity-and-solunar-events)

**Assessment:** a phase-dependent sign reversal on top of a dominant crepuscular
signal is not a usable predictor — it is the shape of a result that will not
replicate, and the larger Mississippi study found no effect. Correct call to
record and not predict. 🔵 because "detectable but negligible" is our inference
from two studies that disagree in strength.

### 🔴 Peak breeding is the _worst_ week to sit (lockdown) — **downgraded from 🟡; GPS data contradicts it**

Pass 2 recorded this as strong consistent doctrine with no measurement. Pass 3
found measurement, and **it points the other way.** Doctrine that has been
tested and failed is not 🟡 doctrine any more; it is a folk claim with
contrary evidence, which is 🔴.

- Fine-scale GPS work on Pennsylvania bucks (15-minute fixes, Oct–Dec) found
  **no evidence of either an "October lull" or a peak-rut lockdown**; during
  peak rut the collared deer were "all over the place."
  [National Deer Association — Is the "lockdown phase" a myth?](https://deerassociation.com/lockdown-phase-myth/)
  **n = 3 bucks, one year, one state.** That is a weak study and it is cited
  here as a _direction_, not a refutation.
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
reduced _sightings_, collars measure increased _movement_, and both can be true
if bucks move more but predictably less past known stands. Do not present it as
settled in either direction.

### 🔵 Second-rut window — **the 28-day anchor is now sourced** _(was unverified)_

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
[Reproductive management in white-tailed deer, _Agroproductividad_](https://revista-agroproductividad.org/index.php/agroproductividad/en/article/download/2063/1687/8266)

**Consequence for the parameter.** A 25–28 day cycle implies a second-rut peak
at **+25 to +28 days**, not a window centred on +31. Our `+24 to +38` is skewed
late by about a week and runs ~4 days past even the widest cycle length.
**Recommended:** `SecondRut = +24 … +31 d`, peak +27. 🔵 rather than 🟢 because
the cycle length is measured but "second rut" as an observable hunting
phenomenon is the doctrine layer on top of it — and note the cycling data above
implies a _third_ and _fourth_ recurrence too, which nobody hunts, so the
phenomenon's practical size is unmeasured.

### 🔵 The _outer_ rut window is measured — 16–21 days _(new; split out of the 🔴 row below)_

Pass 3 recorded every phase-window day count as invented. Pass 4 found the
envelope, twice, by two methods:

- **Changepoint analysis of daily movement rates** on 188 GPS-collared males,
  SW Wisconsin, 15 Oct – 1 Dec, 2017–2020: peak breeding season **23 Oct –
  12 Nov**. **Peak rut length was 20–21 days from movement metrics and 16 days
  from conception dates**, with little variation among age classes or metrics.
  Mean movement rate peaked in the week of **5–11 Nov**; 2-year-olds moved most;
  firearm-season opening weekend had no significant effect.
  [Hunsaker et al. 2025, _Ecology and Evolution_](https://onlinelibrary.wiley.com/doi/full/10.1002/ece3.71589)
- Independently: within any region, breeding duration is **30–45 days**, with
  **most breeding inside a 21-day window centred on the peak**.
  [MSU Deer Lab — ecology of the rut](https://www.msudeer.msstate.edu/ecology-of-the-rut.php)

**Consequence for the parameter.** Our windows put `Seeking` through
`PostRut` at −21…+24 d, a 45-day envelope. That matches the _duration_ figure
but is roughly **twice** the 16–21 day measured peak. The huntable core is
narrower than we render it. **Recommended:** keep the outer envelope at
−21…+24 d (matches the 30–45 d duration), but mark the **±10 d band around peak
as the measured high-odds window** and let the UI distinguish the two. 🔵 rather
than 🔵🟢 because the Wisconsin result is one site at 43°N and the MSU figure is
a lab summary rather than a primary table.

**Scope caution:** both are northern/tight-window populations. In Florida, an
area's own conception spread runs **9–110 days (mean 45)**; a 21-day core does
not exist there, and the phase model should widen or refuse alongside
`peakBreedingDay`.

### 🔴 The _internal_ phase day counts (seeking −21…−10 d, chasing −10…−2 d, lockdown −2…+8 d)

Our own partition of a continuous process. Ordering is doctrine; the internal
boundaries are invented. **Re-searched across three passes; still no source**
giving separate durations for seeking versus chasing. The only durations anyone
measures are the envelope above and the two physiological ones — oestrus 24–30 h
and the tending bond ~24 h — and neither sets a multi-day internal boundary.
Everything except `SecondRut` and the outer envelope stays 🔴.

**Queries (cumulative across passes 2–4):** `white-tailed deer rut seeking
chasing tending lockdown duration days GPS collar breeding chronology phases` ·
`National Deer Association lockdown phase myth GPS collar buck movement` ·
`white-tailed deer estrous cycle length days estrus duration recurrence peer
reviewed` · `buck movement rate peaks days before peak conception GPS collar
chasing phase timing relative to breeding date` · `"Breeding Season and Movement
Ecology of Male White-Tailed Deer in Southwest Wisconsin" peak movement date
conception excursions`.

### Rut-model parameters for other species — sourced, and all wrong for whitetail dates

The transfer table further down grades species scope; these are the numbers
behind its "Rut timing ❌❌❌" row, so the register does not have to assert it
without a source.

| Species                   | Rut / breeding peak                                                                                    | Gestation                                   | Source class                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------- |
| Elk (_Cervus canadensis_) | rut mid-Sep – mid-Oct; **peak within 5–10 days of the autumnal equinox**; >70 % of cows bred by 15 Oct | ~245 ± 10 d; calving peak ~7 Jun            | 🟡 agency / club summaries      |
| Mule deer (_O. hemionus_) | breeding peak **late Nov – mid-Dec**                                                                   | ~204 d; births 16 Jun – 6 Jul, most in June | 🟡 agency / reference summaries |
| White-tailed deer         | DOY 314 ± 8 (≥ 37°N)                                                                                   | ~200 d                                      | 🟢 (this section)               |

[Montana FWP — reproductive strategies (PDF)](https://fwp.mt.gov/binaries/content/assets/fwp/montana-outdoors/2016/reproductivestrategies.pdf) ·
[TWRA — elk in Tennessee](https://www.tn.gov/twra/wildlife/mammals/large/elk.html) ·
[Texas Tech NSRL — Mammals of Texas, _Odocoileus hemionus_](https://www.depts.ttu.edu/nsrl/mammals-of-texas-online-edition/Accounts_Artiodactyla/Odocoileus_hemionus.php)

**DOY 314 is ~7 weeks wrong for elk.** The rut model must either refuse for
non-whitetail species or carry a species parameter; it currently does neither
and has no species input at all.

---

## Weather covariates

### 🟡 Barometric pressure — _trend_, not absolute

Peer-reviewed GPS work finds pressure effects that are real but small,
inconsistent, and season/hour-specific: pressure affected female movements in
spring at 01:00 and summer at 02:00, and male movements in winter at 13:00.
[Webb et al. 2010, _Int. J. Ecology_](https://onlinelibrary.wiley.com/doi/10.1155/2010/459610)
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
add temperature (and temperature _departure from seasonal normal_, which is what
the doctrine actually claims) as a first-class covariate.

### 🔴 Pressure-trend band cutpoints (±1, ±3 hPa) — **re-attacked; stays 🔴**

Invented. Re-searched for a pressure _tendency magnitude_ tied to deer activity.
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

### 🟢 Roughly a third of bucks are mobile, not resident — _now properly cited_

Central Mississippi, 30 adult bucks, GPS 2017–2021: **67 % sedentary (mean home
range 361 ha)** and **33 % mobile (mean 6,530 ha)** — an eighteen-fold
difference in strategy within one population. Mobile bucks' home ranges were
separated by a mean of **7.1 km**, with a mean **78 days** in one segment before
shifting. Sedentary bucks made **5.9 excursions per year**, mobile bucks **0.8**,
peaking in the breeding season and early spring.
[Rutting and rambling — _Ecology and Evolution_ 2024](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10862164/)

The previous register carried these numbers with no citation. This is the
primary source.

**Assessment:** a third of the population will not be described by any
property-scoped model, and the app currently implies every deer is resident.
**Action:** `BACKLOG N12`.

### 🟡 Mature buck = ≥ 3.5 years

Management convention, used in the analytics filter. Widely adopted; the
threshold is conventional, not derived.

### 🟡 Species scope — _resolved into a transfer table (was 🔴)_

The product claims "deer or other large game". Every behavioural parameter is
whitetail- or doctrine-derived. Per-parameter transfer, stated rather than
silent:

| Parameter                               | Mule deer                     | Blacktail    | Elk                                                  | Basis                                                                                                        |
| --------------------------------------- | ----------------------------- | ------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Energetics curve (`C₀`, `k_up`, `k_dn`) | ✅ re-run allometry at ~70 kg | ✅ at ~55 kg | ⚠️ ~250 kg is outside the 35–100 kg measured bracket | body-mass model, not species model                                                                           |
| Anisotropic / oblique travel            | ✅                            | ✅           | ✅                                                   | measured across six mountain-ungulate species                                                                |
| Slope flows & thermal phase             | ✅                            | ✅           | ✅                                                   | meteorology, not biology                                                                                     |
| Bedding slope & bench geometry          | ❌                            | ❌           | ❌                                                   | unmeasured for _any_ species; elk band differs from our value                                                |
| Leeward bedding geometry                | ⚠️                            | ⚠️           | ❌                                                   | whitetail hill-country doctrine; elk bedding doctrine differs (north slopes, wallows, timber edges)          |
| Winter conifer / insolation finding     | ❌                            | ❌           | ❌                                                   | Minnesota whitetail, deep snow, female                                                                       |
| Rut timing model                        | ❌                            | ❌           | ❌                                                   | **elk rut peaks mid-to-late September; mule deer mid-November to December.** DOY 314 is simply wrong for elk |
| Home range / core-area scale            | ❌                            | ❌           | ❌                                                   | elk range is an order of magnitude larger                                                                    |
| NLCD resistance table                   | ❌                            | ❌           | ❌                                                   | tuned on eastern-deciduous assumptions                                                                       |

**Measured species difference we should honour:** where mule deer and whitetail
are sympatric in NE Washington, **white-tailed deer were more likely to occupy
shallower slopes and lower elevations** than mule deer.
[Staudenmaier et al. 2021, _Ecosphere_](https://esajournals.onlinelibrary.wiley.com/doi/10.1002/ecs2.3813)
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

Their _biological interpretation_ — that a Wood `Pass` is a deer crossing, that
a Weiss class 2 is a travel corridor — is 🟡 **Doctrine**, and that distinction
is the whole point of this register.

---

## Priority actions

| #   | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Grade change                      | Backlog            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------ |
| 1   | Replace `toblerSpeed` with the cervid energetics curve above (`C₀ 2.6`, `k_up 26`, `k_dn 8`, floor 0.55), switching the currency from time to energy                                                                                                                                                                                                                                                                                                                                                                                   | 🔴 → 🔵/🟢                        | `N8`               |
| 2   | **Close `N9` as not-supported.** The escape-terrain citation is a human Fitbit study and the concept is mountain-sheep-specific                                                                                                                                                                                                                                                                                                                                                                                                        | 🟢 → 🔴                           | `N9`               |
| 3   | **Fix the rut model south of 37°N — superseded by pass 4 and now fully specified.** DOY 319 → **314 ±8** at ≥ 37°N; six-tier resolution ladder (T0–T6) in the rut section; **refuse** rather than return 0.15 below 37°N with no region match; refuse permanently below 18°N                                                                                                                                                                                                                                                           | 🔴 → 🟢 (north) + refusal (south) | `R9`               |
| 4   | Resolve the bedding contradiction: bench geometry (gentle pad, steep ring) instead of a 22° single-cell Gaussian. **Pass 3 resolved the direction — the pad side wins, so this is a re-centring, not a rewrite.** Interim if unimplemented: `idealSlopeDeg 22 → 12`, `slopeToleranceDeg 14 → 10`                                                                                                                                                                                                                                       | 🔴 → 🟡                           | new                |
| 5   | Surface `Confidence` chips on bedding, thermal, scent and rut outputs — four of the five headline layers are 🔴-driven                                                                                                                                                                                                                                                                                                                                                                                                                 | —                                 | `N10`              |
| 6   | Make the scent cone stability-dependent, and fix the inversion (the night/thermal cone is currently the _widest_)                                                                                                                                                                                                                                                                                                                                                                                                                      | 🔴 → 🔵                           | `N11`              |
| 7   | Add a snow term to the cost surface (Parker 1984; Sullender 2023) — the largest missing physical driver                                                                                                                                                                                                                                                                                                                                                                                                                                | none → 🟢                         | new                |
| 8   | Add temperature as a first-class covariate; it explains ~55 % of movement variation and we show pressure instead                                                                                                                                                                                                                                                                                                                                                                                                                       | none → 🟢                         | new                |
| 9   | Narrow the product claim to white-tailed deer, or scope per species per the transfer table                                                                                                                                                                                                                                                                                                                                                                                                                                             | 🔴 → 🟡                           | `N13`              |
| 10  | Handle the ~⅓ of bucks that are mobile rather than resident                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —                                 | `N12`              |
| 11  | Obtain NLCD resistance values from Lilly et al. 2025 rather than inventing them                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 🔴 → 🔵                           | `I4`               |
| 12  | Label every layer with the region its evidence comes from; nothing is validated in the Appalachians                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                 | new                |
| 13  | Obtain GPS-collar data to settle bedding geometry, corridor use and shelter                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 🔴 → 🟢                           | `I3`               |
| 14  | **Ship the region → peak-breeding lookup.** Seed table is now **20 rows** covering IL/Midwest, VA, WV, KY, TN, AR, E OK, NC (5 units), SC, GA, AL, MS, LA (10 areas), TX (7 ecoregions), FL (4 peer-reviewed herds + zones). Ship the confirmed rows; **do not code the 155 unread GA counties or the FL zone table from snippets**                                                                                                                                                                                                    | 🔴 → 🟢                           | `R9`, blocks 3     |
| 21  | **Define `rutConfidence` before changing its values.** It is currently the probability of nothing. Define as _P(true population mean conception within ±7 d of the returned date)_, then apply the tier table — confidence keys on **which tier answered**, never on latitude                                                                                                                                                                                                                                                          | 🔴 → 🔵                           | `R9`               |
| 22  | **Return a range, not a midpoint, wherever only a state-resolution match exists** in AL, MS, LA, FL, TX, NC, GA. A state midpoint in Alabama is right in the north and 11 weeks early in the southwest                                                                                                                                                                                                                                                                                                                                 | —                                 | `R9`               |
| 23  | **Refuse below 18°N** (aseasonal breeding, Costa Rica) and **cap southern-hemisphere confidence at 0.40**. The model currently returns DOY 410 at 10°N and reports a phase                                                                                                                                                                                                                                                                                                                                                             | 🔴 → 🟢 / 🔵                      | `R9`               |
| 24  | **Store agency figures as _mean conception_ and apply the observable-rut offset once, explicitly, at the phase layer.** The offset is disputed: −14 d (MDWFP) / −4…−6 d (Hunsaker 2025 GPS) / ≈0 d (GA DVC). Our `CHASING_CENTER = −6` is inside the best-instrumented estimate; keep it, record the range                                                                                                                                                                                                                             | 🔴 → 🔵                           | `R9`               |
| 25  | Mark the **±10 d band around peak** as the measured high-odds window (16–21 d, Hunsaker 2025; 21 d, MSU) inside the existing 45-day envelope, and widen or refuse it in Florida where an area's own spread is 9–110 d                                                                                                                                                                                                                                                                                                                  | 🔴 → 🔵                           | `R9`               |
| 15  | **`transitionMinutes` → `{ morning: 110, evening: 35 }`, forward-offset not centred.** Cheapest measured correction in the register                                                                                                                                                                                                                                                                                                                                                                                                    | 🔴 → 🟢                           | new                |
| 16  | **Fix the slope double-count in `beddingLikelihood`.** `slopeTerm × coverTerm(TRI)` counts slope twice because TRI is slope-correlated; swap TRI for Sappington VRM at a coarser window                                                                                                                                                                                                                                                                                                                                                | 🔴 → 🔵                           | new                |
| 17  | Set the terrain-shelter upwind search radius to **500 m** (measured optimum for distance-limited TOPEX)                                                                                                                                                                                                                                                                                                                                                                                                                                | 🔴 → 🔵                           | new                |
| 18  | Add a season/temperature-weighted **solar-aspect** term to bedding; leeward-only points at the deepest snow on a south wind in January                                                                                                                                                                                                                                                                                                                                                                                                 | none → 🟡                         | new                |
| 19  | `SecondRut` window `+24…+38 d` → **`+24…+31 d`**, peak +27, from the 25–28 d oestrous cycle                                                                                                                                                                                                                                                                                                                                                                                                                                            | 🔴 → 🔵                           | new                |
| 20  | Soften the `PHASE_NOTES` lockdown claim to record the sightings-vs-movement disagreement rather than assert it                                                                                                                                                                                                                                                                                                                                                                                                                         | 🟡 → 🔴                           | new                |
| 26  | **Correct the Lang & Gates snow figure everywhere it is quoted.** "18.1 vs 42.0 cm" is a mean against a maximum; the like-for-like figures are 18.1 SE / 21.7 NE (1.20×), with the sheltered bottomland lowest of all at 11.2 cm. Present in `docs/BACKLOG.md`'s `R31` row and in this register's own pass-3 changelog. **This is the number the case for raising the aspect weight rests on**                                                                                                                                         | 🟢 (corrected)                    | `R31`              |
| 27  | **`R31` fix: ramp the bedding shelter floor 0.25 → 0.65 on the existing `coldBlendWeight`**, engaging at +5 °C and saturating at −10 °C. Do **not** raise `BEDDING_MAX_SOLAR_ASPECT_WEIGHT`. Target on `R31`'s opposing planes: sun face ahead by ~1.15×, not 1.9× either way                                                                                                                                                                                                                                                          | 🔴 → 🔵 (direction)               | `R31`              |
| 28  | **Land `R27` (`castShadows` wiring) before item 27.** Raising the solar side of the trade while the insolation field ignores terrain shadow amplifies an existing error onto the exact ground it decides                                                                                                                                                                                                                                                                                                                               | —                                 | `R27` blocks `R31` |
| 29  | **Feed `windSpeedKph` into `beddingLikelihood`.** The correct shelter weighting spans the whole plausible range with wind speed (Parker & Gillingham: at 15 m·s⁻¹ wind swamps solar "regardless of incident solar levels"), and the engine reads only `windFromDeg`. Any fixed floor is a hidden wind-speed assumption                                                                                                                                                                                                                 | 🔴 → 🔵                           | new                |
| 30  | **Record the whitetail cold-cover disagreement in the UI, do not resolve it.** PLOS One 2013 (MN, 12 yr): colder → more open. Courbin et al. 2017 (Anticosti): cold stress → more thermal cover. Both peer-reviewed, both northern whitetail                                                                                                                                                                                                                                                                                           | —                                 | `R10`              |
| 31  | **Decide day-vs-night explicitly.** Every shelter-dominant citation is a night-bed or whole-range source; the only daytime-specific one prescribes south/west slopes. The layer is used in daylight by accident, not by decision                                                                                                                                                                                                                                                                                                       | —                                 | new                |
| 32  | Measure the realised distribution of `coverTerm` on a real tile — VRM saturating at 0.06 against a natural range of 0–0.4 likely pins it at ceiling across most hill country                                                                                                                                                                                                                                                                                                                                                           | —                                 | `R33`              |
| 33  | **Promote the two bedding floors to named exported constants.** `0.25` and `0.40` are bare literals at `wind.ts:545` and `:562`. No value change — they are 🔴 and must not be tuned on taste — but they are currently ungreppable, unoverridable by `BeddingOptions`, and invisible to any consumer that wants to report them                                                                                                                                                                                                         | —                                 | pass 6             |
| 34  | **Compute the two floors as Manly selection ratios** once observations exist. `1/f` is the best-vs-worst ratio the engine asserts: **2.5× for cover, 4× for shelter**. `packages/shared` already computes selection ratios against a `TerrainProfile`; this is the cheapest path from 🔴 to 🔵 for either row and needs no new literature                                                                                                                                                                                              | 🔴 → 🔵                           | pass 6             |
| 35  | **The engine asserts wind shelter is a stricter bed requirement than concealment (4× vs 2.5×) and nobody chose that.** It fell out of two literals set in different commits. Decide the ordering deliberately, or set both floors equal until there is evidence to separate them                                                                                                                                                                                                                                                       | —                                 | pass 6             |
| 36  | **The cover term's monotonicity conflicts with two measured results and with Ridgeline's own leeward rationale.** Red deer select _intermediate_ visibility (Zong 2023); horizontal visibility, not concealment, drove whitetail fawn bedsite use and _lowered_ predation odds (Obermoller). Meanwhile the leeward term is justified by "watch downhill, smell uphill", which needs a sightline. **Do not invert the term** — VRM is terrain, the studies are vegetation — but stop presenting more ruggedness as monotonically better | —                                 | pass 6             |
| 37  | **Read Zong et al. 2023 and its Dryad datasets.** The only located lead that could yield a _fitted curve_ for the cover term rather than a direction. Open-access PDF + two Dryad deposits                                                                                                                                                                                                                                                                                                                                             | 🔴 → 🔵/🟢                        | pass 6             |
| 38  | **Read Armstrong, Euler & Racey 1983, _JWM_ 47:880–884.** It compared **day and night beds** in central Ontario and is the single most relevant unread paper to the day-vs-night gap logged in pass 5 (item 31). A PDF surfaced this pass at `originalwisdom.com`                                                                                                                                                                                                                                                                      | —                                 | pass 6             |
| 39  | **Fix two stale source comments in `wind.ts`.** `BEDDING_MAX_SOLAR_ASPECT_WEIGHT` still quotes the retracted "18.1 vs 42.0 cm"; `BEDDING_RING_MIN_SLOPE_DEG` still calls 15° "the bottom of the BC WHR band" (it is the centre; the bottom is 5.7°). Both were retracted in pass 5 and survive only in the code                                                                                                                                                                                                                        | —                                 | pass 6             |
| 40  | **Restate `BEDDING_RING_MIN_DATA_FRACTION`'s comment.** It claims to be pinned to `detectBenches`' `samples >= 8 of 16`; the two tests use different denominators and **do** diverge at tile borders. The behaviour is correct and intentional; the claim of equivalence is not                                                                                                                                                                                                                                                        | —                                 | pass 6             |

Item 13 would resolve more red rows than everything else combined. Items 2, 3
and **26** are corrections to things we currently state confidently and wrongly,
and should go first. Items 14–17 and 19 are the pass-3 additions that come with
a number attached and are therefore the cheapest to land. **Items 27–29 are
ordered and must stay ordered: 28 before 27, and 29 supersedes 27 whenever a
wind speed becomes available.**

---

## Pass-3 changelog

| Row                            | Before                       | After                                                                           | Why                                                                                                                                        |
| ------------------------------ | ---------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `idealSlopeDeg: 22`            | 🔴 "settled, no literature"  | 🟡 with a recommended value of **12°**                                          | BC WHR 10–45 % band + Rowland 2018 monotone slope response + convergent flat-pad doctrine                                                  |
| Bedding vs bench contradiction | open, direction unknown      | **resolved in favour of the gentle pad**                                        | nothing found supports a slope _optimum_ for any cervid                                                                                    |
| Thermal transition window      | 🔴 guessed 90/30 min         | 🟢 **measured 110/35 min**, forward-offset                                      | El Gdachi et al. 2024 + two corroborating studies                                                                                          |
| Cover term `ruggedness / 4 m`  | 🔴 "invented, no literature" | concept 🔵, index choice 🔵, constant 🔴 — **plus a slope double-count defect** | Riley 1999 design intent; Sappington 2007 VRM                                                                                              |
| Terrain shelter radius         | not registered               | 🔵 **500 m**                                                                    | distance-limited TOPEX tested against 7 radii                                                                                              |
| `SecondRut` +24…+38 d          | unverified                   | 🔵 **+24…+31 d**                                                                | oestrous cycle 25–28 d, sourced                                                                                                            |
| Warm-aspect winter selection   | not registered               | 🟡, and it **conflicts with our leeward-only aspect term**                      | four agencies + ~~measured 18 vs 42 cm snow by aspect~~ ⚠️ **pass 5: that comparison was a mean against a maximum — see pass-5 changelog** |
| Rut region lookup              | "recommended, no data"       | 🟢 **eight-row seed table**                                                     | SCDNR, GA DNR, MDWFP, TPWD, FWC, Turner 2019                                                                                               |
| Lockdown doctrine              | 🟡                           | 🔴                                                                              | GPS collar data contradicts it                                                                                                             |
| `impassableSlopeDeg: 55`       | 🔴                           | 🔴 **(with reason)**                                                            | the cervid slope literature has no thresholds at all, by construction                                                                      |
| Scent-detection distance       | 🔴                           | 🔴 **(with reason)**                                                            | only anatomy is measurable; the media metre-values have no primary source                                                                  |
| Pressure cutpoints             | 🔴                           | 🔴 **(with reason)**                                                            | doctrine's own threshold is ~5× ours; neither is measured                                                                                  |

---

## Pass-4 changelog — `R9`, rut regionalisation

| Row                                                         | Before                                         | After                                             | Why                                                                                                                                                                                        |
| ----------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Latitude interpolation                                      | 🔴 "wrong functional class", 5 example regions | 🔴 **scored against 40 published regional peaks** | +1…+7 d at ≥ 37°N; **−80 to +131 d** below it. Three independent failure modes quantified: 107 d spread at one latitude, **wrong gradient sign** in GA/NC/SC/FL, **6× too small** in AL    |
| "Southern timing is driven by herd genetics and restocking" | asserted flatly by pass 3                      | 🔵 **corrected and hedged**                       | Sumners et al. 2015 found nuclear F<sub>ST</sub> did **not** differ (P = 0.200); only mtDNA did. Maternal lineage + female philopatry, restocking as hypothesis. This register overclaimed |
| "±4 days" northern uncertainty                              | unsourced                                      | 🟢 **two dispersions, both measured**             | Dye 2012: population annual mean SD **4 d**; individual SD **13.4 d**, range 46 d. So **±8 d uncalibrated, ±4 d calibrated**                                                               |
| Photoperiod mechanism                                       | correlation only                               | 🟢 **physiological mechanism + 29-yr stability**  | Verme & Ozoga 1987 (long days delay puberty); melatonin advances oestrus 37–119 d; Ontario DVC — no timing change 1988–2016, region the only surviving predictor                           |
| Moon phase does not drive the rut                           | 🟢 on _movement_ studies                       | 🟢 on **conception dates**                        | Dye 2012: moon phase did not predict conception date for individuals or populations. Tested on the exact quantity a lunar predictor claims                                                 |
| Region seed table                                           | 8 rows                                         | 🟢 **20 rows**, resolution-labelled               | + NC (5 units), VA, WV, KY, TN, AR, E OK, AL county, MS unit, LA (10 areas), TX (7 ecoregions), **Richter & Labisky 1985** (4 FL herds, peer-reviewed, 6 months asynchronous)              |
| `rutConfidence`                                             | 🔴 "too generous"                              | 🔴 **"the probability of nothing"** — new row     | Undefined semantics is the deeper defect. Defined as P(\|err\| ≤ 7 d); values re-derived per **tier**, not per latitude                                                                    |
| `rutConfidence` < 36°N                                      | pass 3 said 0.15                               | **refuse**                                        | 0.15 is still a date on a chip. −80 to +131 d errors mean UNKNOWN                                                                                                                          |
| Southern edge of the model                                  | not registered                                 | 🟢 **aseasonal below ~14–18°N**                   | Costa Rica test of aseasonality. Model currently returns DOY 410 at 10°N                                                                                                                   |
| `southernHemisphere` 182-d shift                            | not registered                                 | 🔵 **roughly right, cap conf 0.40**               | NZ whitetail rut mid-Apr–early Jun vs shifted prediction 11 May; introduced range, no conception data                                                                                      |
| Phase window day counts                                     | all 🔴                                         | **split**: outer envelope 🔵, internals 🔴        | Hunsaker 2025 — peak rut **16–21 d** (188 GPS males); MSU — most breeding in a **21-d** window. Seeking-vs-chasing boundary still has no source after three passes                         |
| Mean conception vs huntable peak                            | conflated                                      | 🔵 **disputed, range recorded**                   | −14 d (MDWFP) / −4…−6 d (Hunsaker) / ≈0 d (GA DVC). Our −6 survives, inside the GPS estimate                                                                                               |
| GA county + FL zone tables                                  | "read the PDFs before implementing"            | **confirmed unreachable**, ledger filed           | `curl` 403 at CONNECT for both hosts. Only 3 GA counties are confirmed, from the PDF's indexed title. Secondary summaries of the GA map **contradict each other** on coastal timing        |
| Elk / mule deer rut dates                                   | asserted in the transfer table                 | 🟡 **sourced**                                    | elk peak within 5–10 d of the autumnal equinox; mule deer late Nov–mid Dec. DOY 314 is ~7 weeks wrong for elk                                                                              |

---

## Pass-5 changelog — `R31`, shelter vs solar aspect, and the ungraded bedding set

| Row                                                                                                                                                                                                                          | Before                                                           | After                                                                                     | Why                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lang & Gates snow depths                                                                                                                                                                                                     | "18.1 cm SE vs **42.0 cm** NE", quoted as the measured mechanism | 🟢 **corrected: 11.2 bottomland / 18.1 SE / 21.7 NE (means); 42.0 was the study maximum** | A mean was being compared against a maximum, inflating the aspect effect from **1.20× to 2.32×**. The same study's **sheltered bottomland had the shallowest snow of all three sites**, a 10.5 cm advantage ≈ 3× the aspect effect                           |
| Armstrong, Euler & Racey 1983                                                                                                                                                                                                | credited with "NE 21.7 / SE 18.1 cm"                             | **mis-attribution retracted**                                                             | Those are Lang & Gates' figures. No numeric result from Armstrong et al. has ever been read here; the paper is real and remains found-but-unread                                                                                                             |
| `R31` premise ("four agencies prescribe shelter")                                                                                                                                                                            | treated as supporting the engine's shelter term                  | **category error identified**                                                             | Maine IFW and UNH Extension prescribe **softwood crown closure ≥ 70 % / 65–70 %** — canopy, invisible to a DEM. The engine's shelter term is topographic                                                                                                     |
| Topographic wind shelter as a whitetail bed criterion                                                                                                                                                                        | implicitly 🟢 via Lang & Gates                                   | 🔴 **no literature found**, six distinct queries logged                                   | Lang & Gates measured _wind velocity at night beds_, not a topographic exposure index. **The term that swings 3.2× and decides the winter answer has no species-specific calibration**                                                                       |
| "Colder → deer seek shelter"                                                                                                                                                                                                 | assumed settled                                                  | **recorded as a live disagreement**                                                       | PLOS One 2013 (MN, 12 yr): colder → **more open**, authors say solar gain outweighs cover benefit "particularly when temperatures are coldest". Courbin et al. 2017 (Anticosti): cold stress → **more thermal cover**. Both peer-reviewed northern whitetail |
| Relative magnitude of the two effects                                                                                                                                                                                        | never quantified                                                 | 🔵 **same order: solar 29–42 % vs shelter ~50 %**                                         | J. Exp. Biol. 198:1499 (ground squirrels, 780 W·m⁻²) vs red deer sheltered-topography reporting. Parity within cross-species transfer error — **neither justifies a 1.88× win**                                                                              |
| `aspectTerm × shelterTerm` multiplicative structure                                                                                                                                                                          | unexamined                                                       | 🔵 **vindicated**                                                                         | Wind reduces solar warming as well as adding loss (_J. Theor. Biol._ 1974) — the interaction is real and the product already encodes it. Do not refactor to additive                                                                                         |
| `BEDDING_SEVERE_COLD_C = −10 °C`                                                                                                                                                                                             | ungraded                                                         | 🔵 **Inferred**                                                                           | Measured LCT for fed whitetail fawns = **−11.2 °C** (Can. J. Zool. 1999). Within 1.2 °C of a species-specific physiological threshold. Caveat: fawns, so conservative for adults                                                                             |
| `BEDDING_PAD_HALF_MAX_SLOPE_DEG = 12`                                                                                                                                                                                        | ungraded                                                         | 🔵 **Inferred**, shape 🟢                                                                 | Rowland 2018's monotone decline is measured; 12° places the term at 0.20 at the top of the BC WHR band and 0.34 at the top of the elk band. The _shape_ fix mattered more than the value                                                                     |
| `BEDDING_RING_MIN_SLOPE_DEG = 15`                                                                                                                                                                                            | ungraded                                                         | 🔴 **Assumed**, and its stated justification is wrong                                     | The comment calls 15° "the bottom of the BC WHR band"; that band bottoms at **5.7°** — 15° is its centre. And a _use_ band cannot set a _surround_ threshold without assuming what the pad/ring split exists to deny                                         |
| `BEDDING_VRM_FULL_COVER = 0.06`                                                                                                                                                                                              | ungraded, flagged by author                                      | 🔴 **Assumed — upheld**, with a new consequence                                           | Natural terrain VRM runs 0–~0.4, so saturating at 0.06 pins the cover term at ceiling across most hill country. `R33`'s ground-truthing stands                                                                                                               |
| `DEFAULT_VRM_RADIUS_CELLS = 4`, `DEFAULT_RING_RADIUS_CELLS = 8`, `BEDDING_RING_SOFTNESS_DEG = 4`, cover floor `0.4`, shelter floor `0.25`, `BEDDING_COLD_ONSET_C = 5`, `BEDDING_MAX_SOLAR_ASPECT_WEIGHT = 0.75`, linear ramp | unregistered                                                     | 🔴 **Assumed, all seven**                                                                 | Four of them were in no backlog row at all. The two **floors** are the constants that decide which term wins a disagreement — i.e. the actual cause of `R31` — and neither had been looked at                                                                |
| Wind speed                                                                                                                                                                                                                   | not considered                                                   | 🔴 **new gap**                                                                            | `windSpeedKph` exists in `packages/shared/src/domain.ts:154` and never reaches the engine. Every fixed shelter floor is a hidden wind-speed assumption                                                                                                       |
| Day vs night beds                                                                                                                                                                                                            | not distinguished                                                | 🔴 **new gap**                                                                            | The literature splits on exactly this axis and the layer's daytime reading is currently an accident rather than a decision                                                                                                                                   |

---

## Pass-6 changelog — the two bedding floors, and the `R40` constants

| Row                                           | Before                           | After                                                                    | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shelter floor `0.25`                          | 🔴, one-line stub                | 🔴 **Assumed — upheld, with a falsification test and a contrary result** | No study relates whitetail bed selection to a topographic wind-exposure index (pass 5's six queries + this pass's). New and cutting the other way: Cook et al. 1998/2004 found **no positive effect of thermal cover** on elk condition in six experiments, with dense cover the _most_ energetically costly winter environment; Ewald et al. 2014 found **wind speed had no influence** on roe deer winter selection. Species and cover-type drift both apply — and _benefit ≠ selection_ |
| Cover floor `0.40`                            | 🔴, "has had no scrutiny at all" | 🔴 **Assumed — scrutinised, unchanged**                                  | Concealment selection at beds is measured (Uresk, Grovenburg OR 1.035/cm, Germaine) but every numeric row is **fawn/neonate**, and the closest one shows used and available distributions **overlapping** (28.1 % vs 19.9 %; 36.0 % vs 33.8 %). Nothing supports 0.4 over 0.2 or 0.6                                                                                                                                                                                                       |
| What a floor _is_                             | undefined                        | **defined as a measurable quantity**                                     | `term = f + (1−f)x` ⇒ best-vs-worst ratio `1/f`. The engine therefore asserts **cover 2.5×, shelter 4×** — quantities that are exactly Manly selection ratios, which `packages/shared` already computes. The floors are unfalsifiable _today_, not unfalsifiable in principle                                                                                                                                                                                                              |
| Relative strictness of the two requirements   | never examined                   | 🔴 **new finding: the ordering was never chosen**                        | `0.25 < 0.40` asserts wind shelter is a **stricter** bed requirement than concealment. It fell out of two independently-picked literals, and the located evidence leans the other way                                                                                                                                                                                                                                                                                                      |
| Floor _shape_ — the existence of a floor      | unexamined                       | 🔵 **sound modelling practice**                                          | Product/geometric-mean aggregation is the standard "limiting factor" operator; the floors are the dial that adds compensation back to an otherwise non-compensatory product (USGS OF 2007-1254; GSI toolbox AM/GM/MLF)                                                                                                                                                                                                                                                                     |
| Floor _shape_ — cover term monotonicity       | unexamined                       | 🔴 **contradicted by two measured results**                              | Red deer select **intermediate** LiDAR-measured visibility (Zong et al. 2023, _J. Anim. Ecol._ 92:1306); **horizontal visibility, not concealment**, drove whitetail fawn bedsite use and greater field of view **lowered** coyote-predation odds (Obermoller, _JWM_); concealment and visibility are inversely-related properties of the same cover (Camp et al. 2013). ⚠️ Do not invert the term — VRM is terrain, these measure vegetation                                              |
| Internal contradiction                        | not noticed                      | **new**                                                                  | The leeward term is justified here by "watch downhill, smell uphill" (needs a sightline); the cover term rewards monotonically increasing sightline-breaking roughness. The two encode opposite preferences and multiply together                                                                                                                                                                                                                                                          |
| `BEDDING_RING_MIN_DATA_FRACTION = 0.5`        | unregistered (new in `R40`)      | 🔴 **Assumed — and not a biological parameter**                          | A data-quorum threshold, correctly designed. Its comment claims to be pinned to `detectBenches`' `samples >= 8 of 16`; **the two use different denominators** (all 16 vs in-grid only) and diverge at tile borders, which is the region the quorum exists to protect. Behaviour right, claim of equivalence wrong                                                                                                                                                                          |
| Hiding cover, 90 % of a standing deer at 61 m | not registered                   | 🟡 **Doctrine**                                                          | The discipline's own operational cover definition (NRCS, MSU Deer Lab) is a **step function**; ours is a ramp. Neither measured; registered so the difference is deliberate                                                                                                                                                                                                                                                                                                                |
| Lang & Gates correction                       | corrected in pass 5              | **verified unchanged this pass**                                         | Register and `docs/BACKLOG.md` both still state 11.2 / 18.1 / 21.7 cm means and 1.20×. ⚠️ **The retracted 42.0 cm figure survives in `wind.ts`'s comment on `BEDDING_MAX_SOLAR_ASPECT_WEIGHT`**                                                                                                                                                                                                                                                                                            |
| `R31` shelter-floor ramp                      | prescribed in pass 5             | **confirmed not shipped**                                                | `wind.ts:545` is still the fixed literal `0.25`. Every `R31` statement remains prescription, not description                                                                                                                                                                                                                                                                                                                                                                               |

---

# Pass 7 — **Elk in steep western terrain.** Montana HD 320, Tobacco Root Mtns

**Scope of this pass.** A user is hunting **elk** (_Cervus canadensis nelsoni_)
in **Montana Hunting District 320**, the Tobacco Root Mountains, Madison County
— NW of Ennis Lake, north to the Jefferson River, east to Highway 287. Steep,
largely roadless interior; verified 1 m LiDAR; read elevations **1556–2007 m**
across the northern part of the range alone, with the range's summits above
3200 m. Every behavioural parameter in this engine was written for
**white-tailed deer in eastern hill country**. This pass grades each one _again,
for elk in that terrain_, independently of its existing whitetail grade.

Elk is the **primary** species for this user, not a sensitivity check. Both
Montana season windows are covered, because they are behaviourally different
animals: **archery, early September** (rut) and **general rifle, late October
into November** (post-rut).

> ## Headline verdict
>
> **No. The bedding layer and the corridor layer cannot be trusted for elk in
> HD 320, and should be greyed out or labelled for elk rather than re-tuned.**
>
> This is not a "the constants are a bit off" finding. Three separate things
> are wrong at once, and only the first is a number:
>
> 1. **The rut model is wrong by ~8 weeks in September and — worse —
>    _confidently wrong in the opposite direction_ in November.** It is
>    hard-wired to whitetail photoperiod with no species argument. Worked
>    numbers below. This is the single highest-severity finding in the pass.
> 2. **The one peer-reviewed measurement of elk bed sites found that slope did
>    not discriminate beds from random ground at all** (Millspaugh et al. 1998).
>    The engine's bedding score for elk is carried almost entirely by two slope
>    terms. The variables that _did_ discriminate — overstory canopy closure,
>    tree basal area, microsite temperature — are invisible to a DEM.
> 3. **The corridor cost function is a human hiking function**, its proposed
>    replacement is body-mass-interpolated over 35–100 kg against a ~250 kg
>    animal, and the land-cover resistance table's ordering may be **inverted**
>    for elk in this landscape.
>
> Two layers _do_ transfer and are the honest thing to show this hunter:
> **hillshade / slope / aspect / curvature / landform** (geomorphometry, not
> biology) and **thermal phase direction** (meteorology, not biology) — the
> latter with a stated mountain caveat below.

## 1 · Rut timing — 🔴 **structurally inapplicable. Grey out for elk.**

### What the code does

`packages/shared/src/rut.ts` takes `{ latitude, offsetDays, southernHemisphere }`.
**There is no species argument anywhere in the model, and `readRut` is called
with latitude alone** from `apps/api/src/properties/properties.module.ts:79,101`
and `apps/api/src/observations/observations.module.ts:187`. Every observation is
stamped with a whitetail rut phase regardless of the `species` field the user
selected — `GameSpecies.Elk` exists in `packages/shared/src/domain.ts:52` and
reaches nothing but a label.

### Worked, for the Tobacco Roots at 45.5°N

`peakBreedingDayOfYear(45.5)` returns **319** (15 November).

| Real elk event                  | Date            | DOY     | `daysFromPeak` | Phase the app reports | Note the app shows                           |
| ------------------------------- | --------------- | ------- | -------------- | --------------------- | -------------------------------------------- |
| MT archery opener               | ~5 Sep          | 248     | −71            | **OffSeason**         | _"…not to burn sits."_                       |
| Peak bugling begins             | ~15 Sep         | 258     | −61            | **OffSeason**         | _"…not to burn sits."_                       |
| Peak bugling / harem holding    | ~20 Sep         | 263     | −56            | PreRut                | _"still on a bed-to-feed pattern"_           |
| Median conception, mature bulls | ~21 Sep – 4 Oct | 264–277 | −55 … −42      | PreRut                | as above                                     |
| Rifle opener                    | ~25 Oct         | 298     | −21            | **Seeking**           | _"bulls covering ground in daylight"_        |
| Early Nov                       | 6 Nov           | 310     | −9             | **Chasing**           | _"highest-odds daylight window of the year"_ |
| Mid Nov                         | 13 Nov          | 317     | −2             | **PeakBreeding**      | _"Lockdown."_                                |
| Season close                    | 30 Nov          | 334     | +15            | PostRut               | —                                            |

**The model never returns Seeking, Chasing or PeakBreeding during the actual elk
rut, and returns all three during a period when bulls are five to nine weeks
post-rut and recovering.** The coordinator's worry is confirmed and it is worse
than "coincidentally less wrong in November": November is where the model is
_actively_ wrong, because it tells a rifle hunter to sit all day near cow
bedding on the strength of a rut that ended in early October.

### The elk timing that is actually measured

🟢 **Measured.** Elk breeding is photoperiod-driven like whitetail — the cue is
not in dispute — but the phase is set ~8 weeks earlier. Conception dates at the
Starkey Experimental Forest and Range, NE Oregon, 78 km² enclosure, 1989–93,
depend strongly on **bull age**: conception occurred earlier as male age
increased, differing significantly between males ≤2 yr and ≥3 yr. Mean
conception adjusted for female nutritional condition ran from **4 October with
yearling sires to 21 September with 5-year-old sires**.
[Noyes et al., _J. Wildl. Manage._ — ODFW copy](https://www.dfw.state.or.us/wildlife/research/docs/ELKEffectsofbullageonconceptiondatesandpregnancyratesofcowelkinoregon.pdf) ·
[follow-up: male age and female condition](https://www.dfw.state.or.us/wildlife/research/docs/ELKEffectsofmaleageandfemalenutritionalconditiononelkreproduction.pdf)
_(abstract/indexed-body level — full text not read; see reading conditions.)_

That gives a defensible elk `peakBreedingDayOfYear` of **DOY 264–277
(21 Sep – 4 Oct)** for a herd of unknown bull age structure, with the
**herd's own age structure as the dominant covariate** — a 13-day spread driven
by something the engine cannot observe. Latitude is _not_ the useful axis it is
for whitetail; **bull age structure and elevation are.**

⚠️ **Do not simply subtract 55 days from the whitetail curve.** The whitetail
model's _internal_ phase windows (`Seeking −21…−10 d`, `Chasing −10…−2 d`,
`Lockdown −2…+8 d`) are already 🔴 for whitetail (see the rut section above) and
have no elk basis at all. Bull elk vocalise and move for weeks, cows cycle
individually into harems rather than the population synchronising, and there is
no elk equivalent of "lockdown" as the whitetail model means it. **The window
shape is a separate unknown from the peak date.**

**Verdict: structurally inapplicable.** Do not re-tune. Either add a species
argument and a separate elk chronology, or **refuse to report a rut phase when
`species = elk`**. Refusing is correct and cheap; a shifted whitetail curve
would be a new confident wrong answer. `BACKLOG R83`.

**Cheap / moderate / structural:** **moderate.** Species parameter through
`RutModelOptions` → `readRut` → the two API call sites → the UI chip, plus an
elk chronology with a defined confidence. The _refusal_ path is **cheap** and
should ship first.

## 2 · Bedding likelihood — 🔴 **grey out for elk. The literature contradicts the layer's core assumption.**

### The one direct measurement, and it is a negative

🟢 **Measured — and it is a null result on the variable the engine uses.**
131 summer diurnal bed sites of 26 elk, Custer State Park, Black Hills, SD,
5 Jun – 30 Aug 1994–96:

- **Slope percent was _not_ different between bed sites and random plots.**
  Neither were elevation, average tree dbh, distance to roads, distance to
  trails, or distance to water.
- What _was_ greater at beds: **overstory canopy closure, number and basal area
  of trees, percent litter and bare ground**. **North aspects were selected.**
- Canopy closure + tree basal area + **microsite temperature** correctly
  classified **86.2 %** of observations — the authors conclude thermoregulation
  drives summer diurnal bed selection.
- An average bed: basal area > 12.4 m²/ha, > 110 trees/ha, **> 54 % canopy
  closure, north aspect**.

[Millspaugh et al. 1998, _Am. Midl. Nat._ 139:133–140](<https://bioone.org/journals/the-american-midland-naturalist/volume-139/issue-1/0003-0031(1998)139%5b0133%3aSBSOEC%5d2.0.CO%3b2/Summer-Bed-Sites-of-Elk-Cervus-elaphus-in-the-Black/10.1674/0003-0031(1998)139[0133:SBSOEC]2.0.CO;2.short>)
_(abstract + indexed results; full text not read.)_

**Scope, stated rather than smuggled:** Black Hills ponderosa pine, **summer**,
a state park with no hunting pressure, sexes pooled. September in a hunted
roadless range is a different context. But it is the only peer-reviewed elk
bed-site measurement located in this pass, and it is a _direct null_ on the
engine's dominant predictor.

Supporting, same direction: Roosevelt elk in the Mount St. Helens blast zone
**became inactive and selected bedding sites with little vegetation**, did not
increase midday forest use on clear days (P < 0.12), and compensated by
increasing nocturnal feeding.
[Merrill 1991, _Appl. Anim. Behav. Sci._](https://www.sciencedirect.com/science/article/abs/pii/016815919190252S)
That is a _third_ bed-site pattern again, which is the honest summary: elk bed
where the thermal and security situation is right, and terrain shape is a weak,
context-dependent proxy for it.

### The slope-shape disagreement, recorded as a range rather than a midpoint

Three sources, three different shapes, all elk:

| Source                                                          | Class            | What it says about elk vs slope                                                                                                                                                                      | In degrees                                                            |
| --------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Millspaugh et al. 1998 (bed sites, summer, SD)                  | 🟢 Measured      | **Slope does not discriminate beds from random**                                                                                                                                                     | —                                                                     |
| Rowland et al. 2018, _Wildl. Monogr._ 199 (summer use, W OR/WA) | 🟢 Measured      | **Monotone decline**, −5.3 % use per percent of slope, standardised coef −0.949                                                                                                                      | no optimum                                                            |
| BC WHR Rocky Mountain Elk species accounts                      | 🟡 Agency rating | **Interior optimum:** use increases with slope to a max at **30–40 %**, most-used class **15–30 %**, threshold at **40–50 %** past which use "diminishes sharply"; > 100 % is the worst rating class | most-used **8.5–16.7°**; max **16.7–21.8°**; falls off **21.8–26.6°** |

[BC WHR Rocky Mountain Elk](https://a100.gov.bc.ca/pub/acat/documents/r1583/whr_4069_mceel_1117055960977_ad101d33f76a47c38b67f114e5fbb078.pdf) ·
[second WHR account](https://a100.gov.bc.ca/pub/acat/documents/r1535/whr_4162_mceen_1096574762865_68741ea2adba46dcb522d7a9f909273a.pdf) ·
[TEM species account](https://a100.gov.bc.ca/pub/acat/documents/r1632/tem_4163_mceel_1097880585588_05387b1f8bfb43e5b386e0bd340b5b45.pdf) ·
[species–habitat model](https://a100.gov.bc.ca/pub/acat/documents/r1651/whr_4012_mceel_1098209135230_07a33d337dd7428586868202f6bc05bd.pdf)
_(WebFetch 403 on `a100.gov.bc.ca`; content is from indexed body text across
four independent WHR documents.)_

**Rowland and BC WHR disagree about the sign of the slope response below ~17°,
and Millspaugh finds no response at all.** This register does not get to pick a
midpoint. The honest statement is: **the elk slope response at bedding scale is
unresolved, and the engine's monotone-decreasing pad term is one of three
candidate shapes with no elk evidence favouring it.**

Note the irony: `BEDDING_PAD_HALF_MAX_SLOPE_DEG`'s comment in `wind.ts` cites
Rowland 2018 — an **elk** paper — as the shape authority for a **whitetail**
layer. It is closer to elk than to whitetail on that axis, and still not enough,
because Rowland measured _summer landscape-scale use_, not bedding.

### The three terms, one at a time, for elk

| Term                                          | Transfers to elk?                                              | Why                                                                                                                                                                                                               |
| --------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `padTerm = 1/(1+(s/12)²)`                     | 🔴 **unknown**                                                 | Three elk sources, three shapes (above). Elk _are_ reported to lie on flat pads (doctrine only), but no measurement supports a 12° half-max for elk                                                               |
| `ringTerm = sigmoid((ringSlope−15)/4)`        | 🔴 **no elk basis**                                            | 15° is the centre of a **whitetail** WHR band. The elk WHR band is different, and no elk source relates bed selection to _surround_ slope at all                                                                  |
| `aspectTerm` (leeward, cold-blended to solar) | 🔴 **wrong sign in the September window**                      | See below — this is the sharpest single defect in the bedding layer for elk                                                                                                                                       |
| `shelterTerm = 0.25 + 0.75·s` (TOPEX)         | 🔴 **unsupported for elk, and contradicted for thermal cover** | Cook et al. 1998 found **no positive effect of thermal cover** on elk condition across six experiments; Merrill 1991 found elk bedding in _little_ vegetation. Wind shelter as an elk bed criterion is unmeasured |
| `coverTerm = 0.4 + 0.6·VRM/0.06`              | 🔴 **wrong proxy for elk**                                     | Millspaugh's discriminating cover variables are all **canopy**, and a DEM cannot see canopy. Terrain ruggedness is not a stand-in for 54 % canopy closure in Douglas-fir                                          |

### The aspect term is wrong in the direction that matters for archery season

`coldBlendWeight` is a **no-op above +5 °C** (`BEDDING_COLD_ONSET_C = 5`), so in
early September in HD 320 the aspect term is **pure leeward geometry**,
`(1 − cos(aspect − windFrom))/2`, which is agnostic to north versus south.

Millspaugh measured **north aspects selected** for summer diurnal beds, driven
by microsite temperature. Merrill measured heat-driven inactivity and nocturnal
compensation. Elk are large-bodied, heat-stressed animals in September at 2000 m
on a sunny day. **The single strongest measured aspect signal for elk day beds
in warm weather — go north-facing and shaded — is not in the model at all**,
and the cold-solar term that _would_ express an aspect preference is switched
off precisely when the opposite preference applies.

The engine already computes `slopeInsolation` and `castShadows`. The missing
piece is a **warm-season term with the opposite sign to the cold one**, and that
is a real modelling decision, not a constant.

**Verdict: grey out `beddingLikelihood` for elk.** Every term is either
unsupported, wrong-signed, or proxying a variable the DEM cannot see. Re-tuning
the constants would produce a layer that looks calibrated and is not.
`BACKLOG R84`.

**Cheap / moderate / structural:** **structural.** Making elk bedding
first-class needs (a) a canopy-cover input the engine does not have — NLCD
percent tree canopy or LiDAR-derived canopy, (b) a season-signed aspect term,
(c) a herd-scale patch operator rather than a per-cell score (see §6), and (d)
elk-specific validation data. The **cheap** part is the honest labelling.

## 3 · Thermals and scent — 🔵 **direction transfers; strength, timing and the scent cone do not**

### What transfers

🟢 **The physics is species-independent and it transfers unchanged.** Rising
(anabatic) flow by day, sinking (katabatic) flow by night; scent up the hill in
the morning, down the drainage in the evening. `ThermalPhase` direction and
`scentAzimuth` are as valid in the Tobacco Roots as anywhere — **more** valid,
because slope flows are stronger and more reliable in high-relief terrain than
in whitetail hill country.

### What does not — and yes, there is a relief term missing

The founder's question was whether the thermal model has a slope/relief term at
all. **It has a slope term and no relief term**, and for this range that is the
wrong half:

```
let s = Math.min(1, slope / 30);           // wind.ts:238
```

🔵 **Inferred, from measured meteorology.** Katabatic layer depth scales with
the **vertical drop from the hilltop**, not with the local slope angle: typical
depths **10–100 m, roughly 5 % of the vertical drop**, with typical speeds
**3–8 m·s⁻¹** and > 8 m·s⁻¹ on long slopes; anabatic flows are much weaker,
**1–2 m·s⁻¹**, over a rising layer hundreds of metres deep.
[Stull, _Practical Meteorology_ §17.3 — Thermally Driven Circulations](<https://geo.libretexts.org/Bookshelves/Meteorology_and_Climate_Science/Practical_Meteorology_(Stull)/17:_Regional_Winds/17.02:_Section_3->) ·
[UBC ATSC 113 — diurnal slope flows](https://www.eoas.ubc.ca/courses/atsc113/snow/met_concepts/06-met_concepts/06b-diurnal-slope-flows/) ·
[RMetS — anabatic and katabatic flow](https://www.rmets.org/metmatters/anabatic-and-katabatic-flow-metmatters-guide-mountain-winds)

Consequences for HD 320, where local relief exceeds **1000 m**:

1. **`min(1, slope/30)` saturates on most of the range.** Nearly every hillside
   in the Tobacco Roots exceeds 30°, so the strength field is a near-uniform 1.0
   and carries no information. The parameter was scaled for terrain where 30° is
   the _steep_ end; here it is the median.
2. **Two cells at the same 30° angle, one at the head of a 100 m draw and one at
   the head of a 1000 m drainage, get identical strength.** The second one has
   an order of magnitude more air draining past it. **Drop-to-outlet, or
   contributing drainage area, is the physically correct driver and the engine
   computes neither.**
3. **The anabatic/katabatic asymmetry is unmodelled.** The measured speeds differ
   by ~3×, so the evening sink is a materially bigger scent event than the
   morning rise, and the model treats them symmetrically apart from the
   insolation scaling.

### Transition timing is aspect-dependent in mountains, and the engine uses one global clock

🟢 **Measured, and directly implementable with operators the engine already
has.** Over steep Alpine slopes, **topographic shading controls the evening
transition**: the shading front drops incoming shortwave by several hundred
W·m⁻² in minutes and skin temperature by ~10 °C in under 10 min, and shading on
the east side **advances the evening transition by approximately one hour
relative to the still-sunlit west side**. Drainage flow reaches quasi-equilibrium
~**1.5 h after local sunset**, with an early-evening calm of TKE < 0.05 m²·s⁻²
and winds < 0.5 m·s⁻¹ in between.
[Cheng et al. 2026, _Q. J. R. Meteorol. Soc._](https://rmets.onlinelibrary.wiley.com/doi/abs/10.1002/qj.70051) ·
[Flow during the evening transition over steep Alpine slopes](https://research.monash.edu/en/publications/flow-during-the-evening-transition-over-steep-alpine-slopes) ·
[Distinguishing time scales of katabatic flow in complex terrain, _Atmosphere_ 12:1651](https://www.mdpi.com/2073-4433/12/12/1651) ·
[Drainage flows with topographic shading, _Atmosphere_ 16:1091](https://doi.org/10.3390/atmos16091091)

`thermalPhaseAt()` takes a **single sunrise/sunset for the whole tile** and a
symmetric ±45 min window. In a range with 1000 m of relief, **an east-facing
drainage goes into sinking phase roughly an hour before a west-facing one**, and
a hunter in a deep east-side draw is in downslope flow while the app still says
"rising". `castShadows()` already exists in `solar.ts` — this is the cheapest
high-value mountain fix in the pass. 🔴 today.

### Scent cone — 🔴 and structurally wrong for mountain drainages

`geometry.service.ts:212` / `waypoints.module.ts:286-290`: synoptic cone
**400 m at 25° half-angle**, thermal cone **250 m at 30°**.

- **No measurement of elk scent-detection distance was found.** Queries run:
  `elk olfaction scent detection distance wind human odor ungulate response
measured meters` · `elk sense of smell distance detect human study` ·
  `ungulate olfactory detection threshold human odour plume field experiment`.
  Everything returned is hunting media with figures from "half a mile" to "two
  miles" and no method. **🔴 Assumed, no literature — same status as the
  whitetail row, and the media numbers are worse than unsupported.**
- **The geometry is wrong for this terrain, independently of the distance.**
  A sinking-phase plume in a 1000 m drainage is **channelled** — it follows the
  drainage network for kilometres, and it is _narrower_, not wider, than a
  free-air plume. The engine has the thermal cone **shorter (250 m) and wider
  (30°) than the synoptic one**, which is the opposite of the physics in
  confined terrain. The existing `N11` row already calls this an inversion for
  whitetail country; **in a Tobacco Root drainage it is not an approximation
  error, it is the wrong object.** The correct primitive is a downslope flow
  path over the DEM, not a wedge.

**Cheap / moderate / structural:** transition timing per-cell from `castShadows`
is **moderate**; a relief/drainage term for strength is **moderate**; a
flow-routed scent path replacing the wedge is **structural**.
`BACKLOG N28` covers the first two; the scent path stays research.

## 4 · Corridors and movement cost — 🔴 **grey out for elk. Three independent problems.**

### 4a · `toblerSpeed` is a human function — unchanged verdict, worse consequence here

Already 🔴 in this register. For HD 320 the consequence is larger than in
whitetail country because the terrain is steeper: Tobler flattens the
climb/descend asymmetry (it charges a −10 % descent the _same as flat_, against
0.57× measured in a ruminant), and asymmetry is the entire signal a mountain
corridor model carries. `stepCost` also minimises **time**, not energy.

### 4b · The proposed replacement curve does not cover elk body mass

The register's `C₀ = 2.6`, `k_up = 26`, `k_dn = 8` are a **body-mass model**
interpolated between a 35 kg goat and a ~100 kg caribou, targeted at a 70 kg
whitetail. **Cow elk are ~225–250 kg and bulls ~320 kg — a factor of 3–5 above
the top of the measured bracket**, on a relationship the source review describes
as _inverse_ in body mass, i.e. the extrapolation is in the direction where it
compounds.

Two things partly help and should be recorded:

- 🟢 **`C₀ = 2.6 J·kg⁻¹·m⁻¹` is a `Cervus elaphus` measurement.** Brockway &
  Gessaman 1977 measured **red deer** — the same genus as elk, historically
  conspecific. **This constant transfers to elk _better_ than to whitetail**,
  and the register should stop implying otherwise.
  [Brockway & Gessaman 1977, _Q. J. Exp. Physiol._](https://pubmed.ncbi.nlm.nih.gov/243923/)
- **A direct elk locomotion measurement exists and has not been read.** Cohen,
  Robbins & Davitt 1978, _Comp. Biochem. Physiol. A_ 61:43–48, "Oxygen
  utilization by elk calves during horizontal and vertical locomotion compared
  to other species", reports (indexed snippet, **not read at source**)
  `M = 0.38 + 0.22V` level, `M = 0.61 + 0.27V` at 4.2° up, `M = 0.81 + 0.34V` at
  11.7° up, with `M` in ml O₂·g⁻¹·h⁻¹ and `V` in km·h⁻¹.
  [ScienceDirect record](https://www.sciencedirect.com/science/article/abs/pii/0300962978902748)
  **Found but unread — a lead, not a grade.** It is _calves_, so the mass
  problem is not solved by it, but it is the only direct elk datum located and
  obtaining it is the cheapest possible improvement to this row.

⚠️ Note the coincidence that must not be laundered: "5.9 kcal per kg per vertical
metre" — the figure pass 4 caught as a **1000× units error** — surfaces again in
search snippets, attached to the elk-calf comparison. It is still wrong by 1000×
(5.9 kcal = 24 700 J). Do not let it back in.

### 4c · The NLCD resistance ordering may be **inverted** for elk in this landscape

🔴 **Assumed, and now plausibly wrong in sign, not just in magnitude.**
`NLCD_RESISTANCE` is documented in `cost.ts:154` as "tuned for whitetail".
Against the classes actually present in the Tobacco Roots:

| NLCD | Class                | Our value                                    | Problem for elk in HD 320                                                                                                                                                                                                      |
| ---- | -------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 52   | Shrub/scrub          | **0.8 — the cheapest class**                 | Comment reads "cover plus passability", i.e. eastern regen thicket. In SW Montana this is mountain big sagebrush and mountain mahogany: **open ground with little hiding cover and modest forage value**                       |
| 71   | Grassland/herbaceous | 1.6                                          | Bunchgrass parks and alpine meadow are **prime elk forage**. Elk used Black Hills grasslands more extensively **at night** than by day, and increased night selection as canopy fell                                           |
| 82   | Cultivated crops     | **2.8 — most penalised non-developed class** | DeVoe et al. 2019 found elk in the Bitterroot/Sapphire with the **highest nutrition on low-risk private irrigated agriculture**. The Madison and Jefferson valleys are exactly that. We penalise the ground elk concentrate on |
| 42   | Evergreen forest     | 1.0                                          | Douglas-fir/lodgepole is the security cover here, and Ranglack's canopy thresholds are ≥13 % (archery) / ≥9 % (rifle) — **NLCD's discrete class cannot express a percent-canopy threshold**                                    |
| 31   | Barren               | 3.0                                          | Talus and scree above treeline; plausible, untested                                                                                                                                                                            |

[Rumble et al., habitat use by elk within structural stages, USFS](https://www.fs.usda.gov/rm/pubs_other/rmrs_2011_rumble_m001.pdf) ·
[DeVoe et al. 2019, _J. Wildl. Manage._ — FWP copy](https://fwp.mt.gov/binaries/content/assets/fwp/conservation/wildlife-reports/elk/devoe.etal.2019.pdf)

**The `attraction` field compounds it.** `buildCostSurface` accepts bedding
likelihood as an attraction field discounting cost by up to 50 %. For elk that
imports §2's error directly into the corridor solver, so the two layers fail
_together_ rather than independently.

### 4d · `impassableSlopeDeg: 55` — same verdict as for whitetail, for an elk reason

BC WHR puts elk use falling off sharply above **40–50 % (21.8–26.6°)** and rates

> 100 % (45°) as the worst class. 55° is ~28° above where elk use is described as
> ceasing, so it effectively never binds. Retain as a numerical guard, never
> surface it as "elk will not cross this".

**Verdict: grey out corridors for elk.** `BACKLOG R85`.

**Cheap / moderate / structural:** re-running the allometry is **cheap but not
defensible** at 3–5× outside the bracket — say so instead. An elk-specific
resistance table validated against Montana telemetry is **moderate**. A
distance-to-motorized-route term is **structural** (see §5) and is, on the
evidence, the _most important missing covariate for elk during either season_.

## 5 · The two covariates elk hunting turns on, and neither exists in the engine

### 5a · Distance to motorized routes — 🟢 **Measured, in Montana, season-specific, and entirely absent**

This is the strongest elk finding in the pass and it is about a layer we do not
have. Western Montana, GPS-collared elk, security areas defined against observed
selection during the two hunting seasons:

| Season      | Distance from motorized route | Canopy cover | Minimum patch   |
| ----------- | ----------------------------- | ------------ | --------------- |
| **Archery** | **≥ 2 760 m**                 | ≥ 13 %       | none specified  |
| **Rifle**   | **≥ 1 535 m**                 | ≥ 9 %        | **≥ 20.23 km²** |

[Ranglack et al. 2017, _J. Wildl. Manage._ 81, doi:10.1002/jwmg.21258](https://wildlife.onlinelibrary.wiley.com/doi/10.1002/jwmg.21258) ·
[Montana FWP final report — fall elk resource selection](https://fwp.mt.gov/binaries/content/assets/fwp/conservation/elk/research/fall-elk-resource-selection---final-report.pdf)

The FWP report states the model's landscape covariates as **canopy cover, slope,
elevation and solar radiation**, with hunter access and hunter effort as the
risk covariates. Ridgeline has slope and solar radiation; it has **no canopy, no
elevation model and no roads**, and roads are the covariate with the largest
published effect. Corroborating: elk selection increases with distance from open
roads, and a distance-to-road formulation predicted observed use better than
road density.
[Rowland et al., elk distribution and modelling in relation to roads — ODFW copy](https://www.dfw.state.or.us/wildlife/research/docs/ELKElkdistributionandmodellinginrelationtoroads.pdf)

**Grep confirms there is no road or motorized-route layer anywhere in
`packages/terrain`, `packages/shared` or `apps/api`.** HD 320's selling point is
that much of its interior is roadless — which is exactly the variable this
engine cannot see. **`BACKLOG N25`. Structural, and the highest-value new
capability for an elk user.**

### 5b · Absolute elevation and elevational migration — 🔴 **no model exists. The absent model is the finding.**

Confirmed by inventory: `elevation` appears in the engine **only** as a
filterable metric in `terrainFilter.ts:45,152,359` and a pipeline output. **No
biological parameter anywhere reasons about absolute elevation, snow line, or
seasonal elevational movement.**

What the literature says that model would need, for the interior mountains
closest in character to the Tobacco Roots:

🟢 **Measured.** Radiocollared mule deer and elk in the temperate interior
mountains of SE British Columbia performed **seasonal elevational migrations of
1 000–1 400 m**, with long-distance movements up to **50 km (deer) and 63 km
(elk)**. Late-winter snow-track transects: **deer avoided areas with > 40 cm of
snow, elk areas with > 50 cm**; both used low canopy cover to reach browse; and
the authors demonstrate it is **possible to map potential winter range using
topographic variables as surrogates for relative snow depth** — which is
precisely what this engine is built to do.
[Poole & Mowat 2005, _Wildl. Soc. Bull._ 33:1288–1302](<https://wildlife.onlinelibrary.wiley.com/doi/abs/10.2193/0091-7648(2005)33%5B1288:WHRODA%5D2.0.CO;2>)
_(abstract/indexed level.)_

🟡 **Agency.** BC WHR puts Rocky Mountain elk at roughly **900–2 000 m**, with
elk wintering on lower slopes and valleys where less snow accumulates and
warm/south aspects important on winter range.

**Bearing on HD 320's two seasons:**

- **Early September archery:** elk are on summer range, high; the 1556–2007 m
  band the founder read in the northern part of the range is at or below the
  bottom of where the animals will be. The engine has no way to say so.
- **Late-October–November rifle:** this is the transition window, and elevation
  is moving with the snow. A layer that ignores elevation is answering a
  question about the wrong 1000 m of the mountain.

The 50 cm elk / 40 cm deer thresholds are a **measured, implementable species
difference** and there is currently no snow term at all (the existing 🟢 "snow
cost" row above is also unimplemented). **`BACKLOG N26`. Structural.**

## 6 · Herd versus solitary — 🔵 **a scale mismatch, not a constant**

`beddingLikelihood` is documented as modelling _"a mature buck"_ who _"beds where
he can watch downwind and smell upwind"_ — one animal, one bench, one cell. Elk
social structure is a cow-calf group led by older cows, with harems of ~3–25
cows in the rut and migratory aggregations far larger; bulls are the exception,
not the unit.

The scale consequence is concrete and measurable: **Ranglack's rifle-season
security unit is ≥ 20.23 km²** — about **200 000 cells at 10 m**, against a
per-cell bedding score and a 9×9 (≈90 m) cover window. Elk home ranges are
reported an order of magnitude or more above whitetail — bulls averaging tens of
thousands of acres against a whitetail core area of ~90 ha.
[Anderson et al. 2005, _Landscape Ecology_ — factors influencing female elk home range size](https://link.springer.com/article/10.1007/s10980-005-0062-8)
_(title/abstract only.)_

**No per-cell operator in this engine can express "a 20 km² block".** The
missing primitive is a **patch/contiguity operator** — connected-component
labelling on a thresholded field with a minimum-area filter. That is a
well-defined, testable piece of work and it does not exist. **`BACKLOG N27`.
Structural.**

## 7 · Cover and forage — 🔴 **whitetail edge/browse logic does not transfer, and the elk cover literature is itself contested**

- 🟢 **Measured, contrary to the doctrine the engine leans on.** Cook et al.
  1998 (_Wildlife Monographs_ 141) tested the thermal-cover hypothesis for elk
  in summer and winter and found elk **benefited more from forage than from
  cover**; dense cover did not improve nutritional condition. The `shelterTerm`
  and `coverTerm` floors both encode the opposite intuition.
- 🟢 **Forage matters more than the engine allows.** In Rowland et al. 2018,
  **dietary digestible energy carried a standardised coefficient of +0.656**,
  second only to slope. Ridgeline models no forage at all.
- 🟡 **Elk forage/cover is a day-night alternation, not an edge relationship.**
  Elk used Black Hills grasslands more extensively for foraging **at night**
  than by day, and increased night selection where canopy was reduced. A
  static "edge" metric collapses two different animals into one.
- 🔴 **No peer-reviewed study of elk _wallow_ site selection was located.**
  Queries: `elk wallow site selection characteristics study peer reviewed rut
Cervus canadensis wet meadow spring seep` · `elk wallow habitat use
characteristics measured` · `bull elk rut wallow location topography study`.
  Wallows are strong and consistent field doctrine and a genuine terrain
  signature (concave, wet, near seeps — the engine's plan curvature and flow
  accumulation could find candidates). **They are 🟡 Doctrine at best and
  nothing published quantifies their terrain association.** Do not ship a
  "wallow likelihood" layer with a confidence chip above 🟡.

## 8 · Grizzly bears — **noted, not built. Safety-relevant, and the status changed recently.**

Not a terrain analytic, recorded because an app that routes a user into a
drainage in this country and says nothing has made a safety-relevant omission.

**Montana FWP has confirmed grizzly bear presence in the Tobacco Root Mountains
— a first for that range since grizzly recovery began** — from a private
landowner's trail camera in the **southern** Tobacco Roots.
[KRTV](https://www.krtv.com/news/montana-and-regional-news/grizzly-bear-confirmed-in-tobacco-root-mountains) ·
[KTVQ](https://www.ktvq.com/news/montana-news/grizzly-bear-confirmed-in-montanas-tobacco-root-mountains) ·
[KBZK — This Week in Fish and Wildlife](https://www.kbzk.com/community/this-week-in-fish-and-wildlife/this-week-in-fish-and-wildlife-grizzly-bear-confirmed-in-tobacco-root-mountains)

Context: a 1999–2000 assessment of the Tobacco Roots as a grizzly linkage zone
detected **no** grizzlies but judged the habitat suitable and dispersal from the
adjacent Madison, Gallatin and Gravelly ranges probable — which is what has now
happened.
[Linkage-zone assessment](https://www.researchgate.net/publication/293580365_An_assessment_of_the_Tobacco_Root_mountain_range_in_southwestern_Montana_as_a_linkage_zone_for_grizzly_bears) ·
[FWP SW Montana grizzly management plan](https://fwp.mt.gov/binaries/content/assets/fwp/conservation/wildlife-reports/bears/sw-grizzly-bear-eis.final.full-document.pdf) ·
[A summary of grizzly bear distribution in Montana, 2022](https://fwp.mt.gov/binaries/content/assets/fwp/conservation/bears/a-summary-of-grizzly-bear-distribution-in-montana-2022_20230815.pdf)

**Recommendation:** a static, sourced advisory tied to FWP's published occupied /
distribution polygons, shown when a property or route falls inside them. **Do
not model bear occurrence.** We have no data, and a "low grizzly probability"
shading would be the most dangerous confidently-wrong layer this product could
ship. `BACKLOG R89` — advisory only, explicitly scoped against modelling.

## 9 · Elk transfer table — the answer to "what would it take"

Three columns, because the coordinator needs the split to sequence work.

| Parameter / layer                                                               | Elk verdict                                                              | Gap type                                 | What it would take                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| Geomorphometry (slope, aspect, curvature, TPI, Weiss, Wood, benches, hillshade) | ✅ **transfers as-is**                                                   | —                                        | nothing; it is maths, not biology                                                         |
| Thermal **direction** (rising/sinking, `scentAzimuth`)                          | ✅ **transfers as-is**                                                   | —                                        | nothing                                                                                   |
| Anisotropic / oblique travel principle                                          | ✅ transfers                                                             | —                                        | measured across six mountain-ungulate species                                             |
| `C₀ = 2.6 J·kg⁻¹·m⁻¹`                                                           | ✅ **transfers better than to whitetail** — it is a _Cervus_ measurement | cheap                                    | correct the register's framing; done here                                                 |
| `k_up = 26`, `k_dn = 8`                                                         | ⚠️ **outside the measured mass bracket by 3–5×**                         | moderate                                 | obtain Cohen/Robbins/Davitt 1978; otherwise state the extrapolation and widen uncertainty |
| Thermal **strength** `min(1, slope/30)`                                         | ❌ saturates across the whole range; wrong driver                        | moderate                                 | relief / drop-to-outlet or flow-accumulation term                                         |
| Thermal **transition timing** (global ±45 min)                                  | ❌ ~1 h aspect-dependent error in high relief                            | moderate                                 | per-cell timing from the existing `castShadows()`                                         |
| Scent cone (400 m / 25°, 250 m / 30°)                                           | ❌ distance unmeasured; wedge is the wrong object in drainages           | structural                               | flow-routed plume; keep a 🔴 chip meanwhile                                               |
| `padTerm` (slope)                                                               | ❌ **unknown** — three elk sources, three shapes                         | moderate→structural                      | elk telemetry; no constant fixes an unresolved shape                                      |
| `ringTerm` (surround slope)                                                     | ❌ no elk basis at all                                                   | structural                               | as above                                                                                  |
| `aspectTerm` warm season                                                        | ❌ **wrong sign** — Millspaugh measured north aspects selected           | moderate                                 | a warm-season solar term with opposite sign to the cold one                               |
| `shelterTerm` floor 0.25                                                        | ❌ contradicted by Cook 1998 for elk                                     | structural                               | needs an elk criterion, not a floor tweak                                                 |
| `coverTerm` (VRM)                                                               | ❌ proxying canopy with terrain                                          | structural                               | percent-canopy input (NLCD TCC or LiDAR)                                                  |
| `beddingLikelihood` composite                                                   | ❌ **grey out**                                                          | structural                               | all of the above plus patch scale                                                         |
| `toblerSpeed` / `stepCost`                                                      | ❌ human function, minimises time                                        | moderate                                 | the energetics curve, re-derived for elk mass                                             |
| `NLCD_RESISTANCE`                                                               | ❌ **possibly inverted** for 52 / 71 / 82 in this landscape              | moderate                                 | elk-specific table validated against MT telemetry                                         |
| `impassableSlopeDeg: 55`                                                        | ⚠️ never binds; retain as numerical guard only                           | cheap                                    | do not surface it                                                                         |
| Rut model                                                                       | ❌ **~8 weeks wrong in Sep; confidently wrong in Nov**                   | moderate (refusal is cheap)              | species argument + elk chronology, or refuse                                              |
| Distance to motorized route                                                     | ❌ **does not exist**, and it is the largest measured elk covariate      | structural                               | roads layer + distance transform + Ranglack thresholds                                    |
| Absolute elevation / elevational migration / snow line                          | ❌ **does not exist**                                                    | structural                               | elevation-band model, 50 cm elk snow threshold, seasonal shift                            |
| Herd-scale patch / security area                                                | ❌ **does not exist**; per-cell only                                     | structural                               | connected-component + minimum-area operator                                               |
| Forage                                                                          | ❌ does not exist; 2nd-strongest measured elk predictor                  | structural                               | forage/nutrition layer                                                                    |
| Wallows, rut staging                                                            | ❌ does not exist; no literature to build against                        | structural                               | 🟡 at best if ever built                                                                  |
| Grizzly advisory                                                                | ❌ does not exist                                                        | cheap (advisory) / **forbidden** (model) | static FWP polygon + text                                                                 |

## 10 · Negative results, with the queries that earned them

Per this register's standing rule, a 🔴 that closes a question ships its query
list.

- **Elk scent-detection distance — none found.** `elk olfaction scent detection
distance wind human odor ungulate response measured meters` · `elk sense of
smell distance detect human study` · `ungulate olfactory detection threshold
human odour plume field experiment` · `deer elk winded hunter distance
measured experiment`. Everything returned is hunting media.
- **Elk wallow site selection — none found.** `elk wallow site selection
characteristics study peer reviewed rut Cervus canadensis wet meadow spring
seep` · `elk wallow habitat use characteristics measured` · `bull elk rut
wallow location topography study`.
- **Elk bed-site _surround_ slope (the ring term) — none found.** `"elk"
resting site OR "bed sites" selection slope canopy cover GPS clusters measured
percent slope study results` · `elk day bed site characteristics north-facing
slope timber measured study bedding areas Cervus` · `elk winter bed site
selection slope aspect measured study conifer cover snow interception` · `elk
bed site selection slope degrees aspect Cervus canadensis telemetry study`.
  Only Millspaugh 1998 and Merrill 1991 surfaced, and neither uses a surround
  metric.
- **Elk-specific NLCD/landcover resistance values — none found.** `elk group
size herd cow calf social movement corridor least cost path connectivity
resistance surface Cervus canadensis`. Generic resistance-surface
  methodology only; no published elk value table located.
- **Direct elk (adult) locomotion energetics — one lead, unread.** `elk
energetics cost of locomotion horizontal vertical J per kg per meter Cervus
elaphus treadmill` · `"Oxygen utilization by elk calves" horizontal vertical
locomotion Comparative Biochemistry Physiology 1978 cost vertical meter`.
  Cohen, Robbins & Davitt 1978 located; **calves only; not read at source.**

## 11 · Unread-at-source ledger for pass 7

`WebFetch` returned `EGRESS_BLOCKED` on `a100.gov.bc.ca` (retested this pass;
consistent with passes 4–6). **No full text was read in this pass.** Everything
above is abstract-, snippet- or indexed-body-level and is marked where it
matters. Highest-value documents to attack first if the egress situation
changes, in order:

1. **Millspaugh et al. 1998** — need the actual slope test statistic and the
   aspect selection ratio. This single paper carries §2's verdict.
2. **Ranglack et al. 2017** + the FWP final report — need the slope and
   elevation coefficients and their signs, which decide whether §4/§5 can be
   parameterised at all.
3. **Poole & Mowat 2005** — need the topographic snow-depth surrogate model.
   It is the closest published thing to what this engine should compute.
4. **Cohen, Robbins & Davitt 1978** — the only direct elk locomotion datum.
5. **BC WHR Rocky Mountain Elk accounts (4 documents)** — need the slope-class
   rating table verbatim, not the indexed prose.
6. **Noyes et al.** — need the conception-date distributions, not just the means.

## Pass-7 changelog

| Row                                                           | Whitetail grade | **Elk grade**                             | Verdict                                                                                         |
| ------------------------------------------------------------- | --------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Rut model (`peakBreedingDayOfYear`, `WINDOWS`, `PHASE_NOTES`) | 🔴/🟢 mixed     | 🔴 **inapplicable**                       | ~8 weeks early in Sept; **confidently wrong** in Nov. Refuse for elk                            |
| `beddingLikelihood` composite                                 | 🔴/🟡 mixed     | 🔴 **inapplicable**                       | Grey out. Slope shown not to discriminate elk beds; discriminating variables invisible to a DEM |
| `padTerm` half-max 12°                                        | 🔵              | 🔴 **unknown**                            | Three elk sources, three shapes. Range recorded, no midpoint picked                             |
| `ringTerm` 15°/4°                                             | 🔴              | 🔴 **no elk basis**                       | Whitetail band centre applied to a surround metric                                              |
| Warm-season aspect                                            | absent          | 🔴 **wrong sign**                         | Millspaugh: north aspects selected for summer day beds; our term is off above +5 °C             |
| `shelterTerm` floor 0.25                                      | 🔴              | 🔴 **contradicted**                       | Cook et al. 1998: no thermal-cover benefit for elk                                              |
| `coverTerm` VRM/0.06                                          | 🔴              | 🔴 **wrong proxy**                        | Elk cover signal is canopy closure; a DEM cannot see it                                         |
| Thermal direction                                             | 🟢              | 🟢 **transfers**                          | Meteorology                                                                                     |
| Thermal strength `slope/30`                                   | 🔴              | 🔴 **saturated + wrong driver**           | Depth scales with vertical drop (Stull §17.3), not local angle                                  |
| Thermal transition ±45 min global                             | 🔴              | 🔴 **~1 h aspect error**                  | Topographic shading advances evening transition ~1 h                                            |
| Scent cone 400 m / 25°                                        | 🔴              | 🔴 **+ wrong object**                     | No elk measurement; wedge wrong in confined drainage                                            |
| `toblerSpeed`                                                 | 🔴              | 🔴                                        | Human function; asymmetry matters more here                                                     |
| `C₀ = 2.6`                                                    | 🟢              | 🟢 **stronger for elk**                   | Brockway & Gessaman measured _Cervus elaphus_                                                   |
| `k_up`/`k_dn`                                                 | 🔵              | ⚠️ **extrapolated 3–5× past the bracket** | State it; do not silently re-run                                                                |
| `NLCD_RESISTANCE`                                             | 🔴              | 🔴 **possibly inverted**                  | 52 / 71 / 82 argued above                                                                       |
| `impassableSlopeDeg 55`                                       | 🔴              | 🔴                                        | Never binds for elk either                                                                      |
| Distance to motorized route                                   | absent          | 🟢 **measured, absent**                   | Ranglack: 2 760 m archery / 1 535 m rifle                                                       |
| Elevation / elevational migration / snow                      | absent          | 🟢 **measured, absent**                   | Poole & Mowat: 1 000–1 400 m migration; elk avoid > 50 cm snow                                  |
| Herd-scale patch operator                                     | absent          | 🔵 **scale mismatch**                     | Rifle security unit ≥ 20.23 km² vs a per-cell score                                             |
| Forage                                                        | absent          | 🟢 **measured, absent**                   | Rowland 2018: DDE standardised coef +0.656                                                      |
| Wallows                                                       | absent          | 🔴 **no literature**                      | Doctrine only; do not chip it above 🟡                                                          |
| Grizzly advisory                                              | absent          | —                                         | FWP has now **confirmed** grizzly in the Tobacco Roots. Advise, never model                     |
