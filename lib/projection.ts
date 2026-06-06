import { Candidate } from "./mockResults";
import {
  priorShareFor,
  LATE_BALLOT_DEM_SKEW,
  SMOOTHING_PSEUDOCOUNT,
  KALMAN_PROCESS_VARIANCE,
  REMAINING_SKEW_SD,
  Z_SAFE,
  Z_LEAN,
} from "./priors";

/**
 * Statistical / predictive helpers for the runoff (second-place) battle.
 *
 * Pure functions, importable by both the server routes and the client. The
 * "gap" everywhere is the margin (in percentage points) between the 2nd- and
 * 3rd-place candidates by standings, never a hardcoded candidate pair, so it
 * stays correct when the order changes. Candidates are assumed sorted by votes
 * descending (every data source sorts before returning).
 */

export interface RunoffGap {
  secondName: string;
  thirdName: string;
  secondPct: number;
  thirdPct: number;
  gap: number; // unrounded percentage points, non-negative by construction
}

/** The single source of truth for the runoff gap. Returns null with < 3 candidates. */
export function runoffGap(candidates: Candidate[]): RunoffGap | null {
  const second = candidates[1];
  const third = candidates[2];
  if (!second || !third) return null;
  return {
    secondName: second.name,
    thirdName: third.name,
    secondPct: second.pct,
    thirdPct: third.pct,
    gap: second.pct - third.pct,
  };
}

/** Estimated final total ballots given counted votes and the reporting fraction. */
export function estimateExpectedTotal(countedVotes: number, reportingFraction: number): number {
  return reportingFraction > 0 ? countedVotes / reportingFraction : countedVotes;
}

export interface StatewideAnalysis {
  gap: number; // points, observed 2nd - 3rd
  secondName: string;
  thirdName: string;
  se: number; // standard error of the gap, as a fraction (not points)
  ci95: number; // half-width of the 95% interval, in points
  low: number; // gap - ci95, points
  high: number; // gap + ci95, points
  z: number; // gap / SE (margin of safety)
  label: string; // "Safe" | "Lean" | "Too close to call"
  projectedGap: number; // skew-aware projected final gap, points (signed)
  reportingFraction: number;
  countedVotes: number;
  expectedTotal: number;
  remaining: number;
}

export function safetyLabel(z: number): string {
  if (z >= Z_SAFE) return "Safe";
  if (z >= Z_LEAN) return "Lean";
  return "Too close to call";
}

/**
 * Bayesian-smoothed vote share per candidate (fraction of total), keyed by name.
 * smoothed_i = (counted_i + alpha * prior_i) / (N + alpha). At low reporting the
 * prior dominates and early noise is suppressed; by mid-count the data dominates.
 * Result is renormalized to sum to 1 so it is a valid share vector.
 */
export function smoothedShares(candidates: Candidate[]): Map<string, number> {
  const countedVotes = candidates.reduce((s, c) => s + c.votes, 0);
  const alpha = SMOOTHING_PSEUDOCOUNT;

  const raw = new Map<string, number>();
  let total = 0;
  for (const c of candidates) {
    const observed = countedVotes > 0 ? c.votes / countedVotes : 0;
    const prior = priorShareFor(c.name) ?? observed; // unknown name -> no smoothing
    const smoothed = (c.votes + alpha * prior) / (countedVotes + alpha);
    raw.set(c.name, smoothed);
    total += smoothed;
  }

  const out = new Map<string, number>();
  for (const [name, v] of raw) {
    out.set(name, total > 0 ? v / total : 0);
  }
  return out;
}

/**
 * Skew-aware point projection of the final gap (signed points). Remaining ballots
 * are assumed to break by q_i = normalize(smoothedShare_i * skew_i), where the
 * Democratic late-ballot skew nudges uncounted ballots more progressive. A signed
 * result < 0 means the projection expects the 2nd/3rd order to flip.
 */
export function projectFinalGap(candidates: Candidate[], reportingFraction: number): number | null {
  const gap = runoffGap(candidates);
  if (!gap) return null;

  const second = candidates[1];
  const third = candidates[2];
  const countedVotes = candidates.reduce((s, c) => s + c.votes, 0);
  const expectedTotal = estimateExpectedTotal(countedVotes, reportingFraction);
  const remaining = Math.max(0, expectedTotal - countedVotes);

  if (remaining <= 0 || expectedTotal <= 0) {
    return gap.gap; // fully counted: projection is the observed gap
  }

  // How the remaining ballots break, from smoothed shares + Dem skew.
  const smoothed = smoothedShares(candidates);
  let qTotal = 0;
  const qWeights = new Map<string, number>();
  for (const c of candidates) {
    const skew = c.party === "D" ? LATE_BALLOT_DEM_SKEW : 1;
    const w = (smoothed.get(c.name) ?? 0) * skew;
    qWeights.set(c.name, w);
    qTotal += w;
  }

  const finalShare = (c: Candidate) => {
    const q = qTotal > 0 ? (qWeights.get(c.name) ?? 0) / qTotal : 0;
    return (c.votes + remaining * q) / expectedTotal;
  };

  return (finalShare(second) - finalShare(third)) * 100;
}

/**
 * Point-in-time analysis of the statewide runoff battle: observed gap, a 95%
 * confidence interval from the multinomial remaining-ballot model, a Z-score
 * margin of safety, and the skew-aware projected final gap. Returns null with
 * fewer than three candidates.
 */
export function analyzeStatewide(
  candidates: Candidate[],
  reportingFraction: number
): StatewideAnalysis | null {
  const gap = runoffGap(candidates);
  if (!gap) return null;

  const countedVotes = candidates.reduce((s, c) => s + c.votes, 0);
  const expectedTotal = estimateExpectedTotal(countedVotes, reportingFraction);
  const remaining = Math.max(0, expectedTotal - countedVotes);

  // Shares (fractions) of the two contenders among counted votes.
  const p2 = countedVotes > 0 ? candidates[1].votes / countedVotes : 0;
  const p3 = countedVotes > 0 ? candidates[2].votes / countedVotes : 0;

  // SE of the final gap has two independent components, both -> 0 as remaining -> 0:
  //  1. Sampling: variance of the difference of the two contenders' counts under a
  //     multinomial draw of R = remaining ballots. Tiny at statewide scale.
  //  2. Systematic: the remaining ballots' margin breaks differently than counted
  //     ones by an uncertain amount (blue shift). This dominates and, crucially,
  //     does NOT shrink with N -- it scales with the remaining share.
  let se = 0;
  if (remaining > 0 && expectedTotal > 0) {
    const varDiff = remaining * (p2 * (1 - p2) + p3 * (1 - p3) + 2 * p2 * p3);
    const seSampling = Math.sqrt(varDiff) / expectedTotal;
    const remainingShare = remaining / expectedTotal;
    const seSystematic = remainingShare * REMAINING_SKEW_SD;
    se = Math.sqrt(seSampling * seSampling + seSystematic * seSystematic);
  }

  const ci95 = 1.96 * se * 100; // points
  const gapFraction = gap.gap / 100;
  const z = se > 0 ? gapFraction / se : Infinity;
  const projectedGap = projectFinalGap(candidates, reportingFraction) ?? gap.gap;

  return {
    gap: gap.gap,
    secondName: gap.secondName,
    thirdName: gap.thirdName,
    se,
    ci95,
    low: gap.gap - ci95,
    high: gap.gap + ci95,
    z,
    label: safetyLabel(z),
    projectedGap,
    reportingFraction,
    countedVotes,
    expectedTotal,
    remaining,
  };
}

export interface KalmanState {
  x: number; // estimate of the true final gap, points
  P: number; // estimate variance
}

/**
 * One step of a 1-D Kalman filter over snapshots. The observation is the
 * skew-aware projected gap; its variance is SE(gap)^2. Low-reporting snapshots
 * have large observation variance -> small gain -> prior dominates; late snapshots
 * dominate as variance shrinks. Pass prev = null to seed from the first snapshot.
 */
export function kalmanUpdate(
  prev: KalmanState | null,
  observation: number,
  obsVar: number
): KalmanState {
  // Guard against a zero observation variance (fully counted) producing NaN gain.
  const safeObsVar = obsVar > 0 ? obsVar : 1e-9;
  if (!prev) {
    return { x: observation, P: safeObsVar };
  }
  const Ppred = prev.P + KALMAN_PROCESS_VARIANCE;
  const K = Ppred / (Ppred + safeObsVar);
  return {
    x: prev.x + K * (observation - prev.x),
    P: (1 - K) * Ppred,
  };
}
