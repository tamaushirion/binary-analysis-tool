import type { Candle } from "./backtest";

export function aggregateCandles(candles: Candle[], interval: number): Candle[] {
  if (!candles.length || interval <= 1) return candles;

  const result: Candle[] = [];

  for (let i = 0; i < candles.length; i += interval) {
    const group = candles.slice(i, i + interval);
    if (group.length === 0) continue;

    result.push({
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[group.length - 1].close,
    });
  }

  return result;
}
