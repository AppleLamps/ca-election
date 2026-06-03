import { NextRequest, NextResponse } from "next/server";
import { resolveStatewideResults } from "../results/route";
import { findCandidate } from "@/lib/parsing";
import { KV_TREND_KEY } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Protect the write endpoint. When CRON_SECRET is configured, require the
  // bearer token Vercel Cron sends so the endpoint cannot be spammed to churn
  // the KV trend list. If unset, behavior is unchanged (open) for local dev.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
  }

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

    // Resolve current results in-process (no fragile HTTP self-call).
    const { results } = await resolveStatewideResults();

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

    // Append to list and cap to last 500 points
    await kv.rpush(KV_TREND_KEY, JSON.stringify(dataPoint));
    await kv.ltrim(KV_TREND_KEY, -500, -1);

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
