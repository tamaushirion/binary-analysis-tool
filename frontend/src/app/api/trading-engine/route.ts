import { NextResponse } from "next/server";
import { executeDemoTradingEngine } from "@/lib/trading/tradingEngine";

export const dynamic = "force-dynamic";

const DEFAULT_DERIV_ACCOUNT_ID =
  process.env.DERIV_ACCOUNT_ID || "DOT93536475";

function toBoolean(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const result = await executeDemoTradingEngine({
      accountId: body.accountId ?? DEFAULT_DERIV_ACCOUNT_ID,
      pair: body.pair,
      direction: body.direction,
      score: Number(body.score),
      amount: body.amount ? Number(body.amount) : 1,
      duration: body.duration ? Number(body.duration) : 1,
      durationUnit: body.durationUnit ?? "m",
      currency: body.currency ?? "USD",
      minScore: body.minScore ? Number(body.minScore) : 80,
      minPayoutRate: body.minPayoutRate ? Number(body.minPayoutRate) : 1.8,
      minConfidence: body.minConfidence ? Number(body.minConfidence) : 75,
      features: body.features ?? null,
      debugBypassDemo100Completed: toBoolean(
        body.debugBypassDemo100Completed
      ),
    });

    return NextResponse.json({
      ok: true,
      stage: "trading_engine_api",
      result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "trading_engine_api_error",
        message:
          error instanceof Error
            ? error.message
            : "Trading Engine APIでエラーが発生しました",
      },
      { status: 500 }
    );
  }
}
