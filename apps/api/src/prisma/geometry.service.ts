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
  async readGeoJson(
    table: string,
    column: string,
    id: string,
  ): Promise<GeoGeometry | null> {
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
  scentCone(
    origin: GeoPoint,
    bearingDeg: number,
    lengthM: number,
    halfAngleDeg = 25,
  ): GeoPolygon {
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

/** Move a lng/lat by `distanceM` along `bearingDeg`, on a spherical earth. */
function offset(
  lng: number,
  lat: number,
  bearingDeg: number,
  distanceM: number,
): [number, number] {
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
