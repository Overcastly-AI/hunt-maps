/**
 * "Here" — the default location for a new waypoint (`R3`) or observation
 * (`R5`), per CLAUDE.md's "default everything that can be defaulted": a
 * hunter marking a stand at first light should not have to type coordinates.
 *
 * Preference order, each one only used if the one before it is unavailable:
 *
 *  1. **Live GPS** (`navigator.geolocation`) — genuinely "here", right now.
 *  2. **`fallback`** — a location the caller already has some other way (the
 *     map's current centre, or a point the user tapped to drop a pin). Used
 *     immediately while the GPS request is still in flight, and kept if GPS
 *     is denied, times out, or the browser has no geolocation at all (a
 *     desktop dev box, an embedded webview with the permission stripped).
 *  3. **Manual entry.** If neither of the above ever resolves, the caller
 *     sees `source: 'none'` and must render its own lat/lng inputs — CLAUDE.md
 *     is explicit that a control with no honest default says so rather than
 *     rendering one, and silently opening a form for a waypoint at
 *     `(0, 0)` would be exactly that.
 */

import { useEffect, useRef, useState } from 'react';

export interface HereLocation {
  lng: number;
  lat: number;
}

export interface HereLocationState {
  location: HereLocation | null;
  source: 'gps' | 'fallback' | 'none';
  /** True while a GPS fix is still being requested — used to show "Finding you…" rather than a premature "none". */
  locating: boolean;
}

const GPS_TIMEOUT_MS = 8000;

export function useHereLocation(fallback: HereLocation | null | undefined): HereLocationState {
  const [gps, setGps] = useState<HereLocation | null>(null);
  const [locating, setLocating] = useState(true);
  // Re-request once per mount only — a form open for minutes should not keep
  // silently sliding the pin under the user as GPS drifts.
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocating(false);
      return;
    }

    const id = navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lng: pos.coords.longitude, lat: pos.coords.latitude });
        setLocating(false);
      },
      () => {
        // Denied, unavailable, or timed out — `fallback` (or manual entry)
        // takes over below. Not an error state: plenty of hunters keep
        // location services off entirely.
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS, maximumAge: 60_000 },
    );
    return () => {
      // `getCurrentPosition` has no direct cancel; `clearWatch` is a no-op on
      // its id but costs nothing and documents the intent if this is ever
      // switched to `watchPosition`.
      if (typeof id === 'number') navigator.geolocation.clearWatch(id);
    };
  }, []);

  if (gps) return { location: gps, source: 'gps', locating: false };
  if (fallback) return { location: fallback, source: 'fallback', locating };
  return { location: null, source: 'none', locating };
}
