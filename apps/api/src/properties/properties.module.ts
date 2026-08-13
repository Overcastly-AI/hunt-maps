import { Module } from '@nestjs/common';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Injectable } from '@nestjs/common';
import { IsEnum, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PropertyRole, Species } from '@prisma/client';
import { readRut, type GeoGeometry, type RutResult } from '@hunt-maps/shared';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthedUser } from '../auth/current-user.decorator';
import { PropertyAccessService } from '../auth/property-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { GeometryService } from '../prisma/geometry.service';
import { SPECIES_TO_GAME_SPECIES } from '../common/species-mapping';

class CreatePropertyDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  /** GeoJSON Polygon or MultiPolygon outlining the ground. */
  @IsObject() boundary!: Record<string, unknown>;
  @IsOptional() @IsString() timezone?: string;
  /** The species this property's rut modelling should target. See `Property.targetSpecies` in schema.prisma for why this is optional and has no default. */
  @IsOptional() @IsEnum(Species) targetSpecies?: Species;
}

class UpdatePropertyDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsObject() boundary?: Record<string, unknown>;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsEnum(Species) targetSpecies?: Species;
}

/**
 * Compute the rut reading for a property, or withhold it.
 *
 * `centerLat === null` (no boundary yet) and `targetSpecies === null` ("not
 * stated") are both treated as insufficient basis for a reading — the second
 * one deliberately does *not* fall back to `readRut`'s own species-omitted
 * default (which resolves to the whitetail overload), because that fallback
 * exists for callers that predate species-awareness, not for a property that
 * has been asked and has not answered. See the migration comment on
 * `targetSpecies` (`20260811000000_property_target_species`) for the full
 * trade-off. A stated species — including a stated `WHITETAIL` — is passed
 * through to `readRut` for real, which is what lets a stated non-whitetail
 * species (elk, above all — R83) reach the refusal branch (`RutUnsupported`)
 * instead of being silently coerced into one.
 */
export function propertyRut(property: {
  centerLat: number | null;
  targetSpecies: Species | null;
  rutOffsetDays: number | null;
}): RutResult | null {
  if (property.centerLat === null || property.targetSpecies === null) return null;
  return readRut(new Date(), {
    latitude: property.centerLat,
    offsetDays: property.rutOffsetDays ?? undefined,
    species: SPECIES_TO_GAME_SPECIES[property.targetSpecies],
  });
}

class AddMemberDto {
  @IsString() email!: string;
  @IsString() role!: keyof typeof PropertyRole;
}

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geometry: GeometryService,
    private readonly access: PropertyAccessService,
  ) {}

  async list(userId: string) {
    const ids = await this.access.visiblePropertyIds(userId);
    const rows = await this.prisma.property.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        description: true,
        areaHectares: true,
        centerLat: true,
        centerLng: true,
        timezone: true,
        ownerId: true,
        createdAt: true,
        targetSpecies: true,
        rutOffsetDays: true,
        _count: { select: { waypoints: true, observations: true } },
      },
      orderBy: { name: 'asc' },
    });

    // The rut reading is per-property because it depends on latitude and the
    // property's own calibration — a hunter with ground in Michigan and Alabama
    // is genuinely in two different phases on the same day. It is also now
    // species-aware (R83): a property with a stated non-whitetail species
    // (elk, above all) gets `readRut`'s refusal (`RutUnsupported`) here
    // instead of a confidently wrong whitetail phase, and a property with no
    // stated species gets no reading at all rather than a silent whitetail
    // assumption. See `propertyRut` above.
    return rows.map(({ rutOffsetDays, ...p }) => ({
      ...p,
      rut: propertyRut({ ...p, rutOffsetDays }),
    }));
  }

  async get(userId: string, id: string) {
    await this.access.require(userId, id);
    const property = await this.prisma.property.findUniqueOrThrow({
      where: { id },
      include: {
        memberships: {
          select: { role: true, user: { select: { id: true, displayName: true, email: true } } },
        },
        terrainProfile: true,
      },
    });
    const boundary = await this.geometry.readGeoJson('Property', 'boundary', id);
    return {
      ...property,
      boundary,
      // See the list() comment above — species-aware via `propertyRut`.
      rut: propertyRut(property),
    };
  }

  async create(userId: string, dto: CreatePropertyDto) {
    const boundary = dto.boundary as unknown as GeoGeometry;
    const extent = await this.geometry.validateExtent(boundary);
    if (!extent.ok) throw new BadRequestException(extent.reason);

    const centroid = await this.geometry.centroid(boundary);

    const created = await this.prisma.property.create({
      data: {
        name: dto.name,
        description: dto.description,
        ownerId: userId,
        timezone: dto.timezone ?? 'UTC',
        areaHectares: extent.areaHectares,
        centerLat: centroid.lat,
        centerLng: centroid.lng,
        targetSpecies: dto.targetSpecies,
        memberships: { create: { userId, role: PropertyRole.OWNER } },
      },
    });

    await this.writeGeometry(created.id, boundary);
    return this.get(userId, created.id);
  }

  async update(userId: string, id: string, dto: UpdatePropertyDto) {
    await this.access.require(userId, id, PropertyRole.MANAGER);

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.timezone !== undefined) data.timezone = dto.timezone;
    // Explicit species-setting is how a property leaves "not stated" — see
    // `targetSpecies` in schema.prisma. There is deliberately no way to send
    // `targetSpecies: null` here (the DTO field is `Species | undefined`,
    // never `null`): un-stating a species once it is set is not a use case
    // this endpoint needs to support, so there is no path back to the
    // withheld-reading state other than never having set it.
    if (dto.targetSpecies !== undefined) data.targetSpecies = dto.targetSpecies;

    if (dto.boundary) {
      const boundary = dto.boundary as unknown as GeoGeometry;
      const extent = await this.geometry.validateExtent(boundary);
      if (!extent.ok) throw new BadRequestException(extent.reason);
      const centroid = await this.geometry.centroid(boundary);
      data.areaHectares = extent.areaHectares;
      data.centerLat = centroid.lat;
      data.centerLng = centroid.lng;
      await this.writeGeometry(id, boundary);

      // The cached terrain profile is keyed to the boundary; a redrawn boundary
      // makes every availability share in the analytics wrong until it is
      // recomputed, so drop it rather than serve stale denominators.
      await this.prisma.terrainProfile.deleteMany({ where: { propertyId: id } });
    }

    await this.prisma.property.update({ where: { id }, data });
    return this.get(userId, id);
  }

  async remove(userId: string, id: string): Promise<{ ok: true }> {
    await this.access.require(userId, id, PropertyRole.OWNER);
    await this.prisma.property.delete({ where: { id } });
    return { ok: true };
  }

  async addMember(userId: string, propertyId: string, dto: AddMemberDto) {
    await this.access.require(userId, propertyId, PropertyRole.MANAGER);
    const role = PropertyRole[dto.role];
    if (!role) throw new BadRequestException(`Unknown role "${dto.role}".`);

    const member = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
      select: { id: true },
    });
    if (!member) throw new BadRequestException('No account found for that email.');

    await this.prisma.propertyMembership.upsert({
      where: { propertyId_userId: { propertyId, userId: member.id } },
      create: { propertyId, userId: member.id, role },
      update: { role },
    });
    return this.get(userId, propertyId);
  }

  async removeMember(userId: string, propertyId: string, memberId: string) {
    await this.access.require(userId, propertyId, PropertyRole.MANAGER);
    const property = await this.prisma.property.findUniqueOrThrow({
      where: { id: propertyId },
      select: { ownerId: true },
    });
    // Removing the owner would orphan the property; there is no recovery path.
    if (property.ownerId === memberId) {
      throw new BadRequestException('Transfer ownership before removing the owner.');
    }
    await this.prisma.propertyMembership.deleteMany({
      where: { propertyId, userId: memberId },
    });
    return this.get(userId, propertyId);
  }

  private async writeGeometry(id: string, boundary: GeoGeometry): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "Property"
      SET boundary = ${this.geometry.multiPolygonFromGeoJson(boundary)},
          centroid = ST_Centroid(${this.geometry.geomFromGeoJson(boundary)})
      WHERE id = ${id}
    `;
  }
}

@ApiTags('properties')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('properties')
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Get()
  list(@CurrentUser() user: AuthedUser) {
    return this.properties.list(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.properties.get(user.id, id);
  }

  @Post()
  create(@CurrentUser() user: AuthedUser, @Body() dto: CreatePropertyDto) {
    return this.properties.create(user.id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() dto: UpdatePropertyDto) {
    return this.properties.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.properties.remove(user.id, id);
  }

  @Post(':id/members')
  addMember(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() dto: AddMemberDto) {
    return this.properties.addMember(user.id, id, dto);
  }

  @Delete(':id/members/:memberId')
  removeMember(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
  ) {
    return this.properties.removeMember(user.id, id, memberId);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [PropertiesController],
  providers: [PropertiesService],
  exports: [PropertiesService],
})
export class PropertiesModule {}
