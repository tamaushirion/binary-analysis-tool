import { getClosedTradesForValidation } from "@/lib/db/tradeRepository";

type ClosedTrade = ReturnType<typeof getClosedTradesForValidation>[number];

function isWin(trade: ClosedTrade) {
  return trade.status === "WON";
}

function scoreBand(score: number | null) {
  if (score === null || score === undefined) return "unknown";
  if (score >= 90) return "90-100";
  if (score >= 80) return "80-89";
  if (score >= 70) return "70-79";
  return "0-69";
}

function summarizeGroup<T extends string | number>(
  trades: ClosedTrade[],
  keyGetter: (trade: ClosedTrade) => T | null | undefined
) {
  const map = new Map<string, ClosedTrade[]>();

  for (const trade of trades) {
    const key = keyGetter(trade);
    const label = key === null || key === undefined ? "unknown" : String(key);

    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(trade);
  }

  return Array.from(map.entries())
    .map(([label, items]) => {
      const wins = items.filter(isWin).length;
      const losses = items.length - wins;
      const totalProfit = items.reduce(
        (sum, trade) => sum + Number(trade.profit ?? 0),
        0
      );

      return {
        label,
        totalTrades: items.length,
        wins,
        losses,
        winRate:
          items.length > 0 ? Number(((wins / items.length) * 100).toFixed(2)) : 0,
        totalProfit: Number(totalProfit.toFixed(2)),
        avgProfit:
          items.length > 0
            ? Number((totalProfit / items.length).toFixed(4))
            : 0,
      };
    })
    .sort((a, b) => b.winRate - a.winRate || b.totalTrades - a.totalTrades);
}

function calcMaxStreak(trades: ClosedTrade[], targetStatus: "WON" | "LOST") {
  let current = 0;
  let max = 0;

  for (const trade of trades) {
    if (trade.status === targetStatus) {
      current += 1;
      max = Math.max(max, current);
    } else {
      current = 0;
    }
  }

  return max;
}

export function analyzeDemo100(limit = 100) {
  const trades = getClosedTradesForValidation(limit);
  const wins = trades.filter(isWin).length;
  const losses = trades.length - wins;
  const totalProfit = trades.reduce(
    (sum, trade) => sum + Number(trade.profit ?? 0),
    0
  );

  const byHour = summarizeGroup(trades, (trade) => trade.hour);
  const byPair = summarizeGroup(trades, (trade) => trade.pair);
  const byDirection = summarizeGroup(trades, (trade) => trade.direction);
  const byScoreBand = summarizeGroup(trades, (trade) => scoreBand(trade.score));
  const byFinalScoreBand = summarizeGroup(trades, (trade) =>
    scoreBand(trade.finalScore)
  );

  const bestHour = byHour[0] ?? null;
  const worstHour = [...byHour]
    .filter((item) => item.totalTrades >= 3)
    .sort((a, b) => a.winRate - b.winRate)[0] ?? null;

  const bestDirection = byDirection[0] ?? null;
  const bestScoreBand = byScoreBand[0] ?? null;

  const recommendations: string[] = [];

  if (bestDirection && bestDirection.winRate >= 55) {
    recommendations.push(
      `${bestDirection.label}方向を優先候補。勝率${bestDirection.winRate}%`
    );
  }

  if (bestHour && bestHour.winRate >= 55) {
    recommendations.push(
      `${bestHour.label}時台を優先候補。勝率${bestHour.winRate}%`
    );
  }

  if (worstHour && worstHour.winRate <= 45) {
    recommendations.push(
      `${worstHour.label}時台は停止候補。勝率${worstHour.winRate}%`
    );
  }

  if (bestScoreBand && bestScoreBand.winRate >= 55) {
    recommendations.push(
      `スコア帯${bestScoreBand.label}を優先候補。勝率${bestScoreBand.winRate}%`
    );
  }

  if (trades.length < 100) {
    recommendations.push("100件未満のため、まだ本番判定には使わない");
  }

  if (trades.length >= 100 && wins / trades.length < 0.55) {
    recommendations.push(
      "総合勝率55%未満。次は時間帯・方向・スコア帯で条件を絞る"
    );
  }

  return {
    ok: true,
    stage: "demo100_analysis",
    analyzedTrades: trades.length,
    overall: {
      totalTrades: trades.length,
      wins,
      losses,
      winRate:
        trades.length > 0
          ? Number(((wins / trades.length) * 100).toFixed(2))
          : 0,
      totalProfit: Number(totalProfit.toFixed(2)),
      avgProfit:
        trades.length > 0
          ? Number((totalProfit / trades.length).toFixed(4))
          : 0,
      maxWinStreak: calcMaxStreak(trades, "WON"),
      maxLoseStreak: calcMaxStreak(trades, "LOST"),
    },
    best: {
      hour: bestHour,
      direction: bestDirection,
      scoreBand: bestScoreBand,
    },
    worst: {
      hour: worstHour,
    },
    breakdowns: {
      byHour,
      byPair,
      byDirection,
      byScoreBand,
      byFinalScoreBand,
    },
    recommendations,
    message: "Demo100分析完了",
  };
}