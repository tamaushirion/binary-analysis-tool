import { NextResponse } from "next/server";
import { getLearningStats } from "@/lib/db/tradeRepository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = getLearningStats();

    return NextResponse.json({
      ok: true,
      stage: "learning_stats",
      stats,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        stage: "learning_stats",
        error: error?.message ?? "Learning Stats API エラー",
      },
      { status: 500 }
    );
  }
}