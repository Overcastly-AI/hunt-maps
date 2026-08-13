#!/bin/sh
# Ridgeline — deliberate upgrade of a single-host compose deployment.
#
# Run it on the host, over SSH, when YOU decide it is a good time:
#
#   ssh you@server 'cd /srv/ridgeline/deploy/compose && ./upgrade.sh'
#   ssh you@server 'cd /srv/ridgeline/deploy/compose && ./upgrade.sh v1.2.3'
#
# Why this script exists rather than a documented `docker compose pull &&
# docker compose up -d`:
#
#   - `docker compose up -d` on its own does NOT pull. A published release can
#     sit in the registry indefinitely while the host keeps running the image
#     it already has, and every symptom of that looks like "the release did not
#     work" rather than "the release was never fetched". That gap is why a
#     working build sat unused.
#   - `prisma migrate deploy` runs on API start, against the live database. A
#     backup before that is not optional, so it is done here rather than left
#     as a sentence in a README that gets skipped.
#   - A rollout is not finished when the containers are up. It is finished when
#     the bytes being served are correct — an image whose bundle carries no DEM
#     template starts perfectly and renders no terrain at all. So the last step
#     is deploy/verify-served-artifact.sh against the running site, and this
#     script exits non-zero if that fails.
#
# Options:
#   --no-backup    skip the database dump (you have your own backups)
#   --build        build the images on this host instead of pulling them
set -eu

TAG_ARG=''
BACKUP=1
BUILD=0
for arg in "$@"; do
  case "$arg" in
    --no-backup) BACKUP=0 ;;
    --build) BUILD=1 ;;
    -h | --help)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) TAG_ARG="$arg" ;;
  esac
done

cd "$(dirname "$0")"

if [ -n "$TAG_ARG" ]; then
  RIDGELINE_TAG="$TAG_ARG"
  export RIDGELINE_TAG
  echo "==> Upgrading to tag: $RIDGELINE_TAG"
  echo "    (this run only — persist it in .env so a later 'up -d' agrees)"
fi

COMPOSE='docker compose'
if [ "$BUILD" -eq 1 ]; then
  COMPOSE='docker compose -f docker-compose.yml -f docker-compose.build.yml'
fi

# ---------------------------------------------------------------------------
# 1. Record what is running now, so a rollback has something to roll back TO
# ---------------------------------------------------------------------------
echo
echo "==> Currently running"
$COMPOSE ps --format 'table {{.Service}}\t{{.Image}}\t{{.Status}}' 2>/dev/null || $COMPOSE ps
PREVIOUS=$(docker inspect -f '{{index .Config.Image}}' "$($COMPOSE ps -q web 2>/dev/null || true)" 2>/dev/null || true)
[ -n "$PREVIOUS" ] && echo "    rollback target: $PREVIOUS"

# ---------------------------------------------------------------------------
# 2. Back up before any migration touches the schema
# ---------------------------------------------------------------------------
if [ "$BACKUP" -eq 1 ]; then
  echo
  echo "==> Backing up the database (migrations run on API start)"
  if $COMPOSE ps -q db >/dev/null 2>&1 && [ -n "$($COMPOSE ps -q db)" ]; then
    dump="ridgeline-$(date +%Y%m%d-%H%M%S).sql.gz"
    $COMPOSE exec -T db pg_dump -U "${POSTGRES_USER:-ridgeline}" "${POSTGRES_DB:-ridgeline}" \
      | gzip >"$dump"
    echo "    wrote $dump ($(du -h "$dump" | cut -f1))"
  else
    echo "    database is not running — nothing to back up (first install?)"
  fi
fi

# ---------------------------------------------------------------------------
# 3. Fetch, then apply
# ---------------------------------------------------------------------------
echo
if [ "$BUILD" -eq 1 ]; then
  echo "==> Building images on this host"
  $COMPOSE build
else
  echo "==> Pulling images"
  # The step that `docker compose up -d` alone skips.
  $COMPOSE pull
fi

echo
echo "==> Applying"
$COMPOSE up -d

# ---------------------------------------------------------------------------
# 4. Wait for health — the API migrates on boot and takes a while on a cold DB
# ---------------------------------------------------------------------------
echo
echo "==> Waiting for the API to report PostGIS reachable"
ok=0
i=0
while [ "$i" -lt 60 ]; do
  state=$(docker inspect -f '{{.State.Health.Status}}' "$($COMPOSE ps -q api)" 2>/dev/null || echo starting)
  if [ "$state" = "healthy" ]; then ok=1; break; fi
  if [ "$state" = "unhealthy" ]; then break; fi
  i=$((i + 1))
  sleep 3
done
if [ "$ok" != "1" ]; then
  echo "!!  API did not become healthy. Logs:" >&2
  $COMPOSE logs --tail 60 api >&2
  echo >&2
  echo "    Roll back with:  RIDGELINE_TAG=<previous> docker compose up -d" >&2
  exit 1
fi
echo "    healthy"

# ---------------------------------------------------------------------------
# 5. Verify the ARTIFACT, not just the process
# ---------------------------------------------------------------------------
# Ask docker where the web container is actually published rather than reading
# WEB_PORT, which may be `127.0.0.1:8080` or absent behind a reverse proxy.
addr=$($COMPOSE port web 8080 2>/dev/null || true)
case "$addr" in
  0.0.0.0:*) addr="127.0.0.1:${addr##*:}" ;;
  '[::]:'*) addr="127.0.0.1:${addr##*:}" ;;
esac

echo
if [ -z "$addr" ]; then
  echo "!!  The web container publishes no host port, so the served artifact could"
  echo "    not be verified from here. Run this against your public URL instead:"
  echo "      deploy/verify-served-artifact.sh https://your-host"
  exit 1
fi

echo "==> Verifying the bytes now being served at http://$addr"
if ../verify-served-artifact.sh "http://$addr"; then
  echo
  echo "==> Done. Running images:"
  $COMPOSE images 2>/dev/null || true
else
  echo
  echo "!!  The upgrade completed but the served artifact is WRONG. Do not walk away." >&2
  echo "    Roll back:  RIDGELINE_TAG=${PREVIOUS##*:} docker compose up -d" >&2
  exit 1
fi
