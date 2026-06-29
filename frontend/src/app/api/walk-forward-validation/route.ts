import { NextResponse } from "next/server";
import { runWalkForwardValidation } from "@/lib/learning/walkForwardValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = runWalkForwardValidation(1000);

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        stage: "walk_forward_validation_error",
        error: error?.message ?? "Walk Forward Validation API エラー",
      },
      { status: 500 }
    );
  }
}