import { NextRequest, NextResponse } from "next/server";
import { applyEmpiricalEntryGate } from "@/lib/learning/empiricalEntryGate";

function toDirection(value: string | null): "HIGH" | "LOW" {
  return value === "HIGH" || value === "LOW" ? value : "LOW";
}

function toNumber(value: string | null, fallback: number) {
  if (value === null) return fallback;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;

    const pair = params.get("pair") ?? "Volatility 100 Index";
    const direction = toDirection(params.get("direction"));
    const score = toNumber(params.get("score"), 84);
    const finalScore = params.get("finalScore")
      ? toNumber(params.get("finalScore"), score)
      : null;
    const minTrades = toNumber(params.get("minTrades"), 10);
    const minWinRate = toNumber(params.get("minWinRate"), 57);

    const gate = applyEmpiricalEntryGate({
      pair,
      direction,
      score,
      finalScore,
      minTrades,
      minWinRate,
    });

    return NextResponse.json({
      ok: true,
      stage: "empirical_entry_gate_preview",
      analyzerVersion: "phase15-e-empirical-entry-gate-v1",
      input: {
        pair,
        direction,
        score,
        finalScore,
        minTrades,
        minWinRate,
      },
      gate,
      message:
        "Demo実績に基づくEntry Gate補正をプレビューしました。",
    });
  } catch (error: any) {
    console.error(error);

    return NextResponse.json(
      {
        ok: false,
        stage: "empirical_entry_gate_preview_error",
        analyzerVersion: "phase15-e-empirical-entry-gate-v1",
        error: error?.message ?? "Empirical Entry Gateプレビューに失敗しました",
      },
      { status: 500 }
    );
  }
}
