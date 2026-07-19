import { NextRequest, NextResponse } from "next/server";
import { analyzeRegimeEdges } from "@/lib/learning/regimeEdgeAnalyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function readNumber(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const result = analyzeRegimeEdges({
      minSample: readNumber(params.get("minSample"), 5),
      adoptMinSample: readNumber(params.get("adoptMinSample"), 50),
      watchMinSample: readNumber(params.get("watchMinSample"), 15),
      adoptEffectiveWinRate: readNumber(params.get("adoptEffectiveWinRate"), 70),
      watchEffectiveWinRate: readNumber(params.get("watchEffectiveWinRate"), 65),
      neutralEdgeThreshold: readNumber(params.get("neutralEdgeThreshold"), 10),
      limit: readNumber(params.get("limit"), 150),
      includeNeutral: params.get("includeNeutral") === "true",
      includeUnknown: params.get("includeUnknown") === "true",
    });

    return NextResponse.json({
      ok: true,
      stage: "regime_edge_analysis",
      analyzerVersion: "phase16-c-regime-edge-v1",
      result,
      message:
        "SQLiteの既存取引データからRegime別の順方向/反転方向Directional Edgeを解析しました。Trading Engineには接続していません。",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "regime_edge_analysis_error",
        message: error instanceof Error ? error.message : "Regime Edge解析で不明なエラーが発生しました。",
      },
      { status: 500 },
    );
  }
}
