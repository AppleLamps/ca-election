import { NextRequest, NextResponse } from "next/server";
import { ResultsPayload, getMockStatewideResults } from "@/lib/mockResults";
import { fetchAndParseFeed } from "@/lib/adapters";
import { parseParty, parseVotes, parsePct, parseReportingFraction } from "@/lib/parsing";
import { analyzeStatewide } from "@/lib/projection";
import { MAX_CANDIDATES } from "@/lib/constants";
import { RaceConfig, RaceId, getRace } from "@/lib/races";
import { OpenRouter } from "@openrouter/agent";

/**
 * Attach the point-in-time statistical summary (gap, 95% interval, Z-score,
 * skew-aware projection) so the client renders it without recomputing. Applied
 * to every source (feed, LLM, mock) before the payload leaves the resolver.
 */
function withProjection(results: ResultsPayload): ResultsPayload {
  const analysis = analyzeStatewide(
    results.candidates,
    parseReportingFraction(results.pctReporting)
  );
  if (analysis) {
    results.projection = {
      gap: analysis.gap,
      ci95: analysis.ci95,
      z: analysis.z,
      label: analysis.label,
      projectedGap: analysis.projectedGap,
    };
  }
  return results;
}

export const dynamic = "force-dynamic";

// Simple in-memory cache per race for the serverless instance to prevent
// hammering external feeds. Keyed by RaceId so the two races never clobber.
const cache = new Map<RaceId, { results: ResultsPayload; ts: number }>();
const CACHE_TTL_MS = 30000; // 30 seconds revalidation window

async function fetchLLMResults(apiKey: string, race: RaceConfig): Promise<ResultsPayload> {
  const model = process.env.LLM_MODEL || "google/gemini-3.1-flash-lite";

  const client = new OpenRouter({
    apiKey: apiKey
  });

  const prompt = `
You are a high-fidelity data extraction bot. Search the web for the latest, official or semi-official election results for the ${race.llmRaceName}.
Extract the vote counts, percentages, and reporting percentage for the major candidates, especially ${race.llmCandidatesOfInterest}.

Return ONLY a raw JSON object matching the following TypeScript interface. Do NOT include any markdown formatting, code block fences (like \`\`\`json), or extra text outside the JSON.

interface Party = "D" | "R" | "I";
interface Candidate { name: string; party: Party; votes: number; pct: number; }
interface ResultsPayload {
  asOf: string;          // human time the results were reported, e.g. "June 3, 2026 9:15 AM PT"
  pctReporting: string;  // e.g. "42%"
  source: string;        // outlet / feed name, e.g. "Associated Press" or "CA Secretary of State"
  note: string;          // one short sentence on count status
  candidates: Candidate[];
}

Ensure candidate votes are integers (no commas in the JSON numbers) and pct are numbers (e.g. 18.2).

Do NOT fabricate, estimate, or synthesize results. If you cannot find real, sourced election results for this specific race (for example, the count has not started or no outlet has reported figures), return EXACTLY this and nothing else:
{"unavailable": true}
`;

  const result = client.callModel({
    model,
    // Enable OpenRouter's web search plugin so the model actually retrieves
    // live results instead of answering from training data. This is the typed
    // equivalent of the ":online" model suffix.
    plugins: [{ id: "web", maxResults: 5 }],
    instructions: "You are a precise data extraction service. You always output valid, parseable JSON matching the requested schema exactly, with no conversational filler or markdown fences.",
    input: prompt,
    temperature: 0.1
  });

  const text = await result.getText();
  
  if (!text) {
    throw new Error("Empty response from OpenRouter API");
  }

  // Defensive parsing
  let cleaned = text.trim();
  
  // Strip markdown code block fences if present
  if (cleaned.startsWith("```")) {
    const firstIndex = cleaned.indexOf("{");
    const lastIndex = cleaned.lastIndexOf("}");
    if (firstIndex !== -1 && lastIndex !== -1 && lastIndex > firstIndex) {
      cleaned = cleaned.slice(firstIndex, lastIndex + 1);
    }
  } else {
    // Fallback search for JSON boundaries
    const firstIndex = cleaned.indexOf("{");
    const lastIndex = cleaned.lastIndexOf("}");
    if (firstIndex !== -1 && lastIndex !== -1 && lastIndex > firstIndex) {
      cleaned = cleaned.slice(firstIndex, lastIndex + 1);
    }
  }

  const parsed = JSON.parse(cleaned);

  // The model signals (per the prompt) that no real results exist yet. Throw so
  // the resolver degrades to clearly-labeled deterministic mock instead of
  // publishing fabricated numbers attributed to a real source.
  if (parsed.unavailable === true) {
    throw new Error("No real results available yet (LLM reported unavailable)");
  }

  if (!parsed.candidates || !Array.isArray(parsed.candidates)) {
    throw new Error("Parsed LLM JSON is missing candidates array");
  }

  const candidates = parsed.candidates.slice(0, MAX_CANDIDATES).map((c: any) => {
    const name = String(c.name || "").trim();
    if (!name) throw new Error("Candidate name is missing in LLM response");

    return {
      name,
      party: parseParty(c.party),
      votes: parseVotes(c.votes),
      pct: parsePct(c.pct)
    };
  });

  return {
    asOf: String(parsed.asOf || new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) + " PT"),
    pctReporting: String(parsed.pctReporting || "0%"),
    source: String(parsed.source || "OpenRouter " + model),
    note: String(parsed.note || "Live results extracted via OpenRouter."),
    candidates: candidates.sort((a: any, b: any) => b.votes - a.votes),
    synthetic: false
  };
}

/**
 * Resolves statewide results through the fallback chain:
 * external feed -> OpenRouter LLM -> mock data, degrading to mock on any error.
 * Shared by the public GET handler and the snapshot cron so neither has to
 * make an HTTP round-trip to the other.
 *
 * `fromError` distinguishes the configured-mock case (deterministic, cacheable)
 * from the error-fallback case (transient, should not be cached).
 */
export async function resolveStatewideResults(raceId: RaceId = "governor"): Promise<{
  results: ResultsPayload;
  source: string;
  fromError: boolean;
}> {
  const race = getRace(raceId);
  const feedUrl = process.env[race.feedEnvVar];
  const openrouterApiKey = process.env.OPENROUTER_API_KEY || process.env.LLM_API_KEY;

  try {
    if (feedUrl) {
      return { results: withProjection(await fetchAndParseFeed(feedUrl, race.feedMatchTerms)), source: "feed", fromError: false };
    }
    if (openrouterApiKey) {
      return { results: withProjection(await fetchLLMResults(openrouterApiKey, race)), source: "llm", fromError: false };
    }
    return { results: withProjection(getMockStatewideResults(race)), source: "mock", fromError: false };
  } catch (error) {
    console.error(`Error fetching live results for ${race.id}, falling back to mock data:`, error);
    // Graceful degradation: Fall back to mock results on any failure
    const results = getMockStatewideResults(race);
    results.note = `Fallback active. (Error fetching live data: ${error instanceof Error ? error.message : "Unknown error"})`;
    return { results: withProjection(results), source: "mock-fallback", fromError: true };
  }
}

export async function GET(request: NextRequest) {
  const raceId = getRace(new URL(request.url).searchParams.get("race")).id;
  const now = Date.now();

  // Return cached results if within TTL (per race)
  const cached = cache.get(raceId);
  if (cached && (now - cached.ts < CACHE_TTL_MS)) {
    return NextResponse.json(cached.results, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30",
        "X-Data-Source": "cache"
      }
    });
  }

  const { results, source, fromError } = await resolveStatewideResults(raceId);

  // Only cache real results. An error-fallback should be retried on the next
  // request rather than pinning mock data for the full TTL window.
  if (!fromError) {
    cache.set(raceId, { results, ts: now });
  }

  return NextResponse.json(results, {
    headers: {
      "Cache-Control": fromError
        ? "no-store"
        : "public, s-maxage=30, stale-while-revalidate=30",
      "X-Data-Source": source
    }
  });
}

