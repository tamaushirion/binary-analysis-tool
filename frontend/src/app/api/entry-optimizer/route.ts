import { NextRequest, NextResponse } from "next/server";
import { optimizeEntry } from "@/lib/analysis/entryOptimizer";

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

    return NextResponse.json(optimizeEntry({ sinceDays }));
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        stage: "entry_optimization_preview_error",
        error:
          error instanceof Error
            ? error.message
            : "Entry Optimizerで不明なエラーが発生しました",
      },
      { status: 500 },
    );
  }
}
