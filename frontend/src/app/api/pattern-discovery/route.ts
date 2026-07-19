import { NextResponse } from "next/server";
import { discoverPatterns } from "@/lib/learning/patternDiscovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const result = discoverPatterns();

    return NextResponse.json({
      ok: true,
      stage: "pattern_discovery",
      analyzerVersion: "phase16-a-pattern-discovery-v2",
      result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "pattern_discovery_error",
        message: error instanceof Error ? error.message : "Pattern Discoveryで不明なエラーが発生しました。",
      },
      { status: 500 },
    );
  }
}
