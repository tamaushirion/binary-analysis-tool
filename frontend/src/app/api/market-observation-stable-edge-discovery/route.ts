import { NextRequest, NextResponse } from "next/server";
import {
  discoverMarketObservationStableEdges,
  type MarketObservationStableEdgeOptions,
} from "../../../lib/learning/marketObservationStableEdgeDiscovery";

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

function combinationSize(value: unknown): 1 | 2 | 3 | undefined {
  return value === 1 || value === 2 || value === 3 ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unknown market observation stable edge discovery error";
}

function optionsFromBody(body: Record<string, unknown>): MarketObservationStableEdgeOptions {
  return {
    dbPath: typeof body.dbPath === "string" ? body.dbPath : undefined,
    featureVersion:
      typeof body.featureVersion === "string" ? body.featureVersion : undefined,
    minDecided: typeof body.minDecided === "number" ? body.minDecided : undefined,
    minFoldDecided:
      typeof body.minFoldDecided === "number" ? body.minFoldDecided : undefined,
    minOverallWinRate:
      typeof body.minOverallWinRate === "number"
        ? body.minOverallWinRate
        : undefined,
    minSegmentWinRate:
      typeof body.minSegmentWinRate === "number"
        ? body.minSegmentWinRate
        : undefined,
    persistentWinRate:
      typeof body.persistentWinRate === "number"
        ? body.persistentWinRate
        : undefined,
    minWilsonLowerBound:
      typeof body.minWilsonLowerBound === "number"
        ? body.minWilsonLowerBound
        : undefined,
    maxSegmentGap:
      typeof body.maxSegmentGap === "number" ? body.maxSegmentGap : undefined,
    recentWindow:
      typeof body.recentWindow === "number" ? body.recentWindow : undefined,
    maxCombinationSize: combinationSize(body.maxCombinationSize),
    dedupThreshold:
      typeof body.dedupThreshold === "number" ? body.dedupThreshold : undefined,
    maxHourDependency:
      typeof body.maxHourDependency === "number"
        ? body.maxHourDependency
        : undefined,
    maxDayDependency:
      typeof body.maxDayDependency === "number"
        ? body.maxDayDependency
        : undefined,
    limitPerRanking:
      typeof body.limitPerRanking === "number"
        ? body.limitPerRanking
        : undefined,
    includeWatch:
      typeof body.includeWatch === "boolean" ? body.includeWatch : undefined,
    includeUnstable:
      typeof body.includeUnstable === "boolean"
        ? body.includeUnstable
        : undefined,
    includeRejected:
      typeof body.includeRejected === "boolean"
        ? body.includeRejected
        : undefined,
  };
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const result = discoverMarketObservationStableEdges({
      dbPath: params.get("dbPath") ?? undefined,
      featureVersion: params.get("featureVersion") ?? undefined,
      minDecided: numberParam(params.get("minDecided")),
      minFoldDecided: numberParam(params.get("minFoldDecided")),
      minOverallWinRate: numberParam(params.get("minOverallWinRate")),
      minSegmentWinRate: numberParam(params.get("minSegmentWinRate")),
      persistentWinRate: numberParam(params.get("persistentWinRate")),
      minWilsonLowerBound: numberParam(params.get("minWilsonLowerBound")),
      maxSegmentGap: numberParam(params.get("maxSegmentGap")),
      recentWindow: numberParam(params.get("recentWindow")),
      maxCombinationSize: combinationSize(
        numberParam(params.get("maxCombinationSize")),
      ),
      dedupThreshold: numberParam(params.get("dedupThreshold")),
      maxHourDependency: numberParam(params.get("maxHourDependency")),
      maxDayDependency: numberParam(params.get("maxDayDependency")),
      limitPerRanking: numberParam(params.get("limitPerRanking")),
      includeWatch: booleanParam(params.get("includeWatch")),
      includeUnstable: booleanParam(params.get("includeUnstable")),
      includeRejected: booleanParam(params.get("includeRejected")),
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        stage: "market_observation_stable_edge_discovery_error",
        message: errorMessage(error),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const result = discoverMarketObservationStableEdges(optionsFromBody(body));
    return NextResponse.json(result);
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        stage: "market_observation_stable_edge_discovery_error",
        message: errorMessage(error),
      },
      { status: 500 },
    );
  }
}
