/**
 * Binding {@link RangeReader} to HTTP — the one piece `CogReader` deliberately
 * does not own.
 *
 * `CogReader` takes its I/O as a function so the identical decoding code can run
 * against `fetch` in a browser worker, against `fetch` in Node on the API, and
 * against a committed fixture in a test with no network at all. This module is
 * the `fetch` half of that, and it is the only place in the engine that performs
 * network I/O.
 *
 * ## Why this is not a two-line wrapper
 *
 * A naive `fetch(url, { headers: { Range } })` is wrong in three ways that all
 * fail *silently* — which, per this package's standing rule, is worse than
 * failing loudly:
 *
 * 1. **A server may ignore `Range:` and return 200 with the whole body.** S3
 *    honours it, but a corporate proxy, a CDN in front of a self-hosted mirror,
 *    or a dev-server relay may not. The caller then gets byte 0 of a 485 MB file
 *    where it asked for byte 300 000 000, decodes garbage as a TIFF tile, and
 *    renders elevation that is real data from the wrong place. We detect the
 *    200 and slice locally instead.
 * 2. **A short read is not an error to `fetch`.** Ranges past EOF come back
 *    truncated, or as 416. `CogReader.open` interprets a short header read as
 *    "probe more"; a *tile* read that is short means the file is not what the
 *    IFD said it was, and quietly zero-padding it invents flat ground.
 * 3. **A failed read must stay a failure.** `CogReader` catches rejections from
 *    a tile read and turns them into NODATA — a visible coverage hole. If this
 *    layer swallowed errors and returned empty bytes instead, the same hole
 *    would decode as elevation 0 m, i.e. sea level, under a hunter's feet.
 *
 * So: reject, with a message that says which URL and which byte range, and let
 * the layer above decide whether that is a hole or a hard failure.
 *
 * ## Zero dependencies, three runtimes
 *
 * `fetch`, `Headers`, `Response` and `AbortSignal` are globals in Node >= 18,
 * in browsers, and in service workers. Nothing here imports a Node builtin, so
 * this file ships into the service worker unchanged — which is the whole
 * constraint `packages/terrain` exists under.
 */

import type { RangeReader } from './cog.js';

/** Thrown when a range read cannot be trusted. Never swallowed silently. */
export class RangeFetchError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RangeFetchError';
  }
}

export interface RangeFetchOptions {
  /** Cancels in-flight reads — MapLibre aborts tiles as you pan past them. */
  signal?: AbortSignal;
  /**
   * Per-request timeout. A hunter on one bar of signal is the common case, and
   * a request that hangs forever is indistinguishable to them from a frozen
   * map. Default 20 s, matching the API's existing DEM fetch.
   */
  timeoutMs?: number;
  /**
   * Extra headers. The API sets a `User-Agent` identifying the project, which
   * is basic courtesy to a public dataset we hammer for offline packaging.
   */
  headers?: Record<string, string>;
  /**
   * Injected for tests. Defaults to the global `fetch`; declared as a narrow
   * structural type rather than `typeof fetch` so this file does not depend on
   * DOM or Node lib typings being present.
   */
  fetchImpl?: FetchLike;
}

/**
 * The slice of `fetch` this module uses.
 *
 * Deliberately structural. `packages/terrain` compiles for both DOM and Node
 * consumers, and referencing `RequestInit`/`Response` directly would drag one
 * runtime's lib into the other's build.
 */
export type FetchLike = (
  url: string,
  init?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    method?: string;
  },
) => Promise<FetchLikeResponse>;

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

const DEFAULT_TIMEOUT_MS = 20_000;

function globalFetch(): FetchLike {
  const f = (globalThis as { fetch?: unknown }).fetch;
  if (typeof f !== 'function') {
    throw new RangeFetchError(
      'No global fetch in this runtime. Pass `fetchImpl` explicitly.',
      '(none)',
    );
  }
  return f as FetchLike;
}

/**
 * Combine the caller's abort signal with a timeout.
 *
 * Written by hand rather than with `AbortSignal.any`, which is too new to rely
 * on in the browsers this PWA targets, and `AbortSignal.timeout`, which exists
 * but cannot be combined with a caller signal without `any`.
 */
function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const onAbort = (): void => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * A {@link RangeReader} that reads `url` over HTTP with a `Range:` header.
 *
 * This is what turns the COG reader from a decoder into a data source. Bind it
 * once per file and hand it to `CogReader.open`.
 *
 * Rejects rather than returning short or misaligned bytes — see the module
 * comment for why each of those cases is a silent-wrong-elevation bug.
 */
export function createRangeFetcher(url: string, options: RangeFetchOptions = {}): RangeReader {
  const doFetch = options.fetchImpl ?? globalFetch();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (start: number, endInclusive: number): Promise<Uint8Array> => {
    if (!Number.isInteger(start) || !Number.isInteger(endInclusive) || start < 0) {
      throw new RangeFetchError(
        `Invalid byte range ${start}-${endInclusive} (must be non-negative integers).`,
        url,
      );
    }
    if (endInclusive < start) {
      throw new RangeFetchError(`Empty byte range ${start}-${endInclusive}.`, url);
    }

    const wanted = endInclusive - start + 1;
    const { signal, done } = withTimeout(options.signal, timeoutMs);

    let res: FetchLikeResponse;
    try {
      res = await doFetch(url, {
        headers: { ...options.headers, Range: `bytes=${start}-${endInclusive}` },
        signal,
      });
    } catch (err) {
      throw new RangeFetchError(
        `Range read ${start}-${endInclusive} failed: ${err instanceof Error ? err.message : String(err)}`,
        url,
      );
    } finally {
      done();
    }

    if (!res.ok) {
      // 404 is the ordinary "this 1 m project has no tile here" answer and the
      // caller (project resolution) treats it as such; it still travels as an
      // error so nothing can mistake it for empty ground.
      throw new RangeFetchError(
        `Range read ${start}-${endInclusive} returned HTTP ${res.status}.`,
        url,
        res.status,
      );
    }

    const body = new Uint8Array(await res.arrayBuffer());

    // Status 200 means the server ignored `Range:` and sent the whole entity.
    // Slicing locally is correct and costs bandwidth, not correctness — but it
    // is emphatically not the same as trusting the bytes at face value, which
    // would hand the caller the head of the file for every offset it asked for.
    if (res.status === 200) {
      if (body.length < start) {
        throw new RangeFetchError(
          `Server ignored Range: and returned ${body.length} bytes, which does not ` +
            `reach offset ${start}. The file is shorter than its own index claims.`,
          url,
          res.status,
        );
      }
      const slice = body.subarray(start, Math.min(start + wanted, body.length));
      if (slice.length < wanted) {
        throw new RangeFetchError(
          `Server ignored Range: and the file ends at ${body.length}, ` +
            `${wanted - slice.length} bytes short of the requested ${start}-${endInclusive}.`,
          url,
          res.status,
        );
      }
      return slice;
    }

    // A 206 shorter than requested means we asked past EOF. `CogReader.open`
    // legitimately over-asks for its header probe, so a short read there is
    // fine and it re-probes; a short *tile* read is a corrupt index. This layer
    // cannot tell the two apart, so it returns what it got and lets `parseTiff`
    // raise `TiffTruncatedError`, which is the error that carries the retry
    // information. Only a *zero*-length body is unambiguously wrong.
    if (body.length === 0) {
      throw new RangeFetchError(
        `Range read ${start}-${endInclusive} returned HTTP ${res.status} with an empty body.`,
        url,
        res.status,
      );
    }

    return body;
  };
}

/**
 * Fetch a whole small object as text — the S3 listings and per-project file
 * manifests that 1 m project discovery reads.
 *
 * Lives here rather than in `oneMeterIndex.ts` for the same reason
 * `createRangeFetcher` does: this file is the engine's only I/O, so a reviewer
 * checking "does the terrain package touch the network anywhere unexpected"
 * has exactly one file to read.
 */
export async function fetchText(url: string, options: RangeFetchOptions = {}): Promise<string> {
  const doFetch = options.fetchImpl ?? globalFetch();
  const { signal, done } = withTimeout(options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let res: FetchLikeResponse;
  try {
    res = await doFetch(url, { headers: options.headers, signal });
  } catch (err) {
    throw new RangeFetchError(
      `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      url,
    );
  } finally {
    done();
  }
  if (!res.ok) {
    throw new RangeFetchError(`Fetch returned HTTP ${res.status}.`, url, res.status);
  }
  return new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()));
}
