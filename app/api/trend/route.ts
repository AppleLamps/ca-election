import { NextResponse } from "next/server";
import { KV_TREND_KEY } from "@/lib/constants";

export const dynamic = "force-dynamic";

type TrendPoint = {
  gap: number;
  t: string;
  // Statistical/predictive fields (present on points written by the current
  // snapshot route; absent on legacy points, in which case they stay undefined
  // and the client simply omits the band/projection for those points).
  secondName?: string;
  thirdName?: string;
  ci95?: number;
  projectedGap?: number;
  reportingFraction?: number;
};

const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function safeParseTrendItem(item: unknown): TrendPoint | null {
  try {
    const parsed = typeof item === "string" ? JSON.parse(item) : item;
    if (!parsed || typeof parsed !== "object") return null;

    const p = parsed as Record<string, unknown>;
    if (typeof p.gap !== "number" || typeof p.t !== "string") {
      return null;
    }

    return {
      gap: p.gap,
      t: p.t,
      secondName: str(p.secondName),
      thirdName: str(p.thirdName),
      ci95: num(p.ci95),
      projectedGap: num(p.projectedGap),
      reportingFraction: num(p.reportingFraction)
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
