/**
 * Hand-calibrated priors for the statistical / predictive layer.
 *
 * These are approximations of historical California top-two ("jungle") primary
 * behavior, entered by hand from public results rather than fit on a dataset
 * (there is no historical dataset in this repo). They are isolated here so they
 * can be replaced with model-derived values later without touching the math in
 * `projection.ts`.
 */

/**
 * Election-night expected statewide vote share per candidate, as a fraction of
 * the total (sums to ~1.0). Used as the Bayesian smoothing prior so that at very
 * low reporting the prior dominates and early noise is suppressed. Mirrors the
 * baseline standings in `BASE_CANDIDATES` (mockResults.ts). Candidates absent
 * from this map (e.g. a live feed with different names) fall back to their own
 * observed share, making smoothing a no-op for them.
 */
export const PRIOR_SHARES_BY_NAME: Record<string, number> = {
  // CA Governor 2026 (real reported shares as of the June 5 count)
  "Xavier Becerra": 0.268,
  "Steve Hilton": 0.264,
  "Tom Steyer": 0.210,
  "Chad Bianco": 0.108,
  "Katie Porter": 0.045,
  "Matt Mahan": 0.038,
  "Antonio Villaraigosa": 0.012,
  "Tony K. Thurmond": 0.007,
  "Betty T. Yee": 0.005,
  // LA City Mayor 2026 (name sets are disjoint, so a single merged map is safe)
  "Karen Bass": 0.350,
  "Spencer Pratt": 0.282,
  "Nithya Raman": 0.249,
};

export function priorShareFor(name: string): number | null {
  return Object.prototype.hasOwnProperty.call(PRIOR_SHARES_BY_NAME, name)
    ? PRIOR_SHARES_BY_NAME[name]
    : null;
}

/**
 * Multiplier (>1) applied to Democratic candidates' share among the *remaining*
 * (uncounted) ballots. Captures California's documented "blue shift": late-counted
 * mail and provisional ballots skew younger and more progressive, the same effect
 * the dashboard footer already calls out. 1.12 = remaining ballots break ~12%
 * more Democratic than the counted ballots before renormalization.
 */
export const LATE_BALLOT_DEM_SKEW = 1.12;

/**
 * Standard deviation (as a vote-share fraction) of how the *margin* between the
 * two contenders breaks among the remaining, uncounted ballots. This is the
 * systematic (non-sampling) uncertainty: with statewide ballots in the millions,
 * multinomial sampling error is negligible, so the real uncertainty in a
 * partly-counted race is that late ballots break differently than counted ones
 * (the documented blue shift, whose magnitude varies year to year). 0.03 = the
 * remaining-ballot margin is uncertain to ~3 share points (1 SD). Unlike sampling
 * error this does NOT shrink with N; it shrinks only as the remaining share -> 0.
 */
export const REMAINING_SKEW_SD = 0.03;

/**
 * Smoothing pseudo-count, in vote-equivalents. The prior carries the weight of
 * this many votes. At ~6.45M statewide total, 75k means the prior dominates below
 * ~1% reporting and fades to negligible by mid-count.
 */
export const SMOOTHING_PSEUDOCOUNT = 75000;

/**
 * Kalman process variance, in (percentage-point)^2 per snapshot step. Small: the
 * true final gap is assumed nearly constant between 5-minute snapshots, so the
 * filter trusts its accumulated state and lets observation variance (which shrinks
 * as reporting rises) drive how fast it converges.
 */
export const KALMAN_PROCESS_VARIANCE = 0.02;

/** Z-score thresholds for the margin-of-safety label. */
export const Z_SAFE = 3;
export const Z_LEAN = 1.5;
