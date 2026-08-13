# CLAUDE.md — Ridgeline

Guidance for Claude Code (and other AI agents) working in this repository.

## What this is

**Ridgeline** is a self-hosted **hunting map and terrain-analytics platform**.
Two things make it different from every hunting app on the market, and every
decision should be checked against them:

1. **The analysis is real, and it is the product.** Not a slope-shading toggle
   bolted onto imagery — an actual DEM/LiDAR engine computing Horn slope,
   Evans–Young curvature, Weiss landform classes, Wood morphometric features
   (saddles!), bench detection, solar insolation, thermal phase, leeward bedding
   likelihood, and anisotropic least-cost movement corridors.
2. **Saved terrain filters are first-class.** A user's _"12–25°, facing
   north-through-east, on a midslope bench, leeward on today's wind"_ is a
   named, persisted, shareable object that travels with them offline and can be
   fed into the corridor solver as an attraction field. Competitors ship fixed
   slope bands somebody else chose. This is the moat.

**North star: `docs/VISION.md`.** The operating question every decision answers
is **"Would a serious whitetail hunter switch to this and never go back?"** — a
daily-driver bar, not a feature-count argument.

## The six non-negotiables

### 1. Offline is not a feature, it is the operating assumption

Users are in hollows with no bars, on public land in the dark, twenty miles from
pavement. Everything below follows from that:

- **Cache elevation, never rendered layers.** The offline store holds DEM tiles;
  analysis layers are computed on-device on demand. Pre-baking rendered tiles
  would need a variant per layer × per wind × per date. One DEM download unlocks
  _every_ layer, _any_ wind, _any_ date. Never regress this.
- **The engine is shared, not duplicated.** `@hunt-maps/terrain` is imported by
  both the API and the browser worker. A saved filter must produce identical
  output on the laptop at camp and the phone at the bottom of a draw.
- **Every write is queued and idempotent.** `clientId` gives offline-created
  records stable identity; `version` gives real conflict detection. Never
  last-write-wins — a hunting party edits the same stands from several devices.
- **Storage is requested, not assumed.** Ask for persistent storage, report what
  you got. Losing a region the user waited twenty minutes for, discovered blank
  in the field, is the worst failure this product has.

### 2. Never be confidently wrong about terrain

A hunter acts on what this map says: they hang a stand, they walk an access
route, they burn a vacation day. A layer that is subtly inverted is worse than
no layer, because it is trusted.

- **Validate against analytically-known surfaces.** Synthetic planes, paraboloids
  and hyperbolic paraboloids with closed-form slope/aspect/curvature. Screenshot
  review proves nothing about a hillshade.
- **Sign conventions are load-bearing and documented.** `plan`/`profile` follow
  ESRI; `crossSectional`/`longitudinal` follow Wood — they _disagree_ by design.
  There are regression tests pinning this because it was wrong once and nothing
  crashed; the map was just confidently backwards.
- **Say when you do not know.** Grey out layers whose inputs are unset rather
  than rendering a default. Report rut confidence by latitude. Refuse to claim
  statistical significance below usable expected counts.
- **Model behaviour, not folklore.** Rut phase is photoperiod (calendar +
  latitude), never lunar — the research is clear and a lunar predictor would
  make every downstream analytic worse.

### 3. Every biological parameter carries an evidence grade

The engine is full of numbers that look authoritative and mostly are not —
`idealSlopeDeg: 22`, a Tobler function fitted to humans, a 400 m scent cone.
Each renders a confident colour on a map somebody uses to decide where to sit.

`docs/EVIDENCE.md` grades every one: 🟢 Measured, 🔵 Inferred, 🟡 Doctrine,
🔴 Assumed. **An `Assumed` grade is not a failure — hiding one is.** Adding a
parameter without registering it, or labelling hunting media as `Measured`, both
count as defects. `game-biologist` owns the register; the `Confidence` primitive
in `@hunt-maps/design` is how grades reach the UI.

### 4. UI defects are their own failure class — assert rendered state

Every other subsystem fails where a test can see it. UI does not: the DOM
reports success, the component rendered, `getByRole` finds the button,
`toBeVisible` passes — and the user still cannot click it.

A popover once painted perfectly and was **unclickable**, because an ancestor's
`overflow: hidden` clipped it: a bounding box ignores an ancestor's clip, but
`elementFromPoint` does not. 221 unit tests were green.

So: **assert against rendered state, not DOM state.** Hit-testing, geometry and
computed style tell you what the user got; a DOM query only tells you what you
built. `apps/web/e2e/ui-invariants.spec.ts` encodes this. The six failure
classes and how to detect each are in the `catching-ui-defects` skill.

**When a UI defect is found by eye, the fix is two commits' worth of work: the
fix, and the invariant that would have caught it.** Never tune a failing
assertion until it goes green — the default assumption is that it found
something real.

### 5. Analytics compare use against availability

The single most common failure in hunting "analytics" is a histogram of
sightings by slope band. If 70% of the property is gentle slope, 70% of
sightings will be on gentle slope, and the chart has measured the property, not
the deer.

Every selection analytic divides by the property's **availability
distribution** (`TerrainProfile`) and reports Manly selection ratios with a
chi-square test. Never ship a raw-count chart of habitat use.

### 6. Test the artifact you ship, in the configuration you ship it in

Every deployed image had `ARG VITE_DEM_TEMPLATE=""` in `apps/web/Dockerfile`,
so the variable was **defined and empty**, not unset. `demSource.ts` resolved
it with `?? DEFAULT`, and `??` only falls back on null/undefined — an empty
string is neither. Every DEM tile URL was `""`; hillshade, slope, aspect,
landform, bedding and corridors rendered blank in every container ever
shipped, and nothing threw. Reported as _"I still can't even use it. None of
the layers are working"_ — which was literally true (`454c8f2`). A sibling bug
hid a correct release behind stale browser cache because `index.html` had no
`Cache-Control` (`bc95b24`). Both lived in the one configuration nothing
exercises: CI runs the source tree with the var unset, never builds or runs
the Docker image, and nothing confirms a published image reaches a server.

**The source tree passing tells you nothing about the image.** If a default
only takes its production value inside a container — a build arg, an env
resolution, a cache header — prove it in the container: build it, run it, grep
or curl the artifact. A blank layer is #2's "confidently wrong about terrain"
arrived at through the deploy pipeline instead of the maths, and it is just as
untrustworthy for being silent instead of backwards.

## Stack (do not change without updating docs/ARCHITECTURE.md)

- **Engine:** `packages/terrain` — pure TypeScript, **zero runtime dependencies**.
  Keep it that way; it ships into a service worker.
- **Backend:** NestJS + Prisma + **PostgreSQL/PostGIS**, REST
- **Frontend:** React + Vite + TypeScript + **MapLibre GL**, PWA via vite-plugin-pwa
- **Design:** `packages/design` — tokens are the single source of truth, and
  `tokens.css` is _generated_ from `tokens.ts` because the map needs the same
  values at runtime for MapLibre paint properties and canvas ramps. A test fails
  CI if the two drift. **No literal colours, sizes or radii outside that package.**
- **Monorepo:** pnpm workspaces — `apps/api`, `apps/web`, `packages/terrain`,
  `packages/design`, `packages/shared`

## Layout

```
packages/terrain   DEM analytics engine (slope, landform, solar, wind, corridors)
packages/design    Design system — tokens, primitives, styles. ALL visual
                   decisions live here; apps own layout only.
packages/shared    Contracts + selection analytics + rut model
apps/api           NestJS + PostGIS backend
apps/web           MapLibre PWA with on-device analysis worker
deploy/compose     Production single-host deploy (see its README)
deploy/helm        Kubernetes chart (see its README)
docs/              VISION, ROADMAP, BACKLOG, RESEARCH, ARCHITECTURE
.claude/           agents, skills, workflows
```

## Commands

```bash
pnpm install
pnpm dev                        # api + web with hot reload
pnpm build                      # topological build (terrain → shared → api/web)
pnpm lint && pnpm test
pnpm db:migrate                 # prisma migrate dev
docker compose up -d --build    # full dev stack incl. PostGIS. Needs .env
                                # (cp .env.example .env) — JWT_SECRET is
                                # required and has no default, deliberately.
```

## Conventions (important)

- **Strict TypeScript.** No `any` without a written justification.
- **`packages/terrain` has no runtime dependencies.** Not one. It runs in Node,
  in a browser worker, and in a service worker.
- **All spatial SQL goes through `GeometryService`.** One file, parameterised
  queries only, `ST_MakeValid` on ingest, `::geography` casts for real areas.
  Geometry arrives as user GeoJSON — this is a live injection surface.
- **Terrain is denormalised onto observations at write time.** Analytics must be
  a SQL aggregate, not a raster pass per row.
- **Filters are a validated AST, never code.** They are shareable between users;
  a shared filter must be inert data.
- **Comment the _why_.** The terrain code is dense mathematics with real
  hunting consequences. Explain the decision and the failure it prevents, not
  the mechanics.

## Keep the docs in sync — NON-NEGOTIABLE

Stale docs are a defect.

- **Every commit that lands a feature/fix MUST, in the same commit, update
  status in BOTH `docs/ROADMAP.md` and `docs/BACKLOG.md`.**
- **`docs/ROADMAP.md` is the source of truth for "what phase are we in".** Its
  phase headers (✅/🚧/⬜) must always match `git log`.
- Definition of done for ANY change = builds + typecheck + tests green
  (desktop **and** mobile viewport) **+ ROADMAP/BACKLOG updated** + committed
  and pushed.

## Work as a dev team (agents, skills, workflows)

This project is built by a **team of specialised agents**, not one generalist.
Default to delegating and orchestrating. The tooling lives in
[`.claude/`](./.claude/README.md).

**Agents** (`.claude/agents/`):

- `terrain-scientist` — the DEM/LiDAR engine. Owns correctness of the maths.
- `map-builder` — MapLibre layers, tile protocols, rendering, cartography.
- `offline-steward` — PWA, tile storage, sync, conflict handling. Owns the
  no-signal experience end to end.
- `schema-architect` — Prisma + PostGIS data model and migrations.
- `backend-builder` — NestJS modules.
- `frontend-builder` — React UI, query hooks, panels.
- `code-reviewer` — reviews the diff before merge.
- `field-qa` — **independent** QA that exercises the real artifact the way a
  hunter does: offline, gloved, one-handed, at 05:30.
- `analytics-auditor` — guards statistical honesty. Hunts for use-vs-availability
  errors, overclaimed significance, and folklore dressed as a model.
- `game-biologist` — **large-game domain expert.** The only role with a mandate
  over whether the _biology_ is right, as opposed to whether the code computes
  what it claims. Vets every modelled parameter against peer-reviewed
  literature, grades the evidence, and replaces guesses with cited values. Owns
  `docs/EVIDENCE.md`.
- `product-auditor` / `engineering-auditor` — two independent deep auditors.
- `backlog-groomer` — keeps `docs/BACKLOG.md` current and a Ready queue stocked.
- `vision-steward` — turns the founder's plain-language ideas into
  VISION/ROADMAP/BACKLOG entries. Docs only.
- `doc-syncer` — cheap-model commit-driven doc reconciler.

**Skills** (`.claude/skills/`) — invoke the matching skill _before_ the work.
Build process: `brainstorming` → `writing-plans` → `test-driven-development` /
`subagent-driven-development` → `requesting-code-review` →
`verification-before-completion` → `finishing-a-development-branch` (vendored
from [obra/superpowers](https://github.com/obra/superpowers), MIT). Debugging:
`systematic-debugging`. Parallel work: `dispatching-parallel-agents`.

**Workflows** (`.claude/workflows/`):

- `build-vertical-slice` — one feature: engine → schema → API → map → review → QA.
- `autonomous-dev-loop` — the org loop: audits → groom → build → repeat on
  completion.
- `terrain-validation-loop` — continuously validate the engine against known
  surfaces and real LiDAR ground truth. Owns the **maths**.
- `evidence-integrity-loop` — continuously vet every biological parameter against
  the literature. Owns the **meaning**. Run by `game-biologist`, and never by
  whoever wrote the parameter: having the author of a guess grade their own guess
  is not an audit.
- `offline-integrity-loop` — continuously prove the no-signal path still works.
- `ui-integrity-loop` — automated UI invariants plus screenshot review.

**The loop for every feature:** plan → implement (specialist) → review
(`code-reviewer`) → **functional QA with `field-qa`, including an actual
offline run** → **`ui-invariants` suite green + screenshot review if any pixel
changed** → `analytics-auditor` if any number is shown to a user →
**`game-biologist` if any biological parameter was added or changed** → update
`docs/ROADMAP.md` + `docs/BACKLOG.md` → commit.

### The orchestrator delegates — this has been violated and it matters

The most common failure of this repo's process is not a bad agent brief. It is
the orchestrator reading the task, deciding it is faster to just do it, and
doing all of it alone. That happened through the entire initial build: a
fifteen-agent org was created and then bypassed on every single task.

It is not faster. It is one perspective, no independent review, no adversarial
QA, and every defect found late by the founder looking at a screenshot.

**Default to delegating.** Before implementing anything non-trivial, name the
agent that owns it. If you are about to write code an agent in `.claude/agents/`
is defined to own, stop and dispatch instead. Reserve doing it yourself for
genuinely trivial edits, and for orchestration and verification — which are your
actual job.

Parallel agents get **explicitly disjoint file territories** in their briefs, and
the orchestrator independently re-runs a slice of every agent's gates before
reporting the work done.

## Working style for autonomous build

- Prefer a thin vertical slice working end-to-end over broad-but-broken.
- Commit in logical, working increments. Never push a red build.
- **Push to `main`.** Standing instruction from the founder (2026-08-12),
  replacing the previous "never push to `main` without explicit permission".
  The reason is testing latency: `main` is what releases, and a release is how
  the founder actually exercises the product. Work parked on a branch is work
  nobody can try, and the feedback that has caught the most defects in this
  repo has come from the founder using the deployed artifact.
  - **`main` auto-releases.** `.releaserc.json` + `release.yml` publish a
    version, images and the chart on every push. There is no staging step
    between a merge and something a hunter can load. Treat every push as a
    release, because it is one.
  - **The gates matter more, not less, now that the branch gate is gone.**
    Never push a red build. `pnpm build` and `pnpm test` green before every
    push, no exceptions — the branch used to be the place a mistake could sit
    harmlessly, and that place no longer exists.
  - Ship behind a flag, or ship the smaller correct slice, rather than
    holding work back. But when something known-broken goes out, **say so in
    the same breath** — the founder testing a release deserves to know what
    is already known wrong in it, or they waste a morning rediscovering it.
- **When a test fails, first ask whether the test is wrong.** Three of the
  bugs found during the initial build were real defects the tests caught
  (curvature sign inversion, standardise amplifying float noise, sunTimes
  returning a negative day length west of Greenwich); two were bad test
  expectations. Both outcomes are normal. Diagnose, do not assume.

## Multi-agent orchestration protocol

- **File territories.** Parallel agents get explicitly disjoint file
  territories in their briefs. Never edit or revert another agent's in-flight
  files. Stage only your own hunks (`git add -p`), never `git add -A`.
- **Shared-doc races.** Make ROADMAP/BACKLOG edits the LAST step, then
  `git add <your files>` + commit immediately in the same turn.
- **Verify before trusting.** The orchestrator independently re-runs a targeted
  slice of every completed agent's gates before reporting work done.
- **Founder updates are results-first.** Lead with what shipped and the
  evidence (numbers, screenshots), then what is running, then what is next.
