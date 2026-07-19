import { NextResponse } from "next/server";
import { getMarketObservationSummary } from "@/lib/learning/marketObservationStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function num(value: string | null, fallback: number) {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = num(url.searchParams.get("limit"), 50);
    const result = getMarketObservationSummary({ limit });
    return NextResponse.json({
      ok: true,
      stage: "market_observation_summary",
      analyzerVersion: "phase16-k-market-observation-v1",
      result,
      message: "Market Observation Datasetの状態を返しました。Trading Engineには接続していません。",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "market_observation_summary_error",
        message: error instanceof Error ? error.message : "Market Observation Summaryで不明なエラーが発生しました。",
      },
      { status: 500 },
    );
  }
}
