import { NextResponse } from "next/server";
import { getServerAutoRunnerStatus } from "@/lib/serverAutoRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      stage: "auto_runner_status",
      status: getServerAutoRunnerStatus(),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        stage: "auto_runner_status_error",
        error: error?.message ?? "Auto Runner status error",
      },
      { status: 500 }
    );
  }
}