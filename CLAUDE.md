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
2. **Saved terrain filters are first-class.** A user's *"12–25°, facing
   north-through-east, on a midslope bench, leeward on today's wind"* is a
   named, persisted, shareable object that travels with them offline and can be
   fed into the corridor solver as an attraction field. Competitors ship fixed
   slope bands somebody else chose. This is the moat.

**North star: `docs/VISION.md`.** The operating question every decision answers
is **"Would a serious whitetail hunter switch to this and never go back?"** — a
daily-driver bar, not a feature-count argument.

## The three non-negotiables

### 1. Offline is not a feature, it is the operating assumption

Users are in hollows with no bars, on public land in the dark, twenty miles from
pavement. Everything below follows from that:

- **Cache elevation, never rendered layers.** The offline store holds DEM tiles;
  analysis layers are computed on-device on demand. Pre-baking rendered tiles
  would need a variant per layer × per wind × per date. One DEM download unlocks
  *every* layer, *any* wind, *any* date. Never regress this.
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
  ESRI; `crossSectional`/`longitudinal` follow Wood — they *disagree* by design.
  There are regression tests pinning this because it was wrong once and nothing
  crashed; the map was just confidently backwards.
- **Say when you do not know.** Grey out layers whose inputs are unset rather
  than rendering a default. Report rut confidence by latitude. Refuse to claim
  statistical significance below usable expected counts.
- **Model behaviour, not folklore.** Rut phase is photoperiod (calendar +
  latitude), never lunar — the research is clear and a lunar predictor would
  make every downstream analytic worse.

### 3. Analytics compare use against availability

The single most common failure in hunting "analytics" is a histogram of
sightings by slope band. If 70% of the property is gentle slope, 70% of
sightings will be on gentle slope, and the chart has measured the property, not
the deer.

Every selection analytic divides by the property's **availability
distribution** (`TerrainProfile`) and reports Manly selection ratios with a
chi-square test. Never ship a raw-count chart of habitat use.

## Stack (do not change without updating docs/ARCHITECTURE.md)

- **Engine:** `packages/terrain` — pure TypeScript, **zero runtime dependencies**.
  Keep it that way; it ships into a service worker.
- **Backend:** NestJS + Prisma + **PostgreSQL/PostGIS**, REST
- **Frontend:** React + Vite + TypeScript + **MapLibre GL**, PWA via vite-plugin-pwa
- **Monorepo:** pnpm workspaces — `apps/api`, `apps/web`, `packages/terrain`, `packages/shared`

## Layout

```
packages/terrain   DEM analytics engine (slope, landform, solar, wind, corridors)
packages/shared    Contracts + selection analytics + rut model
apps/api           NestJS + PostGIS backend
apps/web           MapLibre PWA with on-device analysis worker
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
docker compose up -d --build    # full stack incl. PostGIS
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
- **Comment the *why*.** The terrain code is dense mathematics with real
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
- `product-auditor` / `engineering-auditor` — two independent deep auditors.
- `backlog-groomer` — keeps `docs/BACKLOG.md` current and a Ready queue stocked.
- `vision-steward` — turns the founder's plain-language ideas into
  VISION/ROADMAP/BACKLOG entries. Docs only.
- `doc-syncer` — cheap-model commit-driven doc reconciler.

**Skills** (`.claude/skills/`) — invoke the matching skill *before* the work.
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
  surfaces and real LiDAR ground truth.
- `offline-integrity-loop` — continuously prove the no-signal path still works.

**The loop for every feature:** plan → implement (specialist) → review
(`code-reviewer`) → **functional QA with `field-qa`, including an actual
offline run** → `analytics-auditor` if any number is shown to a user → update
`docs/ROADMAP.md` + `docs/BACKLOG.md` → commit.

## Working style for autonomous build

- Prefer a thin vertical slice working end-to-end over broad-but-broken.
- Commit in logical, working increments. Never push a red build.
- Develop on the current `claude/*` branch; never push to `main` without
  explicit permission.
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
