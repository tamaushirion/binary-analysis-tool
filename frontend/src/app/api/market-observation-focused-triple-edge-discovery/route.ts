import { NextRequest, NextResponse } from "next/server";
import {
  discoverMarketObservationFocusedTripleEdges,
  type MarketObservationFocusedTripleEdgeOptions,
} from "../../../lib/learning/marketObservationFocusedTripleEdgeDiscovery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function numberParam(searchParams: URLSearchParams, key: string): number | undefined {
  const raw = searchParams.get(key);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const options: MarketObservationFocusedTripleEdgeOptions = {
      featureVersion: searchParams.get("featureVersion") ?? undefined,
      minDecided: numberParam(searchParams, "minDecided"),
      minFoldDecided: numberParam(searchParams, "minFoldDecided"),
      minSegmentWinRate: numberParam(searchParams, "minSegmentWinRate"),
      persistentWinRate: numberParam(searchParams, "persistentWinRate"),
      minWilsonLowerBound: numberParam(searchParams, "minWilsonLowerBound"),
      maxSegmentGap: numberParam(searchParams, "maxSegmentGap"),
      recentWindow: numberParam(searchParams, "recentWindow"),
      minWinRateImprovement: numberParam(searchParams, "minWinRateImprovement"),
      minWilsonImprovement: numberParam(searchParams, "minWilsonImprovement"),
      minOccurrenceRate: numberParam(searchParams, "minOccurrenceRate"),
      limit: numberParam(searchParams, "limit"),
    };
    return NextResponse.json(discoverMarketObservationFocusedTripleEdges(options));
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "market_observation_focused_triple_edge_discovery_error",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
