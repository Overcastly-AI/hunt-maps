/**
 * The loud failure for "this operator needs more terrain than it was given".
 *
 * ## Why an error and not a degraded answer
 *
 * Every neighbourhood operator here reads a halo of cells around each output
 * cell, sized by `requiredHalo()`. The halo is supplied by fetching the centre
 * DEM tile plus its eight neighbours, so a 3x3 fetch of `tileSize`-pixel tiles
 * can supply a halo of at most `tileSize` cells. Ask for more — a 500 m shelter
 * radius is 273 cells at z16 on 1.83 m pixels — and there is nothing to read.
 *
 * Both shipped callers clamp with `Math.min(requiredHalo(request), tileSize)`.
 * That clamp is safe *only* because this error exists: without it the operator
 * ran on a halo it silently did not have, every unwritten cell read as the
 * `NODATA` sentinel, and the layer reported open ground (see `isElevation`).
 * A hunter then picks a "sun-warmed" bench that sits in shade all morning, and
 * nothing anywhere says the inputs ran out.
 *
 * So: refuse. The project rule is "say when you do not know" — grey a layer out
 * rather than render a default — and a layer that reports full sun because it
 * ran out of DEM is exactly a default being rendered.
 *
 * ## Contract for callers
 *
 * This is a *recoverable, expected* condition — "zoom out or fetch wider", not
 * "the engine is broken" — so a caller must be able to tell it apart from a
 * genuine fault and grey the layer rather than show an error page. Two ways,
 * both stable:
 *
 *  - `isInsufficientHaloError(err)` when the value survives intact;
 *  - `err.code === INSUFFICIENT_HALO`, which also survives a structured clone,
 *    and the token appears in `err.message` for callers (such as the web
 *    worker's `postMessage` error path) that forward only the string.
 *
 * `instanceof` is deliberately *not* the documented test: the engine is bundled
 * separately into the API, the page and the service worker, so the class
 * identity a caller compares against is not always the one that threw.
 */

/** Stable machine-readable discriminator. Do not rename; callers match on it. */
export const INSUFFICIENT_HALO = 'INSUFFICIENT_HALO';

export interface InsufficientHaloInit {
  /** Halo the request needs, in cells. */
  required: number;
  /** Halo actually available, in cells. */
  available: number;
  /** Layers that drove the requirement, for the message. */
  layers?: readonly string[];
  /** Extra sentence explaining where the ceiling came from. */
  detail?: string;
}

export class InsufficientHaloError extends Error {
  readonly code = INSUFFICIENT_HALO;
  readonly required: number;
  readonly available: number;
  readonly layers: readonly string[];

  constructor(init: InsufficientHaloInit) {
    const layers = init.layers ?? [];
    super(
      `${INSUFFICIENT_HALO}: this analysis needs a halo of ${init.required} cells but only ` +
        `${init.available} are available` +
        (layers.length ? ` (requested by: ${layers.join(', ')})` : '') +
        `. ${init.detail ?? ''}`.trimEnd(),
    );
    this.name = 'InsufficientHaloError';
    this.required = init.required;
    this.available = init.available;
    this.layers = layers;
  }
}

/**
 * Is this the recoverable "ran out of terrain" failure?
 *
 * Duck-typed on `code` rather than `instanceof` — see the note above on why the
 * class identity cannot be relied on across the API / page / worker bundles.
 */
export function isInsufficientHaloError(err: unknown): err is InsufficientHaloError {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === INSUFFICIENT_HALO
  );
}
