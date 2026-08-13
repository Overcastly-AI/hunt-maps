/**
 * Serving real USGS 3DEP elevation as Web Mercator tiles.
 *
 * `@hunt-maps/terrain` can already read a 3DEP Cloud-Optimized GeoTIFF and
 * resolve which 1 m LiDAR project covers a point. Until this file, nothing
 * called it: no `readRange` was ever bound to `fetch`, so the engine shipped a
 * complete 3DEP reader and the map still drew ~10 m Terrarium. This is the
 * binding.
 *
 * ## Why the API renders the tiles rather than the browser
 *
 * A COG read is a range request into a 485 MB file, and the *whole* app —
 * the analysis worker, the point-query readout, the offline region downloader,
 * the coverage badge — already speaks one language: a 256 px PNG tile
 * addressed `z/x/y`. Rendering 3DEP into that shape means every one of those
 * paths gets real bare-earth data with no change to tile identity, so a region
 * a hunter downloaded is still the region the analysis reads. Changing tile
 * identity instead is `R8`'s bug, and it is silent: the download succeeds, the
 * badge goes green, and the analysis finds nothing.
 *
 * The cost is that 1 m needs a network round trip to this server. That is the
 * right trade for now — the offline path is the *cached tile*, not the COG —
 * and the browser can be given the same reader later without moving the tile
 * identity, because the identity is `source/z/x/y` either way.
 *
 * ## Bare earth is the point
 *
 * Terrarium is a *surface* model: under timber it describes the top of the
 * canopy, not the ground a deer walks on. 3DEP is bare earth. The benches, old
 * logging grades and micro-terrain a hunter goes looking for are exactly what a
 * canopy-height model erases, which is why this matters more than the nominal
 * resolution figure suggests — the `13` product is the *same* ~10 m nominal
 * grid as Terrarium and is still a categorically better input.
 *
 * ## What is never done here
 *
 * Where 1 m has no coverage, this service returns "no data" and says so. It
 * does **not** quietly render the 10 m product under a 1 m label. That
 * overclaim was removed from this codebase once already (`a02793d`) and must
 * not return through this door; `resolveOneMeter` returning `null` is a real
 * answer that the caller is required to surface.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PNG } from 'pngjs';
import {
  CogReader,
  createRangeFetcher,
  encodeHeightsToRgba,
  fetchText,
  isElevation,
  NODATA,
  OneMeterIndex,
  oneThirdArcSecondUrl,
  pixelSizeMeters,
  renderMercatorTileFromCog,
  resolveOneMeterTile,
  tileBBox,
  USGS_3DEP_VERTICAL_DATUM,
  type OneMeterIndexData,
  type TileCoord,
} from '@hunt-maps/terrain';

/** Which 3DEP product a request wants. */
export type ThreeDepProduct = '13' | '1m';

/** Courtesy to a public dataset we pull hard when packaging offline regions. */
const USER_AGENT = 'Ridgeline/0.1 (self-hosted hunting map)';

/**
 * How long the national 1 m index stays fresh.
 *
 * USGS adds acquisition projects continuously but not quickly, and the index
 * costs ~960 requests and ~7 s to rebuild. A day is short enough that a new
 * project appears within a season and long enough that the bucket is not
 * hammered. A rebuild never blocks a request — see {@link oneMeterIndex}.
 */
const INDEX_TTL_MS = 24 * 3600_000;

/**
 * Open COG readers to keep. Each holds decoded TIFF tiles (a 512² float tile is
 * 1 MB), and `CogReader` caps its own at 24, so this bounds the service at
 * roughly `MAX_READERS * 24 MB` worst case. 24 readers covers a property's
 * worth of adjacent 1 m tiles plus the 1/3" cells around them.
 */
const MAX_READERS = 24;

/** What actually answered a tile request. Never inferred by the caller. */
export interface ThreeDepTileReport {
  product: ThreeDepProduct;
  /** Ground sample distance of the COG overview used, metres. */
  resolutionMeters: number;
  /** Fraction of the tile's cells that carry a measured height, 0..1. */
  coverage: number;
  /** 1 m acquisition projects that contributed. Empty for the `13` product. */
  projects: string[];
}

/** The answer to "is there 1 m LiDAR here?". `null` project means no. */
export interface OneMeterCoverage {
  available: boolean;
  project: string | null;
  /** Sampled bare-earth height at the query point, metres. Null when absent. */
  elevationMeters: number | null;
  utmZone: number | null;
}

@Injectable()
export class Dem3depService {
  private readonly logger = new Logger(Dem3depService.name);

  /** Open COGs, keyed by URL. Insertion-ordered, evicted oldest-first. */
  private readonly readers = new Map<string, Promise<CogReader>>();

  /** The national 1 m coverage index, and the build in flight if any. */
  private indexCache?: { index: OneMeterIndex; builtAtMs: number };
  private indexBuild?: Promise<OneMeterIndex>;

  /**
   * Resolved 1 m project per 10 km cell.
   *
   * Keyed by cell rather than by point because a hunter's ground does not move
   * and neither does an acquisition footprint: every tile of a property
   * resolves to the same answer, and re-probing per map tile would turn a
   * 3-request resolution into a 3-request-per-tile storm.
   *
   * In memory only. Persisting this per property is the right home — it
   * survives a restart and can travel to the device — but that needs a schema
   * column, which is `schema-architect`'s territory, not this file's. Noted as
   * a follow-up rather than smuggled into an unrelated table.
   */
  private readonly projectByCell = new Map<string, string | null>();

  // -------------------------------------------------------------------------
  // COG access
  // -------------------------------------------------------------------------

  /**
   * Open a COG, memoised.
   *
   * Opening costs a header range read (one request, occasionally two), so
   * re-opening per map tile would double every tile's cost for a file the
   * service already has parsed.
   */
  private open(url: string): Promise<CogReader> {
    const existing = this.readers.get(url);
    if (existing) return existing;

    const opened = CogReader.open(
      createRangeFetcher(url, { headers: { 'User-Agent': USER_AGENT } }),
      { verticalDatum: USGS_3DEP_VERTICAL_DATUM },
    );
    // Evict on failure so a transient network error does not poison the URL
    // for the lifetime of the process.
    opened.catch(() => this.readers.delete(url));

    if (this.readers.size >= MAX_READERS) {
      const oldest = this.readers.keys().next().value;
      if (oldest !== undefined) this.readers.delete(oldest);
    }
    this.readers.set(url, opened);
    return opened;
  }

  // -------------------------------------------------------------------------
  // The 1 m index
  // -------------------------------------------------------------------------

  /**
   * The national 1 m coverage index, built on first use and refreshed lazily.
   *
   * Measured against the live bucket: 960 requests, ~7 s, 929 projects, 80 073
   * ten-kilometre cells, 1.6 MB of JSON that gzips to 230 KB.
   *
   * A *stale* index is served while a refresh runs rather than making a request
   * wait for a rebuild — the failure mode of blocking is a hunter watching a
   * spinner because a background cache expired, which is worse than a project
   * added last week being missing for another minute.
   */
  async oneMeterIndex(): Promise<OneMeterIndex> {
    const cached = this.indexCache;
    const fresh = cached && Date.now() - cached.builtAtMs < INDEX_TTL_MS;
    if (cached && fresh) return cached.index;

    if (!this.indexBuild) {
      this.indexBuild = this.buildIndex().finally(() => {
        this.indexBuild = undefined;
      });
    }
    // Stale-while-revalidate: only wait if there is nothing at all to serve.
    if (cached) return cached.index;
    return this.indexBuild;
  }

  private async buildIndex(): Promise<OneMeterIndex> {
    const started = Date.now();
    const { buildOneMeterIndex } = await import('@hunt-maps/terrain');
    const index = await buildOneMeterIndex(
      (url) => fetchText(url, { headers: { 'User-Agent': USER_AGENT } }),
      { concurrency: 32 },
    );
    this.indexCache = { index, builtAtMs: Date.now() };
    this.logger.log(
      `Built 1 m coverage index: ${index.projects.length} projects, ` +
        `${index.cellCount} cells, ${Date.now() - started} ms.`,
    );
    return index;
  }

  /** The index clipped to a bounding box — small enough to store per property. */
  async oneMeterIndexForBBox(bbox: {
    west: number;
    south: number;
    east: number;
    north: number;
  }): Promise<OneMeterIndexData> {
    return (await this.oneMeterIndex()).subsetForBBox(bbox).toData();
  }

  // -------------------------------------------------------------------------
  // Resolution
  // -------------------------------------------------------------------------

  /**
   * Which 1 m project covers a point, and whether it has data there.
   *
   * Both halves matter. A project's tile can contain the point and still be
   * NODATA at it — observed at a Wyoming test point where three projects
   * claimed the same 10 km cell and only the third had ground. The engine's
   * `resolveOneMeterTile` enforces that; this method caches its answer.
   */
  async resolveOneMeter(lng: number, lat: number): Promise<OneMeterCoverage> {
    const index = await this.oneMeterIndex();
    const resolved = await resolveOneMeterTile(index, lng, lat, (url) => this.open(url));
    if (!resolved) {
      return { available: false, project: null, elevationMeters: null, utmZone: null };
    }
    return {
      available: true,
      project: resolved.project,
      elevationMeters: resolved.sampleMeters,
      utmZone: resolved.zone,
    };
  }

  /** Cache key for a point's containing ~10 km cell, in degrees. */
  private cellKeyFor(lng: number, lat: number): string {
    // 0.1 degrees is ~11 km N-S, close enough to the 10 km tile grid to keep
    // the cache hit rate high without pretending to align with it.
    return `${Math.floor(lng * 10)}/${Math.floor(lat * 10)}`;
  }

  private async projectAt(lng: number, lat: number): Promise<string | null> {
    const key = this.cellKeyFor(lng, lat);
    if (this.projectByCell.has(key)) return this.projectByCell.get(key) ?? null;
    const coverage = await this.resolveOneMeter(lng, lat);
    this.projectByCell.set(key, coverage.project);
    return coverage.project;
  }

  // -------------------------------------------------------------------------
  // Tile rendering
  // -------------------------------------------------------------------------

  /**
   * Render one Web Mercator tile of heights from 3DEP.
   *
   * ## Straddling, and the seam it would otherwise produce
   *
   * 3DEP tiles are 10 km squares (1 m) or one-degree cells (1/3"). A Mercator
   * tile is much smaller than either, but it does not *align* with either, so a
   * tile near a boundary genuinely overlaps two — or, at a corner, four —
   * source files. Rendering from the single file under the tile's centre leaves
   * the rest of the tile NODATA, which paints a hard edge of missing data every
   * 10 km across the whole layer. That is the classic home-grown-DEM seam bug,
   * and it looks like real terrain rather than like a bug.
   *
   * So: render from the centre's file first, and only if that came back short
   * of full coverage resolve the tile's corners as well and composite. The fast
   * path — a tile wholly inside one source file, which is the large majority —
   * costs exactly one resolution.
   *
   * Composite rule is "first measured value wins". Never averaged: two 1 m
   * acquisitions of the same ground differ by centimetres (measured: 308.068 vs
   * 308.016 m at Red River Gorge), and blending them across a seam would invent
   * a gradient — a fake micro-bench — precisely at the join.
   */
  async renderTile(
    tile: TileCoord,
    product: ThreeDepProduct,
    tileSize = 256,
  ): Promise<{ heights: Float32Array; report: ThreeDepTileReport }> {
    const bbox = tileBBox(tile);
    const centre = { lng: (bbox.west + bbox.east) / 2, lat: (bbox.south + bbox.north) / 2 };

    const heights = new Float32Array(tileSize * tileSize).fill(NODATA);
    const projects: string[] = [];
    let resolutionMeters = product === '13' ? 10 : 1;

    const urls = await this.sourceUrlsFor(tile, product, centre, bbox);

    for (const { url, project } of urls) {
      let reader: CogReader;
      try {
        reader = await this.open(url);
      } catch (err) {
        // A missing or unreachable source file is a coverage hole, not a
        // failure of the tile. It reads as NODATA, which is honest.
        this.logger.debug(`3DEP source unavailable (${url}): ${String(err)}`);
        continue;
      }

      let rendered: Awaited<ReturnType<typeof renderMercatorTileFromCog>>;
      try {
        rendered = await renderMercatorTileFromCog(reader, tile, tileSize);
      } catch (err) {
        this.logger.debug(`3DEP render failed (${url}): ${String(err)}`);
        continue;
      }

      let contributed = 0;
      for (let i = 0; i < heights.length; i++) {
        // First measured value wins — see the composite rule above.
        if (isElevation(heights[i])) continue;
        if (!isElevation(rendered.heights[i])) continue;
        heights[i] = rendered.heights[i];
        contributed++;
      }
      if (contributed > 0) {
        resolutionMeters = rendered.report.resolutionMeters;
        if (project && !projects.includes(project)) projects.push(project);
      }

      // Full coverage: nothing further can contribute.
      if (this.coverageOf(heights) >= 1) break;
    }

    return {
      heights,
      report: { product, resolutionMeters, coverage: this.coverageOf(heights), projects },
    };
  }

  /**
   * The source files a tile may need, centre first.
   *
   * For `13` the addressing is deterministic from lng/lat, so the corners cost
   * nothing but a string. For `1m` each corner is a *resolution*, so they are
   * only consulted when the centre's file left the tile short.
   */
  private async sourceUrlsFor(
    tile: TileCoord,
    product: ThreeDepProduct,
    centre: { lng: number; lat: number },
    bbox: { west: number; south: number; east: number; north: number },
  ): Promise<Array<{ url: string; project: string | null }>> {
    const corners: Array<[number, number]> = [
      [bbox.west, bbox.north],
      [bbox.east, bbox.north],
      [bbox.west, bbox.south],
      [bbox.east, bbox.south],
    ];

    if (product === '13') {
      const out: Array<{ url: string; project: string | null }> = [];
      const seen = new Set<string>();
      for (const [lng, lat] of [[centre.lng, centre.lat] as [number, number], ...corners]) {
        const url = oneThirdArcSecondUrl(lng, lat);
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ url, project: null });
      }
      return out;
    }

    const index = await this.oneMeterIndex();
    const out: Array<{ url: string; project: string | null }> = [];
    const seen = new Set<string>();
    for (const [lng, lat] of [[centre.lng, centre.lat] as [number, number], ...corners]) {
      const project = await this.projectAt(lng, lat);
      if (!project) continue;
      // Ask the index for the exact stem this project publishes at this point;
      // three naming conventions are in use and only one of them carries the
      // UTM zone.
      for (const candidate of index.candidatesAt(lng, lat)) {
        if (candidate.project !== project) continue;
        for (const stem of candidate.stems) {
          const url =
            `https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/` +
            `${project}/TIFF/${stem}_${project}.tif`;
          if (seen.has(url)) continue;
          seen.add(url);
          out.push({ url, project });
        }
      }
    }
    return out;
  }

  private coverageOf(heights: Float32Array): number {
    let measured = 0;
    for (let i = 0; i < heights.length; i++) if (isElevation(heights[i])) measured++;
    return measured / heights.length;
  }

  /**
   * Render a tile straight to an encoded PNG.
   *
   * `terrain-rgb` rather than `terrarium` because its 0.1 m quantisation is the
   * finer of the two and 1 m LiDAR's whole value is small vertical structure —
   * the lip of a bench is often under half a metre, and Terrarium's 1/256 m is
   * finer still but its 8-bit red channel caps the range awkwardly for the
   * negative sentinel handling. Voids travel as alpha = 0; see
   * `encodeHeightsToRgba` for why that is load-bearing rather than cosmetic.
   */
  async renderPng(
    tile: TileCoord,
    product: ThreeDepProduct,
    tileSize = 256,
  ): Promise<{ png: Buffer; report: ThreeDepTileReport }> {
    const { heights, report } = await this.renderTile(tile, product, tileSize);
    const rgba = encodeHeightsToRgba(heights, 'terrain-rgb');
    const png = new PNG({ width: tileSize, height: tileSize });
    png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    return { png: PNG.sync.write(png), report };
  }

  /**
   * The finest 3DEP resolution actually available at a point, with the label a
   * user should see.
   *
   * Exists so the web app can state what it is showing rather than guess. The
   * distinction it protects: the `13` product is ~10 m — the same nominal grid
   * as Terrarium — so switching a user to it must not start calling the layer
   * LiDAR. Only the `1m` answer earns that word.
   */
  async describeAt(
    lng: number,
    lat: number,
  ): Promise<{
    product: ThreeDepProduct;
    oneMeter: OneMeterCoverage;
    nominalResolutionMeters: number;
    /** Ground sample distance of the Mercator grid at this zoom, for context. */
    mercatorMetersAtZoom: (z: number) => number;
  }> {
    const oneMeter = await this.resolveOneMeter(lng, lat);
    return {
      product: oneMeter.available ? '1m' : '13',
      oneMeter,
      nominalResolutionMeters: oneMeter.available ? 1 : 10,
      mercatorMetersAtZoom: (z: number) => pixelSizeMeters(z, lat, 256),
    };
  }
}
