# Deploying Ridgeline to a single Docker host

For a VPS (Hostinger or similar). For Kubernetes, see `deploy/helm/README.md`.

## The short version

```bash
git clone https://github.com/Overcastly-AI/hunt-maps.git
cd hunt-maps/deploy/compose
cp .env.example .env && ${EDITOR:-nano} .env      # JWT_SECRET and POSTGRES_PASSWORD are required

# Build on the host (works today, no registry needed)
docker compose -f docker-compose.prod.yml -f docker-compose.build.yml up -d --build
```

Then http://your-server:8080. Put TLS in front of it before using it for real —
see below.

## Build on the host, or pull published images?

**Build on the host** is the reliable path right now. `hunt-maps` is a private
repo on a personal account, so GitHub Actions runs on metered included minutes;
when they run out, jobs stay queued, get cancelled without ever starting, and
new runs stop being created entirely. That looks like a broken workflow and is
not one. Building on the VPS has no such dependency.

**Pull published images** once that is sorted — add a payment method or spending
limit, or wait for the monthly reset:

```bash
docker compose -f docker-compose.prod.yml up -d
```

GHCR packages from a private repo are private, so log in first:

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
docker compose -f docker-compose.prod.yml exec db psql -U ridgeline ridgeline
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
git pull
docker compose -f docker-compose.prod.yml -f docker-compose.build.yml up -d --build
```

Migrations run automatically on API start (`prisma migrate deploy` in the
image's command). **Back up first** — that command applies schema changes to a
live database:

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U ridgeline ridgeline | gzip > ridgeline-$(date +%F).sql.gz
```

## If it does not come up

```bash
docker compose -f docker-compose.prod.yml ps          # health status per service
docker compose -f docker-compose.prod.yml logs api    # most failures surface here
```

- **api restarting** — usually `JWT_SECRET` unset, or `POSTGRES_PASSWORD`
  changed after the volume was initialised. The second produces an
  authentication error that looks like a wrong password because it is one: the
  database still has the original.
- **`unauthorized` pulling an image** — GHCR package is private, `docker login
  ghcr.io` with a `read:packages` PAT.
- **web up, map blank, API calls 502** — the API is not healthy yet; it waits
  for Postgres and then runs migrations. Give it the 60s start period.
