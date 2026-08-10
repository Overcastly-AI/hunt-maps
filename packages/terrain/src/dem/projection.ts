/**
 * The two map projections a 3DEP reader has to speak, and nothing else.
 *
 * ## Why this exists
 *
 * The engine works in Web Mercator tiles and lng/lat. USGS 3DEP does not:
 *
 *  - the **1/3 arc-second** product is geographic, EPSG:4269 (NAD83), degrees;
 *  - every **1 m LiDAR** product is projected, EPSG:269xx (NAD83 / UTM zone
 *    xxN), metres — and the *file name itself* encodes the UTM zone and the
 *    10 km cell, so you cannot even work out which file to fetch without a
 *    forward UTM projection.
 *
 * A projection library would be the obvious answer and is not available to us:
 * `packages/terrain` ships into a service worker with zero runtime
 * dependencies. Transverse Mercator is, fortunately, a closed-form series.
 *
 * ## Accuracy, stated rather than assumed
 *
 * This is the standard Krüger/USGS eighth-order series (Snyder, *Map
 * Projections — A Working Manual*, USGS PP 1395, eqs. 8-9 to 8-25), which is
 * accurate to well under a millimetre anywhere inside a UTM zone plus the usual
 * overlap. Round-tripping lng/lat -> UTM -> lng/lat is pinned in the tests to
 * 1e-7 degrees (about 1 cm). That is three orders of magnitude finer than the
 * 1 m pixels it is used to address, so projection error can never be the reason
 * a bench lands in the wrong place.
 *
 * ## NAD83 vs WGS84 — deliberately *not* converted
 *
 * 3DEP is NAD83; the map, GPS and every other source here are WGS84. The two
 * datums differ by **1–2 m horizontally** in CONUS (they were identical at
 * definition in 1986 and have drifted with the plate). A full datum transform
 * (HTDP / NADCON5) is a gridded model far larger than this package, and the
 * residual is a fifth of a 1 m pixel and a tenth of a 1/3-arc-second one.
 *
 * So we treat the two as equivalent **horizontally** and say so here. That is a
 * different judgement from the *vertical* datum question, which is 20–35 m and
 * is emphatically not ignorable — see `verticalDatum.ts`.
 */

/** GRS80 / WGS84 semi-major axis, metres. The two agree to 0.1 mm. */
const A = 6378137.0;
/** GRS80 flattening. WGS84's differs in the 11th significant figure. */
const F = 1 / 298.257222101;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
/** UTM's scale factor on the central meridian. */
const K0 = 0.9996;
const FALSE_EASTING = 500000;
const FALSE_NORTHING = 10000000; // southern hemisphere only

const DEG = Math.PI / 180;

/** The UTM zone a longitude falls in (1–60). Norway/Svalbard exceptions are not
 * applied: no 3DEP product is anywhere near them, and applying them would make
 * the *file name* wrong for a US tile if the rule were ever mis-scoped. */
export function utmZoneForLongitude(lng: number): number {
  const wrapped = (((lng + 180) % 360) + 360) % 360;
  return Math.min(60, Math.floor(wrapped / 6) + 1);
}

/** Central meridian of a UTM zone, in degrees. */
export function utmCentralMeridian(zone: number): number {
  return (zone - 1) * 6 - 180 + 3;
}

/**
 * EPSG code for a NAD83 UTM zone, north or south.
 *
 * 26901–26923 is NAD83 / UTM 1N–23N — the range every CONUS, Alaska and Hawaii
 * 3DEP product uses. Returned so a decoded GeoTIFF's `ProjectedCSTypeGeoKey`
 * can be *checked* against the zone we think we asked for rather than assumed;
 * a zone mismatch would place a 1 m tile hundreds of kilometres away while
 * every value in it still looked like plausible ground.
 */
export function nad83UtmEpsg(zone: number): number {
  return 26900 + zone;
}

/** Inverse of {@link nad83UtmEpsg}; `undefined` if the code is not NAD83 UTM N. */
export function utmZoneFromEpsg(epsg: number): number | undefined {
  if (epsg >= 26901 && epsg <= 26923) return epsg - 26900;
  // WGS84 / UTM north (326xx) shows up in a few contributed projects.
  if (epsg >= 32601 && epsg <= 32660) return epsg - 32600;
  return undefined;
}

export interface UtmCoord {
  zone: number;
  /** Metres east of the zone's false origin. */
  easting: number;
  /** Metres north of the equator (northern hemisphere). */
  northing: number;
  north: boolean;
}

/**
 * Geographic -> UTM. `zone` defaults to the natural zone for `lng`.
 *
 * Passing an explicit `zone` is the normal case when reading 1 m products: a
 * project near a zone boundary is published wholly in *one* zone, and points on
 * the far side of the boundary are represented as extended coordinates in that
 * zone rather than reprojected. Forcing the file's zone is what makes the tile
 * lookup agree with the file that actually exists.
 */
export function lngLatToUtm(lng: number, lat: number, zone?: number): UtmCoord {
  const z = zone ?? utmZoneForLongitude(lng);
  const lambda0 = utmCentralMeridian(z) * DEG;
  const phi = lat * DEG;
  let dLambda = lng * DEG - lambda0;
  // Keep the longitude difference in (-pi, pi] so a zone forced across the
  // antimeridian does not blow the series up.
  while (dLambda > Math.PI) dLambda -= 2 * Math.PI;
  while (dLambda < -Math.PI) dLambda += 2 * Math.PI;

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);

  const N = A / Math.sqrt(1 - E2 * sinPhi * sinPhi);
  const T = tanPhi * tanPhi;
  const C = EP2 * cosPhi * cosPhi;
  const Aa = dLambda * cosPhi;

  // Meridional arc length from the equator.
  const M =
    A *
    ((1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 * E2 * E2) / 256) * phi -
      ((3 * E2) / 8 + (3 * E2 * E2) / 32 + (45 * E2 * E2 * E2) / 1024) * Math.sin(2 * phi) +
      ((15 * E2 * E2) / 256 + (45 * E2 * E2 * E2) / 1024) * Math.sin(4 * phi) -
      ((35 * E2 * E2 * E2) / 3072) * Math.sin(6 * phi));

  const A2 = Aa * Aa;
  const easting =
    K0 *
      N *
      (Aa +
        ((1 - T + C) * A2 * Aa) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * A2 * A2 * Aa) / 120) +
    FALSE_EASTING;

  let northing =
    K0 *
    (M +
      N *
        tanPhi *
        (A2 / 2 +
          ((5 - T + 9 * C + 4 * C * C) * A2 * A2) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * A2 * A2 * A2) / 720));

  const north = lat >= 0;
  if (!north) northing += FALSE_NORTHING;

  return { zone: z, easting, northing, north };
}

/** UTM -> geographic. Exact inverse of {@link lngLatToUtm}. */
export function utmToLngLat(coord: UtmCoord): { lng: number; lat: number } {
  const { zone, easting, north } = coord;
  const northing = north ? coord.northing : coord.northing - FALSE_NORTHING;
  const x = easting - FALSE_EASTING;

  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const M = northing / K0;
  const mu = M / (A * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 * E2 * E2) / 256));

  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 * e1 * e1) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 * e1 * e1 * e1) / 32) * Math.sin(4 * mu) +
    ((151 * e1 * e1 * e1) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 * e1 * e1 * e1) / 512) * Math.sin(8 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);

  const C1 = EP2 * cosPhi1 * cosPhi1;
  const T1 = tanPhi1 * tanPhi1;
  const N1 = A / Math.sqrt(1 - E2 * sinPhi1 * sinPhi1);
  const R1 = (A * (1 - E2)) / Math.pow(1 - E2 * sinPhi1 * sinPhi1, 1.5);
  const D = x / (N1 * K0);
  const D2 = D * D;

  const lat =
    phi1 -
    ((N1 * tanPhi1) / R1) *
      (D2 / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D2 * D2) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D2 * D2 * D2) / 720);

  const lng =
    utmCentralMeridian(zone) * DEG +
    (D -
      ((1 + 2 * T1 + C1) * D2 * D) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D2 * D2 * D) / 120) /
      cosPhi1;

  return { lng: lng / DEG, lat: lat / DEG };
}
