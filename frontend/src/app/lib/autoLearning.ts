export type AutoLearningTrade = {
  id: string;
  pair: string;
  signal: "HIGH" | "LOW";
  entryPrice: number;
  entryTime: number;
  resultTime: number;
  confidence: number;
  reasons: string[];
  result?: "WIN" | "LOSE" | "DRAW";
  exitPrice?: number;
};

const KEY = "auto_learning_trades_v1";

export function loadLearningTrades(): AutoLearningTrade[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveLearningTrade(trade: AutoLearningTrade) {
  if (typeof window === "undefined") return;

  const trades = loadLearningTrades();
  const index = trades.findIndex((item) => item.id === trade.id);

  if (index >= 0) {
    trades[index] = trade;
  } else {
    trades.unshift(trade);
  }

  localStorage.setItem(KEY, JSON.stringify(trades.slice(0, 500)));
}

export function createLearningTrade(input: {
  pair: string;
  signal: "HIGH" | "LOW";
  entryPrice: number;
  confidence: number;
  reasons: string[];
}) {
  return {
    id: crypto.randomUUID(),
    pair: input.pair,
    signal: input.signal,
    entryPrice: input.entryPrice,
    entryTime: Date.now(),
    resultTime: Date.now() + 60 * 1000,
    confidence: input.confidence,
    reasons: input.reasons,
  };
}

export function judgeLearningTrade(
  trade: AutoLearningTrade,
  exitPrice: number
): AutoLearningTrade {
  let result: "WIN" | "LOSE" | "DRAW" = "DRAW";

  if (trade.signal === "HIGH") {
    if (exitPrice > trade.entryPrice) result = "WIN";
    if (exitPrice < trade.entryPrice) result = "LOSE";
  }

  if (trade.signal === "LOW") {
    if (exitPrice < trade.entryPrice) result = "WIN";
    if (exitPrice > trade.entryPrice) result = "LOSE";
  }

  return {
    ...trade,
    exitPrice,
    result,
  };
}

export function calcLearningStats(
  trades: AutoLearningTrade[],
  pair?: string
) {
  const closed = trades.filter(
    (trade) => (!pair || trade.pair === pair) && trade.result
  );

  const total = closed.length;
  const wins = closed.filter((trade) => trade.result === "WIN").length;
  const loses = closed.filter((trade) => trade.result === "LOSE").length;

  const high = closed.filter((trade) => trade.signal === "HIGH");
  const low = closed.filter((trade) => trade.signal === "LOW");

  const highWins = high.filter((trade) => trade.result === "WIN").length;
  const lowWins = low.filter((trade) => trade.result === "WIN").length;

  return {
    total,
    wins,
    loses,
    winRate: total === 0 ? 0 : (wins / total) * 100,
    highTotal: high.length,
    lowTotal: low.length,
    highWinRate: high.length === 0 ? 0 : (highWins / high.length) * 100,
    lowWinRate: low.length === 0 ? 0 : (lowWins / low.length) * 100,
  };
}
