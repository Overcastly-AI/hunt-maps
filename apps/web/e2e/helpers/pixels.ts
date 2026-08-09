import type { Page } from '@playwright/test';

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Sample the *actual rendered* pixel colour at a set of CSS-pixel points.
 *
 * This is what makes the contrast invariant honest rather than a guess: a
 * text element's effective background in this app is frequently a
 * `backdrop-filter: blur()` glass surface floating over a live map, and the
 * DOM's computed `background-color` cannot tell you what that composites to
 * — the alpha-blended glass colour is knowable from CSS, but the map imagery
 * underneath it is not. A real screenshot has already done that compositing.
 *
 * Playwright gives us the screenshot as PNG bytes but no pixel-level read
 * API, and pulling in a Node-side PNG decoder would mean adding a dependency
 * to `package.json`, which is outside this file's territory. The browser
 * already knows how to decode a PNG, so this hands the screenshot back to
 * the page as a data URL, draws it into an offscreen `<canvas>`, and reads
 * pixels back with `getImageData` — no new dependency, no guessing.
 */
export async function samplePixels(page: Page, points: Point[]): Promise<RGBA[]> {
  if (points.length === 0) return [];
  const buffer = await page.screenshot();
  const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;

  return page.evaluate(
    async ({ dataUrl, points }: { dataUrl: string; points: Point[] }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2D canvas context unavailable while sampling pixels');
      ctx.drawImage(img, 0, 0);

      // The screenshot is rendered at `devicePixelRatio` (this project's
      // Playwright config sets `deviceScaleFactor: 2`), so a CSS-pixel
      // coordinate has to be scaled up to find the matching image pixel.
      const dpr = window.devicePixelRatio || 1;

      return points.map(({ x, y }) => {
        const px = Math.min(canvas.width - 1, Math.max(0, Math.round(x * dpr)));
        const py = Math.min(canvas.height - 1, Math.max(0, Math.round(y * dpr)));
        const [r, g, b, a] = ctx.getImageData(px, py, 1, 1).data;
        return { r, g, b, a };
      });
    },
    { dataUrl, points },
  );
}

/**
 * Fraction of pixels inside `rect` (CSS px, converted to device px via
 * `devicePixelRatio`) whose rendered colour is saturated — `max(r,g,b) -
 * min(r,g,b) > saturationThreshold`. Returns a percentage, 0..100.
 *
 * This is the direct, rendered-pixel check for "a layer painted something",
 * as opposed to "a layer's DOM checkbox is checked" or "the worker returned a
 * non-empty buffer" — both of those were true the day `BACKLOG R32` shipped a
 * bedding layer that covered 0.00% of the canvas, because every value in its
 * output landed in the near-transparent bottom slice of an absolute `[0, 1]`
 * ramp. A greyscale hillshade or a neutral basemap patch has `max == min`
 * (or very close to it) at every pixel, so this threshold does not fire on
 * imagery or relief alone — it fires only where a colour ramp actually
 * painted a hue, which is what "the layer is visible" means to a hunter
 * looking at the screen.
 */
export async function canvasSaturationCoverage(
  page: Page,
  rect: { x: number; y: number; width: number; height: number },
  saturationThreshold = 25,
): Promise<number> {
  const buffer = await page.screenshot();
  const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;

  return page.evaluate(
    async ({
      dataUrl,
      rect,
      saturationThreshold,
    }: {
      dataUrl: string;
      rect: { x: number; y: number; width: number; height: number };
      saturationThreshold: number;
    }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2D canvas context unavailable while measuring saturation coverage');
      ctx.drawImage(img, 0, 0);

      const dpr = window.devicePixelRatio || 1;
      const x0 = Math.max(0, Math.round(rect.x * dpr));
      const y0 = Math.max(0, Math.round(rect.y * dpr));
      const w = Math.max(0, Math.min(canvas.width - x0, Math.round(rect.width * dpr)));
      const h = Math.max(0, Math.min(canvas.height - y0, Math.round(rect.height * dpr)));
      if (w === 0 || h === 0) return 0;

      const { data } = ctx.getImageData(x0, y0, w, h);
      let saturated = 0;
      const total = w * h;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max - min > saturationThreshold) saturated++;
      }
      return (saturated / total) * 100;
    },
    { dataUrl, rect, saturationThreshold },
  );
}

/**
 * Points on an evenly spaced grid across a rect, in CSS pixels.
 *
 * Used to sample many points inside a text element's own box rather than one
 * — see `estimateBackground` in `contrast.ts` for why a single point is not
 * reliable near glyph ink.
 */
export function gridPoints(
  rect: { x: number; y: number; width: number; height: number },
  cols = 5,
  rows = 4,
): Point[] {
  const points: Point[] = [];
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      points.push({
        x: rect.x + (rect.width * (col + 0.5)) / cols,
        y: rect.y + (rect.height * (row + 0.5)) / rows,
      });
    }
  }
  return points;
}
