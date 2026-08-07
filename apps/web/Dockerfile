FROM node:20-slim AS build
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
# Every workspace package apps/web depends on must have its package.json here
# *before* `pnpm install`, or the install fails resolving `workspace:*` and the
# image cannot build at all. `@hunt-maps/design` was missing from this list
# from the moment the design system was extracted into its own package, so the
# web image had not built since — including under `docker compose up --build`.
# Adding a workspace dependency means adding a line here.
COPY packages/terrain/package.json packages/terrain/
COPY packages/shared/package.json packages/shared/
COPY packages/design/package.json packages/design/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile=false
COPY packages/ packages/
COPY apps/web/ apps/web/

# The elevation source is inlined into the bundle here, at build time — Vite
# resolves `import.meta.env.VITE_DEM_TEMPLATE` during the build, so the running
# container never reads it. That means it cannot be set by an env var in
# docker-compose, or by a Helm value: pointing a deployment at a different DEM
# host requires a rebuilt image. Left unset, apps/web/src/App.tsx falls back to
# the public AWS Terrarium tiles.
ARG VITE_DEM_TEMPLATE=""
ENV VITE_DEM_TEMPLATE=$VITE_DEM_TEMPLATE
RUN pnpm --filter @hunt-maps/web build

FROM nginx:alpine AS runtime
# OCI metadata. `org.opencontainers.image.source` is what makes GitHub link a
# published package back to this repository — without it the package page has
# no repo, no README and no visible provenance, which is the difference between
# a registry entry someone can trust and an anonymous blob.
LABEL org.opencontainers.image.source="https://github.com/Overcastly-AI/hunt-maps" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.title="Ridgeline web" \
      org.opencontainers.image.description="MapLibre PWA and on-device terrain analysis worker"

COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
