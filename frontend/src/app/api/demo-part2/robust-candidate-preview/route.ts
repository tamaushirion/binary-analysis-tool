import { NextRequest, NextResponse } from "next/server";
import {
  runDemo2RobustCandidatePreview,
} from "@/lib/learning/demo2RobustCandidatePreview";
import type { Demo2RobustFeatureInput } from "@/lib/learning/demo2RobustCandidateGate";

export const dynamic = "force-dynamic";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown robust preview error";
}

export async function GET() {
  try {
    return NextResponse.json(runDemo2RobustCandidatePreview());
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        stage: "demo_part2_robust_candidate_preview_error",
        message: errorMessage(error),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Demo2RobustFeatureInput;
    return NextResponse.json(runDemo2RobustCandidatePreview(body));
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        stage: "demo_part2_robust_candidate_preview_error",
        message: errorMessage(error),
      },
      { status: 500 },
    );
  }
}
