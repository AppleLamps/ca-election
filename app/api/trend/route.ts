import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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
    const key = "ca_governor_2026_gap_trend";

    // Retrieve all items from the list
    const rawTrend = await kv.lrange(key, 0, -1);

    // Parse items. Vercel KV might return them as objects or strings depending on how they were written/retrieved.
    const trend = rawTrend.map(item => {
      if (typeof item === "string") {
        return JSON.parse(item);
      }
      return item;
    });

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
