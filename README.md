# Ridgeline

**A self-hosted hunting map and terrain-analytics platform.** Real LiDAR terrain
analysis, saved terrain queries, movement corridors — offline first.

> Every hunting app ships terrain *visualisation*. Ridgeline ships terrain
> *analysis* you can define, name, save, and reason with.

---

## What it actually does

### Terrain analysis, not a shading toggle

A real DEM/LiDAR engine, validated against analytically-known surfaces:

| Layer | What it tells you |
|-------|-------------------|
| **Slope angle** | Banded at the breaks that matter — the 8–20° sidehill deer contour along, the 20–30° bedding grade, the 45°+ ground nothing crosses |
| **Saddles** | Low points on a ridge where deer cross instead of climbing over. Computed, not eyeballed |
| **Benches** | Level shelves cut into steep ground. Where bucks bed in hill country |
| **Landform** | Canyon / midslope drainage / bench / midslope ridge / summit — landscape *position*, not just steepness |
| **Sun exposure** | Direct insolation for a specific date and time. Late-season bedding follows the sun, and which face wins shifts through the season |
| **Bedding likelihood** | Leeward aspect × real upwind shelter × beddable grade × broken cover, for the wind you set |
| **Movement corridors** | Anisotropic least-cost routing between bedding and food, with **pinch points** extracted — the stand-placement output |

### Saved terrain filters

*"12–25°, facing north-through-east, on a midslope bench, leeward on today's
wind"* — named, saved, shareable, and available offline. Feed it to the corridor
solver and generated routes prefer exactly the ground you identified.

Seven presets ship with the app, each encoding a piece of published whitetail
doctrine as a machine-checkable predicate.

### Offline as the operating assumption

The cache holds **elevation tiles, not rendered layers**. One region download
unlocks *every* layer, *any* wind direction, *any* date — computed on-device, no
signal required. Pre-baking rendered tiles would need a variant per
layer × wind × date, which is combinatorially impossible.

### Honest analytics

Habitat-selection charts divide by the property's availability distribution and
report Manly selection ratios — because a raw histogram of sightings by slope
band measures your *property*, not your *deer*. Sightings are normalised by sits.
Activity is bucketed against sunrise, not the clock. Significance is not claimed
on thin data, and the app will tell you plainly when you have too few
observations to read a pattern.

Rut phase is modelled from **photoperiod**, not the moon. [The research is
clear](docs/RESEARCH.md#6-behavioural-covariates--what-to-model-and-what-to-refuse),
and a lunar predictor would degrade every rut-keyed analytic.

---

## Quick start

```bash
git clone https://github.com/Overcastly-AI/hunt-maps.git
cd hunt-maps

cp .env.example .env
# JWT_SECRET is required — the app refuses to boot without one
echo "JWT_SECRET=$(openssl rand -base64 48)" >> .env

docker compose up -d --build   # then http://localhost:8080
# web  → http://localhost:8080
# api  → http://localhost:3001/api/docs
```

### Local development

```bash
pnpm install
pnpm dev            # api :3001 + web :5173
pnpm test           # 193 tests
pnpm build          # topological: terrain → shared → apps
```

---

## Layout

```
packages/terrain   DEM analytics engine — ZERO runtime dependencies,
                   runs identically in Node and in a browser worker
packages/shared    Contracts, selection analytics, rut model
apps/api           NestJS + Prisma + PostGIS
apps/web           MapLibre PWA with on-device analysis worker
docs/              VISION · ROADMAP · BACKLOG · RESEARCH · ARCHITECTURE
.claude/           Agents, skills and workflows for autonomous development
```

The engine is imported by **both** the API and the browser worker. A saved
filter must mean the same thing on the laptop at camp and on a phone at the
bottom of a hollow, and one implementation is the only way to guarantee that.

---

## Data sources

| Data | Source | Notes |
|------|--------|-------|
| Elevation (global) | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) | Free, no key, not requester-pays. Default |
| Elevation (US bare earth) | [USGS 3DEP](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services) | 1 m LiDAR over much of the US. Set `DEM_3DEP_TEMPLATE` |
| Land cover | [NLCD / MRLC](https://www.mrlc.gov/data) | Drives corridor resistance |
| Imagery | Esri World Imagery | Leaf-off is what you want for scouting |

**Bare earth matters.** A surface model includes the tree canopy — under timber
it describes the top of the woods, not the ground deer walk on. Benches and old
logging grades that are obvious in LiDAR are invisible in a canopy-height model.
Ridgeline will not silently downgrade a bare-earth request to a surface model.

---

## Built by a team of agents

This project is developed by specialised AI agents defined in
[`.claude/`](.claude/README.md) — a terrain scientist who owns the correctness of
the maths, an offline steward who owns the no-signal experience, an analytics
auditor whose job is to stop the product claiming more than it knows, and
independent field QA that runs a real offline cold start before anything ships.

Two standing loops run independently of feature work, because both failure modes
are silent: `terrain-validation-loop` re-derives the engine's maths from first
principles, and `offline-integrity-loop` proves the no-signal path still works.

---

## Status

Phases 0 and 1 are complete: the terrain engine (140 tests against closed-form
synthetic surfaces), the PostGIS backend, and the offline-capable map client.

Phase 2 — property drawing, the visual filter editor, field capture UI — is in
progress. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the current state and
[`docs/VISION.md`](docs/VISION.md) for the scorecard, including the rows where
we are still behind the incumbents.

## Licence

MIT.

Vendored: [obra/superpowers](https://github.com/obra/superpowers) skills (MIT,
see `.claude/skills/SUPERPOWERS-LICENSE`) and Anthropic's `frontend-design`
skill (see `.agents/skills/frontend-design/LICENSE.txt`).
