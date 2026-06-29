import { NextResponse } from "next/server";
import { requestDerivProposal } from "@/lib/deriv/proposal";
import { judgeFinalDecision } from "@/lib/deriv/finalDecision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DEMO_ACCOUNT_ID = "DOT93536475";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const accountId = body.accountId ?? DEFAULT_DEMO_ACCOUNT_ID;
    const pair = body.pair ?? "Volatility 100 Index";
    const direction = body.direction ?? "HIGH";
    const score = body.score ?? 85;

    if (direction !== "HIGH" && direction !== "LOW") {
      return NextResponse.json(
        {
          ok: false,
          error: "direction は HIGH または LOW を指定してください",
        },
        { status: 400 }
      );
    }

    const result = await requestDerivProposal({
      accountId,
      pair,
      direction,
      amount: body.amount,
      duration: body.duration,
      durationUnit: body.durationUnit,
      currency: body.currency,
      useCache: body.useCache,
    });

    const payoutRate = result?.payoutRate ?? null;

    const finalDecision = judgeFinalDecision({
      pair,
      direction,
      score,
      payoutRate,
      minScore: body.minScore ?? 80,
      minPayoutRate: body.minPayoutRate ?? 1.8,
    });

    return NextResponse.json({
      ok: true,
      stage: "proposal_with_final_decision",
      accountId,
      pair,
      direction,
      score,
      payoutJudgement: {
        payoutRate,
        isTradablePayout:
          typeof payoutRate === "number" ? payoutRate >= 1.8 : false,
        minPayoutRate: 1.8,
      },
      finalDecision,
      result,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        stage: "proposal_with_final_decision",
        error: error?.message ?? "Proposal API Route エラー",
      },
      { status: 500 }
    );
  }
}