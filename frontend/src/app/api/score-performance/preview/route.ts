import { NextRequest, NextResponse } from "next/server";
import { adjustScoreByPerformance } from "@/lib/analysis/scorePerformanceAdjuster";

function toNumber(value: string | null, fallback: number) {
  if (value === null) return fallback;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toDirection(value: string | null): "HIGH" | "LOW" {
  return value === "HIGH" || value === "LOW" ? value : "LOW";
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;

    const pair = params.get("pair") ?? "Volatility 100 Index";
    const direction = toDirection(params.get("direction"));
    const score = toNumber(params.get("score"), 80);
    const minTrades = toNumber(params.get("minTrades"), 10);

        const adjusted = adjustScoreByPerformance(score);

    return NextResponse.json({
      ok: true,
      stage: "score_performance_preview",
      input: {
        pair,
        direction,
        score,
        minTrades,
      },
      adjusted,
      message:
        "Score帯の過去実績をもとに、エントリー前の補正結果を確認しました。",
    });
  } catch (error: any) {
    console.error(error);

    return NextResponse.json(
      {
        ok: false,
        stage: "score_performance_preview_error",
        error: error?.message ?? "Score補正プレビューに失敗しました",
      },
      { status: 500 }
    );
  }
}
