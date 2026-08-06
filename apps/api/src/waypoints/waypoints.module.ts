import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { PropertyRole, WaypointType } from '@prisma/client';
import { sunTimes, ThermalPhase, thermalPhaseAt } from '@hunt-maps/terrain';
import type { GeoPoint } from '@hunt-maps/shared';
import { AuthModule } from '../auth/auth.module';
import { TerrainModule } from '../terrain/terrain.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthedUser } from '../auth/current-user.decorator';
import { PropertyAccessService } from '../auth/property-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { GeometryService } from '../prisma/geometry.service';
import { TerrainService } from '../terrain/terrain.service';
import { DemService } from '../terrain/dem.service';

class CreateWaypointDto {
  @IsString() propertyId!: string;
  @IsEnum(WaypointType) type!: WaypointType;
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  /** GeoJSON Point. */
  @IsObject() location!: Record<string, unknown>;
  @IsOptional() @IsNumber() standHeightM?: number;
  @IsOptional() @IsArray() shootingLanesDeg?: number[];
  @IsOptional() @IsArray() huntableWinds?: string[];
  @IsOptional() @IsNumber() cameraDirectionDeg?: number;
  @IsOptional() @IsString() clientId?: string;
}

class UpdateWaypointDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @IsOptional() @IsObject() location?: Record<string, unknown>;
  @IsOptional() @IsNumber() standHeightM?: number;
  @IsOptional() @IsArray() shootingLanesDeg?: number[];
  @IsOptional() @IsArray() huntableWinds?: string[];
  @IsOptional() @IsNumber() cameraDirectionDeg?: number;
  @IsOptional() @IsBoolean() archived?: boolean;
  /** Version the client last saw. Omitting it opts out of conflict detection. */
  @IsOptional() @IsInt() @Min(1) baseVersion?: number;
}

@Injectable()
export class WaypointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geometry: GeometryService,
    private readonly access: PropertyAccessService,
    private readonly terrain: TerrainService,
    private readonly dem: DemService,
  ) {}

  async list(userId: string, propertyId: string, includeArchived = false) {
    await this.access.require(userId, propertyId);
    const rows = await this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id, "propertyId", type, name, notes, "elevationM", "standHeightM",
              "shootingLanesDeg", "huntableWinds", "cameraDirectionDeg",
              "lastCheckedAt", archived, "createdAt", "updatedAt", version,
              ST_AsGeoJSON(location)::json AS location
       FROM "Waypoint"
       WHERE "propertyId" = $1 ${includeArchived ? '' : 'AND archived = false'}
       ORDER BY type, name`,
      propertyId,
    );
    return rows;
  }

  async create(userId: string, dto: CreateWaypointDto) {
    await this.access.require(userId, dto.propertyId, PropertyRole.HUNTER);
    const location = dto.location as unknown as GeoPoint;
    assertPoint(location);

    // Replaying an offline queue must be idempotent: the device may have
    // already succeeded and lost the response before going dark.
    if (dto.clientId) {
      const existing = await this.prisma.waypoint.findUnique({
        where: { clientId: dto.clientId },
        select: { id: true },
      });
      if (existing) return this.getOne(existing.id);
    }

    const created = await this.prisma.waypoint.create({
      data: {
        propertyId: dto.propertyId,
        type: dto.type,
        name: dto.name,
        notes: dto.notes,
        standHeightM: dto.standHeightM,
        shootingLanesDeg: dto.shootingLanesDeg ?? [],
        huntableWinds: dto.huntableWinds ?? [],
        cameraDirectionDeg: dto.cameraDirectionDeg,
        clientId: dto.clientId,
      },
    });

    // `location` is nullable in the Prisma schema only because Prisma Client
    // cannot create rows carrying required `Unsupported()` columns. The
    // migration reinstates NOT NULL in SQL, and the write below runs in the
    // same request, so a row never survives without geometry.

    await this.writeLocation(created.id, location);
    await this.attachElevation(created.id, location);
    return this.getOne(created.id);
  }

  async update(userId: string, id: string, dto: UpdateWaypointDto) {
    const current = await this.prisma.waypoint.findUniqueOrThrow({
      where: { id },
      select: { propertyId: true, version: true },
    });
    await this.access.require(userId, current.propertyId, PropertyRole.HUNTER);

    // Optimistic concurrency. Two people editing the same stand from separate
    // devices — one offline at camp, one on the road — is a normal Saturday for
    // a hunting party, and last-write-wins silently discards one of them.
    if (dto.baseVersion !== undefined && dto.baseVersion !== current.version) {
      throw new ConflictException({
        message: 'This waypoint changed on the server since you last loaded it.',
        serverVersion: current.version,
        yourVersion: dto.baseVersion,
      });
    }

    if (dto.location) {
      const location = dto.location as unknown as GeoPoint;
      assertPoint(location);
      await this.writeLocation(id, location);
      await this.attachElevation(id, location);
    }

    await this.prisma.waypoint.update({
      where: { id },
      data: {
        name: dto.name,
        notes: dto.notes,
        standHeightM: dto.standHeightM,
        shootingLanesDeg: dto.shootingLanesDeg,
        huntableWinds: dto.huntableWinds,
        cameraDirectionDeg: dto.cameraDirectionDeg,
        archived: dto.archived,
        version: { increment: 1 },
      },
    });
    return this.getOne(id);
  }

  async remove(userId: string, id: string): Promise<{ ok: true }> {
    const current = await this.prisma.waypoint.findUniqueOrThrow({
      where: { id },
      select: { propertyId: true },
    });
    await this.access.require(userId, current.propertyId, PropertyRole.HUNTER);
    await this.prisma.waypoint.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Wind and thermal analysis for a stand.
   *
   * ## Why this blends two wind models
   *
   * A stand's "huntable winds" list is almost always written for the *synoptic*
   * wind — the forecast direction. That is the right answer in the middle of
   * the day and the wrong one in the first and last hour of light, when
   * thermals dominate and can run opposite to the prevailing wind. A stand on
   * the upper edge of a draw is clean on a west wind at 10:00 and blowing
   * straight into the bedding below it at last light, as the cooling air sinks.
   *
   * Rating a stand without the thermal term is how hunters burn their best
   * setups, so the verdict here degrades to "marginal" whenever the two models
   * disagree materially, and says which one it is worried about.
   */
  async windCheck(
    userId: string,
    id: string,
    windFromDeg: number,
    atUtc?: string,
  ) {
    const waypoint = await this.prisma.waypoint.findUniqueOrThrow({
      where: { id },
      select: { propertyId: true, name: true, huntableWinds: true },
    });
    await this.access.require(userId, waypoint.propertyId);

    const location = (await this.geometry.readGeoJson('Waypoint', 'location', id)) as GeoPoint;
    if (!location) throw new BadRequestException('Waypoint has no location.');
    const [lng, lat] = location.coordinates;
    const at = atUtc ? new Date(atUtc) : new Date();

    const { sunrise, sunset } = sunTimes(at, lat, lng);
    const phase = thermalPhaseAt(at, sunrise, sunset);

    const sample = await this.terrain.samplePoint(
      lng,
      lat,
      14,
      this.dem.resolveSource(),
      windFromDeg,
      at,
    );

    const aspect = sample.aspectDeg ?? -1;
    // Rising thermals carry scent upslope (opposite the aspect); sinking
    // thermals carry it downslope (along the aspect).
    const thermalAzimuth =
      aspect < 0 ? null : phase === ThermalPhase.Rising ? (aspect + 180) % 360 : aspect;

    // Synoptic scent travels downwind, i.e. opposite the direction it comes from.
    const synopticAzimuth = (windFromDeg + 180) % 360;

    const reasons: string[] = [];
    let rating: 'good' | 'marginal' | 'burned' = 'good';

    const disagreement =
      thermalAzimuth === null
        ? 0
        : Math.abs(((thermalAzimuth - synopticAzimuth + 540) % 360) - 180);

    if (phase === ThermalPhase.Transition) {
      rating = 'marginal';
      reasons.push(
        'Thermals are switching within the hour — direction is unreliable right now.',
      );
    } else if (disagreement > 90) {
      rating = 'marginal';
      reasons.push(
        `Thermals (${phase}) are running ${Math.round(disagreement)}° off the forecast wind. ` +
          `Trust the thermal in the first and last hour of light.`,
      );
    }

    const exposure = sample.windExposure ?? 0;
    if (exposure > 0.5) {
      reasons.push('This face is windward — scent is pushed straight out across the slope.');
    } else if (exposure < -0.5) {
      reasons.push('Leeward face: scent will curl and swirl behind the crest.');
      if (rating === 'good') rating = 'marginal';
    }

    const octant = azimuthOctant(windFromDeg);
    if (waypoint.huntableWinds.length > 0 && !waypoint.huntableWinds.includes(octant)) {
      rating = 'burned';
      reasons.push(
        `You marked this stand huntable on ${waypoint.huntableWinds.join('/')} — ` +
          `today is ${octant}.`,
      );
    }

    return {
      waypointId: id,
      name: waypoint.name,
      atUtc: at.toISOString(),
      windFromDeg,
      windOctant: octant,
      thermalPhase: phase,
      thermalScentAzimuthDeg: thermalAzimuth,
      synopticScentAzimuthDeg: synopticAzimuth,
      scentCone: this.geometry.scentCone(location, synopticAzimuth, 400),
      thermalScentCone:
        thermalAzimuth === null
          ? null
          : this.geometry.scentCone(location, thermalAzimuth, 250, 30),
      terrain: sample,
      sunriseUtc: sunrise?.toISOString() ?? null,
      sunsetUtc: sunset?.toISOString() ?? null,
      rating,
      reasons,
    };
  }

  private async getOne(id: string) {
    const rows = await this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id, "propertyId", type, name, notes, "elevationM", "standHeightM",
              "shootingLanesDeg", "huntableWinds", "cameraDirectionDeg",
              archived, "createdAt", "updatedAt", version,
              ST_AsGeoJSON(location)::json AS location
       FROM "Waypoint" WHERE id = $1`,
      id,
    );
    return rows[0];
  }

  private async writeLocation(id: string, location: GeoPoint): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "Waypoint" SET location = ${this.geometry.geomFromGeoJson(location)}
      WHERE id = ${id}
    `;
  }

  /** Best-effort elevation stamp. A DEM outage must not block saving a stand. */
  private async attachElevation(id: string, location: GeoPoint): Promise<void> {
    try {
      const [lng, lat] = location.coordinates;
      const sample = await this.terrain.samplePoint(lng, lat, 14, this.dem.resolveSource());
      if (sample.elevationM !== undefined && Number.isFinite(sample.elevationM)) {
        await this.prisma.waypoint.update({
          where: { id },
          data: { elevationM: sample.elevationM },
        });
      }
    } catch {
      // Intentionally swallowed — see above.
    }
  }
}

@ApiTags('waypoints')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('waypoints')
export class WaypointsController {
  constructor(private readonly waypoints: WaypointsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthedUser,
    @Query('propertyId') propertyId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    if (!propertyId) throw new BadRequestException('propertyId is required.');
    return this.waypoints.list(user.id, propertyId, includeArchived === 'true');
  }

  @Post()
  create(@CurrentUser() user: AuthedUser, @Body() dto: CreateWaypointDto) {
    return this.waypoints.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: UpdateWaypointDto,
  ) {
    return this.waypoints.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.waypoints.remove(user.id, id);
  }

  /** Is this stand huntable on today's wind, accounting for thermals? */
  @Get(':id/wind-check')
  windCheck(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Query('wind') wind: string,
    @Query('at') at?: string,
  ) {
    const w = Number(wind);
    if (!Number.isFinite(w)) {
      throw new BadRequestException('wind (degrees the wind comes FROM) is required.');
    }
    return this.waypoints.windCheck(user.id, id, w, at);
  }
}

function assertPoint(location: unknown): asserts location is GeoPoint {
  const g = location as GeoPoint;
  if (
    !g ||
    g.type !== 'Point' ||
    !Array.isArray(g.coordinates) ||
    g.coordinates.length !== 2 ||
    !Number.isFinite(g.coordinates[0]) ||
    !Number.isFinite(g.coordinates[1]) ||
    Math.abs(g.coordinates[0]) > 180 ||
    Math.abs(g.coordinates[1]) > 90
  ) {
    throw new BadRequestException(
      'location must be a GeoJSON Point with [longitude, latitude] in range.',
    );
  }
}

export function azimuthOctant(deg: number): string {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

@Module({
  imports: [AuthModule, TerrainModule],
  controllers: [WaypointsController],
  providers: [WaypointsService],
  exports: [WaypointsService],
})
export class WaypointsModule {}
