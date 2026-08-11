/**
 * Where elevation tiles come from — one template, two consumers.
 *
 * `TerrainProtocol` fetches DEM tiles on demand while you pan; the region
 * downloader fetches the same tiles ahead of time so you can pan with no
 * signal. If those two ever resolved a tile to different URLs, a region could
 * download "successfully" into keys the analysis path never looks at, and the
 * coverage badge — which probes the store by key — would be measuring a cache
 * nobody reads. That is R8's bug wearing a new coat, so the template lives here
 * once and both import it.
 *
 * The value is read from `VITE_DEM_TEMPLATE` at **build** time (Vite inlines
 * `import.meta.env`), which is why a sandboxed run needs the relay URL set on
 * the build command rather than on the preview server.
 */

import type { TileCoord } from '@hunt-maps/terrain';

/** Where elevation comes from when nothing overrides it. */
export const DEFAULT_DEM_TEMPLATE =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

/**
 * This was `?? DEFAULT_DEM_TEMPLATE`, and that shipped a product with no
 * terrain layers at all for every containerised build.
 *
 * `apps/web/Dockerfile` declares `ARG VITE_DEM_TEMPLATE=""`, so unless a
 * template is passed on the build command the variable is defined and **empty**.
 * `??` falls back only on null/undefined — an empty string is neither — so Vite
 * inlined `""`, `demTileUrl()` returned `""` for every tile, and every layer
 * that needs elevation (hillshade, slope, aspect, landform, bedding, corridors)
 * silently rendered nothing. Locally the variable is simply unset, so
 * `import.meta.env.VITE_DEM_TEMPLATE` is `undefined`, the fallback applies, and
 * the bug is invisible in dev and in every test. It only exists in the image.
 *
 * Empty and whitespace are treated as "not configured", which is what a person
 * writing `--build-arg VITE_DEM_TEMPLATE=` means. A value that is present but
 * unusable is a different failure and must not be silently rewritten — see
 * `assertUsableDemTemplate`.
 */
/**
 * What the web app tells a hunter about the elevation data under the map.
 *
 * ## Why this is a registry now, and what that does not change
 *
 * The API can serve three DEM sources (`apps/api/src/terrain/dem.service.ts`):
 * the AWS Terrarium blend it always could, and — since the 3DEP reader was
 * finally bound to `fetch` — real USGS 3DEP at 1/3 arc-second and at 1 m. The
 * vocabulary here mirrors that file entry for entry, so the API and the map can
 * never describe the same tiles two different ways.
 *
 * What has **not** changed is the rule that made this object exist: a source's
 * `resolutionNote` is load-bearing, not decoration, and no layer may imply a
 * resolution its data does not have.
 *
 * ## The distinction that is easy to lose and expensive to lose
 *
 * Switching from Terrarium to 3DEP's `13` product does **not** make "LiDAR"
 * true. Both are ~10 m nominal. `13` is materially better — it is authoritative
 * *bare earth*, where Terrarium is a blended *surface* model that includes tree
 * canopy, so under timber `13` describes the ground and Terrarium describes the
 * treetops — but the old logging grades and micro-benches a hunter goes looking
 * for are still smaller than one pixel of it.
 *
 * Only `usgs3dep-1m` earns the word LiDAR, and it does not exist everywhere.
 * Where it is missing the app must say *no 1 m data here* and fall back
 * **visibly and labelled** — never quietly to 10 m under a LiDAR label. That is
 * the exact overclaim `a02793d` removed, and `isLidar` is what lets a caller
 * check rather than guess.
 */
export interface DemSourceDescriptor {
  id: string;
  label: string;
  /** The one place a resolution claim about this source is allowed to live. */
  resolutionNote: string;
  attribution: string;
  /** Tile URL template. API-relative for the server-rendered 3DEP sources. */
  urlTemplate: string;
  encoding: 'terrarium' | 'terrain-rgb';
  tileSize: number;
  maxZoom: number;
  /**
   * True only for genuine LiDAR-derived data.
   *
   * A boolean rather than a substring check on the label, because the check
   * that matters ("may this layer say LiDAR?") must not depend on prose that a
   * copy edit can change.
   */
  isLidar: boolean;
  /** False where coverage is partial, so a caller knows a gap is possible. */
  nationwide: boolean;
}

/**
 * Every DEM source the browser can ask for.
 *
 * The 3DEP entries are served by our own API rather than fetched from USGS
 * directly: a COG range read is not a tile fetch, and routing them through
 * `/api/terrain/dem/...` keeps tile identity as `source/z/x/y` for the offline
 * store, the region downloader and the coverage badge alike. Changing tile
 * identity instead is `R8`'s bug, and it is silent.
 */
export const DEM_SOURCES: Record<string, DemSourceDescriptor> = {
  terrarium: {
    id: 'terrarium',
    label: 'AWS Terrain Tiles (Terrarium)',
    resolutionNote: '~10 m blended DEM, zoom 15 max — not LiDAR',
    attribution: 'Mapzen / AWS Terrain Tiles; USGS, SRTM, and others',
    urlTemplate: DEFAULT_DEM_TEMPLATE,
    encoding: 'terrarium',
    tileSize: 256,
    maxZoom: 15,
    isLidar: false,
    nationwide: true,
  },
  'usgs3dep-13': {
    id: 'usgs3dep-13',
    label: 'USGS 3DEP 1/3 arc-second',
    resolutionNote: '~10 m bare-earth DEM, zoom 15 max — not LiDAR',
    attribution: 'USGS 3D Elevation Program (public domain)',
    urlTemplate: '/api/terrain/dem/usgs3dep-13/{z}/{x}/{y}.png',
    encoding: 'terrain-rgb',
    tileSize: 256,
    maxZoom: 15,
    isLidar: false,
    nationwide: true,
  },
  'usgs3dep-1m': {
    id: 'usgs3dep-1m',
    label: 'USGS 3DEP 1 m',
    resolutionNote: '1 m bare-earth LiDAR, zoom 17 max — partial US coverage',
    attribution: 'USGS 3D Elevation Program (public domain)',
    urlTemplate: '/api/terrain/dem/usgs3dep-1m/{z}/{x}/{y}.png',
    encoding: 'terrain-rgb',
    tileSize: 256,
    maxZoom: 17,
    isLidar: true,
    nationwide: false,
  },
};

/**
 * Which source this build uses, from `VITE_DEM_SOURCE` at **build** time.
 *
 * Defaults to `terrarium` — deliberately not to 3DEP. The 3DEP sources need
 * this project's own API reachable at `/api`, so defaulting to them would make
 * a static, API-less deployment render nothing, which is precisely the class of
 * silent-blank-map failure `DEFAULT_DEM_TEMPLATE`'s comment above documents.
 *
 * An unrecognised value falls back to `terrarium` rather than throwing: a typo
 * in a deploy variable should degrade to a working map, and it is visible
 * because `DEM_SOURCE.label` is rendered in the attribution.
 */
const configuredSource = import.meta.env.VITE_DEM_SOURCE;
export const DEM_SOURCE: DemSourceDescriptor =
  (typeof configuredSource === 'string' && DEM_SOURCES[configuredSource.trim()]) ||
  DEM_SOURCES.terrarium;

const configured = import.meta.env.VITE_DEM_TEMPLATE;
/**
 * `VITE_DEM_TEMPLATE` still wins when set — it is what a self-hoster points at
 * their own mirror and what a sandboxed test points at a relay. When it is not
 * set the template follows `VITE_DEM_SOURCE` via {@link DEM_SOURCE}, so
 * selecting 3DEP does not also require hand-typing its URL. That coupling is
 * worth avoiding specifically: two variables that must agree are two variables
 * that will eventually disagree, and the symptom would be a map labelled
 * "1 m LiDAR" serving Terrarium tiles.
 */
export const DEM_TEMPLATE: string =
  typeof configured === 'string' && configured.trim() !== ''
    ? configured.trim()
    : DEM_SOURCE.urlTemplate;

/**
 * Fails loudly on a template that cannot address a tile.
 *
 * The original bug was survivable-looking: no exception, no console error, just
 * a map with every terrain layer blank and no way to tell whether the ground is
 * flat or the data never arrived. That is precisely the "confidently wrong
 * about terrain" failure this codebase ranks worst, so a template that is
 * present but missing its placeholders is refused rather than fetched.
 */
export function assertUsableDemTemplate(template: string = DEM_TEMPLATE): void {
  const missing = (['{z}', '{x}', '{y}'] as const).filter((p) => !template.includes(p));
  if (missing.length > 0) {
    throw new Error(
      `DEM tile template cannot address a tile — missing ${missing.join(', ')}. ` +
        `Got ${JSON.stringify(template)}. Set VITE_DEM_TEMPLATE at build time, ` +
        `or leave it unset to use ${DEFAULT_DEM_TEMPLATE}.`,
    );
  }
}

export function demTileUrl(tile: TileCoord, template: string = DEM_TEMPLATE): string {
  return template
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y));
}
