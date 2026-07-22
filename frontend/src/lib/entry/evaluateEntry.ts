import { buildFeatureSnapshot } from "@/lib/analysis/featureSnapshotBuilder";
import type { TradeFeatureSnapshot } from "@/lib/db/tradeRepository";
import { createGateEvaluationId, recordGateLog } from "@/lib/entry/gateLogger";
import { recordNearMiss } from "@/lib/entry/nearMissLogger";
import { recordRejectLog, type RejectStage } from "@/lib/entry/rejectLogger";
import { recordRejectShadowCandidate } from "@/lib/entry/rejectShadowTracker";
import {
  canContinueDemo2ShadowOverride,
  evaluateDemo2ShadowGateOverride,
  type Demo2ShadowOverrideMatch,
} from "@/lib/entry/demo2ShadowGateOverride";
import { recordDemo2ShadowOverrideMatch } from "@/lib/entry/demo2ShadowOverrideStore";
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
  shadowGateOverride?: ActiveShadowGateOverride | null;
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
  shadowGateOverride: ActiveShadowGateOverride | null;
};

export type ActiveShadowGateOverride = Demo2ShadowOverrideMatch & {
  overrideRunId: number;
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
  const demo2Enabled = input.features?.autoRunnerMode === "demo_part2";
  let shadowGateOverride: ActiveShadowGateOverride | null = null;
  const activateShadowOverride = (match: Demo2ShadowOverrideMatch) => {
    const recorded = recordDemo2ShadowOverrideMatch({
      evaluationId,
      match,
      pair: input.pair,
      direction: input.direction,
      inputScore: input.score,
    });
    if (!recorded.ok) return null;
    return { ...match, overrideRunId: recorded.overrideRunId };
  };
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
  >) => {
    const result = recordRejectLog({
      ...params,
      evaluationId,
      aiVersion: input.aiVersion,
      pair: input.pair,
      direction: input.direction,
      inputScore: input.score,
      confidence: confidence.confidence,
    });
    const observationEpoch = Number(input.features?.shadowObservationEpoch);
    const exitEpoch = Number(input.features?.shadowExitEpoch);
    const entrySpot = Number(input.features?.shadowEntrySpot);

    if (
      result.ok &&
      Number.isInteger(observationEpoch) &&
      Number.isInteger(exitEpoch) &&
      exitEpoch > observationEpoch &&
      Number.isFinite(entrySpot)
    ) {
      recordRejectShadowCandidate({
        rejectLogId: result.rejectLogId,
        evaluationId,
        rejectStage: params.rejectStage,
        aiVersion: input.aiVersion,
        pair: input.pair,
        direction: input.direction,
        inputScore: input.score,
        finalScore: params.finalScore,
        confidence: confidence.confidence,
        observationEpoch,
        exitEpoch,
        entrySpot,
        featureSnapshot: params.featureSnapshot,
      });
    }

    return result;
  };
  const logNearMiss = (params: Omit<Parameters<typeof recordNearMiss>[0],
    | "evaluationId"
    | "aiVersion"
    | "pair"
    | "direction"
    | "inputScore"
  >) => recordNearMiss({
    ...params,
    evaluationId,
    aiVersion: input.aiVersion,
    pair: input.pair,
    direction: input.direction,
    inputScore: input.score,
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
    logNearMiss({
      rejectStage: "engine_skipped_by_confidence",
      metric: "confidence",
      observedValue: confidence.confidence,
      thresholdValue: confidence.minConfidence,
      maxGap: 5,
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
    logNearMiss({
      rejectStage: "engine_skipped_by_entry_gate",
      metric: "entry_gate_score",
      observedValue: entryGate.score,
      thresholdValue: 80,
      maxGap: 5,
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
  const empiricalShadowMatch = !empiricalEntryGate.allow
    ? evaluateDemo2ShadowGateOverride({
        demo2Enabled,
        rejectedGate: "engine_skipped_by_empirical_entry_gate",
        features: input.features,
      })
    : null;
  if (empiricalShadowMatch) {
    shadowGateOverride = activateShadowOverride(empiricalShadowMatch);
  }
  logGate({
    gateName: "empirical_entry_gate",
    allow: empiricalEntryGate.allow,
    score: empiricalEntryGate.score,
    adjustedScore: empiricalScore,
    reasons: empiricalEntryGate.reasons,
    details: empiricalEntryGate,
  });

  if (
    !empiricalEntryGate.allow &&
    !input.coldStartEnabled &&
    !robustEnabled &&
    !shadowGateOverride
  ) {
    const reason = empiricalEntryGate.reasons.join(" / ");
    logReject({
      rejectStage: "engine_skipped_by_empirical_entry_gate",
      finalScore: empiricalScore,
      reason,
      featureSnapshot: input.features ?? undefined,
      details: { confidence, entryGate, empiricalEntryGate },
    });
    if (
      empiricalEntryGate.winRate !== null &&
      empiricalEntryGate.sampleSize >= 10
    ) {
      logNearMiss({
        rejectStage: "engine_skipped_by_empirical_entry_gate",
        metric: "empirical_win_rate",
        observedValue: empiricalEntryGate.winRate,
        thresholdValue: 50,
        maxGap: 5,
        finalScore: empiricalScore,
        reason,
        featureSnapshot: input.features ?? undefined,
        details: { confidence, entryGate, empiricalEntryGate },
      });
    }
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
  const featureShadowMatch =
    !featureWinRateGate.allow && !shadowGateOverride
      ? evaluateDemo2ShadowGateOverride({
          demo2Enabled,
          rejectedGate: "engine_skipped_by_feature_win_rate_gate",
          features: {
            ...featureSnapshot,
            shadowEntrySpot: input.features?.shadowEntrySpot,
            shadowObservationEpoch: input.features?.shadowObservationEpoch,
          },
          appliedGates: featureWinRateGate.applied,
        })
      : null;
  if (featureShadowMatch) {
    shadowGateOverride = activateShadowOverride(featureShadowMatch);
  }
  const shadowCanContinueFeature =
    shadowGateOverride !== null &&
    canContinueDemo2ShadowOverride({
      match: shadowGateOverride,
      appliedGates: featureWinRateGate.applied,
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
    !shadowCanContinueFeature &&
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
      shadowGateOverride,
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
  const shadowCanContinuePattern =
    shadowGateOverride !== null &&
    canContinueDemo2ShadowOverride({
      match: shadowGateOverride,
      appliedGates: patternWeight.applied,
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
    !shadowCanContinuePattern &&
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
      shadowGateOverride,
    };
  }

  const finalScore = robustEnabled
    ? Math.max(
        patternWeight.adjustedScore,
        input.robustCandidate?.directionalScore ?? 40,
      )
    : shadowGateOverride
      ? Math.max(patternWeight.adjustedScore, 40)
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
    shadowGateOverride,
  };
}
