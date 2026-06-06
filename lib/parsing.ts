import { Party } from "./mockResults";

/**
 * Shared, defensive normalization helpers.
 *
 * Feed, LLM, and any future source all hand us loosely-typed values
 * (numbers, comma-formatted strings, percent-suffixed strings, missing
 * fields). Keeping the coercion here means a parsing fix applies to every
 * source at once instead of drifting between three near-identical copies.
 */

export function parseParty(raw: unknown): Party {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s.startsWith("DEM") || s === "D") return "D";
  if (s.startsWith("REP") || s.startsWith("GOP") || s === "R") return "R";
  return "I";
}

export function parseVotes(raw: unknown): number {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0;
  }
  if (typeof raw === "string") {
    const n = parseInt(raw.replace(/,/g, ""), 10);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  return 0;
}

export function parsePct(raw: unknown): number {
  let n = 0;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string") n = parseFloat(raw.replace(/%/g, ""));
  if (!Number.isFinite(n)) return 0;
  // Clamp to a sane percentage range.
  return Math.min(100, Math.max(0, n));
}

/**
 * Parse a reporting percentage (e.g. "94.2%", "94.2", 94.2) into a fraction in
 * [0, 1]. Used by the statistical layer to estimate remaining ballots; keeping it
 * here means the same coercion (%-stripping, clamping) as the other helpers.
 */
export function parseReportingFraction(raw: unknown): number {
  let n = 0;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string") n = parseFloat(raw.replace(/%/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n / 100));
}
