import { executeDemoTradingEngine } from "@/lib/trading/tradingEngine";
import { getDemo100Status } from "@/lib/demo100Mode";
import { getDemoPart2Status } from "@/lib/demoPart2Status";
import { buildDerivSyntheticFeatureSignal, buildObservationFeaturesFromCandles } from "@/lib/market/derivSyntheticFeatureProvider";
import { recordAndSettleForwardValidation } from "@/lib/learning/forwardValidationRecorder";
import { recordMarketObservations } from "@/lib/learning/marketObservationStore";
import { runMarketObservationForwardValidation } from "@/lib/learning/marketObservationForwardValidation";
import { runMarketObservationPhase16PForwardValidation } from "@/lib/learning/marketObservationPhase16PForwardValidation";
import { runMarketObservationPhase16QForwardValidation } from "@/lib/learning/marketObservationPhase16QForwardValidation";
import { evaluateDemo2RobustCandidate } from "@/lib/learning/demo2RobustCandidateGate";
import { getDemo2RobustCandidateTradeStats } from "@/lib/learning/demo2RobustCandidateTradeStats";

type AutoRunnerStatus = {
  running: boolean;
  startedAt: string | null;
  stoppedAt: string | null;
  lastRunAt: string | null;
  lastResult: any | null;
  lastError: string | null;
  runCount: number;
  intervalMs: number;
  mode: "demo_part2";
};

type ProviderLikeResult = {
  ok?: boolean;
  pair?: string;
  direction?: "HIGH" | "LOW";
  score?: number;
  features?: Record<string, any>;
  reasons?: string[];
  debug?: Record<string, any>;
  candles?: Array<{ time: number; open: number; high: number; low: number; close: number }>;
};

const DEFAULT_INTERVAL_MS = 75_000;
const DEFAULT_ACCOUNT_ID = process.env.DERIV_ACCOUNT_ID || "DOT93536475";

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
      mode: "demo_part2",
    },
  };
}

const store = globalForAutoRunner.binaryAnalysisAutoRunner;

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function boolOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return null;
}

function directionOrNull(value: unknown): "HIGH" | "LOW" | null {
  return value === "LOW" ? "LOW" : value === "HIGH" ? "HIGH" : null;
}

function currentHourUtc(now: number) {
  return new Date(now).getUTCHours();
}

function currentWeekdayUtc(now: number) {
  return new Date(now).getUTCDay();
}

function inferSession(hour: number | null) {
  if (hour === null) return null;
  if (hour >= 0 && hour < 7) return "TOKYO";
  if (hour >= 7 && hour < 13) return "LONDON";
  if (hour >= 13 && hour < 22) return "NEW_YORK";
  return "OFF_HOURS";
}

function extractForwardValidationInput(providerResult: ProviderLikeResult, observedAt: number) {
  const debug = providerResult.debug ?? {};
  const features = providerResult.features ?? {};

  const pair = textOrNull(providerResult.pair) ?? textOrNull(debug.pair) ?? textOrNull((debug.asset as any)?.pair) ?? "Volatility 100 Index";
  const sourceDirection =
    directionOrNull(providerResult.direction) ??
    directionOrNull(debug.selectedDirection) ??
    directionOrNull(features.direction) ??
    "HIGH";

  const entrySpot =
    numberOrNull(debug.latestClose) ??
    numberOrNull(features.latestClose) ??
    numberOrNull(features.close) ??
    numberOrNull(features.entrySpot) ??
    null;

  if (entrySpot === null) return null;

  const hour =
    numberOrNull(features.hour) ??
    numberOrNull(debug.hour) ??
    currentHourUtc(observedAt);
  const weekday =
    numberOrNull(features.weekday) ??
    numberOrNull(debug.weekday) ??
    currentWeekdayUtc(observedAt);
  const session =
    textOrNull(features.session) ??
    textOrNull(debug.session) ??
    inferSession(hour);

  const score = numberOrNull(providerResult.score) ?? numberOrNull(debug.selectedScore) ?? numberOrNull(features.score) ?? numberOrNull(features.finalScore);
  const finalScore = numberOrNull(features.finalScore) ?? score;
  const confidenceScore =
    numberOrNull(features.confidenceScore) ??
    numberOrNull(features.confidence) ??
    numberOrNull(debug.confidenceScore) ??
    numberOrNull(debug.confidence);
  const similarityScore =
    numberOrNull(features.similarityScore) ??
    numberOrNull(features.similarity) ??
    numberOrNull(debug.similarityScore) ??
    numberOrNull(debug.similarity);

  return {
    pair,
    sourceDirection,
    entrySpot,
    currentSpot: entrySpot,
    observedAt,
    durationMs: 60_000,
    score,
    confidenceScore,
    similarityScore,
    finalScore,
    weightScore: numberOrNull(features.weightScore) ?? numberOrNull(debug.weightScore),
    ema9: numberOrNull(features.ema9) ?? numberOrNull(debug.ema9),
    ema21: numberOrNull(features.ema21) ?? numberOrNull(debug.ema21),
    emaDiff: numberOrNull(features.emaDiff) ?? numberOrNull(features.ema_diff) ?? numberOrNull(debug.emaDiff) ?? numberOrNull(debug.ema_diff),
    rci9: numberOrNull(features.rci9) ?? numberOrNull(debug.rci9),
    rci26: numberOrNull(features.rci26) ?? numberOrNull(debug.rci26),
    rci52: numberOrNull(features.rci52) ?? numberOrNull(debug.rci52),
    atr: numberOrNull(features.atr) ?? numberOrNull(debug.atr),
    trend: textOrNull(features.trend) ?? textOrNull(features.emaTrend) ?? textOrNull(debug.trend),
    marketPhase: textOrNull(features.marketPhase) ?? textOrNull(features.market_phase) ?? textOrNull(debug.marketPhase),
    volatilityLevel: textOrNull(features.volatilityLevel) ?? textOrNull(features.atrLevel) ?? textOrNull(debug.volatilityLevel),
    session,
    hour,
    weekday,
    bos: boolOrNull(features.bos) ?? boolOrNull(debug.bos),
    choch: boolOrNull(features.choch) ?? boolOrNull(debug.choch),
    fvg: boolOrNull(features.fvg) ?? boolOrNull(debug.fvg),
    orderBlock: boolOrNull(features.orderBlock) ?? boolOrNull(features.order_block) ?? boolOrNull(debug.orderBlock),
    featureSnapshot: {
      ...features,
      providerDebug: debug,
      forwardValidationSource: "server_auto_runner_phase16_g",
    },
    source: "server_auto_runner_phase16_g",
  };
}

function runForwardValidation(providerResult: ProviderLikeResult, observedAt: number) {
  const input = extractForwardValidationInput(providerResult, observedAt);
  if (!input) {
    return {
      ok: true,
      skipped: true,
      reason: "entrySpot取得不可のためForward Validationを保存/確定しませんでした。",
    };
  }

  try {
    return recordAndSettleForwardValidation(input);
  } catch (error: any) {
    return {
      ok: false,
      skipped: false,
      error: error?.message ?? "Forward Validation error",
    };
  }
}


function runMarketObservationForwardValidationSummary() {
  try {
    return runMarketObservationForwardValidation();
  } catch (error: any) {
    return {
      ok: false,
      stage: "market_observation_forward_validation_error",
      skipped: false,
      error: error?.message ?? "Market Observation Forward Validation error",
      message: "Phase16-N前向き検証の集計更新に失敗しました。Trading Engine / Demo Buyには影響させません。",
    };
  }
}


function buildRobustFeatureInput(providerResult: ProviderLikeResult) {
  const debug = providerResult.debug ?? {};
  const features = providerResult.features ?? {};
  const nowHour = new Date().getUTCHours();

  return {
    pair: providerResult.pair ?? debug.pair ?? (debug.asset as any)?.pair,
    highScore:
      numberOrNull(features.highScore) ??
      numberOrNull(debug.highScore),
    lowScore:
      numberOrNull(features.lowScore) ??
      numberOrNull(debug.lowScore),
    selectedScore:
      numberOrNull(providerResult.score) ??
      numberOrNull(features.selectedScore) ??
      numberOrNull(debug.selectedScore),
    selectedDirection:
      providerResult.direction ??
      directionOrNull(features.selectedDirection) ??
      directionOrNull(debug.selectedDirection),
    rci52: numberOrNull(features.rci52) ?? numberOrNull(debug.rci52),
    smcScore:
      numberOrNull(features.smcScore) ??
      numberOrNull(features.smc_score) ??
      numberOrNull(debug.smcScore),
    choch: boolOrNull(features.choch) ?? boolOrNull(debug.choch),
    fvg: boolOrNull(features.fvg) ?? boolOrNull(debug.fvg),
    session:
      textOrNull(features.session) ??
      textOrNull(debug.session) ??
      inferSession(nowHour),
    hour:
      numberOrNull(features.hour) ??
      numberOrNull(debug.hour) ??
      nowHour,
    atr: numberOrNull(features.atr) ?? numberOrNull(debug.atr),
    latestClose:
      numberOrNull(features.latestClose) ??
      numberOrNull(features.close) ??
      numberOrNull(debug.latestClose),
  };
}

function runPhase16PForwardValidationSummary() {
  try {
    return runMarketObservationPhase16PForwardValidation();
  } catch (error: any) {
    return {
      ok: false,
      stage: "market_observation_phase16_p_forward_validation_error",
      error: error?.message ?? "Phase16-P Forward Validation error",
    };
  }
}

function runPhase16QForwardValidationSummary() {
  try {
    return runMarketObservationPhase16QForwardValidation();
  } catch (error: any) {
    return {
      ok: false,
      stage: "market_observation_phase16_q_forward_validation_error",
      error: error?.message ?? "Phase16-Q Forward Validation error",
    };
  }
}

function runMarketObservation(providerResult: ProviderLikeResult) {
  try {
    const candles = Array.isArray(providerResult.candles) ? providerResult.candles : [];
    if (candles.length < 81) {
      return {
        ok: true,
        skipped: true,
        reason: `Market Observation保存に必要なcandles不足: ${candles.length}`,
      };
    }
    const observations = buildObservationFeaturesFromCandles(candles);
    const summary = recordMarketObservations(observations, { limit: 10 });
    return {
      ok: true,
      skipped: false,
      generatedObservations: observations.length,
      summary,
      message: "Market Observation Datasetへ未保存の確定足だけ保存しました。",
    };
  } catch (error: any) {
    return {
      ok: false,
      skipped: false,
      error: error?.message ?? "Market Observation error",
    };
  }
}


type AutoRunnerStep = "idle" | "feature_provider" | "market_observation" | "phase16_n" | "phase16_p" | "phase16_q" | "forward_validation" | "robust_candidate" | "candidate_health" | "trading_engine";
function errorDetails(error: unknown, step: AutoRunnerStep) { const err = error instanceof Error ? error : new Error(String(error)); const cause = err.cause instanceof Error ? { name: err.cause.name, message: err.cause.message } : err.cause ?? null; return { step, name: err.name, message: err.message, cause, stack: err.stack?.split("\n").slice(0, 8) ?? [], retryable: ["fetch", "timeout", "websocket"].some((token) => err.message.toLowerCase().includes(token)) }; }
function findForwardCandidate(candidateId: string, phase16P: any, phase16Q: any) { const all = [...(Array.isArray(phase16P?.candidates) ? phase16P.candidates : []), ...(Array.isArray(phase16Q?.candidates) ? phase16Q.candidates : [])]; return all.find((candidate: any) => candidate?.id === candidateId) ?? null; }
function evaluateCandidateHealth(robustMatch: any, phase16P: any, phase16Q: any, tradeStats: ReturnType<typeof getDemo2RobustCandidateTradeStats>) { if (!robustMatch?.candidateId) return { allow: false, reason: "Robust候補なし", forwardCandidate: null, demoCandidateStat: null }; const forwardCandidate = findForwardCandidate(robustMatch.candidateId, phase16P, phase16Q); const demoCandidateStat = tradeStats.candidates.find((candidate) => candidate.candidateId === robustMatch.candidateId) ?? null; if (demoCandidateStat?.shouldPause) return { allow: false, reason: `実Demo候補別成績により停止: ${demoCandidateStat.reasons.join(" / ")}`, forwardCandidate, demoCandidateStat }; if (forwardCandidate && Number(forwardCandidate.decided ?? 0) >= 50 && (Number(forwardCandidate.winRate ?? 0) < 55 || Number(forwardCandidate.profit ?? 0) <= 0)) return { allow: false, reason: `最新前向き検証で停止: ${forwardCandidate.decided}件 / 勝率${forwardCandidate.winRate}% / Profit ${forwardCandidate.profit}`, forwardCandidate, demoCandidateStat }; return { allow: true, reason: "候補別停止基準に該当しません。", forwardCandidate, demoCandidateStat }; }

async function runOnce() {
  if (store.inFlight) return;

  const demoPart2 = getDemoPart2Status();
  if (demoPart2.completed) {
    stopServerAutoRunner("Demo Part2 completed");
    return;
  }

  let currentStep: AutoRunnerStep = "idle";

  try {
    store.inFlight = true;
    store.status.lastRunAt = new Date().toISOString();
    store.status.lastError = null;

    store.status.lastResult = {
      ok: true,
      stage: "auto_runner_fetching_features",
      message: "Deriv candlesからFeatureを取得中です。",
      startedAt: store.status.lastRunAt,
      demoPart2: getDemoPart2Status(),
    };

    currentStep = "feature_provider";
    const providerResult = await buildDerivSyntheticFeatureSignal();
    const observedAt = Date.now();
    currentStep = "market_observation";
    const marketObservation = runMarketObservation(providerResult as ProviderLikeResult);
    currentStep = "phase16_n";
    const marketObservationForwardValidation = runMarketObservationForwardValidationSummary();
    currentStep = "phase16_p";
    const phase16PForwardValidation = runPhase16PForwardValidationSummary();
    currentStep = "phase16_q";
    const phase16QForwardValidation = runPhase16QForwardValidationSummary();
    currentStep = "forward_validation";
    const forwardValidation = runForwardValidation(providerResult as ProviderLikeResult, observedAt);
    currentStep = "robust_candidate";
    const robustCandidateDecision = evaluateDemo2RobustCandidate(
      buildRobustFeatureInput(providerResult as ProviderLikeResult),
    );

    currentStep = "candidate_health";
    const robustCandidateTradeStats = getDemo2RobustCandidateTradeStats();
    const robustCandidateHealth = evaluateCandidateHealth(robustCandidateDecision.allow ? robustCandidateDecision.match : null, phase16PForwardValidation, phase16QForwardValidation, robustCandidateTradeStats);
    if (robustCandidateDecision.allow && !robustCandidateHealth.allow) { store.status.runCount += 1; store.status.lastResult = { ok: true, stage: "auto_runner_robust_candidate_paused", message: robustCandidateHealth.reason, debug: providerResult.debug, marketObservation, marketObservationForwardValidation, phase16PForwardValidation, phase16QForwardValidation, robustCandidateDecision, robustCandidateHealth, robustCandidateTradeStats, forwardValidation, demoPart2: getDemoPart2Status() }; return; }

    if (!providerResult.ok && !robustCandidateDecision.allow) {
      const skipped = {
        ok: true,
        stage: "auto_runner_feature_skip",
        message:
          "Deriv candles取得は確認し、Feature条件不足のため取引しませんでした。固定0値では保存しません。Market ObservationとForward Validation候補だけ確認しました。",
        debug: providerResult.debug,
        marketObservation,
        marketObservationForwardValidation,
        phase16PForwardValidation,
        phase16QForwardValidation,
        robustCandidateDecision,
        robustCandidateHealth,
        robustCandidateTradeStats,
        forwardValidation,
        demoPart2: getDemoPart2Status(),
      };
      store.status.runCount += 1;
      store.status.lastResult = skipped;
      return;
    }

    const normalizedProvider = providerResult as ProviderLikeResult;
    const baseFeatures = normalizedProvider.features ?? {};
    const debug = normalizedProvider.debug ?? {};
    const robustMatch = robustCandidateDecision.allow
      ? robustCandidateDecision.match
      : null;

    const signal = {
      ...providerResult,
      ok: true,
      pair:
        normalizedProvider.pair ??
        textOrNull(debug.pair) ??
        textOrNull((debug.asset as any)?.pair) ??
        "Volatility 100 Index",
      direction:
        robustMatch?.direction ??
        normalizedProvider.direction ??
        directionOrNull(debug.selectedDirection) ??
        "HIGH",
      score:
        robustMatch?.directionalScore ??
        numberOrNull(normalizedProvider.score) ??
        numberOrNull(debug.selectedScore) ??
        70,
      features: {
        ...baseFeatures,
        highScore: numberOrNull(baseFeatures.highScore) ?? numberOrNull(debug.highScore),
        lowScore: numberOrNull(baseFeatures.lowScore) ?? numberOrNull(debug.lowScore),
        selectedScore:
          numberOrNull(baseFeatures.selectedScore) ??
          numberOrNull(debug.selectedScore),
        selectedDirection:
          directionOrNull(baseFeatures.selectedDirection) ??
          directionOrNull(debug.selectedDirection),
        rci9: numberOrNull(baseFeatures.rci9) ?? numberOrNull(debug.rci9),
        rci26: numberOrNull(baseFeatures.rci26) ?? numberOrNull(debug.rci26),
        rci52: numberOrNull(baseFeatures.rci52) ?? numberOrNull(debug.rci52),
        atr: numberOrNull(baseFeatures.atr) ?? numberOrNull(debug.atr),
        smcScore:
          numberOrNull(baseFeatures.smcScore) ??
          numberOrNull(debug.smcScore),
        backtestWinRate1m:
          numberOrNull(baseFeatures.backtestWinRate1m) ??
          numberOrNull(debug.backtest1mWinRate),
        backtestWinRate3m:
          numberOrNull(baseFeatures.backtestWinRate3m) ??
          numberOrNull(debug.backtest3mWinRate),
        demo2RobustCandidate: robustMatch,
      },
      reasons: [
        ...(normalizedProvider.reasons ?? []),
        ...(robustMatch?.reasons ?? []),
      ],
    };

    store.status.lastResult = {
      ok: true,
      stage: "auto_runner_trading_engine_start",
      message: "Feature条件合格。Trading Engineへ送信します。",
      providerDebug: signal.debug,
      marketObservation,
      marketObservationForwardValidation,
      phase16PForwardValidation,
      phase16QForwardValidation,
      robustCandidateDecision,
      robustCandidateHealth,
      robustCandidateTradeStats,
      forwardValidation,
      demoPart2: getDemoPart2Status(),
    };

    currentStep = "trading_engine";
    const result = await executeDemoTradingEngine({
      accountId: DEFAULT_ACCOUNT_ID,
      pair: signal.pair,
      direction: signal.direction,
      score: signal.score,
      amount: 1,
      duration: 1,
      durationUnit: "m",
      currency: "USD",
      minScore: 70,
      minPayoutRate: 1.8,
      minConfidence: 30,
      debugBypassDemo100Completed: true,
      demoPart2RobustCandidate: robustMatch,
      features: {
        ...signal.features,
        autoRunnerMode: "demo_part2",
        autoRunnerReasons: signal.reasons,
      } as any,
    });

    store.status.runCount += 1;
    store.status.lastResult = {
      ...result,
      autoRunnerProviderDebug: signal.debug,
      marketObservation,
      marketObservationForwardValidation,
      phase16PForwardValidation,
      phase16QForwardValidation,
      robustCandidateDecision,
      robustCandidateHealth,
      robustCandidateTradeStats,
      forwardValidation,
      demoPart2: getDemoPart2Status(),
    };

    const after = getDemoPart2Status();
    if (after.completed) {
      stopServerAutoRunner("Demo Part2 completed after trade");
    }
  } catch (error: unknown) {
    const details = errorDetails(error, currentStep);
    store.status.lastError = `${details.step}: ${details.message}`;
    store.status.lastResult = { ok: false, stage: "auto_runner_run_error", step: details.step, message: details.message, error: details, demoPart2: getDemoPart2Status() };
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

  const demoPart2 = getDemoPart2Status();
  if (demoPart2.completed) {
    return {
      ok: true,
      stage: "auto_runner_not_started_demo_part2_completed",
      status: getServerAutoRunnerStatus(),
      message: "Demo Part2 300件が完了済みのため起動しません。",
    };
  }

  store.status.running = true;
  store.status.startedAt = new Date().toISOString();
  store.status.stoppedAt = null;
  store.status.intervalMs = Math.max(intervalMs, DEFAULT_INTERVAL_MS);
  store.status.mode = "demo_part2";

  runOnce();

  store.timer = setInterval(() => {
    runOnce();
  }, store.status.intervalMs);

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
    demoPart2: getDemoPart2Status(),
  };
}