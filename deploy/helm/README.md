# Running Ridgeline on a local cluster

A Helm chart for kind / minikube / k3d / Docker Desktop. It pulls published
images, so nothing needs building and the repository does not need to exist on
the machine running the cluster.

## Quick start

Nothing to build and nothing to clone onto the cluster host — the chart
installs published images.

```bash
helm install ridgeline ./deploy/helm/ridgeline -n ridgeline --create-namespace
kubectl -n ridgeline port-forward svc/ridgeline-web 8080:80
```

Then http://localhost:8080. The API is proxied at `/api` through the same
origin, so that one forward is all you need — and it means you exercise the
same-origin path the app really uses, rather than a CORS setup that only
exists on your laptop.

Or install straight from a checkout-free URL once a release exists:

```bash
helm install ridgeline \
  https://github.com/Overcastly-AI/hunt-maps/releases/download/v<version>/ridgeline-<version>.tgz \
  -n ridgeline --create-namespace
```

## Versions

`api.image.tag` and `web.image.tag` are **empty by default**, and the templates
fall back to the chart's `appVersion`. `.github/workflows/release.yml` bumps
`Chart.yaml` in the same commit that tags the release and builds the images, so
a given chart revision always installs the images built from its own source.
There is no way for the chart and the images it pulls to drift apart.

Override only to pin something older, or to test a development image from
`publish-images.yml`:

```bash
helm upgrade ridgeline ./deploy/helm/ridgeline -n ridgeline \
  --set api.image.tag=1.2.3 --set web.image.tag=1.2.3
```

Released images carry `X.Y.Z`, `X.Y`, `X` and `latest`. **Pin `X.Y.Z` in
production** — the moving aliases exist so a patch can be adopted deliberately,
not picked up by surprise on a pod reschedule.

## If the pull fails

GHCR package visibility is separate from repository visibility and does not
follow it. If a pull fails with `unauthorized` — which reads like a missing tag
rather than a permissions problem — make each package public under
**your profile → Packages → package settings**, or give the chart a pull
secret:

```bash
kubectl -n ridgeline create secret docker-registry ghcr \
  --docker-server=ghcr.io --docker-username=<user> --docker-password=<PAT with read:packages>
helm upgrade ridgeline ./deploy/helm/ridgeline -n ridgeline \
  --set image.pullSecrets[0].name=ghcr
```

## Two things that look like bugs and are not

**The basemap needs internet from your browser, not from the cluster.** The
web app fetches DEM tiles and satellite imagery directly. Terrain analysis
does not: it runs on-device from cached elevation, which is the entire offline
premise. **If imagery is blank but hillshade, slope and landform render, the
system is working.** That is worth internalising before you debug the wrong
layer.

**The elevation source is baked into the web bundle at build time.**
`VITE_DEM_TEMPLATE` is read by Vite during `pnpm build` (see
`apps/web/src/App.tsx`), not by the running container. No Helm value can
change it, because by the time Kubernetes sees the image the URL is already
inside the JavaScript. To point at a different source:

```bash
docker build -t ridgeline/web:dev \
  --build-arg VITE_DEM_TEMPLATE='https://your-host/{z}/{x}/{y}.png' \
  -f apps/web/Dockerfile .
```

(The build arg exists in `apps/web/Dockerfile`. Left unset it falls back to the
public AWS Terrarium tiles.)

## What the chart does that compose does not

**Migrations move out of the app container.** The image's `CMD` is
`prisma migrate deploy && node dist/main.js`, which is right for compose and
wrong for Kubernetes: with more than one replica, every pod races to apply the
same migration on every rollout. Prisma's advisory lock means one wins and the
rest block, so it usually *looks* fine — until a slow migration trips a startup
probe and the rollout stalls on pods that were only ever waiting. The chart
runs migrations in an initContainer and starts the server with a plain
`node dist/main.js`.

**Secrets are generated once and preserved.** Leave `auth.jwtSecret` empty and
the chart mints one on first install, then reuses it on every upgrade via
`lookup`. Without that, each `helm upgrade` would mint a *new* JWT key and log
every user out, and a new Postgres password that no longer matches the one
burned into the data volume at initialisation. The Secret carries
`helm.sh/resource-policy: keep` for the same reason — an uninstall that removes
it while a retained PVC survives leaves a database nothing can authenticate
against.

**nginx resolves the API at request time.** The upstream is assigned to a
variable with an explicit `resolver`. nginx otherwise resolves a literal
hostname once at startup and *exits* if it does not resolve — and Helm gives no
ordering guarantee between the web Deployment and the api Service, so a cold
install can CrashLoopBackOff on a cluster where nothing is wrong.

**Redis is off.** The repo-root `docker-compose.yml` starts Redis and passes `REDIS_URL`, but
nothing consumes it: no redis/ioredis/bull dependency in `apps/api/package.json`
and no import anywhere in `apps/api/src`. Turning it on gives you a cache with
no reader. Enable it in the same change that adds a consumer.

## Values worth knowing

| Key | Default | Why |
|---|---|---|
| `postgis.persistence.enabled` | `true` | `false` puts the database on an emptyDir. Every stand, waypoint and saved filter dies with the pod. |
| `postgis.persistence.size` | `8Gi` | Observations plus denormalised terrain. DEM tiles are **not** stored server-side. |
| `externalDatabase.url` | `""` | Set it and the in-chart StatefulSet is skipped entirely. Must be PostGIS, not stock Postgres. |
| `auth.jwtSecret` | generated | Set explicitly for anything you care about. |
| `api.dem3depTemplate` | `""` | USGS 1m LiDAR. Left empty the API serves public Terrarium tiles and rejects `3dep` requests with a clear message rather than silently falling back. |
| `api.corsOrigins` | `http://localhost:8080` | Match your port-forward or ingress host. |
| `ingress.enabled` | `false` | A port-forward behaves identically on every local cluster; ingress does not. |

The API has a CPU *request* but deliberately no CPU *limit*: terrain analysis
is bursty and CPU-bound, and throttling reads to a user as "the analysis engine
is slow".

## Verifying a change to the chart

```bash
helm lint ./deploy/helm/ridgeline
helm template rl ./deploy/helm/ridgeline | kubectl apply --dry-run=client -f -

# Exercise the conditional paths — most chart bugs live in a branch that the
# default values never render.
helm template rl ./deploy/helm/ridgeline --set ingress.enabled=true --set redis.enabled=true
helm template rl ./deploy/helm/ridgeline --set externalDatabase.url=postgresql://u:p@h:5432/d
```

Note that `lookup` returns nothing during `helm template` and `--dry-run`, so
generated secrets render as fresh random values there. That is expected — do
not diff a dry-run against the cluster and conclude the secret drifted.
