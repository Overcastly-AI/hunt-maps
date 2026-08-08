import type { GeoPolygon } from '@hunt-maps/shared';
import { color } from '@hunt-maps/design';
import { polygonToRing } from '../../lib/map/boundaryDraw';

/**
 * A small, static shape preview for the property list and detail screens.
 *
 * Deliberately not a second live MapLibre instance: the list screen can show
 * one card per property, and instantiating a WebGL map (and fetching
 * satellite tiles) per row is expensive for a glance-only shape check, and
 * pointless offline — this needs no network and no elevation tiles, only the
 * boundary geometry already in hand from `useProperties()`/`useProperty()`.
 * The full interactive map lives in `BoundaryEditor`, reached from "Edit
 * boundary".
 *
 * Pure function of the geometry, so it renders correctly with `jsdom`
 * (`renderToStaticMarkup`) unlike anything that touches MapLibre.
 */
export function PropertyBoundaryPreview({
  boundary,
  size = 96,
}: {
  boundary: GeoPolygon | null;
  size?: number;
}) {
  if (!boundary) {
    return (
      <div
        className="property-preview property-preview--empty"
        style={{ width: size, height: size }}
        role="img"
        aria-label="No boundary drawn yet"
      >
        <span aria-hidden="true">—</span>
      </div>
    );
  }

  const ring = polygonToRing(boundary);
  if (ring.length < 3) {
    return (
      <div
        className="property-preview property-preview--empty"
        style={{ width: size, height: size }}
        role="img"
        aria-label="No boundary drawn yet"
      >
        <span aria-hidden="true">—</span>
      </div>
    );
  }

  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  const west = Math.min(...lngs);
  const east = Math.max(...lngs);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const spanLng = east - west || 1;
  const spanLat = north - south || 1;
  // Preserve aspect ratio rather than stretching to fill a square — a long,
  // narrow property (common along a ridge or a creek bottom) should read as
  // long and narrow here, not as a square that misrepresents its shape.
  const scale = Math.min(80 / spanLng, 80 / spanLat);
  const drawnW = spanLng * scale;
  const drawnH = spanLat * scale;
  const offsetX = (100 - drawnW) / 2;
  const offsetY = (100 - drawnH) / 2;

  const points = ring
    .map(([lng, lat]) => {
      const x = offsetX + (lng - west) * scale;
      // SVG y grows downward; latitude grows northward (upward on a map).
      const y = offsetY + (north - lat) * scale;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      className="property-preview"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Property boundary shape"
    >
      <polygon points={points} fill={color.accent} fillOpacity={0.22} stroke={color.accent} strokeWidth={2} />
    </svg>
  );
}
