/**
 * The one `QueryClient` for the app.
 *
 * ## Why these defaults — "reads must degrade, not fail"
 *
 * React Query already does most of the work CLAUDE.md's offline non-negotiable
 * asks for, as long as the defaults do not fight it:
 *
 *  - A query keeps serving its last successful `data` while a background
 *    refetch is in flight or failing — `isError`/`error` update independently
 *    of `data`. A screen that renders from `data` first and treats `error` as
 *    an annotation ("may be out of date") rather than a replacement for the
 *    content gets the "empty list vs. failed request are different states"
 *    behaviour CLAUDE.md asks for, for free. Screens built on `lib/api/`'s
 *    hooks should follow that pattern rather than an `if (error) return
 *    <ErrorPage />` that throws away a perfectly good cached map.
 *  - `networkMode: 'online'` (the library default, kept deliberately) pauses
 *    queries while `navigator.onLine` is false instead of erroring them, so a
 *    genuinely offline device shows "paused", not "failed".
 *  - `retry` below still distinguishes the two: `ApiError.kind === 'network'`
 *    (or `'server'`) gets a couple of quick retries, because a dropped
 *    connection is often transient. Anything `isTerminalApiError` — `auth`,
 *    `validation`, `not_found`, `forbidden`, `conflict` — never retries,
 *    because retrying an invalid request or an expired session cannot
 *    succeed and would just burn the user's battery and (offline) queue.
 *
 * `gcTime` is a full day, deliberately longer than the PWA's own
 * `NetworkFirst` HTTP cache (`vite.config.ts`, 30 days) is short: this is the
 * *in-memory* query cache, gone on a full reload, and the point is that a
 * property/waypoint list fetched this morning is still available to render
 * instantly this evening at camp with no signal, backed by whatever the HTTP
 * cache or IndexedDB persistence layer a future pass adds can rehydrate it
 * from.
 *
 * `refetchOnWindowFocus` is off: this is a field app used one screen at a
 * time on a single device, not a dashboard several tabs stay open against: a
 * hunter switching from this app to a camera and back should not spend their
 * signal re-fetching everything.
 */

import { QueryClient } from '@tanstack/react-query';
import { isTerminalApiError } from './client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 24 * 60 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (isTerminalApiError(error)) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      // A queued offline write (`clientId`-based create, `baseVersion`-based
      // update) has its own retry-on-reconnect semantics — see
      // `lib/api/offlineQueue.ts`. Letting React Query *also* retry blindly
      // on top would risk firing a non-idempotent request twice from two
      // different retry mechanisms at once.
      retry: false,

      // `'always'`, not the library default `'online'`, and this line is the
      // difference between a hunter's sighting existing and not.
      //
      // Under `'online'` React Query pauses a mutation *before* it invokes
      // `mutationFn` once `onlineManager` has seen an `offline` event. Every
      // write hook in `lib/api/` does its offline handling — generate a
      // `clientId`, attempt the request, classify the failure, persist to
      // `offlineQueue.ts` — *inside* `mutationFn`. So the pause meant the app's
      // entire offline write path was unreachable in the one scenario it
      // exists for: field QA logged a blank sit with no signal, watched the
      // button read "Saving…" forever, reloaded, and the record was gone from
      // the queue, the cache and the server alike.
      //
      // Pausing is the right default for an app whose only offline story is
      // "wait for the network". It is the wrong one for an app that has built
      // a durable queue, because it prevents that queue from ever being
      // reached. We take responsibility for the offline decision instead:
      // `isKnownOffline()` inside each `mutationFn`.
      //
      // Reads keep `networkMode: 'online'` (the default, see above) on
      // purpose — a paused *query* still renders its last good data, which is
      // the correct degradation. A paused *mutation* renders nothing and
      // remembers nothing.
      networkMode: 'always',
    },
  },
});
