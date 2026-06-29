import { NextResponse } from "next/server";
import { getTradeStats } from "@/lib/db/tradeRepository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = getTradeStats();

    return NextResponse.json({
      ok: true,
      stage: "trade_stats",
      stats,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        stage: "trade_stats",
        error: error?.message ?? "Trade Stats API エラー",
      },
      { status: 500 }
    );
  }
}