import { runWalkForwardValidation } from "@/lib/learning/walkForwardValidation";
import type { SimilarityLearningResult } from "@/lib/learning/similarityLearning";

export type ConfidenceEngineInput = {
  baseScore: number;
  weightAdjustedScore: number;
  similarity: SimilarityLearningResult;
  minConfidence?: number;
};

export function calculateConfidence(input: ConfidenceEngineInput) {
  const minConfidence = input.minConfidence ?? 75;
  const reasons: string[] = [];

  const weightDiff = input.weightAdjustedScore - input.baseScore;

  let weightPoints = 20;
  if (weightDiff >= 5) {
    weightPoints = 40;
    reasons.push(`Weightが強い: +${weightDiff}`);
  } else if (weightDiff >= 3) {
    weightPoints = 34;
    reasons.push(`Weightが良好: +${weightDiff}`);
  } else if (weightDiff >= 1) {
    weightPoints = 28;
    reasons.push(`Weightがやや良好: +${weightDiff}`);
  } else if (weightDiff < 0) {
    weightPoints = 10;
    reasons.push(`Weightがマイナス: ${weightDiff}`);
  } else {
    reasons.push("Weightは中立");
  }

  let similarityPoints = 15;
  if (!input.similarity.enabled) {
    similarityPoints = 12;
    reasons.push("Similarityは履歴不足");
  } else if ((input.similarity.winRate ?? 0) >= 80) {
    similarityPoints = 35;
    reasons.push(`Similarity勝率が高い: ${input.similarity.winRate}%`);
  } else if ((input.similarity.winRate ?? 0) >= 70) {
    similarityPoints = 30;
    reasons.push(`Similarity勝率が良好: ${input.similarity.winRate}%`);
  } else if ((input.similarity.winRate ?? 0) >= 60) {
    similarityPoints = 22;
    reasons.push(`Similarityは普通: ${input.similarity.winRate}%`);
  } else {
    similarityPoints = 8;
    reasons.push(`Similarityが弱い: ${input.similarity.winRate}%`);
  }

  const walkForward = runWalkForwardValidation(1000);

  let walkForwardPoints = 5;
  if (walkForward.decision.canUseForLearning) {
    walkForwardPoints = 25;
    reasons.push("Walk Forward検証OK");
  } else if (walkForward.totalTrades >= 30) {
    walkForwardPoints = 12;
    reasons.push("Walk Forwardは履歴不足だが一部参考可");
  } else {
    reasons.push("Walk Forwardは履歴不足");
  }

  const confidence = Math.max(
    0,
    Math.min(100, Math.round(weightPoints + similarityPoints + walkForwardPoints))
  );

  return {
    confidence,
    minConfidence,
    trade: confidence >= minConfidence,
    parts: {
      weightPoints,
      similarityPoints,
      walkForwardPoints,
    },
    walkForward: {
      totalTrades: walkForward.totalTrades,
      canUseForLearning: walkForward.decision.canUseForLearning,
      overfittingRisk: walkForward.decision.overfittingRisk,
      reason: walkForward.decision.reason,
    },
    reasons,
  };
}