import { NextRequest, NextResponse } from "next/server";
import {
  getDemo2RestartReadiness,
  restartDemo2AutoRunner,
} from "@/lib/serverAutoRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const CONFIRMATION = "RESTART_DEMO2";
const MIN_INTERVAL_MS = 75_000;

export async function GET() {
  try {
    return NextResponse.json(getDemo2RestartReadiness());
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        stage: "demo2_restart_readiness_error",
        error:
          error instanceof Error
            ? error.message
            : "Demo2 Restart確認で不明なエラーが発生しました",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      confirmation?: unknown;
      intervalMs?: unknown;
    };

    if (body.confirmation !== CONFIRMATION) {
      return NextResponse.json(
        {
          ok: false,
          stage: "demo2_restart_confirmation_required",
          restarted: false,
          error: `confirmation に ${CONFIRMATION} を指定してください`,
        },
        { status: 400 },
      );
    }

    const requestedInterval = Number(body.intervalMs ?? MIN_INTERVAL_MS);
    const intervalMs = Number.isFinite(requestedInterval)
      ? Math.max(requestedInterval, MIN_INTERVAL_MS)
      : MIN_INTERVAL_MS;

    return NextResponse.json(restartDemo2AutoRunner(intervalMs));
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        stage: "demo2_restart_error",
        restarted: false,
        error:
          error instanceof Error
            ? error.message
            : "Demo2 Restartで不明なエラーが発生しました",
      },
      { status: 500 },
    );
  }
}
