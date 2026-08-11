/**
 * The one call site for "reload the whole app now."
 *
 * Exists as an indirection for one reason: `window.location.reload` is a
 * non-configurable own property in jsdom (`Object.getOwnPropertyDescriptor`
 * reports `configurable: false`), so a unit test cannot `vi.spyOn` or
 * redefine it directly — attempting to throws `TypeError: Cannot redefine
 * property: reload`. Routing every real call through this module lets a test
 * intercept the *decision* to reload (`vi.mock('../lib/reloadApp', ...)`)
 * without fighting jsdom's DOM shape, and it keeps `window.location.reload`
 * itself appearing exactly once in the whole app.
 */
export function reloadApp(): void {
  window.location.reload();
}
