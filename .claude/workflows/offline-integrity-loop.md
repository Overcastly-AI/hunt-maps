# Workflow: offline-integrity-loop

Continuously prove the no-signal path still works.

## Why this is a standing loop

Offline support rots. It rots because every new feature is developed online,
tested online, and reviewed online, and nothing in that process notices when a
fetch quietly became load-bearing. By the time a user finds out, they are in the
woods and it is too late to do anything about it.

So this runs continuously and independently of feature work.

## Before each pass: which artifact is this actually testing?

A dev server is not the offline path a user gets. The DEM build arg
(`454c8f2`) and the shell's cache headers, in both the image's nginx config
and the Helm chart's separate copy of it (`bc95b24`, `891c16f`), all only take
their production shape inside a built container — a dev server's env is
simply unset and every fallback fires. **Periodically — not every pass, but
at least once per standing cycle — run step 1 against a `docker build`ed image
with production build args**, or against `deploy/verify-served-artifact.sh`,
rather than only against the dev server. A cold-start-offline pass that always
runs on `pnpm dev` will always be green regardless of what the shipped image
does.

## Each pass

1. **Cold start, fully offline.** Clear memory, go offline, load the app from
   nothing. It must boot, render a saved region, compute analysis layers for an
   arbitrary wind and date, and accept a new observation. This is the whole
   product; if it fails, everything else is secondary.
2. **Audit for new network dependencies.** Diff since the last pass: did any
   code path start requiring a fetch? Grep for `fetch(`, `axios`, and query
   hooks without an offline fallback.
3. **Storage pressure.** Fill the quota. Confirm failures are visible and
   actionable, and that the app remains usable.
4. **Eviction.** Simulate losing the tile store. Confirm the UI reports it
   rather than showing a blank map with no explanation.
5. **Sync conflict.** Edit the same entity on two clients, one offline.
   Reconnect. Confirm a conflict is surfaced and nothing is silently lost.
6. **Queue replay.** Interrupt a replay mid-flight. Confirm records land exactly
   once (`clientId` idempotency).
7. **Region download resume.** Kill a download at ~50%. Confirm it resumes
   rather than restarting.

Findings go to `docs/QA-FIELD.md` with severity graded from the hunter's
perspective: anything that leaves someone without a map in the field is
critical, regardless of how small the code fix turns out to be.
