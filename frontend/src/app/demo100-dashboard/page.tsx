"use client";

import { useEffect, useMemo, useState } from "react";

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

type DemoPart2Status = {
  aiVersion: string;
  targetTrades: number;
  currentCount: number;
  remainingCount: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalProfit: number;
  firstTradeAt: number | string | null;
  lastTradeAt: number | string | null;
  completed: boolean;
  message: string;
};

type RobustCandidateMatch = {
  enabled: boolean;
  candidateId: string;
  candidateName: string;
  direction: "HIGH" | "LOW";
  directionalScore: number;
  historicalSample: number;
  historicalWinRate: number;
  recentWinRate: number;
  historicalProfit: number;
  reasons: string[];
};

type RobustCandidateDecision = {
  allow: boolean;
  evaluatedCandidates: number;
  match: RobustCandidateMatch | null;
  message: string;
  reasons?: string[];
};

type ForwardCandidate = {
  id: string;
  name: string;
  direction: "HIGH" | "LOW";
  conditionLabel: string;
  historicalMatchedObservations: number;
  matchedObservations: number;
  wins: number;
  losses: number;
  draws: number;
  decided: number;
  winRate: number | null;
  profit: number;
  wilsonLowerBound: number | null;
  recentWinRate: number | null;
  recentSample: number;
  firstSecondGap: number | null;
  classification: string;
  message: string;
};

type ForwardValidationPayload = {
  ok: boolean;
  stage: string;
  newObservationsAfterBoundary: number;
  newlyCounted: number;
  candidates: ForwardCandidate[];
  summary: Record<string, number>;
  message: string;
};

type FeatureGateApplied = {
  key: string;
  label: string;
  totalTrades: number;
  winRate: number | null;
  totalProfit: number;
  action: string;
  overfitGuard?: string[];
};

type ServerAutoRunnerStatus = {
  running: boolean;
  inFlight: boolean;
  startedAt: string | null;
  stoppedAt: string | null;
  lastRunAt: string | null;
  lastResult: any | null;
  lastError: string | null;
  runCount: number;
  intervalMs: number;
  mode?: string;
  demo100?: Demo100Status;
  demoPart2?: DemoPart2Status;
  rejectShadow?: RejectShadowSummary;
  rejectShadowAnalysis?: RejectShadowAnalysis;
  shadowGateOverrides?: ShadowGateOverrideSummary;
};

type RejectShadowStage = {
  rejectStage: string;
  total: number;
  pending: number;
  settled: number;
  wins: number;
  losses: number;
  draws: number;
  expired: number;
  totalProfit: number;
  latestSettledAt: number | null;
  winRate: number | null;
};

type RejectShadowSummary = {
  trackingOnly: boolean;
  executesDemoBuy: boolean;
  changesEntryDecision: boolean;
  settlementDurationMinutes: number;
  total: number;
  pending: number;
  settled: number;
  stages: RejectShadowStage[];
  message: string;
};

type RejectShadowCandidate = {
  rejectStage: string;
  dimension: string;
  label: string;
  settled: number;
  wins: number;
  losses: number;
  draws: number;
  totalProfit: number;
  winRate: number | null;
  wilsonLowerBound: number | null;
  classification:
    | "COLLECTING"
    | "HOLD"
    | "WATCH"
    | "REVIEW_CANDIDATE"
    | "REJECT_CONTINUE";
  remainingToWatch: number;
  remainingToReview: number;
};

type RejectShadowAnalysis = {
  appliesAutomatically: boolean;
  settledShadows: number;
  reviewCandidates: number;
  candidates: RejectShadowCandidate[];
  message: string;
};

type ShadowGateOverrideCandidate = {
  candidateId: string;
  candidateName: string;
  rejectedGate: string;
  matched: number;
  postGateRejected: number;
  finalSkipped: number;
  buyExecuted: number;
  settled: number;
  monitorFailed: number;
  wins: number;
  losses: number;
  draws: number;
  totalProfit: number;
  entryConversionRate: number | null;
  winRate: number | null;
};

type ShadowGateOverrideSummary = {
  enabledForDemo2: boolean;
  changesProductionTrading: boolean;
  candidates: ShadowGateOverrideCandidate[];
};

type BreakdownItem = {
  key: string;
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
};

type PenaltyCandidate = {
  type: string;
  key: string;
  total: number;
  winRate: number;
  totalProfit: number;
  severity: "LOW" | "MEDIUM" | "HIGH";
  suggestedPenalty: number;
  reason: string;
};

type Demo100Analysis = {
  sampleSize: number;
  completed: boolean;
  penaltyCandidates: PenaltyCandidate[];
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

function formatPercent(value: number | null | undefined) {
  return value == null ? "-" : `${value}%`;
}

function formatProfit(value: number | null | undefined) {
  return value == null ? "-" : `${value} USD`;
}

function formatDate(value: number | string | null | undefined) {
  if (value == null) return "-";
  const date = typeof value === "number"
    ? new Date(value > 10_000_000_000 ? value : value * 1000)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("ja-JP");
}

function classificationStyle(value: string) {
  if (["DEMO_READY", "DEMO_CANDIDATE", "STRONG_ADOPT"].includes(value)) {
    return "bg-emerald-400 text-black";
  }
  if (["FORWARD_STRONG", "WATCH", "ROBUST_WATCH"].includes(value)) {
    return "bg-yellow-300 text-black";
  }
  if (value === "REJECT") return "bg-red-600 text-white";
  return "bg-zinc-700 text-zinc-100";
}

export default function Demo100DashboardPage() {
  const [status, setStatus] = useState<Demo100Status | null>(null);
  const [demoPart2, setDemoPart2] = useState<DemoPart2Status | null>(null);
  const [runner, setRunner] = useState<ServerAutoRunnerStatus | null>(null);
  const [phase16P, setPhase16P] = useState<ForwardValidationPayload | null>(null);
  const [phase16Q, setPhase16Q] = useState<ForwardValidationPayload | null>(null);
  const [analysis, setAnalysis] = useState<Demo100Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [runnerLoading, setRunnerLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchStatus() {
    const res = await fetch("/api/demo100/status", { cache: "no-store" });
    const data: StatusApiResponse = await res.json();
    if (!data.ok || !data.status) throw new Error(data.message ?? "ステータス取得に失敗しました");
    setStatus(data.status);
  }

  async function fetchDemoPart2() {
    const res = await fetch("/api/demo-part2/status", { cache: "no-store" });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message ?? "Demo Part2取得に失敗しました");
    setDemoPart2(data as DemoPart2Status);
  }

  async function fetchRunner() {
    const res = await fetch("/api/auto-runner/status", { cache: "no-store" });
    const data = await res.json();
    if (!data.ok || !data.status) throw new Error(data.error ?? "Auto Runner取得に失敗しました");
    setRunner(data.status);
    if (data.status.demoPart2) setDemoPart2(data.status.demoPart2);
  }

  async function fetchForwardValidation() {
    const [pRes, qRes] = await Promise.all([
      fetch("/api/market-observation-phase16-p-forward-validation", { cache: "no-store" }),
      fetch("/api/market-observation-phase16-q-forward-validation", { cache: "no-store" }),
    ]);
    const [pData, qData] = await Promise.all([pRes.json(), qRes.json()]);
    if (pData.ok) setPhase16P(pData);
    if (qData.ok) setPhase16Q(qData);
  }

  async function fetchAnalysis() {
    const res = await fetch("/api/demo100/analysis", { cache: "no-store" });
    const data: AnalysisApiResponse = await res.json();
    if (!data.ok || !data.analysis) throw new Error(data.message ?? "分析取得に失敗しました");
    setAnalysis(data.analysis);
  }

  async function fetchAll() {
    try {
      await Promise.all([
        fetchStatus(),
        fetchDemoPart2(),
        fetchRunner(),
        fetchForwardValidation(),
        fetchAnalysis(),
      ]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setLoading(false);
    }
  }

  async function startRunner() {
    try {
      setRunnerLoading(true);
      const res = await fetch("/api/auto-runner/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intervalMs: 75_000 }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? data.message ?? "Auto Runner start失敗");
      setRunner(data.status);
      if (data.status?.demoPart2) setDemoPart2(data.status.demoPart2);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auto Runner start失敗");
    } finally {
      setRunnerLoading(false);
    }
  }

  async function stopRunner() {
    try {
      setRunnerLoading(true);
      const res = await fetch("/api/auto-runner/stop", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? data.message ?? "Auto Runner stop失敗");
      setRunner(data.status);
      if (data.status?.demoPart2) setDemoPart2(data.status.demoPart2);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auto Runner stop失敗");
    } finally {
      setRunnerLoading(false);
    }
  }

  async function resetDemo100() {
    const confirmed = window.confirm(
      "100件デモ運用をリセットしますか？現在の進捗だけがリセットされ、取引履歴は削除されません。",
    );
    if (!confirmed) return;

    try {
      setResetting(true);
      const res = await fetch("/api/demo100/reset", { method: "POST" });
      const data: StatusApiResponse = await res.json();
      if (!data.ok || !data.status) throw new Error(data.message ?? "リセットに失敗しました");
      await fetchAll();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setResetting(false);
    }
  }

  useEffect(() => {
    void fetchAll();
    const timer = window.setInterval(() => void fetchAll(), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const demo100Progress =
    status && status.targetTrades > 0
      ? Math.min((status.currentCount / status.targetTrades) * 100, 100)
      : 0;
  const part2Progress =
    demoPart2 && demoPart2.targetTrades > 0
      ? Math.min((demoPart2.currentCount / demoPart2.targetTrades) * 100, 100)
      : 0;

  const lastResult = runner?.lastResult ?? null;
  const rejectShadow = runner?.rejectShadow ?? null;
  const rejectShadowAnalysis = runner?.rejectShadowAnalysis ?? null;
  const shadowGateOverrides = runner?.shadowGateOverrides ?? null;
  const robustDecision: RobustCandidateDecision | null =
    lastResult?.robustCandidateDecision ?? null;
  const robustMode = lastResult?.robustDemo2Mode ?? null;
  const matchedCandidate: RobustCandidateMatch | null =
    robustMode?.candidate ?? robustDecision?.match ?? null;

  const featureHardGates = useMemo(() => {
    const applied = (lastResult?.featureWinRateGate?.applied ?? []) as FeatureGateApplied[];
    return applied.filter((item) => item.action === "SKIP_CANDIDATE");
  }, [lastResult]);

  const patternHardGates = useMemo(() => {
    const applied = (lastResult?.patternWeight?.applied ?? []) as Array<Record<string, any>>;
    return applied.filter((item) => item.action === "SKIP_CANDIDATE");
  }, [lastResult]);

  const lastStopReason =
    lastResult?.message ??
    lastResult?.featureWinRateGate?.reasons?.join(" / ") ??
    lastResult?.patternWeight?.reasons?.join(" / ") ??
    "-";

  return (
    <main className="min-h-screen bg-zinc-950 p-4 text-white md:p-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6">
          <p className="text-sm text-zinc-400">Phase16-Q / Demo Part2 Robust Monitoring</p>
          <h1 className="text-3xl font-bold">Demo運用ダッシュボード</h1>
          <p className="mt-2 text-zinc-400">
            Demo2、Robust候補、停止Gate、Phase16-P/Q前向き検証を5秒ごとに更新します。
          </p>
        </header>

        {loading && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">読み込み中...</div>
        )}
        {error && (
          <div className="mb-4 rounded-xl border border-red-700 bg-red-950 p-4 text-red-200">
            {error}
          </div>
        )}

        {demoPart2 && (
          <section className="mb-6 rounded-xl border border-cyan-800 bg-cyan-950/40 p-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm text-cyan-200">Demo Part2 / AI Version</p>
                <p className="break-all text-lg font-bold text-cyan-100">{demoPart2.aiVersion}</p>
                <p className="mt-2 text-3xl font-black">
                  {demoPart2.currentCount} / {demoPart2.targetTrades} 件
                </p>
              </div>
              <div
                className={`rounded-full px-4 py-2 text-sm font-bold ${
                  demoPart2.completed ? "bg-emerald-400 text-black" : "bg-cyan-400 text-black"
                }`}
              >
                {demoPart2.completed ? "300件完了" : "検証中"}
              </div>
            </div>
            <div className="h-4 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full bg-cyan-400 transition-all"
                style={{ width: `${part2Progress}%` }}
              />
            </div>
            <p className="mt-3 text-sm text-zinc-300">{demoPart2.message}</p>
            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <Card title="Part2勝率" value={formatPercent(demoPart2.winRate)} />
              <Card title="Part2損益" value={formatProfit(demoPart2.totalProfit)} />
              <Card title="残り" value={`${demoPart2.remainingCount}件`} />
              <Card title="勝敗" value={`${demoPart2.wins}勝 ${demoPart2.losses}敗`} />
              <Card title="初回取引" value={formatDate(demoPart2.firstTradeAt)} />
              <Card title="最終取引" value={formatDate(demoPart2.lastTradeAt)} />
            </div>
          </section>
        )}

        <section className="mb-6 rounded-xl border border-fuchsia-700 bg-fuchsia-950/30 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-fuchsia-300">Demo2 Robust Candidate Live</p>
              <h2 className="text-2xl font-bold">現在の候補一致・取引停止理由</h2>
            </div>
            <StatusBadge
              label={
                robustMode?.enabled
                  ? "ROBUST一致"
                  : robustDecision?.allow
                    ? "候補一致"
                    : "候補不一致"
              }
              active={Boolean(robustMode?.enabled || robustDecision?.allow)}
            />
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <Card title="評価候補数" value={`${robustDecision?.evaluatedCandidates ?? 5}`} />
            <Card title="Robust Mode" value={robustMode?.enabled ? "ENABLED" : "DISABLED"} />
            <Card title="最終Stage" value={lastResult?.stage ?? "-"} />
            <Card title="使用方向" value={matchedCandidate?.direction ?? "-"} />
          </div>

          {matchedCandidate ? (
            <div className="mt-4 rounded-xl border border-emerald-700 bg-emerald-950/40 p-4">
              <p className="text-sm text-emerald-300">一致候補</p>
              <p className="mt-1 text-xl font-bold">{matchedCandidate.candidateName}</p>
              <div className="mt-3 grid gap-3 md:grid-cols-4">
                <MiniStat label="Candidate ID" value={matchedCandidate.candidateId} />
                <MiniStat label="方向Score" value={`${matchedCandidate.directionalScore}`} />
                <MiniStat label="過去勝率" value={`${matchedCandidate.historicalWinRate}%`} />
                <MiniStat label="直近勝率" value={`${matchedCandidate.recentWinRate}%`} />
                <MiniStat label="過去件数" value={`${matchedCandidate.historicalSample}件`} />
                <MiniStat label="過去Profit" value={`${matchedCandidate.historicalProfit}`} />
              </div>
              <div className="mt-3 space-y-1 text-sm text-emerald-100">
                {matchedCandidate.reasons.map((reason, index) => (
                  <p key={`${reason}-${index}`}>・{reason}</p>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-zinc-700 bg-zinc-900 p-4">
              <p className="font-bold">現在は5候補の条件外です。</p>
              <p className="mt-2 text-sm text-zinc-400">
                {robustDecision?.message ?? "Auto Runnerの次回実行を待っています。"}
              </p>
              {(robustDecision?.reasons ?? []).map((reason, index) => (
                <span
                  key={`${reason}-${index}`}
                  className="mr-2 mt-2 inline-block rounded bg-zinc-800 px-2 py-1 text-xs"
                >
                  {reason}
                </span>
              ))}
            </div>
          )}

          <div className="mt-4 rounded-xl border border-red-800 bg-red-950/50 p-4">
            <p className="text-sm font-bold text-red-200">直近の停止理由</p>
            <p className="mt-2 break-words text-sm text-red-100">{lastStopReason}</p>

            {featureHardGates.length > 0 && (
              <div className="mt-4">
                <p className="font-bold text-red-200">Feature Danger Hard Gate</p>
                <div className="mt-2 grid gap-2">
                  {featureHardGates.map((item, index) => (
                    <div
                      key={`${item.key}-${item.label}-${index}`}
                      className="rounded-lg border border-red-900 bg-zinc-950 p-3 text-sm"
                    >
                      <p className="font-bold">
                        {item.key}: {item.label}
                      </p>
                      <p className="mt-1 text-zinc-300">
                        {item.totalTrades}件 / 勝率{formatPercent(item.winRate)} / 損益
                        {item.totalProfit}
                      </p>
                      {(item.overfitGuard ?? []).map((reason, reasonIndex) => (
                        <p key={reasonIndex} className="mt-1 text-red-300">
                          {reason}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {patternHardGates.length > 0 && (
              <div className="mt-4">
                <p className="font-bold text-red-200">Pattern Danger Hard Gate</p>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs text-red-100">
                  {JSON.stringify(patternHardGates, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </section>

        {runner && (
          <section className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">Server Auto Runner</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  75秒間隔 / Demo Part2専用 / inFlight重複防止
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={startRunner}
                  disabled={runnerLoading || runner.running || demoPart2?.completed}
                  className="rounded-lg bg-emerald-500 px-4 py-2 font-bold text-black disabled:opacity-50"
                >
                  START
                </button>
                <button
                  onClick={stopRunner}
                  disabled={runnerLoading || !runner.running}
                  className="rounded-lg bg-red-600 px-4 py-2 font-bold text-white disabled:opacity-50"
                >
                  STOP
                </button>
                <button
                  onClick={() => void fetchAll()}
                  disabled={runnerLoading}
                  className="rounded-lg bg-zinc-700 px-4 py-2 font-bold text-white disabled:opacity-50"
                >
                  REFRESH
                </button>
              </div>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <Card title="稼働" value={runner.running ? "RUNNING" : "STOPPED"} />
              <Card title="InFlight" value={runner.inFlight ? "YES" : "NO"} />
              <Card title="Run Count" value={`${runner.runCount}`} />
              <Card title="Interval" value={`${runner.intervalMs / 1000}s`} />
              <Card title="Last Run" value={formatDate(runner.lastRunAt)} />
              <Card title="Last Error" value={runner.lastError ?? "なし"} />
              <Card title="Mode" value={runner.mode ?? "demo_part2"} />
              <Card title="Last Stage" value={lastResult?.stage ?? "-"} />
            </div>
          </section>
        )}

        <section className="mb-6 rounded-xl border border-amber-700 bg-amber-950/30 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-amber-300">Rejected Entry Shadow Tracker</p>
              <h2 className="text-xl font-bold">Gateで見送った候補の仮想成績</h2>
              <p className="mt-2 text-sm text-zinc-300">
                実取引せず、同じ1分条件の結果だけを記録します。AI判定にはまだ反映しません。
              </p>
            </div>
            <StatusBadge label="検証専用" active />
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <Card title="記録候補" value={`${rejectShadow?.total ?? 0}件`} />
            <Card title="結果確定" value={`${rejectShadow?.settled ?? 0}件`} />
            <Card title="判定待ち" value={`${rejectShadow?.pending ?? 0}件`} />
            <Card
              title="実取引への影響"
              value={rejectShadow?.changesEntryDecision ? "あり" : "なし"}
            />
          </div>

          {(rejectShadow?.stages.length ?? 0) > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-amber-200">
                  <tr className="border-b border-amber-800">
                    <th className="py-2">拒否Gate</th>
                    <th className="py-2">確定件数</th>
                    <th className="py-2">勝敗</th>
                    <th className="py-2">勝率</th>
                    <th className="py-2">仮想損益</th>
                    <th className="py-2">判定待ち</th>
                  </tr>
                </thead>
                <tbody>
                  {rejectShadow?.stages.map((item) => (
                    <tr key={item.rejectStage} className="border-b border-amber-950">
                      <td className="py-3 font-bold">{item.rejectStage}</td>
                      <td className="py-3">{item.settled}件</td>
                      <td className="py-3">
                        {item.wins}勝 {item.losses}敗 {item.draws}分
                      </td>
                      <td className="py-3">{formatPercent(item.winRate)}</td>
                      <td className="py-3">{formatProfit(item.totalProfit)}</td>
                      <td className="py-3">{item.pending}件</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 rounded-lg bg-zinc-950 p-4 text-sm text-zinc-400">
              新機能の開始後に拒否候補が発生すると、ここへ成績が表示されます。
            </p>
          )}

          <div className="mt-6 border-t border-amber-900 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold">条件別Shadow Analyzer</h3>
                <p className="mt-1 text-sm text-zinc-400">
                  Score帯・方向・RCI・時間・曜日・セッション別に取り逃しを探します。
                </p>
              </div>
              <div className="rounded-full bg-zinc-800 px-3 py-1 text-sm">
                通過検討候補 {rejectShadowAnalysis?.reviewCandidates ?? 0}件
              </div>
            </div>

            {(rejectShadowAnalysis?.candidates.length ?? 0) > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="text-amber-200">
                    <tr className="border-b border-amber-800">
                      <th className="py-2">拒否Gate</th>
                      <th className="py-2">条件</th>
                      <th className="py-2">件数</th>
                      <th className="py-2">勝率</th>
                      <th className="py-2">仮想損益</th>
                      <th className="py-2">信頼下限</th>
                      <th className="py-2">判定</th>
                      <th className="py-2">30件まで</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rejectShadowAnalysis?.candidates.slice(0, 20).map((item) => (
                      <tr
                        key={`${item.rejectStage}-${item.dimension}-${item.label}`}
                        className="border-b border-amber-950"
                      >
                        <td className="max-w-[260px] py-3 text-xs">
                          {item.rejectStage}
                        </td>
                        <td className="py-3 font-bold">
                          {item.dimension}: {item.label}
                        </td>
                        <td className="py-3">{item.settled}件</td>
                        <td className="py-3">{formatPercent(item.winRate)}</td>
                        <td className="py-3">{formatProfit(item.totalProfit)}</td>
                        <td className="py-3">
                          {formatPercent(item.wilsonLowerBound)}
                        </td>
                        <td className="py-3">{item.classification}</td>
                        <td className="py-3">{item.remainingToWatch}件</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-4 text-sm text-zinc-400">
                Shadow結果が確定すると条件別分析を開始します。
              </p>
            )}
          </div>
        </section>

        <section className="mb-6 rounded-xl border border-emerald-700 bg-emerald-950/30 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-emerald-300">Demo2 Shadow Gate Overrides</p>
              <h2 className="text-xl font-bold">例外通過から実約定までの乖離監視</h2>
              <p className="mt-2 text-sm text-zinc-300">
                条件一致数、後段Gate停止、最終判定停止、実約定、実勝率を候補別に比較します。
              </p>
            </div>
            <StatusBadge
              label={shadowGateOverrides?.enabledForDemo2 ? "Demo2有効" : "待機中"}
              active={Boolean(shadowGateOverrides?.enabledForDemo2)}
            />
          </div>

          {(shadowGateOverrides?.candidates.length ?? 0) > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[1050px] text-left text-sm">
                <thead className="text-emerald-200">
                  <tr className="border-b border-emerald-800">
                    <th className="py-2">候補</th>
                    <th className="py-2">一致</th>
                    <th className="py-2">後段停止</th>
                    <th className="py-2">最終停止</th>
                    <th className="py-2">実約定</th>
                    <th className="py-2">約定率</th>
                    <th className="py-2">実勝敗</th>
                    <th className="py-2">実勝率</th>
                    <th className="py-2">実損益</th>
                  </tr>
                </thead>
                <tbody>
                  {shadowGateOverrides?.candidates.map((item) => (
                    <tr key={item.candidateId} className="border-b border-emerald-950">
                      <td className="py-3 font-bold">{item.candidateName}</td>
                      <td className="py-3">{item.matched}</td>
                      <td className="py-3">{item.postGateRejected}</td>
                      <td className="py-3">{item.finalSkipped}</td>
                      <td className="py-3">{item.buyExecuted}</td>
                      <td className="py-3">{formatPercent(item.entryConversionRate)}</td>
                      <td className="py-3">
                        {item.wins}勝 {item.losses}敗 {item.draws}分
                      </td>
                      <td className="py-3">{formatPercent(item.winRate)}</td>
                      <td className="py-3">{formatProfit(item.totalProfit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 rounded-lg bg-zinc-950 p-4 text-sm text-zinc-400">
              例外候補が一致すると、ここへ実運用との比較結果が表示されます。
            </p>
          )}
        </section>

        <ForwardSection title="Phase16-P 前向き検証" payload={phase16P} />
        <ForwardSection title="Phase16-Q 前向き検証" payload={phase16Q} />

        {status && (
          <>
            <section className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
              <div className="mb-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-zinc-400">Demo100 進捗</p>
                  <p className="text-2xl font-bold">
                    {status.currentCount} / {status.targetTrades} 件
                  </p>
                </div>
                <div
                  className={`rounded-full px-4 py-2 text-sm font-bold ${
                    status.completed ? "bg-emerald-500 text-black" : "bg-cyan-500 text-black"
                  }`}
                >
                  {status.completed ? "完了" : "運用中"}
                </div>
              </div>
              <div className="h-4 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full bg-cyan-400 transition-all"
                  style={{ width: `${demo100Progress}%` }}
                />
              </div>
              <p className="mt-3 text-sm text-zinc-400">{status.message}</p>
            </section>

            <div className="grid gap-4 md:grid-cols-3">
              <Card title="現在勝率" value={`${status.winRate}%`} />
              <Card title="利益" value={`${status.totalProfit} USD`} />
              <Card title="残り件数" value={`${status.remainingCount}件`} />
              <Card title="勝ち" value={`${status.wins}件`} />
              <Card title="負け" value={`${status.losses}件`} />
              <Card title="引き分け" value={`${status.draws}件`} />
              <Card title="現在連勝" value={`${status.currentWinStreak}連勝`} />
              <Card title="現在連敗" value={`${status.currentLoseStreak}連敗`} />
              <Card title="状態" value={status.completed ? "AI分析待ち" : "デモ学習中"} />
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
                <Card title="分析状態" value={analysis.completed ? "確定分析OK" : "仮分析"} />
              </div>
            </section>

            <section className="rounded-xl border border-yellow-700 bg-yellow-950 p-6">
              <h2 className="text-xl font-bold text-yellow-200">勝率改善レコメンド</h2>
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
                <p className="mt-3 text-zinc-300">現時点で明確な減点候補はありません。</p>
              )}
            </section>

            <section className="rounded-xl border border-red-800 bg-red-950 p-6">
              <h2 className="text-xl font-bold text-red-200">Entry Gate 減点候補</h2>
              {analysis.penaltyCandidates.length > 0 ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="text-red-200">
                      <tr className="border-b border-red-800">
                        <th className="py-2">種類</th>
                        <th className="py-2">条件</th>
                        <th className="py-2">件数</th>
                        <th className="py-2">勝率</th>
                        <th className="py-2">損益</th>
                        <th className="py-2">危険度</th>
                        <th className="py-2">推奨減点</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.penaltyCandidates.map((candidate, index) => (
                        <tr
                          key={`${candidate.type}-${candidate.key}-${index}`}
                          className="border-b border-red-900"
                        >
                          <td className="py-2">{candidate.type}</td>
                          <td className="py-2 font-bold">{candidate.key}</td>
                          <td className="py-2">{candidate.total}</td>
                          <td className="py-2">{candidate.winRate}%</td>
                          <td className="py-2">{candidate.totalProfit} USD</td>
                          <td className="py-2">{candidate.severity}</td>
                          <td className="py-2 font-bold">{candidate.suggestedPenalty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-3 text-red-100">
                  まだ減点候補はありません。最低5件以上たまった条件から判定します。
                </p>
              )}
            </section>

            <AnalysisTable title="通貨/銘柄別" rows={analysis.breakdowns.byPair} />
            <AnalysisTable title="方向別" rows={analysis.breakdowns.byDirection} />
            <AnalysisTable title="時間帯別" rows={analysis.breakdowns.byHour} />
            <AnalysisTable title="セッション別" rows={analysis.breakdowns.bySession} />
            <AnalysisTable title="相場状態別" rows={analysis.breakdowns.byMarketPhase} />
            <AnalysisTable title="Final Score帯別" rows={analysis.breakdowns.byFinalScoreBand} />
          </div>
        )}

        {status && (
          <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="text-xl font-bold">次の判断</h2>
            <p className="mt-2 text-zinc-300">
              Demo Part2は300件まで本番運用せず、Robust候補とDanger Hard Gateの結果を記録します。
            </p>
            <button
              onClick={resetDemo100}
              disabled={resetting}
              className="mt-4 rounded-lg bg-red-600 px-4 py-2 font-bold text-white disabled:opacity-50"
            >
              {resetting ? "リセット中..." : "100件デモをリセット"}
            </button>
          </section>
        )}
      </div>
    </main>
  );
}

function ForwardSection({
  title,
  payload,
}: {
  title: string;
  payload: ForwardValidationPayload | null;
}) {
  return (
    <section className="mb-6 rounded-xl border border-blue-800 bg-blue-950/30 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-blue-300">Market Observation Forward Validation</p>
          <h2 className="text-xl font-bold">{title}</h2>
        </div>
        <div className="rounded-full bg-blue-400 px-3 py-1 text-sm font-bold text-black">
          新規Observation {payload?.newObservationsAfterBoundary ?? 0}
        </div>
      </div>

      {!payload ? (
        <p className="mt-4 text-zinc-400">取得中...</p>
      ) : (
        <>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Card title="今回新規計上" value={`${payload.newlyCounted}件`} />
            <Card title="候補数" value={`${payload.candidates.length}件`} />
            <Card
              title="50件以上候補"
              value={`${payload.candidates.filter((item) => item.decided >= 50).length}件`}
            />
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="text-blue-200">
                <tr className="border-b border-blue-800">
                  <th className="py-2">候補</th>
                  <th className="py-2">方向</th>
                  <th className="py-2">前向き件数</th>
                  <th className="py-2">勝敗</th>
                  <th className="py-2">勝率</th>
                  <th className="py-2">直近勝率</th>
                  <th className="py-2">Profit</th>
                  <th className="py-2">Wilson下限</th>
                  <th className="py-2">前後差</th>
                  <th className="py-2">判定</th>
                </tr>
              </thead>
              <tbody>
                {payload.candidates.map((candidate) => (
                  <tr key={candidate.id} className="border-b border-blue-950 align-top">
                    <td className="max-w-[320px] py-3">
                      <p className="font-bold">{candidate.name}</p>
                      <p className="mt-1 text-xs text-zinc-400">{candidate.conditionLabel}</p>
                    </td>
                    <td className="py-3 font-bold">{candidate.direction}</td>
                    <td className="py-3">
                      {candidate.matchedObservations}件
                      <p className="text-xs text-zinc-500">
                        過去一致 {candidate.historicalMatchedObservations}
                      </p>
                    </td>
                    <td className="py-3">
                      {candidate.wins}勝 {candidate.losses}敗 {candidate.draws}分
                    </td>
                    <td className="py-3 font-bold">{formatPercent(candidate.winRate)}</td>
                    <td className="py-3">
                      {formatPercent(candidate.recentWinRate)}
                      <p className="text-xs text-zinc-500">{candidate.recentSample}件</p>
                    </td>
                    <td className="py-3">{candidate.profit}</td>
                    <td className="py-3">{formatPercent(candidate.wilsonLowerBound)}</td>
                    <td className="py-3">
                      {candidate.firstSecondGap == null ? "-" : `${candidate.firstSecondGap}pt`}
                    </td>
                    <td className="py-3">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${classificationStyle(
                          candidate.classification,
                        )}`}
                      >
                        {candidate.classification}
                      </span>
                      <p className="mt-2 max-w-[250px] text-xs text-zinc-400">
                        {candidate.message}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function StatusBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={`rounded-full px-4 py-2 text-sm font-bold ${
        active ? "bg-emerald-400 text-black" : "bg-zinc-700 text-white"
      }`}
    >
      {label}
    </span>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-950/70 p-3">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className="mt-1 break-all font-bold">{value}</p>
    </div>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-sm text-zinc-400">{title}</p>
      <p className="mt-2 break-words text-xl font-bold">{value}</p>
    </div>
  );
}

function AnalysisTable({ title, rows }: { title: string; rows: BreakdownItem[] }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="text-xl font-bold">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-zinc-400">データなし</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="text-zinc-300">
              <tr className="border-b border-zinc-700">
                <th className="py-2">条件</th>
                <th className="py-2">件数</th>
                <th className="py-2">勝ち</th>
                <th className="py-2">負け</th>
                <th className="py-2">勝率</th>
                <th className="py-2">損益</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.key}-${index}`} className="border-b border-zinc-800">
                  <td className="py-2 font-bold">{row.key}</td>
                  <td className="py-2">{row.total}</td>
                  <td className="py-2">{row.wins}</td>
                  <td className="py-2">{row.losses}</td>
                  <td className="py-2">{row.winRate}%</td>
                  <td className="py-2">{row.totalProfit} USD</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
