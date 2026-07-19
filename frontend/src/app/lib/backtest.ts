import type { UTCTimestamp } from "lightweight-charts";

export type Signal = "HIGH" | "LOW" | "見送り" | "危険";

export type Result = "WIN" | "LOSE" | "DRAW";

export type Candle = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type BacktestTrade = {
  signal: "HIGH" | "LOW";
  entryPrice: number;
  exitPrice: number;
  result: "WIN" | "LOSE" | "DRAW";
};

export function backtestRealCandles(candles: Candle[], minutes = 1): BacktestTrade[] {
  const gap = Math.max(1, minutes);
  const trades: BacktestTrade[] = [];

  for (let i = 30; i < candles.length - gap; i++) {
    const prev = candles[i - 1];
    const current = candles[i];
    const exit = candles[i + gap];

    const signal: "HIGH" | "LOW" =
      current.close >= prev.close ? "HIGH" : "LOW";

    let result: "WIN" | "LOSE" | "DRAW" = "DRAW";

    if (signal === "HIGH") {
      if (exit.close > current.close) result = "WIN";
      if (exit.close < current.close) result = "LOSE";
    }

    if (signal === "LOW") {
      if (exit.close < current.close) result = "WIN";
      if (exit.close > current.close) result = "LOSE";
    }

    trades.push({
      signal,
      entryPrice: current.close,
      exitPrice: exit.close,
      result,
    });
  }

  return trades;
}

export function calcBacktestStats(trades: BacktestTrade[]) {
  const total = trades.length;
  const wins = trades.filter((t) => t.result === "WIN").length;
  const loses = trades.filter((t) => t.result === "LOSE").length;

  const high = trades.filter((t) => t.signal === "HIGH");
  const low = trades.filter((t) => t.signal === "LOW");

  const highWins = high.filter((t) => t.result === "WIN").length;
  const lowWins = low.filter((t) => t.result === "WIN").length;

  return {
    total,
    wins,
    loses,
    winRate: total === 0 ? 0 : Number(((wins / total) * 100).toFixed(1)),
    highWinRate: high.length === 0 ? 0 : Number(((highWins / high.length) * 100).toFixed(1)),
    lowWinRate: low.length === 0 ? 0 : Number(((lowWins / low.length) * 100).toFixed(1)),
  };
}
