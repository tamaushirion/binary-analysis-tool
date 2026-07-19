import { NextRequest, NextResponse } from "next/server";
import { getForwardValidationDashboard } from "@/lib/learning/forwardValidationDashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function num(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const result = getForwardValidationDashboard({
      limit: num(params.get("limit"), 50),
      recentLimit: num(params.get("recentLimit"), 30),
      includePending: params.get("includePending") !== "false",
    });

    return NextResponse.json({
      ok: true,
      stage: "forward_validation_dashboard",
      analyzerVersion: "phase16-i-forward-validation-dashboard-v1",
      result,
      message: result.message,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "forward_validation_dashboard_error",
        analyzerVersion: "phase16-i-forward-validation-dashboard-v1",
        message: error instanceof Error ? error.message : "Forward Validation Dashboardで不明なエラーが発生しました。",
      },
      { status: 500 },
    );
  }
}
