import { getClosedTradesForValidation } from "@/lib/db/tradeRepository";

type ClosedTrade = ReturnType<typeof getClosedTradesForValidation>[number];

function calcWinRate(trades: ClosedTrade[]) {
  const wins = trades.filter((t) => t.status === "WON").length;
  const losses = trades.filter((t) => t.status === "LOST").length;
  const total = wins + losses;

  return {
    total,
    wins,
    losses,
    winRate: total > 0 ? Number(((wins / total) * 100).toFixed(2)) : 0,
    totalProfit: Number(
      trades.reduce((sum, t) => sum + Number(t.profit ?? 0), 0).toFixed(2)
    ),
  };
}

function groupBy<T extends string | number | null>(
  trades: ClosedTrade[],
  keyGetter: (trade: ClosedTrade) => T
) {
  const map = new Map<string, ClosedTrade[]>();

  for (const trade of trades) {
    const rawKey = keyGetter(trade);
    const key = rawKey === null || rawKey === undefined ? "UNKNOWN" : String(rawKey);

    if (!map.has(key)) map.set(key, []);
    map.get(key)?.push(trade);
  }

  return Array.from(map.entries())
    .map(([key, groupedTrades]) => ({
      key,
      ...calcWinRate(groupedTrades),
    }))
    .sort((a, b) => b.total - a.total);
}

function scoreBand(score: number | null) {
  if (score === null || score === undefined) return "UNKNOWN";
  if (score >= 90) return "90-100";
  if (score >= 85) return "85-89";
  if (score >= 80) return "80-84";
  if (score >= 75) return "75-79";
  return "0-74";
}

function buildRecommendations(params: {
  overall: ReturnType<typeof calcWinRate>;
  byPair: ReturnType<typeof groupBy>;
  byDirection: ReturnType<typeof groupBy>;
  byHour: ReturnType<typeof groupBy>;
  bySession: ReturnType<typeof groupBy>;
  byMarketPhase: ReturnType<typeof groupBy>;
  byFinalScoreBand: ReturnType<typeof groupBy>;
}) {
  const recommendations: string[] = [];

  const weakGroups = [
    ...params.byPair.map((x) => ({ type: "pair", ...x })),
    ...params.byDirection.map((x) => ({ type: "direction", ...x })),
    ...params.byHour.map((x) => ({ type: "hour", ...x })),
    ...params.bySession.map((x) => ({ type: "session", ...x })),
    ...params.byMarketPhase.map((x) => ({ type: "marketPhase", ...x })),
    ...params.byFinalScoreBand.map((x) => ({ type: "finalScoreBand", ...x })),
  ]
    .filter((x) => x.total >= 5)
    .filter((x) => x.winRate < params.overall.winRate)
    .sort((a, b) => a.winRate - b.winRate)
    .slice(0, 8);

  for (const group of weakGroups) {
    recommendations.push(
      `${group.type}:${group.key} は勝率 ${group.winRate}% と全体勝率 ${params.overall.winRate}% を下回っています。Entry Gate または Weight Learning で減点候補です。`
    );
  }

  if (params.overall.winRate < 60) {
    recommendations.unshift(
      "全体勝率が60%未満です。本番運用は禁止。minConfidence / minScore / Entry Gateを強化してください。"
    );
  }

  if (params.overall.total < 100) {
    recommendations.unshift(
      `まだ${params.overall.total}件です。100件完了まではAI分析結果を確定させないでください。`
    );
  }

  return recommendations;
}

export function analyzeDemo100Trades() {
  const allTrades = getClosedTradesForValidation(1000);
  const trades = allTrades.slice(-100);

  const overall = calcWinRate(trades);

  const byPair = groupBy(trades, (t) => t.pair);
  const byDirection = groupBy(trades, (t) => t.direction);
  const byHour = groupBy(trades, (t) => t.hour);
  const bySession = groupBy(trades, (t) => t.session);
  const byMarketPhase = groupBy(trades, (t) => t.marketPhase);
  const byFinalScoreBand = groupBy(trades, (t) => scoreBand(t.finalScore));

  const recommendations = buildRecommendations({
    overall,
    byPair,
    byDirection,
    byHour,
    bySession,
    byMarketPhase,
    byFinalScoreBand,
  });

  return {
    sampleSize: trades.length,
    completed: trades.length >= 100,
    overall,
    breakdowns: {
      byPair,
      byDirection,
      byHour,
      bySession,
      byMarketPhase,
      byFinalScoreBand,
    },
    recommendations,
    message:
      trades.length >= 100
        ? "100件デモ分析が完了しました。弱い条件を減点候補として抽出しました。"
        : "まだ100件未満です。分析は仮結果です。",
  };
}