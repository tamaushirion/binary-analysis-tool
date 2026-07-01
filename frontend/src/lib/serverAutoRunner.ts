import { executeDemoTradingEngine } from "@/lib/trading/tradingEngine";
import { getDemo100Status } from "@/lib/demo100Mode";

type AutoRunnerStatus = {
  running: boolean;
  startedAt: string | null;
  stoppedAt: string | null;
  lastRunAt: string | null;
  lastResult: any | null;
  lastError: string | null;
  runCount: number;
  intervalMs: number;
};

const DEFAULT_INTERVAL_MS = 75_000;
const DEFAULT_ACCOUNT_ID = "DOT93536475";

const globalForAutoRunner = globalThis as unknown as {
  binaryAnalysisAutoRunner?: {
    timer: NodeJS.Timeout | null;
    inFlight: boolean;
    status: AutoRunnerStatus;
  };
};

if (!globalForAutoRunner.binaryAnalysisAutoRunner) {
  globalForAutoRunner.binaryAnalysisAutoRunner = {
    timer: null,
    inFlight: false,
    status: {
      running: false,
      startedAt: null,
      stoppedAt: null,
      lastRunAt: null,
      lastResult: null,
      lastError: null,
      runCount: 0,
      intervalMs: DEFAULT_INTERVAL_MS,
    },
  };
}

const store = globalForAutoRunner.binaryAnalysisAutoRunner;

async function runOnce() {
  if (store.inFlight) return;

  const demo100 = getDemo100Status();

  if (demo100.completed) {
    stopServerAutoRunner("Demo100 completed");
    return;
  }

  try {
    store.inFlight = true;
    store.status.lastRunAt = new Date().toISOString();
    store.status.lastError = null;

    const result = await executeDemoTradingEngine({
      accountId: DEFAULT_ACCOUNT_ID,
      pair: "Volatility 100 Index",
      direction: "LOW",
      score: 85,
      amount: 1,
      duration: 1,
      durationUnit: "m",
      currency: "USD",
      minScore: 80,
      minPayoutRate: 1.8,
      minConfidence: 75,
      features: {
        source: "server_auto_runner",
        timeframe: "1m",
        referenceTimeframe: "3m",
        mainLogic: "ServerAutoRunner+ColdStartDemo",
        derivSymbol: "R_100",
        assetCategory: "synthetic",
        demoPriority: 1,
        oneMinuteSupported: true,
        isColdStartDemo: true,
        ema9: 0,
        ema21: 0,
        emaDiff: 0,
        rci9: 0,
        rci26: 0,
        rci52: 0,
        atr: 0,
        trend: "RANGE",
        bos: false,
        choch: false,
        fvg: false,
        liquidity: false,
        smcScore: 0,
        backtest1mWinRate: 0,
        backtest3mWinRate: 0,
      } as any,
    });

    store.status.runCount += 1;
    store.status.lastResult = result;
  } catch (error: any) {
    store.status.lastError = error?.message ?? "Server Auto Runner error";
  } finally {
    store.inFlight = false;
  }
}

export function startServerAutoRunner(intervalMs = DEFAULT_INTERVAL_MS) {
  if (store.status.running) {
    return {
      ok: true,
      stage: "auto_runner_already_running",
      status: getServerAutoRunnerStatus(),
    };
  }

  store.status.running = true;
  store.status.startedAt = new Date().toISOString();
  store.status.stoppedAt = null;
  store.status.intervalMs = intervalMs;

  runOnce();

  store.timer = setInterval(() => {
    runOnce();
  }, intervalMs);

  return {
    ok: true,
    stage: "auto_runner_started",
    status: getServerAutoRunnerStatus(),
  };
}

export function stopServerAutoRunner(reason = "manual_stop") {
  if (store.timer) {
    clearInterval(store.timer);
    store.timer = null;
  }

  store.status.running = false;
  store.status.stoppedAt = new Date().toISOString();

  return {
    ok: true,
    stage: "auto_runner_stopped",
    reason,
    status: getServerAutoRunnerStatus(),
  };
}

export function getServerAutoRunnerStatus() {
  return {
    ...store.status,
    inFlight: store.inFlight,
    demo100: getDemo100Status(),
  };
}