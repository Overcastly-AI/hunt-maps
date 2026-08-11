# Deploying Ridgeline to a single Docker host

For a VPS (Hostinger or similar). For Kubernetes, see `deploy/helm/README.md`.

## The short version

```bash
git clone https://github.com/Overcastly-AI/hunt-maps.git
cd hunt-maps/deploy/compose
cp .env.example .env && ${EDITOR:-nano} .env      # JWT_SECRET and POSTGRES_PASSWORD are required

# Build on the host (works today, no registry needed)
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Then http://your-server:8080. Put TLS in front of it before using it for real —
see below.

## Build on the host, or pull published images?

**Build on the host** is the only path that works today, because the published
images do not exist. `hunt-maps-web` has never built successfully, and
`hunt-maps-api` built only on a feature branch — so it carries a branch tag and
`sha-…`, but no `latest`, which the workflow gates on `is_default_branch`.

GitHub Actions stopped scheduling runs partway through development and did not
resume, including after the repository was made public. Until that is fixed
(check **Settings → Actions → General**, then billing — going public only helps
if Actions is enabled), nothing new will be published. Building on the host has
no such dependency.

**Pull published images** once a run genuinely publishes some:

```bash
docker compose up -d
```

GHCR package visibility is separate from repository visibility and does not
follow it, so the packages are still private. Either make them public under
**your profile → Packages → package settings**, or log in first:

```bash
echo "$GITHUB_PAT" | docker login ghcr.io -u <username> --password-stdin   # PAT needs read:packages
```

Pin an immutable tag in `.env` — `RIDGELINE_TAG=v0.1.0` or a `sha-<commit>`.
`latest` moving under a running host is how two containers end up on different
builds.

## Before you build

**The web build needs about 2 GB of RAM.** On a 1 GB VPS Vite gets OOM-killed
and it reads as a hung build. Add swap first:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## What is exposed

Only the web container publishes a port. Postgres and the API are reachable
solely on the compose network — the browser reaches the API through nginx at
`/api`, same-origin, so CORS never has to be loosened.

**Publishing 5432 on a VPS puts Postgres on the public internet**, which is the
most common way a small deployment gets compromised. There is deliberately no
`ports:` on `db`. If you need psql access, tunnel it:

```bash
ssh -L 5432:localhost:5432 user@server -N   # with a temporary published port, or use docker exec
docker compose exec db psql -U ridgeline ridgeline
```

## TLS

The compose file serves plain HTTP on `WEB_PORT`. Terminate TLS in front of it.
Caddy is the least effort — it obtains and renews certificates automatically:

```caddyfile
ridgeline.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Then set `WEB_PORT=127.0.0.1:8080` in `.env` so the container is not reachable
except through the proxy, and set `CORS_ORIGINS=https://ridgeline.example.com`.

**A PWA needs HTTPS.** Service workers do not register over plain HTTP except on
`localhost`, so without TLS the offline behaviour — the entire point of this
app — silently does not exist. The page will look fine.

## Two things that look like bugs and are not

**A blank basemap with working hillshade means the browser has no internet, not
that the engine failed.** Terrain analysis runs on-device from cached elevation.
Satellite imagery is fetched by the browser directly.

**The elevation source is compiled into the bundle.** `VITE_DEM_TEMPLATE` is
resolved by Vite at build time, so setting it in `.env` only does anything with
`docker-compose.build.yml` and a rebuild. There is no runtime override.

## Upgrading

```bash
./upgrade.sh                 # pull, apply, wait for health, verify the artifact
./upgrade.sh v1.2.3          # to a specific tag
./upgrade.sh --build         # build on this host instead of pulling
```

`upgrade.sh` does the four things a hand-run upgrade forgets, in order: dumps
the database (migrations run on API start, against live data), **pulls**,
applies, waits for the API to report PostGIS reachable, and then verifies the
bytes actually being served. It exits non-zero if any of that fails and prints
the rollback command.

**`docker compose up -d` does not pull.** That is the single most expensive
thing to not know about this deployment. A published release can sit in the
registry for weeks while the host happily keeps running the image it already
has, and every symptom of it looks like "the new version did not fix anything"
rather than "the new version was never fetched". By hand it is always two
commands:

```bash
docker compose pull && docker compose up -d
```

### Verifying an upgrade actually landed

```bash
../verify-served-artifact.sh http://localhost:8080     # or your public URL
```

This asserts against the bytes the site returns, not the source tree or the
container state:

- the served JavaScript embeds a usable DEM tile template — the P0 that made
  every terrain layer render blank in every deployed container started fine,
  passed every health check, and served an empty tile URL;
- `index.html` comes back `no-cache`, without which a correct deploy is
  invisible to anyone who has loaded the site before;
- `/assets/` are `immutable` and `/sw.js` is `no-store`.

The same script runs in CI against the freshly built image (`shipped-artifact`
in `.github/workflows/ci.yml`), so a release that cannot render terrain is
supposed to be stopped before it is ever published. Run it here anyway — CI
proves the image is good, this proves _your host is serving that image_.

## Unattended updates, if you want them

**Off by default, and that default is deliberate.** Opt in with a profile:

```bash
docker compose --profile autoupdate up -d
```

That starts [Watchtower](https://containrrr.dev/watchtower/), which polls GHCR
on a schedule, pulls a newer image behind the tag you are running, and recreates
the `api` and `web` containers. No inbound access, no SSH key in GitHub, no
secrets stored anywhere — the host makes an outbound HTTPS request on a timer,
and that is the whole mechanism.

**What you are accepting:**

|                                             |                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Restarts happen without you**             | The containers are recreated. Anyone using the map loses it for a few seconds and in-flight requests fail. The PWA keeps serving from cache and queued writes are idempotent, so it is survivable — but a restart at first light on opening morning is a real cost, and nobody decided it should happen then. The default schedule is **13:00 local**, the middle of the day, for exactly this reason. Set `TZ` in `.env` or 13:00 is UTC and means nothing. |
| **Watchtower holds the Docker socket**      | Root-equivalent on the host. It is mounted read-only, which removes the easy write paths but not the risk.                                                                                                                                                                                                                                                                                                                                                   |
| **It only follows a moving tag**            | With `RIDGELINE_TAG` pinned to a version — which is what this README recommends — there is nothing to move to and Watchtower does nothing, forever, silently. Auto-update and pinning are mutually exclusive. Choose on purpose.                                                                                                                                                                                                                             |
| **No canary, no rollback**                  | A bad release lands unattended. Recovery is manual: set `RIDGELINE_TAG` to the previous version and `docker compose up -d`.                                                                                                                                                                                                                                                                                                                                  |
| **It updates images, not the compose file** | New environment variables, new services, changed ports — none of that arrives. Those still need a `git pull` and a deliberate `up -d`.                                                                                                                                                                                                                                                                                                                       |
| **The database is never touched**           | `db` carries no Watchtower label. An unattended Postgres major-version bump would refuse to start against the existing data directory, and that is not a discovery to make from a truck.                                                                                                                                                                                                                                                                     |

Set `WATCHTOWER_NOTIFICATION_URL` so an update at least tells you it happened.
Silent updates are the worst version of this.

Turn it off again:

```bash
docker compose --profile autoupdate down watchtower
```

### Why there is no GitHub Actions deploy job

A workflow that SSHes into the VPS after a release would need `SSH_HOST`,
`SSH_USER` and an `SSH_KEY` secret, plus the host reachable from GitHub's
runners. **None of those exist in this repository**, and a workflow that
references secrets nobody has configured does not fail — it runs, substitutes
empty strings, and either no-ops or fails with an error that reads like a
network problem. That failure mode is the exact one this project keeps getting
bitten by, so the workflow is deliberately absent rather than present and inert.

If you want one, the operator work is: create a deploy user on the VPS with
permission to run docker, add its private key as the `SSH_KEY` repository
secret along with `SSH_HOST` and `SSH_USER`, then add a job that runs
`ssh … 'cd /srv/ridgeline/deploy/compose && ./upgrade.sh'` and **fails loudly
when any of the three secrets is empty**. Until those secrets exist, `ssh` from
your laptop is the same command with less machinery.

## If it does not come up

```bash
docker compose ps          # health status per service
docker compose logs api    # most failures surface here
```

- **api restarting** — usually `JWT_SECRET` unset, or `POSTGRES_PASSWORD`
  changed after the volume was initialised. The second produces an
  authentication error that looks like a wrong password because it is one: the
  database still has the original.
- **`unauthorized` pulling an image** — GHCR package is private, `docker login
ghcr.io` with a `read:packages` PAT.
- **web up, map blank, API calls 502** — the API is not healthy yet; it waits
  for Postgres and then runs migrations. Give it the 60s start period.
