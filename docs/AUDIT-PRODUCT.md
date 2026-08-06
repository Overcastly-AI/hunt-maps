# Product audit — Ridgeline

Independent product audits. Newest first. Written by `product-auditor`, which
deliberately does not read the engineering audit first.

The operating question is always the same: **would a serious whitetail hunter
switch to this and never go back?**

---

# 2026-08-06 — Interaction patterns from serious outdoor and map applications

**Scope:** what Ridgeline's UI should learn from CalTopo, Gaia GPS, FATMAP,
avalanche forecast products, Komoot/Strava, and the Google/Apple Maps baseline.
Audited against the current `apps/web` UI as of this date.

## Sourcing note — read this before trusting a citation

**Second pass, 2026-08-06.** The first pass could not do any live research and
said so. This pass got partway. What changed and what did not:

**Still blocked.** Egress policy allows GitHub-family hosts only. `avalanche.org`,
`caltopo.com`, `gaiagps.com`, `fatmap.com`, `en.wikipedia.org` and every search
engine still return `403` at CONNECT; `WebSearch`/`WebFetch` are not enabled in
this context; the GitHub search API is repository-scoped. Verified by probe, not
assumed.

**What worked.** `git clone` over HTTPS to `github.com` and
`raw.githubusercontent.com` both succeed for arbitrary public repositories. That
turned out to be enough for the section that matters most, because **the two
reference avalanche products are open source**. Everything in the avalanche
sections below is now quoted from source files and shipped help text that were
cloned and read today, not recalled.

Primary sources actually read (all cloned at `--depth 1` on 2026-08-06):

| Source | What it is | Files read |
|---|---|---|
| [`NWACus/avy`](https://github.com/NWACus/avy) (MIT, © Northwest Avalanche Center) | The official NWAC / US National Avalanche Center forecast app. Implements NAPADS. | [`components/DangerRose.tsx`](https://github.com/NWACus/avy/blob/main/components/DangerRose.tsx), [`components/SeverityNumberLine.tsx`](https://github.com/NWACus/avy/blob/main/components/SeverityNumberLine.tsx), [`components/AvalancheProblemLikelihoodLine.tsx`](https://github.com/NWACus/avy/blob/main/components/AvalancheProblemLikelihoodLine.tsx), [`components/AvalancheProblemSizeLine.tsx`](https://github.com/NWACus/avy/blob/main/components/AvalancheProblemSizeLine.tsx), [`components/AvalancheProblemCard.tsx`](https://github.com/NWACus/avy/blob/main/components/AvalancheProblemCard.tsx), [`content/helpStrings.ts`](https://github.com/NWACus/avy/blob/main/content/helpStrings.ts), [`types/nationalAvalancheCenter/schemas.ts`](https://github.com/NWACus/avy/blob/main/types/nationalAvalancheCenter/schemas.ts) |
| [`albina-euregio/albina-website`](https://github.com/albina-euregio/albina-website) | The EUREGIO `avalanche.report` platform (Tyrol / South Tyrol / Trentino). EAWS-conformant; its glossary content is republished from `avalanches.org`. | [`app/components/icons/exposition-icon.tsx`](https://github.com/albina-euregio/albina-website/blob/master/app/components/icons/exposition-icon.tsx), `app/components/icons/warn-level-icon.tsx`, `app/components/bulletin/bulletin-danger-rating.tsx`, `app/components/bulletin/bulletin-problem-item.tsx`, `public/content/education/danger-scale/en.html`, `public/content/education/handbook/en.html`, `app/components/bulletin/bulletin-glossary-en-content.json` |
| [`material-components/material-components-android`](https://github.com/material-components/material-components-android) | The written spec behind the bottom-sheet muscle memory on Android. | [`docs/components/BottomSheet.md`](https://github.com/material-components/material-components-android/blob/master/docs/components/BottomSheet.md) |
| [`organicmaps/organicmaps`](https://github.com/organicmaps/organicmaps) | A shipping offline-map app with a mature region-download flow. Used as a **stand-in** for Gaia/onX, which are closed. | [`data/strings/strings.txt`](https://github.com/organicmaps/organicmaps/blob/master/data/strings/strings.txt) |

**Still unverified, and now marked as such in the text.** CalTopo, Gaia GPS,
FATMAP, onX Hunt, HuntStand, Komoot, Strava, Google Maps and Apple Maps are all
closed products with no reachable documentation from here. Claims about them are
labelled **[recalled]** where they survive, and several first-pass claims have
been **deleted outright** rather than left standing — including the Gaia
layer-catalogue size and the FATMAP/Strava status. A `[recalled]` claim is
prior working knowledge, is fine as a design prompt, and is **not** adequate
grounds for a build decision on its own.

**The research changed the headline recommendation.** The first pass proposed a
"bedding rose" with wedges *shaded by modelled likelihood*. Both reference
products deliberately do not do that — see §2, which has been rewritten, and the
full spec in recommendation #8.

**Findings about our own code were verified against the source in the first pass
and are unchanged here.**

## What we studied

| Product | Why it is the relevant comparison | Evidence status |
|---|---|---|
| **Avalanche forecast products** — NAPADS as implemented by the US National Avalanche Center; EAWS as implemented by the EUREGIO `avalanche.report` platform | The closest analogue to our problem: modelled and judged risk presented honestly to people making life-safety decisions on terrain. The danger scale, the aspect/elevation rose, the separation of likelihood from size, and the scale-of-validity statement. **This is the important one and it is now fully sourced.** | ✅ **Read today** — [`NWACus/avy`](https://github.com/NWACus/avy), [`albina-euregio/albina-website`](https://github.com/albina-euregio/albina-website) |
| **Google Maps / Apple Maps** | The baseline every user's muscle memory is trained on. Bottom sheets with detents, floating controls, what a control that opens a panel is *expected* to do. | ⚠️ Partially — the underlying **Material** bottom-sheet spec was read; the two products themselves were not reachable |
| **Offline region download** | How size, progress and failure are communicated. Gaia and onX are the products hunters actually use; both are closed. | ⚠️ **Substituted** — [`organicmaps/organicmaps`](https://github.com/organicmaps/organicmaps) shipping strings read today. Gaia/onX specifics are **[recalled]** |
| **CalTopo** | The power-user backcountry mapping tool. Composable base layers, per-overlay opacity, custom layer URLs, unapologetic density. Users are SAR professionals. | ❌ **[recalled]** — `caltopo.com` unreachable |
| **Gaia GPS** | The mobile map-first pattern at scale: a large searchable layer catalogue separated from a short active stack. | ❌ **[recalled]** — `gaiagps.com` unreachable |
| **FATMAP** | 3D terrain and slope-angle shading for avalanche terrain; curated map modes rather than a catalogue. | ❌ **[recalled]** — `fatmap.com` unreachable |
| **Komoot / Strava** | Route-planning interaction and elevation-profile presentation; the map↔profile crosshair link. | ❌ **[recalled]** |
| **onX Hunt / HuntStand** | The incumbents we are trying to displace. Studied mainly for what not to copy. | ❌ **[recalled]** |

## Ratings

| Area | Rating | One-line verdict |
|---|---|---|
| Layer management at scale | **B−** | Well-organised for 10 layers, with real craft in the blurbs and exclusivity rules — but it does not scale to a filter library, and it is a wall of prose on a phone. |
| Presenting modelled/uncertain output | **D** | The `Confidence` primitive is built, exported, documented — and used in **zero** places in the app. Bedding renders in the same confident visual grammar as slope. This is the moat, and it is currently invisible. |
| Transient controls vs persistent panels | **B** | `ConditionsBar` + anchored `Popover` is genuinely excellent and better than the incumbents. Undermined by one state variable that makes the flagship interaction impossible. |
| Offline download flow | **F** | The download button is `onClick={() => undefined}`. The "Offline ready" chip is a global boolean sampled once at mount and will lie to a user standing on uncached ground. |
| Time to first insight | **D+** | A new user is shown a beautiful map that tells them nothing they did not already know. There is no moment where the app *reads the ground for them*. |
| Field experience (gloved, dark, one-handed) | **C+** | 44 px touch floor, glass material, colour never load-bearing alone — all correct at the token level. Then a fake drag handle, a sheet that hides the conditions bar on mobile, and no night mode. |

---

## Findings by question

### 1. Layer management at scale

**What the good ones do.** *Everything in this subsection is* **[recalled]** —
CalTopo, Gaia and FATMAP were all unreachable. Treat it as a design prompt, not
as evidence. The specific numbers the first pass carried (Gaia's catalogue size)
have been deleted rather than left standing.

The single most transferable idea is the one Gaia GPS gets right and almost
everyone else gets wrong: **separate "what is on" from "what exists".** Gaia's
layer UI is two surfaces — a short, ordered, per-layer-opacity *active stack* you
can reorder and delete from, and a larger searchable, categorised *catalogue* you
add from. The active stack stays a handful of items long forever; the catalogue
can grow without the panel becoming a wall, because you only visit it when you
are adding something.

CalTopo takes the opposite bet and it also works, for a different reason. Its
list is dense, flat, and little is hidden behind progressive disclosure — but its
*top-level* list stays short because layers are **compositional**: one topo entry
with toggleable sub-layers rather than six top-level entries. The lesson is not
"be dense"; it is **density is fine, unpredictability is not**. CalTopo's users
tolerate a wall because the wall never moves and every control is one click deep.

FATMAP goes the third way: a handful of curated *modes*, not a layer list. Right
answer for a mainstream audience, wrong answer for ours.

**Deleted from the first pass:** a claim about FATMAP's current status inside
Strava. It could not be verified from here, it was doing no work in the argument,
and a product audit that cannot check a fact should not assert it.

**Where Ridgeline actually is.**

`apps/web/src/lib/layers.ts` is one of the better-reasoned files in the
repository. The header comment states the cartographic rules and the code
enforces them — `exclusive` on the four continuous ramps, base-layer radio
behaviour, `LAYER_GROUPS` with a hint per group. `toggleLayer()` enforcing
one-ramp-at-a-time rather than trusting the user is exactly right, and better
than CalTopo, which will happily let you composite three ramps into mud.

Three problems, in order of severity.

**(a) It is a wall of prose on a phone.** `LayersSheet` renders all ten layers,
all groups expanded, with every `blurb` always visible. The blurbs average
around 25 words. That is roughly 250 words of body copy in a sheet whose mobile
`max-height` is a fraction of the viewport. "Bedding likelihood" — the flagship
layer, the one that embodies advantage #1 — is **last in the list**, behind
about three phone-screens of scrolling. At 05:30 with gloves on, the most
differentiating thing this product does is three scrolls deep.

The blurbs are a genuine advantage and must not be deleted. The fix is
disclosure, not deletion: show the blurb for the row that is on or focused,
collapse the rest to the label plus a swatch. Keep the full text one tap away
and keep it in the DOM for screen readers.

**(b) There is no design for the case that matters.** Ten fixed layers do not
need search. **An unbounded saved-filter library does.** The vision document is
explicit that the filter library is the user's scouting IP and the source of
switching costs — which means a committed user has twenty to fifty of them, and
`LayersSheet` renders saved filters as an undifferentiated flat list with no
search, no favourites, no recency, no folders, and no way to create one (`New
filter` is `onClick={() => undefined}`).

Apply the Gaia split *asymmetrically*: the ten analysis layers stay a curated,
grouped, always-visible short list. Saved filters get search, favourites,
recently-used, and eventually folders. **Do not build a catalogue browser for
ten items** — that is fake sophistication and it would make the fixed layers
harder to reach in exchange for solving a problem we do not have.

**(c) No summary of the current state.** When the sheet is closed there is
nothing on screen that says what is on. Every serious mapping tool has some
version of this. A one-line active-stack summary in the rail, or a badge count
on the layers button, costs almost nothing.

**Not worth copying:** drag-to-reorder for the ten analysis layers. The
exclusivity rules and the documented stacking order (imagery → hillshade →
ramp → discrete) already determine a correct z-order, and letting a user put
slope under hillshade produces a worse map with no upside. Reorder matters for
**saved filters only**, where the user's colour choices genuinely compete.

---

### 2. Presenting modelled and uncertain output

This is the section that matters most, and it is where Ridgeline currently
scores worst against its own stated values.

**What avalanche forecasting actually does — now sourced.**

Avalanche forecasting is the mature discipline for publishing a judgement about
terrain to people who will act on it and can be killed by it being wrong. The
first pass reasoned about it from memory and got two things wrong. Here is what
the shipping code and shipping help text say.

**(i) Ordinal, never continuous; four redundant channels.** Both scales are five
levels, and both attach more than a colour to each level. NAPADS, quoted from
NWAC's shipped `dangerScaleDetail` help string:

> The North American Public Avalanche Danger Scale (NAPADS) is a system that
> rates avalanche danger and provides general travel advice based on the
> likelihood, size, and distribution of expected avalanches. It consists of five
> levels … 1 - Low, 2 - Moderate, 3 - Considerable, 4 - High, 5 - Extreme.
> … Although the danger ratings are assigned numerical levels, **the danger
> increases exponentially between levels.**

— [`avy/content/helpStrings.ts`](https://github.com/NWACus/avy/blob/main/content/helpStrings.ts)

That last clause is the sentence to steal. They number the levels and then
immediately warn the reader **not to do arithmetic on the numbers**. An ordinal
scale that looks like a cardinal one is a trap, and they defuse it in the help
text rather than hoping nobody notices.

EAWS resolves the first pass's `[verify]` marker and diverges in one place: level
5 is **"Very high"**, not "Extreme". Each level carries a numeral, a name, a
one-line *situation phrase*, a description, and a **"Recommendations for
backcountry recreationists"** block:

> Danger level 3 – Considerable · *Critical avalanche situation* … **The most
> critical situation for backcountry recreationists.** Use terrain efficiently
> and select best possible route and with minimal exposure. Avoid very steep
> slopes with the aspect and elevation indicated…

— [`albina-website/public/content/education/danger-scale/en.html`](https://github.com/albina-euregio/albina-website/blob/master/public/content/education/danger-scale)

**And EAWS publishes the base rate of every level.** Level 1: "Forecast for
around 20 % of the winter season. Around 5 % of avalanche fatalities." Level 2:
~50 % of the season, ~30 % of fatalities. Level 3: ~30 % of the season, **~50 %
of fatalities**. Level 4: "only a few days throughout the winter", ~10 % of
fatalities. Level 5: "Very rarely forecast."

This is the most quietly radical thing in either product and no hunting app does
anything like it. Publishing how often a class is issued *and* what share of bad
outcomes it accounts for lets the user calibrate. It is the same instinct as this
project's use-vs-availability rule, applied to the legend instead of the chart.
**Ridgeline should publish the base rate of every bedding class on the current
property**: "prime covers 4 % of this ground" is worth more than the colour.

Ridgeline currently renders `bedding` as a continuous colour ramp over a
multiplicative composite whose weakest inputs are graded 🔴 **Assumed** in
`docs/EVIDENCE.md` (`idealSlopeDeg: 22`, the 30° shelter saturation, the
ruggedness/4 m cover term; the leeward `cos(aspect − windFrom)` term is 🟡
Doctrine). A smooth ramp over that is a precision claim we cannot support.
**Band it** — three or four ordinal classes with hunter-language names and a
sentence each. Banding is not dumbing down; it is refusing to publish decimal
places we do not have.

**(ii) The rose is a binary mask, not a heatmap. The first pass had this wrong.**

This is the correction that matters. The first pass proposed a bedding rose with
wedges "shaded by modelled bedding likelihood". **Neither reference product
shades its rose by magnitude.** Both use it as a presence/absence mask over the
terrain space, and put the ordinal magnitude somewhere else entirely.

NWAC's rose is 8 aspects × 3 elevation bands = 24 sectors, and every sector is
filled with one flat grey or left transparent:

```tsx
// avy/components/DangerRose.tsx
<Path d={paths[location]} stroke={'rgb(81, 85, 88)'} strokeWidth={10}
      fill={locations.includes(location) ? 'rgb(200, 202, 206)' : 'transparent'} />
```

The shipped explanation is unambiguous — *"The diagram **will be filled with
black where the Avalanche Problem may exist**"* — and it also documents the ring
order, which is inverted relative to what most people guess:

> You can view the diagram as you would a mountain on a topographic map. The
> **outer ring** represents the **Below Treeline** elevation band, middle ring
> Near Treeline, and the **inner ring Above Treeline**. The diagram is oriented
> like a compass, with the top wedges representing north aspects, the left wedges
> representing west.

EAWS is even more reduced: 8 aspects, **no elevation rings at all**, one flat
blue fill (`#19ABFF`), and only N and S labelled
([`exposition-icon.tsx`](https://github.com/albina-euregio/albina-website/blob/master/app/components/icons/exposition-icon.tsx)).
Elevation is carried by a *separate* icon with an explicit threshold — "above
2200 m", "treeline", or a band "1800–2400 m" — and danger level by a *third*
icon, a mountain split above/below one elevation line showing at most two levels
(`warn-level-icon.tsx`, `bulletin-danger-rating.tsx`). The EAWS handbook: *"The
blue-marked segments of a wind rose are indicators of those aspects."*

**Why they refuse to shade it.** The rose answers *where*; the scale answers *how
bad*. Colouring 24 cells by magnitude produces a field nobody can read at a
glance and implies the model resolves danger at 24 aspect×elevation combinations,
which it does not. Our bedding model does not resolve at 24 combinations either.

**Two details worth copying exactly.** First, **every cell is stroked, including
the empty ones** — the unselected sectors are drawn as outlines, so the full
24-cell grid is always present. You always see the denominator. That is the
use-vs-availability principle rendered as a graphic, and it costs one line of
code. Second, the elevation band *names* are a parameter
(`ElevationBandNames` is passed into `AnnotatedDangerRose`), because different
forecast centres use different vocabulary for the same bands.

A bedding rose is still the single best idea in this audit. The encoding is
different from what the first pass proposed. Full spec in recommendation #8.

**(iii) Likelihood and size are separate axes — but distribution is not a third
one.** The first pass said "likelihood is reported separately from consequence",
which is right, and implied distribution is an independent third axis, which is
wrong. NWAC's help text:

> **Likelihood** … *combines* the spatial distribution of the Problem and the
> sensitivity or ease of triggering an avalanche.

So distribution is folded *into* likelihood, and *also* drawn separately on the
rose — deliberately shown twice, once as a component of the ordinal and once as a
map of where. Size is genuinely independent and never multiplied in.

**The uncertainty encoding the first pass missed entirely: the ordinal is
published as a range.** `AvalancheProblemSizeLine` takes `size: number[]` — a
`[from, to]` pair — and `SeverityNumberLine` renders it as a **bar spanning
several labels**, with every covered label bold and the rest greyed:

```ts
// avy/components/SeverityNumberLine.tsx
export interface SeverityNumberLineRange { from: number; to: number; }
```

A forecaster who is unsure between "Large" and "Very Large" publishes *both* and
the graphic shows a two-cell bar. This is a far better answer to model
uncertainty than a confidence chip bolted onto a point estimate, and it is
directly transferable to a banded bedding class. EAWS does the complementary
thing and **truncates the top of the scale**: sizes 3, 4 and 5 all map to the
same visual class (`textInfoToClass` in `bulletin-problem-item.tsx`), because
above a point the distinction stops changing what you do.

**(iv) Confidence — partially confirmed, and one first-pass claim corrected.**
`High / Moderate / Low` is real and is in the national data model:

```ts
// avy/types/nationalAvalancheCenter/schemas.ts
export const DangerConfidence = { High: 'high', Moderate: 'moderate', Low: 'low' } as const;
export const DangerTrend      = { Increasing: …, Steady: …, Decreasing: … } as const;
```

Two corrections. It sits on the `danger_rating` object **alongside a trend**, and
it is optional (`.or(z.string().length(0))`). And there is **no structured
"reason" field** — the first pass asserted confidence is published "with the
reason", and I could not verify that. The justification lives in free prose
(`bottom_line`, `terrain_use`, `avalanche_problems_comments`). So: the three-level
vocabulary is confirmed and worth adopting verbatim; the claim that a machine-
readable justification accompanies it is withdrawn.

The **trend** field is a free idea we should take. EAWS ships the same thing as
`tendency` (*increasing / steady / decreasing*, "expected trend for the following
day"). Bedding has an obvious analogue: thermal phase turns over twice a day and
the wind forecast moves. "Bedding likelihood on these faces is **decreasing** —
the thermal switches in 40 minutes" is a sentence no hunting app can currently
produce and our engine already has the inputs for.

**(v) The scale-of-validity statement — the best single sentence in either
product, and we have no equivalent.**

> The danger level always applies to a **region with an area of >100 km²** and
> **not to a specific individual slope**. The avalanche danger described on
> avalanche.report is always a forecast with uncertainties. **It should always be
> checked on site.**

They render a per-region colour on a map and then state in plain words the
resolution at which that colour is meaningful — which is much coarser than the
pixels imply. Ridgeline renders bedding at DEM resolution and implicitly claims
per-pixel truth. We do not have per-pixel truth. Every judgement layer and the
bedding rose should carry a one-line extent-and-resolution statement. It costs a
sentence and it is the difference between a forecast product and a toy.

This is exactly what `docs/EVIDENCE.md` already contains and exactly what the
`Confidence` primitive was built for. And:

```
$ grep -rn "Confidence" apps/web/src/
(no matches)
```

The primitive is defined at `packages/design/src/components/primitives.tsx:467`,
exported, carries a thoughtful doc comment about being a design-system primitive
"so that showing the evidence grade is the path of least resistance" — and is
used in **zero** places in the application. The register grades nine parameters
🔴 Assumed. A user of the current build sees none of that. The product's
deepest claimed moat, "honest analytics", is presently a markdown file.

**(vi) When the model has nothing to say, the graphic is removed — not drawn
empty.** Verified, and it is more decisive than the first pass claimed. The EAWS
handbook:

> If no particular avalanche problem predominates (often the case at danger level
> 1 – low) **this information is omitted** and a favourable avalanche situation
> is declared.

Not a greyed rose. Not 24 empty cells for the user to interpret. The diagram is
withdrawn and replaced by a positive statement in words. This is the pattern for
degradation, and it is the basis of the low-confidence behaviour in the rose spec
below.

Ridgeline already has the right instinct here — `blockedReason` on `ToggleRow`
and the missing-wind path are genuinely good, and better than most commercial
products. Credit where due. What is missing is the second half: when the *inputs*
are present but the *model cannot discriminate*, we currently draw a flat map and
say nothing.

**The cartographic rule nobody in hunting apps follows, and we should.**
**[recalled]** for the competitor half — I could not reach FATMAP, CalTopo or
Gaia. What I *can* evidence is the discipline's own separation: EAWS draws the
aspect rose, the elevation threshold and the danger level as **three separate
graphics** (`exposition-icon`, `elevation-icon`, `warn-level-icon`) rather than
one composite colour, and the terrain-fact products (slope-angle shading, ATES
ratings) are published as different artefacts entirely. Different visual
language, different layer, never composited into one colour.

Ridgeline currently renders `slope` (Horn 1981, validated against closed-form
surfaces, unambiguously fact) and `bedding` (a multiplicative composite of three
invented constants) **in the same visual grammar**: a continuous translucent
raster ramp. Nothing in the pixels tells the user which is which. That is the
most serious overclaim in the app today, and it is a rendering decision, not a
maths decision.

**Recommendation: give judgement layers their own material.** Modelled outputs
should render with a visibly different fill — soft-edged, desaturated, or
stippled/hatched — so that even a user who never reads a chip has their eye told
"this is an interpretation". Fact layers stay crisp and banded. Then:

**Where the `Confidence` chip should and should not go.** Chips everywhere
become wallpaper and stop being read; that failure is as real as omitting them.
An opinionated rule:

- **Fact layers get no chip.** Hillshade, slope, aspect, landform, saddles,
  benches. These are published, peer-reviewed algorithms validated against
  analytic surfaces. Badging them "Measured" devalues the badge that matters.
- **Judgement layers always get a chip, at the weakest grade of their inputs.**
  Bedding (🔴 Assumed — `idealSlopeDeg`), thermal phase (🟡 Doctrine), scent cone
  (🔴 Assumed), corridor cost (🔵 Inferred, human-fitted Tobler), rut phase
  (🟢/🔵 by latitude, and `rutConfidence()` already degrades below 38°N).
- **The chip is tappable and opens the evidence note**, with the citation, from
  `docs/EVIDENCE.md`. Which means the register's content has to ship as data in
  `packages/shared`, not just as prose in `docs/` — otherwise it is unavailable
  in the field, which is where the user is when they decide to trust it.
- **Four surfaces:** the layer row in the sheet, the on-map legend for the
  active judgement layer, each derived value in the terrain readout card, and
  every number in any analytics view.

**Staleness.** Every avalanche forecast leads with issued time and expiry —
"valid until 6pm". Ridgeline's wind is a value a user typed at some point and
never expires. If a bedding layer is being rendered against a wind set six hours
ago, or against a time-scrub position hours from now, the map should say so on
its face. Cheap, and it is the difference between a tool and a toy.

---

### 3. Transient controls vs persistent panels

**The rule the good apps converge on.** Stated as sharply as I can:

| Surface | Use when | Examples |
|---|---|---|
| **Persistent chip / bar** | The state *changes what the map means* and the user must never be unsure which state is on. | Transit time selectors; avalanche forecast date |
| **Anchored popover** | Editing one value, content under ~1 screen, must not move the map or its own trigger. | Google Maps layer toggle; CalTopo per-layer opacity |
| **Bottom sheet with detents** | Content the user reads *while looking at the map*; map must stay interactive and pan the target above the sheet. | Apple/Google place cards; Gaia waypoint detail |
| **Full drawer / modal** | Irreversible, committing, or long-running; the map is irrelevant to the decision. | Offline download commit; delete; share |

**Ridgeline gets the top two better than the incumbents.** `ConditionsBar` is
the best thing in this UI and I want to be unambiguous about it. Putting wind,
time and thermal phase in permanent chrome — with the doc comment explaining
that these are not settings but the thing that changes what every layer *means*
— is a genuinely original piece of product thinking and it is correct. So is the
`Popover` doc comment at `primitives.tsx:504`, which records why the wind editor
stopped being a drawer: it moved its own trigger and had no spatial relationship
to it. That is the right instinct and the right level of documentation.

**Then one line of state throws it away.**

```ts
type Panel = 'layers' | 'wind' | 'time' | null;   // apps/web/src/App.tsx:38
```

Three unrelated surfaces share one slot, so they are mutually exclusive. The
consequence: **you cannot have the layers sheet open and change the wind.** But
the single highest-value interaction this product offers — the thing that makes
a hunter say "nothing else does this" — is *turn on bedding likelihood, then
sweep the wind through the compass and watch which hillsides light up*. Today
that is: open layers → enable bedding → close layers → open wind → change →
close → reopen layers to check the legend. The layers sheet and the wind popover
are different classes of surface under the rule above; they should be
independent state.

It is worse on a phone. The desktop drawer is deliberately inset
(`bottom: calc(var(--space-touch) + var(--space-6))`) so it clears the
conditions bar — good, deliberate, documented. But at `max-width: 860px` the
sheet goes full-width to `bottom: 0` and **covers the conditions bar entirely**.
So on the device a hunter actually carries, opening the layers panel hides the
wind and thermal state — precisely the state needed to interpret the layer being
turned on. Apple and Google solved this fifteen years ago with detents.

**The grip is a lie.** `Sheet` renders `<div className="rl-sheet__grip" />` and
the mobile stylesheet gives it the exact 36×4 px pill of a native drag handle.
There is no pointer handling anywhere in `primitives.tsx`. Every user trained on
iOS or Android will drag it, and nothing will happen. An affordance that does
not work is worse than no affordance, because it teaches the user the app is
broken in the first ten seconds. Either implement detents or delete the pill
today — and detents are worth building, because a **peek** detent (active-layer
summary + top-layer opacity, conditions bar still visible) is exactly the state
a hunter wants while comparing a layer against the ground.

**The inspect card is the wrong surface.** `App.tsx:245` renders a floating
`role="dialog"` card at a fixed position with no relationship to the point that
was tapped, no marker drawn on the map, and no map offset. Both baseline maps
put a pin at the point and slide the map so the pin stays visible above the
sheet. Terrain readout is textbook peek-detent bottom-sheet content. (It also
currently shows only latitude and longitude — a readout that reads back the
coordinate the user just tapped. `BACKLOG R6`.)

---

### 4. The offline download flow

**What a good one looks like, distilled.**

1. **The region is drawn on the map by direct manipulation** — drag a box, or
   buffer a route/boundary. Never picked from a list of named tiles. Gaia and
   onX both do this.
2. **Size, tile count and time estimated before commit**, in units the user
   cares about: megabytes, and "about 4 minutes on this connection". Gaia shows
   this pre-commit; it is the single most-copied thing in the flow.
3. **Detail depth expressed as a consequence, not a z-level.** "Detail down to
   about 1:5,000 — individual trees" beats "max zoom 16". Every app that shows
   the raw number makes users guess.
4. **Progress survives backgrounding, and is resumable.** A 20-minute download
   killed by a phone locking is the classic failure.
5. **Failures are loud and specific.** "23 of 4,120 tiles failed — retry" beats
   a silent partial region that reads as complete and is discovered blank in a
   hollow. CLAUDE.md already names this as the worst failure this product has.
6. **Storage accounting and eviction.** Total used, per-region size, sorted by
   last used, one-tap delete.
7. **Coverage drawn on the map itself** — a hatched or outlined overlay showing
   which part of the current view is downloaded. This is the thing most apps do
   badly and it is the thing that matters most, because it is the only way the
   user can answer "am I covered where I am going" without guessing.

**Where Ridgeline is.** Nothing exists in the UI:

```tsx
<RailButton label="Save this area for offline use" onClick={() => undefined}>
```

Server-side estimation and honest pre-download warnings are built (ROADMAP
Phase 1), so this is a missing front door, not a missing capability. `BACKLOG R4`
has it as P0/M. Agreed — with the additions above, especially (7).

**One defect here is worse than "missing" and should be fixed regardless of R4.**

```ts
void openTileStore().then((s) => s.stats()).then((s) => setOfflineReady(s.tileCount > 0));
```

`offlineReady` is a **global** boolean, sampled **once at mount**, and it drives
a chip in the layers sheet that says *"Offline ready — elevation for this area is
stored on this device. Analysis layers work with no signal."* The words "this
area" are in the string. The value has nothing to do with the current area. Pan
five hundred miles and it still reads green. Download one tile in Ohio, drive to
Kansas, and the app tells you you are covered.

By the project's own priority order — "anything that leaves a user without a map
in the field: critical always" and "anything confidently wrong is worse than
missing" — this is the highest-priority item in this audit. It must become a
per-viewport coverage query, and it should be paired with the map-level coverage
overlay from (7) so the answer is spatial rather than binary.

**The thing to say out loud in this flow.** Gaia and onX both make you choose
*which layers* to download, because they cache rendered tiles. Ridgeline caches
elevation, so there is no such step — one download unlocks every layer, any
wind, any date. That is a structurally better flow *and* the clearest possible
demonstration of architectural advantage #3. The download sheet should say it in
one sentence, at the moment the user is comparing us to what they already pay
for.

---

### 5. Time to first insight (not in the brief; it is the finding that matters most)

A new user opens the current build. The map centres on a hardcoded
`{ lng: -82.54, lat: 39.43 }`, satellite and hillshade are on, the layers sheet
is open. It is a good-looking map. **It tells them nothing they did not already
know.** To learn anything they must know which layer to turn on, and to reach
the flagship layer they must first know that wind is a prerequisite, set it, and
scroll to the bottom of the list.

Every competitor has the same weakness, so this is not a gap — it is an opening.
We have an engine that computes saddles, benches, landform position and leeward
bedding on-device with no signal. Nobody else can do what follows:

**"Read this ground" — one tap, and the app tells the user something true about
their property they did not know.** Run the standing battery over the current
viewport or property boundary and produce a short findings list:

> - **4 saddles.** Two connect the north and south ridge systems — the likeliest
>   crossings on the property.
> - **11 benches**, 9 of them on east-facing slopes.
> - **On tonight's NW wind**, leeward bedding concentrates on the two
>   south-east-facing points off the main ridge. *Field doctrine — the slope
>   preference behind this is an assumption. Why?*
> - Only 6% of this property is over 30°. This is gentle ground; corridor
>   analysis will be weaker here than in hill country.

Each line taps to fly there and turn on the relevant layer. That is the moment a
hunter decides this is a different kind of product. Time to first insight goes
from "learn the layer taxonomy" to one tap, and every claim carries its evidence
grade, which turns the honesty policy from a constraint into the demo.

It also gracefully handles the honest negative — *"this ground is too flat for
the bedding model to say much"* — which no competitor will ever tell you and
which is worth more trust than ten confident hotspots.

---

## Prioritised recommendations

Ranked by "would a serious hunter switch to this and never go back". Items 1–3
are the ones that decide it.

| # | Recommendation | Size | Owner | Why it ranks here |
|---|---|---|---|---|
| 1 | Per-viewport offline coverage truth | S–M | `offline-steward` | The app currently lies about the one thing it cannot lie about |
| 2 | Deploy `Confidence` + separate fact from judgement cartography | M | `frontend-builder` + `map-builder` + `game-biologist` | The moat is a markdown file; make it visible |
| 3 | "Read this ground" first-run analysis | M–L | `map-builder` + `frontend-builder` | Time to first insight goes to one tap; nobody else can build it |
| 4 | Offline region picker (`R4`) with coverage overlay | M | `offline-steward` | Headline feature with no front door |
| 5 | Uncouple wind/time from the layers sheet | S | `frontend-builder` | One line of state blocks the flagship interaction |
| 6 | Legends for every continuous ramp | S | `map-builder` | Four ramps ship with no key at all |
| 7 | Band the bedding output; kill the continuous ramp | S–M | `terrain-scientist` + `map-builder` | A smooth ramp over three Assumed constants is a precision claim we cannot support |
| 8 | Bedding rose for the current wind | M | `map-builder` + `terrain-scientist` | Answers "where do I hang a stand on a NW wind" in one glance |
| 9 | Delete the fake grip now; detents next | S / M | `frontend-builder` | A dead affordance in the first ten seconds |
| 10 | Collapse blurbs; group accordions; active-stack summary | S | `frontend-builder` | Bedding is three phone-screens deep |
| 11 | Terrain readout as a peek sheet with a map marker | S–M | `map-builder` | Wrong surface; also `R6` |
| 12 | Staleness/validity marking on modelled output | S | `frontend-builder` | Borrowed straight from forecast expiry |
| 13 | Saved-filter search, favourites, recently-used | M | `frontend-builder` | Only after `R2` — build creation first |
| 14 | Night mode / red-light theme | S–M | `frontend-builder` | 05:30 in the dark is the actual use case |

### 1 — Per-viewport offline coverage truth · S–M · `offline-steward`

Replace the mount-time global boolean with a coverage query for the current
viewport at the current zoom, recomputed on `moveend` (debounced). Three states,
not two: **Covered** / **Partial — *n*% of this view** / **Not downloaded**. Add
a map-level overlay drawing the covered extent as a hatched region so the answer
is spatial, and reachable without opening any panel. Fix the chip's tooltip
string, which currently promises something the value does not mean.

*Done when:* pan from a covered area to an uncovered one with the sheet open and
the chip changes; airplane-mode the device over uncovered ground and the UI says
so before the layer fails.

### 2 — Deploy `Confidence` and split fact from judgement · M · `frontend-builder` + `map-builder` + `game-biologist`

Three parts, and the third is the one nobody will think of:

1. **Chips.** Judgement layers only, at the weakest input grade, in four places
   (layer row, on-map legend, terrain readout value, analytics number). Fact
   layers get nothing. Tapping opens the evidence note with its citation.
2. **Evidence as shipped data.** Move the grade + one-line justification +
   source URL for each parameter out of `docs/EVIDENCE.md` prose and into a typed
   record in `packages/shared`, with a test asserting every graded parameter in
   the engine has an entry. The register becomes machine-readable, the doc
   generates from it, and the notes are available offline — where the user is
   when they decide whether to trust the map.
3. **A separate material for modelled layers.** Judgement rasters render
   soft-edged or stippled; fact rasters stay crisply banded. Tokens for both go
   in `packages/design`. This is what makes the distinction survive a user who
   never reads a chip.

Closes `BACKLOG N10` and materially advances `N11`.

### 3 — "Read this ground" · M–L · `map-builder` + `frontend-builder`

One rail button, or the empty state of a fresh property. Runs the standing
battery over the viewport/boundary on-device and emits five to eight plain-
English findings with counts, each tapping to fly-to and enable the relevant
layer, each carrying its evidence grade. Must include honest negatives.

*Dependency, and the reason this is M–L not M:* the engine produces rasters;
findings need discrete features with centroids and counts (saddle extraction,
bench clustering, aspect histograms over the boundary). Some of that is a real
piece of `terrain-scientist` work. Scope a v1 to what can be counted cheaply
from existing raster outputs and grow it.

### 4 — Offline region picker · M · `offline-steward` (`BACKLOG R4`)

Drag-a-box on the map; live tile count, megabytes and time estimate as the box
changes; detail depth as a consequence sentence, not a z-level; explicit
persistent-storage status; resumable progress that survives backgrounding;
loud, specific, retryable failures; a region manager with sizes and last-used;
and the coverage overlay from #1. Include the one-line statement that this
single download unlocks every layer, any wind, any date.

### 5 — Uncouple wind/time from the layers sheet · S · `frontend-builder`

Split `type Panel` into an independent sheet state and an independent conditions-
editor state. Then, on mobile, make the sheet stop covering the conditions bar —
which is #9's peek detent, or as a stopgap cap the sheet's `max-height` so the
bar clears it.

*Done when:* bedding is on, the layers sheet is open with its legend visible,
and sweeping the wind through eight cardinal buttons visibly moves the layer
without closing anything.

### 6 — Legends for every continuous ramp · S · `map-builder`

`slope` and `wood` have legends. `aspect`, `weiss`, `insolation` and `bedding`
have none — and they are the four ramps a user is least able to decode by
intuition. A colour ramp without a key is decoration. Aspect in particular is
cyclic and unreadable without a compass key. Add `legend` entries in
`layers.ts`, and promote the active layer's legend to an on-map corner element
so it is visible with the sheet closed.

### 7 — Band the bedding output · S–M · `terrain-scientist` + `map-builder`

Replace the continuous ramp with three or four ordinal classes and a sentence
each, avalanche-scale style. Pair with the `Confidence` chip from #2. If a
continuous field is genuinely wanted for the corridor solver's attraction term,
keep it internally and band it only for display — the honesty problem is a
rendering problem.

### 8 — Bedding rose · M · `map-builder` + `terrain-scientist`

Eight aspect octants × three slope bands over the current viewport or boundary,
shaded by modelled bedding likelihood, wind arrow overlaid, `Confidence` chip
attached. Tapping a wedge filters the map to that aspect/slope combination.
Direct lift from the avalanche danger rose, applied to a question no hunting app
currently answers in one glance.

### 9 — Delete the fake grip now; detents next · S then M · `frontend-builder`

Remove `.rl-sheet__grip` from `Sheet` today, or wire pointer handling today.
Then build three detents — peek (active-layer summary + top-layer opacity,
conditions bar visible), half, full — with the map staying interactive at peek.

### 10 — Layer sheet density · S · `frontend-builder`

Blurb visible for enabled/focused rows only, collapsed elsewhere with an info
affordance, full text kept in the DOM for assistive tech. Group headers become
accordions remembering their state. Add an active-stack summary line, and a
count badge on the layers rail button.

### 11 — Terrain readout as a peek sheet · S–M · `map-builder` (`BACKLOG R6`)

Marker at the tapped point, map offsets to keep it visible, values grouped
fact-then-judgement, each judgement value carrying its `Confidence` chip.

### 12 — Staleness marking · S · `frontend-builder`

Timestamp the wind when set. If the render time is more than a couple of hours
from the wind's timestamp, or the time scrub is far from now, mark the
conditions bar and any wind-dependent legend. Model output with a shelf life
shown on its face is what separates a forecast product from a toy.

### 13 — Saved-filter management · M · `frontend-builder`

Search, favourites, recently-used, colour swatch, per-filter opacity, reorder.
**Sequenced after `R2`** — a library UI for a library nobody can add to is the
wrong order.

### 14 — Night mode · S–M · `frontend-builder`

The stated use case is 05:30 in the dark. A red/amber low-luminance theme that
preserves dark adaptation, with the map style dimmed and imagery desaturated.
Tokens already being the single source of truth makes this cheap. Every serious
astronomy and marine app has it; no hunting app does, and hunters are the
population that walks in before daylight by definition.

---

## What we should NOT copy

**onX's and HuntStand's deer-movement forecast meters.** Solunar/lunar-derived
activity dials. `docs/VISION.md` and `docs/EVIDENCE.md` already rule this out on
the evidence — the register records moon-phase non-effect as a **measured
negative result** and acts on it by exclusion. Worth restating here as a
*product* judgement, not just a scientific one: the meter is the most-used
feature in those apps and copying it would be the single fastest way to destroy
the only advantage that cannot be cloned in a sprint.

**Gaia's large searchable layer catalogue, applied to our ten layers.** Right
pattern, wrong cardinality. Search belongs on saved filters. Building a
catalogue browser for ten items adds a navigation level in front of the thing
the user came for.

**FATMAP-grade 3D terrain.** Beautiful, and correct for its sport: in ski
mountaineering the terrain is visible from kilometres away and the planning
problem is a whole-face, whole-couloir judgement. Whitetail hunting is a 2D,
sub-100 m, sub-canopy problem where the decisive features — a bench, a saddle,
an inside corner of a field edge — read *better* on multi-directional hillshade
than on an oblique 3D view, because 3D hides exactly the micro-terrain that
matters behind the near slope. The cost is real too: 3D means terrain meshes and
draped textures in the offline budget, which directly attacks advantage #3.
`ROADMAP` Phase 5 lists 3D above viewshed; **that ordering is wrong**. Viewshed
from a stand answers a question a hunter asks every single time they hang one
("what can see me, and what can I see"). 3D answers "this looks nice". Demote
3D below viewshed, and be willing to never build it.

**Strava-style aggregated activity heatmaps.** Technically straightforward,
commercially tempting, and an active harm. A heatmap of where hunters walk
discloses stand locations, concentrates pressure on public land, and creates a
safety and conflict problem on private ground. Strava's own military-base
incident is the canonical warning about aggregate location data being
individually identifying at low density — and hunting ground is *always* low
density. Never build it, and say so in `VISION.md` alongside the lunar
predictor.

**Komoot-style auto-routing as the primary route interaction.** Our corridor
solver models **deer** movement. Komoot's grammar — a line with a start pin, an
end pin, and an elevation profile — reads unambiguously as "the route *you*
take". A hunter who confuses "deer will move here" with "walk here" has just
walked their scent up the travel corridor and blown the property. Keep the
corridor's visual language deliberately unlike a navigation route (band, not
line; no start/end pins; no turn list). Access routing is a **different solve**
— minimise scent exposure and visual detection — and when we build it, it should
look like a route, because it is one.

**Google/Apple's automatic recentring and generous animation.** In the field a
map that moves without being asked is a hazard, and continuous animation costs
battery a hunter cannot recharge. Locate should fly once, on request, and then
leave the map alone. The existing `prefers-reduced-motion` handling is the right
instinct; extend it to a deliberate low-power posture.

**CalTopo's "nothing is explained" density, wholesale.** Its audience trained on
it professionally. The blurbs in `layers.ts` are a real advantage over every
competitor and should be defended — the fix in #10 is disclosure, not deletion.

**Any pattern requiring an online account check.** Gaia and onX both gate
downloaded maps behind subscription validation that phones home, and users have
been burned by it offline. A self-hosted product must never ship a code path
where the map stops working because a server could not be reached. This is worth
an explicit test in the offline-integrity loop, not just a principle.

---

## Two things worth saying that are not criticisms

Audits skew negative, so: `ConditionsBar` — the decision that wind, time and
thermal phase are permanent chrome rather than settings buried in a panel — is
better product thinking than anything the incumbents ship, and the `Popover`
doc comment explaining why the wind editor stopped being a drawer is the kind of
reasoning most teams never write down. And `blockedReason` on `ToggleRow`, which
makes "refuse to render against a default, and say why" the path of least
resistance rather than something every screen must remember, is a design-system
decision that will still be paying off in three years.

The gap is not taste or judgement. It is that the honesty machinery is built and
not yet plugged in, and the offline machinery is built and has no front door.
