export type TradeHistory = {
  signal: "HIGH" | "LOW";
  result: "WIN" | "LOSE" | "DRAW";
};

export function calcHistoryStats(trades: TradeHistory[]) {
  const closed = trades.filter((t) => t.result);
  const total = closed.length;
  const wins = closed.filter((t) => t.result === "WIN").length;

  const high = closed.filter((t) => t.signal === "HIGH");
  const low = closed.filter((t) => t.signal === "LOW");

  const highWins = high.filter((t) => t.result === "WIN").length;
  const lowWins = low.filter((t) => t.result === "WIN").length;

  return {
    total,
    wins,
    loses: closed.filter((t) => t.result === "LOSE").length,
    winRate: total === 0 ? "未計算" : `${((wins / total) * 100).toFixed(1)}`,
    highWinRate: high.length === 0 ? 0 : Number(((highWins / high.length) * 100).toFixed(1)),
    lowWinRate: low.length === 0 ? 0 : Number(((lowWins / low.length) * 100).toFixed(1)),
  };
}
