# Contributing

## Setup

```bash
pnpm install     # also installs the git hooks via the `prepare` script
```

If hooks are not firing, `pnpm install` was probably run with
`--ignore-scripts`. Re-run `pnpm exec husky` to install them.

## Branch names

```
<type>/<short-kebab-description>
<type>/<issue-number>-<short-kebab-description>
```

`type` is one of `feat fix chore docs refactor perf test ci build revert
release hotfix`.

```
feat/saved-terrain-filters
fix/142-corridor-directional-bias
release/1.2.0
```

Checked by a `pre-push` hook, not `pre-commit` — local scratch branches are
nobody's business, but anything that reaches the remote is shared history and
shows up in PR lists and `git branch -a` forever.

`main` is protected by convention: work happens on a branch and lands through
a PR.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), enforced by a
`commit-msg` hook.

```
<type>(<optional scope>): <subject>

<body — the why>
```

**This is load-bearing, not a style preference.** `semantic-release` derives
the version, the CHANGELOG and the published image tags from these messages. A
malformed subject does not fail loudly; it silently produces no release, or the
wrong version bump.

| Type | Release | Appears in changelog |
|---|---|---|
| `feat` | minor | yes |
| `fix`, `perf`, `refactor`, `docs` | patch | yes |
| `test`, `chore`, `ci`, `build` | none | no |
| any type with `BREAKING CHANGE:` in the body | **major** | yes |

Only the subject line is length-constrained (100 chars). Bodies deliberately
run long in this repo — see below.

### Write the *why*, not the diff

The diff already says what changed. A commit body earns its place by recording
the decision and the failure it prevents. Repository history here is the
primary record of why things are shaped the way they are, and several of the
non-obvious constraints in this codebase are only explained in a commit.

Bad:

```
fix: update nginx config
```

Good:

```
fix(web): resolve the API at request time instead of at startup

nginx resolves a literal hostname in proxy_pass once, when it loads its
config, and exits if the name does not resolve. Helm gives no ordering
guarantee between the web Deployment and the api Service, so a cold install
could CrashLoopBackOff on a cluster where nothing was actually wrong.
```

## Before you push

```bash
pnpm lint && pnpm test && pnpm build
```

The hooks run `prettier` and the typecheck over staged files only — whole-repo
formatting on every commit is slow enough that people start passing
`--no-verify`, at which point the hook has made things worse than no hook.

For UI changes, the invariants suite is a required gate:

```bash
cd apps/web && PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
  pnpm exec playwright test ui-invariants --workers=1
```

A failing invariant is assumed to have found something real. Never tune an
assertion until it passes — and confirm a *suspicious pass* by an independent
route too, because three of the first four defects that suite reported were
bugs in the suite rather than in the app.

## Deployment changes

`deploy/helm` and `deploy/compose` are release artefacts and get the same gate
as code. CI renders every conditional chart path, not just the defaults —
most chart bugs live in a branch that default values never reach and surface on
someone else's cluster.
