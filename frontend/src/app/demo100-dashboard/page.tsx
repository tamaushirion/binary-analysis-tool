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

type ApiResponse = {
  ok: boolean;
  stage: string;
  status?: Demo100Status;
  message?: string;
};

export default function Demo100DashboardPage() {
  const [status, setStatus] = useState<Demo100Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchStatus() {
    try {
      const res = await fetch("/api/demo100/status", {
        cache: "no-store",
      });

      const data: ApiResponse = await res.json();

      if (!data.ok || !data.status) {
        throw new Error(data.message ?? "ステータス取得に失敗しました");
      }

      setStatus(data.status);
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

      const data: ApiResponse = await res.json();

      if (!data.ok || !data.status) {
        throw new Error(data.message ?? "リセットに失敗しました");
      }

      setStatus(data.status);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setResetting(false);
    }
  }

  useEffect(() => {
    fetchStatus();

    const timer = setInterval(() => {
      fetchStatus();
    }, 5000);

    return () => clearInterval(timer);
  }, []);

  const progress =
    status && status.targetTrades > 0
      ? Math.min((status.currentCount / status.targetTrades) * 100, 100)
      : 0;

  return (
    <main className="min-h-screen bg-zinc-950 p-6 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <p className="text-sm text-zinc-400">Phase14-B</p>
          <h1 className="text-3xl font-bold">100件デモ運用ダッシュボード</h1>
          <p className="mt-2 text-zinc-400">
            勝率改善のため、100件のデモ結果を集計します。
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

            <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
              <h2 className="text-xl font-bold">次の判断</h2>

              {status.completed ? (
                <p className="mt-2 text-emerald-300">
                  100件完了済みです。次はPhase14-Cで、勝率改善だけを目的にAI分析します。
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
          </>
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