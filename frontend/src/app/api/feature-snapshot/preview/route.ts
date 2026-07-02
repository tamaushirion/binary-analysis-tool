import { NextRequest, NextResponse } from "next/server";
import { buildFeatureSnapshot } from "@/lib/analysis/featureSnapshotBuilder";

function toDirection(value: any): "HIGH" | "LOW" {
  return value === "HIGH" || value === "LOW" ? value : "LOW";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const snapshot = buildFeatureSnapshot({
      pair: body.pair ?? "Volatility 100 Index",
      direction: toDirection(body.direction),
      score: Number(body.score ?? 80),
      finalScore:
        body.finalScore === undefined || body.finalScore === null
          ? null
          : Number(body.finalScore),
      weightScore:
        body.weightScore === undefined || body.weightScore === null
          ? null
          : Number(body.weightScore),
      similarityScore:
        body.similarityScore === undefined || body.similarityScore === null
          ? null
          : Number(body.similarityScore),
      features: body.features ?? null,
    });

    return NextResponse.json({
      ok: true,
      stage: "feature_snapshot_preview",
      analyzerVersion: "phase15-f-feature-snapshot-builder-v1",
      snapshot,
      message:
        "Feature Snapshot Builderで保存予定の特徴量をプレビューしました。",
    });
  } catch (error: any) {
    console.error(error);

    return NextResponse.json(
      {
        ok: false,
        stage: "feature_snapshot_preview_error",
        analyzerVersion: "phase15-f-feature-snapshot-builder-v1",
        error: error?.message ?? "Feature Snapshot previewに失敗しました",
      },
      { status: 500 }
    );
  }
}
