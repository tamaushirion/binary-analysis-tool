import { getClosedTradesForValidation } from "@/lib/db/tradeRepository";

type ValidationTrade = ReturnType<typeof getClosedTradesForValidation>[number];

export type WalkForwardValidationResult = {
  ok: boolean;
  stage: "walk_forward_validation";
  totalTrades: number;
  trainTrades: number;
  validationTrades: number;
  testTrades: number;
  current: ValidationStats;
  validation: ValidationStats;
  test: ValidationStats;
  decision: {
    canUseForLearning: boolean;
    reason: string;
    overfittingRisk: "LOW" | "MEDIUM" | "HIGH";
  };
};

type ValidationStats = {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalProfit: number;
  avgProfit: number | null;
  avgPayoutRate: number | null;
};

function calcStats(trades: ValidationTrade[]): ValidationStats {
  const total = trades.length;
  const wins = trades.filter((t) => t.status === "WON").length;
  const losses = trades.filter((t) => t.status === "LOST").length;
  const totalProfit = trades.reduce((sum, t) => sum + Number(t.profit ?? 0), 0);
  const payoutRates = trades
    .map((t) => t.payoutRate)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  return {
    trades: total,
    wins,
    losses,
    winRate: total > 0 ? Number(((wins / total) * 100).toFixed(2)) : null,
    totalProfit: Number(totalProfit.toFixed(4)),
    avgProfit: total > 0 ? Number((totalProfit / total).toFixed(4)) : null,
    avgPayoutRate:
      payoutRates.length > 0
        ? Number(
            (
              payoutRates.reduce((sum, v) => sum + v, 0) / payoutRates.length
            ).toFixed(4)
          )
        : null,
  };
}

function splitTrades(trades: ValidationTrade[]) {
  const total = trades.length;

  const trainEnd = Math.floor(total * 0.7);
  const validationEnd = Math.floor(total * 0.85);

  return {
    train: trades.slice(0, trainEnd),
    validation: trades.slice(trainEnd, validationEnd),
    test: trades.slice(validationEnd),
  };
}

function judgeLearningQuality(params: {
  totalTrades: number;
  validation: ValidationStats;
  test: ValidationStats;
}) {
  if (params.totalTrades < 100) {
    return {
      canUseForLearning: false,
      reason: `履歴不足: ${params.totalTrades}件。最低100件までは自動学習しない`,
      overfittingRisk: "HIGH" as const,
    };
  }

  if (params.validation.trades < 30 || params.test.trades < 30) {
    return {
      canUseForLearning: false,
      reason: "検証データ不足。validation/test が各30件以上になるまで採用しない",
      overfittingRisk: "HIGH" as const,
    };
  }

  if (
    params.validation.winRate !== null &&
    params.test.winRate !== null &&
    Math.abs(params.validation.winRate - params.test.winRate) >= 15
  ) {
    return {
      canUseForLearning: false,
      reason: "validation と test の勝率差が大きい。過学習リスクあり",
      overfittingRisk: "HIGH" as const,
    };
  }

  if (
    params.validation.avgProfit !== null &&
    params.test.avgProfit !== null &&
    params.validation.avgProfit > 0 &&
    params.test.avgProfit <= 0
  ) {
    return {
      canUseForLearning: false,
      reason: "validationでは利益ありだがtestで利益が出ていない。採用しない",
      overfittingRisk: "MEDIUM" as const,
    };
  }

  return {
    canUseForLearning: true,
    reason: "学習評価に使用可能。ただし自動採用は改善検証後のみ",
    overfittingRisk: "LOW" as const,
  };
}

export function runWalkForwardValidation(
  limit = 1000
): WalkForwardValidationResult {
  const trades = getClosedTradesForValidation(limit);
  const { train, validation, test } = splitTrades(trades);

  const current = calcStats(trades);
  const validationStats = calcStats(validation);
  const testStats = calcStats(test);

  const decision = judgeLearningQuality({
    totalTrades: trades.length,
    validation: validationStats,
    test: testStats,
  });

  return {
    ok: true,
    stage: "walk_forward_validation",
    totalTrades: trades.length,
    trainTrades: train.length,
    validationTrades: validation.length,
    testTrades: test.length,
    current,
    validation: validationStats,
    test: testStats,
    decision,
  };
}