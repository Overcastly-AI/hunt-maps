/**
 * Finding the 1 m LiDAR tile under a point — the problem `usgs3dep.ts` names
 * and leaves to the caller.
 *
 * ## The problem, restated precisely
 *
 * 3DEP's 1 m product is published *per acquisition project*, and the project
 * name is part of the file name:
 *
 *     .../1m/Projects/KY_Statewide_2021_A21/TIFF/USGS_1M_16_x27y405_KY_Statewide_2021_A21.tif
 *                     ^^^^^^^^^^^^^^^^^^^^^                        ^^^^^^^^^^^^^^^^^^^^^
 *
 * `oneMeterTileName` computes the `x27y405` half from lng/lat. Nothing computes
 * the project half. USGS's own answer is `FESM_1m.gpkg`, a **1.9 GB**
 * GeoPackage, which this package cannot carry and a phone cannot download.
 *
 * ## What was measured, and what it bought
 *
 * `prd-tnm.s3.amazonaws.com` is a plain public bucket that **permits anonymous
 * `ListBucket`**. That was verified empirically, not assumed, and it collapses
 * the problem:
 *
 * | Step | Cost, measured |
 * |------|----------------|
 * | List every 1 m project (`delimiter=/`) | **1 request**, 959 projects, 24 KB |
 * | Read each project's `0_file_download_links.txt` | 959 requests, 17.9 MB, **4.4 s** at concurrency 32 |
 * | Resulting national index | 80 073 cells, 1.6 MB JSON, **240 KB gzipped** |
 *
 * 240 KB is small enough to hand to a phone, so 1 m *discovery* works offline
 * too — which matters, because a hunter who downloaded a region at 1 m must
 * still be able to resolve it at the bottom of a draw with no signal.
 *
 * The alternative considered and rejected was narrowing candidates by the state
 * code in the project name and probing those. It is cheaper (2 requests for a
 * Kentucky point) but **wrong**: `Elwha_River_LiDAR_2014_MOD2` is in Washington
 * and its name never says `WA`, so name-narrowing reports "no 1 m data here"
 * over ground that has it. A false negative is safer than a false positive, but
 * it is still the map being confidently wrong.
 *
 * ## Three file-naming conventions, not one
 *
 * Measured across all 959 projects:
 *
 * | Stem | Projects | Carries the UTM zone? |
 * |------|----------|----------------------|
 * | `USGS_one_meter_x{X}y{Y}` | 515 | **no** |
 * | `USGS_1M_{zone}_x{X}y{Y}` | 345 | yes |
 * | `USGS_1m_x{X}y{Y}`        | 59  | **no** |
 *
 * `oneMeterTileName` emitted only the middle one, so a probe built on it would
 * have missed **62%** of projects. All three are generated here.
 *
 * ## Why a candidate is verified against the file, not trusted from the index
 *
 * 574 of 959 projects put no zone in the file name, so their cells are indexed
 * under a wildcard zone and a `x26y419` cell in Kentucky collides with the
 * identically-numbered cell in Colorado, Kansas and Virginia. Measured: a Red
 * River Gorge point produces 5 candidate projects, 3 of them in the wrong UTM
 * zone entirely.
 *
 * So a candidate is only accepted after the COG itself has been opened and has
 * agreed, from its own GeoKeys and tie point, that the point is inside it —
 * **and** that the sample there is a measured height rather than NODATA. That
 * second half is not paranoia: a Wyoming test point fell inside the footprint
 * of three projects that claimed the cell, and only the *third* had data at it.
 * Stopping at the first file that merely opens would have rendered a void.
 *
 * ## Sign of failure
 *
 * When nothing resolves, the answer is `null` — "no 1 m data here" — and the
 * caller must fall back **visibly and labelled**. Silently substituting the
 * 10 m product under a LiDAR label is the exact overclaim this codebase removed
 * once already; see `apps/web/src/lib/map/demSource.ts`.
 */

import { isElevation } from './encoding.js';
import type { CogReader } from './cog.js';
import { lngLatToUtm, utmZoneForLongitude } from './projection.js';
import { TNM_BUCKET_URL } from './usgs3dep.js';

/** Prefix under which the 1 m staged products live. */
export const ONE_METER_PREFIX = 'StagedProducts/Elevation/1m/Projects/';

/** Side of a 1 m tile's nominal cell, in metres. Tiles are 10 km squares. */
export const ONE_METER_CELL_METERS = 10000;

/**
 * The file-name stems 3DEP actually uses, most common first.
 *
 * Order matters only for how quickly a probe finds the file; correctness comes
 * from the verification step. `zoned` records whether the stem carries the UTM
 * zone, which is what decides if a cell can be indexed precisely or has to go
 * under the wildcard.
 */
export const ONE_METER_STEMS = [
  {
    id: 'one_meter',
    zoned: false,
    build: (_z: number, x: number, y: number) => `USGS_one_meter_x${x}y${y}`,
  },
  {
    id: '1M_zone',
    zoned: true,
    build: (z: number, x: number, y: number) => `USGS_1M_${z}_x${x}y${y}`,
  },
  { id: '1m', zoned: false, build: (_z: number, x: number, y: number) => `USGS_1m_x${x}y${y}` },
] as const;

export type OneMeterStemId = (typeof ONE_METER_STEMS)[number]['id'];

/** Every file-name stem a tile could be published under, in probe order. */
export function oneMeterStems(zone: number, x: number, y: number): string[] {
  return ONE_METER_STEMS.map((s) => s.build(zone, x, y));
}

/** A 1 m file name, decomposed. `zone` is absent for the two legacy stems. */
export interface ParsedOneMeterName {
  stemId: OneMeterStemId;
  zone?: number;
  x: number;
  y: number;
  project: string;
}

/**
 * Decompose a 1 m file name.
 *
 * Anchored on the `x{digits}y{digits}` group rather than on the project name,
 * because project names contain underscores, digits and the substring `x`
 * freely — `AL_25Co_B1_2017` would defeat any split-on-underscore approach.
 */
export function parseOneMeterFileName(name: string): ParsedOneMeterName | null {
  const m = /^USGS_(?:1M_(\d{1,2})_|1m_|one_meter_)x(\d+)y(\d+)_(.+)\.tif$/i.exec(name);
  if (!m) return null;
  const zoneText = m[1];
  const stemId: OneMeterStemId = zoneText
    ? '1M_zone'
    : /^USGS_one_meter_/i.test(name)
      ? 'one_meter'
      : '1m';
  return {
    stemId,
    zone: zoneText ? Number(zoneText) : undefined,
    x: Number(m[2]),
    y: Number(m[3]),
    project: m[4],
  };
}

/** URL of a 1 m tile file, given its project and stem. */
export function oneMeterTileUrl(project: string, stem: string, bucket = TNM_BUCKET_URL): string {
  return `${bucket}/${ONE_METER_PREFIX}${project}/TIFF/${stem}_${project}.tif`;
}

/** URL of a project's plain-text list of every file it publishes. */
export function oneMeterManifestUrl(project: string, bucket = TNM_BUCKET_URL): string {
  return `${bucket}/${ONE_METER_PREFIX}${project}/0_file_download_links.txt`;
}

// ---------------------------------------------------------------------------
// S3 listing
// ---------------------------------------------------------------------------

/** One page of an S3 `ListObjectsV2` response. */
export interface S3ListPage {
  keys: string[];
  /** `CommonPrefixes`, i.e. the "directories" when `delimiter=/` is set. */
  prefixes: string[];
  nextContinuationToken?: string;
  truncated: boolean;
}

/**
 * Parse an S3 `ListObjectsV2` XML response.
 *
 * A regex reader rather than a DOM parse: `DOMParser` does not exist in Node
 * and `XMLHttpRequest`-era parsers are not in a service worker's guaranteed
 * surface, and pulling in an XML library would break this package's zero-
 * dependency rule for the sake of six fields. The response shape is fixed by
 * the S3 API contract, and any drift shows up as an empty page rather than as
 * a wrong page — which then reads as "no 1 m coverage", the safe direction.
 */
export function parseS3ListXml(xml: string): S3ListPage {
  const keys: string[] = [];
  const prefixes: string[] = [];
  // `Contents` entries carry `Key`; `CommonPrefixes` carry `Prefix`. The
  // top-level request `Prefix` echo is also a `<Prefix>`, so only those nested
  // inside a `CommonPrefixes` element are taken.
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const k = /<Key>([^<]*)<\/Key>/.exec(m[1]);
    if (k) keys.push(decodeXmlEntities(k[1]));
  }
  for (const m of xml.matchAll(/<CommonPrefixes>([\s\S]*?)<\/CommonPrefixes>/g)) {
    const p = /<Prefix>([^<]*)<\/Prefix>/.exec(m[1]);
    if (p) prefixes.push(decodeXmlEntities(p[1]));
  }
  const token = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
  return {
    keys,
    prefixes,
    nextContinuationToken: truncated && token ? decodeXmlEntities(token[1]) : undefined,
    truncated,
  };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Build the URL for one page of a `ListObjectsV2` call. */
export function s3ListUrl(
  bucket: string,
  prefix: string,
  options: { delimiter?: string; continuationToken?: string; maxKeys?: number } = {},
): string {
  const params = new URLSearchParams({ 'list-type': '2', prefix });
  if (options.delimiter) params.set('delimiter', options.delimiter);
  if (options.maxKeys) params.set('max-keys', String(options.maxKeys));
  if (options.continuationToken) params.set('continuation-token', options.continuationToken);
  return `${bucket}/?${params.toString()}`;
}

/**
 * Every 1 m project name in the bucket.
 *
 * One request in practice (959 projects fit a single 1000-key page), but the
 * continuation loop is real because that headroom is 41 projects wide and USGS
 * adds projects continuously.
 */
export async function listOneMeterProjects(
  getText: (url: string) => Promise<string>,
  bucket = TNM_BUCKET_URL,
): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  // Bounded so a malformed continuation token cannot spin forever.
  for (let page = 0; page < 50; page++) {
    const xml = await getText(
      s3ListUrl(bucket, ONE_METER_PREFIX, {
        delimiter: '/',
        maxKeys: 1000,
        continuationToken: token,
      }),
    );
    const parsed = parseS3ListXml(xml);
    for (const p of parsed.prefixes) {
      const name = p.slice(ONE_METER_PREFIX.length).replace(/\/$/, '');
      if (name) out.push(name);
    }
    if (!parsed.nextContinuationToken) return out;
    token = parsed.nextContinuationToken;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

/** Index key for a 10 km cell. `zone` is `undefined` for unzoned stems. */
export function cellKey(zone: number | undefined, x: number, y: number): string {
  return `${zone ?? '*'}/${x}/${y}`;
}

/** Serialized form — what gets cached on the API and shipped to a device. */
export interface OneMeterIndexData {
  /** Bumped when the layout changes so a stale cache is discarded, not misread. */
  version: 1;
  builtAtIso: string;
  /** Project names, referenced by position from `cells`. */
  projects: string[];
  /** `"zone/x/y"` -> indices into `projects`. */
  cells: Record<string, number[]>;
}

/** A candidate 1 m tile, before verification. */
export interface OneMeterCandidate {
  project: string;
  /** The UTM zone this candidate's x/y were computed in. */
  zone: number;
  x: number;
  y: number;
  /** True when the index knew the zone; false when matched via the wildcard. */
  zoneFromIndex: boolean;
  /** File-name stems to try, in order. */
  stems: string[];
}

/**
 * The national 1 m coverage index.
 *
 * Deliberately a plain lookup over 10 km cells rather than real geometry: the
 * tiles *are* a regular 10 km grid in each project's UTM zone, so a cell key is
 * exact for zoned projects and a superset for unzoned ones. A superset is the
 * right error direction — it costs an extra HTTP probe, where a subset would
 * cost a hunter the layer.
 */
export class OneMeterIndex {
  private constructor(
    readonly projects: string[],
    private readonly cells: Map<string, number[]>,
    readonly builtAtIso: string,
  ) {}

  static fromData(data: OneMeterIndexData): OneMeterIndex {
    if (data.version !== 1) {
      throw new Error(`Unsupported 1 m index version ${String(data.version)}; expected 1.`);
    }
    return new OneMeterIndex(data.projects, new Map(Object.entries(data.cells)), data.builtAtIso);
  }

  toData(): OneMeterIndexData {
    return {
      version: 1,
      builtAtIso: this.builtAtIso,
      projects: this.projects,
      cells: Object.fromEntries(this.cells),
    };
  }

  /** Number of distinct 10 km cells with at least one project. */
  get cellCount(): number {
    return this.cells.size;
  }

  /**
   * Build from parsed file names.
   *
   * Takes names rather than URLs so the same code path serves a manifest read,
   * an S3 listing, or a test fixture.
   */
  static build(
    entries: Iterable<ParsedOneMeterName>,
    builtAtIso = new Date().toISOString(),
  ): OneMeterIndex {
    const projects: string[] = [];
    const projectIndex = new Map<string, number>();
    const cells = new Map<string, number[]>();
    for (const e of entries) {
      let pi = projectIndex.get(e.project);
      if (pi === undefined) {
        pi = projects.length;
        projects.push(e.project);
        projectIndex.set(e.project, pi);
      }
      const key = cellKey(e.zone, e.x, e.y);
      let list = cells.get(key);
      if (!list) {
        list = [];
        cells.set(key, list);
      }
      // A project can publish the same cell more than once across file
      // variants; one entry per project per cell is all a probe needs.
      if (!list.includes(pi)) list.push(pi);
    }
    return new OneMeterIndex(projects, cells, builtAtIso);
  }

  /**
   * Candidate tiles covering a point, in probe order.
   *
   * Neighbouring UTM zones are included because a project near a zone boundary
   * publishes everything in *one* zone using extended coordinates — the point's
   * own zone is then the wrong one to compute x/y in. Zone-qualified index hits
   * are ordered ahead of wildcard hits because they are far more likely to be
   * the real answer and cost the same to check.
   */
  candidatesAt(lng: number, lat: number): OneMeterCandidate[] {
    const home = utmZoneForLongitude(lng);
    const zoned: OneMeterCandidate[] = [];
    const wild: OneMeterCandidate[] = [];
    const seen = new Set<string>();

    for (const zone of [home, home - 1, home + 1]) {
      if (zone < 1 || zone > 60) continue;
      const u = lngLatToUtm(lng, lat, zone);
      const x = Math.floor(u.easting / ONE_METER_CELL_METERS);
      // `y` counts the cell's NORTH edge, matching the file names — see
      // `oneMeterTileName`. Getting this backwards costs exactly one tile,
      // 10 km due south: far enough to be a different property, close enough
      // to look right.
      const y = Math.floor(u.northing / ONE_METER_CELL_METERS) + 1;

      for (const [key, intoZoned] of [
        [cellKey(zone, x, y), true],
        [cellKey(undefined, x, y), false],
      ] as const) {
        for (const pi of this.cells.get(key) ?? []) {
          const project = this.projects[pi];
          const dedupe = `${project}/${zone}/${x}/${y}`;
          if (seen.has(dedupe)) continue;
          seen.add(dedupe);
          const candidate: OneMeterCandidate = {
            project,
            zone,
            x,
            y,
            zoneFromIndex: intoZoned,
            // Only offer the stem family the index actually saw. A zoned hit
            // can only be the zoned stem; a wildcard hit is one of the two
            // unzoned ones. Probing all three every time would triple the
            // request count for no coverage gain.
            stems: intoZoned
              ? [`USGS_1M_${zone}_x${x}y${y}`]
              : [`USGS_one_meter_x${x}y${y}`, `USGS_1m_x${x}y${y}`],
          };
          (intoZoned ? zoned : wild).push(candidate);
        }
      }
    }
    // Sorted by project name within each tier, and this is not tidiness.
    //
    // The index is built by ~960 concurrent manifest reads, so `projects` ends
    // up in completion order — which differs run to run. Without a stable
    // ordering, a cell covered by two acquisitions (31% of cells are) resolves
    // to whichever project happened to land first, so the *same* ground can be
    // served from a different acquisition after a restart, and two adjacent map
    // tiles can disagree about which survey they came from. Two 1 m surveys of
    // the same ground differ by centimetres in the open and by more where
    // vegetation classification differed, so an arbitrary split puts a seam
    // through the middle of a hillside for no reason a user could ever discover.
    //
    // Sorting by name is arbitrary too, but it is *the same* arbitrary every
    // time, which is what makes a rendered tile reproducible.
    const byProject = (a: OneMeterCandidate, b: OneMeterCandidate): number =>
      a.project < b.project ? -1 : a.project > b.project ? 1 : a.zone - b.zone;
    zoned.sort(byProject);
    wild.sort(byProject);
    return [...zoned, ...wild];
  }

  /**
   * A cut-down index covering one bounding box, for offline use.
   *
   * A property is a few 10 km cells; the national index is 240 KB gzipped but a
   * property's slice is a few hundred bytes. This is what lets a downloaded
   * region resolve its own 1 m project with no signal, which is the difference
   * between "1 m works at camp" and "1 m works where you hunt".
   *
   * Padded by one cell in every direction so a property straddling a cell
   * boundary — the common case, since the grid has nothing to do with property
   * lines — does not lose the neighbour it needs for a halo.
   */
  subsetForBBox(bbox: { west: number; south: number; east: number; north: number }): OneMeterIndex {
    const wanted = new Set<string>();
    const corners: Array<[number, number]> = [
      [bbox.west, bbox.south],
      [bbox.west, bbox.north],
      [bbox.east, bbox.south],
      [bbox.east, bbox.north],
    ];
    const zones = new Set<number>();
    for (const [lng] of corners) {
      const z = utmZoneForLongitude(lng);
      zones.add(z);
      zones.add(z - 1);
      zones.add(z + 1);
    }
    for (const zone of zones) {
      if (zone < 1 || zone > 60) continue;
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const [lng, lat] of corners) {
        const u = lngLatToUtm(lng, lat, zone);
        const x = Math.floor(u.easting / ONE_METER_CELL_METERS);
        const y = Math.floor(u.northing / ONE_METER_CELL_METERS) + 1;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        for (let y = y0 - 1; y <= y1 + 1; y++) {
          wanted.add(cellKey(zone, x, y));
          wanted.add(cellKey(undefined, x, y));
        }
      }
    }

    const projects: string[] = [];
    const remap = new Map<number, number>();
    const cells = new Map<string, number[]>();
    for (const key of wanted) {
      const list = this.cells.get(key);
      if (!list) continue;
      cells.set(
        key,
        list.map((pi) => {
          let ni = remap.get(pi);
          if (ni === undefined) {
            ni = projects.length;
            projects.push(this.projects[pi]);
            remap.set(pi, ni);
          }
          return ni;
        }),
      );
    }
    return new OneMeterIndex(projects, cells, this.builtAtIso);
  }
}

/**
 * Parse a project's `0_file_download_links.txt` into index entries.
 *
 * The manifest is one absolute URL per line covering every file the project
 * publishes — TIFFs, but also `.xml` sidecars, `.aux.xml`, browse images and
 * the odd `Thumbs.db`. Only names that parse as a 1 m tile are kept, which is
 * also what filters out the `Copy.bat` one project ships.
 */
export function parseOneMeterManifest(text: string): ParsedOneMeterName[] {
  const out: ParsedOneMeterName[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const name = line.slice(line.lastIndexOf('/') + 1);
    const parsed = parseOneMeterFileName(name);
    if (parsed) out.push(parsed);
  }
  return out;
}

export interface BuildIndexOptions {
  bucket?: string;
  /** Parallel manifest reads. 32 measured at 4.4 s for the whole country. */
  concurrency?: number;
  /** Called after each project, for progress reporting on a long build. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Build the national index by reading every project's manifest.
 *
 * 959 requests and ~18 MB. That is a server-side job, run once and cached — a
 * phone must never pay this, which is why {@link OneMeterIndex.subsetForBBox}
 * exists.
 *
 * A project whose manifest 404s (31 of 959, measured — mostly empty or archived
 * directories) is skipped rather than failing the build. Losing one project
 * costs its coverage; failing the build costs all of it.
 */
export async function buildOneMeterIndex(
  getText: (url: string) => Promise<string>,
  options: BuildIndexOptions = {},
): Promise<OneMeterIndex> {
  const bucket = options.bucket ?? TNM_BUCKET_URL;
  const projects = await listOneMeterProjects(getText, bucket);
  const entries: ParsedOneMeterName[] = [];
  let next = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= projects.length) return;
      try {
        const text = await getText(oneMeterManifestUrl(projects[i], bucket));
        entries.push(...parseOneMeterManifest(text));
      } catch {
        // Skipped, deliberately — see the doc comment.
      }
      options.onProgress?.(++done, projects.length);
    }
  };

  const concurrency = Math.max(1, Math.min(options.concurrency ?? 32, projects.length || 1));
  await Promise.all(Array.from({ length: concurrency }, worker));
  return OneMeterIndex.build(entries);
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** A verified 1 m tile: the file is open, it covers the point, and it has data. */
export interface ResolvedOneMeterTile {
  project: string;
  url: string;
  reader: CogReader;
  /** The UTM zone the *file* declares, which is authoritative. */
  zone: number;
  /** Sampled height at the resolving point, metres. Always a measured value. */
  sampleMeters: number;
  /** How many candidate files were opened to get here. Diagnostics only. */
  probes: number;
}

export interface ResolveOptions {
  bucket?: string;
  /**
   * Ceiling on files opened per resolution. Measured worst case in testing was
   * 6 candidates (a Wyoming point where three projects claimed the cell and
   * only the third had data), so 12 is generous. A cap exists at all because a
   * pathological cell must not turn into an unbounded request storm on a phone.
   */
  maxProbes?: number;
}

/**
 * Resolve the 1 m tile under a point, or `null` for "no 1 m data here".
 *
 * `openCog` is injected — the same reason `CogReader` injects its reader. It is
 * expected to reject for a missing file (404), which is the ordinary answer for
 * most candidate stems and is not an error.
 *
 * ## The verification gate
 *
 * A candidate is accepted only when all three hold:
 *
 * 1. the file opens and declares a UTM CRS,
 * 2. its own georeferencing puts the point inside its bounds, and
 * 3. the sample at the point {@link isElevation} — a measured height.
 *
 * Dropping (2) accepts same-numbered cells from other UTM zones; dropping (3)
 * renders a hole as though it were ground. Both were observed against the live
 * bucket while building this, not imagined.
 */
export async function resolveOneMeterTile(
  index: OneMeterIndex,
  lng: number,
  lat: number,
  openCog: (url: string) => Promise<CogReader>,
  options: ResolveOptions = {},
): Promise<ResolvedOneMeterTile | null> {
  const bucket = options.bucket ?? TNM_BUCKET_URL;
  const maxProbes = options.maxProbes ?? 12;
  let probes = 0;

  for (const candidate of index.candidatesAt(lng, lat)) {
    for (const stem of candidate.stems) {
      if (probes >= maxProbes) return null;
      const url = oneMeterTileUrl(candidate.project, stem, bucket);
      probes++;
      let reader: CogReader;
      try {
        reader = await openCog(url);
      } catch {
        // 404 for this stem/project. Ordinary; try the next.
        continue;
      }

      // (1) A 1 m product is always published in a UTM zone. A geographic CRS
      // here means the file is not what its name says it is.
      if (reader.crs.kind !== 'utm') continue;

      // (2) Ask the file, not the index, whether it covers the point.
      const b = reader.bounds();
      if (lng < b.west || lng > b.east || lat < b.south || lat > b.north) continue;

      // (3) And whether there is anything measured there.
      const sampleMeters = await reader.sampleLngLat(lng, lat, 0);
      if (!isElevation(sampleMeters)) continue;

      return {
        project: candidate.project,
        url,
        reader,
        zone: reader.crs.zone,
        sampleMeters,
        probes,
      };
    }
  }
  return null;
}
