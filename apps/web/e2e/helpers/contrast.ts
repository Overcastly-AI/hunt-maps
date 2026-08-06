import type { RGBA } from './pixels';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance, 0 (black) – 1 (white). */
export function relativeLuminance({ r, g, b }: RGB): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG contrast ratio, 1:1 (identical) – 21:1 (black on white). */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function colorDistance(a: RGB, b: RGB): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

/**
 * WCAG's "large text" carve-out: 18pt (24px) at any weight, or 14pt (~18.66px)
 * at bold (>=700). Large text gets a 3:1 minimum instead of 4.5:1.
 */
export function requiredContrastRatio(fontSizePx: number, fontWeight: number): number {
  const isBold = fontWeight >= 700;
  const isLarge = fontSizePx >= 24 || (isBold && fontSizePx >= 18.66);
  return isLarge ? 3.0 : 4.5;
}

/**
 * Estimate the background colour directly behind a piece of text from a grid
 * of real, rendered pixel samples (see `pixels.ts#samplePixels`).
 *
 * There is no DOM API that answers "what colour is behind this glyph" once
 * `backdrop-filter` and an arbitrary map are involved. This instead samples a
 * grid of points across the text element's own box and discards any sample
 * close in colour to the element's *computed* text colour — those are glyph
 * ink or its anti-aliased edge — then averages what is left.
 *
 * This is deliberately an approximation, and it has a real failure mode:
 * on a very short, very bold label that fills almost its entire box with
 * ink, every grid sample can be "close to text colour", in which case this
 * falls back to averaging all of them, which biases the estimate toward the
 * text colour itself and can under-report a real contrast problem. It does
 * not over-report one — a background estimate biased toward the foreground
 * colour only *inflates* the apparent contrast — so a failure surfaced by
 * this check is trustworthy; a pass on very bold, very dense text is the
 * case to eyeball by hand.
 */
export function estimateBackground(samples: RGBA[], textColor: RGB): RGB {
  const backgroundLike = samples.filter(
    (s) => colorDistance({ r: s.r, g: s.g, b: s.b }, textColor) > 30,
  );
  const pool = backgroundLike.length > 0 ? backgroundLike : samples;
  const sum = pool.reduce(
    (acc, s) => ({ r: acc.r + s.r, g: acc.g + s.g, b: acc.b + s.b }),
    { r: 0, g: 0, b: 0 },
  );
  return { r: sum.r / pool.length, g: sum.g / pool.length, b: sum.b / pool.length };
}

/** Parses a computed `color` string (`rgb(r, g, b)` / `rgba(r, g, b, a)`). */
export function parseCssColor(css: string): RGB {
  const match = css.match(/rgba?\(([^)]+)\)/);
  if (!match) throw new Error(`Unrecognised computed colour: "${css}"`);
  const [r, g, b] = match[1].split(',').map((part) => parseFloat(part.trim()));
  return { r, g, b };
}
