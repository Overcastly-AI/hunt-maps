/**
 * Tests for the HTTP binding of `RangeReader`.
 *
 * All offline: a fake `fetch` serves a byte string, so every failure mode a
 * real server can produce — an ignored `Range:`, a truncated body, a 404, a
 * hang — is reproducible and deterministic here. That matters more than usual
 * for this file, because each of those failures is one that would otherwise
 * surface as *plausible elevation from the wrong offset* rather than as an
 * error.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createRangeFetcher,
  fetchText,
  RangeFetchError,
  type FetchLike,
  type FetchLikeResponse,
} from './rangeFetch.js';

/** A body of 1024 bytes where byte i has value i % 251 — position-revealing. */
const BODY = new Uint8Array(1024).map((_, i) => i % 251);

function ok(bytes: Uint8Array, status = 206): FetchLikeResponse {
  return {
    ok: true,
    status,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}

/** A well-behaved server that honours `Range:`. */
const honouring: FetchLike = async (_url, init) => {
  const m = /bytes=(\d+)-(\d+)/.exec(init?.headers?.Range ?? '');
  if (!m) return ok(BODY, 200);
  const start = Number(m[1]);
  const end = Math.min(Number(m[2]), BODY.length - 1);
  if (start >= BODY.length)
    return { ok: false, status: 416, arrayBuffer: async () => new ArrayBuffer(0) };
  return ok(BODY.subarray(start, end + 1));
};

describe('createRangeFetcher', () => {
  it('returns exactly the requested bytes from a compliant server', async () => {
    const read = createRangeFetcher('https://example/x.tif', { fetchImpl: honouring });
    const bytes = await read(300, 309);
    expect(bytes.length).toBe(10);
    // Closed form: the fixture body is i % 251, so byte 300 is 300 % 251 = 49.
    expect([...bytes]).toEqual([49, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
  });

  it('sends a well-formed inclusive Range header', async () => {
    const spy = vi.fn(honouring);
    const read = createRangeFetcher('https://example/x.tif', { fetchImpl: spy });
    await read(0, 31);
    expect(spy.mock.calls[0][1]?.headers?.Range).toBe('bytes=0-31');
  });

  /**
   * The failure this whole module exists for. A server that ignores `Range:`
   * answers 200 with the entire file; trusting that hands the caller byte 0
   * where it asked for byte 300, which decodes as a real TIFF tile from the
   * wrong part of the raster — elevation that is genuine data from the wrong
   * place, the most dangerous kind of wrong this codebase has.
   */
  it('slices locally when the server ignores Range and returns 200', async () => {
    const ignoring: FetchLike = async () => ok(BODY, 200);
    const read = createRangeFetcher('https://example/x.tif', { fetchImpl: ignoring });
    const bytes = await read(300, 309);
    expect([...bytes]).toEqual([49, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
  });

  it('refuses a 200 body that does not reach the requested offset', async () => {
    const short: FetchLike = async () => ok(BODY.subarray(0, 100), 200);
    const read = createRangeFetcher('https://example/x.tif', { fetchImpl: short });
    await expect(read(300, 309)).rejects.toBeInstanceOf(RangeFetchError);
  });

  it('refuses a 200 body that ends inside the requested range', async () => {
    const short: FetchLike = async () => ok(BODY.subarray(0, 305), 200);
    const read = createRangeFetcher('https://example/x.tif', { fetchImpl: short });
    await expect(read(300, 309)).rejects.toThrow(/5 bytes short/);
  });

  it('rejects on a non-OK status, carrying the code for the caller to branch on', async () => {
    const missing: FetchLike = async () => ({
      ok: false,
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    const read = createRangeFetcher('https://example/x.tif', { fetchImpl: missing });
    // 404 is the ordinary answer while probing 1 m stems, so the status must
    // survive to the caller rather than being flattened into a generic error.
    await expect(read(0, 31)).rejects.toMatchObject({ status: 404, name: 'RangeFetchError' });
  });

  it('rejects rather than returning an empty 206 body', async () => {
    const empty: FetchLike = async () => ok(new Uint8Array(0), 206);
    const read = createRangeFetcher('https://example/x.tif', { fetchImpl: empty });
    await expect(read(0, 31)).rejects.toThrow(/empty body/);
  });

  it('rejects a transport failure instead of returning zero bytes', async () => {
    // `CogReader` turns a rejection into NODATA — a visible hole. Returning
    // empty bytes instead would decode as elevation 0 m: sea level under the
    // hunter's feet.
    const dead: FetchLike = async () => {
      throw new Error('network down');
    };
    const read = createRangeFetcher('https://example/x.tif', { fetchImpl: dead });
    await expect(read(0, 31)).rejects.toThrow(/network down/);
  });

  it('rejects a nonsensical range without touching the network', async () => {
    const spy = vi.fn(honouring);
    const read = createRangeFetcher('https://example/x.tif', { fetchImpl: spy });
    await expect(read(10, 5)).rejects.toThrow(/Empty byte range/);
    await expect(read(-1, 5)).rejects.toThrow(/Invalid byte range/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('propagates the caller abort signal', async () => {
    const controller = new AbortController();
    const watching: FetchLike = async (_u, init) => {
      expect(init?.signal?.aborted).toBe(true);
      throw new Error('aborted');
    };
    controller.abort();
    const read = createRangeFetcher('https://example/x.tif', {
      fetchImpl: watching,
      signal: controller.signal,
    });
    await expect(read(0, 31)).rejects.toThrow();
  });

  it('times out rather than hanging a tile forever', async () => {
    const hanging: FetchLike = (_u, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted by signal')));
      });
    const read = createRangeFetcher('https://example/x.tif', {
      fetchImpl: hanging,
      timeoutMs: 10,
    });
    await expect(read(0, 31)).rejects.toThrow(/aborted by signal/);
  });
});

describe('fetchText', () => {
  it('decodes a body as UTF-8', async () => {
    const text = 'https://example/USGS_1M_16_x27y405_KY_Statewide_2021_A21.tif\n';
    const server: FetchLike = async () => ok(new TextEncoder().encode(text), 200);
    await expect(fetchText('https://example/manifest.txt', { fetchImpl: server })).resolves.toBe(
      text,
    );
  });

  it('rejects a 404 with the status attached', async () => {
    const server: FetchLike = async () => ({
      ok: false,
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    await expect(
      fetchText('https://example/manifest.txt', { fetchImpl: server }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
