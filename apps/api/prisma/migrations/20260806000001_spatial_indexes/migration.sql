-- Spatial indexes.
--
-- Prisma cannot express GiST indexes on Unsupported() columns, so they are
-- added here by hand. Without them every spatial predicate degrades to a
-- sequential scan, which is survivable on one property and is not once a
-- workspace has a season of observations.

CREATE INDEX IF NOT EXISTS "Property_boundary_gist"    ON "Property"      USING GIST (boundary);
CREATE INDEX IF NOT EXISTS "Property_centroid_gist"    ON "Property"      USING GIST (centroid);
CREATE INDEX IF NOT EXISTS "Waypoint_location_gist"    ON "Waypoint"      USING GIST (location);
CREATE INDEX IF NOT EXISTS "Observation_location_gist" ON "Observation"   USING GIST (location);
CREATE INDEX IF NOT EXISTS "Track_path_gist"           ON "Track"         USING GIST (path);
CREATE INDEX IF NOT EXISTS "SavedFilter_matched_gist"  ON "SavedFilter"   USING GIST ("matchedArea");
CREATE INDEX IF NOT EXISTS "Corridor_band_gist"        ON "Corridor"      USING GIST (band);
CREATE INDEX IF NOT EXISTS "OfflineRegion_bounds_gist" ON "OfflineRegion" USING GIST (bounds);

-- Geometry columns stay NULLABLE, deliberately.
--
-- Prisma Client cannot create rows carrying required Unsupported() columns, so
-- every service inserts the row and then writes the geometry in a second
-- statement within the same request. A plain NOT NULL would reject that first
-- insert, and NOT NULL cannot be deferred to COMMIT the way a foreign key can.
--
-- Enforcing this properly means wrapping create-then-write in an explicit
-- transaction and adding a DEFERRABLE INITIALLY DEFERRED constraint trigger.
-- That is tracked as backlog item I5 rather than being faked here: a constraint
-- that silently does not hold is worse than an honest absence of one.
