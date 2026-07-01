import { NextResponse } from "next/server";
import { stopServerAutoRunner } from "@/lib/serverAutoRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = stopServerAutoRunner("manual_stop");
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        stage: "auto_runner_stop_error",
        error: error?.message ?? "Auto Runner stop error",
      },
      { status: 500 }
    );
  }
}