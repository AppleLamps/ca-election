import { ResultsPayload, Candidate, Party } from "../mockResults";

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
    ) || data[0]; // Fallback to first element if not found

    if (!statewideRace) {
      throw new Error("Invalid CA SOS feed: empty array");
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

    const candidates: Candidate[] = rawCandidates.map((c: any) => {
      const name = String(c.Name || "").trim();
      if (!name) {
        throw new Error("Invalid candidate: missing Name");
      }

      // Map party strings
      let party: Party = "I";
      const rawParty = String(c.Party || "").trim().toUpperCase();
      if (rawParty.startsWith("DEM") || rawParty === "D") party = "D";
      else if (rawParty.startsWith("REP") || rawParty.startsWith("GOP") || rawParty === "R") party = "R";

      // Parse votes (e.g., "1,395" -> 1395)
      let votes = 0;
      if (typeof c.Votes === "number") {
        votes = c.Votes;
      } else if (typeof c.Votes === "string") {
        votes = parseInt(c.Votes.replace(/,/g, ""), 10) || 0;
      }

      // Parse percentage (e.g., "18.2" -> 18.2)
      let pct = 0;
      if (typeof c.Percent === "number") {
        pct = c.Percent;
      } else if (typeof c.Percent === "string") {
        pct = parseFloat(c.Percent.replace(/%/g, "")) || 0;
      }

      return { name, party, votes, pct };
    });

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

  const candidates: Candidate[] = rawCandidates.map((c: any) => {
    const name = String(c.name || c.candidateName || "").trim();
    if (!name) {
      throw new Error("Invalid candidate: missing name");
    }

    let party: Party = "I";
    const rawParty = String(c.party || c.candidateParty || "").trim().toUpperCase();
    if (rawParty.startsWith("DEM") || rawParty === "D") party = "D";
    else if (rawParty.startsWith("REP") || rawParty.startsWith("GOP") || rawParty === "R") party = "R";

    let votes = 0;
    if (typeof c.votes === "number") {
      votes = c.votes;
    } else if (typeof c.votes === "string") {
      votes = parseInt(c.votes.replace(/,/g, ""), 10) || 0;
    }

    let pct = 0;
    if (typeof c.pct === "number") {
      pct = c.pct;
    } else if (typeof c.percent === "number") {
      pct = c.percent;
    } else if (typeof c.pct === "string") {
      pct = parseFloat(c.pct.replace(/%/g, "")) || 0;
    } else if (typeof c.percent === "string") {
      pct = parseFloat(c.percent.replace(/%/g, "")) || 0;
    }

    return { name, party, votes, pct };
  });

  if (candidates.length === 0) {
    throw new Error("No candidates found in results feed");
  }

  // Sort by votes descending
  candidates.sort((a, b) => b.votes - a.votes);

  // Recalculate percentages if they are missing or all zero
  const totalVotes = candidates.reduce((sum, c) => sum + c.votes, 0);
  if (totalVotes > 0 && candidates.every(c => c.pct === 0)) {
    candidates.forEach(c => {
      c.pct = Number(((c.votes / totalVotes) * 100).toFixed(1));
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
