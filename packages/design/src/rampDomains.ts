/**
 * Data domains for continuous analysis ramps.
 *
 * `HEAT_RAMP` and friends (`packages/terrain/src/render/ramps.ts`) map an
 * absolute `[0, 1]` input onto colour. Most composites that feed a ramp do
 * not use that whole range on real terrain. `beddingLikelihood` in
 * particular multiplies five independent, mostly-imperfect terms together —
 * aspect, pad, ring, shelter, cover (`packages/terrain/src/analysis/wind.ts`)
 * — so a bench that is a *good* bed, not a geometrically perfect one, scores
 * well below 1.0 even though every individual term is doing exactly its job.
 *
 * Feeding that field straight into a ramp built for `[0, 1]` paints the whole
 * layer into the bottom slice of the ramp and reads as no colour at all. On a
 * representative ridge-and-draw DEM (Hocking Hills, OH — the app's default
 * view; see `apps/web/e2e/screenshots.spec.ts`) the observed distribution of
 * `beddingLikelihood` was:
 *
 *   min 0.0000  max 0.1386  mean 0.0464  p50 0.0486  p90 0.0894  p99 0.1217
 *
 * i.e. 0.00% of the canvas carried visible saturation (BACKLOG `R32`).
 *
 * ## Why a fixed domain, not a per-tile percentile stretch
 *
 * A per-tile stretch (rescale each tile to its own local min/max) would use
 * the ramp evenly everywhere, but at the cost of the one property that makes
 * a colour mean anything on a map: the same underlying value would render a
 * different colour depending on which tile happened to contain it, and two
 * adjacent tiles with different local ranges would show a visible seam at
 * their shared edge. `packages/terrain` already rejects exactly this move
 * for the *insolation* input to this same layer, for the same reason (see
 * the doc comment on `BeddingSeasonOptions.insolation`) — this keeps that
 * constraint on the way out of the model as well as on the way in.
 *
 * ## Why 0.15, not the raw observed max (0.1386)
 *
 * The observed max is one sample run over one DEM. A domain pinned to that
 * exact figure would saturate on the first hillside that scores slightly
 * hotter and read as a regression. Rounding up to a clean number with real
 * headroom means terrain that scores a little higher elsewhere (steeper
 * ridgelines, tighter re-entrants) clips to full saturation at the top of
 * the ramp — a graceful ceiling — rather than silently exceeding the domain
 * assumption again. The model's ranking is unchanged by this constant; it
 * only rescales which colour a given rank is painted, which is a rendering
 * decision, not a claim about the model's precision.
 */
export const BEDDING_RAMP_DOMAIN_MAX = 0.15;

/**
 * Linearly rescale `value` from `[0, domainMax]` onto `[0, 1]`, clamping at
 * both ends. Non-finite values (voids — no DEM data under the cell) pass
 * through unchanged so a downstream ramp can keep rendering them as fully
 * transparent instead of black.
 */
export function stretchToUnit(value: number, domainMax: number): number {
  if (!Number.isFinite(value)) return value;
  if (domainMax <= 0) return 0;
  const t = value / domainMax;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
