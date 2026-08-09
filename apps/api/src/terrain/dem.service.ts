import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PNG } from 'pngjs';
import {
  assembleGrid,
  decodeRgbaToHeights,
  HeightGrid,
  InsufficientHaloError,
  lngLatToTile,
  pixelSizeMeters,
  type BBox,
  type DemEncoding,
  type TileCoord,
} from '@hunt-maps/terrain';
import { PrismaService } from '../prisma/prisma.service';

export interface DemSource {
  id: string;
  label: string;
  urlTemplate: string;
  encoding: DemEncoding;
  tileSize: number;
  maxZoom: number;
  attribution: string;
}

/**
 * DEM sources, best-resolution-first.
 *
 * The default is AWS Terrain Tiles (Terrarium), which is genuinely free, needs
 * no key, and is not requester-pays — important because this project is meant
 * to be self-hostable by an individual, and a source that bills per tile makes
 * "download the whole county for offline use" a financial decision rather than
 * a technical one.
 *
 * Where a user supplies an OpenTopography key, we prefer USGS 3DEP: 1/3
 * arc-second (~10 m) nationally and 1 m LiDAR-derived bare-earth over much of
 * the country. **Bare-earth is the point.** Terrarium is a surface model — it
 * includes the tree canopy — so under timber it describes the top of the woods,
 * not the ground the deer walk on. Benches and old logging grades that are
 * obvious in LiDAR are invisible in a canopy-height model, which is precisely
 * why LiDAR changed hunting cartography.
 */
export const DEM_SOURCES: Record<string, DemSource> = {
  terrarium: {
    id: 'terrarium',
    label: 'AWS Terrain Tiles (global, surface model)',
    urlTemplate:
      'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    encoding: 'terrarium',
    tileSize: 256,
    maxZoom: 15,
    attribution: 'Mapzen / AWS Terrain Tiles; USGS, SRTM, and others',
  },
  usgs3dep: {
    id: 'usgs3dep',
    label: 'USGS 3DEP LiDAR (US, bare earth)',
    urlTemplate: process.env.DEM_3DEP_TEMPLATE ?? '',
    encoding: 'terrain-rgb',
    tileSize: 512,
    maxZoom: 16,
    attribution: 'USGS 3D Elevation Program (public domain)',
  },
};

/** How long a cached tile stays fresh. Terrain does not move quickly. */
const CACHE_TTL_MS = 90 * 86400_000;

@Injectable()
export class DemService {
  private readonly logger = new Logger(DemService.name);
  /** Coalesces concurrent requests for the same tile into one upstream fetch. */
  private readonly inflight = new Map<string, Promise<Buffer>>();

  constructor(private readonly prisma: PrismaService) {}

  resolveSource(id?: string): DemSource {
    const source = DEM_SOURCES[id ?? 'terrarium'];
    if (!source || !source.urlTemplate) {
      // Falling back silently to a surface model when the user asked for
      // bare-earth LiDAR would quietly degrade every analysis. Say so instead.
      if (id && id !== 'terrarium') {
        throw new ServiceUnavailableException(
          `DEM source "${id}" is not configured on this server. ` +
            `Set DEM_3DEP_TEMPLATE to enable it, or request "terrarium".`,
        );
      }
      return DEM_SOURCES.terrarium;
    }
    return source;
  }

  /**
   * Fetch one encoded tile, preferring the database cache.
   *
   * The cache is not just a latency optimisation. Packaging an offline region
   * pulls thousands of tiles, and a corridor solve over a large property pulls
   * hundreds; hammering a public dataset for those every time is both rude and
   * fragile. It also means a user in the field can re-package a region while
   * the upstream provider is down.
   */
  async fetchTile(tile: TileCoord, source: DemSource): Promise<Buffer> {
    const key = `${source.id}/${tile.z}/${tile.x}/${tile.y}`;

    const cached = await this.prisma.demTile.findUnique({
      where: { source_z_x_y: { source: source.id, z: tile.z, x: tile.x, y: tile.y } },
    });
    if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
      return Buffer.from(cached.data);
    }

    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = this.fetchUpstream(tile, source)
      .then(async (buf) => {
        await this.prisma.demTile
          .upsert({
            where: { source_z_x_y: { source: source.id, z: tile.z, x: tile.x, y: tile.y } },
            create: { source: source.id, z: tile.z, x: tile.x, y: tile.y, data: buf },
            update: { data: buf, fetchedAt: new Date() },
          })
          .catch((err) => this.logger.warn(`DEM cache write failed for ${key}: ${err}`));
        return buf;
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, promise);
    return promise;
  }

  private async fetchUpstream(tile: TileCoord, source: DemSource): Promise<Buffer> {
    const url = source.urlTemplate
      .replace('{z}', String(tile.z))
      .replace('{x}', String(tile.x))
      .replace('{y}', String(tile.y));

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Ridgeline/0.1 (self-hosted hunting map)' },
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      throw new ServiceUnavailableException(
        `DEM source ${source.id} returned ${res.status} for ${tile.z}/${tile.x}/${tile.y}.`,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }

  /** Decode an encoded PNG tile to metres. */
  decode(buffer: Buffer, source: DemSource): Float32Array {
    const png = PNG.sync.read(buffer);
    return decodeRgbaToHeights(new Uint8Array(png.data), source.encoding);
  }

  /**
   * Assemble a haloed grid for one tile, fetching the neighbours it needs.
   *
   * Neighbours are fetched in parallel and failures are tolerated — a missing
   * neighbour degrades to edge replication on that side rather than failing the
   * whole tile. A single 404 at the edge of coverage should not blank the map.
   */
  async gridForTile(tile: TileCoord, source: DemSource, halo: number): Promise<HeightGrid> {
    const wanted: Array<{ dx: number; dy: number; tile: TileCoord }> = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        wanted.push({ dx, dy, tile: { z: tile.z, x: tile.x + dx, y: tile.y + dy } });
      }
    }

    const [centerBuf, ...neighbourResults] = await Promise.all([
      this.fetchTile(tile, source),
      ...wanted.map((w) =>
        this.fetchTile(w.tile, source).then(
          (b) => ({ ok: true as const, dx: w.dx, dy: w.dy, buf: b }),
          () => ({ ok: false as const, dx: w.dx, dy: w.dy }),
        ),
      ),
    ]);

    const neighbours = new Map<string, Float32Array>();
    for (const r of neighbourResults) {
      if (r.ok) neighbours.set(`${r.dx},${r.dy}`, this.decode(r.buf, source));
    }

    const grid = assembleGrid(
      tile,
      this.decode(centerBuf, source),
      neighbours,
      source.tileSize,
      Math.min(halo, source.tileSize),
    );
    return grid.fillVoids();
  }

  /**
   * Assemble a single contiguous grid covering a bounding box.
   *
   * Used for property-scale work (corridors, terrain profiles) where analysing
   * tile-by-tile would break least-cost routing at every tile seam — a corridor
   * cannot be solved per tile, because the optimal route is a global property of
   * the whole surface.
   *
   * ## The halo is a ring of real tiles, not a promise (`R41`)
   *
   * `HeightGrid.empty` allocates `halo` cells of padding on every side, but
   * until this fetch loop nothing ever wrote into that padding — the mosaic
   * covers exactly the requested tile range, so the halo sat at `NODATA`
   * forever. `fillVoids` only diffuses real data ~8 cells from an edge, so
   * anything deeper stayed `NODATA`: finite, so it used to sail past every
   * `!Number.isFinite` guard and read as terrain 33 km below the viewer
   * (`R30` before its fix), and now correctly, but silently, reads as `NaN`
   * in `terrainShelter`/`skyViewFactor`/`beddingLikelihood` in a band as deep
   * as the halo — a greyed rim on every server-rendered mosaic tile.
   *
   * The fix is the same one `gridForTile`'s 3x3 fetch already uses: fetch a
   * one-tile-wide ring of neighbour tiles around the mosaic and blit them in
   * too. `HeightGrid.set` silently drops writes outside the interior+halo
   * bounds, so blitting a whole ring tile at its natural offset is enough —
   * only the sliver actually inside the halo lands. A one-tile ring can
   * supply at most `ts` cells of real halo, the same ceiling `assembleGrid`
   * enforces for a single tile, so a halo request deeper than that is
   * refused up front rather than silently degrading — see the guard below.
   */
  async gridForBBox(
    bbox: BBox,
    zoom: number,
    source: DemSource,
    halo = 0,
  ): Promise<{ grid: HeightGrid; originTile: TileCoord; tilesX: number; tilesY: number }> {
    const nw = lngLatToTile(bbox.west, bbox.north, zoom);
    const se = lngLatToTile(bbox.east, bbox.south, zoom);
    const x0 = Math.floor(nw.x);
    const x1 = Math.floor(se.x);
    const y0 = Math.floor(nw.y);
    const y1 = Math.floor(se.y);

    const tilesX = x1 - x0 + 1;
    const tilesY = y1 - y0 + 1;
    const ts = source.tileSize;

    if (tilesX * tilesY > MAX_TILES_PER_MOSAIC) {
      throw new ServiceUnavailableException(
        `That area needs ${tilesX * tilesY} DEM tiles at z${zoom}, over the ` +
          `${MAX_TILES_PER_MOSAIC}-tile limit. Reduce the zoom or the area.`,
      );
    }

    // A one-tile-deep neighbour ring (fetched below) cannot supply a halo
    // deeper than one tile — identical ceiling to `assembleGrid`'s guard for
    // `gridForTile`'s 3x3 fetch. Refuse rather than allocate a grid whose
    // outer band can never be filled: that silent allocation is exactly what
    // `R41` found. `analyze()` would eventually throw the same error once it
    // compared `grid.halo` to `requiredHalo()`, but only *after* every tile in
    // the mosaic had already been fetched — failing here is cheaper and no
    // less honest.
    if (halo > ts) {
      throw new InsufficientHaloError({
        required: halo,
        available: ts,
        detail:
          `A one-tile neighbour ring around this mosaic cannot supply a halo ` +
          `deeper than one tile (${ts}px) at zoom ${zoom}. Reduce the operator ` +
          `radius, or run at a lower zoom where the same ground distance is ` +
          `fewer cells.`,
      });
    }

    const width = tilesX * ts;
    const height = tilesY * ts;
    const centerLat = (bbox.north + bbox.south) / 2;
    const centerLng = (bbox.east + bbox.west) / 2;
    const grid = HeightGrid.empty(
      width,
      height,
      halo,
      pixelSizeMeters(zoom, centerLat, ts),
      centerLat,
      centerLng,
    );

    // `HeightGrid.set` clips anything outside [-halo, width/height+halo), so a
    // tile blitted at its natural mosaic offset is safe to call unconditionally
    // whether it lands in the interior or the halo.
    const blitTile = (tx: number, ty: number): Promise<void> =>
      this.fetchTile({ z: zoom, x: tx, y: ty }, source)
        .then((buf) => {
          const heights = this.decode(buf, source);
          const ox = (tx - x0) * ts;
          const oy = (ty - y0) * ts;
          for (let y = 0; y < ts; y++) {
            for (let x = 0; x < ts; x++) {
              grid.set(ox + x, oy + y, heights[y * ts + x]);
            }
          }
        })
        // A hole in coverage — interior or halo — is filled by `fillVoids`
        // below rather than failing the whole mosaic.
        .catch(() => undefined);

    const jobs: Array<Promise<void>> = [];
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        jobs.push(blitTile(tx, ty));
      }
    }

    // The halo ring: every tile bordering the mosaic, one tile deep. Skipped
    // entirely when no halo was requested (`evaluateArea`'s slope/aspect-only
    // callers, for instance) so a caller that never needed the edge does not
    // pay for it.
    if (halo > 0) {
      for (let ty = y0 - 1; ty <= y1 + 1; ty++) {
        for (let tx = x0 - 1; tx <= x1 + 1; tx++) {
          const isInterior = tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1;
          if (isInterior) continue;
          jobs.push(blitTile(tx, ty));
        }
      }
    }

    await Promise.all(jobs);
    grid.fillVoids();

    return { grid, originTile: { z: zoom, x: x0, y: y0 }, tilesX, tilesY };
  }

  /** Map a lng/lat to the pixel coordinate inside a mosaic built by `gridForBBox`. */
  pixelInMosaic(
    lng: number,
    lat: number,
    originTile: TileCoord,
    tileSize: number,
  ): { x: number; y: number } {
    const t = lngLatToTile(lng, lat, originTile.z);
    return {
      x: Math.round((t.x - originTile.x) * tileSize),
      y: Math.round((t.y - originTile.y) * tileSize),
    };
  }

  /** Inverse of `pixelInMosaic`. */
  lngLatOfPixel(
    x: number,
    y: number,
    originTile: TileCoord,
    tileSize: number,
  ): { lng: number; lat: number } {
    const n = 2 ** originTile.z;
    const tx = originTile.x + x / tileSize;
    const ty = originTile.y + y / tileSize;
    const lng = (tx / n) * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n)));
    return { lng, lat: (latRad * 180) / Math.PI };
  }
}

/**
 * Ceiling on a single mosaic. 256 tiles at 256px is a 4096² grid — about 67 MB
 * of Float32 before any derived field. Past that, a corridor solve stops being
 * interactive and starts being a batch job, and the honest answer is to say so
 * rather than to let a request hang for four minutes.
 */
const MAX_TILES_PER_MOSAIC = 256;
