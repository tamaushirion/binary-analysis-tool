import { NextResponse } from "next/server";
import { applyWeightLearning } from "@/lib/learning/weightLearning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const pair = body.pair ?? "Volatility 100 Index";
    const direction = body.direction ?? "HIGH";
    const score = Number(body.score ?? 85);

    if (direction !== "HIGH" && direction !== "LOW") {
      return NextResponse.json(
        {
          ok: false,
          stage: "weight_preview",
          error: "direction は HIGH または LOW を指定してください",
        },
        { status: 400 }
      );
    }

    const learning = applyWeightLearning({
      pair,
      direction,
      score,
      payoutRate: body.payoutRate ?? null,
      startTime: body.startTime ?? null,
    });

    return NextResponse.json({
      ok: true,
      stage: "weight_preview",
      learning,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        stage: "weight_preview",
        error: error?.message ?? "Weight Preview API エラー",
      },
      { status: 500 }
    );
  }
}