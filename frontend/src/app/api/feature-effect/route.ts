import { NextResponse } from "next/server";
import { analyzeFeatureEffects } from "@/lib/learning/featureEffectAnalyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const result = analyzeFeatureEffects();

    return NextResponse.json({
      ok: true,
      stage: "feature_effect_analysis",
      analyzerVersion: "phase16-a-feature-effect-v2",
      result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "feature_effect_analysis_error",
        message: error instanceof Error ? error.message : "Feature Effect Analyzerで不明なエラーが発生しました。",
      },
      { status: 500 },
    );
  }
}
