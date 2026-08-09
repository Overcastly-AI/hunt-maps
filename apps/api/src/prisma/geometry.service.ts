import { Injectable } from '@nestjs/common';
import type { GeoGeometry, GeoPoint, GeoPolygon, BoundingBox } from '@hunt-maps/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

/**
 * The single place raw PostGIS SQL is allowed to live.
 *
 * Prisma cannot model geometry columns, so every spatial read and write goes
 * through `$queryRaw`. Concentrating that here means:
 *
 *  - **injection surface is one file**, and every value crosses into SQL as a
 *    parameter via tagged templates, never string concatenation. Geometry
 *    arrives as user-supplied GeoJSON, so this is not theoretical.
 *  - geometry validity is enforced in one place. `ST_GeomFromGeoJSON` will
 *    happily accept a self-intersecting polygon that then makes every
 *    downstream `ST_Intersects` throw; we run `ST_MakeValid` on ingest.
 *  - SRID discipline is enforced. Mixing 4326 (degrees) and a projected SRID
 *    silently produces areas in the wrong units, and "your property is 4.2
 *    hectares" vs "4.2 square degrees" is not a subtle bug.
 */
@Injectable()
export class GeometryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Convert GeoJSON to a validated PostGIS geometry expression.
   *
   * Always paired with `ST_MakeValid` — a hand-drawn property boundary from a
   * touchscreen very often self-intersects, and rejecting it outright would be
   * hostile when the fix is deterministic.
   */
  geomFromGeoJson(geometry: GeoGeometry): Prisma.Sql {
    return Prisma.sql`ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(
      geometry,
    )}::text), 4326))`;
  }

  /** Force a polygonal geometry to MultiPolygon, which the columns declare. */
  multiPolygonFromGeoJson(geometry: GeoGeometry): Prisma.Sql {
    return Prisma.sql`ST_Multi(${this.geomFromGeoJson(geometry)})`;
  }

  bboxToPolygon(bbox: BoundingBox): Prisma.Sql {
    return Prisma.sql`ST_MakeEnvelope(${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}, 4326)`;
  }

  /**
   * Area in hectares.
   *
   * Cast to `geography` so PostGIS computes on the spheroid. Computing
   * `ST_Area` directly on a 4326 geometry returns square degrees, which is
   * meaningless and varies by latitude — a mistake that silently makes every
   * "available area" denominator in the selection analytics wrong.
   */
  async areaHectares(geometry: GeoGeometry): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ ha: number }>>`
      SELECT ST_Area(${this.geomFromGeoJson(geometry)}::geography) / 10000.0 AS ha
    `;
    return Number(rows[0]?.ha ?? 0);
  }

  async centroid(geometry: GeoGeometry): Promise<{ lng: number; lat: number }> {
    const rows = await this.prisma.$queryRaw<Array<{ lng: number; lat: number }>>`
      SELECT ST_X(c) AS lng, ST_Y(c) AS lat
      FROM (SELECT ST_Centroid(${this.geomFromGeoJson(geometry)}) AS c) s
    `;
    return { lng: Number(rows[0]?.lng ?? 0), lat: Number(rows[0]?.lat ?? 0) };
  }

  async boundsOf(geometry: GeoGeometry): Promise<BoundingBox> {
    const rows = await this.prisma.$queryRaw<
      Array<{ west: number; south: number; east: number; north: number }>
    >`
      SELECT ST_XMin(g) AS west, ST_YMin(g) AS south, ST_XMax(g) AS east, ST_YMax(g) AS north
      FROM (SELECT ${this.geomFromGeoJson(geometry)} AS g) s
    `;
    const r = rows[0];
    return {
      west: Number(r?.west ?? 0),
      south: Number(r?.south ?? 0),
      east: Number(r?.east ?? 0),
      north: Number(r?.north ?? 0),
    };
  }

  /**
   * Rasterise a polygonal boundary into a cell mask over an already-built
   * raster grid — the fix for `R70`/audit `F5`: `boundsOf` returns an
   * envelope, and an availability distribution computed over the envelope of
   * an irregular parcel (an L, a riverfront strip, anything split by a road)
   * counts ground the hunter does not own.
   *
   * Deliberately **not** a PostGIS round trip. This runs once per property
   * over a whole-property mosaic that can be a million-plus cells; a
   * per-cell `ST_Contains` would be a per-cell network round trip on top of
   * an already-expensive raster pass. A boundary has at most a few hundred
   * vertices, so a classic even-odd scanline fill — built once here, in
   * pixel space, from vertices already resolved to grid coordinates by the
   * caller — is O(cells + vertices) and pays for itself immediately. Rings
   * after the first (holes) fall out of the even-odd rule for free: crossing
   * a hole's boundary flips inside/outside exactly like crossing the
   * exterior ring, so no special-casing is needed to subtract them.
   *
   * `Property.boundary` is stored `geometry(MultiPolygon, 4326)` (`ST_Multi`
   * on every write — see `multiPolygonFromGeoJson`), so `ST_AsGeoJSON`
   * always hands `readGeoJson` back a `MultiPolygon`, not the `Polygon` the
   * `GeoGeometry` union claims. That union predates the `MultiPolygon`
   * columns and is a pre-existing gap in `packages/shared`, out of scope
   * here — this method reads `.type` off the raw value rather than trusting
   * the narrowed TS type, so it is correct for what the database actually
   * returns.
   */
  rasterizeMask(
    geometry: GeoGeometry,
    toPixel: (lng: number, lat: number) => { x: number; y: number },
    width: number,
    height: number,
  ): Uint8Array {
    const mask = new Uint8Array(width * height);
    const raw = geometry as unknown as { type: string; coordinates: unknown };

    let polygons: Array<Array<Array<[number, number]>>>;
    if (raw.type === 'MultiPolygon') {
      polygons = raw.coordinates as Array<Array<Array<[number, number]>>>;
    } else if (raw.type === 'Polygon') {
      polygons = [raw.coordinates as Array<Array<[number, number]>>];
    } else {
      throw new Error(`rasterizeMask needs a Polygon or MultiPolygon boundary, got "${raw.type}".`);
    }

    for (const rings of polygons) {
      fillPolygonEvenOdd(rings, toPixel, mask, width, height);
    }
    return mask;
  }

  /**
   * Reject geometry that is outside any plausible hunting property.
   *
   * A finger-slip on a mobile map can produce a "property" spanning a
   * continent, which would then drive an offline region download of several
   * hundred gigabytes and a terrain profile job that never finishes. Failing
   * fast at the boundary is much kinder than failing at 3am in a worker.
   */
  async validateExtent(
    geometry: GeoGeometry,
    maxHectares = 200_000,
  ): Promise<{ ok: true; areaHectares: number } | { ok: false; reason: string }> {
    const bounds = await this.boundsOf(geometry);
    if (
      bounds.west < -180 ||
      bounds.east > 180 ||
      bounds.south < -90 ||
      bounds.north > 90 ||
      !Number.isFinite(bounds.west)
    ) {
      return { ok: false, reason: 'Coordinates fall outside the valid WGS84 range.' };
    }
    const areaHectares = await this.areaHectares(geometry);
    if (areaHectares > maxHectares) {
      return {
        ok: false,
        reason:
          `Area is ${Math.round(areaHectares).toLocaleString()} ha, above the ` +
          `${maxHectares.toLocaleString()} ha limit. Split it into separate properties.`,
      };
    }
    return { ok: true, areaHectares };
  }

  /** Read a geometry column back as GeoJSON. */
  async readGeoJson(table: string, column: string, id: string): Promise<GeoGeometry | null> {
    // Identifiers cannot be parameters, so they are whitelisted rather than
    // interpolated from caller input.
    if (!ALLOWED_GEOMETRY_COLUMNS.has(`${table}.${column}`)) {
      throw new Error(`Refusing to read unlisted geometry column ${table}.${column}`);
    }
    const rows = await this.prisma.$queryRawUnsafe<Array<{ g: string | null }>>(
      `SELECT ST_AsGeoJSON("${column}") AS g FROM "${table}" WHERE id = $1`,
      id,
    );
    const g = rows[0]?.g;
    return g ? (JSON.parse(g) as GeoGeometry) : null;
  }

  /** Points inside a polygon — the base query for "observations in this filter". */
  async pointsWithin(
    table: 'Observation' | 'Waypoint',
    propertyId: string,
    polygon: GeoGeometry,
  ): Promise<string[]> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "${table}"
       WHERE "propertyId" = $1
         AND ST_Intersects(location, ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($2::text), 4326)))`,
      propertyId,
      JSON.stringify(polygon),
    );
    return rows.map((r) => r.id);
  }

  /**
   * Build a scent-plume cone downwind of a point.
   *
   * Modelled as a widening wedge rather than a straight line because scent
   * disperses laterally as it travels — a hunter 300 m upwind of a bedding area
   * is not safe just because the bed is not exactly on the wind bearing. The
   * default 25° half-angle is conservative; light and variable wind justifies
   * widening it.
   */
  scentCone(origin: GeoPoint, bearingDeg: number, lengthM: number, halfAngleDeg = 25): GeoPolygon {
    const [lng, lat] = origin.coordinates;
    const ring: Array<[number, number]> = [[lng, lat]];
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const a = bearingDeg - halfAngleDeg + (2 * halfAngleDeg * i) / steps;
      ring.push(offset(lng, lat, a, lengthM));
    }
    ring.push([lng, lat]);
    return { type: 'Polygon', coordinates: [ring] };
  }
}

/** Whitelist for identifier interpolation in `readGeoJson`. */
const ALLOWED_GEOMETRY_COLUMNS = new Set([
  'Property.boundary',
  'Property.centroid',
  'Waypoint.location',
  'Observation.location',
  'Track.path',
  'SavedFilter.matchedArea',
  'Corridor.band',
  'Corridor.centerlines',
  'Corridor.pinchPoints',
  'Corridor.sourceArea',
  'Corridor.targetArea',
  'OfflineRegion.bounds',
]);

/**
 * Even-odd scanline fill of one polygon (exterior ring + optional hole
 * rings) into `mask`, in pixel space.
 *
 * Cells are tested by their centre (`x + 0.5`, `y + 0.5`) against the
 * intersections of each scanline with every ring edge, which is the
 * standard polygon-rasterisation approach — see `rasterizeMask` for why this
 * runs once in pure JS rather than as SQL.
 */
function fillPolygonEvenOdd(
  rings: Array<Array<[number, number]>>,
  toPixel: (lng: number, lat: number) => { x: number; y: number },
  mask: Uint8Array,
  width: number,
  height: number,
): void {
  const edges: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  for (const ring of rings) {
    const px = ring.map(([lng, lat]) => toPixel(lng, lat));
    for (let i = 0; i < px.length; i++) {
      const a = px[i];
      const b = px[(i + 1) % px.length];
      if (a.y === b.y) continue; // horizontal edges never cross a scanline
      edges.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y });
    }
  }
  if (edges.length === 0) return;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const e of edges) {
    minY = Math.min(minY, e.y0, e.y1);
    maxY = Math.max(maxY, e.y0, e.y1);
  }
  const yFrom = Math.max(0, Math.floor(minY));
  const yTo = Math.min(height - 1, Math.ceil(maxY));

  const xs: number[] = [];
  for (let y = yFrom; y <= yTo; y++) {
    const scanY = y + 0.5;
    xs.length = 0;
    // Half-open per edge ([y0, y1) in traversal direction) so a vertex
    // shared by two edges is counted exactly once, not zero or twice.
    for (const e of edges) {
      const crosses = (e.y0 <= scanY && e.y1 > scanY) || (e.y1 <= scanY && e.y0 > scanY);
      if (!crosses) continue;
      const t = (scanY - e.y0) / (e.y1 - e.y0);
      xs.push(e.x0 + t * (e.x1 - e.x0));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xFrom = Math.max(0, Math.ceil(xs[i] - 0.5));
      const xTo = Math.min(width - 1, Math.floor(xs[i + 1] - 0.5));
      for (let x = xFrom; x <= xTo; x++) mask[y * width + x] = 1;
    }
  }
}

/** Move a lng/lat by `distanceM` along `bearingDeg`, on a spherical earth. */
function offset(lng: number, lat: number, bearingDeg: number, distanceM: number): [number, number] {
  const R = 6378137;
  const br = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const dr = distanceM / R;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(br),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(br) * Math.sin(dr) * Math.cos(lat1),
      Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}
