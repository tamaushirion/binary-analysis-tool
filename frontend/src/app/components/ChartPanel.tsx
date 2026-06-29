"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  type UTCTimestamp,
} from "lightweight-charts";

export type ChartCandle = {
  time: UTCTimestamp | string;
  open: number;
  high: number;
  low: number;
  close: number;
};

type ChartPanelProps = {
  title: string;
  subtitle: string;
  height?: number;
  candles?: ChartCandle[];
  onEmaUpdate?: (ema9: number, ema21: number) => void;
  onRciUpdate?: (rci9: number, rci26: number, rci52: number) => void;
  onPriceUpdate?: (price: number) => void;
};

function calcEma(values: number[], period: number) {
  if (values.length < period) return 0;

  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;

  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }

  return Number(ema.toFixed(5));
}

function calcRci(values: number[], period: number) {
  if (values.length < period) return 0;

  const target = values.slice(-period);
  const priceRanks = target
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value)
    .map((item, rank) => ({ ...item, priceRank: rank + 1 }))
    .sort((a, b) => a.index - b.index);

  let d2 = 0;

  for (let i = 0; i < period; i++) {
    const timeRank = period - i;
    const priceRank = priceRanks[i].priceRank;
    d2 += Math.pow(timeRank - priceRank, 2);
  }

  const rci = (1 - (6 * d2) / (period * (period * period - 1))) * 100;
  return Number(rci.toFixed(2));
}

const FALLBACK_CANDLES: ChartCandle[] = [
  { time: "2026-06-07", open: 155.1, high: 155.3, low: 154.9, close: 155.2 },
  { time: "2026-06-08", open: 155.2, high: 155.5, low: 155.0, close: 155.4 },
  { time: "2026-06-09", open: 155.4, high: 155.45, low: 155.1, close: 155.15 },
  { time: "2026-06-10", open: 155.15, high: 155.35, low: 154.95, close: 155.3 },
  { time: "2026-06-11", open: 155.3, high: 155.6, low: 155.25, close: 155.55 },
];

export default function ChartPanel({
  title,
  subtitle,
  height = 300,
  candles,
  onEmaUpdate,
  onRciUpdate,
  onPriceUpdate,
}: ChartPanelProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    const chartCandles = candles && candles.length > 0 ? candles : FALLBACK_CANDLES;

    const chart = createChart(chartRef.current, {
      height,
      layout: {
        background: { color: "#09090b" },
        textColor: "#d4d4d8",
      },
      grid: {
        vertLines: { color: "#27272a" },
        horzLines: { color: "#27272a" },
      },
      rightPriceScale: {
        borderColor: "#3f3f46",
      },
      timeScale: {
        borderColor: "#3f3f46",
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries);
    candleSeries.setData(chartCandles);

    chart.timeScale().fitContent();

    const closes = chartCandles.map((candle) => candle.close);
    const latest = chartCandles[chartCandles.length - 1];

    if (latest) {
      onPriceUpdate?.(latest.close);
    }

    onEmaUpdate?.(calcEma(closes, 9), calcEma(closes, 21));
    onRciUpdate?.(calcRci(closes, 9), calcRci(closes, 26), calcRci(closes, 52));

    return () => chart.remove();
  }, [candles, height, onEmaUpdate, onPriceUpdate, onRciUpdate]);

  return (
    <div className="h-full">
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mb-3 text-sm text-zinc-400">{subtitle}</p>
      <div ref={chartRef} />
    </div>
  );
}