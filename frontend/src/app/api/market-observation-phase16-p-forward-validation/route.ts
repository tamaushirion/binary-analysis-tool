import { NextRequest, NextResponse } from "next/server";
import { runMarketObservationPhase16PForwardValidation } from "@/lib/learning/marketObservationPhase16PForwardValidation";

export const dynamic = "force-dynamic";

function numberParam(value: string | null): number | undefined {
  if (value === null || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Phase16-P forward validation error";
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const result = runMarketObservationPhase16PForwardValidation({
      featureVersion: params.get("featureVersion") ?? undefined,
      dedupThreshold: numberParam(params.get("dedupThreshold")),
      primaryMinSample: numberParam(params.get("primaryMinSample")),
      demoMinSample: numberParam(params.get("demoMinSample")),
      recentWindow: numberParam(params.get("recentWindow")),
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        stage: "market_observation_phase16_p_forward_validation_error",
        message: errorMessage(error),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const result = runMarketObservationPhase16PForwardValidation({
      featureVersion: typeof body.featureVersion === "string" ? body.featureVersion : undefined,
      dedupThreshold: typeof body.dedupThreshold === "number" ? body.dedupThreshold : undefined,
      primaryMinSample: typeof body.primaryMinSample === "number" ? body.primaryMinSample : undefined,
      demoMinSample: typeof body.demoMinSample === "number" ? body.demoMinSample : undefined,
      recentWindow: typeof body.recentWindow === "number" ? body.recentWindow : undefined,
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        stage: "market_observation_phase16_p_forward_validation_error",
        message: errorMessage(error),
      },
      { status: 500 },
    );
  }
}
