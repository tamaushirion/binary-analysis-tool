import { CURRENT_AI_VERSION } from "@/lib/versioning/aiVersion";
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
import { previewFeatureWinRateGate } from "@/lib/learning/featureWinRateGate";
import { evaluatePatternWeight } from "@/lib/learning/patternWeightLearning";
import {
  getDemo100Status,
  notifyDemo100CompletedIfNeeded,
} from "@/lib/demo100Mode";
import { buildFeatureSnapshot } from "@/lib/analysis/featureSnapshotBuilder";
import { recordEntryFunnelEvent } from "@/lib/learning/entryFunnelStore";
import type { Demo2RobustCandidateMatch } from "@/lib/learning/demo2RobustCandidateGate";
import { evaluateRobustHardGatePolicy } from "@/lib/learning/robustHardGatePolicy";

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
    !verificationMode.enabled &&
    !robustDemo2Mode.enabled;

  if (shouldSkipByConfidence) {
    recordEntryFunnelEvent({
      stage: "engine_skipped_by_confidence",
      aiVersion: CURRENT_AI_VERSION,
      pair: input.pair,
      direction: effectiveDirection,
      inputScore: input.score,
      finalScore: similarityFinalScore,
      confidence: confidence.confidence,
      reason: `Confidence不足: ${confidence.confidence}/${confidence.minConfidence}`,
    });

    return {
      ok: true,
      stage: "engine_skipped_by_confidence",
      demo100: demo100Before,
      coldStartDemoMode,
      verificationMode,
      robustDemo2Mode,
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
    !verificationMode.enabled &&
    !robustDemo2Mode.enabled;

  if (shouldSkipByGate) {
    recordEntryFunnelEvent({
      stage: "engine_skipped_by_entry_gate",
      aiVersion: CURRENT_AI_VERSION,
      pair: input.pair,
      direction: effectiveDirection,
      inputScore: input.score,
      finalScore: similarityFinalScore,
      confidence: confidence.confidence,
      reason: gate.reasons.join(" / "),
      details: { entryGate: gate },
    });

    return {
      ok: true,
      stage: "engine_skipped_by_entry_gate",
      demo100: demo100Before,
      coldStartDemoMode,
      verificationMode,
      robustDemo2Mode,
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
    direction: effectiveDirection,
    score: input.score,
    finalScore: similarityFinalScore,
    minTrades: 10,
    minWinRate: 57,
  });

  const empiricalScore = empiricalGate.adjustedScore;

  const shouldSkipByEmpiricalGate =
    !empiricalGate.allow && !coldStartDemoMode.enabled && !robustDemo2Mode.enabled;

  if (shouldSkipByEmpiricalGate) {
    recordEntryFunnelEvent({
      stage: "engine_skipped_by_empirical_entry_gate",
      aiVersion: CURRENT_AI_VERSION,
      pair: input.pair,
      direction: effectiveDirection,
      inputScore: input.score,
      finalScore: empiricalScore,
      confidence: confidence.confidence,
      reason: empiricalGate.reasons.join(" / "),
      details: { empiricalEntryGate: empiricalGate },
    });

    return {
      ok: true,
      stage: "engine_skipped_by_empirical_entry_gate",
      demo100: demo100Before,
      coldStartDemoMode,
      verificationMode,
      robustDemo2Mode,
      learning,
      similarity,
      confidence,
      entryGate: gate,
      empiricalEntryGate: empiricalGate,
      finalScore: empiricalScore,
      message: `Empirical Entry Gate: ${empiricalGate.reasons.join(" / ")}`,
    };
  }

  // Phase15-N:
  // Danger Pattern Hard GateをFeature WinRate Gateへ接続。
  // Demo Part2中でも危険パターンはverificationModeでバイパスしない。
  // Phase15-F Step3-B:
  // Feature WinRate GateをTrading Engineへ接続。
  // APIコールは増やさず、SQLiteに保存済みの実績だけで補正する。
  // 先に標準化Snapshotを仮生成し、EMA/RCI/ATR/SMCなどの表記ゆれを潰してからGateへ渡す。
  const featureGateInputSnapshot = buildFeatureSnapshot({
    pair: input.pair,
    direction: effectiveDirection,
    score: input.score,
    weightScore: learning.adjustedScore,
    similarityScore: similarity.adjustedScore,
    finalScore: empiricalScore,
    features: {
      ...(input.features ?? {}),
      aiScore: input.score,
      weightScore: learning.adjustedScore,
      similarityScore: similarity.adjustedScore,
      finalScore: empiricalScore,
      source: "trading_engine_phase15_f_step3_b_feature_gate_input",
    },
  });

  const featureGate = previewFeatureWinRateGate({
    pair: input.pair,
    direction: effectiveDirection,
    score: input.score,
    finalScore: empiricalScore,
    weightScore: learning.adjustedScore,
    similarityScore: similarity.adjustedScore,
    features: featureGateInputSnapshot,
  });

  const hasFeatureHardGate = featureGate.applied.some(
    (candidate: any) => candidate.action === "SKIP_CANDIDATE",
  );

  const featureHardGatePolicy = evaluateRobustHardGatePolicy({
    candidate: robustDemo2Mode.candidate,
    featureApplied: featureGate.applied,
    patternApplied: [],
  });

  const shouldSkipByFeatureGate =
    !featureGate.allow &&
    !coldStartDemoMode.enabled &&
    !(
      robustDemo2Mode.enabled &&
      (!hasFeatureHardGate || featureHardGatePolicy.canOverrideFeatureHardGate)
    );

  if (shouldSkipByFeatureGate) {
    recordEntryFunnelEvent({
      stage: "engine_skipped_by_feature_win_rate_gate",
      aiVersion: CURRENT_AI_VERSION,
      pair: input.pair,
      direction: effectiveDirection,
      inputScore: input.score,
      finalScore: featureGate.adjustedScore,
      confidence: confidence.confidence,
      featureGateAllow: featureGate.allow,
      hasFeatureHardGate,
      reason: featureGate.reasons.join(" / "),
      details: { applied: featureGate.applied, featureHardGatePolicy },
    });

    return {
      ok: true,
      stage: "engine_skipped_by_feature_win_rate_gate",
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
      robustHardGatePolicy: featureHardGatePolicy,
      featureSnapshot: featureGateInputSnapshot,
      finalScore: featureGate.adjustedScore,
      message: `Feature WinRate Gate: ${featureGate.reasons.join(" / ")}`,
    };
  }

  // Phase15-N:
  // Pattern Weight側のDanger Pattern Hard GateもTrading Engine本体で強制停止する。
  // Phase15-J2:
  // Pattern Weight LearningをTrading Engine本体へ接続。
  // Feature WinRate Gate後のスコアを、危険パターン実績でさらに補正する。
  // APIコールは増やさず、SQLiteの保存済み実績のみ参照する。
  const patternWeight = evaluatePatternWeight({
    pair: input.pair,
    direction: effectiveDirection,
    score: input.score,
    finalScore: featureGate.adjustedScore,
    weightScore: learning.adjustedScore,
    similarityScore: similarity.adjustedScore,
    features: featureGateInputSnapshot,
  });

  const hasPatternHardGate = patternWeight.applied.some(
    (signal: any) => signal.action === "SKIP_CANDIDATE",
  );

  const robustHardGatePolicy = evaluateRobustHardGatePolicy({
    candidate: robustDemo2Mode.candidate,
    featureApplied: featureGate.applied,
    patternApplied: patternWeight.applied,
  });

  const shouldSkipByPatternWeight =
    !patternWeight.allow &&
    !coldStartDemoMode.enabled &&
    (!robustDemo2Mode.enabled || hasPatternHardGate);

  if (shouldSkipByPatternWeight) {
    recordEntryFunnelEvent({
      stage: "engine_skipped_by_pattern_weight",
      aiVersion: CURRENT_AI_VERSION,
      pair: input.pair,
      direction: effectiveDirection,
      inputScore: input.score,
      finalScore: patternWeight.adjustedScore,
      confidence: confidence.confidence,
      featureGateAllow: featureGate.allow,
      patternWeightAllow: patternWeight.allow,
      hasPatternHardGate,
      reason: patternWeight.reasons.join(" / "),
      details: { applied: patternWeight.applied, robustHardGatePolicy },
    });

    return {
      ok: true,
      stage: "engine_skipped_by_pattern_weight",
      demo100: demo100Before,
      coldStartDemoMode,
      verificationMode,
      aiVersion: CURRENT_AI_VERSION,
      learning,
      similarity,
      confidence,
      entryGate: gate,
      empiricalEntryGate: empiricalGate,
      featureWinRateGate: featureGate,
      patternWeight,
      robustHardGatePolicy,
      featureSnapshot: featureGateInputSnapshot,
      finalScore: patternWeight.adjustedScore,
      message: `Pattern Weight: ${patternWeight.reasons.join(" / ")}`,
    };
  }

  const finalScore = robustDemo2Mode.enabled
    ? Math.max(
        patternWeight.adjustedScore,
        input.demoPart2RobustCandidate?.directionalScore ?? 40,
      )
    : patternWeight.adjustedScore;

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
    minScore: robustDemo2Mode.enabled
      ? 40
      : coldStartDemoMode.enabled
        ? 35
        : input.minScore ?? 80,
    minPayoutRate: input.minPayoutRate ?? 1.8,
  });

  if (demoTrade.stage !== "demo_trade_executed") {
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
    };
  }

  const contractId = demoTrade.buy?.contractId;

  if (!contractId) {
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
