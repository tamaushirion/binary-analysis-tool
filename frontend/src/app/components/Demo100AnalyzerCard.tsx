"use client";

import { useEffect, useMemo, useState } from "react";

type AnalyzerBucket = {
  label: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
  avgProfit: number;
};

type Demo100Analysis = {
  ok: boolean;
  stage: string;
  analyzedTrades: number;
  overall: {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalProfit: number;
    avgProfit: number;
    maxWinStreak: number;
    maxLoseStreak: number;
  };
  best?: {
    hour?: AnalyzerBucket;
    direction?: AnalyzerBucket;
    scoreBand?: AnalyzerBucket;
  };
  worst?: {
    hour?: AnalyzerBucket;
    direction?: AnalyzerBucket;
    scoreBand?: AnalyzerBucket;
  };
  breakdowns?: {
    byHour?: AnalyzerBucket[];
    byPair?: AnalyzerBucket[];
    byDirection?: AnalyzerBucket[];
    byScoreBand?: AnalyzerBucket[];
    byFinalScoreBand?: AnalyzerBucket[];
  };
  recommendations?: string[];
  message?: string;
};

function miniTone(winRate?: number) {
  if (typeof winRate !== "number") return "text-zinc-100";
  if (winRate >= 60) return "text-emerald-400";
  if (winRate >= 55) return "text-cyan-400";
  if (winRate >= 50) return "text-yellow-400";
  return "text-red-400";
}

function fmtPct(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${Number(value.toFixed(2))}%`;
}

function fmtNum(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return Number(value.toFixed(4));
}

function StatBox({
  label,
  value,
  className = "text-zinc-100",
}: {
  label: string;
  value: string | number;
  className?: string;
}) {
  return (
    <div className="rounded-xl bg-zinc-900 p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-1 text-xl font-black ${className}`}>{value}</p>
    </div>
  );
}

function BucketLine({ label, bucket }: { label: string; bucket?: AnalyzerBucket }) {
  return (
    <div className="rounded-xl bg-zinc-900 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold text-zinc-500">{label}</p>
        <p className="text-xs text-zinc-500">{bucket?.totalTrades ?? 0}件</p>
      </div>
      <p className="mt-1 text-sm font-black text-zinc-100">
        {bucket?.label ?? "-"}
      </p>
      <p className={`mt-1 text-lg font-black ${miniTone(bucket?.winRate)}`}>
        {fmtPct(bucket?.winRate)}
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        Profit: {fmtNum(bucket?.totalProfit)} / Avg: {fmtNum(bucket?.avgProfit)}
      </p>
    </div>
  );
}

export default function Demo100AnalyzerCard() {
  const [analysis, setAnalysis] = useState<Demo100Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadAnalysis() {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/demo100/analyze", {
        method: "GET",
        cache: "no-store",
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? data.message ?? "Demo100分析取得失敗");
      }

      setAnalysis(data);
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? "Demo100分析取得失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAnalysis();
  }, []);

  const bestScoreBand = useMemo(() => {
    return analysis?.breakdowns?.byScoreBand?.[0] ?? analysis?.best?.scoreBand;
  }, [analysis]);

  const worstScoreBand = useMemo(() => {
    const list = analysis?.breakdowns?.byScoreBand ?? [];
    return list.length > 0 ? list[list.length - 1] : undefined;
  }, [analysis]);

  return (
    <section className="rounded-2xl border border-cyan-900/70 bg-cyan-950/10 p-4 shadow-lg shadow-black/30">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-cyan-300">
            Demo100 Analyzer
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            100件の実績から、勝率が高い条件と危険条件を表示
          </p>
        </div>

        <button
          onClick={loadAnalysis}
          disabled={loading}
          className="rounded-xl bg-cyan-600 px-3 py-2 text-xs font-black hover:bg-cyan-500 disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          {loading ? "LOADING" : "ANALYZE"}
        </button>
      </div>

      {error && (
        <p className="rounded-xl bg-red-500/10 p-3 text-xs font-bold text-red-300">
          {error}
        </p>
      )}

      {!analysis && !error && (
        <p className="rounded-xl bg-zinc-900 p-3 text-xs text-zinc-400">
          Demo100分析を読み込み中...
        </p>
      )}

      {analysis && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatBox
              label="総合勝率"
              value={fmtPct(analysis.overall.winRate)}
              className={miniTone(analysis.overall.winRate)}
            />
            <StatBox
              label="総利益"
              value={fmtNum(analysis.overall.totalProfit)}
              className={
                analysis.overall.totalProfit >= 0
                  ? "text-emerald-400"
                  : "text-red-400"
              }
            />
            <StatBox
              label="最大連勝"
              value={analysis.overall.maxWinStreak}
              className="text-emerald-400"
            />
            <StatBox
              label="最大連敗"
              value={analysis.overall.maxLoseStreak}
              className="text-red-400"
            />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <BucketLine label="ベスト時間帯" bucket={analysis.best?.hour} />
            <BucketLine label="ワースト時間帯" bucket={analysis.worst?.hour} />
            <BucketLine label="おすすめ方向" bucket={analysis.best?.direction} />
            <BucketLine label="ベストScore帯" bucket={bestScoreBand} />
            <BucketLine label="危険Score帯" bucket={worstScoreBand} />
            <BucketLine
              label="FinalScoreベスト"
              bucket={analysis.breakdowns?.byFinalScoreBand?.[0]}
            />
          </div>

          <div className="mt-3 rounded-xl bg-zinc-900 p-3">
            <p className="text-xs font-black text-zinc-500">AI改善提案</p>
            <ul className="mt-2 space-y-1 text-xs font-bold text-zinc-300">
              {(analysis.recommendations ?? []).map((item) => (
                <li key={item}>・{item}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
