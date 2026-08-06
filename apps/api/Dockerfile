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
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 3001
# Migrate on boot so a fresh volume comes up with PostGIS enabled and the
# schema in place, rather than failing on the first spatial query.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
