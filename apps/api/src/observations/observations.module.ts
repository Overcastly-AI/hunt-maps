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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AnimalSex,
  ObservationKind,
  PropertyRole,
  RutPhase as PrismaRutPhase,
  SignType,
  Species,
} from '@prisma/client';
import { GameSpecies, readRut, RutPhase } from '@hunt-maps/shared';
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

class CreateObservationDto {
  @IsString() propertyId!: string;
  @IsEnum(ObservationKind) kind!: ObservationKind;
  @IsOptional() @IsEnum(Species) species?: Species;
  @IsOptional() @IsEnum(AnimalSex) sex?: AnimalSex;
  @IsOptional() @IsNumber() @Min(0) @Max(20) estimatedAge?: number;
  @IsOptional() @IsInt() @Min(0) count?: number;
  @IsOptional() @IsEnum(SignType) signType?: SignType;
  @IsObject() location!: Record<string, unknown>;
  @IsOptional() @IsNumber() travelHeadingDeg?: number;
  @IsString() observedAt!: string;
  @IsOptional() @IsString() waypointId?: string;

  @IsOptional() @IsNumber() temperatureC?: number;
  @IsOptional() @IsNumber() pressureHpa?: number;
  @IsOptional() @IsNumber() pressureTrend3h?: number;
  @IsOptional() @IsNumber() windSpeedKph?: number;
  @IsOptional() @IsNumber() windFromDeg?: number;
  @IsOptional() @IsNumber() humidityPct?: number;
  @IsOptional() @IsNumber() cloudCover?: number;
  @IsOptional() @IsNumber() precipitationMm?: number;
  @IsOptional() @IsNumber() moonPhase?: number;

  @IsOptional() @IsBoolean() isBlankSit?: boolean;
  @IsOptional() @IsInt() sitMinutes?: number;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @IsOptional() @IsString() clientId?: string;
}

const RUT_PHASE_TO_PRISMA: Record<RutPhase, PrismaRutPhase> = {
  [RutPhase.OffSeason]: PrismaRutPhase.OFF_SEASON,
  [RutPhase.PreRut]: PrismaRutPhase.PRE_RUT,
  [RutPhase.Seeking]: PrismaRutPhase.SEEKING,
  [RutPhase.Chasing]: PrismaRutPhase.CHASING,
  [RutPhase.PeakBreeding]: PrismaRutPhase.PEAK_BREEDING,
  [RutPhase.PostRut]: PrismaRutPhase.POST_RUT,
  [RutPhase.SecondRut]: PrismaRutPhase.SECOND_RUT,
  [RutPhase.LateSeason]: PrismaRutPhase.LATE_SEASON,
};

/**
 * Prisma's `Species` enum (SCREAMING_SNAKE_CASE, no runtime relation to
 * `@hunt-maps/shared`) mapped to `@hunt-maps/shared`'s `GameSpecies`, so an
 * observation's logged species can be threaded into `readRut` (R83). Every
 * member maps 1:1 — there is deliberately no fallback branch, so a species
 * added to one enum and not the other fails to compile instead of silently
 * defaulting.
 */
const SPECIES_TO_GAME_SPECIES: Record<Species, GameSpecies> = {
  [Species.WHITETAIL]: GameSpecies.Whitetail,
  [Species.MULE_DEER]: GameSpecies.Mule,
  [Species.BLACKTAIL]: GameSpecies.Blacktail,
  [Species.ELK]: GameSpecies.Elk,
  [Species.MOOSE]: GameSpecies.Moose,
  [Species.PRONGHORN]: GameSpecies.Pronghorn,
  [Species.BEAR]: GameSpecies.Bear,
  [Species.TURKEY]: GameSpecies.Turkey,
  [Species.HOG]: GameSpecies.Hog,
  [Species.OTHER]: GameSpecies.Other,
};

@Injectable()
export class ObservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geometry: GeometryService,
    private readonly access: PropertyAccessService,
    private readonly terrain: TerrainService,
    private readonly dem: DemService,
  ) {}

  async list(
    userId: string,
    propertyId: string,
    filters: { kind?: ObservationKind; species?: Species; sex?: AnimalSex; since?: string } = {},
  ) {
    await this.access.require(userId, propertyId);

    const clauses = ['"propertyId" = $1'];
    const params: unknown[] = [propertyId];
    if (filters.kind) {
      params.push(filters.kind);
      clauses.push(`kind = $${params.length}::"ObservationKind"`);
    }
    if (filters.species) {
      params.push(filters.species);
      clauses.push(`species = $${params.length}::"Species"`);
    }
    if (filters.sex) {
      params.push(filters.sex);
      clauses.push(`sex = $${params.length}::"AnimalSex"`);
    }
    if (filters.since) {
      params.push(new Date(filters.since));
      clauses.push(`"observedAt" >= $${params.length}`);
    }

    return this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id, "propertyId", "userId", "waypointId", kind, species, sex,
              "estimatedAge", count, "signType", "travelHeadingDeg", "observedAt",
              "rutPhase", "temperatureC", "pressureHpa", "pressureTrend3h",
              "windSpeedKph", "windFromDeg", "moonPhase", "isBlankSit", "sitMinutes",
              "elevationM", "slopeDeg", "aspectDeg", "landformClass", "morphometry",
              "isBench", ruggedness, "windExposure", insolation, notes, "createdAt", version,
              ST_AsGeoJSON(location)::json AS location
       FROM "Observation"
       WHERE ${clauses.join(' AND ')}
       ORDER BY "observedAt" DESC
       LIMIT 2000`,
      ...params,
    );
  }

  /**
   * Record an observation, stamping terrain at the point.
   *
   * ## Why terrain is denormalised onto the row
   *
   * Every habitat-selection query asks "what was the slope/aspect/landform where
   * this happened". Recomputing that from the DEM at query time would mean a
   * raster pass per observation on every analytics load — hundreds of tile
   * fetches to answer one chart. Stamping it once at write time makes the
   * analytics a plain SQL aggregate.
   *
   * The trade-off is that the stamp is tied to the DEM source and resolution
   * available when it was recorded. That is acceptable: it is a record of what
   * the ground was understood to be, and `demSource` is captured so a later
   * re-stamp against better LiDAR is possible and auditable.
   */
  async create(userId: string, dto: CreateObservationDto) {
    await this.access.require(userId, dto.propertyId, PropertyRole.HUNTER);
    const location = dto.location as unknown as GeoPoint;
    if (location?.type !== 'Point') {
      throw new BadRequestException('location must be a GeoJSON Point.');
    }

    if (dto.clientId) {
      const existing = await this.prisma.observation.findUnique({
        where: { clientId: dto.clientId },
        select: { id: true },
      });
      if (existing) return this.getOne(existing.id);
    }

    const property = await this.prisma.property.findUniqueOrThrow({
      where: { id: dto.propertyId },
      select: { centerLat: true, rutOffsetDays: true },
    });

    const observedAt = new Date(dto.observedAt);
    if (Number.isNaN(observedAt.getTime())) {
      throw new BadRequestException('observedAt must be a valid ISO timestamp.');
    }
    // A future-dated observation is a data-entry slip (usually a timezone
    // mistake); accepting it corrupts every time-series chart downstream.
    if (observedAt.getTime() > Date.now() + 3600_000) {
      throw new BadRequestException('observedAt is in the future.');
    }

    // dto.species is optional — an unspecified species (e.g. a generic sign
    // log) keeps today's behaviour (the Whitetail default in readRut()); a
    // species that is *positively known* and is not whitetail (elk, above
    // all — R83) gets a refusal instead of an inverted phase.
    const rut =
      property.centerLat !== null
        ? readRut(observedAt, {
            latitude: property.centerLat,
            offsetDays: property.rutOffsetDays ?? undefined,
            species: dto.species ? SPECIES_TO_GAME_SPECIES[dto.species] : undefined,
          })
        : null;

    const created = await this.prisma.observation.create({
      data: {
        propertyId: dto.propertyId,
        userId,
        waypointId: dto.waypointId,
        kind: dto.kind,
        species: dto.species,
        sex: dto.sex,
        estimatedAge: dto.estimatedAge,
        count: dto.count ?? 1,
        signType: dto.signType,
        travelHeadingDeg: dto.travelHeadingDeg,
        observedAt,
        // `rut` is `null` (no property latitude), a refusal (`supported: false`
        // — species this model has no basis for, R83), or a real reading.
        // Only the last one is worth a column value; the others leave
        // `rutPhase` unset rather than storing a guess.
        rutPhase: rut && rut.supported ? RUT_PHASE_TO_PRISMA[rut.phase] : undefined,
        temperatureC: dto.temperatureC,
        pressureHpa: dto.pressureHpa,
        pressureTrend3h: dto.pressureTrend3h,
        windSpeedKph: dto.windSpeedKph,
        windFromDeg: dto.windFromDeg,
        humidityPct: dto.humidityPct,
        cloudCover: dto.cloudCover,
        precipitationMm: dto.precipitationMm,
        moonPhase: dto.moonPhase,
        isBlankSit: dto.isBlankSit ?? false,
        sitMinutes: dto.sitMinutes,
        notes: dto.notes,
        clientId: dto.clientId,
      },
    });

    await this.prisma.$executeRaw`
      UPDATE "Observation" SET location = ${this.geometry.geomFromGeoJson(location)}
      WHERE id = ${created.id}
    `;
    await this.stampTerrain(created.id, location, dto.windFromDeg, observedAt);
    return this.getOne(created.id);
  }

  async remove(userId: string, id: string): Promise<{ ok: true }> {
    const current = await this.prisma.observation.findUniqueOrThrow({
      where: { id },
      select: { propertyId: true, userId: true },
    });
    const role = await this.access.require(userId, current.propertyId, PropertyRole.HUNTER);
    // A hunter may delete their own records; removing someone else's needs
    // manager rights. Observations are the analytics substrate — silently
    // letting anyone prune them would make the numbers unaccountable.
    if (current.userId !== userId && role === PropertyRole.HUNTER) {
      throw new BadRequestException('You can only delete observations you recorded.');
    }
    await this.prisma.observation.delete({ where: { id } });
    return { ok: true };
  }

  private async getOne(id: string) {
    const rows = await this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT *, ST_AsGeoJSON(location)::json AS location FROM "Observation" WHERE id = $1`,
      id,
    );
    return rows[0];
  }

  private async stampTerrain(
    id: string,
    location: GeoPoint,
    windFromDeg: number | undefined,
    at: Date,
  ): Promise<void> {
    try {
      const [lng, lat] = location.coordinates;
      const s = await this.terrain.samplePoint(
        lng,
        lat,
        14,
        this.dem.resolveSource(),
        windFromDeg,
        at,
      );
      await this.prisma.observation.update({
        where: { id },
        data: {
          elevationM: finite(s.elevationM),
          slopeDeg: finite(s.slopeDeg),
          aspectDeg: finite(s.aspectDeg),
          landformClass: s.landform ?? null,
          morphometry: s.morphometry ?? null,
          isBench: s.isBench ?? null,
          ruggedness: finite(s.ruggedness),
          windExposure: finite(s.windExposure),
          insolation: finite(s.insolation),
        },
      });
    } catch {
      // A DEM outage must never block logging sign in the field. The row is
      // saved without terrain and can be re-stamped later.
    }
  }
}

function finite(v: number | undefined): number | null {
  return v !== undefined && Number.isFinite(v) ? v : null;
}

@ApiTags('observations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('observations')
export class ObservationsController {
  constructor(private readonly observations: ObservationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthedUser,
    @Query('propertyId') propertyId: string,
    @Query('kind') kind?: ObservationKind,
    @Query('species') species?: Species,
    @Query('sex') sex?: AnimalSex,
    @Query('since') since?: string,
  ) {
    if (!propertyId) throw new BadRequestException('propertyId is required.');
    return this.observations.list(user.id, propertyId, { kind, species, sex, since });
  }

  @Post()
  create(@CurrentUser() user: AuthedUser, @Body() dto: CreateObservationDto) {
    return this.observations.create(user.id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.observations.remove(user.id, id);
  }
}

@Module({
  imports: [AuthModule, TerrainModule],
  controllers: [ObservationsController],
  providers: [ObservationsService],
  exports: [ObservationsService],
})
export class ObservationsModule {}
