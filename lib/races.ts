import type { Party } from "./mockResults";
import { BASE_CANDIDATES, STATEWIDE_TOTAL_VOTES, BASELINE_GAP } from "./mockResults";
import {
  KV_TREND_KEY,
  LOCAL_TREND_KEY,
  KV_TREND_KEY_LA_MAYOR,
  LOCAL_TREND_KEY_LA_MAYOR,
} from "./constants";

/**
 * Race registry. Each race the dashboard can show is one config object; the data
 * layer, API routes, and client are all parameterized by `RaceId` and read
 * everything race-specific from here. Adding a race is adding one entry.
 *
 * Runtime dependency is one-directional: this module imports values from
 * mockResults; mockResults imports only the RaceConfig *type* back (erased at
 * runtime), so there is no import cycle.
 */

export type RaceId = "governor" | "la-mayor";

export interface RaceBaseCandidate {
  name: string;
  party: Party;
  basePct: number;
}

export interface RaceConfig {
  id: RaceId;
  tabLabel: string;
  title: string;
  heroLabel: string;
  regionLabel: string; // "Statewide" | "Citywide" — used in standings/party-share titles
  primaryDate: string;
  runoffDate: string;
  baselineGap: number;
  totalVotes: number;
  baseCandidates: RaceBaseCandidate[];
  kvTrendKey: string;
  localTrendKey: string;
  feedEnvVar: string;
  feedMatchTerms: string[];
  llmRaceName: string;
  llmCandidatesOfInterest: string;
  drilldownEnabled: boolean;
  verifyUrl: string;
  verifyLabel: string;
  // Mock-payload metadata so the deterministic fallback reads correctly per race.
  mockSource: string;
  mockNote: string;
  mockPctReporting: string;
  mockAsOf: string;
}

// LA City Mayor 2026 field. Real reported figures from the June 2, 2026 nonpartisan
// primary (~71% of vote counted as of June 5). Incumbent Karen Bass leads but is well
// under the 50% outright-win threshold; the second runoff slot is a Pratt-vs-Raman
// battle. The other 11 of the 14 certified candidates (~11.9% combined) are bundled
// into "Other candidates" rather than fabricating individual tail numbers. The race is
// officially nonpartisan; candidates are tagged by their registered party where known.
const LA_MAYOR_CANDIDATES: RaceBaseCandidate[] = [
  { name: "Karen Bass", party: "D", basePct: 35.0 },
  { name: "Spencer Pratt", party: "R", basePct: 28.2 },
  { name: "Nithya Raman", party: "D", basePct: 24.9 },
  { name: "Other candidates", party: "I", basePct: 11.9 },
];

export const RACES: Record<RaceId, RaceConfig> = {
  governor: {
    id: "governor",
    tabLabel: "CA Governor",
    title: "California Governor 2026 Primary Tracker",
    heroLabel: "Statewide 2nd-Place Battle",
    regionLabel: "Statewide",
    primaryDate: "June 2, 2026",
    runoffDate: "Nov 3, 2026",
    baselineGap: BASELINE_GAP,
    totalVotes: STATEWIDE_TOTAL_VOTES,
    baseCandidates: BASE_CANDIDATES,
    kvTrendKey: KV_TREND_KEY,
    localTrendKey: LOCAL_TREND_KEY,
    feedEnvVar: "RESULTS_FEED_URL",
    feedMatchTerms: ["governor", "statewide"],
    llmRaceName: 'California 2026 Governor top-two "jungle" primary (held June 2, 2026)',
    llmCandidatesOfInterest: "Xavier Becerra (D), Steve Hilton (R), and Tom Steyer (D)",
    drilldownEnabled: true,
    verifyUrl: "https://electionresults.sos.ca.gov",
    verifyLabel: "California Secretary of State",
    mockSource: "CA Secretary of State (Mock)",
    mockNote: "Semi-official results. Mail-in ballots postmarked by Election Day are still being processed.",
    mockPctReporting: "68%",
    mockAsOf: "June 5, 2026 7:10 PM PT",
  },
  "la-mayor": {
    id: "la-mayor",
    tabLabel: "LA Mayor",
    title: "Los Angeles Mayor 2026 Primary Tracker",
    heroLabel: "Citywide 2nd-Place Battle",
    regionLabel: "Citywide",
    primaryDate: "June 2, 2026",
    runoffDate: "Nov 3, 2026",
    baselineGap: 3.3,
    totalVotes: 617000,
    baseCandidates: LA_MAYOR_CANDIDATES,
    kvTrendKey: KV_TREND_KEY_LA_MAYOR,
    localTrendKey: LOCAL_TREND_KEY_LA_MAYOR,
    feedEnvVar: "RESULTS_FEED_URL_LA_MAYOR",
    feedMatchTerms: ["mayor", "los angeles"],
    llmRaceName: "Los Angeles City Mayor 2026 primary (held June 2, 2026)",
    llmCandidatesOfInterest: "Karen Bass (incumbent), Spencer Pratt, and Nithya Raman",
    drilldownEnabled: false,
    verifyUrl: "https://results.lavote.gov",
    verifyLabel: "LA County Registrar-Recorder/County Clerk",
    mockSource: "LA County RR/CC (Mock)",
    mockNote: "Semi-official citywide results. Vote-by-mail and provisional ballots are still being processed.",
    mockPctReporting: "71%",
    mockAsOf: "June 5, 2026 4:40 PM PT",
  },
};

export const RACE_IDS: RaceId[] = ["governor", "la-mayor"];
export const DEFAULT_RACE: RaceId = "governor";

export function getRace(id: string | null | undefined): RaceConfig {
  if (id && (id === "governor" || id === "la-mayor")) {
    return RACES[id];
  }
  return RACES[DEFAULT_RACE];
}
