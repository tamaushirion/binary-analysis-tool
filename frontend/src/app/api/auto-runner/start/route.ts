import { NextResponse } from "next/server";
import { startServerAutoRunner } from "@/lib/serverAutoRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const intervalMs = Number(body.intervalMs ?? 75_000);

    const safeIntervalMs = Math.max(intervalMs, 75_000);

    const result = startServerAutoRunner(safeIntervalMs);

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        stage: "auto_runner_start_error",
        error: error?.message ?? "Auto Runner start error",
      },
      { status: 500 }
    );
  }
}