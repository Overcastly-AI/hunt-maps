-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "UnitSystem" AS ENUM ('IMPERIAL', 'METRIC');

-- CreateEnum
CREATE TYPE "PropertyRole" AS ENUM ('OWNER', 'MANAGER', 'HUNTER', 'OBSERVER');

-- CreateEnum
CREATE TYPE "WaypointType" AS ENUM ('STAND', 'BLIND', 'TRAIL_CAMERA', 'FOOD_PLOT', 'MINERAL_SITE', 'WATER_SOURCE', 'PARKING', 'ACCESS_ROUTE', 'PROPERTY_MARKER', 'NOTE');

-- CreateEnum
CREATE TYPE "ObservationKind" AS ENUM ('SIGHTING', 'TRAIL_CAMERA', 'HARVEST', 'SIGN', 'SIT');

-- CreateEnum
CREATE TYPE "Species" AS ENUM ('WHITETAIL', 'MULE_DEER', 'BLACKTAIL', 'ELK', 'MOOSE', 'PRONGHORN', 'BEAR', 'TURKEY', 'HOG', 'OTHER');

-- CreateEnum
CREATE TYPE "AnimalSex" AS ENUM ('BUCK', 'DOE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SignType" AS ENUM ('RUB', 'SCRAPE', 'BED', 'TRACK', 'SCAT', 'TRAIL', 'BROWSE', 'SHED_ANTLER', 'WALLOW');

-- CreateEnum
CREATE TYPE "RutPhase" AS ENUM ('OFF_SEASON', 'PRE_RUT', 'SEEKING', 'CHASING', 'PEAK_BREEDING', 'POST_RUT', 'SECOND_RUT', 'LATE_SEASON');

-- CreateEnum
CREATE TYPE "TrackPurpose" AS ENUM ('SCOUTING', 'ACCESS', 'BLOOD_TRAIL', 'RECOVERY', 'OTHER');

-- CreateEnum
CREATE TYPE "OfflineStatus" AS ENUM ('PENDING', 'PACKAGING', 'READY', 'FAILED', 'STALE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "unitSystem" "UnitSystem" NOT NULL DEFAULT 'IMPERIAL',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT NOT NULL,
    "boundary" geometry(MultiPolygon, 4326),
    "centroid" geometry(Point, 4326),
    "areaHectares" DOUBLE PRECISION,
    "centerLat" DOUBLE PRECISION,
    "centerLng" DOUBLE PRECISION,
    "rutOffsetDays" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyMembership" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PropertyRole" NOT NULL DEFAULT 'HUNTER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerrainProfile" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "demSource" TEXT NOT NULL,
    "demZoom" INTEGER NOT NULL,
    "cellSizeM" DOUBLE PRECISION NOT NULL,
    "minElevationM" DOUBLE PRECISION NOT NULL,
    "maxElevationM" DOUBLE PRECISION NOT NULL,
    "meanSlopeDeg" DOUBLE PRECISION NOT NULL,
    "slopeShares" JSONB NOT NULL,
    "aspectShares" JSONB NOT NULL,
    "landformShares" JSONB NOT NULL,
    "benchShare" DOUBLE PRECISION,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceVersion" TEXT NOT NULL,

    CONSTRAINT "TerrainProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Waypoint" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "type" "WaypointType" NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "location" geometry(Point, 4326),
    "elevationM" DOUBLE PRECISION,
    "standHeightM" DOUBLE PRECISION,
    "shootingLanesDeg" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "huntableWinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cameraDirectionDeg" DOUBLE PRECISION,
    "lastCheckedAt" TIMESTAMP(3),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "clientId" TEXT,

    CONSTRAINT "Waypoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "waypointId" TEXT,
    "kind" "ObservationKind" NOT NULL,
    "species" "Species",
    "sex" "AnimalSex",
    "estimatedAge" DOUBLE PRECISION,
    "count" INTEGER NOT NULL DEFAULT 1,
    "signType" "SignType",
    "location" geometry(Point, 4326),
    "travelHeadingDeg" DOUBLE PRECISION,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "rutPhase" "RutPhase",
    "temperatureC" DOUBLE PRECISION,
    "pressureHpa" DOUBLE PRECISION,
    "pressureTrend3h" DOUBLE PRECISION,
    "windSpeedKph" DOUBLE PRECISION,
    "windFromDeg" DOUBLE PRECISION,
    "humidityPct" DOUBLE PRECISION,
    "cloudCover" DOUBLE PRECISION,
    "precipitationMm" DOUBLE PRECISION,
    "moonPhase" DOUBLE PRECISION,
    "elevationM" DOUBLE PRECISION,
    "slopeDeg" DOUBLE PRECISION,
    "aspectDeg" DOUBLE PRECISION,
    "landformClass" INTEGER,
    "morphometry" INTEGER,
    "isBench" BOOLEAN,
    "ruggedness" DOUBLE PRECISION,
    "windExposure" DOUBLE PRECISION,
    "insolation" DOUBLE PRECISION,
    "isBlankSit" BOOLEAN NOT NULL DEFAULT false,
    "sitMinutes" INTEGER,
    "notes" TEXT,
    "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "clientId" TEXT,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" "TrackPurpose" NOT NULL DEFAULT 'SCOUTING',
    "path" geometry(LineString, 4326),
    "distanceM" DOUBLE PRECISION,
    "ascentM" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "clientId" TEXT,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedFilter" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT NOT NULL,
    "propertyId" TEXT,
    "predicate" JSONB NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#e8a33d',
    "opacity" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "outline" BOOLEAN NOT NULL DEFAULT true,
    "matchedArea" geometry(MultiPolygon, 4326),
    "matchedAreaShare" DOUBLE PRECISION,
    "computedAt" TIMESTAMP(3),
    "computeKey" TEXT,
    "isPreset" BOOLEAN NOT NULL DEFAULT false,
    "sharedPublicly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "clientId" TEXT,

    CONSTRAINT "SavedFilter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Corridor" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceArea" geometry(MultiPolygon, 4326),
    "targetArea" geometry(MultiPolygon, 4326),
    "band" geometry(MultiPolygon, 4326),
    "centerlines" geometry(MultiLineString, 4326),
    "pinchPoints" geometry(MultiPoint, 4326),
    "toleranceFraction" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "parameters" JSONB NOT NULL,
    "optimalCost" DOUBLE PRECISION,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Corridor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfflineRegion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "propertyId" TEXT,
    "bounds" geometry(Polygon, 4326),
    "minZoom" INTEGER NOT NULL DEFAULT 10,
    "maxZoom" INTEGER NOT NULL DEFAULT 16,
    "layers" TEXT[],
    "status" "OfflineStatus" NOT NULL DEFAULT 'PENDING',
    "sizeBytes" BIGINT,
    "tileCount" INTEGER,
    "archivePath" TEXT,
    "packagedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfflineRegion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemTile" (
    "z" INTEGER NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "etag" TEXT,

    CONSTRAINT "DemTile_pkey" PRIMARY KEY ("source","z","x","y")
);

-- CreateTable
CREATE TABLE "ChangeLog" (
    "id" BIGSERIAL NOT NULL,
    "propertyId" TEXT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "Property_ownerId_idx" ON "Property"("ownerId");

-- CreateIndex
CREATE INDEX "PropertyMembership_userId_idx" ON "PropertyMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyMembership_propertyId_userId_key" ON "PropertyMembership"("propertyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TerrainProfile_propertyId_key" ON "TerrainProfile"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "Waypoint_clientId_key" ON "Waypoint"("clientId");

-- CreateIndex
CREATE INDEX "Waypoint_propertyId_type_idx" ON "Waypoint"("propertyId", "type");

-- CreateIndex
CREATE INDEX "Waypoint_propertyId_archived_idx" ON "Waypoint"("propertyId", "archived");

-- CreateIndex
CREATE UNIQUE INDEX "Observation_clientId_key" ON "Observation"("clientId");

-- CreateIndex
CREATE INDEX "Observation_propertyId_observedAt_idx" ON "Observation"("propertyId", "observedAt");

-- CreateIndex
CREATE INDEX "Observation_propertyId_kind_idx" ON "Observation"("propertyId", "kind");

-- CreateIndex
CREATE INDEX "Observation_propertyId_species_sex_idx" ON "Observation"("propertyId", "species", "sex");

-- CreateIndex
CREATE INDEX "Observation_waypointId_idx" ON "Observation"("waypointId");

-- CreateIndex
CREATE UNIQUE INDEX "Track_clientId_key" ON "Track"("clientId");

-- CreateIndex
CREATE INDEX "Track_propertyId_startedAt_idx" ON "Track"("propertyId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedFilter_clientId_key" ON "SavedFilter"("clientId");

-- CreateIndex
CREATE INDEX "SavedFilter_ownerId_idx" ON "SavedFilter"("ownerId");

-- CreateIndex
CREATE INDEX "SavedFilter_propertyId_idx" ON "SavedFilter"("propertyId");

-- CreateIndex
CREATE INDEX "Corridor_propertyId_idx" ON "Corridor"("propertyId");

-- CreateIndex
CREATE INDEX "OfflineRegion_userId_idx" ON "OfflineRegion"("userId");

-- CreateIndex
CREATE INDEX "DemTile_fetchedAt_idx" ON "DemTile"("fetchedAt");

-- CreateIndex
CREATE INDEX "ChangeLog_propertyId_id_idx" ON "ChangeLog"("propertyId", "id");

-- CreateIndex
CREATE INDEX "ChangeLog_createdAt_idx" ON "ChangeLog"("createdAt");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyMembership" ADD CONSTRAINT "PropertyMembership_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyMembership" ADD CONSTRAINT "PropertyMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerrainProfile" ADD CONSTRAINT "TerrainProfile_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waypoint" ADD CONSTRAINT "Waypoint_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_waypointId_fkey" FOREIGN KEY ("waypointId") REFERENCES "Waypoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedFilter" ADD CONSTRAINT "SavedFilter_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedFilter" ADD CONSTRAINT "SavedFilter_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Corridor" ADD CONSTRAINT "Corridor_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfflineRegion" ADD CONSTRAINT "OfflineRegion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfflineRegion" ADD CONSTRAINT "OfflineRegion_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

