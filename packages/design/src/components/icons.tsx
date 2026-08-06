/**
 * Inline icon set.
 *
 * Hand-drawn on a 24-unit grid rather than pulled from an icon library, for two
 * reasons: the design package stays dependency-free (it is imported by an app
 * that must boot with no network), and map tools need icons that read at a
 * glance in the dark — heavier strokes and simpler silhouettes than a general
 * UI set gives you.
 *
 * All icons inherit `currentColor` and use a 1.75 stroke, which holds up at the
 * 20px the control rail renders them at.
 */

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Stacked map layers. */
export const LayersIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" />
    <path d="m3 12.5 9 4.5 9-4.5" />
    <path d="m3 17 9 4.5 9-4.5" />
  </Icon>
);

/** Crosshair / locate me. */
export const LocateIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="6.5" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <path d="M12 1.5v3M12 19.5v3M22.5 12h-3M4.5 12h-3" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const MinusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

/**
 * Contour lines — the app mark.
 *
 * Not used in the map chrome: a map app does not need to tell you which app you
 * opened, and that corner is better spent on map. Kept here because it is the
 * mark for the favicon, the PWA install icon and the install prompt, which are
 * the places identity genuinely belongs.
 */
export const ContourIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 17c3.2-4.4 6-6.6 8.4-6.6 2.4 0 5 2.2 8.2 6.6" />
    <path d="M5 20.5c2.4-3 4.5-4.5 6.3-4.5 1.9 0 3.9 1.5 6.2 4.5" />
    <path d="M6.2 12.6C8.1 9.2 9.8 7.5 11.3 7.5c1.5 0 3 1.6 4.6 4.8" />
    <path d="M9.4 8.2c.9-2.5 1.7-3.7 2.4-3.7.7 0 1.4 1.1 2.1 3.4" />
  </Icon>
);

/** Download / save offline. */
export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5v11" />
    <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
    <path d="M4 17.5v1.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-1.5" />
  </Icon>
);

/** Waypoint / stand marker. */
export const PinIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 21.5s7-6.2 7-11.2a7 7 0 1 0-14 0c0 5 7 11.2 7 11.2Z" />
    <circle cx="12" cy="10" r="2.5" />
  </Icon>
);

/**
 * Wind needle.
 *
 * A pointer, not a number. Wind direction is spatial information and a hunter
 * reads it against the map, so the control shows a needle aligned to the map's
 * north — the same way they would read a compass in their hand. The tail is
 * heavier than the head so the direction is unambiguous at a glance in the dark.
 *
 * `fromDeg` is the direction the wind comes FROM, which is how forecasts state
 * it and how hunters talk. The needle points the way the wind is *going*.
 */
export function WindNeedle({
  fromDeg,
  ...rest
}: IconProps & { fromDeg: number | null }) {
  const rotation = fromDeg === null ? 0 : fromDeg + 180;
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      {...rest}
      style={{ transform: `rotate(${rotation}deg)`, ...rest.style }}
    >
      <circle
        cx="16"
        cy="16"
        r="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.28"
      />
      {/* Cardinal ticks, so the dial reads as an instrument. */}
      {[0, 90, 180, 270].map((a) => (
        <line
          key={a}
          x1="16"
          y1="3.5"
          x2="16"
          y2="6.5"
          stroke="currentColor"
          strokeWidth="1.25"
          opacity="0.45"
          transform={`rotate(${a} 16 16)`}
        />
      ))}
      {fromDeg === null ? (
        <circle cx="16" cy="16" r="2.4" fill="currentColor" opacity="0.55" />
      ) : (
        <>
          <path d="M16 6.5 20.5 21 16 18.2 11.5 21Z" fill="currentColor" />
          <circle cx="16" cy="16" r="1.6" fill="currentColor" opacity="0.5" />
        </>
      )}
    </svg>
  );
}
