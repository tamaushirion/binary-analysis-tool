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
  current?: SimilarityLearningInput["features"];

  pastScore: number;
  pastPayoutRate: number | null;

  past: {
    emaDiff: number | null;
    rci9: number | null;
    rci26: number | null;
    rci52: number | null;
    atr: number | null;
    bos: number | null;
    choch: number | null;
    fvg: number | null;
    hour: number | null;
    weekday: number | null;
  };
}) {
  let similarity = 0;

  // Score
  similarity += Math.max(
    0,
    25 - Math.abs(params.currentScore - params.pastScore) * 1.2
  );

  // Payout
  if (
    params.currentPayoutRate != null &&
    params.pastPayoutRate != null
  ) {
    similarity += Math.max(
      0,
      10 -
        Math.abs(
          params.currentPayoutRate -
            params.pastPayoutRate
        ) *
          100
    );
  } else {
    similarity += 5;
  }

  // EMA Diff
  if (
    params.current?.emaDiff != null &&
    params.past.emaDiff != null
  ) {
    similarity += Math.max(
      0,
      10 -
        Math.abs(
          params.current.emaDiff -
            params.past.emaDiff
        ) *
          100
    );
  }

  // ATR
  if (
    params.current?.atr != null &&
    params.past.atr != null
  ) {
    similarity += Math.max(
      0,
      8 -
        Math.abs(params.current.atr - params.past.atr) *
          100
    );
  }

  // RCI
  if (
    params.current?.rci9 != null &&
    params.past.rci9 != null
  ) {
    similarity += Math.max(
      0,
      8 -
        Math.abs(params.current.rci9 - params.past.rci9) /
          10
    );
  }

  if (
    params.current?.rci26 != null &&
    params.past.rci26 != null
  ) {
    similarity += Math.max(
      0,
      8 -
        Math.abs(
          params.current.rci26 - params.past.rci26
        ) /
          10
    );
  }

  if (
    params.current?.rci52 != null &&
    params.past.rci52 != null
  ) {
    similarity += Math.max(
      0,
      8 -
        Math.abs(
          params.current.rci52 - params.past.rci52
        ) /
          10
    );
  }

  // BOS
  if (
    params.current?.bos != null &&
    params.past.bos != null &&
    Number(params.current.bos) === params.past.bos
  ) {
    similarity += 5;
  }

  // CHOCH
  if (
    params.current?.choch != null &&
    params.past.choch != null &&
    Number(params.current.choch) === params.past.choch
  ) {
    similarity += 5;
  }

  // FVG
  if (
    params.current?.fvg != null &&
    params.past.fvg != null &&
    Number(params.current.fvg) === params.past.fvg
  ) {
    similarity += 5;
  }

  // Hour
  if (
    params.current?.hour != null &&
    params.past.hour != null &&
    params.current.hour === params.past.hour
  ) {
    similarity += 4;
  }

  // Weekday
  if (
    params.current?.weekday != null &&
    params.past.weekday != null &&
    params.current.weekday === params.past.weekday
  ) {
    similarity += 2;
  }

  return Math.min(100, Math.max(0, similarity));
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
        current: input.features,

        pastScore: Number(trade.score ?? 0),
        pastPayoutRate:
          trade.payoutRate == null ? null : Number(trade.payoutRate),

        past: {
          emaDiff: trade.emaDiff,
          rci9: trade.rci9,
          rci26: trade.rci26,
          rci52: trade.rci52,
          atr: trade.atr,
          bos: trade.bos,
          choch: trade.choch,
          fvg: trade.fvg,
          hour: trade.hour,
          weekday: trade.weekday,
        },
      });

      return {
        ...trade,
        similarity,
      };
    })
    .filter((trade) => trade.similarity >= 75)
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
    reasons.push(`Similarity V2 高勝率: ${winRate.toFixed(1)}%`);
  } else if (winRate >= 70) {
    similarityWeight = 3;
    reasons.push(`Similarity V2 良好: ${winRate.toFixed(1)}%`);
  } else if (winRate < 45 && similar.length >= 10) {
    similarityWeight = -10;
    reasons.push(`Similarity V2 危険: ${winRate.toFixed(1)}%`);
  } else if (winRate < 55) {
    similarityWeight = -5;
    reasons.push(`Similarity V2 やや低い: ${winRate.toFixed(1)}%`);
  } else {
    similarityWeight = 0;
    reasons.push(`Similarity V2 中立: ${winRate.toFixed(1)}%`);
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
