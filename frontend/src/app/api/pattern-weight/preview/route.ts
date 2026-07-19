import { NextRequest, NextResponse } from "next/server";
import { evaluatePatternWeight } from "@/lib/learning/patternWeightLearning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = evaluatePatternWeight(body);

    return NextResponse.json({
      ok: true,
      stage: "pattern_weight_learning_preview",
      gateVersion: "phase15-h-pattern-weight-learning-v1",
      result,
      message: "Pattern Weight Learning Previewを実行しました。",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        stage: "pattern_weight_learning_preview_error",
        message: error?.message ?? "Pattern Weight Learning Previewでエラーが発生しました。",
      },
      { status: 500 },
    );
  }
}
