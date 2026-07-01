"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { UTCTimestamp } from "lightweight-charts";

import ChartPanel from "./components/ChartPanel";
import Demo100AnalyzerCard from "./components/Demo100AnalyzerCard";

import {
  backtestRealCandles,
  calcBacktestStats,
  type Candle,
  type Signal,
} from "./lib/backtest";
import { detectSMC } from "./lib/smc";
import { aggregateCandles } from "./lib/timeframe";

type DerivAssetConfig = {
  pair: string;
  symbol: string;
  category: "synthetic" | "forex";
  demoPriority: number;
  supportedOneMinute: boolean;
  note: string;
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
  demo100?: {
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
};

const DERIV_ASSETS: DerivAssetConfig[] = [
  {
    pair: "Volatility 100 Index",
    symbol: "R_100",
    category: "synthetic",
    demoPriority: 1,
    supportedOneMinute: true,
    note: "Demo100優先 / 1分対応確認済み",
  },
  {
    pair: "Volatility 75 Index",
    symbol: "R_75",
    category: "synthetic",
    demoPriority: 2,
    supportedOneMinute: true,
    note: "Demo100優先",
  },
  {
    pair: "Volatility 50 Index",
    symbol: "R_50",
    category: "synthetic",
    demoPriority: 3,
    supportedOneMinute: true,
    note: "Demo100優先",
  },
  {
    pair: "Volatility 25 Index",
    symbol: "R_25",
    category: "synthetic",
    demoPriority: 4,
    supportedOneMinute: true,
    note: "Demo100優先",
  },
  {
    pair: "Volatility 10 Index",
    symbol: "R_10",
    category: "synthetic",
    demoPriority: 5,
    supportedOneMinute: true,
    note: "Demo100優先",
  },
  {
    pair: "USD/JPY",
    symbol: "frxUSDJPY",
    category: "forex",
    demoPriority: 100,
    supportedOneMinute: false,
    note: "Deriv 1分非対応のためDemo BuyはSKIP",
  },
  {
    pair: "EUR/USD",
    symbol: "frxEURUSD",
    category: "forex",
    demoPriority: 101,
    supportedOneMinute: false,
    note: "Deriv 1分非対応ならSKIP",
  },
  {
    pair: "GBP/USD",
    symbol: "frxGBPUSD",
    category: "forex",
    demoPriority: 102,
    supportedOneMinute: false,
    note: "Deriv 1分非対応ならSKIP",
  },
  {
    pair: "EUR/GBP",
    symbol: "frxEURGBP",
    category: "forex",
    demoPriority: 103,
    supportedOneMinute: false,
    note: "Deriv 1分非対応ならSKIP",
  },
  {
    pair: "GBP/JPY",
    symbol: "frxGBPJPY",
    category: "forex",
    demoPriority: 104,
    supportedOneMinute: false,
    note: "Deriv 1分非対応ならSKIP",
  },
  {
    pair: "EUR/JPY",
    symbol: "frxEURJPY",
    category: "forex",
    demoPriority: 105,
    supportedOneMinute: false,
    note: "Deriv 1分非対応ならSKIP",
  },
];

const PAIRS = DERIV_ASSETS.map((asset) => asset.pair);

const MAIN_DURATION = 1;
const MAIN_DURATION_UNIT = "m" as const;
const MIN_CONFIDENCE = 75;
const COLD_START_DEMO_SCORE = 85;
const COLD_START_DEMO_DIRECTION = "LOW" as const;
const SAME_SIGNAL_COOLDOWN_MS = 5 * 60 * 1000;
const DERIV_ACCOUNT_ID = "DOT93536475";

function getDerivAsset(pair: string) {
  return DERIV_ASSETS.find((asset) => asset.pair === pair) ?? DERIV_ASSETS[0];
}

function normalizeSymbol(symbol: string) {
  return symbol;
}

async function fetchTwelveDataCandles(symbol: string): Promise<Candle[]> {
  const apiKey = process.env.NEXT_PUBLIC_TWELVE_DATA_API_KEY;

  if (!apiKey) {
    throw new Error("Twelve Data APIキーがありません");
  }

  const url =
    `https://api.twelvedata.com/time_series` +
    `?symbol=${encodeURIComponent(normalizeSymbol(symbol))}` +
    `&interval=1min` +
    `&outputsize=200` +
    `&timezone=Asia/Tokyo` +
    `&apikey=${apiKey}` +
    `&cache_bust=${Date.now()}`;

  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();

  if (!res.ok || data.status === "error" || !data.values) {
    throw new Error(data.message || "Twelve Dataデータ取得失敗");
  }

  return data.values
    .map((item: any) => ({
      time: Math.floor(new Date(item.datetime).getTime() / 1000) as UTCTimestamp,
      open: Number(item.open),
      high: Number(item.high),
      low: Number(item.low),
      close: Number(item.close),
    }))
    .reverse();
}

function calcSimpleAtr(candles: Candle[], period = 14) {
  if (candles.length < period + 1) return 0;

  const target = candles.slice(-(period + 1));
  const trs: number[] = [];

  for (let i = 1; i < target.length; i++) {
    const current = target[i];
    const prev = target[i - 1];

    trs.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - prev.close),
        Math.abs(current.low - prev.close)
      )
    );
  }

  return trs.reduce((sum, value) => sum + value, 0) / trs.length;
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function Card({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-zinc-800 bg-zinc-950 p-4 shadow-lg shadow-black/30 ${className}`}
    >
      <h2 className="mb-3 text-sm font-black uppercase tracking-wide text-zinc-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: string | number;
  tone?: "normal" | "good" | "bad" | "warn" | "info";
}) {
  const color =
    tone === "good"
      ? "text-emerald-400"
      : tone === "bad"
      ? "text-red-400"
      : tone === "warn"
      ? "text-yellow-400"
      : tone === "info"
      ? "text-cyan-400"
      : "text-zinc-100";

  return (
    <div className="rounded-xl bg-zinc-900 p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-1 text-xl font-black ${color}`}>{value}</p>
    </div>
  );
}

function Pill({ label, active }: { label: string; active: boolean }) {
  return (
    <div
      className={
        active
          ? "rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-300"
          : "rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-bold text-zinc-400"
      }
    >
      {active ? "● " : "○ "}
      {label}
    </div>
  );
}

export default function Home() {
  const [selectedPair, setSelectedPair] = useState("Volatility 100 Index");
  const [realCandles, setRealCandles] = useState<Candle[]>([]);
  const [price, setPrice] = useState("-");
  const [ema9, setEma9] = useState(0);
  const [ema21, setEma21] = useState(0);
  const [rci9, setRci9] = useState(0);
  const [rci26, setRci26] = useState(0);
  const [rci52, setRci52] = useState(0);

  const [isLoading, setIsLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
  const [lastEngineResult, setLastEngineResult] = useState<any>(null);
  const [engineRunning, setEngineRunning] = useState(false);

  const [serverRunnerStatus, setServerRunnerStatus] =
  useState<ServerAutoRunnerStatus | null>(null);
  const isServerAutoRunning = !!serverRunnerStatus?.running;
  const [serverRunnerLoading, setServerRunnerLoading] = useState(false);
  const [serverRunnerError, setServerRunnerError] = useState<string | null>(null);

  const inFlightRef = useRef(false);
  const lastEntryRef = useRef<Record<string, number>>({});

  const selectedDerivAsset = useMemo(
    () => getDerivAsset(selectedPair),
    [selectedPair]
  );

  const isSynthetic = selectedDerivAsset.category === "synthetic";
  const isOneMinuteTradable = selectedDerivAsset.supportedOneMinute;

  const candles5m = useMemo(
    () => aggregateCandles(realCandles.slice(-300), 5),
    [realCandles]
  );

  const candles15m = useMemo(
    () => aggregateCandles(realCandles.slice(-600), 15),
    [realCandles]
  );

  const smc = useMemo(() => detectSMC(realCandles.slice(-120)), [realCandles]);
  const atr = useMemo(() => calcSimpleAtr(realCandles), [realCandles]);

  const backtestTrades1m = useMemo(() => {
    return realCandles.length > 40
      ? backtestRealCandles(realCandles.slice(-200), 1)
      : [];
  }, [realCandles]);

  const backtestTrades3m = useMemo(() => {
    return realCandles.length > 50
      ? backtestRealCandles(realCandles.slice(-200), 3)
      : [];
  }, [realCandles]);

  const stats1m = useMemo(
    () => calcBacktestStats(backtestTrades1m),
    [backtestTrades1m]
  );

  const stats3m = useMemo(
    () => calcBacktestStats(backtestTrades3m),
    [backtestTrades3m]
  );

  const signalResult = useMemo(() => {
    if (isSynthetic && realCandles.length === 0) {
      return {
        signal: COLD_START_DEMO_DIRECTION as Signal,
        confidence: COLD_START_DEMO_SCORE,
        reasons: [
          "Cold Start Demo Mode",
          "Synthetic系はTwelve Dataを使わない",
          "Demo100学習データ収集を優先",
          "Deriv 1分対応銘柄のみ実行",
        ],
      };
    }

    const currentPrice = Number(price);

    if (!currentPrice || !ema9 || !ema21 || !rci9 || !rci26 || !rci52) {
      return {
        signal: "見送り" as Signal,
        confidence: 0,
        reasons: ["価格・EMA・RCI計算待ち"],
      };
    }

    const emaBull = ema9 > ema21 && currentPrice > ema9;
    const emaBear = ema9 < ema21 && currentPrice < ema9;

    const rciBull = rci9 > 50 && rci26 > 20 && rci52 > -20;
    const rciBear = rci9 < -50 && rci26 < -20 && rci52 < 20;

    const strongSmcBull = smc.bosBull || smc.chochBull;
    const strongSmcBear = smc.bosBear || smc.chochBear;

    const smcBull = strongSmcBull || smc.fvgBull;
    const smcBear = strongSmcBear || smc.fvgBear;

    const highScore = clampScore(
      40 +
        (emaBull ? 20 : 0) +
        (strongSmcBull ? 20 : smcBull ? 10 : 0) +
        (rciBull ? 10 : 0) +
        (atr > 0 ? 5 : 0)
    );

    const lowScore = clampScore(
      40 +
        (emaBear ? 20 : 0) +
        (strongSmcBear ? 20 : smcBear ? 10 : 0) +
        (rciBear ? 10 : 0) +
        (atr > 0 ? 5 : 0)
    );

    if (highScore >= MIN_CONFIDENCE && highScore >= lowScore) {
      return {
        signal: "HIGH" as Signal,
        confidence: highScore,
        reasons: [
          "1分足メイン",
          "EMA上昇方向",
          strongSmcBull ? "Strong SMC上方向" : "SMC補助",
          rciBull ? "RCI上方向" : "RCI弱め",
        ],
      };
    }

    if (lowScore >= MIN_CONFIDENCE && lowScore > highScore) {
      return {
        signal: "LOW" as Signal,
        confidence: lowScore,
        reasons: [
          "1分足メイン",
          "EMA下降方向",
          strongSmcBear ? "Strong SMC下方向" : "SMC補助",
          rciBear ? "RCI下方向" : "RCI弱め",
        ],
      };
    }

    return {
      signal: "見送り" as Signal,
      confidence: Math.max(highScore, lowScore),
      reasons: ["条件不足：EMA + Strong SMC の一致待ち"],
    };
  }, [
    isSynthetic,
    realCandles.length,
    price,
    ema9,
    ema21,
    rci9,
    rci26,
    rci52,
    smc,
    atr,
  ]);

  const smcScore =
    (smc.bosBull ? 20 : 0) +
    (smc.bosBear ? 20 : 0) +
    (smc.chochBull ? 20 : 0) +
    (smc.chochBear ? 20 : 0) +
    (smc.fvgBull ? 10 : 0) +
    (smc.fvgBear ? 10 : 0) +
    (smc.liquidityBull ? 5 : 0) +
    (smc.liquidityBear ? 5 : 0);

  async function loadCandles() {
    try {
      setIsLoading(true);
      setDataError(null);

      if (isSynthetic) {
        setRealCandles([]);
        setPrice("-");
        setEma9(0);
        setEma21(0);
        setRci9(0);
        setRci26(0);
        setRci52(0);
        return;
      }

      const data = await fetchTwelveDataCandles(selectedPair);
      setRealCandles(data);
    } catch (error: any) {
      console.error(error);
      setRealCandles([]);
      setPrice("取得失敗");
      setDataError(error?.message ?? "データ取得失敗");
    } finally {
      setIsLoading(false);
    }
  }

  async function executeDerivDemoTrade(source: "manual" | "auto") {
    const signal = signalResult.signal;

    if (!isOneMinuteTradable) {
      setLastEngineResult({
        ok: true,
        stage: "client_duration_unsupported_skip",
        pair: selectedPair,
        symbol: selectedDerivAsset.symbol,
        message:
          `${selectedPair} は Deriv で ${MAIN_DURATION}${MAIN_DURATION_UNIT} 非対応のため、` +
          "Trading Engine APIを呼ばずにSKIPしました。失敗トレードとして保存しません。",
      });
      return;
    }

    if (signal !== "HIGH" && signal !== "LOW") return;
    if (signalResult.confidence < MIN_CONFIDENCE) return;
    if (inFlightRef.current) return;

    const key = `${selectedPair}-${signal}`;
    const now = Date.now();
    const lastAt = lastEntryRef.current[key] ?? 0;

    if (now - lastAt < SAME_SIGNAL_COOLDOWN_MS) {
      setLastEngineResult({
        stage: "cooldown_skip",
        message: "同一シグナル5分クールダウン中",
      });
      return;
    }

    try {
      inFlightRef.current = true;
      setEngineRunning(true);

      const res = await fetch("/api/trading-engine", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accountId: DERIV_ACCOUNT_ID,
          pair: selectedPair,
          direction: signal,
          score: signalResult.confidence,
          amount: 1,
          duration: MAIN_DURATION,
          durationUnit: MAIN_DURATION_UNIT,
          minConfidence: MIN_CONFIDENCE,
          features: {
            source,
            timeframe: "1m",
            referenceTimeframe: "3m",
            mainLogic: isSynthetic ? "ColdStartDemo+DerivMapping" : "EMA+StrongSMC",
            derivSymbol: selectedDerivAsset.symbol,
            assetCategory: selectedDerivAsset.category,
            demoPriority: selectedDerivAsset.demoPriority,
            oneMinuteSupported: selectedDerivAsset.supportedOneMinute,
            isColdStartDemo: isSynthetic && realCandles.length === 0,
            ema9,
            ema21,
            emaDiff: ema9 - ema21,
            rci9,
            rci26,
            rci52,
            atr,
            trend: ema9 > ema21 ? "UP" : ema9 < ema21 ? "DOWN" : "RANGE",
            bos: signal === "HIGH" ? smc.bosBull : smc.bosBear,
            choch: signal === "HIGH" ? smc.chochBull : smc.chochBear,
            fvg: signal === "HIGH" ? smc.fvgBull : smc.fvgBear,
            liquidity:
              signal === "HIGH" ? smc.liquidityBull : smc.liquidityBear,
            smcScore,
            backtest1mWinRate: stats1m.winRate,
            backtest3mWinRate: stats3m.winRate,
          },
        }),
      });

      const data = await res.json();
      setLastEngineResult(data);

      if (
        data.stage === "engine_completed" ||
        data.stage === "engine_monitor_failed" ||
        data.stage === "engine_skipped"
      ) {
        lastEntryRef.current[key] = now;
      }
    } catch (error: any) {
      console.error(error);
      setLastEngineResult({
        ok: false,
        stage: "client_error",
        error: error?.message ?? "Trading Engine呼び出し失敗",
      });
    } finally {
      inFlightRef.current = false;
      setEngineRunning(false);
    }
  }

  async function refreshServerAutoRunnerStatus() {
  try {
    setServerRunnerError(null);

    const res = await fetch("/api/auto-runner/status", {
      method: "GET",
      cache: "no-store",
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.error ?? "Server Auto Runner status取得失敗");
    }

    setServerRunnerStatus(data.status);
  } catch (error: any) {
    console.error(error);
    setServerRunnerError(
      error?.message ?? "Server Auto Runner status取得失敗"
    );
  }
}

async function startServerAutoRunner() {
  try {
    setServerRunnerLoading(true);
    setServerRunnerError(null);

    const res = await fetch("/api/auto-runner/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intervalMs: 75_000,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.error ?? "Server Auto Runner start失敗");
    }

    setServerRunnerStatus(data.status);
    setAutoTradeEnabled(false);
  } catch (error: any) {
    console.error(error);
    setServerRunnerError(error?.message ?? "Server Auto Runner start失敗");
  } finally {
    setServerRunnerLoading(false);
  }
}

async function stopServerAutoRunner() {
  try {
    setServerRunnerLoading(true);
    setServerRunnerError(null);

    const res = await fetch("/api/auto-runner/stop", {
      method: "POST",
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.error ?? "Server Auto Runner stop失敗");
    }

    setServerRunnerStatus(data.status);
    setAutoTradeEnabled(false);
  } catch (error: any) {
    console.error(error);
    setServerRunnerError(error?.message ?? "Server Auto Runner stop失敗");
  } finally {
    setServerRunnerLoading(false);
  }
}

  useEffect(() => {
    loadCandles();

    const timer = setInterval(() => {
      loadCandles();
    }, 60 * 1000);

    return () => clearInterval(timer);
  }, [selectedPair, isSynthetic]);

  useEffect(() => {
    if (!autoTradeEnabled) return;

    const timer = setInterval(() => {
      executeDerivDemoTrade("auto");
    }, 5 * 1000);

    return () => clearInterval(timer);
  }, [
    autoTradeEnabled,
    signalResult,
    selectedPair,
    selectedDerivAsset,
    isSynthetic,
    isOneMinuteTradable,
    realCandles.length,
    ema9,
    ema21,
    rci9,
    rci26,
    rci52,
    atr,
    smc,
    stats1m.winRate,
    stats3m.winRate,
  ]);

  useEffect(() => {
  refreshServerAutoRunnerStatus();

  const timer = setInterval(() => {
    refreshServerAutoRunnerStatus();
  }, 10_000);

  return () => clearInterval(timer);
}, []);

  const signalColor =
    signalResult.signal === "HIGH"
      ? "text-emerald-400"
      : signalResult.signal === "LOW"
      ? "text-red-400"
      : signalResult.signal === "危険"
      ? "text-purple-400"
      : "text-yellow-400";

  const lastStage = lastEngineResult?.stage ?? "まだ実行なし";
  const lastMessage =
    lastEngineResult?.message ?? lastEngineResult?.error ?? "待機中";

  return (
    <main className="min-h-screen bg-[#050507] p-4 text-white md:p-6">
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black md:text-4xl">
              Binary Analysis AI
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              Phase14-E5.1 / SyntheticはTwelve Data SKIP / Demo100 Cold Start
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Pill label="1分足 Main" active />
            <Pill label="Cold Start Demo" active={isSynthetic} />
            <Pill label={`${MAIN_DURATION}分Demo`} active />
            <Pill label="Client AUTO" active={autoTradeEnabled} />
            <Pill label="Server AUTO" active={!!serverRunnerStatus?.running} />
            <Pill label="Server InFlight" active={!!serverRunnerStatus?.inFlight} />
            <Pill label="Deriv Mapping E5.1" active />
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-5 lg:grid-cols-11">
          {PAIRS.map((pair) => {
            const asset = getDerivAsset(pair);
            const isActive = selectedPair === pair;

            return (
              <button
                key={pair}
                onClick={() => setSelectedPair(pair)}
                className={`rounded-xl border px-3 py-3 text-left text-xs font-black transition ${
                  isActive
                    ? "border-emerald-400 bg-emerald-400 text-black"
                    : asset.supportedOneMinute
                    ? "border-cyan-700 bg-cyan-950/40 text-cyan-200 hover:bg-cyan-900/50"
                    : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900"
                }`}
              >
                <div>{pair}</div>
                <div className="mt-1 text-[10px] font-bold opacity-80">
                  {asset.supportedOneMinute ? "1m OK" : "1m SKIP"}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="grid grid-cols-1 gap-4 lg:col-span-4">
            <Card title="Server Auto Runner">
              <div className="grid grid-cols-2 gap-3">
                <Stat
                  label="Server"
                  value={serverRunnerStatus?.running ? "Running" : "Stopped"}
                  tone={serverRunnerStatus?.running ? "good" : "bad"}
                />
                <Stat
                  label="In Flight"
                  value={serverRunnerStatus?.inFlight ? "実行中" : "待機中"}
                  tone={serverRunnerStatus?.inFlight ? "warn" : "good"}
                />
                <Stat
                  label="Demo100"
                  value={
                    serverRunnerStatus?.demo100
                      ? `${serverRunnerStatus.demo100.currentCount}/${serverRunnerStatus.demo100.targetTrades}`
                      : "-"
                  }
                  tone="info"
                />
                <Stat
                  label="WinRate"
                  value={
                    serverRunnerStatus?.demo100
                      ? `${serverRunnerStatus.demo100.winRate}%`
                      : "-"
                  }
                  tone="good"
                />
                <Stat
                  label="Run Count"
                  value={serverRunnerStatus?.runCount ?? "-"}
                />
                <Stat
                  label="Interval"
                  value={
                    serverRunnerStatus?.intervalMs
                      ? `${serverRunnerStatus.intervalMs / 1000}s`
                      : "-"
                  }
                />
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <button
                  onClick={startServerAutoRunner}
                  disabled={serverRunnerLoading || serverRunnerStatus?.running}
                  className="rounded-xl bg-emerald-500 px-3 py-3 text-xs font-black text-black hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  START
                </button>

                <button
                  onClick={stopServerAutoRunner}
                  disabled={serverRunnerLoading || !serverRunnerStatus?.running}
                  className="rounded-xl bg-red-600 px-3 py-3 text-xs font-black hover:bg-red-500 disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  STOP
                </button>

                <button
                  onClick={refreshServerAutoRunnerStatus}
                  disabled={serverRunnerLoading}
                  className="rounded-xl bg-cyan-600 px-3 py-3 text-xs font-black hover:bg-cyan-500 disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  REFRESH
                </button>
              </div>

              <div className="mt-3 rounded-xl bg-zinc-900 p-3 text-xs text-zinc-400">
                <p>
                  Last Run:{" "}
                  {serverRunnerStatus?.lastRunAt
                    ? new Date(serverRunnerStatus.lastRunAt).toLocaleString()
                    : "-"}
                </p>
                <p className="mt-1">
                  Last Result:{" "}
                  {serverRunnerStatus?.lastResult?.stage ?? "-"}
                </p>
                <p className="mt-1">
                  Last Trade:{" "}
                  {serverRunnerStatus?.lastResult?.monitor?.status ??
                    serverRunnerStatus?.lastResult?.demoTrade?.stage ??
                    "-"}
                </p>
                <p className="mt-1">
                  Profit:{" "}
                  {typeof serverRunnerStatus?.lastResult?.monitor?.profit === "number"
                    ? serverRunnerStatus.lastResult.monitor.profit
                    : "-"}
                </p>
              </div>

              {serverRunnerError && (
                <p className="mt-3 rounded-xl bg-red-500/10 p-3 text-xs font-bold text-red-300">
                  {serverRunnerError}
                </p>
              )}
            </Card>
            <Card title="Deriv Asset Gate">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="選択銘柄" value={selectedPair} tone="info" />
                <Stat label="Deriv Symbol" value={selectedDerivAsset.symbol} />
                <Stat
                  label="カテゴリ"
                  value={
                    selectedDerivAsset.category === "synthetic"
                      ? "Synthetic"
                      : "Forex"
                  }
                  tone={
                    selectedDerivAsset.category === "synthetic"
                      ? "good"
                      : "warn"
                  }
                />
                <Stat
                  label="1分対応"
                  value={isOneMinuteTradable ? "OK" : "SKIP"}
                  tone={isOneMinuteTradable ? "good" : "bad"}
                />
              </div>

              <p
                className={`mt-4 rounded-xl p-3 text-xs font-bold ${
                  isOneMinuteTradable
                    ? "bg-emerald-500/10 text-emerald-300"
                    : "bg-red-500/10 text-red-300"
                }`}
              >
                {selectedDerivAsset.note}
              </p>
            </Card>

            <Card title="Trading Engine">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-zinc-500">Current Signal</p>
                  <p className={`mt-1 text-5xl font-black ${signalColor}`}>
                    {signalResult.signal}
                  </p>
                </div>

                <button
                  onClick={() => {
                    if (isServerAutoRunning) return;
                    setAutoTradeEnabled((prev) => !prev);
                  }}
                  disabled={isServerAutoRunning}
                  className="rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-black hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  {isServerAutoRunning
                    ? "SERVER AUTO中"
                    : autoTradeEnabled
                    ? "AUTO OFF"
                    : "AUTO ON"}
                </button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                <Stat
                  label="Confidence"
                  value={signalResult.confidence}
                  tone="info"
                />
                <Stat
                  label="Engine"
                  value={engineRunning ? "実行中" : "待機中"}
                  tone={engineRunning ? "warn" : "good"}
                />
                <Stat label="Demo時間" value={`${MAIN_DURATION}分`} tone="good" />
                <Stat label="最小Confidence" value={MIN_CONFIDENCE} tone="info" />
                <Stat label="価格" value={price} />
                <Stat label="ATR" value={atr.toFixed(5)} />
              </div>

              <button
                onClick={() => executeDerivDemoTrade("manual")}
                disabled={
                  isServerAutoRunning ||
                  (
                    signalResult.signal !== "HIGH" &&
                    signalResult.signal !== "LOW"
                  )
                }
                className="mt-3 w-full rounded-xl bg-cyan-600 px-4 py-3 text-sm font-black hover:bg-cyan-500 disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                手動Demo Trade
              </button>
            </Card>

            <Card title="Latest Engine Result">
              <p className="text-2xl font-black text-zinc-100">{lastStage}</p>
              <p className="mt-3 rounded-xl bg-zinc-900 p-3 text-xs text-zinc-400">
                {lastMessage}
              </p>
            </Card>

            <Card title="Backtest Compare">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="1分勝率" value={`${stats1m.winRate}%`} tone="good" />
                <Stat label="3分勝率" value={`${stats3m.winRate}%`} tone="warn" />
                <Stat label="1分取引数" value={stats1m.total} />
                <Stat label="3分取引数" value={stats3m.total} />
              </div>

              <p className="mt-4 rounded-xl bg-emerald-500/10 p-3 text-xs font-bold text-emerald-300">
                Synthetic系はDeriv Tick未接続のため、Demo100収集を優先。
              </p>
            </Card>

            <Demo100AnalyzerCard />
          </div>

          <div className="lg:col-span-8">
            <Card
              title={`${selectedPair} 1分足 Main Chart`}
              className="h-full min-h-[520px]"
            >
              <ChartPanel
                title={`${selectedPair} 1分足`}
                subtitle={
                  isSynthetic
                    ? "Synthetic系はTwelve Dataを使わず、次PhaseでDeriv Tickから描画"
                    : "EMA + Strong SMC / 3分足は参考"
                }
                height={460}
                candles={realCandles}
                onEmaUpdate={(e9, e21) => {
                  setEma9(e9);
                  setEma21(e21);
                }}
                onRciUpdate={(r9, r26, r52) => {
                  setRci9(r9);
                  setRci26(r26);
                  setRci52(r52);
                }}
                onPriceUpdate={(latestPrice) => {
                  setPrice(String(latestPrice));
                }}
              />
            </Card>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="Decision Reason">
            <div className="grid grid-cols-2 gap-3">
              <Stat
                label="Main Logic"
                value={isSynthetic ? "Cold Start" : "EMA + SMC"}
                tone="info"
              />
              <Stat label="Main TF" value="1分足" tone="good" />
              <Stat
                label="Demo Mode"
                value={isSynthetic ? "ON" : "OFF"}
                tone={isSynthetic ? "good" : "warn"}
              />
              <Stat label="SMC Score" value={smcScore} tone="info" />
            </div>

            <ul className="mt-4 space-y-2 text-sm text-zinc-300">
              <li>
                EMA：
                {ema9 > ema21
                  ? "上昇優位"
                  : ema9 < ema21
                  ? "下降優位"
                  : "横ばい"}
              </li>
              <li>EMA9：{ema9 || "-"}</li>
              <li>EMA21：{ema21 || "-"}</li>
              <li>RCI9：{rci9 || "-"}</li>
              <li>RCI26：{rci26 || "-"}</li>
              <li>RCI52：{rci52 || "-"}</li>
              {signalResult.reasons.map((reason) => (
                <li key={reason}>・{reason}</li>
              ))}
            </ul>
          </Card>

          <Card title="SMC Strength">
            <div className="mb-4 rounded-xl bg-zinc-900 p-3">
              <p className="text-xs text-zinc-500">SMC Label</p>
              <p className="mt-1 text-lg font-black">{smc.label}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Pill label="BOS Bull" active={!!smc.bosBull} />
              <Pill label="BOS Bear" active={!!smc.bosBear} />
              <Pill label="CHOCH Bull" active={!!smc.chochBull} />
              <Pill label="CHOCH Bear" active={!!smc.chochBear} />
              <Pill label="FVG Bull" active={!!smc.fvgBull} />
              <Pill label="FVG Bear" active={!!smc.fvgBear} />
              <Pill label="Liquidity Bull" active={!!smc.liquidityBull} />
              <Pill label="Liquidity Bear" active={!!smc.liquidityBear} />
            </div>
          </Card>

          <Card title="AI Health">
            <div className="grid grid-cols-2 gap-3">
              <Pill label="EMA" active={isSynthetic || (!!ema9 && !!ema21)} />
              <Pill label="SMC" active={isSynthetic || !!smc.label} />
              <Pill label="RCI" active={isSynthetic || (!!rci9 && !!rci26 && !!rci52)} />
              <Pill label="ATR" active={isSynthetic || atr > 0} />
              <Pill label="Trading" active={!engineRunning} />
              <Pill label="API" active={!dataError} />
            </div>

            {isLoading && (
              <p className="mt-4 rounded-xl bg-yellow-500/10 p-3 text-xs text-yellow-300">
                データ更新中...
              </p>
            )}

            {dataError && (
              <p className="mt-4 rounded-xl bg-red-500/10 p-3 text-xs text-red-300">
                {dataError}
              </p>
            )}
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title={`${selectedPair} 5分足 Reference`}>
            <ChartPanel
              title={`${selectedPair} 5分足`}
              subtitle={
                isSynthetic
                  ? "Synthetic系は次PhaseでDeriv Tickから描画"
                  : "参考：中期方向"
              }
              height={260}
              candles={candles5m}
            />
          </Card>

          <Card title={`${selectedPair} 15分足 Reference`}>
            <ChartPanel
              title={`${selectedPair} 15分足`}
              subtitle={
                isSynthetic
                  ? "Synthetic系は次PhaseでDeriv Tickから描画"
                  : "参考：大きな方向"
              }
              height={260}
              candles={candles15m}
            />
          </Card>
        </div>
      </div>
    </main>
  );
}