import { NextRequest, NextResponse } from "next/server";
import { analyzeRejectShadows } from "@/lib/analysis/rejectShadowAnalyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseSinceDays(value: string | null) {
  if (value === null || value.trim() === "") return 30;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 30;
  return Math.min(3650, parsed);
}

export async function GET(request: NextRequest) {
  try {
    const sinceDays = parseSinceDays(
      request.nextUrl.searchParams.get("sinceDays"),
    );
    return NextResponse.json(analyzeRejectShadows({ sinceDays }));
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        stage: "reject_shadow_analysis_error",
        error:
          error instanceof Error
            ? error.message
            : "Reject Shadow Analyzerで不明なエラーが発生しました",
      },
      { status: 500 },
    );
  }
}
