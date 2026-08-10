/**
 * Make a published release actually reach an already-open tab.
 *
 * `vite.config.ts` registers the service worker with `registerType:
 * 'autoUpdate'`, and the generated worker calls `skipWaiting()` +
 * `clientsClaim()`. That combination installs and activates a new worker
 * without asking — but activation does not touch the *document* that is
 * already on screen. The running page keeps the HTML and the hashed bundles it
 * booted with, so the user goes on looking at the previous build until they
 * happen to close every tab (or, on an installed PWA, until the OS evicts the
 * app entirely — which can be days).
 *
 * That is the second half of the "deployed the new version and the UI did not
 * update" failure; the first half is HTTP caching of `index.html`, fixed in
 * `nginx.conf`. Both have to be right: no-cache alone still leaves an open tab
 * stale, and this alone still lets the browser hand the worker a cached shell.
 *
 * The tradeoff, stated plainly: this reloads the page out from under the user.
 * For a map you are reading in the field that is genuinely disruptive, so it is
 * deliberately narrow — it fires only when a worker *replaces an existing one*,
 * which happens only after a real deploy, and only once. It cannot fire on
 * first install, and it cannot fire offline, because no new worker is fetched
 * without a network. Queued writes are safe across it: the offline queue lives
 * in IndexedDB (`lib/api/offlineQueue.ts`), not in React state.
 */

let reloading = false;

export function initServiceWorkerUpdates(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  // Snapshot *now*, before any `controllerchange` can fire. A first-ever
  // install also triggers that event — `clientsClaim()` takes control of a page
  // that loaded before the worker existed — and reloading there would bounce
  // every genuinely new visitor for no reason. Only a transition from one
  // controller to another means the build on screen is out of date.
  const hadController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
}
