/**
 * Colour ramps and raster compositing.
 *
 * ## Palette rationale
 *
 * These ramps are read in the woods, at dawn, on a phone at low brightness, by
 * people who may be red-green colourblind (≈8% of men — and this is a
 * male-skewed user base, so the real exposure is high). Constraints applied
 * throughout:
 *
 *  - **No red↔green semantic pairs.** Slope bands run cool→warm through a
 *    luminance ramp, so they stay ordered in greyscale.
 *  - **Categorical layers are luminance-separated**, not just hue-separated.
 *  - **Overlays stay translucent** — the imagery underneath is evidence, and a
 *    layer that hides it makes the map worse, not better.
 */

export type Rgba = [number, number, number, number];

export interface RampStop {
  value: number;
  color: Rgba;
}

/** Piecewise-linear interpolation through ramp stops. */
export function sampleRamp(stops: RampStop[], value: number): Rgba {
  if (!Number.isFinite(value)) return [0, 0, 0, 0];
  if (value <= stops[0].value) return [...stops[0].color] as Rgba;
  const last = stops[stops.length - 1];
  if (value >= last.value) return [...last.color] as Rgba;

  for (let i = 1; i < stops.length; i++) {
    const b = stops[i];
    if (value > b.value) continue;
    const a = stops[i - 1];
    const t = (value - a.value) / (b.value - a.value || 1);
    return [
      Math.round(a.color[0] + (b.color[0] - a.color[0]) * t),
      Math.round(a.color[1] + (b.color[1] - a.color[1]) * t),
      Math.round(a.color[2] + (b.color[2] - a.color[2]) * t),
      Math.round(a.color[3] + (b.color[3] - a.color[3]) * t),
    ];
  }
  return [...last.color] as Rgba;
}

/**
 * Slope-angle ramp, degrees.
 *
 * Break points are hunting-meaningful rather than evenly spaced:
 *   0–8    walkable flat / field / bench
 *   8–20   the sidehill contour band deer travel
 *   20–30  bedding grade
 *   30–45  steep — security cover, thermal-driven
 *   45+    effectively a wall; travel routes cannot cross it
 */
export const SLOPE_RAMP: RampStop[] = [
  { value: 0, color: [58, 84, 110, 0] },
  { value: 8, color: [72, 140, 176, 140] },
  { value: 20, color: [96, 186, 154, 170] },
  { value: 30, color: [226, 190, 90, 190] },
  { value: 45, color: [216, 118, 66, 210] },
  { value: 70, color: [156, 48, 62, 235] },
];

/**
 * Aspect ramp — cyclic, so it must start and end on the same colour or north
 * shows a hard seam. Warm hues sit on the southern half, which reads
 * intuitively as "the sunny side".
 */
export const ASPECT_RAMP: RampStop[] = [
  { value: 0, color: [90, 122, 190, 180] },
  { value: 90, color: [96, 186, 154, 180] },
  { value: 180, color: [232, 172, 74, 180] },
  { value: 270, color: [196, 106, 148, 180] },
  { value: 360, color: [90, 122, 190, 180] },
];

/** Insolation / sun-exposure ramp, 0..1. */
export const SUN_RAMP: RampStop[] = [
  { value: 0, color: [40, 52, 78, 190] },
  { value: 0.35, color: [92, 106, 140, 130] },
  { value: 0.6, color: [206, 178, 108, 150] },
  { value: 1, color: [255, 226, 138, 205] },
];

/** Bedding / corridor strength ramp, 0..1. Transparent at the low end. */
export const HEAT_RAMP: RampStop[] = [
  { value: 0, color: [0, 0, 0, 0] },
  { value: 0.25, color: [70, 108, 150, 60] },
  { value: 0.5, color: [116, 176, 138, 130] },
  { value: 0.75, color: [232, 176, 76, 185] },
  { value: 1, color: [226, 96, 72, 225] },
];

/** Weiss landform palette, indexed by class id. Luminance-separated. */
export const WEISS_COLORS: Rgba[] = [
  [0, 0, 0, 0], // 0 unknown
  [38, 54, 92, 200], // 1 canyon
  [64, 128, 176, 200], // 2 midslope drainage
  [104, 168, 196, 200], // 3 upland drainage
  [96, 132, 128, 190], // 4 U-shaped valley
  [176, 184, 168, 150], // 5 plain
  [140, 150, 140, 130], // 6 open slope
  [206, 190, 146, 180], // 7 upper slope
  [226, 158, 84, 205], // 8 local ridge in valley
  [232, 128, 72, 210], // 9 midslope ridge
  [212, 84, 76, 215], // 10 mountain top
];

/** Wood morphometric palette. Saddles are the loudest colour on purpose. */
export const WOOD_COLORS: Rgba[] = [
  [0, 0, 0, 0], // planar — invisible, it is the background case
  [46, 66, 108, 190], // pit
  [76, 156, 196, 200], // channel
  [64, 214, 226, 235], // pass / SADDLE
  [232, 150, 78, 205], // ridge
  [226, 96, 84, 215], // peak
];

/** Parse `#rgb` / `#rrggbb` into an RGB triple. */
export function parseHexColor(hex: string): [number, number, number] {
  const h = hex.replace('#', '').trim();
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}

/** Render a scalar field through a ramp into an RGBA buffer. */
export function renderRamp(
  field: Float32Array,
  stops: RampStop[],
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  const buf = out ?? new Uint8ClampedArray(field.length * 4);
  for (let i = 0; i < field.length; i++) {
    const [r, g, b, a] = sampleRamp(stops, field[i]);
    const o = i * 4;
    buf[o] = r;
    buf[o + 1] = g;
    buf[o + 2] = b;
    buf[o + 3] = a;
  }
  return buf;
}

/** Render a categorical field through a palette. */
export function renderCategorical(
  field: Uint8Array,
  palette: Rgba[],
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  const buf = out ?? new Uint8ClampedArray(field.length * 4);
  for (let i = 0; i < field.length; i++) {
    const c = palette[field[i]] ?? [0, 0, 0, 0];
    const o = i * 4;
    buf[o] = c[0];
    buf[o + 1] = c[1];
    buf[o + 2] = c[2];
    buf[o + 3] = c[3];
  }
  return buf;
}

/** Render greyscale hillshade (0..1) into RGBA. */
export function renderHillshade(
  shade: Float32Array,
  opacity = 1,
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  const buf = out ?? new Uint8ClampedArray(shade.length * 4);
  for (let i = 0; i < shade.length; i++) {
    const v = Number.isFinite(shade[i]) ? Math.round(shade[i] * 255) : 0;
    const o = i * 4;
    buf[o] = v;
    buf[o + 1] = v;
    buf[o + 2] = v;
    buf[o + 3] = Math.round(255 * opacity);
  }
  return buf;
}

/**
 * Render a filter mask as a flat translucent fill, optionally outlined.
 *
 * The outline is what makes saved filters usable when several are stacked: a
 * hunter running "benches" over "leeward" over "saddles" needs to see the
 * boundaries, not three washes of colour averaging into mud.
 */
export function renderMask(
  mask: Uint8Array,
  width: number,
  height: number,
  hexColor: string,
  opacity: number,
  outline = false,
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  const buf = out ?? new Uint8ClampedArray(mask.length * 4);
  const [r, g, b] = parseHexColor(hexColor);
  const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255);

  for (let i = 0; i < mask.length; i++) {
    const o = i * 4;
    if (!mask[i]) {
      buf[o + 3] = 0;
      continue;
    }
    buf[o] = r;
    buf[o + 1] = g;
    buf[o + 2] = b;
    buf[o + 3] = alpha;
  }

  if (outline) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!mask[i]) continue;
        const edge =
          (x === 0 || !mask[i - 1]) ||
          (x === width - 1 || !mask[i + 1]) ||
          (y === 0 || !mask[i - width]) ||
          (y === height - 1 || !mask[i + width]);
        if (edge) {
          const o = i * 4;
          // Brighten toward white rather than switching hue, so the outline
          // reads as "same layer, its edge" instead of a separate feature.
          buf[o] = Math.min(255, r + 70);
          buf[o + 1] = Math.min(255, g + 70);
          buf[o + 2] = Math.min(255, b + 70);
          buf[o + 3] = 255;
        }
      }
    }
  }

  return buf;
}

/** Source-over alpha composite of `src` onto `dst`, both premultiplied-free RGBA. */
export function compositeOver(dst: Uint8ClampedArray, src: Uint8ClampedArray): Uint8ClampedArray {
  for (let o = 0; o < dst.length; o += 4) {
    const sa = src[o + 3] / 255;
    if (sa === 0) continue;
    const da = dst[o + 3] / 255;
    const outA = sa + da * (1 - sa);
    if (outA === 0) {
      dst[o + 3] = 0;
      continue;
    }
    for (let k = 0; k < 3; k++) {
      dst[o + k] = Math.round((src[o + k] * sa + dst[o + k] * da * (1 - sa)) / outA);
    }
    dst[o + 3] = Math.round(outA * 255);
  }
  return dst;
}
