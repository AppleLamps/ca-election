import { NextResponse } from "next/server";
import { KV_TREND_KEY } from "@/lib/constants";

export const dynamic = "force-dynamic";

type TrendPoint = {
  gap: number;
  t: string;
  becerraPct?: number;
  steyerPct?: number;
  pctReporting?: string;
};

function safeParseTrendItem(item: unknown): TrendPoint | null {
  try {
    const parsed = typeof item === "string" ? JSON.parse(item) : item;
    if (!parsed || typeof parsed !== "object") return null;

    const maybePoint = parsed as Record<string, unknown>;
    if (typeof maybePoint.gap !== "number" || typeof maybePoint.t !== "string") {
      return null;
    }

    return {
      gap: maybePoint.gap,
      t: maybePoint.t,
      becerraPct: typeof maybePoint.becerraPct === "number" ? maybePoint.becerraPct : undefined,
      steyerPct: typeof maybePoint.steyerPct === "number" ? maybePoint.steyerPct : undefined,
      pctReporting: typeof maybePoint.pctReporting === "string" ? maybePoint.pctReporting : undefined
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    return NextResponse.json({
      kvEnabled: false,
      trend: []
    });
  }

  try {
    const { kv } = await import("@vercel/kv");

    // Retrieve all items from the list
    const rawTrend = await kv.lrange(KV_TREND_KEY, 0, -1);

    // Parse items defensively. Keep valid points even if one KV entry is malformed.
    const trend = rawTrend
      .map((item) => safeParseTrendItem(item))
      .filter((item): item is TrendPoint => item !== null);

    return NextResponse.json({
      kvEnabled: true,
      trend
    });
  } catch (error) {
    console.error("Error fetching trend data from Vercel KV:", error);
    return NextResponse.json(
      { kvEnabled: false, error: "Failed to fetch trend from database", trend: [] },
      { status: 500 }
    );
  }
}
