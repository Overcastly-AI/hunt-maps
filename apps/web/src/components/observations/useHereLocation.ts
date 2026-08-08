/**
 * "Here" — the default location for a new observation (`R5`), identical
 * contract to `components/waypoints/useHereLocation.ts` (see its doc comment
 * for the full reasoning). Duplicated rather than imported across the two
 * feature folders so each stays reviewable and shippable on its own — this is
 * ~25 lines with no state shared between the two call sites.
 */

import { useEffect, useRef, useState } from 'react';

export interface HereLocation {
  lng: number;
  lat: number;
}

export interface HereLocationState {
  location: HereLocation | null;
  source: 'gps' | 'fallback' | 'none';
  locating: boolean;
}

const GPS_TIMEOUT_MS = 8000;

export function useHereLocation(fallback: HereLocation | null | undefined): HereLocationState {
  const [gps, setGps] = useState<HereLocation | null>(null);
  const [locating, setLocating] = useState(true);
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
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS, maximumAge: 60_000 },
    );
    return () => {
      if (typeof id === 'number') navigator.geolocation.clearWatch(id);
    };
  }, []);

  if (gps) return { location: gps, source: 'gps', locating: false };
  if (fallback) return { location: fallback, source: 'fallback', locating };
  return { location: null, source: 'none', locating };
}
