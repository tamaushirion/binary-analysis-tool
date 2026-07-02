export type TradeDirection = "HIGH" | "LOW";

export type RawFeatureSnapshotInput = {
  pair: string;
  direction: TradeDirection;
  score: number;
  finalScore?: number | null;
  weightScore?: number | null;
  similarityScore?: number | null;

  features?: Record<string, any> | null;

  now?: Date;
};

export type BuiltFeatureSnapshot = {
  pair: string;
  direction: TradeDirection;
  aiScore: number;
  finalScore: number | null;
  weightScore: number | null;
  similarityScore: number | null;

  ema9: number | null;
  ema21: number | null;
  emaDiff: number | null;
  emaTrend: "UP" | "DOWN" | "RANGE" | "unknown";

  rci9: number | null;
  rci26: number | null;
  rci52: number | null;
  rciDirection: "UP" | "DOWN" | "MIXED" | "unknown";

  atr: number | null;
  atrThreshold: number | null;
  atrLevel: "LOW" | "NORMAL" | "HIGH" | "unknown";

  smcScore: number;
  bos: boolean | null;
  choch: boolean | null;
  fvg: boolean | null;
  orderBlock: boolean | null;
  liquidity: boolean | null;
  smcStrength: "NONE" | "WEAK" | "MEDIUM" | "STRONG";

  backtestWinRate1m: number | null;
  backtestWinRate3m: number | null;
  backtestStrength: "WEAK" | "NORMAL" | "STRONG" | "unknown";

  hour: number;
  weekday: number;
  session: "TOKYO" | "LONDON" | "NEW_YORK" | "OFF_HOURS";

  marketPhase: "TREND" | "RANGE" | "VOLATILE" | "unknown";
  volatilityLevel: "LOW" | "NORMAL" | "HIGH" | "unknown";

  source: string;
  createdAtIso: string;
};

function toFiniteNumber(value: any): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolOrNull(value: any): boolean | null {
  if (value === true || value === 1 || value === "1" || value === "true") {
    return true;
  }

  if (value === false || value === 0 || value === "0" || value === "false") {
    return false;
  }

  return null;
}

function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}

function clampScore(value: any) {
  const score = toFiniteNumber(value) ?? 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function getEmaTrend(ema9: number | null, ema21: number | null) {
  if (ema9 === null || ema21 === null) return "unknown";
  if (ema9 > ema21) return "UP";
  if (ema9 < ema21) return "DOWN";
  return "RANGE";
}

function getRciDirection(
  rci9: number | null,
  rci26: number | null,
  rci52: number | null
) {
  if (rci9 === null || rci26 === null || rci52 === null) return "unknown";

  const bullish = rci9 > 30 && rci26 > 0 && rci52 > -30;
  const bearish = rci9 < -30 && rci26 < 0 && rci52 < 30;

  if (bullish) return "UP";
  if (bearish) return "DOWN";
  return "MIXED";
}

function getAtrLevel(atr: number | null, atrThreshold: number | null) {
  if (atr === null) return "unknown";

  if (atrThreshold !== null && atrThreshold > 0) {
    if (atr < atrThreshold * 0.7) return "LOW";
    if (atr > atrThreshold * 1.5) return "HIGH";
    return "NORMAL";
  }

  if (atr <= 0) return "LOW";
  if (atr < 0.1) return "LOW";
  if (atr < 1) return "NORMAL";
  return "HIGH";
}

function getSmcStrength(smcScore: number) {
  if (smcScore >= 70) return "STRONG";
  if (smcScore >= 40) return "MEDIUM";
  if (smcScore > 0) return "WEAK";
  return "NONE";
}

function getBacktestStrength(winRate: number | null) {
  if (winRate === null) return "unknown";
  if (winRate >= 60) return "STRONG";
  if (winRate >= 52) return "NORMAL";
  return "WEAK";
}

function getSession(hour: number) {
  if (hour >= 8 && hour < 15) return "TOKYO";
  if (hour >= 15 && hour < 22) return "LONDON";
  if (hour >= 22 || hour < 5) return "NEW_YORK";
  return "OFF_HOURS";
}

function getMarketPhase(params: {
  emaTrend: BuiltFeatureSnapshot["emaTrend"];
  atrLevel: BuiltFeatureSnapshot["atrLevel"];
  smcStrength: BuiltFeatureSnapshot["smcStrength"];
}) {
  if (params.atrLevel === "HIGH") return "VOLATILE";
  if (
    params.emaTrend !== "unknown" &&
    params.emaTrend !== "RANGE" &&
    (params.smcStrength === "MEDIUM" || params.smcStrength === "STRONG")
  ) {
    return "TREND";
  }

  if (params.emaTrend === "RANGE") return "RANGE";

  return "unknown";
}

export function buildFeatureSnapshot(
  input: RawFeatureSnapshotInput
): BuiltFeatureSnapshot {
  const features = input.features ?? {};
  const now = input.now ?? new Date();

  const ema9 = toFiniteNumber(features.ema9);
  const ema21 = toFiniteNumber(features.ema21);
  const emaDiff =
    ema9 !== null && ema21 !== null
      ? round4(ema9 - ema21)
      : toFiniteNumber(features.emaDiff);

  const rci9 = toFiniteNumber(features.rci9);
  const rci26 = toFiniteNumber(features.rci26);
  const rci52 = toFiniteNumber(features.rci52);

  const atr = toFiniteNumber(features.atr);
  const atrThreshold = toFiniteNumber(features.atrThreshold);

  const smcScore = clampScore(features.smcScore ?? 0);
  const bos = toBoolOrNull(features.bos);
  const choch = toBoolOrNull(features.choch);
  const fvg = toBoolOrNull(features.fvg);
  const orderBlock = toBoolOrNull(
    features.orderBlock ?? features.order_block
  );
  const liquidity = toBoolOrNull(features.liquidity);

  const backtestWinRate1m = toFiniteNumber(
    features.backtestWinRate1m ?? features.backtest1mWinRate
  );
  const backtestWinRate3m = toFiniteNumber(
    features.backtestWinRate3m ?? features.backtest3mWinRate
  );

  const hour = Number.isInteger(features.hour)
    ? Number(features.hour)
    : now.getHours();
  const weekday = Number.isInteger(features.weekday)
    ? Number(features.weekday)
    : now.getDay();

  const emaTrend = getEmaTrend(ema9, ema21);
  const rciDirection = getRciDirection(rci9, rci26, rci52);
  const atrLevel = getAtrLevel(atr, atrThreshold);
  const smcStrength = getSmcStrength(smcScore);
  const backtestStrength = getBacktestStrength(backtestWinRate1m);
  const session = getSession(hour);
  const marketPhase = getMarketPhase({
    emaTrend,
    atrLevel,
    smcStrength,
  });

  return {
    pair: input.pair,
    direction: input.direction,
    aiScore: clampScore(input.score),
    finalScore:
      input.finalScore === null || input.finalScore === undefined
        ? null
        : clampScore(input.finalScore),
    weightScore:
      input.weightScore === null || input.weightScore === undefined
        ? null
        : clampScore(input.weightScore),
    similarityScore:
      input.similarityScore === null || input.similarityScore === undefined
        ? null
        : clampScore(input.similarityScore),

    ema9,
    ema21,
    emaDiff,
    emaTrend,

    rci9,
    rci26,
    rci52,
    rciDirection,

    atr,
    atrThreshold,
    atrLevel,

    smcScore,
    bos,
    choch,
    fvg,
    orderBlock,
    liquidity,
    smcStrength,

    backtestWinRate1m,
    backtestWinRate3m,
    backtestStrength,

    hour,
    weekday,
    session,

    marketPhase,
    volatilityLevel: atrLevel,

    source: String(features.source ?? features.mainLogic ?? "unknown"),
    createdAtIso: now.toISOString(),
  };
}
