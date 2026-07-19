import { NextRequest, NextResponse } from "next/server";
import { analyzeMarketObservationCombinationEdges } from "@/lib/learning/marketObservationCombinationEdge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function num(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | null): boolean {
  return value === "true" || value === "1" || value === "yes";
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const maxCombinationSizeParam = num(params.get("maxCombinationSize"), 3);
    const result = analyzeMarketObservationCombinationEdges({
      minSample: num(params.get("minSample"), 20),
      watchMinSample: num(params.get("watchMinSample"), 30),
      strongMinSample: num(params.get("strongMinSample"), 80),
      highFrequencyMinSample: num(params.get("highFrequencyMinSample"), 180),
      maxCombinationSize: maxCombinationSizeParam === 2 ? 2 : 3,
      watchEffectiveWinRate: num(params.get("watchEffectiveWinRate"), 58),
      strongEffectiveWinRate: num(params.get("strongEffectiveWinRate"), 68),
      frequencyEffectiveWinRate: num(params.get("frequencyEffectiveWinRate"), 58),
      neutralEdgeThreshold: num(params.get("neutralEdgeThreshold"), 6),
      maxTrainTestGap: num(params.get("maxTrainTestGap"), 14),
      minWilsonLowerBound: num(params.get("minWilsonLowerBound"), 50),
      limit: num(params.get("limit"), 100),
      includeNeutral: bool(params.get("includeNeutral")),
      includeReject: bool(params.get("includeReject")),
      includeUnknown: bool(params.get("includeUnknown")),
      featureVersion: params.get("featureVersion") ?? "phase16-k-market-observation-v1",
    });

    return NextResponse.json({
      ok: true,
      stage: "market_observation_combination_edge_analysis",
      analyzerVersion: "phase16-m-market-observation-combination-edge-v1",
      result,
      message: "Market Observation Datasetから2条件/3条件のEdgeを解析しました。実Buyは行いません。",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "market_observation_combination_edge_analysis_error",
        message: error instanceof Error ? error.message : "Market Observation Combination Edge解析で不明なエラーが発生しました。",
      },
      { status: 500 },
    );
  }
}
