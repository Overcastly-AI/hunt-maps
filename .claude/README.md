# Claude Code tooling for Ridgeline

Skills, agents and workflows tuned for building Ridgeline. They encode the
project's conventions so AI-assisted contributions stay consistent — and, more
importantly, so the two failure modes that matter here get caught by process
rather than luck: **a terrain layer that is quietly wrong**, and **an offline
path that quietly rotted**.

## Vendored: Superpowers skills

The 14 skills in `skills/` come from **[obra/superpowers](https://github.com/obra/superpowers)**
by Jesse Vincent (MIT — see `skills/SUPERPOWERS-LICENSE`), vendored so the team
and CI have them without the plugin installed:

`brainstorming`, `dispatching-parallel-agents`, `executing-plans`,
`finishing-a-development-branch`, `receiving-code-review`,
`requesting-code-review`, `subagent-driven-development`, `systematic-debugging`,
`test-driven-development`, `using-git-worktrees`, `using-superpowers`,
`verification-before-completion`, `writing-plans`, `writing-skills`.

`.agents/skills/frontend-design` is Anthropic's design skill (see its
`LICENSE.txt`), mandatory for any UI work.

## Agents (`agents/`)

### Domain specialists — the ones unique to this product

| Agent | Owns |
|-------|------|
| `terrain-scientist` | `packages/terrain`. The correctness of every derived layer. Validates against analytically-known surfaces, not screenshots. |
| `offline-steward` | The entire no-signal experience: tile storage, PWA, sync, conflicts. Guards the cache-elevation-not-rendered-tiles decision. |
| `map-builder` | MapLibre layers, the `ridgeline://` protocol, colour ramps, cartographic legibility. |
| `analytics-auditor` | Statistical honesty. Hunts use-vs-availability errors, overclaimed significance, and folklore dressed as a model. |
| `game-biologist` | **Large-game domain expert.** The only role with a mandate over whether the *biology* is right. Vets every modelled parameter against peer-reviewed literature and grades it in `docs/EVIDENCE.md`. |
| `field-qa` | Independent QA in the real context: offline, gloved, dark, mid-range phone. |

### Build and direction

| Agent | Owns |
|-------|------|
| `schema-architect` | Prisma + PostGIS model and migrations |
| `backend-builder` | NestJS modules |
| `frontend-builder` | React panels, forms, analytics views. All visual decisions go in `packages/design`, never inline. |
| `code-reviewer` | Diff review — domain correctness first, then offline, then security |
| `product-auditor` | Independent product/UX audit → `docs/AUDIT-PRODUCT.md` |
| `engineering-auditor` | Independent engineering audit → `docs/AUDIT-ENGINEERING.md` |
| `backlog-groomer` | Keeps `docs/BACKLOG.md` current with a Ready queue |
| `vision-steward` | Founder's ideas → VISION/ROADMAP/BACKLOG. Docs only. |
| `doc-syncer` | Cheap commit-driven reconciler for README/ARCHITECTURE/CHANGELOG |

The **four** auditors — product, engineering, analytics, biology — deliberately
do not coordinate. Independence is the point: auditors who read each other's
output converge on the same blind spots. They write to four separate docs, so
they run fully parallel with no file contention.

## Workflows (`workflows/`)

| Workflow | Purpose |
|----------|---------|
| `autonomous-dev-loop` | The org loop: 3 independent audits → groom → build top items with review + offline QA → repeat **on completion**, not on a timer |
| `build-vertical-slice` | One feature: engine → schema → API → map → panel → review → field QA → analytics audit |
| `terrain-validation-loop` | Standing loop that independently re-derives the engine's maths and cross-checks against desktop GIS |
| `offline-integrity-loop` | Standing loop that proves the cold-start-offline path still works |
| `ui-integrity-loop` | Standing loop: automated UI invariants + screenshot review across every overlay state |
| `evidence-integrity-loop` | Standing loop: vet every biological parameter against the literature; keeps `docs/EVIDENCE.md` honest |

The last four run **independently of feature work**, and that is deliberate.
All four failure modes are silent:

- Terrain defects do not crash — the map just lies.
- Offline support rots because everything is developed and reviewed online.
- **UI defects do not fail tests** — the DOM reports success while the user
  cannot click the button.
- **Biological defects are applied perfectly and simply are not true.**
  `idealSlopeDeg: 22` passes every test in the repo and is a number somebody
  invented.

None of them is caught by reviewing the feature that broke it.

The last two are easy to conflate, so the boundary is worth stating:
`terrain-validation-loop` asks *is 22° applied correctly*;
`evidence-integrity-loop` asks *does a whitetail actually bed at 22°*. A
parameter is only trustworthy once both have passed on it.

Workflows are documented as orchestration recipes; run them with the `Workflow`
tool — each file carries its script outline.

## The five gates that must never be skipped

1. **A new terrain operator ships with a test against a closed-form answer.**
   Not a fixture, not a screenshot.
2. **A feature is not done until its offline cold start has been run by hand.**
3. **A new user-facing number does not merge without an `analytics-auditor`
   pass.**
4. **A new biological parameter does not merge without a row in
   `docs/EVIDENCE.md`** carrying a grade and a source — or an explicit "no
   literature found". `game-biologist` assigns the grade.
5. **A pixel does not change without the `ui-invariants` suite green and a
   screenshot looked at.** A failing invariant is assumed to have found
   something real; it is never tuned until it passes. And when a defect is found
   by eye, the invariant that would have caught it ships in the same change.

There is a sixth rule that is about process rather than product, and it is the
one most often broken: **the orchestrator delegates.** A fifteen-agent org that
gets bypassed because doing it inline felt faster is not an org — it is one
perspective with no independent review. Before implementing anything
non-trivial, name the agent that owns it.

Note the division of labour between the two auditing roles, because it is easy
to conflate them: `terrain-scientist` verifies that 22° is *applied* correctly.
`game-biologist` asks whether a whitetail actually beds at 22°. Before the
second role existed, nothing in the org asked that question.
