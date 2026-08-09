# Build from the repo root: docker build -f apps/api/Dockerfile .
FROM node:20-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/terrain/package.json packages/terrain/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile=false

COPY packages/ packages/
COPY apps/api/ apps/api/
# Topological: terrain → shared → api. The API requires the packages' built
# CommonJS output at runtime, not their TypeScript source.
RUN pnpm --filter @hunt-maps/terrain build \
 && pnpm --filter @hunt-maps/shared build \
 && pnpm --filter @hunt-maps/api exec prisma generate \
 && pnpm --filter @hunt-maps/api build

# Assert the entrypoint exists, at build time, with a message that says what
# to do about it.
#
# `nest build` does NOT emit dist/main.js here. The API's tsconfig spans the
# workspace packages, so TypeScript keeps the directory structure relative to
# their common root and the entrypoint lands at dist/apps/api/src/main.js.
# Nothing catches that: the image builds, `docker build` is green, the layer
# is pushed — and the container dies on start with MODULE_NOT_FOUND. Pin it
# here so a tsconfig change that moves the output fails the build rather than
# the deployment.
RUN test -f apps/api/dist/apps/api/src/main.js \
 || (echo "ERROR: expected entrypoint at apps/api/dist/apps/api/src/main.js" \
  && echo "nest build emitted this instead:" \
  && find apps/api/dist -name 'main.js' \
  && echo "Update the CMD in this Dockerfile and apps/api/package.json to match." \
  && exit 1)

FROM base AS runtime
# OCI metadata. `org.opencontainers.image.source` is what makes GitHub link a
# published package back to this repository — without it the package page has
# no repo, no README and no visible provenance, which is the difference between
# a registry entry someone can trust and an anonymous blob.
LABEL org.opencontainers.image.source="https://github.com/Overcastly-AI/hunt-maps" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.title="Ridgeline API" \
      org.opencontainers.image.description="NestJS + Prisma + PostGIS backend for the Ridgeline hunting map"
ENV NODE_ENV=production

# Run as the unprivileged `node` user the base image already ships (uid 1000).
#
# `--chown` on the COPY rather than a separate `chown -R` afterwards: a chown
# of an entire node_modules tree is a full extra image layer the size of the
# tree, which roughly doubles the image for no benefit.
#
# HOME is set explicitly because pnpm and Prisma both write there — pnpm for
# its store metadata, Prisma for query-engine caches. Without it they inherit
# root's /root, which uid 1000 cannot write, and the failure is an EACCES deep
# inside a postinstall that reads like a corrupt install.
COPY --from=build --chown=node:node /app /app
ENV HOME=/home/node

# Numeric, not `USER node`. Kubernetes `runAsNonRoot: true` makes the kubelet
# verify the user is not root *before* starting the container, and it can only
# do that from a numeric UID — a name it cannot resolve. `USER node` produces:
#   container has runAsNonRoot and image has non-numeric user (node),
#   cannot verify user is non-root
# and the pod never starts (Init:CreateContainerConfigError). 1000:1000 is the
# `node` user the base image ships.
USER 1000:1000

WORKDIR /app/apps/api
EXPOSE 3001

# Migrate on boot so a fresh volume comes up with PostGIS enabled and the
# schema in place, rather than failing on the first spatial query.
#
# The migration is RETRIED, and that is load-bearing rather than defensive.
# The postgis image restarts its server partway through first-run init — initdb
# brings up a bootstrap instance, the extension scripts run against it, then the
# real server starts. `pg_isready` answers yes during that window, so "wait for
# the database, then migrate" is not enough: the connection is refused again a
# moment later, `migrate deploy` exits non-zero, and `&&` kills the container.
# That is a one-shot failure on a cold volume — exactly `docker compose up` on a
# new machine, and it is what turned CI red rather than any application change.
#
# Same shape as the Helm chart's migrate initContainer, deliberately: `migrate
# deploy` is idempotent, so retrying it is both the wait and the work, and no
# separate readiness probe is needed (pg_isready is not in this image — it ships
# Prisma, not the Postgres client tools). /bin/sh here is dash, so this stays
# POSIX: no bashisms.
#
# The Helm chart still overrides this entirely: on Kubernetes the migration runs
# in an initContainer instead, because with more than one replica every pod
# would otherwise race to apply the same migration on every rollout.
CMD ["sh", "-c", "attempt=1; until pnpm exec prisma migrate deploy; do if [ \"$attempt\" -ge 30 ]; then echo \"database unreachable or migration failing after $attempt attempts; giving up\"; exit 1; fi; echo \"migrate attempt $attempt failed; database may still be starting - retrying in 2s\"; attempt=$((attempt + 1)); sleep 2; done; exec node dist/apps/api/src/main.js"]
