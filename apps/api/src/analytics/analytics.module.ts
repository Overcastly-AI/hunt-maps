import {
  BadRequestException,
  Controller,
  Get,
  Injectable,
  Module,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  analyzeSelection,
  ASPECT_OCTANTS,
  bucketRelativeToSolar,
  describeSelection,
  pressureTrendLabel,
  sightingsPerSit,
  SLOPE_BANDS,
  type SelectionAnalysisDto,
} from '@hunt-maps/shared';
import { analyze, sunTimes, WEISS_LABELS, type WeissLandform } from '@hunt-maps/terrain';
import { AuthModule } from '../auth/auth.module';
import { TerrainModule } from '../terrain/terrain.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthedUser } from '../auth/current-user.decorator';
import { PropertyAccessService } from '../auth/property-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { GeometryService } from '../prisma/geometry.service';
import { DemService } from '../terrain/dem.service';

interface ObservationRow {
  observedAt: Date;
  kind: string;
  sex: string | null;
  estimatedAge: number | null;
  isBlankSit: boolean;
  slopeDeg: number | null;
  aspectDeg: number | null;
  landformClass: number | null;
  pressureTrend3h: number | null;
  windFromDeg: number | null;
  lng: number;
  lat: number;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geometry: GeometryService,
    private readonly access: PropertyAccessService,
    private readonly dem: DemService,
  ) {}

  /**
   * Compute (and cache) the property's terrain availability distribution.
   *
   * This is the denominator that makes selection analysis mean anything — see
   * `@hunt-maps/shared`'s `analyzeSelection` for why a raw histogram is
   * misleading without it. It is expensive (a full raster pass over the
   * property) and stable, so it is materialised in `TerrainProfile` and only
   * recomputed when the boundary or DEM source changes.
   */
  async terrainProfile(propertyId: string, zoom = 13) {
    const existing = await this.prisma.terrainProfile.findUnique({ where: { propertyId } });
    const sourceVersion = `${this.dem.resolveSource().id}@z${zoom}`;
    if (existing && existing.sourceVersion === sourceVersion) return existing;

    const boundary = await this.geometry.readGeoJson('Property', 'boundary', propertyId);
    if (!boundary) {
      throw new BadRequestException(
        'This property has no boundary drawn. Availability-corrected analytics need one.',
      );
    }
    // `boundsOf` is an envelope (`ST_XMin/YMin/XMax/YMax`), not the parcel.
    // On anything non-rectangular — an L, a riverfront strip, a property
    // split by a road — the envelope includes ground the hunter does not
    // own, and every share below would be biased toward whatever terrain
    // dominates outside the real boundary (`R70`). `rasterizeMask` clips to
    // the actual polygon, in grid space, once, rather than a per-cell
    // `ST_Contains` — see its doc comment for the cost argument.
    const bbox = await this.geometry.boundsOf(boundary);
    const source = this.dem.resolveSource();
    const { grid, originTile } = await this.dem.gridForBBox(bbox, zoom, source, 24);
    const mask = this.geometry.rasterizeMask(
      boundary,
      (lng, lat) => this.dem.pixelInMosaic(lng, lat, originTile, source.tileSize),
      grid.width,
      grid.height,
    );
    const result = analyze(grid, {
      layers: ['elevation', 'slope', 'aspect', 'weiss', 'bench'],
    });

    const slopeShares = shareOf(
      result.slope!,
      SLOPE_BANDS.length,
      (v) => bandIndex(SLOPE_BANDS, v),
      mask,
    );
    const aspectShares = shareOf(
      result.aspect!,
      ASPECT_OCTANTS.length,
      (v) => (v < 0 ? -1 : bandIndex(ASPECT_OCTANTS, v)),
      mask,
    );
    const landformShares = shareOf(result.weiss!, 11, (v) => v, mask);

    let benchCount = 0;
    let benchTotal = 0;
    for (let i = 0; i < result.bench!.length; i++) {
      if (mask[i] === 0) continue;
      benchCount += result.bench![i];
      benchTotal++;
    }

    // `grid.range()` is left un-clipped: it walks the whole-mosaic buffer
    // inside `packages/terrain`, which this fix does not touch — the
    // envelope's elevation range is a display stat, not a selection-ratio
    // denominator, so it is out of scope for `R70`.
    const range = grid.range();
    let slopeSum = 0;
    let slopeN = 0;
    for (let i = 0; i < result.slope!.length; i++) {
      if (mask[i] === 0) continue;
      const s = result.slope![i];
      if (Number.isFinite(s)) {
        slopeSum += s;
        slopeN++;
      }
    }

    return this.prisma.terrainProfile.upsert({
      where: { propertyId },
      create: {
        propertyId,
        demSource: source.id,
        demZoom: zoom,
        cellSizeM: grid.cellSize,
        minElevationM: range.min,
        maxElevationM: range.max,
        meanSlopeDeg: slopeN > 0 ? slopeSum / slopeN : 0,
        slopeShares,
        aspectShares,
        landformShares,
        benchShare: benchTotal > 0 ? benchCount / benchTotal : 0,
        sourceVersion,
      },
      update: {
        demSource: source.id,
        demZoom: zoom,
        cellSizeM: grid.cellSize,
        minElevationM: range.min,
        maxElevationM: range.max,
        meanSlopeDeg: slopeN > 0 ? slopeSum / slopeN : 0,
        slopeShares,
        aspectShares,
        landformShares,
        benchShare: benchTotal > 0 ? benchCount / benchTotal : 0,
        sourceVersion,
        computedAt: new Date(),
      },
    });
  }

  /**
   * The movement analytics dashboard.
   *
   * Two design commitments run through this:
   *
   *  - **Effort-normalised.** Counts are divided by sits wherever possible.
   *    Raw sighting counts measure how often the hunter went out, not how the
   *    deer behaved, and the two are easy to confuse into a wrong conclusion.
   *  - **Solar-relative time.** Activity is bucketed against sunrise/sunset,
   *    never clock time. 07:00 is well after first light in December and well
   *    before it in September; binning by clock smears the dawn peak away.
   */
  async movement(
    userId: string,
    propertyId: string,
    options: { matureOnly?: boolean; since?: string } = {},
  ) {
    await this.access.require(userId, propertyId);
    const profile = await this.terrainProfile(propertyId);

    const params: unknown[] = [propertyId];
    const clauses = ['"propertyId" = $1'];
    if (options.since) {
      params.push(new Date(options.since));
      clauses.push(`"observedAt" >= $${params.length}`);
    }

    const rows = await this.prisma.$queryRawUnsafe<ObservationRow[]>(
      `SELECT "observedAt", kind::text, sex::text, "estimatedAge", "isBlankSit",
              "slopeDeg", "aspectDeg", "landformClass", "pressureTrend3h", "windFromDeg",
              ST_X(location) AS lng, ST_Y(location) AS lat
       FROM "Observation"
       WHERE ${clauses.join(' AND ')}`,
      ...params,
    );

    // "Mature buck" is the question every serious deer hunter is actually
    // asking, and it behaves differently enough from the general population
    // that mixing them washes out the signal.
    const isMature = (r: ObservationRow) => r.sex === 'BUCK' && (r.estimatedAge ?? 0) >= 3.5;
    const sightings = rows.filter(
      (r) =>
        !r.isBlankSit &&
        (r.kind === 'SIGHTING' || r.kind === 'TRAIL_CAMERA' || r.kind === 'HARVEST'),
    );
    const subject = options.matureOnly ? sightings.filter(isMature) : sightings;
    const sits = rows.filter((r) => r.kind === 'SIT' || r.isBlankSit).length + sightings.length;

    const solar = subject.map((r) => sunTimes(r.observedAt, r.lat, r.lng));

    const bySlope = this.selection(
      'slope',
      subject.map((r) => r.slopeDeg ?? NaN),
      SLOPE_BANDS,
      profile.slopeShares as number[],
    );
    const byAspect = this.selection(
      'aspect',
      subject.map((r) => r.aspectDeg ?? NaN),
      ASPECT_OCTANTS,
      profile.aspectShares as number[],
    );

    const landformShares = profile.landformShares as number[];
    const landformBins = landformShares.map((_, i) => ({
      label: WEISS_LABELS[i as WeissLandform] ?? `Class ${i}`,
      from: i,
      to: i + 1,
    }));
    const byLandform = analyzeSelection({
      metric: 'landform',
      bins: landformBins,
      usedValues: subject.map((r) => (r.landformClass ?? -1) + 0.5),
      availableShares: landformShares,
    });

    const pressureGroups = new Map<string, number>();
    for (const r of subject) {
      const label = pressureTrendLabel(r.pressureTrend3h ?? undefined);
      pressureGroups.set(label, (pressureGroups.get(label) ?? 0) + 1);
    }

    const windGroups = new Map<string, number>();
    for (const r of subject) {
      if (r.windFromDeg === null) continue;
      const oct = ASPECT_OCTANTS[bandIndex(ASPECT_OCTANTS, r.windFromDeg)]?.label ?? '?';
      windGroups.set(oct, (windGroups.get(oct) ?? 0) + 1);
    }

    return {
      propertyId,
      sampleSize: subject.length,
      sitCount: sits,
      sightingsPerSit: sightingsPerSit(subject.length, sits),
      matureOnly: options.matureOnly ?? false,
      relativeToSunrise: bucketRelativeToSolar(
        subject.map((r) => r.observedAt),
        solar.map((s) => s.sunrise),
      ),
      relativeToSunset: bucketRelativeToSolar(
        subject.map((r) => r.observedAt),
        solar.map((s) => s.sunset),
      ),
      byPressureTrend: [...pressureGroups.entries()].map(([label, count]) => ({
        label,
        count,
      })),
      byWindDirection: [...windGroups.entries()].map(([octant, count]) => ({ octant, count })),
      bySlopeBand: bySlope,
      byAspectOctant: byAspect,
      byLandform,
      readouts: {
        slope: describeSelection(bySlope),
        aspect: describeSelection(byAspect),
        landform: describeSelection(byLandform),
      },
      terrainProfile: {
        cellSizeM: profile.cellSizeM,
        meanSlopeDeg: profile.meanSlopeDeg,
        minElevationM: profile.minElevationM,
        maxElevationM: profile.maxElevationM,
        benchShare: profile.benchShare,
        demSource: profile.demSource,
      },
    };
  }

  private selection(
    metric: string,
    usedValues: number[],
    bins: typeof SLOPE_BANDS,
    availableShares: number[],
  ): SelectionAnalysisDto {
    return analyzeSelection({ metric, bins, usedValues, availableShares });
  }
}

/**
 * Fraction of finite, in-boundary cells falling in each bin.
 *
 * `mask`, when supplied, restricts the denominator to cells the `R70`
 * polygon rasterisation marked as inside the property — without it every
 * cell in the mosaic's bounding-box envelope counts, including ground the
 * hunter does not own.
 */
function shareOf(
  field: Float32Array | Uint8Array,
  binCount: number,
  toBin: (v: number) => number,
  mask?: Uint8Array,
): number[] {
  const counts = new Array<number>(binCount).fill(0);
  let total = 0;
  for (let i = 0; i < field.length; i++) {
    if (mask && mask[i] === 0) continue;
    const v = field[i];
    if (!Number.isFinite(v)) continue;
    const b = toBin(v);
    if (b >= 0 && b < binCount) {
      counts[b]++;
      total++;
    }
  }
  return total > 0 ? counts.map((c) => c / total) : counts;
}

function bandIndex(bins: Array<{ from: number; to: number }>, value: number): number {
  for (let i = 0; i < bins.length; i++) {
    const b = bins[i];
    if (b.from > b.to) {
      if (value >= b.from || value < b.to) return i;
    } else if (value >= b.from && value < b.to) {
      return i;
    }
  }
  return -1;
}

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('movement')
  movement(
    @CurrentUser() user: AuthedUser,
    @Query('propertyId') propertyId: string,
    @Query('matureOnly') matureOnly?: string,
    @Query('since') since?: string,
  ) {
    if (!propertyId) throw new BadRequestException('propertyId is required.');
    return this.analytics.movement(user.id, propertyId, {
      matureOnly: matureOnly === 'true',
      since,
    });
  }

  @Get('terrain-profile')
  async profile(@CurrentUser() user: AuthedUser, @Query('propertyId') propertyId: string) {
    if (!propertyId) throw new BadRequestException('propertyId is required.');
    return this.analytics.terrainProfile(propertyId);
  }
}

@Module({
  imports: [AuthModule, TerrainModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
