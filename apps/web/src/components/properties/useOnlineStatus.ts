import { useEffect, useState } from 'react';

/**
 * `navigator.onLine`, kept live.
 *
 * Property creation and boundary edits are the one write in this app that is
 * **not** offline-queued (`lib/api/properties.ts`'s own doc comment explains
 * why: a boundary edit also invalidates the property's cached
 * `TerrainProfile` server-side, which is a heavier, more consequential
 * operation than logging a stand). So the screens that draw a boundary need
 * to know connectivity *before* the user spends minutes placing points, not
 * find out only when the save request fails — "losing a region the user
 * waited twenty minutes for" is `CLAUDE.md`'s worst-failure example, and
 * losing a hand-drawn boundary the same way is the same failure with a
 * different noun.
 *
 * `navigator.onLine` is a coarse, sometimes-optimistic signal (a captive
 * portal can report "online" with no real route to this app's API), but it
 * is the only *pre-emptive* signal available with no network round trip, and
 * pre-emptive is exactly what "say so before they draw" needs — an
 * `apiFetch` failure remains the authoritative check at save time regardless
 * of what this hook reports.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return online;
}
