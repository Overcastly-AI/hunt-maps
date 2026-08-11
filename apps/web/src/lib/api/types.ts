/**
 * Wire types for `lib/api/`.
 *
 * Derived from the actual Nest DTOs and Prisma models
 * (`apps/api/src/<feature>/<feature>.module.ts`, `apps/api/prisma/schema.prisma`)
 * rather than invented, and re-exporting `@hunt-maps/shared` wherever a
 * contract already lives there. Where it does not — most of this file — the
 * type is declared here with a comment pointing at the DTO it mirrors, so a
 * DTO change is a deliberate, greppable two-file diff instead of a silent
 * drift.
 *
 * ## A real contract mismatch, flagged rather than papered over
 *
 * `@hunt-maps/shared`'s domain enums (`WaypointType`, `ObservationKind`,
 * `AnimalSex`, `SignType`, `GameSpecies`) use lowercase snake_case values
 * (`'trail_camera'`). The Prisma enums of the same name
 * (`apps/api/prisma/schema.prisma`) use `SCREAMING_SNAKE_CASE`
 * (`'TRAIL_CAMERA'`), and every read path that touches these fields
 * (`WaypointsService`, `ObservationsService`) selects them with raw SQL —
 * `SELECT type, ...` — which returns the **Postgres enum label**, i.e. the
 * Prisma casing, unconverted. The create/update DTOs' `@IsEnum(...)`
 * decorators validate against the *Prisma* enum too. So for these five
 * fields, `@hunt-maps/shared`'s enum is not what the wire actually carries in
 * either direction — using it here would type-check against a value the
 * server will never send or accept. The `Wire*` unions below use the real
 * (Prisma) casing instead. This should be reconciled — either the API
 * normalises to the shared casing on the way in and out, or `@hunt-maps/shared`
 * adopts the Prisma casing — but that is a cross-cutting `schema-architect`/
 * `backend-builder` change outside this pass's territory (`lib/api/**` only);
 * see the handoff report.
 *
 * The same split applies to `rutPhase`: `PropertiesService` computes it with
 * `@hunt-maps/shared`'s `readRut()` and returns the shared (lowercase)
 * `RutPhase` directly — that one *does* match. `ObservationsService` instead
 * stores it as the Prisma enum via `RUT_PHASE_TO_PRISMA` and a raw
 * `SELECT *` returns it in Prisma casing. Both are correct wire types for
 * their own endpoint; they are simply not the same casing as each other.
 */

import type {
  BoundingBox,
  GeoLineString,
  GeoPoint,
  GeoPolygon,
  RutResult,
  SelectionAnalysisDto,
} from '@hunt-maps/shared';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** `AuthTokens`, `apps/api/src/auth/auth.service.ts`. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

/** `AuthController#me`'s Prisma `select`, `apps/api/src/auth/auth.controller.ts`. */
export interface AuthedUser {
  id: string;
  email: string;
  displayName: string;
  unitSystem: 'IMPERIAL' | 'METRIC';
  createdAt: string;
}

export interface RegisterInput {
  email: string;
  /** 12+ characters — see `RegisterDto`'s validator message for why length, not composition. */
  password: string;
  displayName: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

// ---------------------------------------------------------------------------
// Properties — `apps/api/src/properties/properties.module.ts`
// ---------------------------------------------------------------------------

/**
 * `PropertiesService.propertyRut()`'s return type (`apps/api/src/properties/
 * properties.module.ts`) — the real `RutResult` union from `@hunt-maps/shared`,
 * not a type invented for the wire (R83's web half).
 *
 * `.supported` is the discriminant, and it is deliberately load-bearing at
 * compile time, not just at runtime: the `true` branch (`RutReading`) carries
 * `phase`/`daysFromPeak`/`confidence`/`note` exactly as before — bit-identical
 * for a whitetail property, per `readRut`'s own overload comment in
 * `packages/shared/src/rut.ts`. The `false` branch (`RutUnsupported`) carries
 * `{ species, reason }` and **has no `phase` field at all**, so a caller that
 * forgets to check `.supported` and reaches for `.phase` fails to compile
 * instead of rendering `undefined` or a stale whitetail phase for an elk
 * property. See `propertyFormat.ts#formatRut` for the render-side branch this
 * exists to force, and `docs/EVIDENCE.md` Pass 7 for why the refusal exists at
 * all (the model is confidently backwards for elk, not merely uncalibrated).
 */
export type PropertyRutReading = RutResult;

/** `PropertiesService.list`'s row shape. */
export interface PropertySummaryDto {
  id: string;
  name: string;
  description: string | null;
  areaHectares: number | null;
  centerLat: number | null;
  centerLng: number | null;
  timezone: string;
  ownerId: string;
  createdAt: string;
  _count: { waypoints: number; observations: number };
  rut: PropertyRutReading | null;
  /**
   * `Property.targetSpecies` (`apps/api/prisma/schema.prisma`) — nullable
   * with **no default**, and `null` ("not stated") is a legitimate, common
   * state, not a validation gap to be nagged about. This is what
   * `propertyRut()` keys its withhold-vs-refuse-vs-answer decision on
   * server-side, and what the web app keys the elk-invalid-layer greying on
   * (R84/R85, `docs/EVIDENCE.md` Pass 7) — see `lib/layers.ts`.
   */
  targetSpecies: WireSpecies | null;
}

export type WirePropertyRole = 'OWNER' | 'MANAGER' | 'HUNTER' | 'OBSERVER';

export interface PropertyMemberDto {
  role: WirePropertyRole;
  user: { id: string; displayName: string; email: string };
}

/** `PropertiesService.get`'s row shape — the summary plus boundary geometry and membership. */
export interface PropertyDetailDto extends PropertySummaryDto {
  memberships: PropertyMemberDto[];
  terrainProfile: TerrainProfileDto | null;
  /** A property boundary is always an area — `GeoPolygon` covers the common case; see `CreatePropertyInput.boundary` for the MultiPolygon gap. */
  boundary: GeoPolygon | Record<string, unknown> | null;
  rutOffsetDays?: number | null;
}

/** `CreatePropertyDto`. */
export interface CreatePropertyInput {
  name: string;
  description?: string;
  /** GeoJSON Polygon or MultiPolygon. `GeoPolygon` covers the common case; a MultiPolygon boundary is accepted server-side but not modelled in `@hunt-maps/shared` today. */
  boundary: GeoPolygon | Record<string, unknown>;
  timezone?: string;
  /**
   * The species this property's rut modelling (and, once R84/R85 land in the
   * corridor UI, its bedding/corridor layers) should target. Optional with no
   * default sent when omitted — the server leaves `targetSpecies` unset
   * ("not stated") rather than assuming whitetail, and the create/edit UI
   * must offer "Not stated" as a real, un-nagged choice for the same reason
   * (`apps/api/src/properties/properties.module.ts`'s `CreatePropertyDto`).
   */
  targetSpecies?: WireSpecies;
}

export type UpdatePropertyInput = Partial<CreatePropertyInput>;

export interface AddPropertyMemberInput {
  email: string;
  role: WirePropertyRole;
}

// ---------------------------------------------------------------------------
// Waypoints — `apps/api/src/waypoints/waypoints.module.ts`
// ---------------------------------------------------------------------------

/** Prisma `WaypointType` labels — see this file's header comment for why not `@hunt-maps/shared`'s `WaypointType`. */
export type WireWaypointType =
  | 'STAND'
  | 'BLIND'
  | 'TRAIL_CAMERA'
  | 'FOOD_PLOT'
  | 'MINERAL_SITE'
  | 'WATER_SOURCE'
  | 'PARKING'
  | 'ACCESS_ROUTE'
  | 'PROPERTY_MARKER'
  | 'NOTE';

/** `WaypointsService`'s raw-SQL row shape (`getOne`/`list`). */
export interface WaypointDto {
  id: string;
  propertyId: string;
  type: WireWaypointType;
  name: string;
  notes: string | null;
  elevationM: number | null;
  standHeightM: number | null;
  shootingLanesDeg: number[];
  huntableWinds: string[];
  cameraDirectionDeg: number | null;
  lastCheckedAt: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  /** Optimistic-concurrency token — send back as `baseVersion` on update. */
  version: number;
  location: GeoPoint;
}

/** `CreateWaypointDto`. */
export interface CreateWaypointInput {
  propertyId: string;
  type: WireWaypointType;
  name: string;
  notes?: string;
  location: GeoPoint;
  standHeightM?: number;
  shootingLanesDeg?: number[];
  huntableWinds?: string[];
  cameraDirectionDeg?: number;
  /** Client-generated identity for offline-created records. See `lib/api/offlineQueue.ts`. */
  clientId?: string;
}

/** `UpdateWaypointDto`. */
export interface UpdateWaypointInput {
  name?: string;
  notes?: string;
  location?: GeoPoint;
  standHeightM?: number;
  shootingLanesDeg?: number[];
  huntableWinds?: string[];
  cameraDirectionDeg?: number;
  archived?: boolean;
  /** The `version` last seen by this client. Omitting it opts out of conflict detection — never omit it for a queued offline edit. */
  baseVersion?: number;
}

/** `WaypointsService.windCheck`'s return shape. */
export interface WaypointWindCheckDto {
  waypointId: string;
  name: string;
  atUtc: string;
  windFromDeg: number;
  windOctant: string;
  thermalPhase: 'rising' | 'sinking' | 'transition';
  thermalScentAzimuthDeg: number | null;
  synopticScentAzimuthDeg: number;
  scentCone: GeoPolygon;
  thermalScentCone: GeoPolygon | null;
  terrain: TerrainSampleDto;
  sunriseUtc: string | null;
  sunsetUtc: string | null;
  rating: 'good' | 'marginal' | 'burned';
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Observations — `apps/api/src/observations/observations.module.ts`
// ---------------------------------------------------------------------------

export type WireObservationKind = 'SIGHTING' | 'TRAIL_CAMERA' | 'HARVEST' | 'SIGN' | 'SIT';
export type WireSpecies =
  | 'WHITETAIL'
  | 'MULE_DEER'
  | 'BLACKTAIL'
  | 'ELK'
  | 'MOOSE'
  | 'PRONGHORN'
  | 'BEAR'
  | 'TURKEY'
  | 'HOG'
  | 'OTHER';
export type WireAnimalSex = 'BUCK' | 'DOE' | 'UNKNOWN';
export type WireSignType =
  'RUB' | 'SCRAPE' | 'BED' | 'TRACK' | 'SCAT' | 'TRAIL' | 'BROWSE' | 'SHED_ANTLER' | 'WALLOW';
/** Prisma `RutPhase` labels — distinct casing from `@hunt-maps/shared`'s `RutPhase`; see this file's header comment. */
export type WireRutPhase =
  | 'OFF_SEASON'
  | 'PRE_RUT'
  | 'SEEKING'
  | 'CHASING'
  | 'PEAK_BREEDING'
  | 'POST_RUT'
  | 'SECOND_RUT'
  | 'LATE_SEASON';

/** `ObservationsService`'s raw-SQL `SELECT *` row shape. */
export interface ObservationDto {
  id: string;
  propertyId: string;
  userId: string;
  waypointId: string | null;
  kind: WireObservationKind;
  species: WireSpecies | null;
  sex: WireAnimalSex | null;
  estimatedAge: number | null;
  count: number;
  signType: WireSignType | null;
  travelHeadingDeg: number | null;
  observedAt: string;
  rutPhase: WireRutPhase | null;
  temperatureC: number | null;
  pressureHpa: number | null;
  pressureTrend3h: number | null;
  windSpeedKph: number | null;
  windFromDeg: number | null;
  moonPhase: number | null;
  isBlankSit: boolean;
  sitMinutes: number | null;
  /** Denormalised terrain sample, stamped at write time — see `CLAUDE.md`'s "terrain is denormalised" rule. */
  elevationM: number | null;
  slopeDeg: number | null;
  aspectDeg: number | null;
  landformClass: number | null;
  morphometry: number | null;
  isBench: boolean | null;
  ruggedness: number | null;
  windExposure: number | null;
  insolation: number | null;
  notes: string | null;
  createdAt: string;
  version: number;
  location: GeoPoint;
}

/** `CreateObservationDto`. */
export interface CreateObservationInput {
  propertyId: string;
  kind: WireObservationKind;
  species?: WireSpecies;
  sex?: WireAnimalSex;
  estimatedAge?: number;
  count?: number;
  signType?: WireSignType;
  location: GeoPoint;
  travelHeadingDeg?: number;
  observedAt: string;
  waypointId?: string;
  temperatureC?: number;
  pressureHpa?: number;
  pressureTrend3h?: number;
  windSpeedKph?: number;
  windFromDeg?: number;
  humidityPct?: number;
  cloudCover?: number;
  precipitationMm?: number;
  moonPhase?: number;
  isBlankSit?: boolean;
  sitMinutes?: number;
  notes?: string;
  /** Client-generated identity for offline-created records. See `lib/api/offlineQueue.ts`. */
  clientId?: string;
}

export interface ObservationListFilters {
  kind?: WireObservationKind;
  species?: WireSpecies;
  sex?: WireAnimalSex;
  since?: string;
}

// ---------------------------------------------------------------------------
// Terrain samples — shared shape across waypoint/observation/point responses
// ---------------------------------------------------------------------------

/** Mirrors `@hunt-maps/terrain`'s `samplePoint` result as serialised to JSON. */
export interface TerrainSampleDto {
  elevationM?: number;
  slopeDeg?: number;
  aspectDeg?: number;
  landform?: number;
  morphometry?: number;
  isBench?: boolean;
  ruggedness?: number;
  windExposure?: number;
  insolation?: number;
}

// ---------------------------------------------------------------------------
// Filters — `apps/api/src/filters/filters.module.ts`
// ---------------------------------------------------------------------------

/** A `TerrainPredicate` AST node. Validated server-side (`validatePredicate`); treated as opaque JSON here — `@hunt-maps/terrain` is the source of truth for its shape. */
export type TerrainPredicateJson = Record<string, unknown>;

export interface SavedFilterDto {
  id: string;
  ownerId: string;
  propertyId: string | null;
  name: string;
  description: string | null;
  predicate: TerrainPredicateJson;
  color: string;
  opacity: number;
  outline: boolean;
  sharedPublicly: boolean;
  isPreset: boolean;
  clientId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** `SaveFilterDto`. */
export interface CreateFilterInput {
  name: string;
  description?: string;
  predicate: TerrainPredicateJson;
  propertyId?: string;
  color?: string;
  opacity?: number;
  outline?: boolean;
  sharedPublicly?: boolean;
  /** Client-generated identity for offline-created records. See `lib/api/offlineQueue.ts`. */
  clientId?: string;
}

/** `UpdateFilterDto`. */
export type UpdateFilterInput = Partial<Omit<CreateFilterInput, 'clientId'>>;

// ---------------------------------------------------------------------------
// Analytics — `apps/api/src/analytics/analytics.module.ts`
// ---------------------------------------------------------------------------

export interface TerrainProfileDto {
  id: string;
  propertyId: string;
  demSource: string;
  demZoom: number;
  cellSizeM: number;
  minElevationM: number;
  maxElevationM: number;
  meanSlopeDeg: number;
  slopeShares: number[];
  aspectShares: number[];
  landformShares: number[];
  benchShare: number;
  sourceVersion: string;
  computedAt: string;
}

export interface MovementAnalyticsOptions {
  matureOnly?: boolean;
  since?: string;
}

/**
 * `AnalyticsService.movement`'s return shape.
 *
 * `bySlopeBand`/`byAspectOctant`/`byLandform` are real `SelectionAnalysisDto`s
 * from `@hunt-maps/shared` — use-vs-availability corrected, per CLAUDE.md's
 * fifth non-negotiable. **Never render `byWindDirection`/`byPressureTrend` as
 * a bar chart of raw counts without the same correction** — they are not
 * availability-corrected server-side, which is exactly the "histogram of
 * sightings by slope band" trap the non-negotiable warns about applied to a
 * different metric. Flag to `analytics-auditor` before a screen ships these.
 */
export interface MovementAnalyticsDto {
  propertyId: string;
  sampleSize: number;
  sitCount: number;
  /** Sightings per sit — the effort-normalised figure that use-vs-availability analytics require. Null when there is not yet a usable denominator. */
  sightingsPerSit: number | null;
  matureOnly: boolean;
  relativeToSunrise: Array<{ minutesFromSunrise: number; count: number }>;
  relativeToSunset: Array<{ minutesFromSunrise: number; count: number }>;
  byPressureTrend: Array<{ label: string; count: number }>;
  byWindDirection: Array<{ octant: string; count: number }>;
  bySlopeBand: SelectionAnalysisDto;
  byAspectOctant: SelectionAnalysisDto;
  byLandform: SelectionAnalysisDto;
  readouts: { slope: string; aspect: string; landform: string };
  terrainProfile: Pick<
    TerrainProfileDto,
    'cellSizeM' | 'meanSlopeDeg' | 'minElevationM' | 'maxElevationM' | 'benchShare' | 'demSource'
  >;
}

// ---------------------------------------------------------------------------
// Offline regions — `apps/api/src/offline/offline.module.ts`
// ---------------------------------------------------------------------------

export type WireOfflineRegionStatus = 'PENDING' | 'PACKAGING' | 'READY' | 'FAILED' | 'STALE';

export interface OfflineRegionRequestInput {
  name: string;
  west: number;
  south: number;
  east: number;
  north: number;
  minZoom: number;
  maxZoom: number;
  layers: string[];
  propertyId?: string;
}

export interface OfflineEstimateDto {
  tileCount: number;
  estimatedBytes: number;
  byLayer: Array<{ layer: string; tileCount: number; estimatedBytes: number }>;
  warnings: string[];
}

export interface OfflineRegionCreateResponse {
  id: string;
  status: 'pending';
  estimate: OfflineEstimateDto;
  tileUrlTemplates: Array<{ layer: string; template: string }>;
}

/** `OfflineService.list`'s row shape. */
export interface OfflineRegionDto {
  id: string;
  name: string;
  propertyId: string | null;
  minZoom: number;
  maxZoom: number;
  layers: string[];
  status: WireOfflineRegionStatus;
  sizeBytes: number | null;
  tileCount: number | null;
  packagedAt: string | null;
  error: string | null;
  createdAt: string;
  bounds: GeoPolygon | null;
}

// ---------------------------------------------------------------------------
// Terrain — `apps/api/src/terrain/terrain.controller.ts`
// ---------------------------------------------------------------------------

export interface DemSourceDto {
  id: string;
  label: string;
  encoding: string;
  tileSize: number;
  maxZoom: number;
  attribution?: string;
}

export interface TerrainPointQuery {
  lng: number;
  lat: number;
  zoom?: number;
  source?: string;
  wind?: number;
  at?: string;
}

/**
 * `GET /terrain/dem/coverage` — what elevation data actually exists at a
 * point, so a DEM source picker can say "no 1 m data here" instead of
 * assuming. See `apps/api/src/terrain/terrain.controller.ts#demCoverage`.
 */
export interface DemCoverageDto {
  lng: number;
  lat: number;
  oneMeter: {
    available: boolean;
    /** Name of the USGS acquisition project, when available. */
    project: string | null;
    elevationMeters: number | null;
    utmZone: number | null;
  };
  /** The source id the server recommends for this point. */
  recommendedSource: string;
  resolutionNote: string;
}

export interface EvaluateFilterInput {
  bbox: { west: number; south: number; east: number; north: number };
  zoom: number;
  predicate: TerrainPredicateJson;
  demSource?: string;
  windFromDeg?: number;
  atUtc?: string;
}

export interface EvaluateFilterResult {
  matchShare: number;
  advice: string | null;
  [key: string]: unknown;
}

/** `CorridorRequest`, `apps/api/src/terrain/corridor.service.ts`. */
export interface CorridorSolveInput {
  bbox: BoundingBox;
  zoom: number;
  /** Areas the corridor connects — typically bedding and food. */
  from: GeoPolygon | GeoPoint;
  to: GeoPolygon | GeoPoint;
  toleranceFraction?: number;
  /** When set, terrain deer prefer is discounted so routes favour it. */
  useBeddingAttraction?: boolean;
  windFromDeg?: number;
  demSource?: string;
  maxLines?: number;
}

/** `CorridorResponse`. Least-cost routing is a whole-property computation — see the service's own doc comment for why this cannot be tiled like the shading layers. */
export interface CorridorSolveResult {
  band: GeoPolygon | null;
  centerlines: GeoLineString[];
  pinchPoints: Array<{ point: GeoPoint; score: number }>;
  optimalCost: number | null;
  areaShare: number;
  cellSizeM: number;
  parameters: Record<string, unknown>;
}
