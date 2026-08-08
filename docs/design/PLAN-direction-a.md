# Implementation plan — landing Direction A as the real front end

Status: **plan only, not yet reviewed, no app code written.** Written against
`docs/design/direction-a-instrument.html` (committed, the spec) and the actual
current state of `apps/web` and `packages/design` as of 2026-08-08 — not the
older audit docs, several of whose findings (`R42`, `R43`, `R44`, `R45`) have
already shipped and are called out below as "already correct, do not
re-litigate."

Owner of the visual decisions in this plan: `packages/design`, per
`CLAUDE.md` — "No literal colours, sizes or radii outside that package." Every
component change below lands there first; `apps/web` only consumes it.

---

## a. The token diff

`packages/design/src/tokens.ts` is the single source of truth;
`tokens.css` is generated from it and a CI test (`tokens.test.ts`) fails if
the two drift. Every colour, size and radius below is a `tokens.ts` edit —
nothing is a literal in a component.

### `color` — value changes

| Token                          | Current                    | Direction A                            | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------ | -------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ground`                       | `#0a0f14` (blue hour)      | `#0A0D0E`                              | Close in value, different hue bias — current is cold-blue (hue≈210°, "the actual colour of the sky forty minutes before shooting light"); A is cyan-biased but closer to neutral. This is a real, deliberate identity change, not a tweak, and the token's own doc comment justifying the blue-hour bias needs to be rewritten, not silently overridden.                                                                                                                                                                                                                          |
| `surface`                      | `#121a22`                  | `#14191B` (`--panel`)                  | Same direction as `ground`'s shift.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `raised`                       | `#1b242e`                  | `#1B2124` (`--panel-raised`)           | ”                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `line`                         | `#26323d`                  | `#29373A` (`--hairline`)               | ”                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `line-strong`                  | `#374757`                  | `#3A4A4D` (`--hairline-hi`)            | ”                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `text`                         | `#e8edf2`                  | `#D9E2DE`                              | A's ink is a phosphor bone-white, slightly green-grey; current is a cooler blue-white.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `text-dim`                     | `#b2bfcb`                  | `#8A9598`-ish (`--ink-secondary`)      | **Flag:** `text-dim` and `text-faint` were re-tuned in a prior pass (see the token file's own comment, lines 65–77) against _measured contrast over real glass_, sampling actual rendered pixels because a flat-swatch check had passed a blurb that was 2.55:1 in the field. **Any new value here must re-run that same measurement, not just eyeball it against a static swatch** — this is the exact regression class the comment exists to prevent, and it is invisible to `getByText`.                                                                                       |
| `accent`                       | `#c9a253` ("survey brass") | `#4FB2C4` ("Sounding Cyan")            | **This is the single largest identity decision in the whole diff.** The current accent's own doc comment states its rationale explicitly — "warm and instrument-like... rather than the saturated orange the category defaults to" — and Direction A replaces warm brass with cool cyan for a related but distinct reason (a chart-sounding / glass-cockpit lineage). Both are defensible; they are not the same colour philosophy wearing different hex, and the rationale comment must be rewritten to match reality, not left describing a brass accent that no longer exists. |
| `accent-dim` / `accent-bright` | `#6f5525` / `#e3bd76`      | derived from `#4FB2C4`                 | New dim/bright steps needed; A's file only specifies the one core value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `accent-ink`                   | `#120d03`                  | recompute                              | Text-on-accent ink must be re-checked for contrast against cyan, not assumed from the brass value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `ok`                           | `#4fc3a1`                  | `#74A16E`                              | A's "Measured" green.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `warn`                         | `#e0b64a`                  | `#C99A3E`                              | A's "Doctrine" amber. **Not the same value as today's `accent`-adjacent brass** — worth a beat, because a casual reviewer glancing at two ambers (old `accent` #c9a253 vs new `warn` #C99A3E) might assume one is a typo of the other. They are not; document why they are close but distinct (one was the whole app's accent, the other is now one quarter of a four-step evidence scale).                                                                                                                                                                                       |
| `blaze`                        | `#ff5a1f`                  | **unchanged, recommend keeping as-is** | A's file does not specify a hunter-safety-orange equivalent. This is a real gap in the spec, not a decision to invent one. Keep `blaze` exactly as it is — hunter-safety orange is a real-world convention this product borrows deliberately (`tokens.ts`'s own comment: "spending it on decoration would waste the one colour whose meaning every user already knows") and nothing about Direction A argues against that. **Confirm with the founder before landing** that this is an intentional carry-over, not an oversight in the mock.                                      |
| `info`                         | `#5b9dd9`                  | `#4FAEBD`-ish or drop                  | A's mock does not use a distinct "info" tone anywhere the current app does (`Chip tone="info"` exists today — check call sites before removing).                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### New tokens (do not exist today)

- `color.critical` / `color.critical-text` — A's fourth evidence-scale step
  ("Assumed"), `#BD5D4C` / lighter variant for text-on-dark. There is no
  existing token this maps onto; `blaze` is close in hue but is reserved for
  hunter-safety orange and must not be reused for evidence grading — conflating
  the two would mean an "Assumed" bedding chip and a live-ammunition safety
  colour share a token, which is the kind of coincidence that becomes a real
  confusion the day both appear on screen together.
- `layout.dock-width` — `300px`. New; nothing today reserves persistent
  horizontal chrome width, because nothing today is persistent (see §c).
- `layout.map-ink` / `layout.map-ink-shadow` — **not from A directly**, but
  surfaced by QA on the sibling Direction D file and worth adopting here
  pre-emptively: any chrome element drawn directly on the map with no plate
  behind it (A has none today — every HUD element in A's file sits on a
  `panel-flat-a` plate — but the compass-dial needle and the on-map
  crosshair/inspect-plate leader marks are borderline) needs an ink token
  that answers to the _map's_ luminance range, not the panel's. Cheaper to
  reserve the token now than rediscover the defect after ship.
- A **flat, unblurred plate material**, distinct from `glass`. See below.

### The material question — `glass` vs. a new `plate` group

Every floating panel in the current app (`Rail`, `CommandBar`, `Sheet`,
`ConditionsBar`) composes the shared `.rl-glass` utility class, which is
built from the `glass` token group and always carries
`backdrop-filter: blur(18px) saturate(140%)`. **Direction A's HUD plates
(stage header, on-map tags, the conditions cluster, the dock) never use
blur** — the file's own notes call this out as deliberate: "a hard edge on
an unblurred plate reads as an instrument bezel; blur reads as software
chrome."

Recommendation: **add a new `plate` token group and a `.rl-plate` utility,
additive to `glass` rather than replacing it.** Reasons:

1. `Popover` (`packages/design/src/components/primitives.tsx:607`) also
   composes glass-family styling and is out of scope for this redesign — the
   wind/time editor. Silently stripping blur from the shared class would
   change `Popover`'s material as a side effect nobody asked for.
2. It keeps the diff reviewable: "add a material" is a smaller, more
   inspectable change than "redefine what glass means everywhere and hope
   every consumer still looks right."
3. If the founder later wants blur gone everywhere, that is a one-line
   follow-up (point every glass consumer at `plate` instead) once this lands
   and is proven — not a prerequisite blocking this ship.

`plate` group: `bg` (opaque-ish flat, e.g. `rgb(20 25 27 / 0.94)`), `border`
(1px `--hairline-hi`), and a `border-strong` variant (2px, `--hairline-strong`)
for the dock/header/cluster's heavier structural rules, which A uses and
`glass` has no equivalent of today.

### Sizing / layout tokens

| Token                             | Current | Direction A                                                                                                                                                                                                                                                                                       |
| --------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layout.command-bar-height`       | `48px`  | **unchanged on mobile** (see §c — mobile keeps `CommandBar`)                                                                                                                                                                                                                                      |
| `layout.conditions-bar-height`    | `56px`  | A's conditions cluster measures ~58–76px depending on viewport in the mock; re-measure with `getBoundingClientRect` against the real component before pinning a number, exactly as the existing token's own comment insists — do not eyeball it from the static file.                             |
| `layout.sheet-width`              | `360px` | **superseded on desktop** by `layout.dock-width` (`300px`); mobile keeps a sheet, but the mobile sheet's _height_ budget changes (§c).                                                                                                                                                            |
| new `layout.dock-collapsed-width` | —       | Needed for the collapse control (§c) — likely `0` (fully hidden) or a slim `44px` icon-only rail; the mock does not specify which, and this plan recommends `0` with a re-open affordance living in the mobile-style `CommandBar` cell reintroduced for this one purpose on desktop too (see §c). |

### Radius

Direction A sets `*{ border-radius: 0 }` globally, with two explicit,
narrow exceptions (the compass dial, the locate button — both true circular
instruments, `border-radius: 50%`). Today's `radius` token group
(`sm`/`md`/`lg`/`xl`/`pill`) is used throughout `styles.css` — `.rl-sheet`,
`.rl-command`, `.rl-conditions`, `.rl-toggle`, `Chip`, `Button` all round.
**This is a real, wide-blast-radius visual change**, not a token value edit —
every consumer of `--radius-*` needs its rule checked, because "set the
tokens to 0" is not equivalent to "redesign every component to look right at
0 radius" (a 0-radius `Chip` with today's padding may look like an
unstyled `<span>`, not an instrument-plate chip). Treat radius as a
component-by-component pass, not a token-only change, and budget the vertical
slice in §e accordingly.

### Type

| Token            | Current                                | Direction A                                                                                |
| ---------------- | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `font.sans`      | Barlow (self-hosted via `@fontsource`) | System sans stack, no webfont                                                              |
| `font.condensed` | Barlow Condensed                       | Replaced by `all-small-caps` treatment on the system sans, not a separate condensed family |
| `font.mono`      | IBM Plex Mono (self-hosted)            | System mono stack, no webfont                                                              |

**This is the second-largest identity decision after the accent colour, and
it has a real technical upside the mock's own reasoning undersells:**
dropping self-hosted `@fontsource` webfonts removes a render-blocking
resource on first paint over a slow rural connection, which is directly
on-thesis for "offline is not a feature, it is the operating assumption."
Flag it as a benefit worth stating in the PR, not just a stylistic call.
**Risk to carry forward:** system-stack fonts resolve differently per OS —
verify the `all-small-caps` engraved-plate effect (used for every panel
title) actually renders as intended on a real budget Android device, where
the resolved sans-serif may not support `font-variant-caps: all-small-caps`
gracefully; the CSS spec allows a synthetic fallback that can look worse
than doing nothing. This is a top item for §f/device verification.

---

## b. What is already right — survives untouched or restyled only, not replaced

Explicit, because rebuilding something that already works is the most
expensive mistake this plan could make.

**Survives with only a material/colour restyle (same structure, same
behaviour, same tests):**

- **`ConditionsBar`** (`primitives.tsx:212`). Rated 9/10 in the product audit;
  A's own file explicitly kept its underlying logic — always visible, states
  its value, says "Not set" in a distinct tone rather than a silent default —
  and rebuilt only the material (hairline cells, tabular mono, a real compass
  dial). **The component's props and behaviour do not change.** Only
  `styles.css`'s `.rl-conditions*` rules change, plus the addition of the
  compass-dial SVG in place of `WindNeedle`'s current rendering (check
  `icons.tsx` — `WindNeedle` may already be close enough to reskin rather
  than replace).
- **`CommandBar` / `CommandBarCell`** (`primitives.tsx:86`, shipped `R44`).
  **Not replaced on mobile** (§c) — restyled to the flat-plate material and
  hard edges, same `flex: 1 1 0` cell shape that structurally prevents `R43`'s
  dead-zone defect from recurring. This is the primitive the product audit
  already praised for making painted and interactive surface identical by
  construction; nothing about Direction A argues for undoing that.
- **`ToggleRow`** (`primitives.tsx:423`). Structure, `blockedReason` behaviour,
  and the `children` slot (rendered only when `checked && !blocked`) all
  survive unchanged — restyled only. This is also the exact slot `Confidence`
  plugs into (§d).
- **The mobile sheet clearance fix (`R42`)** — `apps/web/src/index.css`
  already computes the sheet's `bottom` offset from
  `--layout-command-bar-height + --layout-conditions-bar-height` so the sheet
  stops above both bars rather than covering them
  (`index.css:223-236`, confirmed current). **This is not a bug to re-fix.**
  Direction A's mobile mock independently arrives at the same visual outcome
  (sheet docked above the conditions cluster) and this plan should point the
  new dimensions at the same mechanism rather than reinventing it.
- **`useOfflineRegions` and its data flow** — no change. Only the chrome that
  _displays_ `regions.active`/`coverage` changes (§d, §e).

**Replaced:**

- **`Sheet` / `.rl-sheet--drawer` on desktop only.** Becomes the persistent
  dock (§c). **Unchanged on mobile** — mobile keeps a dismissible sheet using
  the same `Sheet` primitive, restyled.
- **`Rail` / `RailButton`** in `.chrome-topright` (zoom `+`/`−`/locate).
  Direction A keeps a small button stack top-right on desktop (restyled, same
  structure) and the product audit's standing recommendation to **drop zoom
  buttons on mobile and move locate to a right-edge thumb-arc circle**
  (`docs/AUDIT-PRODUCT.md` rec #19) is still unshipped — Direction A's mobile
  mock does this (a single circular locate button, right edge, ~55% viewport
  height). Land it now; there is no reason to keep carrying it as open
  backlog once this redesign touches the same chrome anyway.

---

## c. The desktop dock, honestly

The founder has chosen the 300px persistent dock. Building it per A's own
stated mitigations, and being explicit about the two gaps the static mock
left unresolved that a real implementation cannot leave unresolved.

**What ships:**

- A new `Dock` primitive in `packages/design`, ~300px fixed width
  (`layout.dock-width`), full chassis height, `plate` material,
  `border-right: 2px solid var(--color-line-strong)`. Contains, top to
  bottom: header (wordmark + property name + coordinates), a scrollable body
  of sections (`Base`, `Relief`, `Terrain analysis`, `Offline coverage`), and
  a footer (evidence-grade legend + the collapse control).
- **The explicit, labelled collapse control** (A's own mitigation for the
  product audit's "costs a third of the screen forever" objection) —
  `<button>` reading "Collapse dock", not an icon alone (the icon-only lesson
  from `docs/AUDIT-PRODUCT.md` F4 applies here exactly as it did to the old
  rail). Collapsed state: dock width animates to `0` (respecting
  `prefers-reduced-motion`), map fills the reclaimed width, and a slim
  re-open affordance must exist — **this plan recommends a `CommandBar` cell
  labelled "Layers" reappearing on desktop only while the dock is collapsed**,
  reusing the primitive from §b rather than inventing a second collapse
  chrome. This detail is not in A's static mock (a mock cannot show a
  collapsed state and its re-open control in the same static frame) and is
  called out here as a real decision this plan is making, not one A already
  made.
- **Mobile is not a small dock.** Mobile keeps `CommandBar` (`Layers` +
  `Offline` cells, unchanged trigger behaviour) and the _sheet_ it opens is
  restyled to the flat-plate material, docked above `ConditionsBar` using the
  already-shipped `R42` clearance mechanism. This is the fix for the defect
  the founder originally complained about (`R42`: opening Layers used to hide
  wind/time/thermals) — it is **already fixed**, and this plan's job is to
  not regress it while re-skinning, which is exactly the kind of change a
  restyle-only pass can silently break if the new CSS's `max-height` or
  `bottom` arithmetic isn't pointed at the same tokens the fix already
  established.

**Two gaps the static mock leaves open, resolved here rather than left
implicit:**

1. **Starting a new offline download has no entry point in A's dock.** The
   mock's "Offline coverage" section is read-only status (a coverage
   percentage and a tile grid) — it does not show how a user _starts_
   downloading a new region, which today is `CommandBar`'s "Offline" cell
   opening `RegionPicker`. Resolution: keep a "Download this area" action
   inside the dock's Offline Coverage section (a `Button`, not a new
   `CommandBar` cell, since the dock is always visible on desktop and does
   not need a toggle-to-reveal pattern) that opens `RegionPicker` as an
   overlay above the dock, same component, restyled. On mobile,
   `CommandBar`'s "Offline" cell is unchanged.
2. **The dock's own scroll affordance.** A's mock statically trims content
   to fit 900px with no scrollbar shown (documented in the file's own commit
   history as a deliberate "collapse unfocused rows to label + swatch"
   pass). A real dock with a growing roadmap (filters, saved queries,
   property boundaries per `docs/ROADMAP.md`) **will** need to scroll.
   Build the dock body as a real scrollable region
   (`overflow-y: auto; overscroll-behavior: contain`, matching
   `.rl-sheet__body`'s existing pattern) from day one, even though the vertical
   slice (§e) may not yet have enough content to make scrolling visible.

---

## d. `Confidence` adoption (`BACKLOG R61`)

The primitive (`primitives.tsx:547`) ships with an ordinal glyph set —
`●` measured / `◐` inferred / `○` doctrine / `?` assumed — plus a `tone`,
so it is already not colour-alone. **The row is the adoption, not the
primitive**, so this section is deliberately concrete about every surface.

**Where a grade appears:**

| Surface                                             | Component                                                                                                                       | Grade shown                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layer row, `ToggleRow`'s `children` slot            | `LayersSheet.tsx`                                                                                                               | Only on `bedding` — `assumed`. Rendered `checked && !blocked`, i.e. only once the layer is actually rendering, which matches A's own desktop mock (the chip appears next to the active bedding layer, not the disabled one).                                                                                                                                                                                     |
| Point readout / on-map tag                          | new — A's `map-tag` pattern has no current equivalent; needs a small new component, e.g. `MapReadoutCard`, in `packages/design` | Same grade as the layer it describes — never a second, independently-set value, or the two can drift and contradict each other on screen.                                                                                                                                                                                                                                                                        |
| The legend / evidence-grade key                     | new — the dock's footer legend                                                                                                  | All four grades, always, as a static reference key — this is the "the register's content ships as data, not just prose in `docs/`" requirement from the 2026-08-06 product audit. Source the four labels/glyphs/tones directly from `Confidence`'s own internal maps (`primitives.tsx:548-565`), not a re-typed copy in `apps/web`, so the legend cannot drift from the primitive it is documenting.             |
| Conditions cluster, when a modelled input drives it | `ConditionsBar`                                                                                                                 | **Thermals only.** Thermal phase is computed from slope-heating doctrine, not measured — an `inferred` grade glyph belongs next to "Rising"/"Sinking". **Wind and date/time do not get a grade** — they are user-entered or device-clock values, not modelled biological parameters, and grading a raw input the user typed themselves would be a category error `Confidence`'s own doc comment does not intend. |

**Where a grade must NOT appear**, stated as plainly as the backlog row
states it: **never on measured geometry** — Horn slope, aspect, Weiss
landform class, Wood morphometric features (saddles/benches). These are
published, peer-reviewed algorithms validated against closed-form analytic
surfaces (`docs/ARCHITECTURE.md`/`CLAUDE.md` non-negotiable #2). A grade chip
on a Weiss class implies a doubt that does not exist, and it is the specific
failure the sibling audit called "the most serious overclaim... a rendering
decision, not a maths decision" if done wrong. **Do not add a `grade` field
to `LayerDefinition` for any of `slope`, `aspect`, `weiss`, `wood`, `bench`,
`multiHillshade`, `satellite`, `topo`, `contours`, `insolation`.**
`insolation` is a genuine borderline case (a physical calculation with a
handful of modelled inputs) — resolve it with `game-biologist` before this
ships, do not guess.

**The regression gate the backlog row asks for:** add a required (not
optional) `grade?: EvidenceGrade` field to `LayerDefinition` in
`apps/web/src/lib/layers.ts` only for layers where a grade applies, and add a
lint-level or test-level check — a unit test iterating `LAYERS`, asserting
any layer with `grade` set renders a `Confidence` when active, and any layer
_without_ `grade` set never does — so a future layer added with a modelled
parameter and no grade fails CI rather than silently shipping ungraded, which
is exactly how this primitive reached zero usage the first time.

---

## e. Thin vertical slice to land first

**Scope: the conditions cluster + the bedding row's `Confidence` chip, on the
existing chrome, before the dock exists.**

Concretely:

1. Add the `plate` token group and `.rl-plate` utility to `packages/design`
   (additive, §a).
2. Restyle `ConditionsBar` to the flat-plate material, hard edges, the
   compass-dial SVG, tabular mono values. **No prop or behaviour change.**
3. Add the `Confidence` chip to the `bedding` `ToggleRow`'s `children` slot
   in `LayersSheet.tsx`, sourced from a new `grade: 'assumed'` field on that
   one `LayerDefinition` entry, with the regression test from §d covering
   just this one row.
4. Screenshot both viewports, run the invariant subset in §f, get
   `code-reviewer` + `field-qa` sign-off.

**What this proves:** the new material (flat, unblurred, hard-edged) reads
correctly against a live map at both viewports before the far larger,
harder-to-review dock lands on top of it; and `Confidence` actually ships
somewhere real, closing `R61`'s "used in exactly zero places" for at least
one surface, with the regression gate in place before the second surface is
added.

**What this deliberately leaves for later:** the desktop dock itself (§c),
the on-map `MapReadoutCard`, the full evidence-grade legend, the mobile
sheet restyle, and the accent/ground colour token changes (§a) beyond what
`ConditionsBar` alone needs. Landing the dock is a separate, larger review —
it touches `App.tsx`'s chrome layout, the `Sheet` primitive's desktop
behaviour, and the collapse-control interaction, none of which this slice
requires.

---

## f. UI invariants — what's at risk, and what's new

`apps/web/e2e/ui-invariants.spec.ts` groups, checked against this plan:

- **Group 2, Trigger stability.** The dock replacing `.rl-sheet--drawer` on
  desktop changes `Layers`' trigger from "a button that opens an overlay" to
  "always open, with a separate collapse control." The existing tests
  (`opening the Layers sheet must not move the Layers button itself`,
  `opening the wind popover while the Layers sheet is open must not move the
Wind trigger`) are written against the current trigger/overlay model and
  **will need rewriting, not just re-running**, once there is no "Layers"
  trigger button on desktop to test in the first place. Write the
  replacement assertion — collapsing/expanding the dock must not move the
  conditions cluster or the top-right rail — before landing §c.
- **Group 4, No chrome collisions.** Directly at risk from the dock's
  collapse animation and from `RegionPicker` now overlaying a persistent dock
  instead of a togglable sheet — re-run every sub-case in this group against
  the new chrome, not just the ones that look related. This group is also
  **desktop-only by construction today** (`docs/AUDIT-PRODUCT.md` already
  flagged this as a gap); `R37` (extend to 390px) is still open and this
  redesign is the moment to close it, since it touches every collision this
  group checks anyway.
- **Group 8, Panel density (≥40% of chassis).** Written against the old
  sheet/drawer's expected proportions. The persistent dock at a _fixed_
  300px is a different shape of assertion (a fixed minimum width, not a
  percentage of a togglable overlay) — this test needs rewriting to match
  the new component, not deletion; a dock that shrinks to nothing over time
  as other chrome grows is exactly the F7-class defect (`docs/AUDIT-PRODUCT.md`)
  the old rail died of.
- **Group 12, Glass container painted surface matches its interactive
  children.** Directly relevant to the new `plate` material and the dock:
  the dock's scrollable body must not repeat the `.rl-rail` defect (a
  container whose painted glass exceeds the union of its children's
  bounding boxes). Extend this group's coverage to the new `Dock` primitive
  explicitly, at both viewports.
- **Group 9, Offline coverage describes the view on screen.** At risk from
  moving the coverage status into the dock (desktop) while `RegionPicker`
  still renders as an overlay — verify the same-frame consistency this group
  checks for still holds when the two are visually separated (dock shows
  status, overlay shows the picker) rather than co-located as they are
  today.

**New invariants this redesign specifically needs, from direct field
experience on the sibling directions this session:**

- **A rendered-geometry sweep for label/description overlap** — B's
  reviewed file shipped a row where a layer's name painted directly on top
  of its own description because of an inherited `line-height: 0`; every
  DOM query passed. Add an invariant that samples sibling bounding boxes
  inside every `ToggleRow` (and the new `Dock` sections) for vertical
  overlap, not just presence in the DOM — `getByText` finding the text is
  not evidence it is legible.
- **An on-map-ink contrast check sampling actual raster pixels, not the
  token value.** D's file shipped on-map text (a scale bar, a caption) whose
  ink token was correct for the surrounding panel and illegible directly
  over the neutral hillshade — a defect invisible to any check that samples
  computed CSS instead of rendered pixels under real terrain, light and
  dark. `ui-invariants.spec.ts` group 7 already sets the precedent (it
  samples rendered pixels against glass, per the `text-dim` comment in
  `tokens.ts`); extend that precedent explicitly to any element that sits
  directly on the map raster with no plate behind it. A's own chrome has few
  or no such elements today (§a, `layout.map-ink`) — but the moment a future
  layer author adds one without a plate backing it, this is the test that
  catches it before a screenshot review has to.

---

## Sequencing

1. `packages/design`: `plate` token group + component, accent/ground token
   diff, radius-to-zero pass component-by-component (§a).
2. Vertical slice (§e): `ConditionsBar` restyle + one `Confidence` adoption,
   reviewed and shipped independently.
3. `Dock` primitive + desktop chrome swap in `App.tsx` (§c), with the
   rewritten Group 2/4/8/12 invariants landing in the _same_ PR, not after —
   per `CLAUDE.md`, a UI fix and the invariant that would have caught its
   regression are two commits' worth of work, done together.
4. Mobile sheet restyle (already-correct clearance mechanism, new material
   only).
5. `MapReadoutCard` + full evidence-grade legend + remaining `Confidence`
   surfaces (Thermals).
6. `R37` (390px collision coverage) folded into step 3 rather than tracked
   separately, since step 3 touches the exact chrome that test gap concerns.
