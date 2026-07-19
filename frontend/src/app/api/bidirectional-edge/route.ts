import { NextRequest, NextResponse } from "next/server";
import { analyzeBidirectionalEdges } from "@/lib/learning/bidirectionalEdgeAnalyzer";

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
    const result = analyzeBidirectionalEdges({
      minSample: num(params.get("minSample"), 5),
      adoptMinSample: num(params.get("adoptMinSample"), 50),
      watchMinSample: num(params.get("watchMinSample"), 15),
      adoptEffectiveWinRate: num(params.get("adoptEffectiveWinRate"), 70),
      watchEffectiveWinRate: num(params.get("watchEffectiveWinRate"), 65),
      neutralEdgeThreshold: num(params.get("neutralEdgeThreshold"), 10),
      limit: num(params.get("limit"), 100),
      includeNeutral: params.get("includeNeutral") === "true",
      includeUnknown: params.get("includeUnknown") === "true",
    });

    return NextResponse.json({
      ok: true,
      stage: "bidirectional_edge_analysis",
      analyzerVersion: "phase16-b-bidirectional-edge-v1",
      result,
      message: "SQLiteの既存取引データから順方向/反転方向のDirectional Edgeを解析しました。Trading Engineには接続していません。",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "bidirectional_edge_analysis_error",
        message: error instanceof Error ? error.message : "Bidirectional Edge解析で不明なエラーが発生しました。",
      },
      { status: 500 },
    );
  }
}
