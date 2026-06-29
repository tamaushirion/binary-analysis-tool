"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { UTCTimestamp } from "lightweight-charts";

import ChartPanel from "./components/ChartPanel";

import {
  backtestRealCandles,
  calcBacktestStats,
  type Candle,
  type Signal,
} from "./lib/backtest";
import { detectSMC } from "./lib/smc";
import { aggregateCandles } from "./lib/timeframe";

const PAIRS = ["USD/JPY", "EUR/USD", "GBP/USD", "EUR/GBP", "GBP/JPY", "EUR/JPY"];

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

function Pill({
  label,
  active,
}: {
  label: string;
  active: boolean;
}) {
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
  const [selectedPair, setSelectedPair] = useState("USD/JPY");
  const [realCandles, setRealCandles] = useState<Candle[]>([]);
  const [price, setPrice] = useState("接続中...");
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

  const inFlightRef = useRef(false);
  const lastEntryRef = useRef<Record<string, number>>({});

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

    if (highScore >= 75 && highScore >= lowScore) {
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

    if (lowScore >= 75 && lowScore > highScore) {
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
  }, [price, ema9, ema21, rci9, rci26, rci52, smc, atr]);

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

      const data = await fetchTwelveDataCandles(selectedPair);
      setRealCandles(data);
    } catch (error: any) {
      console.error(error);
      setDataError(error?.message ?? "データ取得失敗");
    } finally {
      setIsLoading(false);
    }
  }

  async function executeDerivDemoTrade(source: "manual" | "auto") {
    const signal = signalResult.signal;

    if (signal !== "HIGH" && signal !== "LOW") return;
    if (signalResult.confidence < 60) return;
    if (inFlightRef.current) return;

    const key = `${selectedPair}-${signal}`;
    const now = Date.now();
    const lastAt = lastEntryRef.current[key] ?? 0;

    if (now - lastAt < 5 * 60 * 1000) {
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
          pair: selectedPair,
          direction: signal,
          score: signalResult.confidence,
          amount: 1,
          duration: 5,
          durationUnit: "m",
          minConfidence: 60,
          features: {
            source,
            timeframe: "1m",
            referenceTimeframe: "3m",
            mainLogic: "EMA+StrongSMC",
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

  useEffect(() => {
    loadCandles();

    const timer = setInterval(() => {
      loadCandles();
    }, 60 * 1000);

    return () => clearInterval(timer);
  }, [selectedPair]);

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
    ema9,
    ema21,
    rci9,
    rci26,
    rci52,
    atr,
    smc,
  ]);

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
              Version1 Operation / EMA + Strong SMC / Main Timeframe: 1分足
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Pill label="1分足 Main" active />
            <Pill label="3分足 Reference" active={false} />
            <Pill label="AUTO" active={autoTradeEnabled} />
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-6">
          {PAIRS.map((pair) => (
            <button
              key={pair}
              onClick={() => setSelectedPair(pair)}
              className={`rounded-xl border px-3 py-3 text-sm font-black transition ${
                selectedPair === pair
                  ? "border-emerald-400 bg-emerald-400 text-black"
                  : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900"
              }`}
            >
              {pair}
            </button>
          ))}
        </div>

        <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="grid grid-cols-1 gap-4 lg:col-span-4">
            <Card title="Trading Engine">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-zinc-500">Current Signal</p>
                  <p className={`mt-1 text-5xl font-black ${signalColor}`}>
                    {signalResult.signal}
                  </p>
                </div>

                <button
                  onClick={() => setAutoTradeEnabled((prev) => !prev)}
                  className={
                    autoTradeEnabled
                      ? "rounded-xl bg-red-600 px-4 py-3 text-sm font-black hover:bg-red-500"
                      : "rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-black hover:bg-emerald-400"
                  }
                >
                  {autoTradeEnabled ? "AUTO OFF" : "AUTO ON"}
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <Stat label="Confidence" value={signalResult.confidence} tone="info" />
                <Stat
                  label="Engine"
                  value={engineRunning ? "実行中" : "待機中"}
                  tone={engineRunning ? "warn" : "good"}
                />
                <Stat label="価格" value={price} />
                <Stat label="ATR" value={atr.toFixed(5)} />
              </div>

              <button
                onClick={() => executeDerivDemoTrade("manual")}
                disabled={
                  signalResult.signal !== "HIGH" && signalResult.signal !== "LOW"
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
                本判定は1分足。3分は弱かったため参考表示のみ。
              </p>
            </Card>
          </div>

          <div className="lg:col-span-8">
            <Card
              title={`${selectedPair} 1分足 Main Chart`}
              className="h-full min-h-[520px]"
            >
              <ChartPanel
                title={`${selectedPair} 1分足`}
                subtitle="EMA + Strong SMC / 3分足は参考"
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
              <Stat label="Main Logic" value="EMA + SMC" tone="info" />
              <Stat label="Main TF" value="1分足" tone="good" />
              <Stat label="3分" value="参考のみ" tone="warn" />
              <Stat label="SMC Score" value={smcScore} tone="info" />
            </div>

            <ul className="mt-4 space-y-2 text-sm text-zinc-300">
              <li>EMA：{ema9 > ema21 ? "上昇優位" : ema9 < ema21 ? "下降優位" : "横ばい"}</li>
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
              <Pill label="EMA" active={!!ema9 && !!ema21} />
              <Pill label="SMC" active={!!smc.label} />
              <Pill label="RCI" active={!!rci9 && !!rci26 && !!rci52} />
              <Pill label="ATR" active={atr > 0} />
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
              subtitle="参考：中期方向"
              height={260}
              candles={candles5m}
            />
          </Card>

          <Card title={`${selectedPair} 15分足 Reference`}>
            <ChartPanel
              title={`${selectedPair} 15分足`}
              subtitle="参考：大きな方向"
              height={260}
              candles={candles15m}
            />
          </Card>
        </div>
      </div>
    </main>
  );
}