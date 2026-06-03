import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Resolve candidate by case-insensitive name substring
function findCandidate(candidates: any[], nameSub: string) {
  return candidates.find(c => c.name.toLowerCase().includes(nameSub.toLowerCase()));
}

export async function GET(request: NextRequest) {
  // Check if Vercel KV is configured
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    return NextResponse.json({
      success: true,
      message: "Vercel KV is not configured. Snapshot skipped. Client will fall back to localStorage."
    });
  }

  try {
    // Dynamically import @vercel/kv to avoid loading issues if not configured
    const { kv } = await import("@vercel/kv");

    // Fetch current results by calling our own API
    const protocol = request.headers.get("x-forwarded-proto") || "http";
    const host = request.headers.get("host") || "localhost:3000";
    const resultsUrl = `${protocol}://${host}/api/results`;

    const res = await fetch(resultsUrl, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Failed to fetch results from ${resultsUrl}: ${res.statusText}`);
    }

    const results = await res.json();

    if (!results.candidates || !Array.isArray(results.candidates)) {
      throw new Error("Invalid results format: candidates array is missing");
    }

    const becerra = findCandidate(results.candidates, "becerra");
    const steyer = findCandidate(results.candidates, "steyer");

    if (!becerra || !steyer) {
      throw new Error("Could not find both Xavier Becerra and Tom Steyer in the candidates list");
    }

    const gap = Number((becerra.pct - steyer.pct).toFixed(1));
    const dataPoint = {
      t: new Date().toISOString(),
      gap,
      becerraPct: becerra.pct,
      steyerPct: steyer.pct,
      pctReporting: results.pctReporting
    };

    const key = "ca_governor_2026_gap_trend";

    // Append to list and cap to last 500 points
    await kv.rpush(key, JSON.stringify(dataPoint));
    await kv.ltrim(key, -500, -1);

    return NextResponse.json({
      success: true,
      message: "Snapshot logged successfully.",
      dataPoint
    });
  } catch (error) {
    console.error("Error logging gap snapshot:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
