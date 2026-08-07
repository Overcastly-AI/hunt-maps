/**
 * MapLibre custom protocol: `ridgeline://`.
 *
 * Registers a URL scheme MapLibre treats like any other raster source, but
 * which is served entirely from the device:
 *
 *   ridgeline://slope/14/4370/6323?wind=270
 *
 * The pipeline per tile is:
 *
 *   1. fetch the DEM tile + its 8 neighbours (offline cache first, network second)
 *   2. hand them to the analysis worker
 *   3. get RGBA back, encode to PNG via OffscreenCanvas
 *   4. return it to MapLibre
 *
 * ## The design decision that matters
 *
 * The offline cache stores **elevation** tiles, not rendered layers. Rendered
 * tiles would have to be pre-baked per layer *and* per wind direction *and* per
 * date — thousands of variants of the same ground, most of which the user will
 * never look at. Caching the DEM instead means one download unlocks every
 * layer, every wind, and every date, computed on demand. It is the difference
 * between "the four layers I remembered to download" and "the whole analysis
 * suite, with no signal".
 */

import maplibregl from 'maplibre-gl';
import type { AnalysisLayer, DemEncoding, TerrainPredicate } from '@hunt-maps/terrain';
import { openTileStore, type TileKey } from '../offline/tileStore';
import { demTileKey } from './demTiles';
import type { RenderTileMessage, WorkerResponse } from '../../workers/terrain.worker';

export const PROTOCOL = 'ridgeline';

export interface TerrainProtocolConfig {
  /** DEM tile template, e.g. the AWS Terrarium endpoint or an API proxy. */
  demUrlTemplate: string;
  demEncoding: DemEncoding;
  tileSize: number;
  /** Named filter stacks the protocol can render, keyed by stack id. */
  filterStacks?: Map<
    string,
    Array<{ predicate: TerrainPredicate; color: string; opacity: number; outline?: boolean }>
  >;
}

interface Pending {
  resolve: (value: { data: Uint8Array }) => void;
  reject: (err: Error) => void;
}

export class TerrainProtocol {
  private worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly demCache = new Map<string, Promise<ImageData | null>>();

  constructor(private config: TerrainProtocolConfig) {
    this.worker = new Worker(new URL('../../workers/terrain.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onWorkerMessage(e.data);
    this.worker.onerror = (e) => {
      // A dead worker would otherwise leave every in-flight tile hanging
      // forever, which reads to the user as "the map froze".
      for (const [, p] of this.pending) p.reject(new Error(e.message || 'Terrain worker failed.'));
      this.pending.clear();
    };
  }

  updateConfig(config: Partial<TerrainProtocolConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** Register with MapLibre. Call once at app start. */
  register(): void {
    maplibregl.addProtocol(PROTOCOL, async (params, abortController) => {
      const data = await this.handle(params.url, abortController?.signal);
      return { data };
    });
  }

  unregister(): void {
    maplibregl.removeProtocol(PROTOCOL);
    this.worker.terminate();
  }

  private async handle(url: string, signal?: AbortSignal): Promise<Uint8Array> {
    // ridgeline://<layer>/<z>/<x>/<y>?wind=..&at=..&stack=..
    const withoutScheme = url.replace(`${PROTOCOL}://`, '');
    const [path, query = ''] = withoutScheme.split('?');
    const [layer, zs, xs, ys] = path.split('/');
    const z = Number(zs);
    const x = Number(xs);
    const y = Number(ys);
    if (!layer || !Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`Malformed ridgeline tile URL: ${url}`);
    }

    const params = new URLSearchParams(query);
    const wind = params.get('wind');
    const at = params.get('at');
    const stackId = params.get('stack');

    const { tileSize, demEncoding } = this.config;

    // Fetch centre + neighbours together. Neighbour failures are tolerated —
    // an edge-of-coverage 404 should cost one seam, not the whole tile.
    const offsets: Array<[number, number]> = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx !== 0 || dy !== 0) offsets.push([dx, dy]);
      }
    }

    const [center, ...neighbourImages] = await Promise.all([
      this.loadDem(z, x, y, signal),
      ...offsets.map(([dx, dy]) => this.loadDem(z, x + dx, y + dy, signal).catch(() => null)),
    ]);

    if (!center) throw new Error(`No elevation data for ${z}/${x}/${y}.`);

    const neighbours: RenderTileMessage['neighbours'] = [];
    const transfers: ArrayBuffer[] = [];
    neighbourImages.forEach((img, i) => {
      if (!img) return;
      const buf = toArrayBuffer(img.data);
      neighbours.push({ dx: offsets[i][0], dy: offsets[i][1], data: buf });
      transfers.push(buf);
    });

    const centerBuf = toArrayBuffer(center.data);
    transfers.push(centerBuf);

    const message: RenderTileMessage = {
      id: this.nextId++,
      type: 'render',
      tile: { z, x, y },
      center: centerBuf,
      neighbours,
      tileSize,
      encoding: demEncoding,
      layer: (stackId ? 'filters' : layer) as AnalysisLayer | 'filters',
      filters: stackId ? this.config.filterStacks?.get(stackId) : undefined,
      windFromDeg: wind !== null ? Number(wind) : undefined,
      atUtcMs: at !== null ? Number(at) : undefined,
    };

    const result = await this.postToWorker(message, transfers, signal);
    return encodePng(new Uint8ClampedArray(result.rgba), result.width, result.height);
  }

  private postToWorker(
    message: RenderTileMessage,
    transfers: ArrayBuffer[],
    signal?: AbortSignal,
  ): Promise<Extract<WorkerResponse, { ok: true }>> {
    return new Promise((resolve, reject) => {
      this.pending.set(message.id, {
        resolve: resolve as never,
        reject,
      });
      signal?.addEventListener('abort', () => {
        this.pending.delete(message.id);
        reject(new DOMException('Tile aborted', 'AbortError'));
      });
      this.worker.postMessage(message, transfers);
    });
  }

  private onWorkerMessage(response: WorkerResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.ok) {
      (pending.resolve as unknown as (r: WorkerResponse) => void)(response);
    } else {
      pending.reject(new Error(response.error));
    }
  }

  /**
   * Load one DEM tile as ImageData, offline cache first.
   *
   * Requests for the same tile are coalesced in `demCache`: a single map view
   * asks for each tile up to nine times (once as a centre, eight times as a
   * neighbour), and without coalescing that is nine decodes of the same PNG.
   */
  private loadDem(
    z: number,
    x: number,
    y: number,
    signal?: AbortSignal,
  ): Promise<ImageData | null> {
    const key = `${z}/${x}/${y}`;
    let entry = this.demCache.get(key);
    if (!entry) {
      // `demTileKey` is shared with the offline coverage query. If the two ever
      // derived the store key separately, the badge could report a view covered
      // while this fetch looked somewhere else and found nothing.
      entry = this.fetchDem(demTileKey({ z, x, y }), signal);
      this.demCache.set(key, entry);
      // Bound the in-memory cache; the persistent store is the real cache.
      if (this.demCache.size > 512) {
        const oldest = this.demCache.keys().next().value;
        if (oldest !== undefined) this.demCache.delete(oldest);
      }
    }
    return entry;
  }

  private async fetchDem(key: TileKey, signal?: AbortSignal): Promise<ImageData | null> {
    const store = await openTileStore();

    const cached = await store.get(key);
    if (cached) return decodeImage(new Blob([cached], { type: 'image/png' }));

    const url = this.config.demUrlTemplate
      .replace('{z}', String(key.z))
      .replace('{x}', String(key.x))
      .replace('{y}', String(key.y));

    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();

    // Persist for offline use. A quota failure must not fail the tile — the
    // user still gets their map, just without it being saved.
    await store.put(key, buf).catch(() => undefined);
    return decodeImage(new Blob([buf], { type: 'image/png' }));
  }
}

function toArrayBuffer(data: Uint8ClampedArray): ArrayBuffer {
  // Copy so the source ImageData stays usable after the buffer is transferred.
  return data.slice().buffer as ArrayBuffer;
}

async function decodeImage(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable — cannot decode elevation tiles.');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function encodePng(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable — cannot encode analysis tiles.');
  // `ImageData` insists on a Uint8ClampedArray backed by a plain ArrayBuffer.
  // The worker hands the buffer back after a transfer, which TypeScript types
  // as ArrayBufferLike, so copy into a freshly-allocated ImageData instead of
  // fighting the overload.
  const image = ctx.createImageData(width, height);
  image.data.set(rgba);
  ctx.putImageData(image, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

/** Build a `ridgeline://` tile URL template for a MapLibre raster source. */
export function terrainTileUrl(
  layer: AnalysisLayer | 'filters',
  options: { windFromDeg?: number; atUtc?: Date; stackId?: string } = {},
): string {
  const params = new URLSearchParams();
  if (options.windFromDeg !== undefined) params.set('wind', String(Math.round(options.windFromDeg)));
  if (options.atUtc) params.set('at', String(options.atUtc.getTime()));
  if (options.stackId) params.set('stack', options.stackId);
  const query = params.toString();
  return `${PROTOCOL}://${layer}/{z}/{x}/{y}${query ? `?${query}` : ''}`;
}
