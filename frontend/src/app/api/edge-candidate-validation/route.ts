import { NextRequest, NextResponse } from "next/server";
import { validateEdgeCandidates } from "@/lib/learning/edgeCandidateValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function numberParam(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanParam(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  return value === "true";
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const result = validateEdgeCandidates({
      minSample: numberParam(params.get("minSample"), 5),
      watchMinSample: numberParam(params.get("watchMinSample"), 15),
      adoptMinSample: numberParam(params.get("adoptMinSample"), 50),
      watchEffectiveWinRate: numberParam(params.get("watchEffectiveWinRate"), 65),
      adoptEffectiveWinRate: numberParam(params.get("adoptEffectiveWinRate"), 70),
      neutralEdgeThreshold: numberParam(params.get("neutralEdgeThreshold"), 10),
      candidateLimit: numberParam(params.get("candidateLimit"), 150),
      limit: numberParam(params.get("limit"), 100),
      includeUnknown: booleanParam(params.get("includeUnknown"), false),
      includeDuplicates: booleanParam(params.get("includeDuplicates"), true),
      minValidationSample: numberParam(params.get("minValidationSample"), 30),
      minFoldSample: numberParam(params.get("minFoldSample"), 5),
      foldCount: numberParam(params.get("foldCount"), 3),
      minStableWinRate: numberParam(params.get("minStableWinRate"), 55),
      minWilsonLowerBound: numberParam(params.get("minWilsonLowerBound"), 45),
      overlapThreshold: numberParam(params.get("overlapThreshold"), 0.8),
    });

    return NextResponse.json({
      ok: true,
      stage: "edge_candidate_validation",
      analyzerVersion: "phase16-e-edge-candidate-validation-v1",
      result,
      message: result.message,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "edge_candidate_validation_error",
        message: error instanceof Error ? error.message : "Edge Candidate Validationで不明なエラーが発生しました。",
      },
      { status: 500 },
    );
  }
}
