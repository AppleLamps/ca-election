import { NextRequest, NextResponse } from "next/server";
import { resolveStatewideResults } from "../results/route";
import { analyzeStatewide, kalmanUpdate, KalmanState } from "@/lib/projection";
import { parseReportingFraction } from "@/lib/parsing";
import { RACE_IDS, getRace } from "@/lib/races";

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

    // Snapshot every race into its own trend list, so a single cron covers all.
    const results = [];
    for (const raceId of RACE_IDS) {
      results.push(await snapshotRace(kv, raceId));
    }

    return NextResponse.json({ success: true, races: results });
  } catch (error) {
    console.error("Error logging gap snapshot:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// kv typing is dynamic (imported lazily); keep it loose like the rest of the codebase.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function snapshotRace(kv: any, raceId: (typeof RACE_IDS)[number]) {
  const race = getRace(raceId);
  const { results, fromError } = await resolveStatewideResults(raceId);

  // Never let synthetic (mock) or error-fallback data enter the historical trend.
  if (results.synthetic || fromError) {
    return { race: raceId, skipped: true, reason: "synthetic or error fallback" };
  }

  const analysis = analyzeStatewide(
    results.candidates,
    parseReportingFraction(results.pctReporting)
  );

  if (!analysis) {
    return { race: raceId, skipped: true, reason: "fewer than three candidates" };
  }

  // Read the previous datapoint to carry the Kalman state forward (per race key).
  let prevState: KalmanState | null = null;
  try {
    const last = await kv.lrange(race.kvTrendKey, -1, -1);
    if (last && last.length > 0) {
      const prev = typeof last[0] === "string" ? JSON.parse(last[0]) : last[0];
      if (prev && typeof prev.projectedGap === "number" && typeof prev.projVar === "number") {
        prevState = { x: prev.projectedGap, P: prev.projVar };
      }
    }
  } catch {
    prevState = null;
  }

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

  await kv.rpush(race.kvTrendKey, JSON.stringify(dataPoint));
  await kv.ltrim(race.kvTrendKey, -500, -1);

  return { race: raceId, skipped: false, dataPoint };
}
