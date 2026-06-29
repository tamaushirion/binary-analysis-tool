import { NextResponse } from "next/server";
import { getRecentTradeHistory } from "@/lib/db/tradeRepository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") ?? 50);

    const trades = getRecentTradeHistory(limit);

    return NextResponse.json({
      ok: true,
      stage: "trade_history",
      count: trades.length,
      trades,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        stage: "trade_history",
        error: error?.message ?? "Trade History API エラー",
      },
      { status: 500 }
    );
  }
}