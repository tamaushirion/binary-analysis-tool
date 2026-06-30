import { NextResponse } from "next/server";
import { getDemo100Status } from "@/lib/demo100Mode";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = getDemo100Status();

    return NextResponse.json({
      ok: true,
      stage: "demo_100_status",
      status,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "demo_100_status",
        message:
          error instanceof Error
            ? error.message
            : "Demo100 status取得に失敗しました",
      },
      { status: 500 }
    );
  }
}