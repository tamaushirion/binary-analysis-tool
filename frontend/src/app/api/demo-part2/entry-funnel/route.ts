import { NextRequest, NextResponse } from "next/server";
import {
  getEntryFunnelStatus,
  resetEntryFunnelStore,
} from "@/lib/learning/entryFunnelStore";

export async function GET(req: NextRequest) {
  try {
    const reset = req.nextUrl.searchParams.get("reset");

    if (reset === "1" || reset === "true") {
      const store = resetEntryFunnelStore();
      return NextResponse.json({
        ok: true,
        stage: "entry_funnel_reset",
        store,
      });
    }

    return NextResponse.json(getEntryFunnelStatus());
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        stage: "entry_funnel_status_error",
        error: error?.message ?? "Entry Funnel取得に失敗しました",
      },
      { status: 500 },
    );
  }
}
