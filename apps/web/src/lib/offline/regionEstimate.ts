/**
 * "How big is this, honestly?" — asked before a single byte is downloaded.
 *
 * Tile count grows 4× per zoom level and nobody's intuition handles that. A
 * hunter drags a box, nudges the detail slider from 13 to 15, and turns a 30 MB
 * download into a 480 MB one without noticing. So the estimate is shown first,
 * with the server's own plain-language warnings, and the download button says
 * the number out loud.
 *
 * ## The inconsistency between this client and the API, and how it is resolved
 *
 * `POST /offline/regions/estimate` takes a `layers[]` array and multiplies the
 * tile count by a per-layer byte cost. That shape assumes a cache of *rendered*
 * layer tiles, which is precisely the architecture this product does not have
 * and must never acquire — see `regionPlan.ts`. We therefore send the truth,
 * `layers: ['elevation']`, rather than inflating the request with a list of
 * layers we are not going to download in order to make the API's arithmetic
 * come out looking right.
 *
 * That has one consequence which must not be papered over: the API's
 * `BYTES_PER_TILE` table has no elevation entry, so it falls through to a
 * 10 000-byte default against a measured ~100 000 bytes for a real Terrarium
 * DEM tile. Its **tile count** for an elevation-only request is exactly right;
 * its **byte figure** is a tenfold under-statement.
 *
 * So the split is:
 *
 *  - **Tile count** comes from the local plan, which is the literal list of
 *    tiles the downloader will fetch. The server's count is compared against it
 *    and a disagreement is surfaced as a warning rather than silently
 *    preferring one — two components disagreeing about which tiles a region
 *    needs is the R8 defect class.
 *  - **Byte figure** comes from {@link DEM_BYTES_PER_TILE}, measured on real
 *    tiles.
 *  - **Warnings** come from the server verbatim, with exactly one exception:
 *    its size warning is regenerated from the honest byte figure, *in the
 *    server's own sentence*, because passing through "About 0.6 GB" for a 6 GB
 *    download would be worse than saying nothing.
 *
 * When the API cannot be reached — no signal, or no session, which is the
 * normal case for this app today — the same rules are evaluated on-device and
 * the result is marked `source: 'device'`. The picker has to work at camp with
 * one bar; making the estimate depend on a round trip would break the feature
 * in the exact conditions it exists for.
 */

import type { BBox } from '@hunt-maps/terrain';
import { DEM_BYTES_PER_TILE, MAX_REGION_TILES, formatBytes } from './regionPlan';

export interface RegionEstimate {
  /** Tiles the downloader will actually fetch. From the local plan. */
  tileCount: number;
  /** `tileCount × DEM_BYTES_PER_TILE`. Elevation only, measured constant. */
  estimatedBytes: number;
  warnings: string[];
  /**
   * `server` — the API confirmed the plan and contributed its warnings.
   * `device` — computed here because the API was unreachable. Shown to the
   * user; an estimate nobody checked is a weaker claim and they should know.
   */
  source: 'server' | 'device';
  /** Present only when the server's tile count disagreed with the plan's. */
  serverTileCount?: number;
}

interface ServerEstimate {
  tileCount: number;
  estimatedBytes: number;
  byLayer: Array<{ layer: string; tileCount: number; estimatedBytes: number }>;
  warnings: string[];
}

/**
 * The one layer we ever ask the server about.
 *
 * Not a `MapLayerKind` — deliberately. There is no member of that enum for
 * "elevation", because the enum enumerates things that get *rendered*. Sending
 * `slope` or `hillshade` here would be claiming we cache rendered analysis
 * tiles, and the estimate would then be a description of a product we do not
 * ship.
 */
export const ELEVATION_LAYER = 'elevation';

/**
 * The server's byte-derived warning, which we regenerate rather than pass on.
 *
 * Matched by shape, not by exact string, so a copy edit on the API side does
 * not silently start letting a tenfold-wrong number through. If the API ever
 * grows a correct elevation byte cost, delete this and the regeneration below
 * together — and the test that pins them.
 */
const SERVER_SIZE_WARNING = /^About [\d.]+ GB\. Start this on wifi/;

/** Above this, say so in the server's words. Mirrors the API's threshold. */
const SIZE_WARNING_BYTES = 500_000_000;

export interface EstimateRequest {
  bounds: BBox;
  minZoom: number;
  maxZoom: number;
  /** From the local plan — the tiles that will actually be fetched. */
  tileCount: number;
  name?: string;
  signal?: AbortSignal;
  /** Injected by tests. Production uses `window.fetch`. */
  fetchImpl?: typeof fetch;
  /** Free bytes the browser says it will give us, if known. */
  freeBytes?: number;
}

/**
 * Warnings we can derive without the server.
 *
 * The first two mirror the API's rules and wording exactly so an online and an
 * offline estimate read identically — a user who saw one sentence on wifi and a
 * differently-phrased one at camp would reasonably assume the answer changed.
 * The third is device-local knowledge the server cannot have.
 */
export function deviceWarnings(
  tileCount: number,
  estimatedBytes: number,
  freeBytes?: number,
): string[] {
  const warnings: string[] = [];

  if (tileCount > MAX_REGION_TILES) {
    warnings.push(
      `${tileCount.toLocaleString()} tiles is above the ${MAX_REGION_TILES.toLocaleString()} ` +
        `limit. Reduce max zoom or shrink the area.`,
    );
  }

  if (estimatedBytes > SIZE_WARNING_BYTES) {
    warnings.push(
      `About ${(estimatedBytes / 1e9).toFixed(1)} GB. Start this on wifi, not the night ` +
        `before a hunt.`,
    );
  }

  // Only the device knows this, and it is the difference between a download
  // that stops at 80% in the dark and one that never started.
  if (freeBytes !== undefined && estimatedBytes > freeBytes * 0.9) {
    warnings.push(
      `This browser will only give us about ${formatBytes(freeBytes)} of storage, and this ` +
        `region needs about ${formatBytes(estimatedBytes)}. It will run out part-way. ` +
        `Shrink the area or drop the detail level.`,
    );
  }

  return warnings;
}

/**
 * Estimate a region, server-confirmed when possible.
 *
 * Never throws: an estimate that fails is an estimate the user does not get,
 * and the picker still has to open. Failure degrades to `source: 'device'`,
 * which the UI states.
 */
export async function estimateRegion(req: EstimateRequest): Promise<RegionEstimate> {
  const estimatedBytes = req.tileCount * DEM_BYTES_PER_TILE;
  const local = deviceWarnings(req.tileCount, estimatedBytes, req.freeBytes);

  const server = await fetchServerEstimate(req);
  if (!server) {
    return {
      tileCount: req.tileCount,
      estimatedBytes,
      warnings: local,
      source: 'device',
    };
  }

  // Keep the server's sentences, drop only the one computed from a byte cost
  // that does not describe an elevation tile, then re-add our own version of it.
  const kept = server.warnings.filter((w) => !SERVER_SIZE_WARNING.test(w));
  const warnings = dedupe([...kept, ...local]);

  const disagrees = server.tileCount !== req.tileCount;
  if (disagrees) {
    // Loud, not silent. The two enumerations are meant to be the same function;
    // if they have drifted, every number on this screen is suspect and the user
    // is the one who pays for a wrong "Covered" badge later.
    warnings.unshift(
      `The server planned ${server.tileCount.toLocaleString()} tiles for this area and this ` +
        `device planned ${req.tileCount.toLocaleString()}. The download will fetch what this ` +
        `device planned. Report this — the two are meant to agree exactly.`,
    );
  }

  return {
    tileCount: req.tileCount,
    estimatedBytes,
    warnings,
    source: 'server',
    ...(disagrees ? { serverTileCount: server.tileCount } : {}),
  };
}

async function fetchServerEstimate(req: EstimateRequest): Promise<ServerEstimate | null> {
  const doFetch = req.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!doFetch) return null;
  try {
    const res = await doFetch('/api/offline/regions/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      signal: req.signal,
      body: JSON.stringify({
        name: req.name ?? 'Estimate',
        west: req.bounds.west,
        south: req.bounds.south,
        east: req.bounds.east,
        north: req.bounds.north,
        minZoom: req.minZoom,
        maxZoom: req.maxZoom,
        // Elevation, and nothing else, ever. See this file's header.
        layers: [ELEVATION_LAYER],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as ServerEstimate;
    if (!body || typeof body.tileCount !== 'number' || !Array.isArray(body.warnings)) return null;
    return body;
  } catch {
    // Offline, no session, CORS, a proxy that is not there in preview builds —
    // all the same to the user, and all recoverable by estimating locally.
    return null;
  }
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

/** Free storage the browser says it will grant, or `undefined` if it will not say. */
export async function freeStorageBytes(): Promise<number | undefined> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est || est.quota === undefined) return undefined;
    return Math.max(0, est.quota - (est.usage ?? 0));
  } catch {
    return undefined;
  }
}
