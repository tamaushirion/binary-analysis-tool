import { CURRENT_AI_VERSION } from "@/lib/versioning/aiVersion";
import { executeDemoTrade } from "@/lib/deriv/demoTrade";
import { monitorDerivContract } from "@/lib/deriv/contractMonitor";
import {
  saveTradeHistory,
  type TradeFeatureSnapshot,
} from "@/lib/db/tradeRepository";
import { applyWeightLearning } from "@/lib/learning/weightLearning";
import { applySimilarityLearning } from "@/lib/learning/similarityLearning";
import { evaluateEntry } from "@/lib/entry/evaluateEntry";
import {
  createTradeResultLineText,
  sendLinePushMessage,
} from "../line/lineClient";
import {
  getDemo100Status,
  notifyDemo100CompletedIfNeeded,
} from "@/lib/demo100Mode";
import { buildFeatureSnapshot } from "@/lib/analysis/featureSnapshotBuilder";
import { recordEntryFunnelEvent } from "@/lib/learning/entryFunnelStore";
import type { Demo2RobustCandidateMatch } from "@/lib/learning/demo2RobustCandidateGate";
import { updateDemo2ShadowOverrideRun } from "@/lib/entry/demo2ShadowOverrideStore";

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
   * Phase15-E/F検証専用。
   * true の時だけ Demo100 completed 停止と通常Gate停止を通過して、
   * Empirical Entry Gate / Feature Snapshot保存の確認まで進める。
   * 通常運用・Auto Runnerでは指定しない。
   */
  debugBypassDemo100Completed?: boolean;

  /** Demo Part2限定。承認済みRobust候補一致時だけ通常のSoft Gateを限定的に通過する。 */
  demoPart2RobustCandidate?: Demo2RobustCandidateMatch | null;
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
      ? "Phase15-F検証用: Demo100完了停止・通常Entry Gate停止を一時バイパス"
      : "通常運用",
  };

  const effectiveDirection: "HIGH" | "LOW" = input.demoPart2RobustCandidate?.enabled === true ? input.demoPart2RobustCandidate.direction : input.direction;

  const robustDemo2Mode = {
    enabled: input.demoPart2RobustCandidate?.enabled === true,
    candidate: input.demoPart2RobustCandidate ?? null,
    reason:
      input.demoPart2RobustCandidate?.enabled === true
        ? `Demo Part2 Robust候補: ${input.demoPart2RobustCandidate.candidateName}`
        : "通常Gate判定",
  };

  const robustPipeline = {
    enabled: robustDemo2Mode.enabled,
    effectiveDirection,
    originalDirection: input.direction,
    candidateId: robustDemo2Mode.candidate?.candidateId ?? null,
    candidateName: robustDemo2Mode.candidate?.candidateName ?? null,
    policy: robustDemo2Mode.enabled ? "Robust候補専用Pipeline" : "通常Pipeline",
  };

  recordEntryFunnelEvent({
    stage: "engine_started",
    aiVersion: CURRENT_AI_VERSION,
    pair: input.pair,
    direction: effectiveDirection,
    inputScore: input.score,
    reason: "Trading Engineに到達した候補を記録",
  });

  const learning = applyWeightLearning({
    pair: input.pair,
    direction: effectiveDirection,
    score: input.score,
    payoutRate: null,
  });

  const similarity = applySimilarityLearning({
    pair: input.pair,
    direction: effectiveDirection,
    score: learning.adjustedScore,
    payoutRate: null,
    features: input.features ?? null,
  });

  const entry = evaluateEntry({
    pair: input.pair,
    direction: effectiveDirection,
    score: input.score,
    features: input.features,
    learning,
    similarity,
    minConfidence: effectiveMinConfidence,
    coldStartEnabled: coldStartDemoMode.enabled,
    verificationEnabled: verificationMode.enabled,
    robustCandidate: robustDemo2Mode.candidate,
    aiVersion: CURRENT_AI_VERSION,
  });

  if (!entry.allow) {
    if (entry.shadowGateOverride) {
      updateDemo2ShadowOverrideRun({
        overrideRunId: entry.shadowGateOverride.overrideRunId,
        status: "POST_GATE_REJECTED",
        detail: {
          rejectStage: entry.rejectStage,
          reason: entry.reason,
        },
      });
    }
    recordEntryFunnelEvent({
      stage: entry.rejectStage,
      aiVersion: CURRENT_AI_VERSION,
      pair: input.pair,
      direction: effectiveDirection,
      inputScore: input.score,
      finalScore: entry.finalScore,
      confidence: entry.confidence.confidence,
      featureGateAllow: entry.featureWinRateGate?.allow,
      patternWeightAllow: entry.patternWeight?.allow,
      hasFeatureHardGate: entry.hasFeatureHardGate,
      hasPatternHardGate: entry.hasPatternHardGate,
      reason: entry.reason,
      details: {
        entryGate: entry.entryGate,
        empiricalEntryGate: entry.empiricalEntryGate,
        featureWinRateGate: entry.featureWinRateGate,
        patternWeight: entry.patternWeight,
        robustHardGatePolicy: entry.robustHardGatePolicy,
      },
    });

    return {
      ok: true,
      stage: entry.rejectStage,
      demo100: demo100Before,
      coldStartDemoMode,
      verificationMode,
      robustDemo2Mode,
      aiVersion: CURRENT_AI_VERSION,
      learning,
      similarity,
      confidence: entry.confidence,
      entryGate: entry.entryGate,
      empiricalEntryGate: entry.empiricalEntryGate,
      featureWinRateGate: entry.featureWinRateGate,
      patternWeight: entry.patternWeight,
      robustHardGatePolicy: entry.robustHardGatePolicy,
      featureSnapshot: entry.featureSnapshot,
      finalScore: entry.finalScore,
      message: entry.message,
      shadowGateOverride: entry.shadowGateOverride,
    };
  }

  const {
    confidence,
    entryGate: gate,
    empiricalEntryGate: empiricalGate,
    featureWinRateGate: featureGate,
    patternWeight,
    robustHardGatePolicy,
    finalScore,
    shadowGateOverride,
  } = entry;
  const empiricalScore = empiricalGate.adjustedScore;

  const snapshot = buildFeatureSnapshot({
    pair: input.pair,
    direction: effectiveDirection,
    score: input.score,
    weightScore: learning.adjustedScore,
    similarityScore: similarity.adjustedScore,
    finalScore,
    features: {
      ...(input.features ?? {}),
      aiScore: input.score,
      weightScore: learning.adjustedScore,
      similarityScore: similarity.adjustedScore,
      empiricalScore,
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
      featureWinRateGate: featureGate.allow,
      featureWinRateGateOriginalScore: featureGate.originalScore,
      featureWinRateGateAdjustedScore: featureGate.adjustedScore,
      featureWinRateGateTotalAdjustment: featureGate.totalAdjustment,
      featureWinRateGateApplied: featureGate.applied,
      featureWinRateGateReasons: featureGate.reasons,
      patternWeightGate: patternWeight.allow,
      patternWeightOriginalScore: patternWeight.originalScore,
      patternWeightAdjustedScore: patternWeight.adjustedScore,
      patternWeightTotalAdjustment: patternWeight.totalAdjustment,
      patternWeightApplied: patternWeight.applied,
      patternWeightSignals: patternWeight.signals,
      patternWeightReasons: patternWeight.reasons,
      robustHardGatePolicy,
      aiVersion: CURRENT_AI_VERSION,
      coldStartDemoMode: coldStartDemoMode.enabled,
      verificationMode: verificationMode.enabled,
      robustDemo2Mode: robustDemo2Mode.enabled,
      robustDemo2Candidate: robustDemo2Mode.candidate,
      robustPipeline,
      shadowGateOverride,
      effectiveMinConfidence,
      source: "trading_engine_phase15_l_ai_version_save",
    },
  });

  const demoTrade = await executeDemoTrade({
    accountId: input.accountId,
    pair: input.pair,
    direction: effectiveDirection,
    score: finalScore,
    amount: input.amount ?? 1,
    duration,
    durationUnit,
    currency: input.currency ?? "USD",
    minScore: robustDemo2Mode.enabled || shadowGateOverride
      ? 40
      : coldStartDemoMode.enabled
        ? 35
        : input.minScore ?? 80,
    minPayoutRate: input.minPayoutRate ?? 1.8,
  });

  if (demoTrade.stage !== "demo_trade_executed") {
    if (shadowGateOverride) {
      updateDemo2ShadowOverrideRun({
        overrideRunId: shadowGateOverride.overrideRunId,
        status: "FINAL_SKIPPED",
        detail: {
          demoTradeStage: demoTrade.stage,
          finalDecision: demoTrade.finalDecision,
        },
      });
    }
    recordEntryFunnelEvent({
      stage: "engine_skipped_by_final_decision",
      aiVersion: CURRENT_AI_VERSION,
      pair: input.pair,
      direction: effectiveDirection,
      inputScore: input.score,
      finalScore,
      confidence: confidence.confidence,
      featureGateAllow: featureGate.allow,
      patternWeightAllow: patternWeight.allow,
      reason: demoTrade?.finalDecision?.reasons?.join(" / ") ?? "Final Decision がSKIP",
      details: { demoTrade },
    });

    return {
      ok: true,
      stage: "engine_skipped",
      demo100: demo100Before,
      coldStartDemoMode,
      verificationMode,
      robustDemo2Mode,
      learning,
      similarity,
      confidence,
      entryGate: gate,
      empiricalEntryGate: empiricalGate,
      featureWinRateGate: featureGate,
      patternWeight,
      featureSnapshot: snapshot,
      finalScore,
      demoTrade,
      message: "Final Decision が SKIP のため監視・保存しませんでした",
      shadowGateOverride,
    };
  }

  const contractId = demoTrade.buy?.contractId;

  if (!contractId) {
    if (shadowGateOverride) {
      updateDemo2ShadowOverrideRun({
        overrideRunId: shadowGateOverride.overrideRunId,
        status: "MONITOR_FAILED",
        detail: { reason: "contractIdが取得できませんでした" },
      });
    }
    recordEntryFunnelEvent({
      stage: "engine_error",
      aiVersion: CURRENT_AI_VERSION,
      pair: input.pair,
      direction: effectiveDirection,
      inputScore: input.score,
      finalScore,
      confidence: confidence.confidence,
      reason: "contractId が取得できませんでした",
    });

    return {
      ok: false,
      stage: "engine_error",
      demo100: demo100Before,
      coldStartDemoMode,
      verificationMode,
      robustDemo2Mode,
      learning,
      similarity,
      confidence,
      entryGate: gate,
      empiricalEntryGate: empiricalGate,
      featureWinRateGate: featureGate,
      patternWeight,
      featureSnapshot: snapshot,
      finalScore,
      demoTrade,
      error: "contractId が取得できませんでした",
    };
  }

  if (shadowGateOverride) {
    updateDemo2ShadowOverrideRun({
      overrideRunId: shadowGateOverride.overrideRunId,
      status: "BUY_EXECUTED",
      contractId,
    });
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
      direction: effectiveDirection,
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
      features: snapshot,
      aiVersion: CURRENT_AI_VERSION,
    });

    demo100Notify = await notifyDemo100CompletedIfNeeded();
    demo100After = getDemo100Status();

    if (shadowGateOverride) {
      updateDemo2ShadowOverrideRun({
        overrideRunId: shadowGateOverride.overrideRunId,
        status: "SETTLED",
        contractId: monitor.contractId,
        tradeStatus: monitor.status,
        profit: monitor.profit,
      });
    }
  } else if (shadowGateOverride) {
    updateDemo2ShadowOverrideRun({
      overrideRunId: shadowGateOverride.overrideRunId,
      status: "MONITOR_FAILED",
      contractId,
      tradeStatus: monitor.status,
      profit: monitor.profit,
      detail: { monitorStage: monitor.stage },
    });
  }

  const fallbackBuyPrice =
    monitor.buyPrice ??
    demoTrade.buy?.buy?.buy_price ??
    (demoTrade.buy as any)?.buyPrice ??
    input.amount ??
    null;

  if (monitor.ok && monitor.stage === "contract_closed") {
    await sendLinePushMessage({
      text: createTradeResultLineText({
        pair: input.pair,
        direction: effectiveDirection,
        status: monitor.status,
        buyPrice: fallbackBuyPrice,
        profit: monitor.profit,
        finalScore,
        confidence: confidence.confidence,
        entryGate: gate,
      }),
    });
  } else {
    await sendLinePushMessage({
      text:
        "⚠️ Binary Analysis AI 監視未完了\n" +
        `通貨ペア: ${input.pair}\n` +
        `方向: ${input.direction}\n` +
        `掛け金: ${fallbackBuyPrice ?? "不明"}\n` +
        `Score: ${finalScore}\n` +
        `Confidence: ${confidence.confidence}%\n` +
        `Stage: ${monitor.stage}\n` +
        `Status: ${monitor.status ?? "UNKNOWN"}\n` +
        `理由: ${(monitor as any).error ?? "Contract Monitor timeout"}\n` +
        "Demo Buy は成功していますが、勝敗確定の取得が完了していません。通常の勝敗通知・SQLite保存はスキップしました。",
    });
  }

  recordEntryFunnelEvent({
    stage: monitor.ok ? "engine_completed" : "engine_monitor_failed",
    aiVersion: CURRENT_AI_VERSION,
    pair: input.pair,
    direction: effectiveDirection,
    inputScore: input.score,
    finalScore,
    confidence: confidence.confidence,
    featureGateAllow: featureGate.allow,
    patternWeightAllow: patternWeight.allow,
    reason: monitor.ok ? "Contract監視とSQLite保存が完了" : (monitor as any).error ?? "Contract監視未完了",
    details: { monitorStage: monitor.stage, status: monitor.status, profit: monitor.profit },
  });

  return {
    ok: monitor.ok,
    stage: monitor.ok ? "engine_completed" : "engine_monitor_failed",
    demo100: demo100After,
    coldStartDemoMode,
    verificationMode,
    robustDemo2Mode,
    robustPipeline,
    learning,
    similarity,
    confidence,
    entryGate: gate,
    empiricalEntryGate: empiricalGate,
    featureWinRateGate: featureGate,
    patternWeight,
    robustHardGatePolicy,
    shadowGateOverride,
    featureSnapshot: snapshot,
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
    aiVersion: CURRENT_AI_VERSION,
    message: monitor.ok
      ? "Weight → Similarity → Confidence → Entry Gate → Empirical Entry Gate → Feature WinRate Gate → Pattern Weight → Feature Snapshot → Demo Buy → Contract監視 → SQLite保存 → AI Version保存 → Demo Part2確認 完了"
      : "Demo Buy は成功しましたが Contract監視が完了しませんでした",
  };
}
