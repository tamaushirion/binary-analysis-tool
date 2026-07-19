import { NextRequest, NextResponse } from "next/server";
import { analyzeMarketObservationEdges } from "@/lib/learning/marketObservationEdgeAnalyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function num(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const result = analyzeMarketObservationEdges({
      minSample: num(params.get("minSample"), 10),
      watchMinSample: num(params.get("watchMinSample"), 30),
      adoptMinSample: num(params.get("adoptMinSample"), 80),
      watchEffectiveWinRate: num(params.get("watchEffectiveWinRate"), 60),
      adoptEffectiveWinRate: num(params.get("adoptEffectiveWinRate"), 70),
      neutralEdgeThreshold: num(params.get("neutralEdgeThreshold"), 7),
      limit: num(params.get("limit"), 100),
      includeNeutral: params.get("includeNeutral") === "true",
      includeUnknown: params.get("includeUnknown") === "true",
      featureVersion: params.get("featureVersion") ?? undefined,
    });

    return NextResponse.json({
      ok: true,
      stage: "market_observation_edge_analysis",
      analyzerVersion: "phase16-l-market-observation-edge-analyzer-v1",
      result,
      message: "Market Observation DatasetからHIGH/LOW両方向のDirectional Edgeを解析しました。実Buyは行いません。",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "market_observation_edge_analysis_error",
        message: error instanceof Error ? error.message : "Market Observation Edge Analysisで不明なエラーが発生しました。",
      },
      { status: 500 },
    );
  }
}
