import { NextRequest, NextResponse } from "next/server";
import {
  getForwardValidationSummary,
  recordAndSettleForwardValidation,
  recordForwardValidationCandidate,
  settleForwardValidationCandidates,
  type ForwardValidationInput,
} from "@/lib/learning/forwardValidationRecorder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function num(value: string | null, fallback: number) {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function optionalBooleanOrNumber(value: unknown): boolean | number | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function toDirection(value: unknown) {
  return value === "LOW" ? "LOW" : "HIGH";
}

function bodyToInput(body: Record<string, unknown>): ForwardValidationInput {
  const featureSnapshot =
    typeof body.featureSnapshot === "object" && body.featureSnapshot !== null && !Array.isArray(body.featureSnapshot)
      ? (body.featureSnapshot as Record<string, unknown>)
      : null;

  return {
    pair: optionalString(body.pair) ?? "Volatility 100 Index",
    sourceDirection: toDirection(body.sourceDirection ?? body.direction),
    entrySpot: optionalNumber(body.entrySpot ?? body.latestClose ?? body.currentSpot) ?? 0,
    observedAt: optionalNumber(body.observedAt ?? body.now) ?? undefined,
    durationMs: optionalNumber(body.durationMs) ?? undefined,
    score: optionalNumber(body.score),
    confidenceScore: optionalNumber(body.confidenceScore ?? body.confidence),
    similarityScore: optionalNumber(body.similarityScore ?? body.similarity),
    finalScore: optionalNumber(body.finalScore),
    weightScore: optionalNumber(body.weightScore),
    ema9: optionalNumber(body.ema9),
    ema21: optionalNumber(body.ema21),
    emaDiff: optionalNumber(body.emaDiff ?? body.ema_diff),
    rci9: optionalNumber(body.rci9),
    rci26: optionalNumber(body.rci26),
    rci52: optionalNumber(body.rci52),
    atr: optionalNumber(body.atr),
    trend: optionalString(body.trend),
    marketPhase: optionalString(body.marketPhase ?? body.market_phase),
    volatilityLevel: optionalString(body.volatilityLevel ?? body.volatility_level),
    session: optionalString(body.session),
    hour: optionalNumber(body.hour),
    weekday: optionalNumber(body.weekday),
    bos: optionalBooleanOrNumber(body.bos),
    choch: optionalBooleanOrNumber(body.choch),
    fvg: optionalBooleanOrNumber(body.fvg),
    orderBlock: optionalBooleanOrNumber(body.orderBlock ?? body.order_block),
    featureSnapshot,
    source: optionalString(body.source),
  };
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const summary = getForwardValidationSummary({
      limit: num(params.get("limit"), 50),
    });

    return NextResponse.json({
      ok: true,
      stage: "forward_validation_summary",
      analyzerVersion: "phase16-f-forward-validation-recorder-v1",
      result: summary,
      message: summary.message,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "forward_validation_summary_error",
        message: error instanceof Error ? error.message : "Forward Validation summaryで不明なエラーが発生しました。",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = optionalString(body.action) ?? "record_and_settle";

    if (action === "settle") {
      const pair = optionalString(body.pair) ?? "Volatility 100 Index";
      const currentSpot = optionalNumber(body.currentSpot ?? body.latestClose);
      if (currentSpot === null) {
        return NextResponse.json(
          {
            ok: false,
            stage: "forward_validation_settle_error",
            message: "currentSpot または latestClose が必要です。",
          },
          { status: 400 },
        );
      }

      const result = settleForwardValidationCandidates({
        pair,
        currentSpot,
        now: optionalNumber(body.now) ?? undefined,
      });

      return NextResponse.json({
        ok: result.ok,
        stage: "forward_validation_settle",
        analyzerVersion: "phase16-f-forward-validation-recorder-v1",
        result,
        message: result.message,
      });
    }

    const input = bodyToInput(body);

    if (action === "record") {
      const result = recordForwardValidationCandidate(input);
      return NextResponse.json({
        ok: result.ok,
        stage: "forward_validation_record",
        analyzerVersion: "phase16-f-forward-validation-recorder-v1",
        result,
        message: result.message,
      });
    }

    const result = recordAndSettleForwardValidation({
      ...input,
      currentSpot: optionalNumber(body.currentSpot ?? body.latestClose),
    });

    return NextResponse.json({
      ok: result.ok,
      stage: "forward_validation_record_and_settle",
      analyzerVersion: "phase16-f-forward-validation-recorder-v1",
      result,
      message: "Forward Validationの保存/確定を実行しました。実際のDeriv Buyは行っていません。",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "forward_validation_error",
        message: error instanceof Error ? error.message : "Forward Validationで不明なエラーが発生しました。",
      },
      { status: 500 },
    );
  }
}
