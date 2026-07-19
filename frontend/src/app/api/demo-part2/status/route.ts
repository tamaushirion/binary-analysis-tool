import { NextResponse } from "next/server";
import { getDemoPart2Status } from "@/lib/demoPart2Status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = getDemoPart2Status();

    return NextResponse.json({
      ok: true,
      stage: "demo_part2_status",
      ...status,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        stage: "demo_part2_status_error",
        message: error?.message ?? "Demo Part2 status error",
      },
      { status: 500 },
    );
  }
}
