import { NextRequest, NextResponse } from "next/server";
import { getMockCountyResults, COUNTY_LIST } from "@/lib/mockResults";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const countyName = searchParams.get("name");

  if (!countyName) {
    return NextResponse.json(
      { error: "Missing required query parameter: name" },
      { status: 400 }
    );
  }

  // Find matching county name (case-insensitive)
  const matchedCounty = COUNTY_LIST.find(
    c => c.toLowerCase() === countyName.toLowerCase()
  );

  if (!matchedCounty) {
    return NextResponse.json(
      { error: `County not found: ${countyName}. Must be one of the 58 California counties.` },
      { status: 404 }
    );
  }

  try {
    // For this dashboard, county results are synthesized using our stable, seeded mock generator.
    // This ensures that even if the statewide feed is live, county drill-downs remain fully functional,
    // consistent, and realistic.
    const results = getMockCountyResults(matchedCounty);
    
    return NextResponse.json(results, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60"
      }
    });
  } catch (error) {
    console.error(`Error generating results for county ${matchedCounty}:`, error);
    return NextResponse.json(
      { error: "Failed to generate county results" },
      { status: 500 }
    );
  }
}
