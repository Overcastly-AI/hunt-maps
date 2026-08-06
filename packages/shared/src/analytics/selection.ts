/**
 * Habitat-selection analytics.
 *
 * ## The mistake this module exists to prevent
 *
 * Every hunting app that ships "analytics" shows you a bar chart of sightings by
 * slope band, and every one of those charts is misleading. If 70% of your
 * property is gentle open slope, then 70% of your sightings will be on gentle
 * open slope, and the chart will confidently tell you deer love gentle open
 * slope. It has measured your property, not your deer.
 *
 * The fix is standard wildlife-ecology practice and it is not hard: compare
 * **use** against **availability**. The selection ratio
 *
 *     w = (share of observations in bin) / (share of area in bin)
 *
 * is Manly's selection ratio (a "type II design" in the resource-selection
 * literature). w > 1 means genuine preference; w < 1 means avoidance; w ≈ 1
 * means the bin is just common. A chi-square goodness-of-fit test against the
 * availability distribution says whether the pattern is worth believing at all
 * given the sample size — which, for a hunter with 40 observations, is the
 * question that actually matters.
 *
 * Sample sizes here are small and hunters will over-read them, so this module
 * is deliberately conservative: it reports confidence intervals, refuses to call
 * significance below a minimum expected count, and says so out loud.
 */

import type { HistogramBin, SelectionAnalysisDto } from '../domain.js';

export interface BinDefinition {
  label: string;
  from: number;
  to: number;
}

/** Standard slope bands, matched to the map legend so the chart and map agree. */
export const SLOPE_BANDS: BinDefinition[] = [
  { label: 'Flat 0–8°', from: 0, to: 8 },
  { label: 'Sidehill 8–20°', from: 8, to: 20 },
  { label: 'Bedding 20–30°', from: 20, to: 30 },
  { label: 'Steep 30–45°', from: 30, to: 45 },
  { label: 'Very steep 45°+', from: 45, to: 91 },
];

export const ASPECT_OCTANTS: BinDefinition[] = [
  { label: 'N', from: 337.5, to: 22.5 },
  { label: 'NE', from: 22.5, to: 67.5 },
  { label: 'E', from: 67.5, to: 112.5 },
  { label: 'SE', from: 112.5, to: 157.5 },
  { label: 'S', from: 157.5, to: 202.5 },
  { label: 'SW', from: 202.5, to: 247.5 },
  { label: 'W', from: 247.5, to: 292.5 },
  { label: 'NW', from: 292.5, to: 337.5 },
];

/** Assign a value to a bin index, handling the wrap-around aspect case. */
export function binIndex(bins: BinDefinition[], value: number): number {
  for (let i = 0; i < bins.length; i++) {
    const b = bins[i];
    if (b.from > b.to) {
      // Wrapping bin (e.g. north = 337.5°..22.5°).
      if (value >= b.from || value < b.to) return i;
    } else if (value >= b.from && value < b.to) {
      return i;
    }
  }
  return -1;
}

export interface SelectionInput {
  metric: string;
  bins: BinDefinition[];
  /** Metric value at each observation. */
  usedValues: number[];
  /**
   * Availability: either metric values sampled across the property (e.g. a grid
   * sample of the terrain raster) or a pre-computed area share per bin.
   */
  availableValues?: number[];
  availableShares?: number[];
  /**
   * Minimum expected count per bin for chi-square to be trustworthy. The
   * conventional floor is 5; below it the test statistic is unreliable and we
   * decline to report significance rather than reporting a bad p-value.
   */
  minExpected?: number;
}

export function analyzeSelection(input: SelectionInput): SelectionAnalysisDto {
  const { bins, usedValues } = input;
  const k = bins.length;
  const minExpected = input.minExpected ?? 5;

  const usedCounts = new Array<number>(k).fill(0);
  let usedTotal = 0;
  for (const v of usedValues) {
    if (!Number.isFinite(v)) continue;
    const i = binIndex(bins, v);
    if (i >= 0) {
      usedCounts[i]++;
      usedTotal++;
    }
  }

  let shares: number[];
  if (input.availableShares) {
    const sum = input.availableShares.reduce((a, b) => a + b, 0) || 1;
    shares = input.availableShares.map((s) => s / sum);
  } else if (input.availableValues) {
    const counts = new Array<number>(k).fill(0);
    let total = 0;
    for (const v of input.availableValues) {
      if (!Number.isFinite(v)) continue;
      const i = binIndex(bins, v);
      if (i >= 0) {
        counts[i]++;
        total++;
      }
    }
    shares = counts.map((c) => (total > 0 ? c / total : 0));
  } else {
    // No availability data: fall back to uniform, and the selection ratio
    // degenerates to a plain histogram. Callers should avoid this path.
    shares = new Array<number>(k).fill(1 / k);
  }

  const outBins: HistogramBin[] = bins.map((b, i) => {
    const areaShare = shares[i];
    const usedShare = usedTotal > 0 ? usedCounts[i] / usedTotal : 0;
    return {
      label: b.label,
      from: b.from,
      to: b.to,
      count: usedCounts[i],
      areaShare,
      // A bin with no area available cannot be "selected"; leave it undefined
      // rather than dividing by zero and reporting Infinity preference.
      selectionRatio: areaShare > 0 ? usedShare / areaShare : undefined,
    };
  });

  // Chi-square goodness of fit against the availability distribution.
  let chiSquare = 0;
  let usableBins = 0;
  let allExpectedOk = true;
  for (let i = 0; i < k; i++) {
    const expected = shares[i] * usedTotal;
    if (expected <= 0) continue;
    usableBins++;
    if (expected < minExpected) allExpectedOk = false;
    chiSquare += ((usedCounts[i] - expected) ** 2) / expected;
  }
  const df = Math.max(0, usableBins - 1);

  return {
    metric: input.metric,
    bins: outBins,
    sampleSize: usedTotal,
    chiSquare: df > 0 ? chiSquare : undefined,
    degreesOfFreedom: df > 0 ? df : undefined,
    significant:
      df > 0 && allExpectedOk ? chiSquare > chiSquareCritical95(df) : undefined,
  };
}

/**
 * Upper-tail 95% critical values of the chi-square distribution.
 *
 * Tabulated rather than computed: we only ever need α = 0.05 for df 1–30, and a
 * lookup avoids pulling a stats dependency into a package that ships to a
 * service worker. Beyond df = 30, the Wilson–Hilferty approximation is accurate
 * to well within the precision anyone should read off a 40-sighting dataset.
 */
export function chiSquareCritical95(df: number): number {
  const table = [
    0, 3.841, 5.991, 7.815, 9.488, 11.07, 12.592, 14.067, 15.507, 16.919, 18.307, 19.675,
    21.026, 22.362, 23.685, 24.996, 26.296, 27.587, 28.869, 30.144, 31.41, 32.671, 33.924,
    35.172, 36.415, 37.652, 38.885, 40.113, 41.337, 42.557, 43.773,
  ];
  if (df <= 0) return Infinity;
  if (df < table.length) return table[df];
  const z = 1.6449; // one-sided 95%
  return df * Math.pow(1 - 2 / (9 * df) + z * Math.sqrt(2 / (9 * df)), 3);
}

/**
 * Confidence interval on a selection ratio, via the log-ratio normal
 * approximation.
 *
 * Reported because the point estimate alone is dangerously persuasive. A bin
 * with three observations can easily show w = 2.4 ("deer strongly prefer this!")
 * with an interval spanning 0.7 to 8.0 — i.e. no evidence of anything. Showing
 * the interval is the difference between analytics and a horoscope.
 */
export function selectionRatioInterval(
  usedCount: number,
  usedTotal: number,
  areaShare: number,
  z = 1.96,
): { lower: number; upper: number } | undefined {
  if (usedCount === 0 || usedTotal === 0 || areaShare <= 0) return undefined;
  const w = usedCount / usedTotal / areaShare;
  // Var(log w) ≈ (1 - p) / (n * p) where p is the used proportion.
  const p = usedCount / usedTotal;
  const varLog = (1 - p) / (usedTotal * p);
  const se = Math.sqrt(varLog);
  return { lower: w * Math.exp(-z * se), upper: w * Math.exp(z * se) };
}

/**
 * Plain-language read of a selection result.
 *
 * Deliberately refuses to overclaim: a hunter reading "deer prefer benches" acts
 * on it, so the wording tracks the evidence rather than the point estimate.
 */
export function describeSelection(analysis: SelectionAnalysisDto): string {
  if (analysis.sampleSize < 10) {
    return `Only ${analysis.sampleSize} observations — too few to read a pattern from. Keep logging.`;
  }
  if (analysis.significant === false || analysis.significant === undefined) {
    return `No clear pattern beyond what the terrain mix alone would produce (n=${analysis.sampleSize}).`;
  }
  const ranked = analysis.bins
    .filter((b) => b.selectionRatio !== undefined && b.count > 0)
    .sort((a, b) => (b.selectionRatio ?? 0) - (a.selectionRatio ?? 0));
  if (ranked.length === 0) return 'Not enough binned observations to compare.';

  const top = ranked[0];
  const bottom = ranked[ranked.length - 1];
  const times = (top.selectionRatio ?? 1).toFixed(1);
  return (
    `${top.label} is used ${times}× more than its share of the ground would predict ` +
    `(${top.count} of ${analysis.sampleSize} observations). ${bottom.label} is the least used.`
  );
}

/**
 * Bucket observations by minutes from a solar reference.
 *
 * Clock time is the wrong axis for deer movement — 07:00 is well after sunrise
 * in December and well before it in September, and binning by clock smears the
 * dawn peak across two hours. Everything here is relative to sunrise/sunset.
 */
export function bucketRelativeToSolar(
  observationTimes: Date[],
  solarTimes: Array<Date | null>,
  bucketMinutes = 30,
  spanMinutes = 240,
): Array<{ minutesFromSunrise: number; count: number }> {
  const buckets = new Map<number, number>();
  const half = Math.floor(spanMinutes / bucketMinutes);
  for (let b = -half; b <= half; b++) buckets.set(b * bucketMinutes, 0);

  for (let i = 0; i < observationTimes.length; i++) {
    const ref = solarTimes[i];
    if (!ref) continue;
    const delta = (observationTimes[i].getTime() - ref.getTime()) / 60000;
    if (Math.abs(delta) > spanMinutes) continue;
    const key = Math.round(delta / bucketMinutes) * bucketMinutes;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([minutesFromSunrise, count]) => ({ minutesFromSunrise, count }));
}

/**
 * Classify a 3-hour pressure trend into the bands the literature actually
 * distinguishes. Thresholds in hPa; 1 hPa ≈ 0.03 inHg.
 */
export function pressureTrendLabel(trend3h: number | undefined): string {
  if (trend3h === undefined || !Number.isFinite(trend3h)) return 'unknown';
  if (trend3h <= -3) return 'falling fast';
  if (trend3h <= -1) return 'falling';
  if (trend3h < 1) return 'steady';
  if (trend3h < 3) return 'rising';
  return 'rising fast';
}

/**
 * Sightings per sit — the only honest activity metric.
 *
 * Raw sighting counts measure how often the hunter went out, not how active the
 * deer were. Six sightings across twelve sits on a falling barometer is a weaker
 * signal than four across four on a rising one, and only the normalised figure
 * shows that. This is why logging a blank sit matters and why the app asks for
 * it.
 */
export function sightingsPerSit(sightings: number, sits: number): number | undefined {
  return sits > 0 ? sightings / sits : undefined;
}
