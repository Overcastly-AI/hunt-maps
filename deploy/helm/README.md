# Running Ridgeline on a local cluster

A Helm chart for kind / minikube / k3d / Docker Desktop. It pulls published
images, so nothing needs building and the repository does not need to exist on
the machine running the cluster.

## Quick start

```bash
# 1. GHCR packages are PRIVATE by default and package visibility does not
#    follow repository visibility. Skip this only if you have made
#    hunt-maps-api, hunt-maps-web and the chart public. Getting it wrong shows
#    up as ImagePullBackOff, which reads like a missing tag rather than a
#    permissions problem — it is the most likely first failure on a fresh
#    local cluster.
kubectl create secret docker-registry ghcr \
  --docker-server=ghcr.io \
  --docker-username=<your-github-username> \
  --docker-password=<PAT with read:packages>

echo "<PAT>" | helm registry login ghcr.io -u <your-github-username> --password-stdin

# 2. Install a specific chart version. Always name it — see "Upgrading".
helm install ridgeline oci://ghcr.io/overcastly-ai/hunt-maps/ridgeline \
  --version 1.1.3 \
  --set image.pullSecrets[0].name=ghcr \
  --set ingress.enabled=true

# 3. Prove what is running and what it serves. Not optional — see "Verifying".
deploy/verify-k8s-release.sh ridgeline default
```

Then http://ridgeline.localtest.me — `*.localtest.me` resolves to 127.0.0.1
from public DNS, so there is nothing to add to `/etc/hosts`. The chart defaults
to that hostname and to the `nginx` ingress class, and derives the API's CORS
origins from the ingress host, so one flag is the whole configuration.

Without an ingress controller, forward the port instead — works on any cluster:

```bash
helm install ridgeline oci://ghcr.io/overcastly-ai/hunt-maps/ridgeline
kubectl port-forward svc/ridgeline-web 8080:80
```

Verify the release, then tear it down:

```bash
helm test ridgeline
helm uninstall ridgeline
```

`helm test` asserts two things a green rollout does not prove: that the API's
health endpoint reports PostGIS **reachable** (a pod can be Running against a
database it cannot query), and that the web tier's nginx really proxies `/api`.
That proxy path is rendered from the release name, so it breaks on a rename in
a way nothing else catches — the shell serves perfectly and every data request
502s.

## Versions

`api.image.tag` and `web.image.tag` are **empty by default**, and the templates
fall back to the chart's `appVersion`. `.github/workflows/release.yml` bumps
`Chart.yaml` in the same commit that tags the release and builds the images, so
a given chart revision always installs the images built from its own source.
There is no way for the chart and the images it pulls to drift apart.

That design has one consequence that has cost this project real time, and it is
worth stating on its own line:

> **The running image only changes when the chart version changes.**

`image.tag` is empty → the tag comes from `Chart.appVersion` → `appVersion`
changes only when a new chart version is published. Upgrade to the same chart
version and the rendered Deployment is byte-identical, so Kubernetes computes
the same pod-template hash and performs **no rollout at all**. Nothing is wrong,
nothing is reported, and the cluster keeps serving the release it first
installed. Combined with `pullPolicy: IfNotPresent` — which means the node does
not even check the registry for a tag it already has — a cluster installed once
can sit on an old build indefinitely while every pod reads `Running`.

Released images carry `X.Y.Z`, `X.Y`, `X` and `latest`. **Pin `X.Y.Z`** — the
moving aliases exist so a patch can be adopted deliberately, not picked up by
surprise on a pod reschedule.

### The `:latest` trap

```bash
# DOES NOT DO WHAT IT LOOKS LIKE
helm upgrade ridgeline oci://ghcr.io/overcastly-ai/hunt-maps/ridgeline \
  --set web.image.tag=latest
```

`image.pullPolicy` is `IfNotPresent`. A node that already has _something_
tagged `:latest` will not re-pull, ever — the tag moving in the registry is
invisible to it. The pod comes up green on a months-old image, and because you
asked for `latest` you will read that green as "running the newest build". This
is the single easiest way to recreate the bug this repository just spent a day
on. If you want a moving tag, you must also change the pull policy:

```bash
--set web.image.tag=latest --set api.image.tag=latest --set image.pullPolicy=Always
```

Prefer pinning `X.Y.Z` and upgrading on purpose. `Always` also makes every pod
start depend on the registry being reachable, which is a poor trade on a laptop
cluster.

## Upgrading

**State the version. Every time.**

```bash
helm upgrade ridgeline oci://ghcr.io/overcastly-ai/hunt-maps/ridgeline \
  --version 1.2.3 \
  --reuse-values

deploy/verify-k8s-release.sh ridgeline default        # then prove it
```

Omitting `--version` is not safe shorthand. What Helm does with a versionless
OCI reference depends on your Helm build: 3.16 (tested) queries the registry's
tag list and resolves the highest SemVer tag, while older 3.x releases require
the version or look for a `latest` tag that this chart never publishes. Either
way you cannot tell from the command what you got, and if the resolved chart
matches the installed one the upgrade succeeds having changed nothing — no
rollout, no new image, no error. `--version` makes the deploy deliberate,
auditable and rollback-able.

`--reuse-values` keeps the `--set` flags from the previous install. Without it,
every override you supplied at install time — pull secret, ingress, CORS —
reverts to defaults, and the first symptom is usually `ImagePullBackOff` or a
hostname that stops routing.

### Finding the newest published chart version

The chart version, the app version and the git tag are all the same number:
`.releaserc.json` has semantic-release rewrite both `version` and `appVersion`
in `Chart.yaml` on every release. So any of these answers it:

```bash
# Authoritative — what is actually in the registry (public package):
curl -s "https://ghcr.io/token?scope=repository:overcastly-ai/hunt-maps/ridgeline:pull&service=ghcr.io" \
  | sed -E 's/.*"token":"([^"]+)".*/\1/' \
  | xargs -I{} curl -s -H "Authorization: Bearer {}" \
      https://ghcr.io/v2/overcastly-ai/hunt-maps/ridgeline/tags/list

# Same number, less typing (needs the gh CLI, works for a private repo):
gh release view --repo Overcastly-AI/hunt-maps --json tagName -q .tagName

# What your Helm would resolve to, without installing anything:
helm show chart oci://ghcr.io/overcastly-ai/hunt-maps/ridgeline | grep '^version:'
```

For a private package the registry call needs a PAT: pass
`-u <user>:<PAT with read:packages>` to the token request.

## Verifying a deploy — do not skip this

A green rollout is not evidence. During the months when every terrain layer
rendered blank, every pod was `Running`, every probe passed, and `helm list`
said `deployed`. The failure was in the bytes being served.

```bash
deploy/verify-k8s-release.sh                 # release "ridgeline", namespace "default"
deploy/verify-k8s-release.sh myrel hunting   # release, namespace
```

It prints two things and then asserts a third:

1. **The image each Deployment asks for**, with its pull policy — and
   separately, **the image and digest the kubelet actually started**. Those two
   differ exactly when a pull was skipped, which is the `IfNotPresent` trap
   above. This is the command that replaces "is the new version deployed?"
   with a fact:

   ```bash
   kubectl -n default get deploy -l app.kubernetes.io/instance=ridgeline \
     -o custom-columns='DEPLOYMENT:.metadata.name,IMAGE:.spec.template.spec.containers[0].image,PULLPOLICY:.spec.template.spec.containers[0].imagePullPolicy'

   kubectl -n default get pods -l app.kubernetes.io/instance=ridgeline \
     -o custom-columns='POD:.metadata.name,IMAGE:.status.containerStatuses[*].image,DIGEST:.status.containerStatuses[*].imageID'
   ```

2. **What the web tier actually serves**, over a temporary port-forward, via
   `deploy/verify-served-artifact.sh`:
   - the served JavaScript embeds a usable DEM tile template. An empty
     `VITE_DEM_TEMPLATE` compiled into the bundle produced no error, no log
     line and no crash — just every elevation-derived layer rendering nothing.
     This assertion is what catches it.
   - `index.html` returns `Cache-Control: no-cache`. Without it browsers apply
     heuristic freshness and keep serving the previous shell, which references
     `/assets/` hashes cached `immutable` for a year — a correct deploy that
     nobody can see.
   - `/assets/` are `immutable`, `/sw.js` is `no-store`.

Both scripts exit non-zero on failure, so they can be chained after an upgrade
or run from a CI job against a real cluster. The same served-bytes assertions
run in `.github/workflows/ci.yml` (`shipped-artifact`) against the image _and_
against this chart's rendered nginx ConfigMap, so a release that cannot render
terrain should never reach a registry — these scripts are how you prove your
cluster is running that release.

Against an ingress host, skip the port-forward:

```bash
deploy/verify-served-artifact.sh http://ridgeline.localtest.me
```

If the web image was built with a custom elevation source, tell the script:

```bash
deploy/verify-served-artifact.sh http://ridgeline.localtest.me \
  --dem-template='https://your-host/dem/{z}/{x}/{y}.png'
```

## If the pull fails

GHCR package visibility is separate from repository visibility and does not
follow it. If a pull fails with `unauthorized` — which reads like a missing tag
rather than a permissions problem — make each package public under
**your profile → Packages → package settings**, or give the chart a pull
secret:

```bash
kubectl create secret docker-registry ghcr \
  --docker-server=ghcr.io --docker-username=<user> --docker-password=<PAT with read:packages>
helm upgrade ridgeline oci://ghcr.io/overcastly-ai/hunt-maps/ridgeline \
  --set image.pullSecrets[0].name=ghcr
```

## When the hostname does not route

The Ingress object is created regardless, so `kubectl get ingress` looks
correct even when nothing serves it. Two causes, both silent:

- **No ingress controller.** kind and k3d ship none by default. On kind the
  cluster additionally needs `extraPortMappings` for 80/443 at creation time,
  or the controller is reachable only from inside the node. Docker Desktop
  publishes one on localhost:80 directly.
- **A class that matches no controller.** Silently ignored by every controller
  in the cluster, which presents identically to having none. Check with
  `kubectl get ingressclass` and pass `--set ingress.className=<that>`.

**CORS is not one of the causes.** The chart appends `scheme://host` to
`api.corsOrigins` whenever ingress is enabled, taking the scheme from
`ingress.tls`, so an https host cannot silently get an http origin. Forgetting
that used to produce a working route and an app where every data request was
blocked by the browser citing an origin nobody typed.

## Production posture

| Control                                   | Default           | Notes                                                                                                                                                                                                                                            |
| ----------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Non-root containers                       | **on**            | API runs as uid 1000, web as uid 101 via `nginx-unprivileged`. `runAsNonRoot` is enforced, so a regression to a root image fails the pod rather than quietly running privileged. CI proves it by running both images and asserting `id -u != 0`. |
| `readOnlyRootFilesystem`                  | on (API, web-off) | The API gets `emptyDir` mounts at `/tmp` and `/home/node` because pnpm and Prisma both write at runtime. nginx-unprivileged needs its own temp dirs, so it is off there rather than weakening the chart-wide default.                            |
| `allowPrivilegeEscalation` / capabilities | off / `drop: ALL` | Every container.                                                                                                                                                                                                                                 |
| `seccompProfile`                          | `RuntimeDefault`  | Every pod.                                                                                                                                                                                                                                       |
| Postgres `fsGroup`                        | `999`             | Load-bearing: without it the PersistentVolume is owned by root and `initdb` aborts on a directory it just mounted.                                                                                                                               |
| `values.schema.json`                      | on                | A misspelled key is otherwise silently ignored and the default applies. CI asserts the schema still rejects four known-bad inputs, including a `jwtSecret` under 32 characters.                                                                  |
| `startupProbe` on the API                 | on                | Until it passes, liveness is not evaluated. Without it a slow first boot — cold Prisma engine, large migration — trips liveness and the pod restarts forever, which reads as a crash rather than a timeout.                                      |
| PodDisruptionBudgets                      | **off**           | A PDB with one replica blocks node drains, which on a laptop cluster looks like a stuck `kubectl`.                                                                                                                                               |
| HorizontalPodAutoscaler                   | **off**           | Enabling it makes the HPA own the replica count; `replicaCount` is then ignored. Scales up in 30s and down over 5 minutes — bursty analysis, expensive restarts.                                                                                 |
| NetworkPolicy                             | **off**           | Default-deny to the database. Off because it is worse than useless unenforced: kind's default CNI ignores NetworkPolicy entirely, so it renders, appears in `kubectl get netpol`, and restricts nothing.                                         |

## Supply chain

Release images are multi-arch (`amd64` + `arm64`), carry a SLSA provenance
attestation and an SBOM, and are **signed with cosign** keyless. Signing is by
digest, never by tag: a tag is mutable, so a signature against `:latest` stops
matching the moment the tag moves, which looks like tampering.

Verify before deploying:

```bash
cosign verify ghcr.io/overcastly-ai/hunt-maps-api:1.0.0 \
  --certificate-identity-regexp 'https://github.com/Overcastly-AI/hunt-maps/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The chart itself is published as an OCI artifact — that is the `oci://` URL
in the quick start — and also attached to each GitHub release as a `.tgz`.

## Two things that look like bugs and are not

**The basemap needs internet from your browser, not from the cluster.** The
web app fetches DEM tiles and satellite imagery directly. Terrain analysis
does not: it runs on-device from cached elevation, which is the entire offline
premise. **If imagery is blank but hillshade, slope and landform render, the
system is working.** That is worth internalising before you debug the wrong
layer.

**The elevation source is baked into the web bundle at build time.**
`VITE_DEM_TEMPLATE` is read by Vite during `pnpm build` (see
`apps/web/src/lib/map/demSource.ts`), not by the running container. No Helm
value can change it, because by the time Kubernetes sees the image the URL is
already inside the JavaScript. That is also why it is worth verifying after a
deploy: a wrong or empty value here is invisible to every Kubernetes-level
check, and `deploy/verify-k8s-release.sh` is the one thing that sees it. To
point at a different source:

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
rest block, so it usually _looks_ fine — until a slow migration trips a startup
probe and the rollout stalls on pods that were only ever waiting. The chart
runs migrations in an initContainer and starts the server with a plain
`node dist/main.js`.

**Secrets are generated once and preserved.** Leave `auth.jwtSecret` empty and
the chart mints one on first install, then reuses it on every upgrade via
`lookup`. Without that, each `helm upgrade` would mint a _new_ JWT key and log
every user out, and a new Postgres password that no longer matches the one
burned into the data volume at initialisation. The Secret carries
`helm.sh/resource-policy: keep` for the same reason — an uninstall that removes
it while a retained PVC survives leaves a database nothing can authenticate
against.

**The web tier's nginx config is replaced wholesale.** The chart mounts its own
`default.conf` from a ConfigMap, because the one baked into the image
hardcodes `proxy_pass http://api:3001/api/` and the Service here is named after
the release. The cost of that is a second copy of every rule — and a rule
added to `apps/web/nginx.conf` and not to the ConfigMap is silently absent on
Kubernetes. That already happened once: the `index.html` `no-cache` rule that
fixed "a published release is invisible" for compose was never added here, so
the fix did not exist on the deployment path actually in use. CI now runs the
chart's rendered config against the real image and asserts the same headers
(`shipped-artifact` in `.github/workflows/ci.yml`), so the two cannot drift
silently again. Changing the ConfigMap also rolls the web pods on upgrade —
the Deployment carries a `checksum/config` annotation — which is one of the
few ways a same-version `helm upgrade` does produce a rollout.

**nginx resolves the API at request time.** The upstream is assigned to a
variable with an explicit `resolver`. nginx otherwise resolves a literal
hostname once at startup and _exits_ if it does not resolve — and Helm gives no
ordering guarantee between the web Deployment and the api Service, so a cold
install can CrashLoopBackOff on a cluster where nothing is wrong.

**Redis is off.** The repo-root `docker-compose.yml` starts Redis and passes `REDIS_URL`, but
nothing consumes it: no redis/ioredis/bull dependency in `apps/api/package.json`
and no import anywhere in `apps/api/src`. Turning it on gives you a cache with
no reader. Enable it in the same change that adds a consumer.

## Values worth knowing

| Key                           | Default                 | Why                                                                                                                                                 |
| ----------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgis.persistence.enabled` | `true`                  | `false` puts the database on an emptyDir. Every stand, waypoint and saved filter dies with the pod.                                                 |
| `postgis.persistence.size`    | `8Gi`                   | Observations plus denormalised terrain. DEM tiles are **not** stored server-side.                                                                   |
| `externalDatabase.url`        | `""`                    | Set it and the in-chart StatefulSet is skipped entirely. Must be PostGIS, not stock Postgres.                                                       |
| `auth.jwtSecret`              | generated               | Set explicitly for anything you care about.                                                                                                         |
| `api.dem3depTemplate`         | `""`                    | USGS 1m LiDAR. Left empty the API serves public Terrarium tiles and rejects `3dep` requests with a clear message rather than silently falling back. |
| `api.corsOrigins`             | `http://localhost:8080` | Match your port-forward or ingress host.                                                                                                            |
| `ingress.enabled`             | `false`                 | A port-forward behaves identically on every local cluster; ingress does not.                                                                        |

The API has a CPU _request_ but deliberately no CPU _limit_: terrain analysis
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
