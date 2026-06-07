"use client";

import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries } from "lightweight-charts";

type ChartPanelProps = {
  title: string;
  subtitle: string;
  height?: number;
};

export default function ChartPanel({
  title,
  subtitle,
  height = 300,
}: ChartPanelProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;

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
    });

    const candleSeries = chart.addSeries(CandlestickSeries);

    candleSeries.setData([
      { time: "2026-06-07", open: 155.1, high: 155.3, low: 154.9, close: 155.2 },
      { time: "2026-06-08", open: 155.2, high: 155.5, low: 155.0, close: 155.4 },
      { time: "2026-06-09", open: 155.4, high: 155.45, low: 155.1, close: 155.15 },
      { time: "2026-06-10", open: 155.15, high: 155.35, low: 154.95, close: 155.3 },
      { time: "2026-06-11", open: 155.3, high: 155.6, low: 155.25, close: 155.55 },
    ]);

    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [height]);

  return (
    <div className="h-full">
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="text-sm text-gray-400 mb-3">{subtitle}</p>
      <div ref={chartRef} />
    </div>
  );
}