import {
  BadRequestException,
  Body,
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
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PRESET_FILTERS, validatePredicate, type TerrainPredicate } from '@hunt-maps/terrain';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthedUser } from '../auth/current-user.decorator';
import { PropertyAccessService } from '../auth/property-access.service';
import { PrismaService } from '../prisma/prisma.service';

class SaveFilterDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsObject() predicate!: Record<string, unknown>;
  @IsOptional() @IsString() propertyId?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1) opacity?: number;
  @IsOptional() @IsBoolean() outline?: boolean;
  @IsOptional() @IsBoolean() sharedPublicly?: boolean;
  @IsOptional() @IsString() clientId?: string;
}

class UpdateFilterDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsObject() predicate?: Record<string, unknown>;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1) opacity?: number;
  @IsOptional() @IsBoolean() outline?: boolean;
  @IsOptional() @IsBoolean() sharedPublicly?: boolean;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

@Injectable()
export class FiltersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PropertyAccessService,
  ) {}

  /**
   * A user's filter library.
   *
   * Filters live on the *user*, not the property, by default. A hunter's
   * "leeward benches" query is a way of thinking about ground, and it should
   * follow them to a new lease rather than being stranded on the old one.
   * `propertyId` is available for the cases that genuinely are property-specific.
   */
  async list(userId: string, propertyId?: string) {
    if (propertyId) await this.access.require(userId, propertyId);
    return this.prisma.savedFilter.findMany({
      where: {
        ownerId: userId,
        ...(propertyId ? { OR: [{ propertyId }, { propertyId: null }] } : {}),
      },
      orderBy: [{ isPreset: 'desc' }, { name: 'asc' }],
    });
  }

  /** The built-in starter library, so a new account is not staring at an empty list. */
  presets() {
    return PRESET_FILTERS.map((f: (typeof PRESET_FILTERS)[number]) => ({
      ...f,
      isPreset: true,
    }));
  }

  async create(userId: string, dto: SaveFilterDto) {
    const predicate = this.assertPredicate(dto.predicate);
    if (dto.propertyId) await this.access.require(userId, dto.propertyId);
    if (dto.color && !HEX.test(dto.color)) {
      throw new BadRequestException('color must be a #rrggbb hex value.');
    }

    if (dto.clientId) {
      const existing = await this.prisma.savedFilter.findUnique({
        where: { clientId: dto.clientId },
      });
      if (existing) return existing;
    }

    return this.prisma.savedFilter.create({
      data: {
        ownerId: userId,
        propertyId: dto.propertyId,
        name: dto.name,
        description: dto.description,
        predicate: predicate as object,
        color: dto.color ?? '#e8a33d',
        opacity: dto.opacity ?? 0.5,
        outline: dto.outline ?? true,
        sharedPublicly: dto.sharedPublicly ?? false,
        clientId: dto.clientId,
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateFilterDto) {
    const current = await this.prisma.savedFilter.findUniqueOrThrow({ where: { id } });
    if (current.ownerId !== userId) {
      // 404 rather than 403 — a 403 confirms the id exists and belongs to
      // someone, which is more than a stranger should learn.
      throw new BadRequestException('Filter not found.');
    }
    const predicate = dto.predicate ? this.assertPredicate(dto.predicate) : undefined;
    if (dto.color && !HEX.test(dto.color)) {
      throw new BadRequestException('color must be a #rrggbb hex value.');
    }

    return this.prisma.savedFilter.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        predicate: predicate as object | undefined,
        color: dto.color,
        opacity: dto.opacity,
        outline: dto.outline,
        sharedPublicly: dto.sharedPublicly,
        version: { increment: 1 },
        // Editing the predicate invalidates any materialised match geometry.
        ...(predicate ? { matchedArea: undefined, computedAt: null, computeKey: null } : {}),
      },
    });
  }

  async remove(userId: string, id: string): Promise<{ ok: true }> {
    const current = await this.prisma.savedFilter.findUniqueOrThrow({ where: { id } });
    if (current.ownerId !== userId) throw new BadRequestException('Filter not found.');
    await this.prisma.savedFilter.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Import a publicly shared filter into your own library.
   *
   * Copies rather than references, deliberately: a shared filter you have
   * adopted should not change under you because the author edited theirs. It is
   * re-validated on the way in even though it was validated on the way out —
   * the database is not a trust boundary we want to rely on for something that
   * feeds a render loop.
   */
  async importShared(userId: string, id: string) {
    const source = await this.prisma.savedFilter.findUniqueOrThrow({ where: { id } });
    if (!source.sharedPublicly && source.ownerId !== userId) {
      throw new BadRequestException('That filter is not shared.');
    }
    const predicate = this.assertPredicate(source.predicate as Record<string, unknown>);

    return this.prisma.savedFilter.create({
      data: {
        ownerId: userId,
        name: source.name,
        description: source.description,
        predicate: predicate as object,
        color: source.color,
        opacity: source.opacity,
        outline: source.outline,
      },
    });
  }

  private assertPredicate(raw: unknown): TerrainPredicate {
    if (!validatePredicate(raw)) {
      throw new BadRequestException(
        'Filter predicate is not valid. Check metric names, nesting depth and operand counts.',
      );
    }
    return raw;
  }
}

@ApiTags('filters')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('filters')
export class FiltersController {
  constructor(private readonly filters: FiltersService) {}

  @Get()
  list(@CurrentUser() user: AuthedUser, @Query('propertyId') propertyId?: string) {
    return this.filters.list(user.id, propertyId);
  }

  @Get('presets')
  presets() {
    return this.filters.presets();
  }

  @Post()
  create(@CurrentUser() user: AuthedUser, @Body() dto: SaveFilterDto) {
    return this.filters.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: UpdateFilterDto,
  ) {
    return this.filters.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.filters.remove(user.id, id);
  }

  @Post(':id/import')
  importShared(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.filters.importShared(user.id, id);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [FiltersController],
  providers: [FiltersService],
  exports: [FiltersService],
})
export class FiltersModule {}
