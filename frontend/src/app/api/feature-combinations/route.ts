import { NextRequest, NextResponse } from "next/server";
import { exploreFeatureCombinations } from "@/lib/learning/featureCombinationExplorer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const result = exploreFeatureCombinations({
      minSample: Number(url.searchParams.get("minSample") ?? 8),
      strongMinSample: Number(url.searchParams.get("strongMinSample") ?? 30),
      weakMinSample: Number(url.searchParams.get("weakMinSample") ?? 12),
      maxCombinationSize: Number(url.searchParams.get("maxCombinationSize") ?? 3) as 2 | 3 | 4,
      limit: Number(url.searchParams.get("limit") ?? 20),
      includeUnknown: url.searchParams.get("includeUnknown") === "true",
    });

    return NextResponse.json({
      ok: true,
      stage: "feature_combination_explorer",
      analyzerVersion: "phase15-f-step3-a2",
      result,
      message: "特徴量の組み合わせ勝率ランキングを作成しました。まだTrading Engineには接続していません。",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    return NextResponse.json(
      {
        ok: false,
        stage: "feature_combination_explorer_error",
        message,
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = exploreFeatureCombinations(body ?? {});

    return NextResponse.json({
      ok: true,
      stage: "feature_combination_explorer",
      analyzerVersion: "phase15-f-step3-a2",
      result,
      message: "特徴量の組み合わせ勝率ランキングを作成しました。まだTrading Engineには接続していません。",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    return NextResponse.json(
      {
        ok: false,
        stage: "feature_combination_explorer_error",
        message,
      },
      { status: 500 }
    );
  }
}
