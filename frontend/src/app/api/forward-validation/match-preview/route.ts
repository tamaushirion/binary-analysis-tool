import { NextResponse } from "next/server";
import { previewForwardValidationCandidateMatches } from "@/lib/learning/forwardValidationMatchPreview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const result = previewForwardValidationCandidateMatches();

    return NextResponse.json({
      ok: true,
      stage: "forward_validation_match_preview",
      analyzerVersion: result.analyzerVersion,
      result,
      message: result.message,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "forward_validation_match_preview_error",
        message: error instanceof Error ? error.message : "Forward Validation候補一致プレビューで不明なエラーが発生しました。",
      },
      { status: 500 },
    );
  }
}
