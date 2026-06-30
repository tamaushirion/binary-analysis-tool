import { NextResponse } from "next/server";
import { resetDemo100Run } from "@/lib/demo100Mode";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const status = resetDemo100Run();

    return NextResponse.json({
      ok: true,
      stage: "demo_100_reset",
      message: "100件デモ運用をリセットしました",
      status,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "demo_100_reset",
        message:
          error instanceof Error
            ? error.message
            : "Demo100 resetに失敗しました",
      },
      { status: 500 }
    );
  }
}