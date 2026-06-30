import { NextResponse } from "next/server";
import { analyzeDemo100Trades } from "@/lib/demo100Analysis";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const analysis = analyzeDemo100Trades();

    return NextResponse.json({
      ok: true,
      stage: "demo_100_analysis",
      analysis,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "demo_100_analysis",
        message:
          error instanceof Error
            ? error.message
            : "100件デモ分析に失敗しました",
      },
      { status: 500 }
    );
  }
}