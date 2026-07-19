import { NextRequest, NextResponse } from "next/server";
import { getEdgeCandidates } from "@/lib/learning/edgeCandidateTracker";

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
    const result = getEdgeCandidates({
      minSample: numberParam(params.get("minSample"), 5),
      watchMinSample: numberParam(params.get("watchMinSample"), 15),
      adoptMinSample: numberParam(params.get("adoptMinSample"), 50),
      watchEffectiveWinRate: numberParam(params.get("watchEffectiveWinRate"), 65),
      adoptEffectiveWinRate: numberParam(params.get("adoptEffectiveWinRate"), 70),
      neutralEdgeThreshold: numberParam(params.get("neutralEdgeThreshold"), 10),
      limit: numberParam(params.get("limit"), 100),
      includeUnknown: booleanParam(params.get("includeUnknown"), false),
      includeBlock: booleanParam(params.get("includeBlock"), false),
    });

    return NextResponse.json({
      ok: true,
      stage: "edge_candidate_tracker",
      analyzerVersion: "phase16-d-edge-candidate-tracker-v1",
      result,
      message: result.message,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "edge_candidate_tracker_error",
        message: error instanceof Error ? error.message : "Edge Candidate Trackerで不明なエラーが発生しました。",
      },
      { status: 500 },
    );
  }
}
