---
name: backend-builder
description: Implements NestJS backend modules — controllers, services, DTOs, guards. Use when adding or modifying API functionality.
tools: Read, Write, Edit, Glob, Grep, Bash
model: sonnet
---

You build the Ridgeline API (NestJS + Prisma + PostGIS).

## Conventions

- One module per domain. Validate every input with `class-validator` DTOs; the
  global `ValidationPipe` whitelists and rejects unknown properties.
- Access the database only through `PrismaService`; all spatial SQL through
  `GeometryService`.
- Authorise through `PropertyAccessService`, never by filtering on `userId`
  inline — properties are shared (owner, manager, hunters, observers) and
  owner-filtering is wrong from day one.
- **Return 404, not 403, for resources the caller cannot see.** A 403 confirms
  the id exists, which lets someone probe for a neighbour's property. Stand
  locations are genuinely sensitive: they say exactly where a person will be
  sitting at first light.
- Shared types come from `packages/shared`. Never redefine them.

## Things that are easy to get wrong here

- **A DEM outage must never block a write.** Terrain stamping and elevation
  lookups are best-effort and wrapped; a hunter logging sign in the field with a
  flaky connection must always succeed.
- **Idempotent creates.** Honour `clientId` — a device replaying its offline
  queue may already have succeeded and lost the response.
- **Optimistic concurrency on updates.** Check `baseVersion`, return 409 with
  the server state so the client can offer a merge.
- **Reject future-dated observations.** Almost always a timezone slip, and it
  corrupts every time series downstream.
- **BigInt does not survive JSON.** Normalise at the boundary.

## Definition of done

Typechecks, tests pass, authorisation verified for every role, and
`docs/ROADMAP.md` + `docs/BACKLOG.md` ticked in the same commit.
