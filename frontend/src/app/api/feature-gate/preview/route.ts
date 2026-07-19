import { NextRequest, NextResponse } from "next/server";
import { previewFeatureWinRateGate } from "@/lib/learning/featureWinRateGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = previewFeatureWinRateGate(body);

    return NextResponse.json({
      ok: true,
      stage: "feature_win_rate_gate_preview",
      gateVersion: "phase15-f-step3-a-db-path-fix",
      result,
      message: "Feature組み合わせ勝率GateのPreviewを実行しました。まだTrading Engineには接続していません。",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    return NextResponse.json(
      {
        ok: false,
        stage: "feature_win_rate_gate_preview_error",
        message,
      },
      { status: 500 }
    );
  }
}
