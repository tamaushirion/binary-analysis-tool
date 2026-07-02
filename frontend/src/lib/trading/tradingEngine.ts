import { executeDemoTrade } from "@/lib/deriv/demoTrade";
import { monitorDerivContract } from "@/lib/deriv/contractMonitor";
import {
  saveTradeHistory,
  type TradeFeatureSnapshot,
} from "@/lib/db/tradeRepository";
import { applyWeightLearning } from "@/lib/learning/weightLearning";
import { applySimilarityLearning } from "@/lib/learning/similarityLearning";
import { calculateConfidence } from "@/lib/learning/confidenceEngine";
import {
  createTradeResultLineText,
  sendLinePushMessage,
} from "../line/lineClient";
import { applyEntryGate } from "@/lib/learning/entryGate";
import { applyEmpiricalEntryGate } from "@/lib/learning/empiricalEntryGate";
import {
  getDemo100Status,
  notifyDemo100CompletedIfNeeded,
} from "@/lib/demo100Mode";

export type TradingEngineInput = {
  accountId: string;
  pair: string;
  direction: "HIGH" | "LOW";
  score: number;
  amount?: number;
  duration?: number;
  durationUnit?: "s" | "m" | "h" | "d";
  currency?: string;
  minScore?: number;
  minPayoutRate?: number;
  minConfidence?: number;
  features?: TradeFeatureSnapshot | null;

  /**
   * Phase15-E検証専用。
   * true の時だけ Demo100 completed 停止と通常Gate停止を通過して、
   * Empirical Entry Gate の判定まで確認できる。
   * 通常運用・Auto Runnerでは指定しない。
   */
  debugBypassDemo100Completed?: boolean;
};

function durationToMs(duration: number, unit: "s" | "m" | "h" | "d") {
  if (unit === "s") return duration * 1000;
  if (unit === "m") return duration * 60 * 1000;
  if (unit === "h") return duration * 60 * 60 * 1000;
  if (unit === "d") return duration * 24 * 60 * 60 * 1000;
  return duration * 60 * 1000;
}

function getColdStartMinConfidence(params: {
  requestedMinConfidence: number;
  demo100CurrentCount: number;
  demo100Completed: boolean;
}) {
  if (params.demo100Completed) return params.requestedMinConfidence;
  if (params.demo100CurrentCount >= 100) return params.requestedMinConfidence;

  return Math.min(params.requestedMinConfidence, 35);
}

function relaxEntryGateForColdStart(params: {
  coldStartEnabled: boolean;
  gate: ReturnType<typeof applyEntryGate>;
  confidence: number;
  finalScore: number;
}) {
  if (!params.coldStartEnabled) return params.gate;
  if (params.gate.allow) return params.gate;

  const dangerousReasons = ["ATR異常", "危険", "急変動", "ボラ異常"];

  const hasDangerousReason = params.gate.reasons.some((reason) =>
    dangerousReasons.some((danger) => reason.includes(danger))
  );

  if (hasDangerousReason) return params.gate;

  const canRelax =
    params.confidence >= 35 &&
    params.finalScore >= 75 &&
    params.gate.reasons.every(
      (reason) =>
        ["Confidence不足", "SMC不足", "1分Backtest弱い"].some((allowed) =>
          reason.includes(allowed)
        ) || reason.includes("OK")
    );

  if (!canRelax) return params.gate;

  return {
    ...params.gate,
    allow: true,
    reasons: [
      ...params.gate.reasons,
      "Cold Start Demo Mode: 100件収集のためEntry Gateを一時緩和",
    ],
  };
}

function bypassEntryGateForVerification(params: {
  verificationEnabled: boolean;
  gate: ReturnType<typeof applyEntryGate>;
}) {
  if (!params.verificationEnabled) return params.gate;
  if (params.gate.allow) return params.gate;

  return {
    ...params.gate,
    allow: true,
    reasons: [
      ...params.gate.reasons,
      "Verification Mode: Empirical Entry Gate確認のため通常Entry Gateを一時バイパス",
    ],
  };
}

export async function executeDemoTradingEngine(input: TradingEngineInput) {
  const demo100Before = getDemo100Status();
  const debugBypassDemo100Completed =
    input.debugBypassDemo100Completed === true;

  if (demo100Before.completed && !debugBypassDemo100Completed) {
    return {
      ok: true,
      stage: "engine_stopped_by_demo_100_completed",
      demo100: demo100Before,
      message:
        "100件デモ運用が完了済みのため、自動エントリーを停止しました。Phase15のAI分析に進んでください。",
    };
  }

  const duration = Number(input.duration ?? 5);
  const durationUnit = input.durationUnit ?? "m";

  const requestedMinConfidence = input.minConfidence ?? 75;

  const effectiveMinConfidence = getColdStartMinConfidence({
    requestedMinConfidence,
    demo100CurrentCount: demo100Before.currentCount,
    demo100Completed: demo100Before.completed,
  });

  const coldStartDemoMode = {
    enabled:
      !demo100Before.completed &&
      demo100Before.currentCount < demo100Before.targetTrades,
    reason:
      demo100Before.currentCount < demo100Before.targetTrades
        ? "100件デモ学習中のため、デモ口座限定でConfidence基準を緩和"
        : "100件完了済みのため通常基準",
    requestedMinConfidence,
    effectiveMinConfidence,
    currentCount: demo100Before.currentCount,
    targetTrades: demo100Before.targetTrades,
  };

  const verificationMode = {
    enabled: debugBypassDemo100Completed,
    reason: debugBypassDemo100Completed
      ? "Phase15-E検証用: Demo100完了停止・通常Entry Gate停止を一時バイパス"
      : "通常運用",
  };

  const learning = applyWeightLearning({
    pair: input.pair,
    direction: input.direction,
    score: input.score,
    payoutRate: null,
  });

  const similarity = applySimilarityLearning({
    pair: input.pair,
    direction: input.direction,
    score: learning.adjustedScore,
    payoutRate: null,
    features: input.features ?? null,
  });

  const confidence = calculateConfidence({
    baseScore: input.score,
    weightAdjustedScore: learning.adjustedScore,
    similarity,
    minConfidence: effectiveMinConfidence,
  });

  const similarityFinalScore = similarity.adjustedScore;

  const shouldSkipByConfidence =
    !confidence.trade &&
    !coldStartDemoMode.enabled &&
    !verificationMode.enabled;

  if (shouldSkipByConfidence) {
    return {
      ok: true,
      stage: "engine_skipped_by_confidence",
      demo100: demo100Before,
      coldStartDemoMode,
      verificationMode,
      learning,
      similarity,
      confidence,
      finalScore: similarityFinalScore,
      message: `Confidence不足のため見送り: ${confidence.confidence}/${confidence.minConfidence}`,
    };
  }

  const rawGate = applyEntryGate({
    confidence: confidence.confidence,
    similarityScore: similarity.adjustedScore,
    weightScore: learning.adjustedScore,
    smcScore: Number(input.features?.smcScore ?? 0),
    atr: Number(input.features?.atr ?? 0),
    atrThreshold: Number(input.features?.atrThreshold ?? 0),
    backtestWinRate1m: Number(input.features?.backtestWinRate1m ?? 0),
  });

  const coldStartGate = relaxEntryGateForColdStart({
    coldStartEnabled: coldStartDemoMode.enabled,
    gate: rawGate,
    confidence: confidence.confidence,
    finalScore: similarityFinalScore,
  });

  const gate = bypassEntryGateForVerification({
    verificationEnabled: verificationMode.enabled,
    gate: coldStartGate,
  });

  const shouldSkipByGate =
    !gate.allow &&
    !coldStartDemoMode.enabled &&
    !verificationMode.enabled;

  if (shouldSkipByGate) {
    return {
      ok: true,
      stage: "engine_skipped_by_entry_gate",
      demo100: demo100Before,
      coldStartDemoMode,
      verificationMode,
      learning,
      similarity,
      confidence,
      entryGate: gate,
      finalScore: similarityFinalScore,
      message: `Entry Gate: ${gate.reasons.join(" / ")}`,
    };
  }

  const empiricalGate = applyEmpiricalEntryGate({
    pair: input.pair,
    direction: input.direction,
    score: input.score,
    finalScore: similarityFinalScore,
    minTrades: 10,
    minWinRate: 57,
  });

  const finalScore = empiricalGate.adjustedScore;

  const shouldSkipByEmpiricalGate =
    !empiricalGate.allow && !coldStartDemoMode.enabled;

  if (shouldSkipByEmpiricalGate) {
    return {
      ok: true,
      stage: "engine_skipped_by_empirical_entry_gate",
      demo100: demo100Before,
      coldStartDemoMode,
      verificationMode,
      learning,
      similarity,
      confidence,
      entryGate: gate,
      empiricalEntryGate: empiricalGate,
      finalScore,
      message: `Empirical Entry Gate: ${empiricalGate.reasons.join(" / ")}`,
    };
  }

  const demoTrade = await executeDemoTrade({
    accountId: input.accountId,
    pair: input.pair,
    direction: input.direction,
    score: finalScore,
    amount: input.amount ?? 1,
    duration,
    durationUnit,
    currency: input.currency ?? "USD",
    minScore: coldStartDemoMode.enabled ? 35 : input.minScore ?? 80,
    minPayoutRate: input.minPayoutRate ?? 1.8,
  });

  if (demoTrade.stage !== "demo_trade_executed") {
    return {
      ok: true,
      stage: "engine_skipped",
      demo100: demo100Before,
      coldStartDemoMode,
      verificationMode,
      learning,
      similarity,
      confidence,
      entryGate: gate,
      empiricalEntryGate: empiricalGate,
      finalScore,
      demoTrade,
      message: "Final Decision が SKIP のため監視・保存しませんでした",
    };
  }

  const contractId = demoTrade.buy?.contractId;

  if (!contractId) {
    return {
      ok: false,
      stage: "engine_error",
      demo100: demo100Before,
      coldStartDemoMode,
      verificationMode,
      learning,
      similarity,
      confidence,
      entryGate: gate,
      empiricalEntryGate: empiricalGate,
      finalScore,
      demoTrade,
      error: "contractId が取得できませんでした",
    };
  }

  const maxWaitMs = durationToMs(duration, durationUnit) + 180_000;

  const monitor = await monitorDerivContract({
    accountId: input.accountId,
    contractId,
    maxWaitMs,
    intervalMs: 5_000,
  });

  let savedTrade = null;
  let demo100Notify = null;
  let demo100After = demo100Before;

  if (monitor.ok && monitor.stage === "contract_closed") {
    savedTrade = saveTradeHistory({
      contractId: monitor.contractId,
      proposalId: demoTrade.proposal?.proposalId ?? null,
      pair: input.pair,
      direction: input.direction,
      score: finalScore,
      payoutRate: demoTrade.proposal?.payoutRate ?? null,
      buyPrice: monitor.buyPrice,
      payout: monitor.payout,
      profit: monitor.profit,
      status: monitor.status,
      entrySpot: monitor.entrySpot,
      exitSpot: monitor.exitSpot,
      startTime: monitor.startTime,
      endTime: monitor.endTime,
      features: {
        ...(input.features ?? {}),
        aiScore: input.score,
        weightScore: learning.adjustedScore,
        similarityScore: similarity.adjustedScore,
        finalScore,
        entryGate: gate.allow,
        entryGateScore: gate.score,
        entryGateReasons: gate.reasons,
        empiricalEntryGate: empiricalGate.allow,
        empiricalEntryGateScore: empiricalGate.score,
        empiricalEntryGateBand: empiricalGate.scoreBand,
        empiricalEntryGateWinRate: empiricalGate.winRate,
        empiricalEntryGateSampleSize: empiricalGate.sampleSize,
        empiricalEntryGateAdjustment: empiricalGate.adjustment,
        empiricalEntryGateReasons: empiricalGate.reasons,
        coldStartDemoMode: coldStartDemoMode.enabled,
        verificationMode: verificationMode.enabled,
        effectiveMinConfidence,
      },
    });

    demo100Notify = await notifyDemo100CompletedIfNeeded();
    demo100After = getDemo100Status();
  }

  await sendLinePushMessage({
    text: createTradeResultLineText({
      pair: input.pair,
      direction: input.direction,
      status: monitor.status,
      buyPrice: monitor.buyPrice,
      profit: monitor.profit,
      finalScore,
      confidence: confidence.confidence,
      entryGate: gate,
    }),
  });

  return {
    ok: monitor.ok,
    stage: monitor.ok ? "engine_completed" : "engine_monitor_failed",
    demo100: demo100After,
    coldStartDemoMode,
    verificationMode,
    learning,
    similarity,
    confidence,
    entryGate: gate,
    empiricalEntryGate: empiricalGate,
    finalScore,
    demoTrade,
    monitor,
    savedTrade,
    demo100Notify,
    monitorConfig: {
      duration,
      durationUnit,
      maxWaitMs,
      intervalMs: 5_000,
    },
    message: monitor.ok
      ? "Weight → Similarity → Confidence → Entry Gate → Empirical Entry Gate → Demo Buy → Contract監視 → SQLite保存 → Demo100確認 完了"
      : "Demo Buy は成功しましたが Contract監視が完了しませんでした",
  };
}
