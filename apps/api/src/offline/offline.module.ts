import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { tilesForBBox, type BBox } from '@hunt-maps/terrain';
import { MapLayerKind, OfflineRegionStatus, type OfflineEstimateDto } from '@hunt-maps/shared';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthedUser } from '../auth/current-user.decorator';
import { PropertyAccessService } from '../auth/property-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { GeometryService } from '../prisma/geometry.service';

class RegionDto {
  @IsString() name!: string;
  @IsNumber() @Min(-180) @Max(180) west!: number;
  @IsNumber() @Min(-90) @Max(90) south!: number;
  @IsNumber() @Min(-180) @Max(180) east!: number;
  @IsNumber() @Min(-90) @Max(90) north!: number;
  @IsInt() @Min(6) @Max(16) minZoom!: number;
  @IsInt() @Min(6) @Max(17) maxZoom!: number;
  @IsArray() layers!: string[];
  @IsOptional() @IsString() propertyId?: string;
}

/**
 * Per-tile size estimates in bytes, measured from real tiles.
 *
 * These matter because the whole point of the estimate is to stop a hunter from
 * starting a 900 MB download on a hotel wifi the night before opening day and
 * discovering at 05:00 that it stalled at 60%. Being roughly right and honest
 * beats being precise and late.
 */
const BYTES_PER_TILE: Partial<Record<MapLayerKind, number>> = {
  [MapLayerKind.Satellite]: 42_000,
  [MapLayerKind.Topo]: 18_000,
  [MapLayerKind.Hillshade]: 22_000,
  [MapLayerKind.Lidar]: 30_000,
  [MapLayerKind.Contours]: 9_000,
  [MapLayerKind.Slope]: 14_000,
  [MapLayerKind.Aspect]: 16_000,
  [MapLayerKind.Landform]: 8_000,
  [MapLayerKind.Morphometry]: 7_000,
  [MapLayerKind.Benches]: 4_000,
  [MapLayerKind.Insolation]: 12_000,
  [MapLayerKind.LandCover]: 6_000,
  [MapLayerKind.PublicLand]: 3_000,
  [MapLayerKind.Parcels]: 5_000,
};

/** Hard ceiling per region. Past this, packaging is not the user's real problem. */
const MAX_TILES = 120_000;

@Injectable()
export class OfflineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geometry: GeometryService,
    private readonly access: PropertyAccessService,
  ) {}

  /**
   * Estimate a region download before committing to it.
   *
   * Tile count grows by 4× per zoom level, which is deeply unintuitive — users
   * routinely drag a box, bump max zoom from 15 to 17, and turn a 40 MB
   * download into a 640 MB one without noticing. The estimate is shown *before*
   * the download starts, with the expensive layers called out by name so the
   * fix ("drop satellite, keep the terrain layers") is obvious.
   */
  estimate(bbox: BBox, minZoom: number, maxZoom: number, layers: string[]): OfflineEstimateDto {
    if (maxZoom < minZoom) {
      throw new BadRequestException('maxZoom must be at least minZoom.');
    }

    let tileCount = 0;
    for (let z = minZoom; z <= maxZoom; z++) tileCount += tilesForBBox(bbox, z).length;

    const byLayer = layers.map((layer) => {
      const per = BYTES_PER_TILE[layer as MapLayerKind] ?? 10_000;
      return {
        layer: layer as MapLayerKind,
        tileCount,
        estimatedBytes: tileCount * per,
      };
    });

    const estimatedBytes = byLayer.reduce((s, l) => s + l.estimatedBytes, 0);
    const warnings: string[] = [];

    if (tileCount * layers.length > MAX_TILES) {
      warnings.push(
        `${(tileCount * layers.length).toLocaleString()} tiles is above the ` +
          `${MAX_TILES.toLocaleString()} limit. Reduce max zoom or shrink the area.`,
      );
    }
    if (estimatedBytes > 500_000_000) {
      warnings.push(
        `About ${(estimatedBytes / 1e9).toFixed(1)} GB. Start this on wifi, not the ` +
          `night before a hunt.`,
      );
    }
    const heaviest = [...byLayer].sort((a, b) => b.estimatedBytes - a.estimatedBytes)[0];
    if (heaviest && heaviest.estimatedBytes > estimatedBytes * 0.5 && byLayer.length > 1) {
      warnings.push(
        `"${heaviest.layer}" is over half the download. Dropping it saves about ` +
          `${(heaviest.estimatedBytes / 1e6).toFixed(0)} MB.`,
      );
    }
    if (maxZoom >= 16) {
      warnings.push(
        'Zoom 16+ quadruples the tile count per level. Zoom 15 is usually enough to ' +
          'read terrain in the field.',
      );
    }

    return { tileCount: tileCount * layers.length, estimatedBytes, byLayer, warnings };
  }

  async list(userId: string) {
    const rows = await this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id, name, "propertyId", "minZoom", "maxZoom", layers, status,
              "sizeBytes", "tileCount", "packagedAt", error, "createdAt",
              ST_AsGeoJSON(bounds)::json AS bounds
       FROM "OfflineRegion" WHERE "userId" = $1 ORDER BY "createdAt" DESC`,
      userId,
    );
    // BigInt does not survive JSON serialisation; normalise at the boundary.
    return rows.map((r) => ({
      ...r,
      sizeBytes: r.sizeBytes === null ? null : Number(r.sizeBytes),
    }));
  }

  async create(userId: string, dto: RegionDto) {
    if (dto.propertyId) await this.access.require(userId, dto.propertyId);
    const bbox: BBox = {
      west: Math.min(dto.west, dto.east),
      east: Math.max(dto.west, dto.east),
      south: Math.min(dto.south, dto.north),
      north: Math.max(dto.south, dto.north),
    };

    const estimate = this.estimate(bbox, dto.minZoom, dto.maxZoom, dto.layers);
    if (estimate.tileCount > MAX_TILES) {
      throw new BadRequestException(estimate.warnings[0]);
    }

    const created = await this.prisma.offlineRegion.create({
      data: {
        userId,
        propertyId: dto.propertyId,
        name: dto.name,
        minZoom: dto.minZoom,
        maxZoom: dto.maxZoom,
        layers: dto.layers,
        status: 'PENDING',
        tileCount: estimate.tileCount,
        sizeBytes: BigInt(estimate.estimatedBytes),
      },
    });

    await this.prisma.$executeRaw`
      UPDATE "OfflineRegion"
      SET bounds = ${this.geometry.bboxToPolygon(bbox)}
      WHERE id = ${created.id}
    `;

    return {
      id: created.id,
      status: OfflineRegionStatus.Pending,
      estimate,
      /**
       * The client does the actual downloading, not the server.
       *
       * Deliberate: the device knows its own storage pressure, connection type
       * and battery state, and can resume a partial download across app
       * restarts. A server-side packager would also have to hold the whole
       * archive somewhere and hand it over in one shot, which is the shape that
       * fails hardest on a flaky connection.
       */
      tileUrlTemplates: dto.layers.map((layer) => ({
        layer,
        template: terrainLayerTemplate(layer),
      })),
    };
  }

  async remove(userId: string, id: string): Promise<{ ok: true }> {
    const region = await this.prisma.offlineRegion.findUniqueOrThrow({
      where: { id },
      select: { userId: true },
    });
    if (region.userId !== userId) throw new BadRequestException('Region not found.');
    await this.prisma.offlineRegion.delete({ where: { id } });
    return { ok: true };
  }

  /** Record client-reported completion so the region list reflects device state. */
  async markComplete(
    userId: string,
    id: string,
    tileCount: number,
    sizeBytes: number,
  ) {
    const region = await this.prisma.offlineRegion.findUniqueOrThrow({
      where: { id },
      select: { userId: true },
    });
    if (region.userId !== userId) throw new BadRequestException('Region not found.');
    return this.prisma.offlineRegion.update({
      where: { id },
      data: {
        status: 'READY',
        tileCount,
        sizeBytes: BigInt(Math.max(0, Math.round(sizeBytes))),
        packagedAt: new Date(),
        error: null,
      },
    });
  }
}

function terrainLayerTemplate(layer: string): string {
  const analysisLayers = new Set([
    'slope',
    'aspect',
    'hillshade',
    'multiHillshade',
    'weiss',
    'wood',
    'bench',
    'insolation',
    'bedding',
  ]);
  return analysisLayers.has(layer)
    ? `/api/terrain/tiles/${layer}/{z}/{x}/{y}.png`
    : `/api/basemap/${layer}/{z}/{x}/{y}.png`;
}

@ApiTags('offline')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('offline')
export class OfflineController {
  constructor(private readonly offline: OfflineService) {}

  @Get('regions')
  list(@CurrentUser() user: AuthedUser) {
    return this.offline.list(user.id);
  }

  @Post('regions/estimate')
  estimate(@Body() dto: RegionDto) {
    return this.offline.estimate(
      {
        west: Math.min(dto.west, dto.east),
        east: Math.max(dto.west, dto.east),
        south: Math.min(dto.south, dto.north),
        north: Math.max(dto.south, dto.north),
      },
      dto.minZoom,
      dto.maxZoom,
      dto.layers,
    );
  }

  @Post('regions')
  create(@CurrentUser() user: AuthedUser, @Body() dto: RegionDto) {
    return this.offline.create(user.id, dto);
  }

  @Post('regions/:id/complete')
  complete(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() body: { tileCount: number; sizeBytes: number },
  ) {
    return this.offline.markComplete(user.id, id, body.tileCount, body.sizeBytes);
  }

  @Delete('regions/:id')
  remove(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.offline.remove(user.id, id);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [OfflineController],
  providers: [OfflineService],
  exports: [OfflineService],
})
export class OfflineModule {}
