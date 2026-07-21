import { NextResponse } from "next/server";
import { getDemo2ShadowOverrideSummary } from "@/lib/entry/demo2ShadowOverrideStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    return NextResponse.json(getDemo2ShadowOverrideSummary());
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        stage: "demo2_shadow_override_summary_error",
        error:
          error instanceof Error
            ? error.message
            : "Demo2 Shadow Override集計で不明なエラーが発生しました",
      },
      { status: 500 },
    );
  }
}
