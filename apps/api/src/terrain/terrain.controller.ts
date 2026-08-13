import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { validatePredicate, type AnalysisLayer, type TerrainPredicate } from '@hunt-maps/terrain';
import { DEM_SOURCES, DemService } from './dem.service';
import { Dem3depService } from './dem3dep.service';
import { TerrainService } from './terrain.service';
import { CorridorService } from './corridor.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const RENDERABLE_LAYERS: AnalysisLayer[] = [
  'slope',
  'aspect',
  'hillshade',
  'multiHillshade',
  'weiss',
  'wood',
  'bench',
  'insolation',
  'bedding',
];

class BBoxDto {
  @IsNumber() @Min(-180) @Max(180) west!: number;
  @IsNumber() @Min(-90) @Max(90) south!: number;
  @IsNumber() @Min(-180) @Max(180) east!: number;
  @IsNumber() @Min(-90) @Max(90) north!: number;
}

class EvaluateFilterDto {
  @ValidateNested() @Type(() => BBoxDto) bbox!: BBoxDto;
  @IsNumber() @Min(8) @Max(16) zoom!: number;
  @IsObject() predicate!: Record<string, unknown>;
  @IsOptional() @IsString() demSource?: string;
  @IsOptional() @IsNumber() windFromDeg?: number;
  @IsOptional() @IsString() atUtc?: string;
}

class CorridorDto {
  @ValidateNested() @Type(() => BBoxDto) bbox!: BBoxDto;
  @IsNumber() @Min(8) @Max(16) zoom!: number;
  @IsObject() from!: Record<string, unknown>;
  @IsObject() to!: Record<string, unknown>;
  @IsOptional() @IsNumber() @Min(0) @Max(2) toleranceFraction?: number;
  @IsOptional() @IsBoolean() useBeddingAttraction?: boolean;
  @IsOptional() @IsNumber() windFromDeg?: number;
  @IsOptional() @IsString() demSource?: string;
  @IsOptional() @IsNumber() @Min(1) @Max(12) maxLines?: number;
}

class FilterStackEntryDto {
  @IsObject() predicate!: Record<string, unknown>;
  @IsString() color!: string;
  @IsNumber() @Min(0) @Max(1) opacity!: number;
  @IsOptional() @IsBoolean() outline?: boolean;
}

class FilterStackDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FilterStackEntryDto)
  filters!: FilterStackEntryDto[];
  @IsOptional() @IsString() demSource?: string;
  @IsOptional() @IsNumber() windFromDeg?: number;
  @IsOptional() @IsString() atUtc?: string;
}

@ApiTags('terrain')
@Controller('terrain')
export class TerrainController {
  constructor(
    private readonly dem: DemService,
    private readonly threeDep: Dem3depService,
    private readonly terrain: TerrainService,
    private readonly corridors: CorridorService,
  ) {}

  @Get('sources')
  sources() {
    return (
      Object.values(DEM_SOURCES)
        // A `tiles` source with no template cannot serve anything; a `3dep`
        // source needs no template because this server renders it.
        .filter((s) => s.kind === '3dep' || s.urlTemplate)
        .map(({ id, label, encoding, tileSize, maxZoom, attribution, resolutionNote }) => ({
          id,
          label,
          encoding,
          tileSize,
          maxZoom,
          attribution,
          // Shipped to the client deliberately. The client must be able to say
          // what it is showing, and the difference between "~10 m bare earth"
          // and "1 m LiDAR" is the difference between a useful layer and an
          // overclaim.
          resolutionNote,
        }))
    );
  }

  /**
   * Raw elevation tiles, including real USGS 3DEP.
   *
   * Unauthenticated for the same reason the analysis tiles are: this is
   * public-domain elevation and contains nothing about any user, and requiring
   * a token would break offline pre-caching.
   *
   * `X-Dem-*` response headers report what actually answered — product,
   * resolution, coverage and the contributing 1 m acquisition projects. The
   * client is expected to surface that rather than assume, which is what keeps
   * a fallback *visible*.
   */
  @Get('dem/:source/:z/:x/:y.png')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'public, max-age=604800, immutable')
  async demTile(
    @Param('source') sourceId: string,
    @Param('z', ParseIntPipe) z: number,
    @Param('x', ParseIntPipe) x: number,
    @Param('y', ParseIntPipe) y: number,
    @Res() res: Response,
  ): Promise<void> {
    const source = this.dem.resolveSource(sourceId);
    const n = 2 ** z;
    if (z < 0 || z > 22 || x < 0 || x >= n || y < 0 || y >= n) {
      throw new BadRequestException(`Tile ${z}/${x}/${y} is outside the Web Mercator grid.`);
    }
    const buffer = await this.dem.fetchTile({ z, x, y }, source);
    res.setHeader('X-Dem-Source', source.id);
    res.setHeader('X-Dem-Encoding', source.encoding);
    res.send(buffer);
  }

  /**
   * What elevation data actually exists at a point.
   *
   * The endpoint that makes an honest fallback possible: it answers "is there
   * 1 m LiDAR here", by name of the acquisition project and with a sampled
   * height, rather than leaving the client to infer coverage from a blank tile.
   */
  @Get('dem/coverage')
  async demCoverage(@Query('lng') lng?: string, @Query('lat') lat?: string) {
    const lngNum = Number(lng);
    const latNum = Number(lat);
    if (!Number.isFinite(lngNum) || !Number.isFinite(latNum)) {
      throw new BadRequestException('lng and lat are required and must be numbers.');
    }
    if (lngNum < -180 || lngNum > 180 || latNum < -85 || latNum > 85) {
      throw new BadRequestException('lng/lat out of range.');
    }
    const oneMeter = await this.threeDep.resolveOneMeter(lngNum, latNum);
    return {
      lng: lngNum,
      lat: latNum,
      oneMeter,
      // The source a client should pick, and the words it should show. Chosen
      // here rather than in the client so the API and the map can never
      // describe the same tiles two different ways.
      recommendedSource: oneMeter.available ? 'usgs3dep-1m' : 'usgs3dep-13',
      resolutionNote: oneMeter.available
        ? DEM_SOURCES['usgs3dep-1m'].resolutionNote
        : DEM_SOURCES['usgs3dep-13'].resolutionNote,
    };
  }

  /**
   * The 1 m coverage index clipped to a bounding box.
   *
   * A property's slice is a few hundred bytes (measured: 766 B for a Red River
   * Gorge property), against 230 KB gzipped for the nation. Handing that to a
   * device is what lets a downloaded region resolve its own 1 m project with no
   * signal — otherwise 1 m works at camp and fails where the hunter is.
   */
  @Get('dem/1m-index')
  async oneMeterIndex(
    @Query('west') west?: string,
    @Query('south') south?: string,
    @Query('east') east?: string,
    @Query('north') north?: string,
  ) {
    const bbox = {
      west: Number(west),
      south: Number(south),
      east: Number(east),
      north: Number(north),
    };
    if (!Object.values(bbox).every((v) => Number.isFinite(v))) {
      throw new BadRequestException('west, south, east and north are all required.');
    }
    if (bbox.east - bbox.west > 5 || bbox.north - bbox.south > 5) {
      // A whole-nation request would serve the 1.6 MB index uncompressed to a
      // phone. Regions are properties, not states.
      throw new BadRequestException('Bounding box too large; request at most 5 degrees a side.');
    }
    return this.threeDep.oneMeterIndexForBBox(bbox);
  }

  /**
   * Analysis raster tiles.
   *
   * Unauthenticated on purpose: these are derived from public-domain elevation
   * data and contain nothing about any user. Requiring a token here would
   * break `<img>`-based tile loading and offline pre-caching for no security
   * benefit — the sensitive data is stands and observations, and those are
   * behind the guard.
   */
  @Get('tiles/:layer/:z/:x/:y.png')
  @Header('Content-Type', 'image/png')
  // Long cache: terrain does not change. Wind- and date-dependent layers carry
  // those in the query string, so they cache under distinct keys.
  @Header('Cache-Control', 'public, max-age=604800, immutable')
  async tile(
    @Param('layer') layer: string,
    @Param('z', ParseIntPipe) z: number,
    @Param('x', ParseIntPipe) x: number,
    @Param('y', ParseIntPipe) y: number,
    @Res() res: Response,
    @Query('source') sourceId?: string,
    @Query('wind') wind?: string,
    @Query('at') at?: string,
  ): Promise<void> {
    if (!RENDERABLE_LAYERS.includes(layer as AnalysisLayer)) {
      throw new BadRequestException(
        `Unknown layer "${layer}". Available: ${RENDERABLE_LAYERS.join(', ')}.`,
      );
    }
    assertTileCoords(z, x, y);

    const png = await this.terrain.renderTile({
      tile: { z, x, y },
      layer: layer as AnalysisLayer,
      source: this.dem.resolveSource(sourceId),
      windFromDeg: wind !== undefined ? Number(wind) : undefined,
      date: at ? new Date(at) : undefined,
    });
    res.send(png);
  }

  /** Render several saved filters into one composited tile. */
  @Post('tiles/filters/:z/:x/:y.png')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Header('Content-Type', 'image/png')
  async filterTile(
    @Param('z', ParseIntPipe) z: number,
    @Param('x', ParseIntPipe) x: number,
    @Param('y', ParseIntPipe) y: number,
    @Body() dto: FilterStackDto,
    @Res() res: Response,
  ): Promise<void> {
    assertTileCoords(z, x, y);
    if (dto.filters.length > 12) {
      throw new BadRequestException('At most 12 filters can be stacked in one tile.');
    }

    const filters = dto.filters.map((f) => ({
      predicate: assertPredicate(f.predicate),
      color: f.color,
      opacity: f.opacity,
      outline: f.outline,
    }));

    const png = await this.terrain.renderFilterStack(
      { z, x, y },
      this.dem.resolveSource(dto.demSource),
      filters,
      dto.windFromDeg,
      dto.atUtc ? new Date(dto.atUtc) : undefined,
    );
    res.send(png);
  }

  /** Everything the engine knows about one point. Powers the long-press readout. */
  @Get('point')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async point(
    @Query('lng') lng: string,
    @Query('lat') lat: string,
    @Query('zoom') zoom?: string,
    @Query('source') sourceId?: string,
    @Query('wind') wind?: string,
    @Query('at') at?: string,
  ) {
    const lngN = Number(lng);
    const latN = Number(lat);
    if (!Number.isFinite(lngN) || !Number.isFinite(latN)) {
      throw new BadRequestException('lng and lat are required and must be numeric.');
    }
    return this.terrain.samplePoint(
      lngN,
      latN,
      zoom ? Number(zoom) : 14,
      this.dem.resolveSource(sourceId),
      wind !== undefined ? Number(wind) : undefined,
      at ? new Date(at) : undefined,
    );
  }

  /** How much of an area a filter actually matches. */
  @Post('filters/evaluate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async evaluate(@Body() dto: EvaluateFilterDto) {
    const result = await this.terrain.evaluateArea(
      dto.bbox,
      dto.zoom,
      this.dem.resolveSource(dto.demSource),
      assertPredicate(dto.predicate),
      dto.windFromDeg,
      dto.atUtc ? new Date(dto.atUtc) : undefined,
    );
    return {
      ...result,
      // A filter matching almost everything has not narrowed anything down.
      advice:
        result.matchShare > 0.35
          ? 'This matches over a third of the area — tighten it to get a usable shortlist.'
          : result.matchShare < 0.002
            ? 'Almost nothing matches. Loosen a bound, or check the wind/date inputs.'
            : null,
    };
  }

  /** Solve a movement corridor between two areas. */
  @Post('corridors/solve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async solveCorridor(@Body() dto: CorridorDto) {
    return this.corridors.solve({
      bbox: dto.bbox,
      zoom: dto.zoom,
      source: this.dem.resolveSource(dto.demSource),
      from: dto.from as never,
      to: dto.to as never,
      toleranceFraction: dto.toleranceFraction,
      useBeddingAttraction: dto.useBeddingAttraction,
      windFromDeg: dto.windFromDeg,
      maxLines: dto.maxLines,
    });
  }
}

function assertTileCoords(z: number, x: number, y: number): void {
  if (z < 0 || z > 18) throw new BadRequestException('Zoom must be between 0 and 18.');
  const max = 2 ** z;
  if (x < 0 || y < 0 || x >= max || y >= max) {
    throw new BadRequestException(`Tile ${x},${y} is out of range at zoom ${z}.`);
  }
}

/**
 * Validate a predicate before it reaches the evaluator.
 *
 * Filters are shareable between users, so a predicate arriving on a request may
 * have been authored by someone other than the caller. The AST is inert data by
 * construction, but validating shape and depth here means a malformed or
 * hostile payload is rejected at the edge rather than surfacing as a stack
 * overflow deep in a render loop.
 */
function assertPredicate(raw: unknown): TerrainPredicate {
  if (!validatePredicate(raw)) {
    throw new BadRequestException(
      'Filter predicate is not valid. Check metric names, nesting depth and operand counts.',
    );
  }
  return raw;
}
