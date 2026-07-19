import { NextRequest, NextResponse } from "next/server";
import { discoverMarketObservationRobustCandidates } from "@/lib/learning/marketObservationRobustCandidateDiscovery";

export const dynamic = "force-dynamic";

function numberParam(value: string | null): number | undefined {
  if (value === null || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanParam(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown robust candidate discovery error";
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const result = discoverMarketObservationRobustCandidates({
      featureVersion: params.get("featureVersion") ?? undefined,
      minTotalSample: numberParam(params.get("minTotalSample")),
      minFoldSample: numberParam(params.get("minFoldSample")),
      minFoldWinRate: numberParam(params.get("minFoldWinRate")),
      minOverallWinRate: numberParam(params.get("minOverallWinRate")),
      minWilsonLowerBound: numberParam(params.get("minWilsonLowerBound")),
      maxFoldGap: numberParam(params.get("maxFoldGap")),
      maxCombinationSize: numberParam(params.get("maxCombinationSize")) === 2 ? 2 : undefined,
      recentRatio: numberParam(params.get("recentRatio")),
      limit: numberParam(params.get("limit")),
      includeWatch: booleanParam(params.get("includeWatch")),
      includeRejected: booleanParam(params.get("includeRejected")),
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        stage: "market_observation_robust_candidate_discovery_error",
        message: errorMessage(error),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const result = discoverMarketObservationRobustCandidates({
      featureVersion: typeof body.featureVersion === "string" ? body.featureVersion : undefined,
      minTotalSample: typeof body.minTotalSample === "number" ? body.minTotalSample : undefined,
      minFoldSample: typeof body.minFoldSample === "number" ? body.minFoldSample : undefined,
      minFoldWinRate: typeof body.minFoldWinRate === "number" ? body.minFoldWinRate : undefined,
      minOverallWinRate: typeof body.minOverallWinRate === "number" ? body.minOverallWinRate : undefined,
      minWilsonLowerBound: typeof body.minWilsonLowerBound === "number" ? body.minWilsonLowerBound : undefined,
      maxFoldGap: typeof body.maxFoldGap === "number" ? body.maxFoldGap : undefined,
      maxCombinationSize: body.maxCombinationSize === 2 ? 2 : body.maxCombinationSize === 3 ? 3 : undefined,
      recentRatio: typeof body.recentRatio === "number" ? body.recentRatio : undefined,
      limit: typeof body.limit === "number" ? body.limit : undefined,
      includeWatch: typeof body.includeWatch === "boolean" ? body.includeWatch : undefined,
      includeRejected: typeof body.includeRejected === "boolean" ? body.includeRejected : undefined,
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        stage: "market_observation_robust_candidate_discovery_error",
        message: errorMessage(error),
      },
      { status: 500 },
    );
  }
}
