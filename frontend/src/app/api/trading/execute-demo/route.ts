import { NextResponse } from "next/server";
import { executeDemoTradingEngine } from "@/lib/trading/tradingEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DEMO_ACCOUNT_ID = "DOT93536475";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const accountId = body.accountId ?? DEFAULT_DEMO_ACCOUNT_ID;
    const pair = body.pair ?? "Volatility 100 Index";
    const direction = body.direction ?? "HIGH";
    const score = Number(body.score ?? 0);

    if (direction !== "HIGH" && direction !== "LOW") {
      return NextResponse.json(
        {
          ok: false,
          stage: "trading_engine",
          error: "direction は HIGH または LOW を指定してください",
        },
        { status: 400 }
      );
    }

    const result = await executeDemoTradingEngine({
      accountId,
      pair,
      direction,
      score,
      amount: body.amount ?? 1,
      duration: body.duration ?? 5,
      durationUnit: body.durationUnit ?? "m",
      currency: body.currency ?? "USD",
      minScore: body.minScore ?? 80,
      minPayoutRate: body.minPayoutRate ?? 1.8,
      minConfidence: body.minConfidence ?? 60,
      features: body.features ?? null,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        stage: "trading_engine",
        error: error?.message ?? "Trading Engine API Route エラー",
      },
      { status: 500 }
    );
  }
}