import { NextRequest, NextResponse } from "next/server";
import { resolveStatewideResults } from "../results/route";
import { analyzeStatewide, kalmanUpdate, KalmanState } from "@/lib/projection";
import { parseReportingFraction } from "@/lib/parsing";
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
    // Resolve current results in-process (no fragile HTTP self-call).
    const { results, fromError } = await resolveStatewideResults();

    // Never let synthetic (mock) or error-fallback data enter the historical
    // trend; only real feed/LLM results are logged.
    if (results.synthetic || fromError) {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: "Results are synthetic or from an error fallback; not logged."
      });
    }

    // Standings-based runoff analysis (2nd vs 3rd), never hardcoded names.
    const analysis = analyzeStatewide(
      results.candidates,
      parseReportingFraction(results.pctReporting)
    );

    if (!analysis) {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: "Fewer than three candidates; runoff gap is undefined."
      });
    }

    // Dynamically import @vercel/kv to avoid loading issues if not configured
    const { kv } = await import("@vercel/kv");

    // Read the previous datapoint to carry the Kalman state forward.
    let prevState: KalmanState | null = null;
    try {
      const last = await kv.lrange(KV_TREND_KEY, -1, -1);
      if (last && last.length > 0) {
        const prev = typeof last[0] === "string" ? JSON.parse(last[0]) : last[0];
        if (prev && typeof prev.projectedGap === "number" && typeof prev.projVar === "number") {
          prevState = { x: prev.projectedGap, P: prev.projVar };
        }
      }
    } catch {
      // Corrupted last entry: start the filter fresh from this observation.
      prevState = null;
    }

    // Observation = skew-aware projected gap; observation variance = SE^2 in
    // points^2 (analysis.se is a fraction, so scale by 100).
    const obsVar = Math.pow(analysis.se * 100, 2);
    const state = kalmanUpdate(prevState, analysis.projectedGap, obsVar);

    const dataPoint = {
      t: new Date().toISOString(),
      gap: Number(analysis.gap.toFixed(2)),
      secondName: analysis.secondName,
      thirdName: analysis.thirdName,
      se: Number(analysis.se.toFixed(6)),
      ci95: Number(analysis.ci95.toFixed(2)),
      projectedGap: Number(state.x.toFixed(2)),
      projVar: Number(state.P.toFixed(6)),
      reportingFraction: Number(analysis.reportingFraction.toFixed(4))
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
