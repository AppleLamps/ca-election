import { ResultsPayload } from "../mockResults";

/**
 * Fetches and parses the external election results feed.
 * This adapter is designed to be swappable and robust. It assumes the external
 * feed returns a JSON payload that can be mapped to our normalized ResultsPayload.
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

  // Defensive parsing: Map external feed schema to our normalized ResultsPayload.
  // We handle both direct matching schemas and slightly nested schemas.
  const asOf = data.asOf || data.updatedAt || data.lastUpdated || new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) + " PT";
  const pctReporting = data.pctReporting || data.percentReporting || data.reportingPercent || "0%";
  const source = data.source || "External Election Feed";
  const note = data.note || data.statusNote || "Live feed data.";

  const rawCandidates = data.candidates || data.results || [];
  if (!Array.isArray(rawCandidates)) {
    throw new Error("Invalid feed structure: candidates is not an array");
  }

  const candidates = rawCandidates.map((c: any) => {
    // Coerce name
    const name = String(c.name || c.candidateName || "").trim();
    if (!name) {
      throw new Error("Invalid candidate: missing name");
    }

    // Coerce party
    let party = String(c.party || c.candidateParty || "I").trim().toUpperCase();
    if (party.startsWith("DEM") || party === "D") party = "D";
    else if (party.startsWith("REP") || party.startsWith("GOP") || party === "R") party = "R";
    else party = "I";

    // Coerce votes
    let votes = 0;
    if (typeof c.votes === "number") {
      votes = c.votes;
    } else if (typeof c.votes === "string") {
      votes = parseInt(c.votes.replace(/,/g, ""), 10) || 0;
    }

    // Coerce percentage
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

    return { name, party: party as "D" | "R" | "I", votes, pct };
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
