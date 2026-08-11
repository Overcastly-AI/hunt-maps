/**
 * Rendered-state measurements for terrain layers (BACKLOG R76).
 *
 * `CLAUDE.md`'s fourth non-negotiable: assert against rendered state, not DOM
 * state. For terrain that bar is higher than "a canvas exists" or even "some
 * colour landed" — the P0 in `454c8f2` shipped a map whose canvas existed, whose
 * layer checkboxes were checked, whose worker ran, and which painted **no
 * elevation at all** because the DEM template was empty. Nothing in the DOM
 * differed between that build and a healthy one.
 *
 * So these functions measure the two properties only real elevation produces:
 *
 *  - **Differential.** Turning a terrain layer off and on again must change a
 *    large fraction of the map's pixels. With no DEM the layer paints nothing,
 *    so toggling it changes nothing, and the fraction collapses to ~0 —
 *    regardless of what the basemap underneath happens to be doing. That
 *    independence is the point: a satellite basemap is full of structure and
 *    colour, so any absolute "is the map interesting?" metric can pass while
 *    every terrain layer is blank.
 *  - **Structure.** The change must vary across the frame. A uniform tint over
 *    the whole viewport would satisfy a naive differential; real relief and real
 *    slope classes do not — they follow ridges and draws, so the per-cell delta
 *    has a wide spread and the colour ramp lands in several distinct hues.
 *
 * Everything heavy runs inside the page (the browser already decodes PNGs, so
 * no Node-side image dependency is added) and only small summaries cross back.
 */

import type { Page } from '@playwright/test';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TerrainFrame {
  /** Downsampled mean luminance per cell, row-major, 0..255. */
  cells: number[];
  cols: number;
  rows: number;
  /** Percent of pixels with `max(r,g,b) - min(r,g,b)` over the threshold. */
  saturatedPct: number;
  /** Saturated-pixel counts in 12 hue buckets of 30 degrees. */
  hueBuckets: number[];
  /** Total pixels measured, for turning bucket counts into percentages. */
  pixels: number;
}

/**
 * Capture one measurable frame of the map area.
 *
 * `cellPx` is in *device* pixels: 16 keeps a 1440x900 desktop frame at
 * 180x112 cells, which is fine detail for a structure check and small enough to
 * ship back as JSON.
 */
export async function captureTerrainFrame(
  page: Page,
  rect: Rect,
  { cellPx = 16, saturationThreshold = 25 }: { cellPx?: number; saturationThreshold?: number } = {},
): Promise<TerrainFrame> {
  const buffer = await page.screenshot();
  const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;

  return page.evaluate(
    async ({
      dataUrl,
      rect,
      cellPx,
      saturationThreshold,
    }: {
      dataUrl: string;
      rect: Rect;
      cellPx: number;
      saturationThreshold: number;
    }): Promise<TerrainFrame> => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2D canvas context unavailable while measuring terrain pixels');
      ctx.drawImage(img, 0, 0);

      const dpr = window.devicePixelRatio || 1;
      const x0 = Math.max(0, Math.round(rect.x * dpr));
      const y0 = Math.max(0, Math.round(rect.y * dpr));
      const w = Math.max(1, Math.min(canvas.width - x0, Math.round(rect.width * dpr)));
      const h = Math.max(1, Math.min(canvas.height - y0, Math.round(rect.height * dpr)));
      const { data } = ctx.getImageData(x0, y0, w, h);

      const cols = Math.max(1, Math.floor(w / cellPx));
      const rows = Math.max(1, Math.floor(h / cellPx));
      const sums = new Float64Array(cols * rows);
      const counts = new Uint32Array(cols * rows);
      const hueBuckets = new Array<number>(12).fill(0);
      let saturated = 0;

      for (let py = 0; py < h; py++) {
        const cellRow = Math.min(rows - 1, Math.floor((py / h) * rows));
        for (let px = 0; px < w; px++) {
          const i = (py * w + px) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          // Rec. 601 luma — the same weighting a human eye applies, so a
          // "did this change visibly?" threshold means what it says.
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const cell = cellRow * cols + Math.min(cols - 1, Math.floor((px / w) * cols));
          sums[cell] += lum;
          counts[cell]++;

          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          if (max - min > saturationThreshold) {
            saturated++;
            const d = max - min;
            let hue: number;
            if (max === r) hue = ((g - b) / d) * 60;
            else if (max === g) hue = ((b - r) / d) * 60 + 120;
            else hue = ((r - g) / d) * 60 + 240;
            if (hue < 0) hue += 360;
            hueBuckets[Math.min(11, Math.floor(hue / 30))]++;
          }
        }
      }

      const cells: number[] = [];
      for (let i = 0; i < sums.length; i++) cells.push(counts[i] ? sums[i] / counts[i] : 0);

      return {
        cells,
        cols,
        rows,
        saturatedPct: (saturated / (w * h)) * 100,
        hueBuckets,
        pixels: w * h,
      };
    },
    { dataUrl, rect, cellPx, saturationThreshold },
  );
}

export interface FrameDelta {
  /** Percent of cells whose mean luminance moved by more than `minDelta`. */
  changedPct: number;
  /** Mean absolute per-cell luminance change. */
  meanAbs: number;
  /**
   * Spread of the per-cell change. A uniform wash over the whole map has a
   * near-zero spread; shading that follows ridges and draws does not.
   */
  stdev: number;
}

/** Compare two frames of the same rect, cell for cell. */
export function frameDelta(a: TerrainFrame, b: TerrainFrame, minDelta = 6): FrameDelta {
  if (a.cols !== b.cols || a.rows !== b.rows) {
    throw new Error(
      `Frames are different shapes (${a.cols}x${a.rows} vs ${b.cols}x${b.rows}) — ` +
        'the viewport or the measured rect moved between captures, so any delta would be noise.',
    );
  }
  const deltas = a.cells.map((v, i) => Math.abs(v - b.cells[i]));
  const changed = deltas.filter((d) => d > minDelta).length;
  const meanAbs = deltas.reduce((s, d) => s + d, 0) / deltas.length;
  const variance = deltas.reduce((s, d) => s + (d - meanAbs) ** 2, 0) / deltas.length;
  return {
    changedPct: (changed / deltas.length) * 100,
    meanAbs,
    stdev: Math.sqrt(variance),
  };
}

/**
 * How many hue bands the frame paints over at least `minPct` of the map.
 *
 * A colour ramp driven by real terrain lands in several bands because the
 * ground genuinely has flats, sidehills and steep faces in one view. A single
 * flat fill — or a ramp collapsed onto one end of its domain, which is exactly
 * how `R32` shipped an invisible bedding layer — lands in one.
 */
export function distinctHueBands(frame: TerrainFrame, minPct = 1): number {
  return frame.hueBuckets.filter((count) => (count / frame.pixels) * 100 >= minPct).length;
}
