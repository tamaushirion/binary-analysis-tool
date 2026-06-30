"use client";

import { useEffect, useState } from "react";

type Demo100Status = {
  enabled: boolean;
  targetTrades: number;
  currentCount: number;
  remainingCount: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  totalProfit: number;
  currentWinStreak: number;
  currentLoseStreak: number;
  completed: boolean;
  message: string;
};

type BreakdownItem = {
  key: string;
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
};

type Demo100Analysis = {
  sampleSize: number;
  completed: boolean;
  overall: {
    total: number;
    wins: number;
    losses: number;
    winRate: number;
    totalProfit: number;
  };
  breakdowns: {
    byPair: BreakdownItem[];
    byDirection: BreakdownItem[];
    byHour: BreakdownItem[];
    bySession: BreakdownItem[];
    byMarketPhase: BreakdownItem[];
    byFinalScoreBand: BreakdownItem[];
  };
  recommendations: string[];
  message: string;
};

type StatusApiResponse = {
  ok: boolean;
  stage: string;
  status?: Demo100Status;
  message?: string;
};

type AnalysisApiResponse = {
  ok: boolean;
  stage: string;
  analysis?: Demo100Analysis;
  message?: string;
};

export default function Demo100DashboardPage() {
  const [status, setStatus] = useState<Demo100Status | null>(null);
  const [analysis, setAnalysis] = useState<Demo100Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchStatus() {
    const res = await fetch("/api/demo100/status", { cache: "no-store" });
    const data: StatusApiResponse = await res.json();

    if (!data.ok || !data.status) {
      throw new Error(data.message ?? "ステータス取得に失敗しました");
    }

    setStatus(data.status);
  }

  async function fetchAnalysis() {
    const res = await fetch("/api/demo100/analysis", { cache: "no-store" });
    const data: AnalysisApiResponse = await res.json();

    if (!data.ok || !data.analysis) {
      throw new Error(data.message ?? "分析取得に失敗しました");
    }

    setAnalysis(data.analysis);
  }

  async function fetchAll() {
    try {
      await Promise.all([fetchStatus(), fetchAnalysis()]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setLoading(false);
    }
  }

  async function resetDemo100() {
    const confirmed = window.confirm(
      "100件デモ運用をリセットしますか？現在の進捗だけがリセットされ、取引履歴は削除されません。"
    );

    if (!confirmed) return;

    try {
      setResetting(true);

      const res = await fetch("/api/demo100/reset", {
        method: "POST",
      });

      const data: StatusApiResponse = await res.json();

      if (!data.ok || !data.status) {
        throw new Error(data.message ?? "リセットに失敗しました");
      }

      await fetchAll();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setResetting(false);
    }
  }

  useEffect(() => {
    fetchAll();

    const timer = setInterval(() => {
      fetchAll();
    }, 5000);

    return () => clearInterval(timer);
  }, []);

  const progress =
    status && status.targetTrades > 0
      ? Math.min((status.currentCount / status.targetTrades) * 100, 100)
      : 0;

  return (
    <main className="min-h-screen bg-zinc-950 p-6 text-white">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <p className="text-sm text-zinc-400">Phase14-C-2</p>
          <h1 className="text-3xl font-bold">100件デモ運用ダッシュボード</h1>
          <p className="mt-2 text-zinc-400">
            勝率改善のため、100件のデモ結果を集計・分析します。
          </p>
        </div>

        {loading && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            読み込み中...
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-xl border border-red-700 bg-red-950 p-4 text-red-200">
            {error}
          </div>
        )}

        {status && (
          <>
            <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
              <div className="mb-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-zinc-400">進捗</p>
                  <p className="text-2xl font-bold">
                    {status.currentCount} / {status.targetTrades} 件
                  </p>
                </div>

                <div
                  className={`rounded-full px-4 py-2 text-sm font-bold ${
                    status.completed
                      ? "bg-emerald-500 text-black"
                      : "bg-cyan-500 text-black"
                  }`}
                >
                  {status.completed ? "完了" : "運用中"}
                </div>
              </div>

              <div className="h-4 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full bg-cyan-400 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <p className="mt-3 text-sm text-zinc-400">{status.message}</p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Card title="現在勝率" value={`${status.winRate}%`} />
              <Card title="利益" value={`${status.totalProfit} USD`} />
              <Card title="残り件数" value={`${status.remainingCount}件`} />
              <Card title="勝ち" value={`${status.wins}件`} />
              <Card title="負け" value={`${status.losses}件`} />
              <Card title="引き分け" value={`${status.draws}件`} />
              <Card title="現在連勝" value={`${status.currentWinStreak}連勝`} />
              <Card title="現在連敗" value={`${status.currentLoseStreak}連敗`} />
              <Card
                title="状態"
                value={status.completed ? "AI分析待ち" : "デモ学習中"}
              />
            </div>
          </>
        )}

        {analysis && (
          <div className="mt-6 space-y-6">
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
              <h2 className="text-xl font-bold">AI分析サマリー</h2>
              <p className="mt-2 text-zinc-400">{analysis.message}</p>

              <div className="mt-4 grid gap-4 md:grid-cols-4">
                <Card title="分析件数" value={`${analysis.sampleSize}件`} />
                <Card title="分析勝率" value={`${analysis.overall.winRate}%`} />
                <Card title="分析利益" value={`${analysis.overall.totalProfit} USD`} />
                <Card
                  title="分析状態"
                  value={analysis.completed ? "確定分析OK" : "仮分析"}
                />
              </div>
            </section>

            <section className="rounded-xl border border-yellow-700 bg-yellow-950 p-6">
              <h2 className="text-xl font-bold text-yellow-200">
                勝率改善レコメンド
              </h2>

              {analysis.recommendations.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {analysis.recommendations.map((rec, index) => (
                    <div
                      key={index}
                      className="rounded-lg border border-yellow-800 bg-zinc-950 p-3 text-sm text-yellow-100"
                    >
                      {rec}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-zinc-300">
                  現時点で明確な減点候補はありません。
                </p>
              )}
            </section>

            <AnalysisTable title="通貨/銘柄別" rows={analysis.breakdowns.byPair} />
            <AnalysisTable title="方向別" rows={analysis.breakdowns.byDirection} />
            <AnalysisTable title="時間帯別" rows={analysis.breakdowns.byHour} />
            <AnalysisTable title="セッション別" rows={analysis.breakdowns.bySession} />
            <AnalysisTable
              title="相場状態別"
              rows={analysis.breakdowns.byMarketPhase}
            />
            <AnalysisTable
              title="Final Score帯別"
              rows={analysis.breakdowns.byFinalScoreBand}
            />
          </div>
        )}

        {status && (
          <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="text-xl font-bold">次の判断</h2>

            {status.completed ? (
              <p className="mt-2 text-emerald-300">
                100件完了済みです。Phase14-Cの分析結果をもとに、弱い条件をEntry
                Gateで減点します。
              </p>
            ) : (
              <p className="mt-2 text-zinc-300">
                まだデモ運用中です。本番運用せず、100件まで学習データを貯めます。
              </p>
            )}

            <button
              onClick={resetDemo100}
              disabled={resetting}
              className="mt-4 rounded-lg bg-red-600 px-4 py-2 font-bold text-white disabled:opacity-50"
            >
              {resetting ? "リセット中..." : "100件デモをリセット"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-sm text-zinc-400">{title}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}

function AnalysisTable({
  title,
  rows,
}: {
  title: string;
  rows: BreakdownItem[];
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="text-xl font-bold">{title}</h2>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-zinc-400">
            <tr className="border-b border-zinc-800">
              <th className="py-2">条件</th>
              <th className="py-2">件数</th>
              <th className="py-2">勝ち</th>
              <th className="py-2">負け</th>
              <th className="py-2">勝率</th>
              <th className="py-2">利益</th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((row) => (
                <tr key={row.key} className="border-b border-zinc-800">
                  <td className="py-2 font-bold">{row.key}</td>
                  <td className="py-2">{row.total}</td>
                  <td className="py-2 text-emerald-300">{row.wins}</td>
                  <td className="py-2 text-red-300">{row.losses}</td>
                  <td className="py-2">{row.winRate}%</td>
                  <td className="py-2">{row.totalProfit} USD</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="py-4 text-zinc-400" colSpan={6}>
                  まだデータがありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}