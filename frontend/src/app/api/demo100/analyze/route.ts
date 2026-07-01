import { NextResponse } from "next/server";
import { analyzeDemo100 } from "@/lib/analysis/demo100Analyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const report = analyzeDemo100(100);
    return NextResponse.json(report);
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        stage: "demo100_analysis_error",
        error: error?.message ?? "Demo100分析に失敗しました",
      },
      { status: 500 }
    );
  }
}