import { ResultsPayload, Candidate } from "../mockResults";
import { parseParty, parseVotes, parsePct } from "../parsing";
import { MAX_CANDIDATES } from "../constants";

/**
 * Fetches and parses the external election results feed.
 * This adapter is designed to be swappable and robust. It supports both
 * the official California Secretary of State JSON feed format (array of races)
 * and generic flat JSON schemas.
 */
export async function fetchAndParseFeed(url: string): Promise<ResultsPayload> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "Accept": "application/json",
      "User-Agent": "CA-Governor-Primary-Tracker/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch results feed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // 1. Handle official CA Secretary of State JSON feed (Array of races)
  if (Array.isArray(data)) {
    // Find the statewide results block
    const statewideRace = data.find(
      (race: any) =>
        race.raceTitle &&
        race.raceTitle.toLowerCase().includes("governor") &&
        race.raceTitle.toLowerCase().includes("statewide")
    );

    if (!statewideRace) {
      throw new Error("Invalid CA SOS feed: statewide governor race not found");
    }

    // Extract reporting percentage (e.g., "73.5% (14,547 of 19,788) precincts reporting" -> "73.5%")
    let pctReporting = "0%";
    if (statewideRace.Reporting) {
      const match = String(statewideRace.Reporting).match(/^([\d.]+%)/);
      pctReporting = match ? match[1] : String(statewideRace.Reporting);
    }

    const asOf = statewideRace.ReportingTime || new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) + " PT";
    const source = "CA Secretary of State";
    const note = statewideRace.Reporting || "Official semi-official results.";

    const rawCandidates = statewideRace.candidates || [];
    if (!Array.isArray(rawCandidates)) {
      throw new Error("Invalid CA SOS feed structure: candidates is not an array");
    }

    const candidates: Candidate[] = rawCandidates.slice(0, MAX_CANDIDATES).map((c: any) => {
      const name = String(c.Name || "").trim();
      if (!name) {
        throw new Error("Invalid candidate: missing Name");
      }

      return {
        name,
        party: parseParty(c.Party),
        votes: parseVotes(c.Votes),
        pct: parsePct(c.Percent)
      };
    });

    if (candidates.length === 0) {
      throw new Error("No candidates found in CA SOS governor race");
    }

    // Sort by votes descending
    candidates.sort((a, b) => b.votes - a.votes);

    return {
      asOf,
      pctReporting,
      source,
      note,
      candidates
    };
  }

  // 2. Handle generic flat JSON schemas (Object-based)
  const asOf = data.asOf || data.updatedAt || data.lastUpdated || new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) + " PT";
  const pctReporting = data.pctReporting || data.percentReporting || data.reportingPercent || "0%";
  const source = data.source || "External Election Feed";
  const note = data.note || data.statusNote || "Live feed data.";

  const rawCandidates = data.candidates || data.results || [];
  if (!Array.isArray(rawCandidates)) {
    throw new Error("Invalid feed structure: candidates is not an array");
  }

  const candidates: Candidate[] = rawCandidates.slice(0, MAX_CANDIDATES).map((c: any) => {
    const name = String(c.name || c.candidateName || "").trim();
    if (!name) {
      throw new Error("Invalid candidate: missing name");
    }

    return {
      name,
      party: parseParty(c.party ?? c.candidateParty),
      votes: parseVotes(c.votes),
      pct: parsePct(c.pct ?? c.percent)
    };
  });

  if (candidates.length === 0) {
    throw new Error("No candidates found in results feed");
  }

  // Sort by votes descending
  candidates.sort((a, b) => b.votes - a.votes);

  // Recalculate percentages per-candidate when a pct is missing/zero but we
  // have vote totals to derive it from. Handles feeds that supply pct for
  // some candidates but not others.
  const totalVotes = candidates.reduce((sum, c) => sum + c.votes, 0);
  if (totalVotes > 0) {
    candidates.forEach(c => {
      if (c.pct === 0) {
        c.pct = Number(((c.votes / totalVotes) * 100).toFixed(1));
      }
    });
  }

  return {
    asOf,
    pctReporting,
    source,
    note,
    candidates
  };
}
