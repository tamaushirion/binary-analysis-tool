import type { Candle, Signal } from "./backtest";
import { detectSMC } from "./smc";
import { aggregateCandles } from "./timeframe";

export type AutoScanResult = {
  pair: string;
  signal: Signal;
  score: number;
  reasons: string[];
  price: number | null;
};

function calcSimpleScore(candles: Candle[]) {
  if (candles.length < 30) return 0;

  const latest = candles[candles.length - 1];
  const prev = candles[Math.max(0, candles.length - 10)];
  const diff = latest.close - prev.close;
  const rate = Math.abs(diff / prev.close) * 10000;

  return Math.min(100, Math.round(60 + rate));
}

export function scanAllPairs(
  pairCandlesMap: Record<string, Candle[]>,
  _notificationStats: any,
  _notificationLogs: any[]
): AutoScanResult[] {
  return Object.entries(pairCandlesMap).map(([pair, candles]) => {
    if (!candles || candles.length < 30) {
      return {
        pair,
        signal: "見送り",
        score: 0,
        reasons: ["ローソク足不足"],
        price: null,
      };
    }

    const latest = candles[candles.length - 1];
    const smc = detectSMC(candles.slice(-120));
    const candles5m = aggregateCandles(candles.slice(-300), 5);
    const candles15m = aggregateCandles(candles.slice(-600), 15);

    const trendUp =
      candles5m.length >= 2 &&
      candles15m.length >= 2 &&
      candles5m[candles5m.length - 1].close > candles5m[0].close &&
      candles15m[candles15m.length - 1].close > candles15m[0].close;

    const trendDown =
      candles5m.length >= 2 &&
      candles15m.length >= 2 &&
      candles5m[candles5m.length - 1].close < candles5m[0].close &&
      candles15m[candles15m.length - 1].close < candles15m[0].close;

    const score = calcSimpleScore(candles);

    if (trendUp && (smc.bosBull || smc.chochBull)) {
      return {
        pair,
        signal: "HIGH",
        score,
        reasons: ["MTF上昇", "SMC HIGH方向"],
        price: latest.close,
      };
    }

    if (trendDown && (smc.bosBear || smc.chochBear)) {
      return {
        pair,
        signal: "LOW",
        score,
        reasons: ["MTF下降", "SMC LOW方向"],
        price: latest.close,
      };
    }

    return {
      pair,
      signal: "見送り",
      score: 40,
      reasons: ["条件不足"],
      price: latest.close,
    };
  });
}
