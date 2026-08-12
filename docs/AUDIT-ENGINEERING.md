# Engineering Audit — Ridgeline

**Auditor:** `engineering-auditor` (independent)
**Date:** 2026-08-12
**Branch:** `claude/project-goal-clarification-qkyana`
**Version audited:** 1.2.1 (`4d81811`), plus `8f559f1`, `bf3a900`, `0947a43`, `b8d8f6e`
**Scope:** `apps/api`, `packages/shared`, `packages/terrain`, Prisma/PostGIS, `deploy/`, `.github/`
**Explicitly out of scope:** `apps/web` UI (audited concurrently by another agent). Front-end
issues appear here only where the defect is a _backend contract_ problem.

This is the **first engineering audit** of this codebase. Product and analytics have each had
several. That asymmetry shows: the terrain mathematics and the CI gates are among the best I
have read, and the API's authorisation layer has never been read adversarially by anyone.
Nearly every P0 below is in the second category.

## Method and honesty statement

- Every finding was verified by reading source, and cites `file:line`.
- Findings are marked **CONFIRMED** (proved from source or measurement) or **SUSPECTED**
  (consistent with the source but needs a runtime check to settle). Each SUSPECTED row says
  what would settle it.
- **No application code was modified.** No tests were added. `pnpm test` was run
  (759 passing, matching the stated baseline); `pnpm audit` was run. **No browser, no
  Playwright, no `test:e2e`** — per the environment constraint.
- Ranked by CLAUDE.md's priority order — (1) leaves a user without a map in the field,
  (2) confidently wrong, (3) scorecard gaps, (4) new capability, (5) everything else —
  not by CVSS.
- Where a finding is already in `docs/BACKLOG.md` it is marked as such and either confirmed
  or challenged, not re-filed.

## Counts by severity

| Severity          | Count  | IDs                                                                         |
| ----------------- | ------ | --------------------------------------------------------------------------- |
| **P0 — Critical** | 4      | `E1`, `E2`, `E3`, `E4`                                                      |
| **P1 — High**     | 7      | `E5`, `E6`, `E7`, `E8`, `E9`, `E13`, `E15`                                  |
| **P2 — Medium**   | 11     | `E10`, `E11`, `E12`, `E14`, `E16`, `E17`, `E18`, `E19`, `E21`, `E22`, `E23` |
| **P3 — Low**      | 2      | `E20`, `E24`                                                                |
| **Total**         | **24** |                                                                             |

CONFIRMED: 23. SUSPECTED: 1 (`E2`, whose arithmetic is confirmed but whose exact OOM
threshold needs a runtime measurement).

## Headline

1. **`GET /api/analytics/terrain-profile` has no authorisation check at all** (`E1`). Any
   logged-in user can read any property's terrain summary by id, and force an unbounded
   raster job on someone else's ground. One missing line.
2. **A single legal corridor request can exhaust the API's memory** (`E2`). The tile ceiling
   is expressed in _tiles_, and its 67 MB justification silently assumes 256 px tiles and one
   field. With USGS 3DEP (512 px) it is 4× that, across ~10 concurrent fields, with `Float64`
   in the Dijkstra. The Helm chart's default limit is 1 Gi.
3. **The offline idempotency lookup is not scoped to the caller** (`E3`). `clientId` is
   globally `@unique`, and three services return whatever row matches it — including another
   user's, and in the observations case via `SELECT *`.
4. **A `MANAGER` can promote themselves to `OWNER`, then delete the property** (`E4`). The
   role model has no "you cannot grant a role you do not hold" rule.
5. **`WeissLandform.Unknown = 0` is counted as a real landform class in the availability
   denominator** (`E5`) — the exact bug `R69` fixed for `BenchFlag` eleven lines above, not
   applied to `weiss`. The dashboard can tell a hunter that deer prefer "Unknown".

---

# P0 — Critical

## E1 — `GET /api/analytics/terrain-profile` performs no authorisation check

**CONFIRMED.** Not in `docs/BACKLOG.md`.
**Priority class:** (2) confidently wrong + information disclosure + DoS amplifier.

`apps/api/src/analytics/analytics.module.ts:374-378`:

```ts
@Get('terrain-profile')
async profile(@CurrentUser() user: AuthedUser, @Query('propertyId') propertyId: string) {
  if (!propertyId) throw new BadRequestException('propertyId is required.');
  return this.analytics.terrainProfile(propertyId);   // <-- `user` is never used
}
```

`AnalyticsService.terrainProfile(propertyId, zoom = 13)`
(`apps/api/src/analytics/analytics.module.ts:64`) takes **no `userId` parameter** and contains
**zero** calls to `this.access.require` — verified by grep over its whole body
(lines 64–173).

`user` is bound by the decorator and then discarded. The sibling endpoint
`movement()` gets this right (`analytics.module.ts:192`,
`await this.access.require(userId, propertyId)`), which is what makes this look like an
oversight rather than a decision.

**Concrete failure.** Any account on the server can:

1. **Read another property's terrain profile by id** — `minElevationM`, `maxElevationM`,
   `meanSlopeDeg`, `benchShare`, `cellSizeM`, and the full `slopeShares` / `aspectShares` /
   `landformShares` distributions. That is a fingerprint of a specific parcel. Combined with
   `centerLat`/`centerLng` obtainable elsewhere, it characterises ground the caller has no
   membership on. `PropertyAccessService`'s doc comment
   (`apps/api/src/auth/property-access.service.ts:12-17`) says stand locations are sensitive
   precisely because they reveal where a hunter will be sitting; the terrain profile is a
   weaker but real version of the same leak.
2. **Force an arbitrarily expensive job on someone else's property.** On a cache miss this
   runs `gridForBBox` over the whole boundary at z13 with a 24-cell halo, plus a full
   `analyze()` pass with five layers, plus `rasterizeMask`. That is the single most expensive
   operation the API exposes per unit of request size, and it is now reachable for _any_
   property id, by _any_ account, with no per-user cost attribution.
3. **Distinguish real property ids from fabricated ones.** A real id with a boundary returns
   200; a real id without one returns `400 "This property has no boundary drawn."`
   (`analytics.module.ts:70-74`); a nonexistent id returns `500` (see `E9`). Three distinct
   responses, which is an enumeration oracle on top of the read.

This defeats the 404-not-403 discipline the codebase deliberately implements one file over.

**Fix.** One line, plus threading `userId`:

```ts
// analytics.module.ts — signature
async terrainProfile(userId: string, propertyId: string, zoom = 13) {
  await this.access.require(userId, propertyId);
  ...
}
// controller
return this.analytics.terrainProfile(user.id, propertyId);
// and the internal caller at line 193
const profile = await this.terrainProfile(userId, propertyId);
```

Add a controller test asserting `404` for a property the caller has no membership on. There is
currently **no test** covering authorisation on this endpoint —
`apps/api/src/analytics/analytics.module.spec.ts` exercises the share arithmetic only.

---

## E2 — One legal corridor request can exhaust API memory; the tile ceiling is not a memory ceiling

**CONFIRMED** (arithmetic and allocation sites); **SUSPECTED** on the exact threshold.
Not in `docs/BACKLOG.md`.
**Priority class:** (1) leaves a user without a map in the field.

The ceiling and its justification, `apps/api/src/terrain/dem.service.ts:359-365`:

```ts
/**
 * Ceiling on a single mosaic. 256 tiles at 256px is a 4096² grid — about 67 MB
 * of Float32 before any derived field. ...
 */
const MAX_TILES_PER_MOSAIC = 256;
```

The comment is accurate about exactly one thing and misleading about three:

1. **It is stated in tiles, but the cost is in cells.** `DEM_SOURCES.usgs3dep.tileSize = 512`
   (`dem.service.ts:59`). The same 256-tile budget is then 8192 × 8192 = **67.1 M cells**, not
   16.8 M — **4× the memory**, from a `?source=usgs3dep` query parameter, with no change to the
   guard. The guard at `dem.service.ts:243` compares `tilesX * tilesY`, never `tilesX * ts`.
2. **"before any derived field" is the whole cost.** A corridor solve with bedding attraction
   requests `['slope','aspect','bedding','shelter']` (`corridor.service.ts:64-66`), and
   `computeSurface` alone allocates 16 typed arrays (`packages/terrain/src/analysis/surface.ts`),
   including `profile`, `plan`, `longitudinal`, `crossSectional`. Roughly ten full-size fields
   are live simultaneously.
3. **The Dijkstra is `Float64`, and it runs twice.**
   `packages/terrain/src/corridor/leastcost.ts:137`:
   `const dist = new Float64Array(n).fill(Infinity);` — 8 bytes per cell, plus
   `from` (`Int32Array`, 4 B) and `done` (`Uint8Array`, 1 B). `computeCorridor` needs
   accumulation from the sources _and_ to the targets, so two of these are live at once.

**The arithmetic, at the ceiling the code itself permits** (`zoom: 16`, `demSource: usgs3dep`,
n = 67.1 M cells):

| Allocation                      | Bytes/cell | Count | Total      |
| ------------------------------- | ---------- | ----- | ---------- |
| `dist` (`Float64`)              | 8          | 2     | 1.07 GB    |
| `from` (`Int32`)                | 4          | 2     | 537 MB     |
| `done` (`Uint8`)                | 1          | 2     | 134 MB     |
| `analyze()` fields (`Float32`)  | 4          | ~10   | 2.68 GB    |
| cost surface + grid (`Float32`) | 4          | 2     | 537 MB     |
| **Total**                       |            |       | **≈ 5 GB** |

Even the _default_ terrarium path (256 px, 16.8 M cells) lands at roughly **1.2 GB**.

Against that: `deploy/helm/ridgeline/values.yaml:75-76` sets the API's
`resources.limits.memory: 1Gi`, with a deliberate note that there is **no CPU limit** because
"terrain analysis is CPU-bound and bursty". So the default-shipped deployment is OOMKilled by a
request the API itself considers legal — on the _default_ DEM source, never mind 3DEP.

**Why this is priority (1) and not a performance nit.** `POST /api/terrain/corridors/solve`
(`terrain.controller.ts:241-256`) is authenticated but:

- has **no property scoping** — `bbox` is arbitrary, unrelated to any property the caller owns;
- has **no rate limit and no concurrency guard** (see `E7`) — nothing prevents ten in flight;
- OOMKills the _pod_, not the request. Every other user of that self-hosted instance loses the
  map mid-hunt. `POST /api/terrain/filters/evaluate` (`terrain.controller.ts:216-238`) has the
  same shape and the same exposure.

**What falls over first, and at what scale.** In order:

1. **API memory, at one concurrent corridor solve** over a large bbox at z15–16 — immediately,
   on the shipped 1 Gi limit.
2. **The Prisma connection pool, at ~2 concurrent mosaic builds.** `gridForBBox` issues
   `Promise.all` over up to 256 + ring tiles (`dem.service.ts:302-323`), each doing a
   `demTile.findUnique` (`dem.service.ts:104`), with **no concurrency limiter** (`E22`). The
   default pool is `num_cpus * 2 + 1`; 300 simultaneous queries queue and time out.
3. **The event loop, at one mosaic.** `PNG.sync.read` (`dem.service.ts:152`) is synchronous and
   runs once per tile (`E21`). 256 × 512 px decodes block the single thread for seconds; health
   checks fail and Kubernetes restarts a pod that is working correctly.
4. **Disk, over weeks.** `DemTile` grows without bound and without eviction (`E8`).

**Fix.** Three changes, in order of value:

- Express the ceiling in **cells, not tiles**: `if (tilesX * ts * tilesY * ts > MAX_CELLS)`.
  Size `MAX_CELLS` from a real memory budget and state the assumption (`~10 fields × 4 B`, plus
  `2 × 8 B` for the accumulations) in the comment, so the next person changing `tileSize` sees it.
- Downgrade `dist` to `Float32Array` unless a measured case needs the range, or note why not.
- Put corridor and filter-evaluate solves behind a **semaphore of 1–2 concurrent solves per
  process**, and return `429`/`503` beyond it. The codebase already models "say when you cannot"
  well (`InsufficientHaloFilter`, `terrain/insufficient-halo.filter.ts`) — this is the same
  pattern.

**To settle the SUSPECTED part:** run one `corridors/solve` at `zoom: 16` over a 256-tile bbox
against a container with `--memory=1g` and record peak RSS. I did not run it: it is exactly the
kind of heavy job the environment constraint rules out.

---

## E3 — `clientId` idempotency lookups are not scoped to the caller: cross-tenant read on three entities

**CONFIRMED.** Not in `docs/BACKLOG.md`.
**Priority class:** (2) confidently wrong + information disclosure.

`clientId` is **globally unique**, not unique per property or per user:

- `apps/api/prisma/schema.prisma` — `Waypoint.clientId String? @unique`,
  `Observation.clientId String? @unique`, `SavedFilter.clientId String? @unique`,
  `Track.clientId String? @unique`
- `apps/api/prisma/migrations/20260806000000_init/migration.sql:317,326,341,347`

Every replay path looks the row up by `clientId` alone and returns it, **after** checking access
on the property in the _request body_ — which is the caller's own property, not the found row's:

`apps/api/src/waypoints/waypoints.module.ts:101-107`

```ts
if (dto.clientId) {
  const existing = await this.prisma.waypoint.findUnique({
    where: { clientId: dto.clientId }, // global lookup
    select: { id: true },
  });
  if (existing) return this.getOne(existing.id); // no ownership check
}
```

`apps/api/src/observations/observations.module.ts:162-168` — same shape, and `getOne` is
`SELECT *` (`observations.module.ts:249`), so it returns **every column**: `userId`, `notes`,
`photoUrls`, all denormalised terrain, and `ST_AsGeoJSON(location)` — the exact coordinates.

`apps/api/src/filters/filters.module.ts:98-103` — same shape, returning the full `SavedFilter`
row including `predicate`, `name`, `description` and `propertyId`.

**Concrete failure.** Two distinct ones:

- **Cross-tenant read.** A user with `HUNTER` on _any_ property of their own posts a create
  carrying another user's `clientId` and receives that user's record. For observations that
  includes the location of a harvest or a bedding-sign find. Exploiting it requires knowing a
  `clientId`, so it is not trivially enumerable — but it is a client-generated value that
  appears in request bodies, in the offline queue, and in any log or proxy that captures them.
  It is not a secret and is not treated as one anywhere in the code.
- **Silent data cross-linking under collision, which needs no attacker.** If two devices ever
  generate the same `clientId`, the second device's create silently returns the _first_
  device's record and the second write is discarded with a 200. That is a
  never-last-write-wins guarantee failing open, and it fails **silently** — the mode CLAUDE.md
  ranks worst. The severity here depends entirely on the client's id generator being a real
  UUIDv4; the server assumes that and does not verify it.

**Fix.** Scope the lookup to the tenant the caller was authorised against, and treat a
cross-tenant `clientId` as a conflict rather than a hit:

```ts
const existing = await this.prisma.waypoint.findUnique({
  where: { clientId: dto.clientId },
  select: { id: true, propertyId: true },
});
if (existing) {
  if (existing.propertyId !== dto.propertyId) {
    throw new ConflictException('That clientId belongs to a different property.');
  }
  return this.getOne(existing.id);
}
```

For `SavedFilter`, compare `ownerId !== userId`. Longer term, make the constraint
`@@unique([propertyId, clientId])` (and `[ownerId, clientId]` for filters) so the database
enforces the scope rather than the service remembering to.

---

## E4 — A `MANAGER` can grant `OWNER` — including to themselves — and then delete the property

**CONFIRMED.** Not in `docs/BACKLOG.md`.
**Priority class:** (1) destroys a user's data irrecoverably.

`apps/api/src/properties/properties.module.ts:167-184`:

```ts
async addMember(userId: string, propertyId: string, dto: AddMemberDto) {
  await this.access.require(userId, propertyId, PropertyRole.MANAGER);
  const role = PropertyRole[dto.role];
  if (!role) throw new BadRequestException(`Unknown role "${dto.role}".`);
  ...
  await this.prisma.propertyMembership.upsert({
    where: { propertyId_userId: { propertyId, userId: member.id } },
    create: { propertyId, userId: member.id, role },
    update: { role },                                  // <-- no ceiling on `role`
  });
```

There is no check that the granted `role` is at or below the caller's own. `ROLE_RANK` exists
(`apps/api/src/auth/property-access.service.ts:19-24`) and is used for the _minimum_ check, never
for a _maximum_.

**The escalation path, end to end:**

1. A `MANAGER` calls `POST /api/properties/:id/members` with **their own email** and
   `role: "OWNER"`. `access.require(..., MANAGER)` passes. The `upsert` takes the `update`
   branch and rewrites their own membership row to `OWNER`.
2. `PropertyAccessService.require` resolves role as
   `property.ownerId === userId ? OWNER : memberships[0]?.role`
   (`property-access.service.ts:54-57`), so their effective role is now `OWNER`
   (`ROLE_RANK` 3).
3. They call `DELETE /api/properties/:id`, which requires `OWNER`
   (`properties.module.ts:161-165`).
4. `prisma.property.delete` cascades. Per `schema.prisma`, `onDelete: Cascade` on
   `PropertyMembership`, `Waypoint`, `Observation`, `Corridor`, `Track`, `SavedFilter` and
   `TerrainProfile` — **every stand, every observation, every saved filter and the whole
   observation history for that ground, gone**, with no soft delete and no recovery path
   anywhere in the codebase.

The same gap lets a `MANAGER` promote any third party to `OWNER`. `removeMember`
(`properties.module.ts:186-200`) guards only the _original_ `Property.ownerId` — a `MANAGER`
can remove another `MANAGER`.

This directly contradicts the stated model:
"An `OBSERVER` who can read the map must not be able to move someone's stand, and a `HUNTER`
must not be able to remove other members. One place to get that right, one place to audit it."
(`property-access.service.ts:14-17`). The place exists; this rule was never written into it.

**Fix.** In `PropertyAccessService`, add the ceiling and use it from `addMember`:

```ts
async requireGrant(userId: string, propertyId: string, granted: PropertyRole) {
  const mine = await this.require(userId, propertyId, PropertyRole.MANAGER);
  if (ROLE_RANK[granted] >= ROLE_RANK[mine]) {
    throw new ForbiddenException('You cannot grant a role at or above your own.');
  }
  return mine;
}
```

Transferring ownership should be an explicit `OWNER`-only endpoint that moves
`Property.ownerId`, not a side effect of `addMember`. Also see `E20` — `dto.role` is
`@IsString()`, so it should be `@IsEnum(PropertyRole)` regardless.

---

# P1 — High

## E5 — `WeissLandform.Unknown` is counted as a real landform class in the availability denominator

**CONFIRMED.** Not in `docs/BACKLOG.md` (related to but distinct from `R69`, which fixed the
identical bug for `BenchFlag`).
**Priority class:** (2) confidently wrong.

`apps/api/src/analytics/analytics.module.ts:107`:

```ts
const landformShares = shareOf(result.weiss!, 11, (v) => v, mask);
```

`classifyWeiss` returns a `Uint8Array` and writes
`out[i] = WeissLandform.Unknown` for every cell it could not measure
(`packages/terrain/src/analysis/landform.ts:483`), where
`WeissLandform.Unknown = 0` (`landform.ts:410`).

`shareOf` (`analytics.module.ts:320-339`) skips a value only when `!Number.isFinite(v)`. **A
`Uint8Array` cell is always finite.** So `Unknown` lands in bin 0 and is counted as available
ground of a real class.

The damning part is eleven lines above, at `analytics.module.ts:109-124`, where this **exact
bug** was found and fixed for `bench`:

```ts
// `bench` is tri-state since `R69` — `BenchFlag.Unknown = 2` marks ground
// the engine could not measure. Summing the array directly, as this did,
// adds **two** per void cell and inflates the share past 1.0 ...
// Skip unknowns entirely rather than counting them as "not a bench"
```

The reasoning is correct and was not carried across to `weiss` in the same file.

**Concrete failure, to a hunter.** `movement()` builds the landform bins straight off the
shares array (`analytics.module.ts:238-249`):

```ts
const landformBins = landformShares.map((_, i) => ({
  label: WEISS_LABELS[i as WeissLandform] ?? `Class ${i}`,
  from: i,
  to: i + 1,
}));
```

`WEISS_LABELS[0] = 'Unknown'` (`landform.ts:434`). So:

- A bin literally labelled **"Unknown"** is shown with a real `areaShare`, a real `count` and a
  real `selectionRatio`.
- `describeSelection` (`packages/shared/src/analytics/selection.ts`) sorts bins by
  `selectionRatio` and emits _"**Unknown** is used 2.3× more than its share of the ground would
  predict (14 of 61 observations)."_ Void cells cluster at download boundaries and coverage
  holes, and observations near them get stamped `landformClass = 0` too — so the two sides
  correlate and the ratio can genuinely come out high. That is a confident, quantified,
  statistically-dressed statement about nothing.
- Every **real** class is diluted: its `areaShare` is deflated by the unknown fraction, so all
  ten real selection ratios are inflated by `1/(1 − unknownShare)`.
- The chi-square is wrong in both terms: bin 0 contributes to `chiSquare` and inflates
  `usableBins`, hence `df` (`selection.ts:144-158`), so the significance test is evaluated
  against the wrong critical value.

This is the failure mode `packages/shared/src/analytics/selection.ts:1-27` is entirely written
to prevent, arriving through a different door.

**Fix.** Mirror the `bench` treatment exactly — exclude `Unknown` from the denominator and from
the bins:

```ts
const landformShares = shareOf(
  result.weiss!,
  11,
  (v) => (v === WeissLandform.Unknown ? -1 : v), // -1 is already dropped by shareOf
  mask,
);
```

and drop index 0 when building `landformBins`, so no "Unknown" bin ever reaches
`analyzeSelection` or the UI. Add a regression test with a grid containing a deliberate void:
assert the landform shares sum to 1 over the _ten real_ classes and that no bin is labelled
`Unknown`. `apps/api/src/analytics/analytics.module.spec.ts` currently has no void case.

---

## E6 — `R72` confirmed, and worse than filed: the degraded profile is cached permanently

**CONFIRMED.** **Already filed as `R72`** (`docs/BACKLOG.md:124`, P1/S, `backend-builder`).
**I confirm the row and challenge its size estimate.**

The filed row is accurate. `apps/api/src/terrain/dem.service.ts:286-300`:

```ts
const blitTile = (tx: number, ty: number): Promise<void> =>
  this.fetchTile({ z: zoom, x: tx, y: ty }, source)
    .then((buf) => { ... })
    // A hole in coverage — interior or halo — is filled by `fillVoids`
    // below rather than failing the whole mosaic.
    .catch(() => undefined);
```

The mechanism described in `R72` holds exactly as written: `fillVoids`
(`packages/terrain/src/dem/grid.ts:157-190`) diffuses real neighbours ~1 cell per iteration over
8 iterations, so a rim ~8 cells deep around each failed tile is **fabricated and finite**, and
`shareOf`'s `Number.isFinite` test counts it. Deeper voids stay `NODATA = -32768`
(`packages/terrain/src/dem/encoding.ts:18`), become `NaN` downstream, and are correctly
excluded.

**What `R72` does not say, and should.** The degraded result is **cached, and the cache never
expires.** `apps/api/src/analytics/analytics.module.ts:65-67`:

```ts
const existing = await this.prisma.terrainProfile.findUnique({ where: { propertyId } });
const sourceVersion = `${this.dem.resolveSource().id}@z${zoom}`;
if (existing && existing.sourceVersion === sourceVersion) return existing;
```

`sourceVersion` is `"terrarium@z13"` — a **constant** for any given deployment. So:

- A profile computed during a transient AWS outage is written to `TerrainProfile` with a
  `sourceVersion` that will never differ, and is returned unchanged **forever**.
- The only invalidation anywhere is `properties.update` deleting the profile when the boundary
  is redrawn (`apps/api/src/properties/properties.module.ts:154`). A user who never redraws
  their boundary — i.e. almost all of them — is permanently stuck with the denominator computed
  the one time the network was bad.
- In the total-outage case, every tile fails, `shareOf` returns `total === 0` and therefore an
  array of zeros (`analytics.module.ts:338`). Downstream this degrades _quietly but safely_:
  `analyzeSelection` sets `selectionRatio: undefined` for zero-area bins
  (`selection.ts:134`), `df` becomes 0, and `describeSelection` says "No clear pattern".
  So the user is not shown a wrong number — they are shown **"no pattern" forever**, on a
  property with real data, with nothing anywhere indicating why. Selection analytics are
  permanently dead for that property and only a manual `DELETE FROM "TerrainProfile"` revives
  them.

`R72`'s remedy ("track which cells were fabricated ... report the affected fraction alongside
the shares") is the right one. Two additions:

- **Refuse to cache a materially degraded profile at all**, or record `failedTileCount` /
  `coverageFraction` on `TerrainProfile` and treat a low value as a cache miss on the next
  request. A silent permanent cache of a degraded computation is a worse failure than the
  fabricated rim.
- **`R72` is sized `S`.** With the cache-invalidation work it is honestly `M`. The rim mask is
  small; the schema column, the invalidation rule and the "this profile is degraded" signal to
  the client are not.

---

## E7 — No rate limiting anywhere, on an API whose login costs 346 ms of CPU

**CONFIRMED (measured).** Not in `docs/BACKLOG.md`.
**Priority class:** (1) an unauthenticated client can take the map away from everyone.

There is **no throttling of any kind**. `@nestjs/throttler` is not in
`apps/api/package.json`, and grep for `Throttler|@Throttle|rate.?limit` across `apps/api/src`
returns nothing. `main.ts` installs `helmet`, `ValidationPipe` and CORS, and no guard.

I measured the bcrypt cost directly (`bcryptjs@2.4.3`, cost factor 12, as at
`apps/api/src/auth/auth.service.ts:44,60`):

```
DUMMY_HASH compare avg:  345.87 ms
real hash compare avg:   346.10 ms
ratio: 1.0x
```

**First, credit where it is due.** That 1.0× ratio confirms the constant-time login claim is
_real_, not aspirational. `DUMMY_HASH` (`auth.service.ts:126`) is a structurally valid bcrypt
hash — 53 characters after the `$2a$12$` prefix, exactly as required — so
`bcrypt.compare` performs the full key schedule on the absent-user path. Many codebases write
this comment and ship a malformed constant that returns in microseconds and leaks the
enumeration anyway. This one does not. Good.

**But that cost is now the attack.** Unauthenticated `POST /api/auth/login` costs ~346 ms of
CPU per request, `POST /api/auth/register` the same via `bcrypt.hash`. `bcryptjs` is pure JS,
so this is the API's own event loop, not a native thread pool. The practical ceiling is roughly
**3 logins per second per core**. A single client at ~10 requests/second saturates the API, and
`deploy/helm/ridgeline/values.yaml:77-79` deliberately sets **no CPU limit**, so it consumes
whatever the node has.

Compounding it:

- `GET /api/terrain/tiles/:layer/:z/:x/:y.png` is **unauthenticated by design**
  (`terrain.controller.ts:113-126`). Each request triggers `gridForTile` = up to 9 upstream tile
  fetches plus 9 synchronous PNG decodes. The reasoning for it being open is sound (public-domain
  data, `<img>` loading, offline pre-caching), but with no rate limit it is the cheapest
  amplifier on the server, and it also drives `E8`.
- `corridors/solve` and `filters/evaluate` (`E2`) are authenticated but unmetered.
- There is no lockout, backoff or captcha on repeated failed logins.

**Fix.** Add `@nestjs/throttler` globally with tight per-route overrides: strictest on
`auth/login` and `auth/register` (e.g. 5/min/IP), a separate bucket on the unauthenticated tile
route, and a per-user concurrency semaphore on the two solve endpoints (see `E2`). This is a
self-hosted product — the operator has no cloud WAF in front of it, so the application is the
only place this can live.

---

## E8 — `DemTile` grows without bound and has no eviction; an open endpoint drives it

**CONFIRMED.** Not in `docs/BACKLOG.md`.
**Priority class:** (1) fills the database volume and takes the whole instance down.

`DemTile` stores raw PNG bytes (`schema.prisma`, `data Bytes`) keyed by
`@@id([source, z, x, y])`, with `@@index([fetchedAt])` — an index that exists _only_ to support
an eviction query. **That query does not exist.**

- `grep -rn "demTile" apps/api/src` returns exactly two production sites, both in
  `dem.service.ts` (`:104` read, `:116` upsert). Nothing deletes.
- `ScheduleModule.forRoot()` is imported in `apps/api/src/app.module.ts:19`, and there is **not
  one `@Cron` or `@Interval` in the codebase**. The scheduler is wired up and drives nothing.
- `CACHE_TTL_MS = 90 * 86400_000` (`dem.service.ts:66`) governs whether a row is _re-fetched_,
  never whether it is _removed_. A stale row is overwritten in place if requested again, and
  retained forever if not.

**Concrete failure, for the operator.** The tile endpoint is unauthenticated (`E7`) and
`assertTileCoords` permits any `z ≤ 18` (`terrain.controller.ts:259-265`). Anyone who can reach
the server can walk tile space and cause the API to fetch and durably store unbounded DEM tiles.
At ~25 KB/tile, one z14 US state is comfortably tens of GB.

The failure mode is the bad one: this is a **Postgres volume**, so when it fills, Postgres stops
accepting writes and the entire application dies — auth, waypoints, observations, everything —
with an error that points at the database and gives no hint that a _cache_ is the cause. On the
single-host `deploy/compose` topology the `db-data` volume typically shares the root filesystem,
so it can take the host with it.

Normal use gets there too, just slower: offline region packaging is explicitly designed to pull
thousands of tiles, and every region a user downloads is permanently retained server-side.

**Fix.** Three lines of policy, one cron:

```ts
@Cron(CronExpression.EVERY_DAY_AT_3AM)
async evictStaleTiles() {
  await this.prisma.demTile.deleteMany({
    where: { fetchedAt: { lt: new Date(Date.now() - CACHE_TTL_MS) } },
  });
}
```

Add a total-size cap (evict least-recently-fetched beyond N GB — the `fetchedAt` index already
supports it), make the cap configurable, and surface the cache size on `/api/health` so the
operator can see it before it becomes an outage. Rate-limit the tile route (`E7`).

---

## E9 — `findUniqueOrThrow` with no Prisma exception filter turns "does not exist" into a 500 — an existence oracle that defeats the 404-not-403 design

**CONFIRMED.** Not in `docs/BACKLOG.md`.
**Priority class:** (2) + information disclosure.

`apps/api/src/main.ts` registers exactly one global filter, `InsufficientHaloFilter`
(`main.ts:19`), which handles `InsufficientHaloError` and delegates everything else to
`BaseExceptionFilter` (`terrain/insufficient-halo.filter.ts:29-32`). There is **no Prisma
exception filter** — grep for `P2025|PrismaClientKnownRequestError|@Catch` finds only that one
class.

So `findUniqueOrThrow` on a missing id throws `PrismaClientKnownRequestError` (P2025), which
Nest does not recognise, and the client receives **`500 Internal Server Error`**. Call sites:

| File:line                                   | Path                              |
| ------------------------------------------- | --------------------------------- |
| `filters/filters.module.ts:122,151,167`     | update / remove / import a filter |
| `offline/offline.module.ts:200,216`         | delete / complete a region        |
| `waypoints/waypoints.module.ts:135,176,207` | update / remove / wind-check      |
| `observations/observations.module.ts:232`   | delete an observation             |
| `properties/properties.module.ts:86,188`    | get / remove member               |

**The oracle.** `PropertyAccessService` goes to real trouble to return 404 rather than 403 so a
stranger cannot confirm a resource exists (`property-access.service.ts:34-37`). The status codes
actually emitted invert that:

| Situation            | Status returned                        | What it tells the caller |
| -------------------- | -------------------------------------- | ------------------------ |
| Id does not exist    | **500**                                | "no such row"            |
| Id exists, not yours | **400** (`filters:126`, `offline:204`) | **"this id is real"**    |
| Id exists, yours     | 200                                    | —                        |

Three distinguishable responses. Anyone can classify an arbitrary id as real-or-not by status
code alone. The mitigation the codebase is proud of is defeated by an unhandled exception type.

Separately, the responses are **wrong** on their own terms. `filters.module.ts:121-127`:

```ts
if (current.ownerId !== userId) {
  // 404 rather than 403 — a 403 confirms the id exists and belongs to
  // someone, which is more than a stranger should learn.
  throw new BadRequestException('Filter not found.');
}
```

The comment says 404. `BadRequestException` is **400**. Same at
`filters.module.ts:152`, `offline.module.ts:204` and `offline.module.ts:220`. The intent is
right and the code does something else; a reader auditing by comment would sign this off.

**Fix.** Two changes:

1. Add a global `@Catch(Prisma.PrismaClientKnownRequestError)` filter mapping `P2025` → `404`,
   `P2002` → `409`, `P2003` → `400`. Register it in `main.ts` alongside the halo filter.
2. Replace every `BadRequestException('... not found.')` with `NotFoundException`, so the code
   matches its own comments and the not-found and not-yours paths are genuinely
   indistinguishable.

---

## E13 — Optimistic concurrency is read-then-write, not atomic: two concurrent updates both win

**CONFIRMED.** Not in `docs/BACKLOG.md`.
**Priority class:** (2) — the guarantee CLAUDE.md states most emphatically, failing silently.

CLAUDE.md: _"`version` gives real conflict detection. Never last-write-wins — a hunting party
edits the same stands from several devices."_

`apps/api/src/waypoints/waypoints.module.ts:134-171`:

```ts
const current = await this.prisma.waypoint.findUniqueOrThrow({   // (1) READ version
  where: { id }, select: { propertyId: true, version: true },
});
...
if (dto.baseVersion !== undefined && dto.baseVersion !== current.version) {   // (2) CHECK
  throw new ConflictException({ ... });
}
...
await this.prisma.waypoint.update({                              // (3) WRITE
  where: { id },
  data: { ..., version: { increment: 1 } },
});
```

Steps (1), (2) and (3) are three separate round trips with **no transaction and no row lock**.
Two requests carrying `baseVersion: 4` interleave as `read(4) / read(4) / check ok / check ok /
write(5) / write(6)` — both succeed, both return 200, and the first writer's edit is silently
overwritten. That is precisely last-write-wins, arrived at through the code written to prevent
it.

**Why this is not theoretical here.** The offline queue replays a batch of writes the moment
connectivity returns. Two party members coming back into signal at the same trailhead — the
normal case this feature exists for — is exactly the interleaving above. The window is two
network round trips wide, not microseconds.

`FiltersService.update` (`filters.module.ts:121-148`) has the same shape and does not check
`baseVersion` at all — it increments `version` unconditionally, so saved filters are
**genuinely** last-write-wins today.

**Fix.** Make the check and the write one statement. The database already enforces this for
free:

```ts
const { count } = await this.prisma.waypoint.updateMany({
  where: { id, ...(dto.baseVersion !== undefined ? { version: dto.baseVersion } : {}) },
  data: { ...fields, version: { increment: 1 } },
});
if (count === 0) {
  const server = await this.prisma.waypoint.findUnique({
    where: { id },
    select: { version: true },
  });
  throw new ConflictException({
    message: '...',
    serverVersion: server?.version,
    yourVersion: dto.baseVersion,
  });
}
```

`updateMany` with `version` in the `WHERE` is a compare-and-swap and is atomic. The test that
would have caught this fires two updates with the same `baseVersion` concurrently and asserts
exactly one 200 and one 409 — `apps/api/src/offline/offline.spec.ts` tests the conflict path
only sequentially.

---

## E15 — The corridor band is returned as a convex hull, and disagrees with the number reported beside it

**CONFIRMED.** Not in `docs/BACKLOG.md`.
**Priority class:** (2) confidently wrong about terrain.

`apps/api/src/terrain/corridor.service.ts:182-211` collects the boundary cells of the corridor
mask and then:

```ts
const hull = convexHull(edges);
if (hull.length < 3) return null;
hull.push(hull[0]);
return { type: 'Polygon', coordinates: [hull] };
```

A movement corridor is **non-convex by nature** — it bends around a ridge nose, forks around a
bench, threads a saddle. Its convex hull is a blob spanning the endpoints and everything
between them.

**Concrete failure, to a hunter.** The rendered band claims as "corridor" large areas the
solver explicitly rejected: the impassable ground _between_ two forks, the bluff the route
detours around, the open field it avoids. A hunter reads the shaded band as "deer move through
here" and hangs a stand inside a region the model actually scored as high resistance. That is
the "subtly inverted layer" failure — trusted, and wrong.

It also makes the API internally inconsistent. `areaShare` is computed from the **true mask**
(`corridor.service.ts:120-121,133`):

```ts
let matched = 0;
for (let i = 0; i < corridor.mask.length; i++) matched += corridor.mask[i];
...
areaShare: matched / corridor.mask.length,
```

So the response reports an honest number next to a polygon that can be several times larger.
The `pinchPoints` and `centerlines` are derived from the true mask too, and will sit well
inside the drawn band with no visible relationship to its edge.

The doc comment at `corridor.service.ts:173-181` argues for a blocky outline over a
marching-squares contour, and that argument is reasonable — but it is an argument about
_smoothing_, not about convexity, and the code does something the comment never claims. A
"cell-boundary hull" is not a convex hull.

**Fix.** Emit the mask's actual boundary. Either trace connected components and emit a
`MultiPolygon` of cell-boundary rings (keeps the honest blockiness the comment wants, correctly),
or — cheapest and still correct — emit the mask as run-length rectangles merged per component.
Either way the drawn area and `areaShare` must agree. A test asserting
`area(band) ≈ areaShare × area(bbox)` within tolerance would have caught this on any
non-straight corridor; the current `packages/terrain/src/corridor/leastcost.test.ts` tests the
solver, not this serialisation step.

---

# P2 — Medium

## E10 — Raw SQL lives in five modules outside `GeometryService`, contrary to CLAUDE.md

**CONFIRMED.** Not in `docs/BACKLOG.md`.

CLAUDE.md: _"All spatial SQL goes through `GeometryService`. One file, parameterised queries
only."_ `schema.prisma`'s header repeats it: _"every module that touches them goes through
`GeometryService` so the raw SQL lives in exactly one place."_

It does not. Raw SQL appears in six files:

| File:line                                           | Call                             |
| --------------------------------------------------- | -------------------------------- |
| `prisma/geometry.service.ts`                        | 9 sites (sanctioned)             |
| `observations/observations.module.ts:123, 223, 248` | `$queryRawUnsafe`, `$executeRaw` |
| `waypoints/waypoints.module.ts:81, 300, 312`        | `$queryRawUnsafe`, `$executeRaw` |
| `offline/offline.module.ts:131, 173`                | `$queryRawUnsafe`, `$executeRaw` |
| `properties/properties.module.ts:203`               | `$executeRaw`                    |
| `analytics/analytics.module.ts:202`                 | `$queryRawUnsafe`                |
| `health.controller.ts:17`                           | `$queryRaw` (benign)             |

**I assessed this as a live injection surface and found no injection.** Every site is
parameterised correctly:

- `$executeRaw` sites use tagged templates with `Prisma.Sql` fragments from `GeometryService`,
  so the GeoJSON crosses as a bound parameter (`geometry.service.ts:34-37`).
- `$queryRawUnsafe` sites pass a **constant** SQL string with `$1..$n` placeholders and spread
  values separately. `observations.list` (`observations.module.ts:104-136`) builds its `WHERE`
  from a fixed clause set with generated placeholder indices — the enum values themselves are
  never interpolated. `waypoints.list:87` interpolates only a boolean-derived literal
  (`includeArchived ? '' : 'AND archived = false'`).
- `readGeoJson` is the one place an **identifier** is interpolated, and it is guarded by an
  explicit whitelist (`geometry.service.ts:176-181`, `ALLOWED_GEOMETRY_COLUMNS`) that throws
  before reaching the query. Correct, and the right pattern.

So this is **debt, not a vulnerability** — but it is exactly the debt the rule exists to
prevent. The invariant is currently held by five separate authors each remembering to; there is
no test, no lint rule and no CI gate asserting it, and the next `$queryRawUnsafe` written in a
hurry is the one that concatenates a filter value.

**Fix.** Either (a) move the geometry-reading selects into `GeometryService` as typed helpers
and make the rule true, or (b) amend CLAUDE.md to state the real rule — _"user-supplied
geometry only ever reaches SQL via `GeometryService`; other raw SQL must be a constant string
with bound parameters"_ — and add a CI grep that fails on `$queryRawUnsafe` called with a
non-literal first argument. Option (b) is honest and cheap; the current text is neither.

## E11 — `ChangeLog` is entirely dead schema: offline sync _pull_ does not exist

**CONFIRMED.** Not in `docs/BACKLOG.md`.

`schema.prisma` defines `ChangeLog` with a documented purpose:

> _"Append-only change log powering offline sync pull. A cursor over this table is what lets a
> device that has been off-grid for a week catch up incrementally instead of re-downloading the
> whole property."_

The table is migrated with two indexes
(`migrations/20260806000000_init/migration.sql:365,368`) and is **never referenced by any code**
— grep for `changeLog|ChangeLog` across `apps/api/src`, `apps/web/src` and `packages/` returns
nothing outside the schema. Nothing writes a row; no endpoint reads one.

So the described capability does not exist. A device off-grid for a week re-fetches everything,
and the API has no incremental sync endpoint at all. The offline _write_ path (queue, `clientId`,
`baseVersion`) is implemented; the _read_ path is not.

The cost is a doc/schema claim that reads as shipped. `docs/ARCHITECTURE.md` and the schema
comment both describe it in the present tense. Per CLAUDE.md — _"stale docs are a defect"_ —
either implement it or mark the model `/// NOT YET IMPLEMENTED — see BACKLOG`.

## E12 — Observations carry `version` and `clientId` but have no update endpoint

**CONFIRMED.** Not in `docs/BACKLOG.md`.

`ObservationsService` implements `list`, `create`, `remove` and `getOne` only
(`observations.module.ts:97-289`); `ObservationsController` exposes `GET`, `POST`, `DELETE`
(`observations.module.ts:303-324`). There is no `PATCH`.

`Observation.version Int @default(1)` therefore never leaves 1, and `version` is returned to
clients in the list projection (`observations.module.ts:129`) as if it meant something.

Consequences: a hunter who mistypes a count, an age estimate or a sex — on a phone, in the dark,
with gloves, which is the stated operating condition — cannot correct it. Their only route is
delete-and-recreate, which changes the `id`, breaks any `waypointId` association, and re-runs
`stampTerrain`. And observations are the substrate every analytic rests on, so a wrong row that
cannot be edited is a permanently wrong denominator.

**Fix.** Add `PATCH /observations/:id` with the same `baseVersion` compare-and-swap as `E13`
prescribes, and the same author-vs-manager rule already implemented for `remove`
(`observations.module.ts:236-242`, which is good and should be reused verbatim).

## E14 — `waypointId` on an observation is never validated against the property

**CONFIRMED.** Not in `docs/BACKLOG.md`.

`CreateObservationDto.waypointId` is `@IsOptional() @IsString()`
(`observations.module.ts:58`) and is written straight through to the create
(`observations.module.ts:195`). Nothing checks that the referenced `Waypoint` belongs to
`dto.propertyId` — or to any property the caller can see.

The database will not catch it: the FK is on `Waypoint.id` alone
(`schema.prisma`, `waypoint Waypoint? @relation(fields: [waypointId], references: [id])`), with
no composite `(propertyId, waypointId)` constraint.

So a user can attach their observation to **another property's stand**. That corrupts
`@@index([waypointId])`-driven per-stand analytics on the _victim's_ property (their stand
accrues sightings nobody on that lease recorded), and it is a write-side cross-tenant reference
rather than just a read.

**Fix.** Look the waypoint up and assert `waypoint.propertyId === dto.propertyId` before the
create. A composite FK on `(propertyId, waypointId)` would enforce it in the database and is
worth the migration.

## E16 — Corridor endpoints seed only the polygon's _vertices_, not its area

**CONFIRMED.** Not in `docs/BACKLOG.md`.

`apps/api/src/terrain/corridor.service.ts:146-171`:

```ts
const coords: Array<[number, number]> =
  geometry.type === 'Point' ? [geometry.coordinates] : geometry.coordinates[0];

const cells = new Set<number>();
for (const [lng, lat] of coords) {
  const p = this.dem.pixelInMosaic(lng, lat, originTile, tileSize);
  for (let dy = -2; dy <= 2; dy++) { for (let dx = -2; dx <= 2; dx++) { ... } }
}
```

For a `Polygon`, it iterates the **exterior ring's vertices** and seeds a 5×5 disc at each. A
hunter's hand-drawn bedding area with six vertices becomes six 5×5 patches at its corners — the
interior is never a source. A `MultiPolygon` is not handled at all (`coordinates[0]` would be a
_ring array_, not a coordinate list, and would produce garbage or throw).

**Concrete failure.** The solve answers a different question than the one asked: "cheapest route
between the corners of these shapes", not "between these areas". Routes are biased toward
whichever corner happens to be cheapest, so the returned corridor can hug an edge of the
bedding area rather than leaving it where the terrain actually favours. Pinch points inherit the
bias. On a large or elongated polygon the difference is not subtle.

The interior-fill primitive already exists and is well tested:
`GeometryService.rasterizeMask` (`geometry.service.ts:114-136`) does exactly this, in pixel
space, for the `R70` fix. It is not used here.

**Fix.** Call `rasterizeMask` with the corridor's `pixelInMosaic` projection and seed every cell
it marks; keep the 5×5 disc only for the `Point` case, where it is genuinely the right
behaviour. Reject `MultiPolygon` explicitly, or handle it, rather than mis-indexing it.

## E17 — CI: the lockfile is not enforced, there is no dependency audit, and the mandatory UI gate does not run

**CONFIRMED.** Not in `docs/BACKLOG.md`.

`.github/workflows/ci.yml` is, on the whole, **the strongest part of this repository** — see
"What is genuinely good" below. Three specific gaps:

**(a) `--frozen-lockfile=false` defeats the lockfile.** `.github/workflows/ci.yml:47`:

```yaml
- run: pnpm install --frozen-lockfile=false
```

and again in `apps/api/Dockerfile:15`. This explicitly _permits_ pnpm to resolve versions
differing from `pnpm-lock.yaml` and to rewrite it. The consequence: CI can be green against one
dependency graph while the release image is built from another, and neither is the graph anyone
reviewed. For a project whose headline constraint is a **zero-runtime-dependency engine shipped
into a service worker**, unpinned transitive resolution is the wrong default. The CI job that
asserts `packages/terrain` has no dependencies (`ci.yml:64-74`) is excellent and is checking the
declared graph, not the installed one.

**(b) No dependency vulnerability gate.** `pnpm audit` is not run anywhere. Running it now:

```
34 vulnerabilities found
Severity: 4 low | 18 moderate | 11 high | 1 critical
```

**Honest assessment of that number:** the critical (`vitest < 3.2.6`, arbitrary file read via
the UI server) and most highs (`glob`, `picomatch`, `tmp`, `lodash`, `vite`) are **dev/test-only
and not reachable in the shipped API image**. The two worth a second look:

- `js-yaml@4.1.0` (high, quadratic CPU in `!!omap`) via `@nestjs/swagger@7.4.2` — a runtime
  dependency, but Swagger is only mounted when `NODE_ENV !== 'production'` (`main.ts:44-52`),
  so it is not exposed in a correct deployment.
- `multer` (high, DoS via deeply nested field names) via `@nestjs/platform-express` — present at
  runtime, but no route uses `FileInterceptor` or accepts multipart, so it is not reachable
  today. It becomes reachable the day someone adds photo upload, which `Observation.photoUrls`
  clearly anticipates.

So the _current_ runtime exposure is low. The finding is the **absence of the gate**: nobody
would know if that changed. Add `pnpm audit --audit-level high` as a non-blocking report now and
a blocking gate once the dev-only noise is triaged, plus a container scan on the published
images.

**(c) The UI-invariants suite that CLAUDE.md calls mandatory does not run in CI.** CLAUDE.md
lists _"**`ui-invariants` suite green** + screenshot review if any pixel changed"_ as a required
step in the loop for every feature, and non-negotiable #4 is built entirely around it.
`apps/web/package.json:12` defines `"test:e2e": "playwright test"`, and grep for
`e2e|playwright|ui-invariants` across `.github/workflows/` returns **nothing**. The suite exists
and is manual-only. The one failure class the project says a test cannot see by default is the
one class with no automated gate.

_(I did not run it — the environment constraint forbids it. That does not affect the finding,
which is about CI configuration.)_

## E18 — `POST /offline/regions/:id/complete` trusts an unvalidated body and 500s on an empty one

**CONFIRMED.** Not in `docs/BACKLOG.md`.

`apps/api/src/offline/offline.module.ts:283-290` — the only endpoint in the codebase whose body
is not a validated DTO class:

```ts
@Post('regions/:id/complete')
complete(
  @CurrentUser() user: AuthedUser,
  @Param('id') id: string,
  @Body() body: { tileCount: number; sizeBytes: number },   // a bare TS type — erased at runtime
) {
  return this.offline.markComplete(user.id, id, body.tileCount, body.sizeBytes);
}
```

`ValidationPipe` (`main.ts:27-34`) has nothing to validate against — a TypeScript interface is
not a class and carries no metadata — so `whitelist`/`forbidNonWhitelisted` do not apply and the
body passes through untouched.

Then `offline.module.ts:226`:

```ts
sizeBytes: BigInt(Math.max(0, Math.round(sizeBytes))),
```

With `sizeBytes` absent: `Math.round(undefined)` → `NaN`, `Math.max(0, NaN)` → `NaN`,
`BigInt(NaN)` → **`RangeError`** → unhandled → **500**. `POST` with `{}` crashes the request.

Separately, `tileCount` and `sizeBytes` are **client-reported and stored unchecked** — a device
can claim any region size. Since these drive the region list a hunter uses to decide whether
their offline data is actually present, a wrong value here is directly in the path of "discovered
blank in the field", the failure CLAUDE.md names as the worst this product has.

**Fix.** A real DTO: `class CompleteRegionDto { @IsInt() @Min(0) tileCount!: number;
@IsNumber() @Min(0) sizeBytes!: number; }`, plus a sanity ceiling cross-checked against the
server's own `estimate` for that region.

## E19 — Unbounded and silently-truncating queries in the analytics path

**CONFIRMED.** Not in `docs/BACKLOG.md`.

Two opposite failures in the same subsystem:

**Unbounded.** `AnalyticsService.movement` (`analytics.module.ts:202-209`) selects **every**
observation for a property with no `LIMIT`, materialises them all as JS objects, then calls
`sunTimes` once per row (`analytics.module.ts:223`) and iterates them five more times. For a
lease with several seasons of trail-camera rows this is tens of thousands of objects and tens of
thousands of solar computations per dashboard load, synchronously, on the request path. Combined
with the missing throttle (`E7`) this is a cheap way for an authenticated user to stall the API.

**Silently truncating.** `ObservationsService.list` (`observations.module.ts:134`) ends
`ORDER BY "observedAt" DESC LIMIT 2000` with **no pagination, no cursor and no total count**.
Past 2000 observations the client is silently handed a truncated set with nothing indicating it.
A user with four seasons of data sees a map that quietly stops showing their older observations
— "confidently wrong" by omission, and undetectable from the response.

**Fix.** Paginate `list` with a cursor and return a `hasMore`/`total`. For `movement`, either
push the aggregation into SQL (which is the stated design — _"analytics must be a SQL aggregate,
not a raster pass per row"_ — and the terrain columns are already denormalised for exactly this),
or bound the window and say so in the response.

## E21 — Synchronous PNG decoding blocks the event loop for the duration of a mosaic

**CONFIRMED.** Not in `docs/BACKLOG.md`.

`apps/api/src/terrain/dem.service.ts:151-154`:

```ts
decode(buffer: Buffer, source: DemSource): Float32Array {
  const png = PNG.sync.read(buffer);      // synchronous
  return decodeRgbaToHeights(new Uint8Array(png.data), source.encoding);
}
```

Called once per tile from `blitTile` (`dem.service.ts:289`) — up to 256 + a halo ring per
mosaic — and 9× per `gridForTile`. `PNG.sync.read` is CPU-bound and synchronous, so Node's
single thread is unavailable for the entire decode sequence. Health probes fail, other users'
requests queue, and Kubernetes may restart a pod that is doing exactly what it was asked.

**Fix.** Move mosaic assembly to a `worker_threads` pool, or at minimum yield between tiles
(`await setImmediate()`) so the loop stays responsive. Pairs with `E22` and `E2`.

## E22 — No concurrency limit on tile fetches: 256+ simultaneous DB queries and upstream requests

**CONFIRMED.** Not in `docs/BACKLOG.md`.

`dem.service.ts:302-323` pushes every tile job into one array and awaits
`Promise.all(jobs)` (`:323`), with no limiter. Each job runs `demTile.findUnique`
(`:104`) and, on a miss, `fetch()` to the upstream provider (`:137`).

At the 256-tile ceiling plus a halo ring that is **~320 concurrent Prisma queries** against a
pool whose default size is `num_cpus * 2 + 1`, and up to 320 concurrent HTTPS requests to AWS
from one process. Consequences: pool exhaustion and `P2024` timeouts under two simultaneous
mosaics; upstream rate-limiting or blocking of the whole deployment's IP — which then triggers
the swallowed-failure path of `R72`/`E6`, so the fabricated-elevation bug is _caused_ by the
missing limiter under load.

The `inflight` map (`dem.service.ts:72,111-127`) correctly coalesces duplicate concurrent
requests for the _same_ tile — good, and worth keeping — but does nothing about breadth.

**Fix.** A simple `p-limit`-style semaphore (8–16 concurrent) around `blitTile`. It must be
hand-rolled or a dependency of `apps/api` only — never of `packages/terrain`.

## E23 — Refresh-token reuse is rejected but not detected, despite the comment claiming otherwise

**CONFIRMED.** Partially related to `R68` (`docs/BACKLOG.md:123`, which covers token _storage_
in `localStorage`, not server-side reuse detection). This is a distinct, server-side gap.

`apps/api/src/auth/auth.service.ts:66-91`. The doc comment states:

> _"The presented token is revoked as soon as it is spent, which means a replayed token is both
> rejected **and detectable**."_

Rotation is implemented correctly (`auth.service.ts:85-88` revokes before reissuing). **Detection
is not implemented at all.** A presented token that is already revoked takes the same branch as
one that never existed (`auth.service.ts:81-83`) and produces a generic 401. Nothing records the
event, alerts, or revokes the token family.

**Concrete failure.** With a 90-day refresh TTL on a device that spends long periods offline
(the stated design), a stolen refresh token is valuable. If the attacker redeems it first, they
hold a rotating valid session indefinitely; the legitimate user's next refresh fails and they
see an ordinary "please log in again". The one signal that a theft occurred is discarded, and
the standard response — revoke every token in the family on reuse — is absent.

**Fix.** Store a `familyId` on `RefreshToken`; on presentation of an already-revoked token,
revoke the entire family and log it. That is what makes the comment true. Until then, correct
the comment — a comment asserting a security property the code does not implement is worse than
no comment.

---

# P3 — Low

## E20 — `GET /properties/:id` discloses every member's email address to an `OBSERVER`

**CONFIRMED.** `properties.module.ts:86-94`.

```ts
memberships: {
  select: { role: true, user: { select: { id: true, displayName: true, email: true } } },
},
```

`get` requires only `OBSERVER` (`properties.module.ts:85`). So the lowest-privileged role —
described in the schema as _"read-only, for landowners who want visibility without edit
rights"_ — receives the email address of every member of the lease. `displayName` and `role` are
what the UI needs; `email` is an identifier used for account recovery and for `addMember`.

**Fix.** Drop `email` from the projection, or return it only to `MANAGER` and above.

## E24 — `AddMemberDto.role` is `@IsString()`, so an arbitrary key is looked up on the enum object

**CONFIRMED.** `properties.module.ts:40-43, 169`.

```ts
class AddMemberDto { @IsString() email!: string; @IsString() role!: keyof typeof PropertyRole; }
...
const role = PropertyRole[dto.role];
if (!role) throw new BadRequestException(`Unknown role "${dto.role}".`);
```

`keyof typeof PropertyRole` is compile-time only. At runtime `dto.role` is any string, and
`PropertyRole` is a plain object — so `role: "constructor"` yields `Object`, which is truthy,
passes the guard, and reaches Prisma as a function, producing a 500 instead of a 400. Harmless
today, but it is a validator that does not validate.

**Fix.** `@IsEnum(PropertyRole) role!: PropertyRole;`. Pairs with `E4`, which is the serious
half of this endpoint.

---

# What is genuinely good, and should not be traded away

An audit that lists only defects misrepresents this codebase. Verified during this pass:

- **`packages/terrain` really has zero runtime dependencies.** `packages/terrain/package.json`
  has only `typescript` and `vitest` under `devDependencies`, and every import in
  `packages/terrain/src` is relative — no bare specifiers, no `node:` builtins, no DOM globals.
  It will run unchanged in Node, a browser worker and a service worker. `ci.yml:64-74` asserts
  it on every push. This constraint is held.
- **The terrain numerics are the strongest code here, and are tested the way the docs claim.**
  `packages/terrain/src/analysis/surface.test.ts` validates against **analytically-known
  surfaces with closed forms** — plane, paraboloid, saddle, cone, roof — not fixtures:
  _"recovers the true slope of a tilted plane"_, _"is scale-correct"_,
  _"matches the closed form g·s·√6 on a plane"_, _"is exactly zero on a plane at every grade"_.
  The deliberately-disagreeing sign conventions are pinned by explicit regression tests —
  _"plan and crossSectional always agree in sign"_ and _"profile and longitudinal always
  DISAGREE in sign (different conventions)"_ — and I verified the implementation matches
  (`surface.ts:239-242`: `profile` and `longitudinal` have opposite-signed numerators;
  `plan` and `crossSectional` share one). Void handling is tested at the margin, not just in
  aggregate (_"is confined to the void margin: every other cell is bit-identical"_).
  **This is better than most commercial geospatial code.**
- **`isElevation` and the `NODATA` discipline** (`packages/terrain/src/dem/encoding.ts:18-38`)
  are exactly right, and the comment explaining why `Number.isFinite` is insufficient is the
  single most useful comment in the repository. `E5` is a case of a _caller_ not following it.
- **Constant-time login is real, and I measured it** — 1.0× ratio between the present-user and
  absent-user paths. `DUMMY_HASH` is a structurally valid bcrypt hash, which is the detail most
  implementations of this pattern get wrong.
- **`GeometryService` parameterisation is correct.** I assessed it as a live injection surface
  and found nothing. The identifier whitelist (`geometry.service.ts:176-181`) is the right
  pattern for the one case that cannot be parameterised.
- **`rasterizeMask`** (`geometry.service.ts:114-136`) is a correct even-odd scanline fill with
  half-open edge handling so shared vertices count once, and its cost argument against a
  per-cell `ST_Contains` is right.
- **CI is unusually rigorous.** It runs a real PostGIS service; verifies migrations apply to an
  empty database; asserts the terrain engine's dependency count; asserts design tokens have not
  drifted; greps for leaked colour literals; asserts Dockerfiles copy every workspace dependency;
  **actually runs both images** and asserts a **numeric** non-root UID with a comment explaining
  the exact Kubernetes failure that motivated it; renders every conditional Helm path; and
  includes **negative tests** proving `values.schema.json` still rejects bad input. Most
  production repositories have none of this.
- **The Helm chart's secret lifecycle reasoning** (`deploy/helm/ridgeline/templates/secret.yaml`)
  — `helm.sh/resource-policy: keep` with a correct explanation of the retained-PVC failure — is
  the kind of thing normally learned in an outage.
- **`InsufficientHaloFilter`** (`terrain/insufficient-halo.filter.ts`) is the correct model for
  "say when you do not know": a 422 with machine-readable cell counts so the client can decide
  _how much_ to zoom out. **`E2` and `E7` should be solved the same way.**

---

# Compounding debt, ranked

Where the next six months get slow, worst first.

**1. Authorisation has no single chokepoint and no tests.** `PropertyAccessService` is a good
primitive applied _by convention_ — each service remembers to call it. Three of this audit's
four P0s (`E1`, `E3`, `E4`) are places where someone did not, or called it against the wrong
subject. There is no guard, no interceptor, and **no controller test anywhere asserting a 404
for a non-member**. Every new endpoint is a fresh chance to reintroduce `E1`, and nothing will
catch it. _Fix the shape, not the instances_: a `@RequiresProperty(role)` guard that resolves
the property id from the route/body/query and runs before the handler, plus a test helper that
runs the full "stranger gets 404 / observer gets 403 on write / member gets 200" matrix over
every route. That single investment closes `E1` and `E4` and prevents the next five.

**2. Duplicated read/write logic between the API and its raw SQL.** The shared engine exists to
prevent duplication and succeeds — but the _persistence_ layer duplicates instead. Four modules
independently hand-write a `SELECT ... ST_AsGeoJSON(...)` projection
(`waypoints:81,300`, `observations:123,248`, `offline:131`) with subtly different column lists:
`waypoints.list` returns `lastCheckedAt`, `waypoints.getOne` does not; `observations.getOne` is
`SELECT *` while `observations.list` is an explicit list. Adding a column means finding every
projection, and forgetting one is invisible until a client misses a field. This is exactly what
`E3`'s `SELECT *` leak rides on. _Fix:_ one geometry-aware repository helper per entity.

**3. The `create`-then-`write-geometry` two-step is not transactional, and is spreading.**
`waypoints:109-130`, `observations:193-227`, `properties:116-129`, `offline:159-177` all insert
a row then write geometry in a second statement. An error between them leaves a permanent row
with `location = NULL`, which `pointsWithin` and every spatial query silently skip. This is
**acknowledged as `I5`** and the migration comment
(`20260806000001_spatial_indexes/migration.sql`) is admirably honest about it. It is now
replicated in four places, so `I5` has quadrupled in cost since it was filed, and each new
geometry-bearing entity adds another. _Confirm `I5` and raise its priority_ — the cost of fixing
it grows with every feature.

**4. Terrain sampling on the write path is best-effort and unmonitored.** `attachElevation`
(`waypoints:319-332`) and `stampTerrain` (`observations:255-289`) both swallow all errors with a
bare `catch {}`. The reasoning is right — a DEM outage must not block logging sign in the field
— but there is **no counter, no log, no `terrainStampedAt` column and no re-stamp job**. Rows
silently accumulate with null terrain and are then silently dropped from the numerator of every
selection analytic (`analytics.module.ts:247` maps a null `landformClass` to a bin that is
excluded). The comment says _"can be re-stamped later"_; nothing can do that. Combined with `E6`
on the denominator side, **both halves of the selection ratio can degrade silently and
independently.** _Fix:_ record the failure on the row and add the re-stamp job the comment
already promises.

**5. The offline contract is half-built and the docs describe it as whole.** The write path
exists (queue, `clientId`, `baseVersion`) but is not atomic (`E13`) and not tenant-scoped
(`E3`); the read path does not exist at all (`E11`); observations cannot be edited (`E12`). Every
future offline feature is built on a foundation whose documented guarantees do not hold, and the
gap between `schema.prisma`'s prose and the code will keep widening.

**6. Enum casing between `@hunt-maps/shared` and Prisma — already filed as `R67`.** I **confirm
this row and endorse its framing.** It is worse than a type bug because `packages/shared` is
the contract, and `apps/web` now carries a private `Wire*` copy of it
(`apps/web/src/lib/api/types.ts`) as a documented stopgap. Two sources of truth for the same
contract, one of them wrong, is the condition under which the _next_ consumer — a mobile client,
a third-party integration — hits the same wall. This is a genuine backend-contract problem and
should be fixed at the contract, as `R67` says.

---

# Verification appendix

What was run, so the next auditor can reproduce or challenge it:

| Check                                                            | Result                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm -r test`                                                   | **759 passing**, 0 failing — matches the stated baseline (terrain 337, web 321, shared 41, api 26+1 todo, design 34) |
| `pnpm audit`                                                     | 34 findings: 1 critical, 11 high, 18 moderate, 4 low — triaged in `E17`                                              |
| `packages/terrain` dependency check                              | Zero runtime deps confirmed; all imports relative                                                                    |
| bcrypt timing measurement (`bcryptjs`, cost 12)                  | present-user 346.10 ms vs absent-user 345.87 ms — **1.0×**, constant-time claim confirmed                            |
| `grep` for raw SQL outside `GeometryService`                     | 6 files, 12 sites — all parameterised (`E10`)                                                                        |
| `grep` for `access.require` in `AnalyticsService.terrainProfile` | **0 occurrences** (`E1`)                                                                                             |
| `grep` for `@Cron`/`@Interval`                                   | **0 occurrences** despite `ScheduleModule.forRoot()` (`E8`)                                                          |
| `grep` for `ChangeLog` outside the schema                        | **0 occurrences** (`E11`)                                                                                            |
| `grep` for `e2e`/`playwright` in `.github/workflows/`            | **0 occurrences** (`E17c`)                                                                                           |
| Playwright / `pnpm test:e2e` / any browser                       | **Not run** — environment constraint                                                                                 |

**Backlog rows touched:** `R72` confirmed and escalated (`E6`); `R67` confirmed (debt #6);
`I5` confirmed and re-sized (debt #3); `R68` noted as adjacent to but distinct from `E23`.
No backlog rows were edited — `docs/ROADMAP.md` and `docs/BACKLOG.md` are owned by the
orchestrator.

---

## If only one thing is fixed

**`E1` — add `await this.access.require(userId, propertyId)` to
`AnalyticsService.terrainProfile`.**

It is chosen over the larger findings deliberately. It is a one-line change plus threading a
parameter; it closes a cross-tenant read, an id-enumeration oracle, and the cheapest path a
hostile account has to trigger the unbounded raster job that `E2` shows can take the process
down. Every other P0 needs a design decision — a memory budget (`E2`), a uniqueness-scope
migration (`E3`), a role-ceiling rule (`E4`). This one needs a line.

**`E2` is the deepest problem** and should be next: it is the only finding here that matches
CLAUDE.md's priority (1) unaided — a hunter, on a ridge, at 05:30, whose map goes away because
someone else asked a legal question.
