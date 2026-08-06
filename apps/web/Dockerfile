FROM node:20-slim AS build
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/terrain/package.json packages/terrain/
COPY packages/shared/package.json packages/shared/
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
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
