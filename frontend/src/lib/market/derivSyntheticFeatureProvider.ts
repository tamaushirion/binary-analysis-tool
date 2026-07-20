import WebSocket from "ws";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type SmcResult = {
  bosBull: boolean;
  bosBear: boolean;
  chochBull: boolean;
  chochBear: boolean;
  liquidityBull: boolean;
  liquidityBear: boolean;
  fvgBull: boolean;
  fvgBear: boolean;
};

type SyntheticAsset = {
  pair: string;
  symbol: string;
  demoPriority: number;
};

export type SyntheticFeatureDebug = {
  ok: boolean;
  asset: SyntheticAsset;
  candlesLength: number;
  reason: string;
  error: string | null;
  attempts: number;
  lastAttemptAt: string | null;
  wsUrlAppId: string;
  highScore: number | null;
  lowScore: number | null;
  selectedScore: number | null;
  selectedDirection: "HIGH" | "LOW" | null;
  latestEpoch: number | null;
  latestClose: number | null;
  ema9: number | null;
  ema21: number | null;
  rci9: number | null;
  rci26: number | null;
  rci52: number | null;
  atr: number | null;
  smcScore: number | null;
  backtest1mWinRate: number | null;
  backtest3mWinRate: number | null;
  reasons: string[];
  trace: string[];
};

export type SyntheticFeatureSignal = {
  ok: true;
  pair: string;
  derivSymbol: string;
  direction: "HIGH" | "LOW";
  score: number;
  features: Record<string, any>;
  reasons: string[];
  debug: SyntheticFeatureDebug;
  candles: Candle[];
};

export type SyntheticFeatureSignalResult =
  | SyntheticFeatureSignal
  | {
      ok: false;
      debug: SyntheticFeatureDebug;
      candles?: Candle[];
    };

export type SyntheticObservationFeature = {
  pair: string;
  derivSymbol: string;
  candle: Candle;
  exitCandle: Candle;
  highResult: "WIN" | "LOST" | "DRAW";
  lowResult: "WIN" | "LOST" | "DRAW";
  highProfit: number;
  lowProfit: number;
  highScore: number;
  lowScore: number;
  selectedScore: number;
  selectedDirection: "HIGH" | "LOW";
  features: Record<string, any>;
};

const CANDLES_APP_ID = "1089";
const DERIV_WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${CANDLES_APP_ID}`;
const CONNECT_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 2;
const FEATURE_VERSION = "phase16-k-market-observation-v1";
const AI_VERSION = "phase16-k-market-observation";

const TARGET_ASSET: SyntheticAsset = {
  pair: "Volatility 100 Index",
  symbol: "R_100",
  demoPriority: 1,
};

function nowIso() {
  return new Date().toISOString();
}

function pushTrace(trace: string[], message: string) {
  trace.push(`${nowIso()} ${message}`);
}

function emptyDebug(asset: SyntheticAsset): SyntheticFeatureDebug {
  return {
    ok: false,
    asset,
    candlesLength: 0,
    reason: "未実行",
    error: null,
    attempts: 0,
    lastAttemptAt: null,
    wsUrlAppId: CANDLES_APP_ID,
    highScore: null,
    lowScore: null,
    selectedScore: null,
    selectedDirection: null,
    latestEpoch: null,
    latestClose: null,
    ema9: null,
    ema21: null,
    rci9: null,
    rci26: null,
    rci52: null,
    atr: null,
    smcScore: null,
    backtest1mWinRate: null,
    backtest3mWinRate: null,
    reasons: [],
    trace: [],
  };
}

function round(value: number, digits = 5) {
  return Number(value.toFixed(digits));
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function calcEma(values: number[], period: number) {
  if (values.length < period) return 0;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let i = period; i < values.length; i++) ema = values[i] * k + ema * (1 - k);
  return round(ema, 5);
}

function rankDescendingWithAverageTies(values: number[]) {
  const sorted = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value || a.index - b.index);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].value === sorted[i].value) j += 1;
    const startRank = i + 1;
    const endRank = j;
    const avgRank = (startRank + endRank) / 2;
    for (let k = i; k < j; k++) ranks[sorted[k].index] = avgRank;
    i = j;
  }
  return ranks;
}

export function calcRci(values: number[], period: number) {
  if (values.length < period) return 0;
  const target = values.slice(-period);
  const priceRanks = rankDescendingWithAverageTies(target);
  let d2 = 0;
  for (let i = 0; i < period; i++) {
    const timeRank = period - i;
    const priceRank = priceRanks[i];
    d2 += Math.pow(timeRank - priceRank, 2);
  }
  return round((1 - (6 * d2) / (period * (period * period - 1))) * 100, 2);
}

export function calcAtr(candles: Candle[], period = 14) {
  if (candles.length < period + 1) return 0;
  const target = candles.slice(-(period + 1));
  const trs: number[] = [];
  for (let i = 1; i < target.length; i++) {
    const current = target[i];
    const prev = target[i - 1];
    trs.push(Math.max(current.high - current.low, Math.abs(current.high - prev.close), Math.abs(current.low - prev.close)));
  }
  return round(trs.reduce((sum, value) => sum + value, 0) / trs.length, 5);
}

function detectSMC(candles: Candle[]): SmcResult {
  if (candles.length < 10) {
    return { bosBull: false, bosBear: false, chochBull: false, chochBear: false, liquidityBull: false, liquidityBear: false, fvgBull: false, fvgBear: false };
  }
  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const recent = candles.slice(-20);
  const recentHigh = Math.max(...recent.slice(0, -1).map((c) => c.high));
  const recentLow = Math.min(...recent.slice(0, -1).map((c) => c.low));
  return {
    bosBull: latest.close > recentHigh,
    bosBear: latest.close < recentLow,
    chochBull: prev.close < prev.open && latest.close > latest.open,
    chochBear: prev.close > prev.open && latest.close < latest.open,
    liquidityBull: latest.low < recentLow && latest.close > latest.open,
    liquidityBear: latest.high > recentHigh && latest.close < latest.open,
    fvgBull: candles.length >= 3 && latest.low > candles[candles.length - 3].high,
    fvgBear: candles.length >= 3 && latest.high < candles[candles.length - 3].low,
  };
}

function backtest(candles: Candle[], minutes = 1) {
  const gap = Math.max(1, minutes);
  const trades: { signal: "HIGH" | "LOW"; result: "WIN" | "LOSE" | "DRAW" }[] = [];
  for (let i = 30; i < candles.length - gap; i++) {
    const prev = candles[i - 1];
    const current = candles[i];
    const exit = candles[i + gap];
    const signal = current.close >= prev.close ? "HIGH" : "LOW";
    let result: "WIN" | "LOSE" | "DRAW" = "DRAW";
    if (signal === "HIGH") {
      if (exit.close > current.close) result = "WIN";
      if (exit.close < current.close) result = "LOSE";
    } else {
      if (exit.close < current.close) result = "WIN";
      if (exit.close > current.close) result = "LOSE";
    }
    trades.push({ signal, result });
  }
  const total = trades.length;
  const wins = trades.filter((trade) => trade.result === "WIN").length;
  const high = trades.filter((trade) => trade.signal === "HIGH");
  const low = trades.filter((trade) => trade.signal === "LOW");
  const highWins = high.filter((trade) => trade.result === "WIN").length;
  const lowWins = low.filter((trade) => trade.result === "WIN").length;
  return {
    total,
    winRate: total ? round((wins / total) * 100, 1) : 0,
    highWinRate: high.length ? round((highWins / high.length) * 100, 1) : 0,
    lowWinRate: low.length ? round((lowWins / low.length) * 100, 1) : 0,
  };
}

function normalizeDerivError(error: any) {
  if (!error) return "unknown";
  if (typeof error === "string") return error;
  if (error.message) return error.message;
  if (error.error?.message) return error.error.message;
  return JSON.stringify(error);
}

async function fetchCandlesOnce(symbol: string, attempt: number, trace: string[]): Promise<Candle[]> {
  return await new Promise((resolve, reject) => {
    pushTrace(trace, `attempt=${attempt} create websocket app_id=${CANDLES_APP_ID}`);
    const ws = new WebSocket(DERIV_WS_URL, { handshakeTimeout: CONNECT_TIMEOUT_MS, perMessageDeflate: false });
    let settled = false;
    const cleanup = () => {
      try { pushTrace(trace, "ws.close()"); ws.close(); } catch {}
      try {
        if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
          pushTrace(trace, "ws.terminate()");
          ws.terminate();
        }
      } catch {}
    };
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanup();
      fn();
    };
    const timeout = setTimeout(() => {
      pushTrace(trace, `timeout ${CONNECT_TIMEOUT_MS}ms`);
      done(() => reject(new Error(`Deriv candles取得タイムアウト attempt=${attempt}`)));
    }, CONNECT_TIMEOUT_MS);
    ws.on("open", () => {
      pushTrace(trace, "open");
      ws.send(JSON.stringify({ ticks_history: symbol, adjust_start_time: 1, count: 200, end: "latest", granularity: 60, style: "candles", req_id: Date.now() }));
      pushTrace(trace, `send ticks_history ${symbol}`);
    });
    ws.on("unexpected-response", (_req, res) => {
      pushTrace(trace, `unexpected-response status=${res.statusCode}`);
      done(() => reject(new Error(`Deriv WebSocket unexpected-response status=${res.statusCode} attempt=${attempt}`)));
    });
    ws.on("error", (error) => {
      if (settled) return;
      pushTrace(trace, `error ${normalizeDerivError(error)}`);
      done(() => reject(new Error(`Deriv WebSocket接続エラー attempt=${attempt} ${normalizeDerivError(error)}`)));
    });
    ws.on("close", (code, reason) => pushTrace(trace, `close code=${code} reason=${reason.toString()}`));
    ws.on("message", (raw) => {
      try {
        pushTrace(trace, "message received");
        const data = JSON.parse(String(raw));
        pushTrace(trace, `msg_type=${data.msg_type ?? "unknown"}`);
        if (data.error) throw new Error(`Deriv API error attempt=${attempt}: ${data.error.message ?? "unknown"}`);
        if (data.msg_type !== "candles" || !Array.isArray(data.candles)) return;
        const candles = data.candles.map((candle: any) => ({
          time: Number(candle.epoch),
          open: Number(candle.open),
          high: Number(candle.high),
          low: Number(candle.low),
          close: Number(candle.close),
        })).filter((candle: Candle) => Number.isFinite(candle.time) && Number.isFinite(candle.open) && Number.isFinite(candle.high) && Number.isFinite(candle.low) && Number.isFinite(candle.close));
        pushTrace(trace, `candles parsed length=${candles.length}`);
        done(() => resolve(candles));
      } catch (error) {
        done(() => reject(error));
      }
    });
  });
}

async function fetchCandlesFromDeriv(symbol: string) {
  const errors: string[] = [];
  const trace: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const candles = await fetchCandlesOnce(symbol, attempt, trace);
      return { candles, attempts: attempt, error: null, trace };
    } catch (error: any) {
      errors.push(normalizeDerivError(error));
      if (attempt < MAX_ATTEMPTS) {
        pushTrace(trace, "retry wait 800ms");
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
  }
  return { candles: [] as Candle[], attempts: MAX_ATTEMPTS, error: errors.join(" | "), trace };
}

function scoreFromFeatures(candles: Candle[], stats1m: ReturnType<typeof backtest>) {
  const closes = candles.map((candle) => candle.close);
  const latest = candles[candles.length - 1];
  const ema9 = calcEma(closes, 9);
  const ema21 = calcEma(closes, 21);
  const rci9 = calcRci(closes, 9);
  const rci26 = calcRci(closes, 26);
  const rci52 = calcRci(closes, 52);
  const atr = calcAtr(candles);
  const smc = detectSMC(candles.slice(-120));
  const emaBull = ema9 > ema21 && latest.close > ema9;
  const emaBear = ema9 < ema21 && latest.close < ema9;
  const rciBull = rci9 > 50 && rci26 > 20 && rci52 > -20;
  const rciBear = rci9 < -50 && rci26 < -20 && rci52 < 20;
  const strongSmcBull = smc.bosBull || smc.chochBull;
  const strongSmcBear = smc.bosBear || smc.chochBear;
  const smcBull = strongSmcBull || smc.fvgBull;
  const smcBear = strongSmcBear || smc.fvgBear;
  const highScore = clampScore(40 + (emaBull ? 20 : 0) + (strongSmcBull ? 20 : smcBull ? 10 : 0) + (rciBull ? 10 : 0) + (atr > 0 ? 5 : 0) + (stats1m.highWinRate >= 55 ? 5 : 0));
  const lowScore = clampScore(40 + (emaBear ? 20 : 0) + (strongSmcBear ? 20 : smcBear ? 10 : 0) + (rciBear ? 10 : 0) + (atr > 0 ? 5 : 0) + (stats1m.lowWinRate >= 55 ? 5 : 0));
  const direction = highScore >= lowScore ? "HIGH" : "LOW";
  const smcScore =
    (smc.bosBull ? 20 : 0) + (smc.bosBear ? 20 : 0) +
    (smc.chochBull ? 20 : 0) + (smc.chochBear ? 20 : 0) +
    (smc.fvgBull ? 10 : 0) + (smc.fvgBear ? 10 : 0) +
    (smc.liquidityBull ? 5 : 0) + (smc.liquidityBear ? 5 : 0);
  return { latest, ema9, ema21, rci9, rci26, rci52, atr, smc, highScore, lowScore, direction: direction as "HIGH" | "LOW", score: Math.max(highScore, lowScore), smcScore };
}

function buildFeatureSnapshot(asset: SyntheticAsset, candles: Candle[]) {
  const stats1m = backtest(candles.slice(-200), 1);
  const stats3m = backtest(candles.slice(-200), 3);
  const scored = scoreFromFeatures(candles, stats1m);
  return {
    scored,
    stats1m,
    stats3m,
    features: {
      source: "server_auto_runner_phase16_k_deriv_candles_app1089",
      timeframe: "1m",
      referenceTimeframe: "3m",
      mainLogic: "DerivSyntheticCandles+EMA+RCI(avgTie)+SMC+Backtest",
      featureVersion: FEATURE_VERSION,
      aiVersion: AI_VERSION,
      derivSymbol: asset.symbol,
      assetCategory: "synthetic",
      demoPriority: asset.demoPriority,
      oneMinuteSupported: true,
      isColdStartDemo: false,
      ema9: scored.ema9,
      ema21: scored.ema21,
      emaDiff: round(scored.ema9 - scored.ema21, 5),
      rci9: scored.rci9,
      rci26: scored.rci26,
      rci52: scored.rci52,
      atr: scored.atr,
      trend: scored.ema9 > scored.ema21 ? "UP" : scored.ema9 < scored.ema21 ? "DOWN" : "RANGE",
      bos: scored.direction === "HIGH" ? scored.smc.bosBull : scored.smc.bosBear,
      choch: scored.direction === "HIGH" ? scored.smc.chochBull : scored.smc.chochBear,
      fvg: scored.direction === "HIGH" ? scored.smc.fvgBull : scored.smc.fvgBear,
      liquidity: scored.direction === "HIGH" ? scored.smc.liquidityBull : scored.smc.liquidityBear,
      smcScore: scored.smcScore,
      highScore: scored.highScore,
      lowScore: scored.lowScore,
      selectedScore: scored.score,
      selectedDirection: scored.direction,
      backtestWinRate1m: stats1m.winRate,
      backtestWinRate3m: stats3m.winRate,
      backtest1mWinRate: stats1m.winRate,
      backtest3mWinRate: stats3m.winRate,
      candlesAppId: CANDLES_APP_ID,
    },
  };
}

function buildSignal(asset: SyntheticAsset, candles: Candle[], attempts: number, trace: string[]): SyntheticFeatureSignalResult {
  const debug = emptyDebug(asset);
  debug.candlesLength = candles.length;
  debug.attempts = attempts;
  debug.lastAttemptAt = nowIso();
  debug.trace = trace;
  if (candles.length < 80) {
    debug.reason = `candles本数不足: ${candles.length}`;
    return { ok: false, debug, candles };
  }
  const snapshot = buildFeatureSnapshot(asset, candles);
  const { scored, stats1m, stats3m, features } = snapshot;
  const reasons = [
    `Deriv 1分足 candles ${candles.length}本`,
    `HIGH score ${scored.highScore}`,
    `LOW score ${scored.lowScore}`,
    `選択方向 ${scored.direction}`,
    `EMA ${features.trend}`,
    `RCI9 ${scored.rci9}`,
    `Backtest1m ${stats1m.winRate}%`,
  ];
  Object.assign(debug, {
    highScore: scored.highScore,
    lowScore: scored.lowScore,
    selectedScore: scored.score,
    selectedDirection: scored.direction,
    latestEpoch: scored.latest.time,
    latestClose: scored.latest.close,
    ema9: scored.ema9,
    ema21: scored.ema21,
    rci9: scored.rci9,
    rci26: scored.rci26,
    rci52: scored.rci52,
    atr: scored.atr,
    smcScore: scored.smcScore,
    backtest1mWinRate: stats1m.winRate,
    backtest3mWinRate: stats3m.winRate,
    reasons,
  });
  if (scored.score < 70) {
    debug.reason = `score不足: ${scored.score} < 70`;
    return { ok: false, debug, candles };
  }
  debug.ok = true;
  debug.reason = "Feature条件合格";
  return {
    ok: true,
    pair: asset.pair,
    derivSymbol: asset.symbol,
    direction: scored.direction,
    score: scored.score,
    reasons,
    debug,
    features,
    candles,
  };
}

function judgeResult(direction: "HIGH" | "LOW", entry: number, exit: number): "WIN" | "LOST" | "DRAW" {
  if (entry === exit) return "DRAW";
  if (direction === "HIGH") return exit > entry ? "WIN" : "LOST";
  return exit < entry ? "WIN" : "LOST";
}

function profitForResult(result: "WIN" | "LOST" | "DRAW") {
  if (result === "WIN") return 0.92;
  if (result === "LOST") return -1;
  return 0;
}

export function buildObservationFeaturesFromCandles(candles: Candle[]): SyntheticObservationFeature[] {
  const asset = TARGET_ASSET;
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const observations: SyntheticObservationFeature[] = [];
  for (let i = 79; i < sorted.length - 1; i++) {
    const history = sorted.slice(0, i + 1);
    if (history.length < 80) continue;
    const candle = sorted[i];
    const exitCandle = sorted[i + 1];
    const snapshot = buildFeatureSnapshot(asset, history);
    const highResult = judgeResult("HIGH", candle.close, exitCandle.close);
    const lowResult = judgeResult("LOW", candle.close, exitCandle.close);
    observations.push({
      pair: asset.pair,
      derivSymbol: asset.symbol,
      candle,
      exitCandle,
      highResult,
      lowResult,
      highProfit: profitForResult(highResult),
      lowProfit: profitForResult(lowResult),
      highScore: snapshot.scored.highScore,
      lowScore: snapshot.scored.lowScore,
      selectedScore: snapshot.scored.score,
      selectedDirection: snapshot.scored.direction,
      features: {
        ...snapshot.features,
        observationEpoch: candle.time,
        exitEpoch: exitCandle.time,
        entryClose: candle.close,
        exitClose: exitCandle.close,
        highResult,
        lowResult,
        highProfit: profitForResult(highResult),
        lowProfit: profitForResult(lowResult),
      },
    });
  }
  return observations;
}

export async function buildDerivSyntheticFeatureSignal(): Promise<SyntheticFeatureSignalResult> {
  const asset = TARGET_ASSET;
  const debug = emptyDebug(asset);
  const fetched = await fetchCandlesFromDeriv(asset.symbol);
  if (!fetched.candles.length) {
    debug.reason = "Deriv candles取得失敗";
    debug.error = fetched.error;
    debug.attempts = fetched.attempts;
    debug.lastAttemptAt = nowIso();
    debug.trace = fetched.trace;
    return { ok: false, debug, candles: [] };
  }
  const signal = buildSignal(asset, fetched.candles, fetched.attempts, fetched.trace);
  if (!signal.ok && fetched.error) signal.debug.error = fetched.error;
  return signal;
}
