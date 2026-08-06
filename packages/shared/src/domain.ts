/**
 * Domain enums and contracts shared by the API, the web client and the offline
 * worker. Anything both sides must agree on lives here exactly once.
 */

// ---------------------------------------------------------------------------
// Waypoints — the things a hunter physically puts on the ground
// ---------------------------------------------------------------------------

export enum WaypointType {
  Stand = 'stand',
  Blind = 'blind',
  TrailCamera = 'trail_camera',
  FoodPlot = 'food_plot',
  MineralSite = 'mineral_site',
  WaterSource = 'water_source',
  Parking = 'parking',
  AccessRoute = 'access_route',
  PropertyMarker = 'property_marker',
  Note = 'note',
}

/**
 * Field sign. This is the ground-truth layer that makes the analytics
 * defensible: a predicted bedding area with six beds logged in it is a very
 * different claim from one with none, and the app should be able to tell the
 * difference rather than asking the user to trust a heat map.
 */
export enum SignType {
  Rub = 'rub',
  Scrape = 'scrape',
  Bed = 'bed',
  Track = 'track',
  Scat = 'scat',
  Trail = 'trail',
  Browse = 'browse',
  ShedAntler = 'shed_antler',
  Wallow = 'wallow',
}

export enum ObservationKind {
  Sighting = 'sighting',
  TrailCamera = 'trail_camera',
  Harvest = 'harvest',
  Sign = 'sign',
  Sit = 'sit',
}

export enum GameSpecies {
  Whitetail = 'whitetail',
  Mule = 'mule_deer',
  Elk = 'elk',
  Moose = 'moose',
  Blacktail = 'blacktail',
  Pronghorn = 'pronghorn',
  Bear = 'bear',
  Turkey = 'turkey',
  Hog = 'hog',
  Other = 'other',
}

export enum AnimalSex {
  Buck = 'buck',
  Doe = 'doe',
  Unknown = 'unknown',
}

/**
 * Rut phase. Dated by calendar rather than by moon phase — peak breeding sits in
 * a narrow, photoperiod-locked window every year, and the research consensus is
 * that lunar phase does not move it. Modelling it off the moon would be
 * astrology with a map attached.
 */
export enum RutPhase {
  PreRut = 'pre_rut',
  Seeking = 'seeking',
  Chasing = 'chasing',
  PeakBreeding = 'peak_breeding',
  PostRut = 'post_rut',
  SecondRut = 'second_rut',
  LateSeason = 'late_season',
  OffSeason = 'off_season',
}

export enum MapLayerKind {
  Satellite = 'satellite',
  Topo = 'topo',
  Hillshade = 'hillshade',
  Lidar = 'lidar_hillshade',
  Contours = 'contours',
  Slope = 'slope',
  Aspect = 'aspect',
  Landform = 'landform',
  Morphometry = 'morphometry',
  Benches = 'benches',
  Insolation = 'insolation',
  WindExposure = 'wind_exposure',
  Bedding = 'bedding',
  Corridors = 'corridors',
  LandCover = 'land_cover',
  PublicLand = 'public_land',
  Parcels = 'parcels',
}

// ---------------------------------------------------------------------------
// Geometry — a deliberately small GeoJSON subset
// ---------------------------------------------------------------------------

export interface GeoPoint {
  type: 'Point';
  /** [longitude, latitude] — GeoJSON axis order, not lat/lng. */
  coordinates: [number, number];
}

export interface GeoLineString {
  type: 'LineString';
  coordinates: Array<[number, number]>;
}

export interface GeoPolygon {
  type: 'Polygon';
  coordinates: Array<Array<[number, number]>>;
}

export type GeoGeometry = GeoPoint | GeoLineString | GeoPolygon;

export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

// ---------------------------------------------------------------------------
// Conditions — the covariates every observation is scored against
// ---------------------------------------------------------------------------

/**
 * Weather and celestial conditions attached to an observation.
 *
 * Recorded at *observation time*, not fetched later, because the analytics
 * depend on it and reconstructing historical hyperlocal conditions after the
 * fact is unreliable. Barometric pressure gets both an absolute value and a
 * 3-hour trend: the literature is far more consistent about deer responding to
 * *falling* or *rising* pressure than to any absolute number, so the trend is
 * the analytically useful field.
 */
export interface Conditions {
  temperatureC?: number;
  /** Sea-level-adjusted barometric pressure, hPa. */
  pressureHpa?: number;
  /** Change over the preceding 3 hours, hPa. Negative = falling. */
  pressureTrend3h?: number;
  windSpeedKph?: number;
  /** Direction the wind is coming FROM, degrees clockwise from north. */
  windFromDeg?: number;
  windGustKph?: number;
  humidityPct?: number;
  /** 0..1 cloud cover. */
  cloudCover?: number;
  precipitationMm?: number;
  /** 0 = new moon, 0.5 = full. */
  moonPhase?: number;
  moonIlluminationPct?: number;
  sunriseUtc?: string;
  sunsetUtc?: string;
}

export interface ObservationDto {
  id: string;
  propertyId: string;
  kind: ObservationKind;
  species?: GameSpecies;
  sex?: AnimalSex;
  /** Best-guess age in years; null when unaged. */
  estimatedAge?: number;
  count?: number;
  signType?: SignType;
  geometry: GeoPoint;
  /** Direction of travel if observed, degrees clockwise from north. */
  travelHeadingDeg?: number;
  observedAtUtc: string;
  rutPhase?: RutPhase;
  conditions?: Conditions;
  notes?: string;
  photoUrls?: string[];
  /**
   * Terrain attributes sampled at the observation point when it was recorded.
   * Denormalised on purpose — this is what lets the analytics ask "what slope
   * band do my mature-buck daylight sightings actually come from" without
   * re-running terrain analysis over the whole history.
   */
  terrain?: TerrainSampleDto;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface TerrainSampleDto {
  elevationM?: number;
  slopeDeg?: number;
  aspectDeg?: number;
  landform?: number;
  morphometry?: number;
  isBench?: boolean;
  ruggedness?: number;
  /** Wind exposure at the recorded wind direction, -1..1. */
  windExposure?: number;
  insolation?: number;
}

// ---------------------------------------------------------------------------
// Analytics results
// ---------------------------------------------------------------------------

export interface HistogramBin {
  label: string;
  from: number;
  to: number;
  count: number;
  /** Share of the property's area falling in this bin. */
  areaShare?: number;
  /**
   * Observations per unit area, normalised so 1.0 = "exactly what you would
   * expect if deer used this bin in proportion to how much of it exists".
   *
   * This is the number that matters and the one naive dashboards get wrong: a
   * raw count says most sightings happen on open slopes, but open slopes are
   * most of the property. Selection ratio says whether deer *prefer* it.
   */
  selectionRatio?: number;
}

export interface SelectionAnalysisDto {
  metric: string;
  bins: HistogramBin[];
  sampleSize: number;
  /** Chi-square goodness-of-fit against the available-area distribution. */
  chiSquare?: number;
  degreesOfFreedom?: number;
  /** True when the pattern is unlikely to be chance at p < 0.05. */
  significant?: boolean;
}

export interface TimeOfDayBucket {
  /** Minutes relative to sunrise (negative = before). */
  minutesFromSunrise: number;
  count: number;
}

export interface MovementAnalyticsDto {
  propertyId: string;
  sampleSize: number;
  /** Activity relative to sunrise/sunset rather than clock time. */
  relativeToSunrise: TimeOfDayBucket[];
  relativeToSunset: TimeOfDayBucket[];
  byRutPhase: Array<{ phase: RutPhase; count: number; matureBuckCount: number }>;
  byPressureTrend: Array<{ label: string; count: number; sightingsPerSit?: number }>;
  byWindDirection: Array<{ octant: string; count: number; sitCount: number }>;
  bySlopeBand: SelectionAnalysisDto;
  byAspectOctant: SelectionAnalysisDto;
  byLandform: SelectionAnalysisDto;
}

// ---------------------------------------------------------------------------
// Stand analysis
// ---------------------------------------------------------------------------

/**
 * Wind-safety verdict for a stand under a given wind.
 *
 * Combines the synoptic wind with the modelled thermal, because the two
 * frequently disagree and the thermal usually wins in the first and last hour
 * of light. A stand rated "safe" on a west wind that sits above a draw at dusk
 * is not safe.
 */
export interface StandWindAnalysisDto {
  waypointId: string;
  windFromDeg: number;
  atUtc: string;
  thermalPhase: 'rising' | 'sinking' | 'transition';
  /** Combined scent azimuth after blending wind and thermal. */
  scentAzimuthDeg: number;
  /** Ground the hunter's scent is expected to cross, as a cone polygon. */
  scentCone: GeoPolygon;
  /** Predicted-bedding or logged-sign areas the scent cone intersects. */
  compromisedAreaShare: number;
  rating: 'good' | 'marginal' | 'burned';
  reasons: string[];
}

export interface AccessRouteAnalysisDto {
  /** Route the hunter walks in. */
  route: GeoLineString;
  /** Share of the route whose scent plume touches bedding. */
  exposureShare: number;
  /** Suggested alternative when the requested route is compromised. */
  suggestion?: GeoLineString;
  rating: 'clean' | 'marginal' | 'compromised';
}

// ---------------------------------------------------------------------------
// Offline
// ---------------------------------------------------------------------------

export enum OfflineRegionStatus {
  Pending = 'pending',
  Packaging = 'packaging',
  Ready = 'ready',
  Downloading = 'downloading',
  Complete = 'complete',
  Failed = 'failed',
  Stale = 'stale',
}

export interface OfflineRegionDto {
  id: string;
  name: string;
  propertyId?: string;
  bbox: BoundingBox;
  minZoom: number;
  maxZoom: number;
  layers: MapLayerKind[];
  status: OfflineRegionStatus;
  /** Bytes, once known. */
  sizeBytes?: number;
  tileCount?: number;
  downloadedTiles?: number;
  /** When the source data was last refreshed; drives the Stale status. */
  packagedAtUtc?: string;
  error?: string;
}

/** Rough size estimate so the UI can warn before a multi-hundred-MB download. */
export interface OfflineEstimateDto {
  tileCount: number;
  estimatedBytes: number;
  /** Per-layer breakdown, so the user can drop the expensive ones. */
  byLayer: Array<{ layer: MapLayerKind; tileCount: number; estimatedBytes: number }>;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export enum SyncOp {
  Create = 'create',
  Update = 'update',
  Delete = 'delete',
}

/**
 * One queued offline mutation.
 *
 * `clientId` is generated on the device so a record created with no signal has
 * a stable identity before the server ever sees it, and replaying the queue is
 * idempotent. `baseVersion` is what makes conflict detection possible rather
 * than last-write-wins — a hunter who edits a stand on their phone in the woods
 * and on the laptop at camp must not silently lose one of them.
 */
export interface SyncMutation {
  clientId: string;
  entity: 'waypoint' | 'observation' | 'filter' | 'property' | 'track';
  op: SyncOp;
  entityId?: string;
  baseVersion?: number;
  payload: unknown;
  queuedAtUtc: string;
}

export interface SyncResultItem {
  clientId: string;
  status: 'applied' | 'conflict' | 'rejected';
  entityId?: string;
  version?: number;
  /** Server state when a conflict was detected, so the UI can offer a merge. */
  serverState?: unknown;
  error?: string;
}

export interface SyncPushResponse {
  results: SyncResultItem[];
  serverTimeUtc: string;
}

export interface SyncPullResponse {
  /** Changes since the cursor, in commit order. */
  changes: Array<{
    entity: SyncMutation['entity'];
    op: SyncOp;
    entityId: string;
    version: number;
    payload: unknown;
  }>;
  /** Opaque cursor to pass to the next pull. */
  cursor: string;
  hasMore: boolean;
  serverTimeUtc: string;
}
