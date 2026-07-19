import { NextRequest, NextResponse } from "next/server";
import { getDemo2RobustCandidateTradeStats } from "@/lib/learning/demo2RobustCandidateTradeStats";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const raw = request.nextUrl.searchParams.get("recentWindow");
    const recentWindow = raw === null ? undefined : Number(raw);
    return NextResponse.json(getDemo2RobustCandidateTradeStats({ recentWindow: typeof recentWindow === "number" && Number.isFinite(recentWindow) ? recentWindow : undefined }));
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, stage: "demo_part2_robust_candidate_stats_error", message: error instanceof Error ? error.message : "Unknown candidate stats error" }, { status: 500 });
  }
}
