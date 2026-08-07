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
USER node

WORKDIR /app/apps/api
EXPOSE 3001

# Migrate on boot so a fresh volume comes up with PostGIS enabled and the
# schema in place, rather than failing on the first spatial query.
#
# The Helm chart overrides this: on Kubernetes the migration runs as a
# pre-upgrade hook Job instead, because with more than one replica every pod
# would otherwise race to apply the same migration on every rollout.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
