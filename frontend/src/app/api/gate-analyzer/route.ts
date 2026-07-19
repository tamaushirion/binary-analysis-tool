import { NextRequest, NextResponse } from "next/server";
import { analyzeGates } from "@/lib/analysis/gateAnalyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseSinceDays(value: string | null) {
  if (value === null || value.trim() === "") return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return Math.min(3650, parsed);
}

export async function GET(request: NextRequest) {
  try {
    const sinceDays = parseSinceDays(
      request.nextUrl.searchParams.get("sinceDays"),
    );

    return NextResponse.json(analyzeGates({ sinceDays }));
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        stage: "gate_analysis_error",
        error:
          error instanceof Error
            ? error.message
            : "Gate Analyzerで不明なエラーが発生しました",
      },
      { status: 500 },
    );
  }
}
