import { getSimilarityTradeCandidates } from "@/lib/db/tradeRepository";
import type { TradeFeatureSnapshot } from "@/lib/db/tradeRepository";

export type SimilarityLearningInput = {
  pair: string;
  direction: "HIGH" | "LOW";
  score: number;
  payoutRate: number | null;
  features?: TradeFeatureSnapshot | null;
};

export type SimilarityLearningResult = {
  enabled: boolean;
  baseScore: number;
  adjustedScore: number;
  similarityWeight: number;
  similarTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgSimilarity: number | null;
  reasons: string[];
};

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function calcSimilarity(params: {
  currentScore: number;
  currentPayoutRate: number | null;
  pastScore: number;
  pastPayoutRate: number | null;
}) {
  let similarity = 0;

  const scoreDiff = Math.abs(params.currentScore - params.pastScore);
  const scoreSimilarity = Math.max(0, 60 - scoreDiff * 3);
  similarity += scoreSimilarity;

  if (params.currentPayoutRate && params.pastPayoutRate) {
    const payoutDiff = Math.abs(params.currentPayoutRate - params.pastPayoutRate);
    const payoutSimilarity = Math.max(0, 40 - payoutDiff * 100);
    similarity += payoutSimilarity;
  } else {
    similarity += 20;
  }

  return Math.max(0, Math.min(100, similarity));
}

export function applySimilarityLearning(
  input: SimilarityLearningInput
): SimilarityLearningResult {
  const baseScore = clampScore(input.score);

  const candidates = getSimilarityTradeCandidates({
    pair: input.pair,
    direction: input.direction,
    limit: 300,
  });

  const similar = candidates
    .map((trade) => {
      const similarity = calcSimilarity({
        currentScore: baseScore,
        currentPayoutRate: input.payoutRate,
        pastScore: Number(trade.score ?? 0),
        pastPayoutRate:
          trade.payoutRate === null || trade.payoutRate === undefined
            ? null
            : Number(trade.payoutRate),
      });

      return {
        ...trade,
        similarity,
      };
    })
    .filter((trade) => trade.similarity >= 70)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 50);

  if (similar.length < 5) {
    return {
      enabled: false,
      baseScore,
      adjustedScore: baseScore,
      similarityWeight: 0,
      similarTrades: similar.length,
      wins: 0,
      losses: 0,
      winRate: null,
      avgSimilarity: null,
      reasons: [`類似履歴が不足: ${similar.length}件`],
    };
  }

  const wins = similar.filter((trade) => Number(trade.profit ?? 0) > 0).length;
  const losses = similar.filter((trade) => Number(trade.profit ?? 0) <= 0).length;
  const winRate = similar.length > 0 ? (wins / similar.length) * 100 : 0;
  const avgSimilarity =
    similar.reduce((sum, trade) => sum + trade.similarity, 0) / similar.length;

  let similarityWeight = 0;
  const reasons: string[] = [];

  if (winRate >= 80 && similar.length >= 10) {
    similarityWeight = 5;
    reasons.push(`類似相場の勝率が高い: ${winRate.toFixed(1)}%`);
  } else if (winRate >= 70) {
    similarityWeight = 3;
    reasons.push(`類似相場の勝率が良好: ${winRate.toFixed(1)}%`);
  } else if (winRate < 45 && similar.length >= 10) {
    similarityWeight = -10;
    reasons.push(`類似相場の勝率が低い: ${winRate.toFixed(1)}%`);
  } else if (winRate < 55) {
    similarityWeight = -5;
    reasons.push(`類似相場の勝率がやや低い: ${winRate.toFixed(1)}%`);
  } else {
    similarityWeight = 0;
    reasons.push(`類似相場は中立: ${winRate.toFixed(1)}%`);
  }

  return {
    enabled: true,
    baseScore,
    adjustedScore: clampScore(baseScore + similarityWeight),
    similarityWeight,
    similarTrades: similar.length,
    wins,
    losses,
    winRate: Number(winRate.toFixed(1)),
    avgSimilarity: Number(avgSimilarity.toFixed(1)),
    reasons,
  };
}