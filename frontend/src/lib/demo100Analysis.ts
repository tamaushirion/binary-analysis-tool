import { getClosedTradesForValidation } from "@/lib/db/tradeRepository";

type ClosedTrade = ReturnType<typeof getClosedTradesForValidation>[number];

type AnalysisGroup = {
  key: string;
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
  avgProfit: number;
};

type PenaltyCandidate = {
  type: string;
  key: string;
  total: number;
  winRate: number;
  totalProfit: number;
  severity: "LOW" | "MEDIUM" | "HIGH";
  suggestedPenalty: number;
  reason: string;
};

function calcWinRate(trades: ClosedTrade[]) {
  const wins = trades.filter((t) => t.status === "WON").length;
  const losses = trades.filter((t) => t.status === "LOST").length;
  const total = wins + losses;
  const totalProfit = Number(
    trades.reduce((sum, t) => sum + Number(t.profit ?? 0), 0).toFixed(2)
  );

  return {
    total,
    wins,
    losses,
    winRate: total > 0 ? Number(((wins / total) * 100).toFixed(2)) : 0,
    totalProfit,
    avgProfit: total > 0 ? Number((totalProfit / total).toFixed(4)) : 0,
  };
}

function groupBy<T extends string | number | null>(
  trades: ClosedTrade[],
  keyGetter: (trade: ClosedTrade) => T
): AnalysisGroup[] {
  const map = new Map<string, ClosedTrade[]>();

  for (const trade of trades) {
    const rawKey = keyGetter(trade);
    const key =
      rawKey === null || rawKey === undefined || rawKey === ""
        ? "UNKNOWN"
        : String(rawKey);

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

function getSeverity(winRate: number, totalProfit: number): "LOW" | "MEDIUM" | "HIGH" {
  if (winRate < 45 || totalProfit < -3) return "HIGH";
  if (winRate < 55 || totalProfit < 0) return "MEDIUM";
  return "LOW";
}

function getSuggestedPenalty(severity: "LOW" | "MEDIUM" | "HIGH") {
  if (severity === "HIGH") return -8;
  if (severity === "MEDIUM") return -5;
  return -2;
}

function buildPenaltyCandidates(params: {
  overall: ReturnType<typeof calcWinRate>;
  byPair: AnalysisGroup[];
  byDirection: AnalysisGroup[];
  byHour: AnalysisGroup[];
  bySession: AnalysisGroup[];
  byMarketPhase: AnalysisGroup[];
  byFinalScoreBand: AnalysisGroup[];
}) {
  const minSamples = params.overall.total >= 100 ? 10 : 5;

  const sources = [
    { type: "pair", rows: params.byPair },
    { type: "direction", rows: params.byDirection },
    { type: "hour", rows: params.byHour },
    { type: "session", rows: params.bySession },
    { type: "marketPhase", rows: params.byMarketPhase },
    { type: "finalScoreBand", rows: params.byFinalScoreBand },
  ];

  const candidates: PenaltyCandidate[] = [];

  for (const source of sources) {
    for (const row of source.rows) {
      if (row.key === "UNKNOWN") continue;
      if (row.total < minSamples) continue;

      const isWeakWinRate = row.winRate < params.overall.winRate;
      const isLosingProfit = row.totalProfit < 0;

      if (!isWeakWinRate && !isLosingProfit) continue;

      const severity = getSeverity(row.winRate, row.totalProfit);
      const suggestedPenalty = getSuggestedPenalty(severity);

      candidates.push({
        type: source.type,
        key: row.key,
        total: row.total,
        winRate: row.winRate,
        totalProfit: row.totalProfit,
        severity,
        suggestedPenalty,
        reason: `${source.type}:${row.key} は ${row.total}件中 勝率${row.winRate}% / 損益${row.totalProfit} USD。Entry Gateで ${suggestedPenalty} 点の減点候補。`,
      });
    }
  }

  return candidates.sort((a, b) => {
    if (a.severity === "HIGH" && b.severity !== "HIGH") return -1;
    if (a.severity !== "HIGH" && b.severity === "HIGH") return 1;
    return a.winRate - b.winRate;
  });
}

function buildRecommendations(params: {
  overall: ReturnType<typeof calcWinRate>;
  penaltyCandidates: PenaltyCandidate[];
}) {
  const recommendations: string[] = [];

  if (params.overall.total < 100) {
    recommendations.push(
      `まだ${params.overall.total}件です。100件完了までは分析結果を確定させないでください。`
    );
  }

  if (params.overall.winRate < 60) {
    recommendations.push(
      "全体勝率が60%未満です。本番運用は禁止。minConfidence / minScore / Entry Gateを強化してください。"
    );
  }

  for (const candidate of params.penaltyCandidates.slice(0, 10)) {
    recommendations.push(candidate.reason);
  }

  if (params.penaltyCandidates.length === 0 && params.overall.total >= 20) {
    recommendations.push(
      "明確な減点候補はまだありません。引き続きデモ件数を増やして、条件別の偏りを確認してください。"
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

  const penaltyCandidates = buildPenaltyCandidates({
    overall,
    byPair,
    byDirection,
    byHour,
    bySession,
    byMarketPhase,
    byFinalScoreBand,
  });

  const recommendations = buildRecommendations({
    overall,
    penaltyCandidates,
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
    penaltyCandidates,
    recommendations,
    message:
      trades.length >= 100
        ? "100件デモ分析が完了しました。勝率改善用の減点候補を抽出しました。"
        : "まだ100件未満です。分析は仮結果です。",
  };
}