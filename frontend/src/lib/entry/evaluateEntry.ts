import { buildFeatureSnapshot } from "@/lib/analysis/featureSnapshotBuilder";
import type { TradeFeatureSnapshot } from "@/lib/db/tradeRepository";
import { createGateEvaluationId, recordGateLog } from "@/lib/entry/gateLogger";
import { recordRejectLog, type RejectStage } from "@/lib/entry/rejectLogger";
import { calculateConfidence } from "@/lib/learning/confidenceEngine";
import type { Demo2RobustCandidateMatch } from "@/lib/learning/demo2RobustCandidateGate";
import { applyEmpiricalEntryGate } from "@/lib/learning/empiricalEntryGate";
import { applyEntryGate } from "@/lib/learning/entryGate";
import { previewFeatureWinRateGate } from "@/lib/learning/featureWinRateGate";
import { evaluatePatternWeight } from "@/lib/learning/patternWeightLearning";
import { evaluateRobustHardGatePolicy } from "@/lib/learning/robustHardGatePolicy";
import type { SimilarityLearningResult } from "@/lib/learning/similarityLearning";

type WeightLearningResult = {
  adjustedScore: number;
};

export type EntryEvaluationInput = {
  pair: string;
  direction: "HIGH" | "LOW";
  score: number;
  features?: TradeFeatureSnapshot | null;
  learning: WeightLearningResult;
  similarity: SimilarityLearningResult;
  minConfidence: number;
  coldStartEnabled: boolean;
  verificationEnabled: boolean;
  robustCandidate: Demo2RobustCandidateMatch | null;
  aiVersion?: string | null;
};

export type EntryRejectStage = RejectStage;

type ConfidenceResult = ReturnType<typeof calculateConfidence>;
type EntryGateResult = ReturnType<typeof applyEntryGate>;
type EmpiricalEntryGateResult = ReturnType<typeof applyEmpiricalEntryGate>;
type FeatureWinRateGateResult = ReturnType<typeof previewFeatureWinRateGate>;
type PatternWeightResult = ReturnType<typeof evaluatePatternWeight>;
type RobustHardGatePolicyResult = ReturnType<typeof evaluateRobustHardGatePolicy>;

type EntryEvaluationRejected = {
  allow: false;
  rejectStage: EntryRejectStage;
  reason: string;
  message: string;
  finalScore: number;
  confidence: ConfidenceResult;
  entryGate?: EntryGateResult;
  empiricalEntryGate?: EmpiricalEntryGateResult;
  featureWinRateGate?: FeatureWinRateGateResult;
  patternWeight?: PatternWeightResult;
  robustHardGatePolicy?: RobustHardGatePolicyResult;
  featureSnapshot?: TradeFeatureSnapshot;
  hasFeatureHardGate?: boolean;
  hasPatternHardGate?: boolean;
};

type EntryEvaluationAllowed = {
  allow: true;
  finalScore: number;
  confidence: ConfidenceResult;
  entryGate: EntryGateResult;
  empiricalEntryGate: EmpiricalEntryGateResult;
  featureWinRateGate: FeatureWinRateGateResult;
  patternWeight: PatternWeightResult;
  robustHardGatePolicy: RobustHardGatePolicyResult;
  featureSnapshot: TradeFeatureSnapshot;
  hasFeatureHardGate: boolean;
  hasPatternHardGate: boolean;
};

export type EntryEvaluationResult =
  | EntryEvaluationRejected
  | EntryEvaluationAllowed;

function relaxEntryGateForColdStart(params: {
  coldStartEnabled: boolean;
  gate: ReturnType<typeof applyEntryGate>;
  confidence: number;
  finalScore: number;
}) {
  if (!params.coldStartEnabled || params.gate.allow) return params.gate;

  const dangerousReasons = ["ATR異常", "危険", "急変動", "ボラ異常"];
  const hasDangerousReason = params.gate.reasons.some((reason) =>
    dangerousReasons.some((danger) => reason.includes(danger)),
  );

  if (hasDangerousReason) return params.gate;

  const canRelax =
    params.confidence >= 35 &&
    params.finalScore >= 75 &&
    params.gate.reasons.every(
      (reason) =>
        ["Confidence不足", "SMC不足", "1分Backtest弱い"].some((allowed) =>
          reason.includes(allowed),
        ) || reason.includes("OK"),
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
  if (!params.verificationEnabled || params.gate.allow) return params.gate;

  return {
    ...params.gate,
    allow: true,
    reasons: [
      ...params.gate.reasons,
      "Verification Mode: Empirical Entry Gate確認のため通常Entry Gateを一時バイパス",
    ],
  };
}

export function evaluateEntry(input: EntryEvaluationInput): EntryEvaluationResult {
  const evaluationId = createGateEvaluationId();
  const robustEnabled = input.robustCandidate?.enabled === true;
  const confidence = calculateConfidence({
    baseScore: input.score,
    weightAdjustedScore: input.learning.adjustedScore,
    similarity: input.similarity,
    minConfidence: input.minConfidence,
  });
  const similarityFinalScore = input.similarity.adjustedScore;
  const logGate = (params: Omit<Parameters<typeof recordGateLog>[0],
    "evaluationId" | "aiVersion" | "pair" | "direction" | "inputScore"
  >) => recordGateLog({
    ...params,
    evaluationId,
    aiVersion: input.aiVersion,
    pair: input.pair,
    direction: input.direction,
    inputScore: input.score,
  });
  const logReject = (params: Omit<Parameters<typeof recordRejectLog>[0],
    | "evaluationId"
    | "aiVersion"
    | "pair"
    | "direction"
    | "inputScore"
    | "confidence"
  >) => recordRejectLog({
    ...params,
    evaluationId,
    aiVersion: input.aiVersion,
    pair: input.pair,
    direction: input.direction,
    inputScore: input.score,
    confidence: confidence.confidence,
  });

  logGate({
    gateName: "confidence",
    allow: confidence.trade,
    score: confidence.confidence,
    adjustedScore: similarityFinalScore,
    reasons: confidence.reasons,
    details: confidence,
  });

  if (
    !confidence.trade &&
    !input.coldStartEnabled &&
    !input.verificationEnabled &&
    !robustEnabled
  ) {
    const reason = `Confidence不足: ${confidence.confidence}/${confidence.minConfidence}`;
    logReject({
      rejectStage: "engine_skipped_by_confidence",
      finalScore: similarityFinalScore,
      reason,
      featureSnapshot: input.features ?? undefined,
      details: { confidence },
    });
    return {
      allow: false as const,
      rejectStage: "engine_skipped_by_confidence" as const,
      reason,
      message: `Confidence不足のため見送り: ${confidence.confidence}/${confidence.minConfidence}`,
      finalScore: similarityFinalScore,
      confidence,
    };
  }

  const rawEntryGate = applyEntryGate({
    confidence: confidence.confidence,
    similarityScore: input.similarity.adjustedScore,
    weightScore: input.learning.adjustedScore,
    smcScore: Number(input.features?.smcScore ?? 0),
    atr: Number(input.features?.atr ?? 0),
    atrThreshold: Number(input.features?.atrThreshold ?? 0),
    backtestWinRate1m: Number(input.features?.backtestWinRate1m ?? 0),
  });
  const coldStartEntryGate = relaxEntryGateForColdStart({
    coldStartEnabled: input.coldStartEnabled,
    gate: rawEntryGate,
    confidence: confidence.confidence,
    finalScore: similarityFinalScore,
  });
  const entryGate = bypassEntryGateForVerification({
    verificationEnabled: input.verificationEnabled,
    gate: coldStartEntryGate,
  });
  logGate({
    gateName: "entry_gate",
    allow: entryGate.allow,
    score: entryGate.score,
    adjustedScore: similarityFinalScore,
    reasons: entryGate.reasons,
    details: { rawEntryGate, entryGate },
  });

  if (
    !entryGate.allow &&
    !input.coldStartEnabled &&
    !input.verificationEnabled &&
    !robustEnabled
  ) {
    const reason = entryGate.reasons.join(" / ");
    logReject({
      rejectStage: "engine_skipped_by_entry_gate",
      finalScore: similarityFinalScore,
      reason,
      featureSnapshot: input.features ?? undefined,
      details: { confidence, entryGate },
    });
    return {
      allow: false as const,
      rejectStage: "engine_skipped_by_entry_gate" as const,
      reason,
      message: `Entry Gate: ${entryGate.reasons.join(" / ")}`,
      finalScore: similarityFinalScore,
      confidence,
      entryGate,
    };
  }

  const empiricalEntryGate = applyEmpiricalEntryGate({
    pair: input.pair,
    direction: input.direction,
    score: input.score,
    finalScore: similarityFinalScore,
    minTrades: 10,
    minWinRate: 57,
  });
  const empiricalScore = empiricalEntryGate.adjustedScore;
  logGate({
    gateName: "empirical_entry_gate",
    allow: empiricalEntryGate.allow,
    score: empiricalEntryGate.score,
    adjustedScore: empiricalScore,
    reasons: empiricalEntryGate.reasons,
    details: empiricalEntryGate,
  });

  if (!empiricalEntryGate.allow && !input.coldStartEnabled && !robustEnabled) {
    const reason = empiricalEntryGate.reasons.join(" / ");
    logReject({
      rejectStage: "engine_skipped_by_empirical_entry_gate",
      finalScore: empiricalScore,
      reason,
      featureSnapshot: input.features ?? undefined,
      details: { confidence, entryGate, empiricalEntryGate },
    });
    return {
      allow: false as const,
      rejectStage: "engine_skipped_by_empirical_entry_gate" as const,
      reason,
      message: `Empirical Entry Gate: ${empiricalEntryGate.reasons.join(" / ")}`,
      finalScore: empiricalScore,
      confidence,
      entryGate,
      empiricalEntryGate,
    };
  }

  const featureSnapshot = buildFeatureSnapshot({
    pair: input.pair,
    direction: input.direction,
    score: input.score,
    weightScore: input.learning.adjustedScore,
    similarityScore: input.similarity.adjustedScore,
    finalScore: empiricalScore,
    features: {
      ...(input.features ?? {}),
      aiScore: input.score,
      weightScore: input.learning.adjustedScore,
      similarityScore: input.similarity.adjustedScore,
      finalScore: empiricalScore,
      source: "trading_engine_phase15_f_step3_b_feature_gate_input",
    },
  });
  const featureWinRateGate = previewFeatureWinRateGate({
    pair: input.pair,
    direction: input.direction,
    score: input.score,
    finalScore: empiricalScore,
    weightScore: input.learning.adjustedScore,
    similarityScore: input.similarity.adjustedScore,
    features: featureSnapshot,
  });
  const hasFeatureHardGate = featureWinRateGate.applied.some(
    (candidate) => candidate.action === "SKIP_CANDIDATE",
  );
  const featureHardGatePolicy = evaluateRobustHardGatePolicy({
    candidate: input.robustCandidate,
    featureApplied: featureWinRateGate.applied,
    patternApplied: [],
  });
  logGate({
    gateName: "feature_win_rate_gate",
    allow: featureWinRateGate.allow,
    score: featureWinRateGate.originalScore,
    adjustedScore: featureWinRateGate.adjustedScore,
    reasons: featureWinRateGate.reasons,
    details: featureWinRateGate,
  });
  logGate({
    gateName: "feature_robust_hard_gate_policy",
    allow:
      !hasFeatureHardGate || featureHardGatePolicy.canOverrideFeatureHardGate,
    adjustedScore: featureWinRateGate.adjustedScore,
    reasons: featureHardGatePolicy.reasons,
    details: featureHardGatePolicy,
  });

  if (
    !featureWinRateGate.allow &&
    !input.coldStartEnabled &&
    !(
      robustEnabled &&
      (!hasFeatureHardGate || featureHardGatePolicy.canOverrideFeatureHardGate)
    )
  ) {
    const reason = featureWinRateGate.reasons.join(" / ");
    logReject({
      rejectStage: "engine_skipped_by_feature_win_rate_gate",
      finalScore: featureWinRateGate.adjustedScore,
      reason,
      featureSnapshot,
      details: {
        confidence,
        entryGate,
        empiricalEntryGate,
        featureWinRateGate,
        robustHardGatePolicy: featureHardGatePolicy,
      },
    });
    return {
      allow: false as const,
      rejectStage: "engine_skipped_by_feature_win_rate_gate" as const,
      reason,
      message: `Feature WinRate Gate: ${featureWinRateGate.reasons.join(" / ")}`,
      finalScore: featureWinRateGate.adjustedScore,
      confidence,
      entryGate,
      empiricalEntryGate,
      featureWinRateGate,
      robustHardGatePolicy: featureHardGatePolicy,
      featureSnapshot,
      hasFeatureHardGate,
    };
  }

  const patternWeight = evaluatePatternWeight({
    pair: input.pair,
    direction: input.direction,
    score: input.score,
    finalScore: featureWinRateGate.adjustedScore,
    weightScore: input.learning.adjustedScore,
    similarityScore: input.similarity.adjustedScore,
    features: featureSnapshot,
  });
  const hasPatternHardGate = patternWeight.applied.some(
    (signal) => signal.action === "SKIP_CANDIDATE",
  );
  const robustHardGatePolicy = evaluateRobustHardGatePolicy({
    candidate: input.robustCandidate,
    featureApplied: featureWinRateGate.applied,
    patternApplied: patternWeight.applied,
  });
  logGate({
    gateName: "pattern_weight",
    allow: patternWeight.allow,
    score: patternWeight.originalScore,
    adjustedScore: patternWeight.adjustedScore,
    reasons: patternWeight.reasons,
    details: patternWeight,
  });
  logGate({
    gateName: "robust_hard_gate_policy",
    allow: !hasPatternHardGate,
    adjustedScore: patternWeight.adjustedScore,
    reasons: robustHardGatePolicy.reasons,
    details: robustHardGatePolicy,
  });

  if (
    !patternWeight.allow &&
    !input.coldStartEnabled &&
    (!robustEnabled || hasPatternHardGate)
  ) {
    const reason = patternWeight.reasons.join(" / ");
    logReject({
      rejectStage: "engine_skipped_by_pattern_weight",
      finalScore: patternWeight.adjustedScore,
      reason,
      featureSnapshot,
      details: {
        confidence,
        entryGate,
        empiricalEntryGate,
        featureWinRateGate,
        patternWeight,
        robustHardGatePolicy,
      },
    });
    return {
      allow: false as const,
      rejectStage: "engine_skipped_by_pattern_weight" as const,
      reason,
      message: `Pattern Weight: ${patternWeight.reasons.join(" / ")}`,
      finalScore: patternWeight.adjustedScore,
      confidence,
      entryGate,
      empiricalEntryGate,
      featureWinRateGate,
      patternWeight,
      robustHardGatePolicy,
      featureSnapshot,
      hasFeatureHardGate,
      hasPatternHardGate,
    };
  }

  const finalScore = robustEnabled
    ? Math.max(
        patternWeight.adjustedScore,
        input.robustCandidate?.directionalScore ?? 40,
      )
    : patternWeight.adjustedScore;

  return {
    allow: true as const,
    finalScore,
    confidence,
    entryGate,
    empiricalEntryGate,
    featureWinRateGate,
    patternWeight,
    robustHardGatePolicy,
    featureSnapshot,
    hasFeatureHardGate,
    hasPatternHardGate,
  };
}
