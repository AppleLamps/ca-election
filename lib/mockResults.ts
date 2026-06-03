export type Party = "D" | "R" | "I";

export interface Candidate {
  name: string;
  party: Party;
  votes: number;
  pct: number;
}

export interface ResultsPayload {
  asOf: string;
  pctReporting: string;
  source: string;
  note: string;
  candidates: Candidate[];
}

export const BASELINE_GAP = 6.2; // Becerra (18.2) - Steyer (12.0) or whatever baseline is configured

export const COUNTY_LIST = [
  "Alameda", "Alpine", "Amador", "Butte", "Calaveras", "Colusa", "Contra Costa",
  "Del Norte", "El Dorado", "Fresno", "Glenn", "Humboldt", "Imperial", "Inyo",
  "Kern", "Kings", "Lake", "Lassen", "Los Angeles", "Madera", "Marin", "Mariposa",
  "Mendocino", "Merced", "Modoc", "Mono", "Monterey", "Napa", "Nevada", "Orange",
  "Placer", "Plumas", "Riverside", "Sacramento", "San Benito", "San Bernardino",
  "San Diego", "San Francisco", "San Joaquin", "San Luis Obispo", "San Mateo",
  "Santa Barbara", "Santa Clara", "Santa Cruz", "Shasta", "Sierra", "Siskiyou",
  "Solano", "Sonoma", "Stanislaus", "Sutter", "Tehama", "Trinity", "Tulare",
  "Tuolumne", "Ventura", "Yolo", "Yuba"
];

// Seeded random number generator for consistent mock results
function seededRandom(seedStr: string) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(31, h) + seedStr.charCodeAt(i) | 0;
  }
  return function() {
    h = Math.imul(h ^ h >>> 16, 2246822507);
    h = Math.imul(h ^ h >>> 13, 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// Base statewide results
export const BASE_CANDIDATES = [
  { name: "Steve Hilton", party: "R" as Party, basePct: 28.4 },
  { name: "Xavier Becerra", party: "D" as Party, basePct: 18.2 },
  { name: "Tom Steyer", party: "D" as Party, basePct: 17.6 },
  { name: "Eleni Kounalakis", party: "D" as Party, basePct: 12.1 },
  { name: "Rob Bonta", party: "D" as Party, basePct: 9.5 },
  { name: "Lanhee Chen", party: "R" as Party, basePct: 7.8 },
  { name: "Betty Yee", party: "D" as Party, basePct: 6.4 }
];

export const STATEWIDE_TOTAL_VOTES = 6450000;

export function getMockStatewideResults(): ResultsPayload {
  const candidates: Candidate[] = BASE_CANDIDATES.map(c => ({
    name: c.name,
    party: c.party,
    votes: Math.round((c.basePct / 100) * STATEWIDE_TOTAL_VOTES),
    pct: c.basePct
  }));

  // Adjust votes to sum exactly to STATEWIDE_TOTAL_VOTES
  const sumVotes = candidates.reduce((sum, c) => sum + c.votes, 0);
  const diff = STATEWIDE_TOTAL_VOTES - sumVotes;
  if (diff !== 0) {
    candidates[0].votes += diff;
  }

  return {
    asOf: "June 3, 2026 12:45 AM PT",
    pctReporting: "94.2%",
    source: "CA Secretary of State (Mock)",
    note: "Semi-official results. Mail-in ballots postmarked by Election Day are still being processed.",
    candidates: candidates.sort((a, b) => b.votes - a.votes)
  };
}

// Approximate voter turnout/population weights for all 58 counties
const COUNTY_PROFILES: Record<string, { votes: number; demBias: number; gopBias: number }> = {
  "Los Angeles": { votes: 1650000, demBias: 1.35, gopBias: 0.55 },
  "San Diego": { votes: 520000, demBias: 1.02, gopBias: 0.98 },
  "Orange": { votes: 480000, demBias: 0.88, gopBias: 1.15 },
  "Riverside": { votes: 340000, demBias: 0.82, gopBias: 1.22 },
  "San Bernardino": { votes: 290000, demBias: 0.86, gopBias: 1.18 },
  "Santa Clara": { votes: 310000, demBias: 1.42, gopBias: 0.48 },
  "Alameda": { votes: 280000, demBias: 1.55, gopBias: 0.35 },
  "Sacramento": { votes: 240000, demBias: 1.12, gopBias: 0.85 },
  "Contra Costa": { votes: 210000, demBias: 1.28, gopBias: 0.68 },
  "Fresno": { votes: 140000, demBias: 0.78, gopBias: 1.28 },
  "San Francisco": { votes: 180000, demBias: 1.68, gopBias: 0.22 },
  "Ventura": { votes: 130000, demBias: 1.05, gopBias: 0.95 },
  "Kern": { votes: 110000, demBias: 0.65, gopBias: 1.45 },
  "San Mateo": { votes: 140000, demBias: 1.45, gopBias: 0.45 },
  "San Joaquin": { votes: 100000, demBias: 0.92, gopBias: 1.08 },
  "Stanislaus": { votes: 80000, demBias: 0.85, gopBias: 1.15 },
  "Sonoma": { votes: 110000, demBias: 1.38, gopBias: 0.52 },
  "Solano": { votes: 75000, demBias: 1.15, gopBias: 0.82 },
  "Santa Barbara": { votes: 70000, demBias: 1.18, gopBias: 0.80 },
  "Tulare": { votes: 60000, demBias: 0.62, gopBias: 1.48 },
  "Placer": { votes: 85000, demBias: 0.78, gopBias: 1.28 },
  "Santa Cruz": { votes: 65000, demBias: 1.58, gopBias: 0.32 },
  "Marin": { votes: 70000, demBias: 1.52, gopBias: 0.38 },
  "Yolo": { votes: 45000, demBias: 1.32, gopBias: 0.62 },
  "Butte": { votes: 40000, demBias: 0.90, gopBias: 1.10 },
  "El Dorado": { votes: 45000, demBias: 0.75, gopBias: 1.30 },
  "Shasta": { votes: 35000, demBias: 0.52, gopBias: 1.62 },
  "Imperial": { votes: 25000, demBias: 1.22, gopBias: 0.72 },
  "Kings": { votes: 20000, demBias: 0.68, gopBias: 1.40 },
  "Madera": { votes: 22000, demBias: 0.72, gopBias: 1.35 },
  "Napa": { votes: 30000, demBias: 1.25, gopBias: 0.70 },
  "Humboldt": { votes: 28000, demBias: 1.30, gopBias: 0.65 },
  "Nevada": { votes: 25000, demBias: 1.10, gopBias: 0.88 },
  "Mendocino": { votes: 18000, demBias: 1.35, gopBias: 0.58 },
  "Sutter": { votes: 18000, demBias: 0.74, gopBias: 1.32 },
  "Yuba": { votes: 14000, demBias: 0.70, gopBias: 1.38 },
  "Tehama": { votes: 13000, demBias: 0.58, gopBias: 1.52 },
  "Lake": { votes: 12000, demBias: 1.08, gopBias: 0.90 },
  "San Benito": { votes: 12000, demBias: 1.05, gopBias: 0.92 },
  "Tuolumne": { votes: 13000, demBias: 0.76, gopBias: 1.28 },
  "Calaveras": { votes: 12000, demBias: 0.72, gopBias: 1.32 },
  "Amador": { votes: 11000, demBias: 0.74, gopBias: 1.30 },
  "Lassen": { votes: 7000, demBias: 0.45, gopBias: 1.75 },
  "Glenn": { votes: 6000, demBias: 0.60, gopBias: 1.50 },
  "Colusa": { votes: 4500, demBias: 0.65, gopBias: 1.42 },
  "Plumas": { votes: 5500, demBias: 0.78, gopBias: 1.25 },
  "Inyo": { votes: 4500, demBias: 0.88, gopBias: 1.12 },
  "Mariposa": { votes: 4800, demBias: 0.72, gopBias: 1.32 },
  "Mono": { votes: 3500, demBias: 1.15, gopBias: 0.82 },
  "Trinity": { votes: 3000, demBias: 0.92, gopBias: 1.05 },
  "Del Norte": { votes: 4500, demBias: 0.78, gopBias: 1.25 },
  "Modoc": { votes: 2200, demBias: 0.48, gopBias: 1.68 },
  "Sierra": { votes: 1000, demBias: 0.70, gopBias: 1.35 },
  "Alpine": { votes: 400, demBias: 1.45, gopBias: 0.50 },
  "Siskiyou": { votes: 11000, demBias: 0.82, gopBias: 1.22 },
  "San Luis Obispo": { votes: 75000, demBias: 1.08, gopBias: 0.92 },
  "Monterey": { votes: 85000, demBias: 1.28, gopBias: 0.70 },
  "Merced": { votes: 45000, demBias: 0.95, gopBias: 1.05 }
};

export function getMockCountyResults(countyName: string): ResultsPayload {
  // Normalize input name
  const matchedCounty = COUNTY_LIST.find(
    c => c.toLowerCase() === countyName.toLowerCase()
  );

  if (!matchedCounty) {
    throw new Error(`County not found: ${countyName}`);
  }

  const profile = COUNTY_PROFILES[matchedCounty] || {
    votes: 25000,
    demBias: 1.0,
    gopBias: 1.0
  };

  const rng = seededRandom(matchedCounty);

  // Calculate adjusted scores
  let rawShares = BASE_CANDIDATES.map(c => {
    const bias = c.party === "D" ? profile.demBias : c.party === "R" ? profile.gopBias : 1.0;
    // Add small random noise (-2% to +2%)
    const noise = (rng() * 4 - 2);
    const adjustedPct = Math.max(1, c.basePct * bias + noise);
    return { name: c.name, party: c.party, share: adjustedPct };
  });

  // Normalize shares to sum to 100%
  const totalShare = rawShares.reduce((sum, c) => sum + c.share, 0);
  const candidates: Candidate[] = rawShares.map(c => {
    const pct = Number(((c.share / totalShare) * 100).toFixed(1));
    return {
      name: c.name,
      party: c.party,
      votes: Math.round((pct / 100) * profile.votes),
      pct
    };
  });

  // Adjust votes to sum exactly to county total votes
  const sumVotes = candidates.reduce((sum, c) => sum + c.votes, 0);
  const diff = profile.votes - sumVotes;
  if (diff !== 0) {
    // Add discrepancy to highest vote getter
    const sorted = [...candidates].sort((a, b) => b.votes - a.votes);
    const highest = candidates.find(c => c.name === sorted[0].name);
    if (highest) {
      highest.votes += diff;
    }
  }

  // Recalculate percentages based on final votes to ensure consistency
  candidates.forEach(c => {
    c.pct = Number(((c.votes / profile.votes) * 100).toFixed(1));
  });

  // Sort candidates by votes descending
  candidates.sort((a, b) => b.votes - a.votes);

  // Determine reporting percentage (seeded)
  const reportingRng = rng();
  const pctReportingVal = 90 + Math.floor(reportingRng * 10); // 90% to 99%
  const pctReportingStr = `${pctReportingVal}.${Math.floor(rng() * 10)}%`;

  return {
    asOf: "June 3, 2026 12:45 AM PT",
    pctReporting: pctReportingStr,
    source: "CA Secretary of State (Mock)",
    note: `County results synthesized. Mail-in ballots processing in ${matchedCounty} County.`,
    candidates
  };
}
