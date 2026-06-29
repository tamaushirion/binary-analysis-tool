import type { Candle } from "./backtest";

export function detectSMC(candles: Candle[]) {
  if (candles.length < 10) {
    return {
      bosBull: false,
      bosBear: false,
      chochBull: false,
      chochBear: false,
      liquidityBull: false,
      liquidityBear: false,
      fvgBull: false,
      fvgBear: false,
      label: "SMC判定待ち",
    };
  }

  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const recent = candles.slice(-20);

  const recentHigh = Math.max(...recent.slice(0, -1).map((c) => c.high));
  const recentLow = Math.min(...recent.slice(0, -1).map((c) => c.low));

  const bosBull = latest.close > recentHigh;
  const bosBear = latest.close < recentLow;
  const chochBull = prev.close < prev.open && latest.close > latest.open;
  const chochBear = prev.close > prev.open && latest.close < latest.open;
  const liquidityBull = latest.low < recentLow && latest.close > latest.open;
  const liquidityBear = latest.high > recentHigh && latest.close < latest.open;
  const fvgBull = candles.length >= 3 && latest.low > candles[candles.length - 3].high;
  const fvgBear = candles.length >= 3 && latest.high < candles[candles.length - 3].low;

  const label = bosBull || chochBull
    ? "上方向SMC優勢"
    : bosBear || chochBear
    ? "下方向SMC優勢"
    : "SMC中立";

  return {
    bosBull,
    bosBear,
    chochBull,
    chochBear,
    liquidityBull,
    liquidityBear,
    fvgBull,
    fvgBear,
    label,
  };
}
