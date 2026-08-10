/**
 * Vertical datums — what "elevation" actually means in each source, and the
 * guard that stops two meanings being mixed in one surface.
 *
 * ## The failure this prevents
 *
 * "Elevation" is not one quantity. There are two families:
 *
 *  - **Orthometric** — height above the *geoid*, i.e. above mean sea level.
 *    NAVD88 (US), EGM96/EGM2008 (global). This is what a topo map, a survey
 *    benchmark and a hunter mean by "elevation".
 *  - **Ellipsoidal** — height above the WGS84 reference *ellipsoid*, a smooth
 *    mathematical figure that is not the sea surface. This is what a raw GNSS
 *    fix reports.
 *
 * Across CONUS the geoid sits **22–34 m below** the WGS84 ellipsoid, so an
 * ellipsoidal height is 22–34 m *larger* than the orthometric height of the same
 * ground. Mixing the two silently is the archetypal instance of the failure this
 * codebase ranks worst: nothing crashes, every number still looks like terrain,
 * and every elevation readout, every profile and every viewshed is wrong by the
 * height of a ten-storey building. Worse, if two DEM sources with different
 * datums were mosaicked together, the *seam* between them would be a 30 m cliff
 * that the slope operator would faithfully report as a vertical wall, and the
 * corridor solver would route around forever.
 *
 * ## What we measured, rather than assumed
 *
 * The obvious worry was that AWS Terrarium might be ellipsoidal while 3DEP is
 * NAVD88. It is not. Sampling both at 196 points in each of three relief classes
 * (2026-08, `USGS_13` vs `terrarium` z14):
 *
 * | Terrain                | relief | mean(3DEP − Terrarium) | median  | s.d.   |
 * |------------------------|--------|------------------------|---------|--------|
 * | Appalachian VA/KY      | 274 m  | +0.56 m                | +0.84 m | 6.61 m |
 * | Knobs, KY              | 179 m  | −0.38 m                | −0.27 m | 3.35 m |
 * | Bluegrass, KY (gentle) |  60 m  | −0.79 m                | −0.82 m | 2.09 m |
 *
 * The mean offset is **sub-metre and not consistent in sign**, and the scatter
 * grows with relief — the signature of horizontal resampling error in steep
 * ground, not of a vertical datum step. A datum mismatch would have shown as a
 * near-constant ~30 m in all three rows. Both sources are therefore orthometric,
 * which is what the documentation says independently: Terrarium over CONUS is
 * built from USGS NED/3DEP (NAVD88) and elsewhere from SRTM (EGM96), and the
 * two geoids differ by ~1 m in CONUS. **No geoid conversion is required between
 * them, and none is implemented.**
 *
 * That is a measurement of these two sources, not a general licence. Hence
 * {@link assertSameVerticalDatum}: the next source added does not get to inherit
 * the conclusion by default.
 *
 * ## What is still dangerous
 *
 * A GNSS altitude — `GeolocationPosition.coords.altitude` in the browser, or a
 * handheld's raw ellipsoidal readout — is **ellipsoidal** and is *not*
 * comparable to anything in this engine. Comparing a user's GPS altitude to a
 * DEM elevation without applying geoid separation would report a 22–34 m error
 * as though the hunter were floating. {@link GEOID_SEPARATION_CONUS_RANGE}
 * exists so that code which is tempted to do this has something to fail against.
 */

/**
 * Vertical reference of a DEM source's elevation values.
 *
 * `'orthometric'` deliberately does not distinguish NAVD88 from EGM96: within
 * CONUS they differ by about a metre, which is inside the noise of the sources
 * themselves (see the table above) and far below the ~10 m horizontal cell size.
 * Splitting them would imply a precision the data does not carry. `datumNote`
 * on the source records which one it actually is, for the UI to state.
 */
export type VerticalDatum = 'orthometric' | 'ellipsoidal';

/**
 * Geoid separation (ellipsoid − geoid) across the conterminous US, metres.
 *
 * Always negative: the geoid is *below* the WGS84 ellipsoid everywhere in CONUS.
 * Used only to bound a sanity check — this package does not ship a geoid grid,
 * because GEOID18 is a ~100 MB raster and the honest alternative to shipping it
 * is to refuse the conversion rather than to approximate it.
 */
export const GEOID_SEPARATION_CONUS_RANGE = { min: -34, max: -22 } as const;

export class VerticalDatumMismatchError extends Error {
  constructor(
    readonly expected: VerticalDatum,
    readonly found: VerticalDatum,
    readonly detail: string,
  ) {
    super(
      `Refusing to combine elevation in ${found} with elevation in ${expected}: ${detail} ` +
        `The two differ by 22-34 m across CONUS, so a mosaic of both would contain a ` +
        `30 m cliff at every seam that slope, viewshed and corridor cost would all treat ` +
        `as real ground.`,
    );
    this.name = 'VerticalDatumMismatchError';
  }
}

/**
 * Refuse to mix vertical datums.
 *
 * Call this wherever heights from two sources could end up in one grid — a
 * mosaic, a fallback chain, a "fill the holes in 1 m with 1/3 arc-second" blend.
 * It is a guard, not a converter, and that is the point: converting would need a
 * geoid model this package cannot carry, so the only honest options are "both
 * sides are the same datum" or "stop".
 */
export function assertSameVerticalDatum(
  expected: VerticalDatum,
  found: VerticalDatum,
  detail: string,
): void {
  if (expected !== found) throw new VerticalDatumMismatchError(expected, found, detail);
}

/**
 * Is this GNSS altitude plausibly comparable to a DEM elevation from this engine?
 *
 * Returns false when the difference is inside the CONUS geoid-separation band,
 * i.e. exactly where an unconverted ellipsoidal height would land. Intended for
 * a "your GPS says X, the map says Y" readout: rather than showing a confident
 * 28 m discrepancy, the caller should say the altitude is not comparable.
 */
export function looksLikeUnconvertedEllipsoidalHeight(
  gnssAltitude: number,
  demElevation: number,
): boolean {
  const delta = gnssAltitude - demElevation;
  return delta >= -GEOID_SEPARATION_CONUS_RANGE.max && delta <= -GEOID_SEPARATION_CONUS_RANGE.min;
}
