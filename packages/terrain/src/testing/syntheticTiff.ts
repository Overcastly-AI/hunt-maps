/**
 * A minimal TIFF *writer*, for tests only.
 *
 * Exists so a test can state a surface with a closed-form answer — a plane of
 * known gradient, a cell that is deliberately void — and then read it back
 * through the real decoder. It writes only **uncompressed** rasters, and that
 * restriction is deliberate: LZW and the floating-point predictor are validated
 * against a committed slice of a real USGS 3DEP file instead, because an
 * encoder we wrote and a decoder we wrote would happily agree with each other
 * while both being wrong about what GDAL actually emits.
 *
 * It can also write an **overview chain**, and that matters more than it looks:
 * GDAL puts `ModelPixelScale`/`ModelTiepoint` on the first directory *only*, so
 * an overview IFD is georeferenced purely by its size ratio to IFD 0. A writer
 * that helpfully repeated the geo tags on every level would make the reader's
 * overview handling untestable, and that path had a real bug in it.
 *
 * Sibling of `synthetic.ts`, which does the same job for height grids.
 */

export interface SyntheticLevel {
  width: number;
  height: number;
  /** Sample values, row-major, `width * height` long. */
  samples: number[];
}

export interface SyntheticOptions {
  width: number;
  height: number;
  tileWidth?: number;
  tileHeight?: number;
  /** Sample values, row-major, `width * height` long. */
  samples: number[];
  sampleFormat?: number;
  bitsPerSample?: number;
  noData?: string;
  pixelScale?: [number, number, number];
  tiePoint?: [number, number, number, number, number, number];
  geoKeys?: number[];
  littleEndian?: boolean;
  /**
   * Reduced-resolution levels, appended as further IFDs in order. Written
   * exactly as GDAL writes them: `NewSubfileType` bit 0 set, and **no** geo
   * tags of their own.
   */
  overviews?: SyntheticLevel[];
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 12: 8 };

interface Entry {
  tag: number;
  type: number;
  values: number[];
}

/** Writes an uncompressed, tiled TIFF with an optional overview chain. */
export function writeSyntheticTiff(opts: SyntheticOptions): Uint8Array {
  const le = opts.littleEndian ?? true;
  const bps = opts.bitsPerSample ?? 32;
  const fmt = opts.sampleFormat ?? 3;
  const bytesPerSample = bps / 8;

  const levels: SyntheticLevel[] = [
    { width: opts.width, height: opts.height, samples: opts.samples },
    ...(opts.overviews ?? []),
  ];

  // Tile size is shared across levels, as it is in a real COG.
  const tw = opts.tileWidth ?? opts.width;
  const th = opts.tileHeight ?? opts.height;

  interface Plan {
    level: SyntheticLevel;
    entries: Entry[];
    across: number;
    down: number;
    tileBytes: number;
  }

  const plans: Plan[] = levels.map((level, index) => {
    const across = Math.ceil(level.width / tw);
    const down = Math.ceil(level.height / th);
    const tileBytes = tw * th * bytesPerSample;
    const entries: Entry[] = [
      { tag: 256, type: 3, values: [level.width] },
      { tag: 257, type: 3, values: [level.height] },
      { tag: 258, type: 3, values: [bps] },
      { tag: 259, type: 3, values: [1] }, // uncompressed
      { tag: 262, type: 3, values: [1] },
      { tag: 277, type: 3, values: [1] },
      { tag: 284, type: 3, values: [1] },
      { tag: 317, type: 3, values: [1] }, // no predictor
      { tag: 322, type: 3, values: [tw] },
      { tag: 323, type: 3, values: [th] },
      { tag: 324, type: 4, values: new Array(across * down).fill(0) },
      { tag: 325, type: 4, values: new Array(across * down).fill(tileBytes) },
      { tag: 339, type: 3, values: [fmt] },
    ];
    if (index > 0) entries.push({ tag: 254, type: 4, values: [1] });
    if (index === 0) {
      if (opts.pixelScale) entries.push({ tag: 33550, type: 12, values: opts.pixelScale });
      if (opts.tiePoint) entries.push({ tag: 33922, type: 12, values: opts.tiePoint });
      if (opts.geoKeys) entries.push({ tag: 34735, type: 3, values: opts.geoKeys });
    }
    if (opts.noData !== undefined) {
      entries.push({
        tag: 42113,
        type: 2,
        values: [...`${opts.noData}\0`].map((c) => c.charCodeAt(0)),
      });
    }
    entries.sort((a, b) => a.tag - b.tag);
    return { level, entries, across, down, tileBytes };
  });

  // Lay the file out: IFDs first (as a COG requires), then value heaps, then
  // the raster payloads.
  let cursor = 8;
  const ifdOffsets: number[] = [];
  for (const plan of plans) {
    ifdOffsets.push(cursor);
    cursor += 2 + plan.entries.length * 12 + 4;
  }
  const heapPos = new Map<Entry, number>();
  for (const plan of plans) {
    for (const e of plan.entries) {
      const bytes = TYPE_SIZE[e.type] * e.values.length;
      if (bytes > 4) {
        heapPos.set(e, cursor);
        cursor += bytes + (bytes % 2);
      }
    }
  }
  for (const plan of plans) {
    const offsets = plan.entries.find((e) => e.tag === 324)!;
    for (let i = 0; i < offsets.values.length; i++) {
      offsets.values[i] = cursor + i * plan.tileBytes;
    }
    cursor += plan.across * plan.down * plan.tileBytes;
  }

  const buf = new Uint8Array(cursor);
  const dv = new DataView(buf.buffer);
  buf[0] = le ? 0x49 : 0x4d;
  buf[1] = le ? 0x49 : 0x4d;
  dv.setUint16(2, 42, le);
  dv.setUint32(4, ifdOffsets[0], le);

  const writeVals = (off: number, type: number, values: number[]): void => {
    values.forEach((v, i) => {
      const o = off + i * TYPE_SIZE[type];
      if (type === 3) dv.setUint16(o, v, le);
      else if (type === 4) dv.setUint32(o, v, le);
      else if (type === 12) dv.setFloat64(o, v, le);
      else dv.setUint8(o, v);
    });
  };

  plans.forEach((plan, index) => {
    const ifd = ifdOffsets[index];
    dv.setUint16(ifd, plan.entries.length, le);
    plan.entries.forEach((e, i) => {
      const p = ifd + 2 + i * 12;
      dv.setUint16(p, e.tag, le);
      dv.setUint16(p + 2, e.type, le);
      dv.setUint32(p + 4, e.values.length, le);
      const bytes = TYPE_SIZE[e.type] * e.values.length;
      if (bytes <= 4) writeVals(p + 8, e.type, e.values);
      else {
        const at = heapPos.get(e)!;
        dv.setUint32(p + 8, at, le);
        writeVals(at, e.type, e.values);
      }
    });
    dv.setUint32(ifd + 2 + plan.entries.length * 12, ifdOffsets[index + 1] ?? 0, le);

    // Tile payloads, padded at the right/bottom edges as TIFF requires.
    const offsets = plan.entries.find((e) => e.tag === 324)!;
    for (let ty = 0; ty < plan.down; ty++) {
      for (let tx = 0; tx < plan.across; tx++) {
        const base = offsets.values[ty * plan.across + tx];
        for (let y = 0; y < th; y++) {
          for (let x = 0; x < tw; x++) {
            const gx = tx * tw + x;
            const gy = ty * th + y;
            const inside = gx < plan.level.width && gy < plan.level.height;
            const v = inside ? plan.level.samples[gy * plan.level.width + gx] : 0;
            const o = base + (y * tw + x) * bytesPerSample;
            if (fmt === 3 && bytesPerSample === 4) dv.setFloat32(o, v, le);
            else if (fmt === 2 && bytesPerSample === 2) dv.setInt16(o, v, le);
            else if (fmt === 1 && bytesPerSample === 2) dv.setUint16(o, v, le);
            else throw new Error('unsupported synthetic sample format');
          }
        }
      }
    }
  });

  return buf;
}
