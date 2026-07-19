import { NextRequest, NextResponse } from "next/server";
import { runMarketObservationForwardValidation } from "@/lib/learning/marketObservationForwardValidation";

export const dynamic = "force-dynamic";

type ErrorResponse = {
  ok: false;
  stage: "market_observation_forward_validation_error";
  message: string;
};

function parseNumber(value: string | null): number | undefined {
  if (value === null || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unknown market observation forward validation error";
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const result = runMarketObservationForwardValidation({
      featureVersion: params.get("featureVersion") ?? undefined,
      minSample: parseNumber(params.get("minSample")),
      strongMinSample: parseNumber(params.get("strongMinSample")),
      recentWindow: parseNumber(params.get("recentWindow")),
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    const body: ErrorResponse = {
      ok: false,
      stage: "market_observation_forward_validation_error",
      message: errorMessage(error),
    };
    return NextResponse.json(body, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      featureVersion?: unknown;
      minSample?: unknown;
      strongMinSample?: unknown;
      recentWindow?: unknown;
    };
    const result = runMarketObservationForwardValidation({
      featureVersion: typeof body.featureVersion === "string" ? body.featureVersion : undefined,
      minSample: typeof body.minSample === "number" ? body.minSample : undefined,
      strongMinSample: typeof body.strongMinSample === "number" ? body.strongMinSample : undefined,
      recentWindow: typeof body.recentWindow === "number" ? body.recentWindow : undefined,
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    const response: ErrorResponse = {
      ok: false,
      stage: "market_observation_forward_validation_error",
      message: errorMessage(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
