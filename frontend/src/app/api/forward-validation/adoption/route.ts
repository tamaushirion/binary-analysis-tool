import { NextRequest, NextResponse } from "next/server";
import { evaluateForwardValidationAdoption } from "@/lib/learning/forwardValidationAdoption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function num(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const result = evaluateForwardValidationAdoption({
      watchMinSample: num(params.get("watchMinSample"), 30),
      stableMinSample: num(params.get("stableMinSample"), 50),
      matureMinSample: num(params.get("matureMinSample"), 100),
      stableWinRate: num(params.get("stableWinRate"), 70),
      watchWinRate: num(params.get("watchWinRate"), 60),
      rejectMaxSample: num(params.get("rejectMaxSample"), 30),
      rejectWinRate: num(params.get("rejectWinRate"), 50),
      minProfit: num(params.get("minProfit"), 0.01),
      minWilsonLowerBound: num(params.get("minWilsonLowerBound"), 55),
      limit: num(params.get("limit"), 100),
      includePending: bool(params.get("includePending"), true),
    });

    return NextResponse.json({
      ok: true,
      stage: "forward_validation_adoption",
      analyzerVersion: "phase16-j2-forward-validation-adoption-v2",
      result,
      message: result.message,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "forward_validation_adoption_error",
        analyzerVersion: "phase16-j2-forward-validation-adoption-v2",
        message: error instanceof Error ? error.message : "Forward Validation Adoptionで不明なエラーが発生しました。",
      },
      { status: 500 },
    );
  }
}
