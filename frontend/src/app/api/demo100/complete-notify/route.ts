import { NextResponse } from "next/server";
import { notifyDemo100CompletedIfNeeded } from "@/lib/demo100Mode";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await notifyDemo100CompletedIfNeeded();

    return NextResponse.json({
      ok: true,
      stage: "demo_100_complete_notify",
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "demo_100_complete_notify",
        message:
          error instanceof Error
            ? error.message
            : "100件完了通知に失敗しました",
      },
      { status: 500 }
    );
  }
}