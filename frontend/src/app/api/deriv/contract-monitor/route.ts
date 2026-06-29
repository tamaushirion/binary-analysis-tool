import { NextResponse } from "next/server";
import { monitorDerivContract } from "@/lib/deriv/contractMonitor";
import { saveTradeHistory } from "@/lib/db/tradeRepository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DEMO_ACCOUNT_ID = "DOT93536475";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const accountId = body.accountId ?? DEFAULT_DEMO_ACCOUNT_ID;
    const contractId = Number(body.contractId);

    if (!contractId || Number.isNaN(contractId)) {
      return NextResponse.json(
        {
          ok: false,
          stage: "contract_monitor",
          error: "contractId が必要です",
        },
        { status: 400 }
      );
    }

    const result = await monitorDerivContract({
      accountId,
      contractId,
      maxWaitMs: body.maxWaitMs,
      intervalMs: body.intervalMs,
    });

    let savedTrade = null;

    if (result.ok && result.stage === "contract_closed") {
      savedTrade = saveTradeHistory({
        contractId: result.contractId,
        proposalId: body.proposalId ?? null,
        pair: body.pair ?? "Volatility 100 Index",
        direction: body.direction ?? "HIGH",
        score: body.score ?? null,
        payoutRate: body.payoutRate ?? null,
        buyPrice: result.buyPrice,
        payout: result.payout,
        profit: result.profit,
        status: result.status,
        entrySpot: result.entrySpot,
        exitSpot: result.exitSpot,
        startTime: result.startTime,
        endTime: result.endTime,
        features: body.features ?? null,
      });
    }

    return NextResponse.json({
      ...result,
      savedTrade,
      message:
        savedTrade !== null
          ? "Contract監視完了・Trade History保存成功"
          : result.stage,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        stage: "contract_monitor",
        error: error?.message ?? "Contract Monitor API Route エラー",
      },
      { status: 500 }
    );
  }
}