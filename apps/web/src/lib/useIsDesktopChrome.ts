/**
 * Which chrome shell is on screen: the thin dense rail (desktop) or the
 * drawer/command-bar/conditions-bar stack (mobile, unchanged).
 *
 * A JS breakpoint rather than a pure CSS one on purpose. The two shells are
 * different *component trees* mounting different DOM (a compact chip list
 * with no description text vs. a scrolling `ToggleRow` sheet), not the same
 * markup re-flowed by a media query — `LayersSheet`'s full sentences have to
 * keep existing somewhere for `demSourceHonesty.test.ts`/`layers.test.ts`'s
 * guards to mean anything, and a single DOM tree hidden with `display: none`
 * under a breakpoint would mean shipping both, always, to every device. This
 * hook is `App.tsx`'s single source of truth for which tree to mount; the
 * pixel value must match `packages/design/src/tokens.ts`'s
 * `layout['breakpoint-compact']` (860px) exactly, or the two would disagree
 * about which shell is "desktop" at a width in between.
 */

import { useEffect, useState } from 'react';

const QUERY = '(min-width: 861px)';

function matches(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(QUERY).matches;
}

export function useIsDesktopChrome(): boolean {
  const [isDesktop, setIsDesktop] = useState(matches);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    onChange();
    // Safari < 14 only has the deprecated addListener/removeListener pair;
    // feature-detect rather than assuming addEventListener exists.
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange);
      else mql.removeListener(onChange);
    };
  }, []);

  return isDesktop;
}
