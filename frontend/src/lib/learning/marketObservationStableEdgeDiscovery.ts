import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type StableEdgeDirection = "HIGH" | "LOW";
export type StableEdgeMode = "FORWARD" | "REVERSE";
export type StableEdgeResult = "WIN" | "LOST" | "DRAW";
export type StableEdgeFoldName = "TRAIN" | "VALIDATION_A" | "VALIDATION_B" | "RECENT";
export type StableEdgeClassification =
  | "PERSISTENT_STRONG"
  | "STABLE_EDGE"
  | "REVERSE_PERSISTENT_STRONG"
  | "REVERSE_STABLE_EDGE"
  | "WATCH"
  | "UNSTABLE"
  | "REJECT";

export type MarketObservationStableEdgeOptions = {
  dbPath?: string;
  featureVersion?: string;
  minDecided?: number;
  minFoldDecided?: number;
  minOverallWinRate?: number;
  minSegmentWinRate?: number;
  persistentWinRate?: number;
  minWilsonLowerBound?: number;
  maxSegmentGap?: number;
  recentWindow?: number;
  maxCombinationSize?: 1 | 2 | 3;
  dedupThreshold?: number;
  maxHourDependency?: number;
  maxDayDependency?: number;
  limitPerRanking?: number;
  includeWatch?: boolean;
  includeUnstable?: boolean;
  includeRejected?: boolean;
};

type ObservationRow = {
  id: number;
  epoch: number;
  high_result: string;
  low_result: string;
  high_profit: number | null;
  low_profit: number | null;
  high_score: number | null;
  low_score: number | null;
  selected_score: number | null;
  selected_direction: string | null;
  ema_diff: number | null;
  rci9: number | null;
  rci26: number | null;
  rci52: number | null;
  atr: number | null;
  trend: string | null;
  session: string | null;
  hour: number | null;
  weekday: number | null;
  bos: number | null;
  choch: number | null;
  fvg: number | null;
  smc_score: number | null;
  backtest_win_rate_1m: number | null;
  backtest_win_rate_3m: number | null;
};

type ParsedObservation = ObservationRow & {
  highStatus: StableEdgeResult;
  lowStatus: StableEdgeResult;
  highProfitValue: number;
  lowProfitValue: number;
  featureValues: string[];
  dayKey: string;
};

type CandidateAccumulator = {
  key: string;
  values: string[];
  signalDirection: StableEdgeDirection;
  executionDirection: StableEdgeDirection;
  mode: StableEdgeMode;
  observationIds: number[];
};

export type StableEdgeStats = {
  sample: number;
  decided: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number | null;
  profit: number;
  avgProfit: number | null;
  wilsonLowerBound: number | null;
};

export type StableEdgeFoldStats = StableEdgeStats & {
  name: StableEdgeFoldName;
};

export type MarketObservationStableEdgeCandidate = {
  key: string;
  conditionLabel: string;
  values: string[];
  featureCount: number;
  signalDirection: StableEdgeDirection;
  executionDirection: StableEdgeDirection;
  mode: StableEdgeMode;
  sample: number;
  decided: number;
  wins: number;
  losses: number;
  draws: number;
  overallWinRate: number | null;
  firstHalfWinRate: number | null;
  secondHalfWinRate: number | null;
  recent100WinRate: number | null;
  firstHalf: StableEdgeStats;
  secondHalf: StableEdgeStats;
  recent100: StableEdgeStats;
  folds: StableEdgeFoldStats[];
  totalProfit: number;
  avgProfit: number | null;
  wilsonLowerBound: number | null;
  directionalEdgeFrom50: number | null;
  minSegmentWinRate: number | null;
  maxSegmentWinRate: number | null;
  maxSegmentWinRateGap: number | null;
  occurrenceRate: number;
  uniqueHourCount: number;
  maxHourShare: number;
  timeDependency: "LOW" | "MEDIUM" | "HIGH";
  uniqueDayCount: number;
  maxDayShare: number;
  dayDependency: "LOW" | "MEDIUM" | "HIGH";
  riskNote: string | null;
  automaticStrongEligible: boolean;
  classification: StableEdgeClassification;
  stabilityScore: number;
  reasons: string[];
};

type InternalStableEdgeCandidate = MarketObservationStableEdgeCandidate & {
  observationIds: number[];
};

export type StableEdgeDedupPair = {
  keptKey: string;
  removedKey: string;
  intersection: number;
  union: number;
  jaccard: number;
};

export type StableEdgeDirectionComparison = {
  values: string[];
  forwardHighKey: string | null;
  forwardLowKey: string | null;
  reverseHighKey: string | null;
  reverseLowKey: string | null;
  bestKey: string;
  bestMode: StableEdgeMode;
  bestSignalDirection: StableEdgeDirection;
  bestExecutionDirection: StableEdgeDirection;
  bestWinRate: number | null;
  bestProfit: number;
  winRateSpread: number | null;
};

export type MarketObservationStableEdgeResult = {
  ok: true;
  stage: "market_observation_stable_edge_discovery";
  generatedAt: string;
  dbPath: string;
  tableName: "market_observations";
  featureVersion: string;
  totalRecords: number;
  usedRecords: number;
  options: Required<MarketObservationStableEdgeOptions>;
  foldBoundaries: {
    trainEndIndex: number;
    validationAEndIndex: number;
    validationBEndIndex: number;
    recentStartIndex: number;
  };
  summary: {
    generatedGroups: number;
    evaluatedCandidates: number;
    deduplicatedCandidates: number;
    persistentStrong: number;
    stableEdge: number;
    reversePersistentStrong: number;
    reverseStableEdge: number;
    watch: number;
    unstable: number;
    reject: number;
    persistent58Plus: number;
    futureLeakageRiskCandidates: number;
  };
  persistent58Plus: MarketObservationStableEdgeCandidate[];
  classifications: Record<StableEdgeClassification, MarketObservationStableEdgeCandidate[]>;
  rankings: {
    stability: MarketObservationStableEdgeCandidate[];
    winRate: MarketObservationStableEdgeCandidate[];
    profit: MarketObservationStableEdgeCandidate[];
    frequency: MarketObservationStableEdgeCandidate[];
    forward: MarketObservationStableEdgeCandidate[];
    reverse: MarketObservationStableEdgeCandidate[];
    directionalEdge: MarketObservationStableEdgeCandidate[];
    bothDirections: StableEdgeDirectionComparison[];
  };
  dedupPairs: StableEdgeDedupPair[];
  candidates: MarketObservationStableEdgeCandidate[];
  message: string;
};

const TABLE_NAME = "market_observations" as const;
const DEFAULT_FEATURE_VERSION = "phase16-k-market-observation-v1";

const DEFAULT_OPTIONS: Required<MarketObservationStableEdgeOptions> = {
  dbPath: "",
  featureVersion: DEFAULT_FEATURE_VERSION,
  minDecided: 100,
  minFoldDecided: 15,
  minOverallWinRate: 55,
  minSegmentWinRate: 55,
  persistentWinRate: 58,
  minWilsonLowerBound: 50,
  maxSegmentGap: 12,
  recentWindow: 100,
  maxCombinationSize: 3,
  dedupThreshold: 0.9,
  maxHourDependency: 0.35,
  maxDayDependency: 0.45,
  limitPerRanking: 50,
  includeWatch: true,
  includeUnstable: false,
  includeRejected: false,
};

function resolveDbPath(input?: string): string {
  if (input?.trim()) return path.resolve(input.trim());
  const candidates = [
    path.join(process.cwd(), "data", "ai.db"),
    path.join(process.cwd(), "..", "data", "ai.db"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`SQLite database not found. Checked: ${candidates.join(", ")}`);
  return found;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = finiteNumber(value);
  return numeric === null ? fallback : Math.min(max, Math.max(min, numeric));
}

function integerNumber(value: unknown, fallback: number, min: number, max: number): number {
  return Math.floor(boundedNumber(value, fallback, min, max));
}

function resolveOptions(input?: MarketObservationStableEdgeOptions): Required<MarketObservationStableEdgeOptions> {
  return {
    dbPath: resolveDbPath(input?.dbPath),
    featureVersion: input?.featureVersion?.trim() || DEFAULT_OPTIONS.featureVersion,
    minDecided: integerNumber(input?.minDecided, DEFAULT_OPTIONS.minDecided, 20, 1000000),
    minFoldDecided: integerNumber(input?.minFoldDecided, DEFAULT_OPTIONS.minFoldDecided, 1, 100000),
    minOverallWinRate: boundedNumber(input?.minOverallWinRate, DEFAULT_OPTIONS.minOverallWinRate, 50, 100),
    minSegmentWinRate: boundedNumber(input?.minSegmentWinRate, DEFAULT_OPTIONS.minSegmentWinRate, 50, 100),
    persistentWinRate: boundedNumber(input?.persistentWinRate, DEFAULT_OPTIONS.persistentWinRate, 50, 100),
    minWilsonLowerBound: boundedNumber(input?.minWilsonLowerBound, DEFAULT_OPTIONS.minWilsonLowerBound, 0, 100),
    maxSegmentGap: boundedNumber(input?.maxSegmentGap, DEFAULT_OPTIONS.maxSegmentGap, 0, 50),
    recentWindow: integerNumber(input?.recentWindow, DEFAULT_OPTIONS.recentWindow, 20, 10000),
    maxCombinationSize:
      input?.maxCombinationSize === 1 || input?.maxCombinationSize === 2 ? input.maxCombinationSize : 3,
    dedupThreshold: boundedNumber(input?.dedupThreshold, DEFAULT_OPTIONS.dedupThreshold, 0.5, 1),
    maxHourDependency: boundedNumber(input?.maxHourDependency, DEFAULT_OPTIONS.maxHourDependency, 0.05, 1),
    maxDayDependency: boundedNumber(input?.maxDayDependency, DEFAULT_OPTIONS.maxDayDependency, 0.05, 1),
    limitPerRanking: integerNumber(input?.limitPerRanking, DEFAULT_OPTIONS.limitPerRanking, 1, 500),
    includeWatch: input?.includeWatch ?? DEFAULT_OPTIONS.includeWatch,
    includeUnstable: input?.includeUnstable ?? DEFAULT_OPTIONS.includeUnstable,
    includeRejected: input?.includeRejected ?? DEFAULT_OPTIONS.includeRejected,
  };
}

function round(value: number, digits = 2): number {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function normalizeResult(value: string): StableEdgeResult {
  if (value === "WIN" || value === "LOST" || value === "DRAW") return value;
  return "DRAW";
}

function safeText(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toUpperCase() : null;
}

function band(prefix: string, value: number | null, width = 10): string | null {
  const numeric = finiteNumber(value);
  if (numeric === null) return null;
  const lower = Math.floor(numeric / width) * width;
  return `${prefix}:${lower}-${lower + width - 1}`;
}

function signedBand(prefix: string, value: number | null): string | null {
  const numeric = finiteNumber(value);
  if (numeric === null) return null;
  if (numeric <= -80) return `${prefix}:OVERSOLD(<=-80)`;
  if (numeric <= -50) return `${prefix}:STRONG_DOWN(-79--50)`;
  if (numeric < 50) return `${prefix}:NEUTRAL(-49-49)`;
  if (numeric < 80) return `${prefix}:STRONG_UP(50-79)`;
  return `${prefix}:OVERBOUGHT(>=80)`;
}

function emaLabel(value: number | null): string | null {
  const numeric = finiteNumber(value);
  if (numeric === null) return null;
  if (Math.abs(numeric) < 0.05) return "EMA:FLAT";
  return numeric > 0 ? "EMA:UP" : "EMA:DOWN";
}

function atrLabel(value: number | null): string | null {
  const numeric = finiteNumber(value);
  if (numeric === null) return null;
  if (numeric < 0.4) return "ATR:LOW(<0.4)";
  if (numeric < 0.8) return "ATR:NORMAL(0.4-0.79)";
  if (numeric < 1.2) return "ATR:HIGH(0.8-1.19)";
  return "ATR:EXTREME(>=1.2)";
}

function boolLabel(prefix: string, value: number | null): string | null {
  const numeric = finiteNumber(value);
  return numeric === null ? null : `${prefix}:${numeric !== 0 ? "YES" : "NO"}`;
}

function featureValues(row: ObservationRow): string[] {
  const trend = safeText(row.trend);
  const session = safeText(row.session);
  const values: Array<string | null> = [
    emaLabel(row.ema_diff),
    atrLabel(row.atr),
    signedBand("RCI9", row.rci9),
    signedBand("RCI26", row.rci26),
    signedBand("RCI52", row.rci52),
    trend ? `Trend:${trend}` : null,
    session ? `Session:${session}` : null,
    finiteNumber(row.hour) !== null ? `Hour:${Math.trunc(row.hour as number)}` : null,
    finiteNumber(row.weekday) !== null ? `Weekday:${Math.trunc(row.weekday as number)}` : null,
    band("HighScore", row.high_score),
    band("LowScore", row.low_score),
    band("SelectedScore", row.selected_score),
    row.selected_direction === "HIGH" || row.selected_direction === "LOW"
      ? `SelectedDirection:${row.selected_direction}`
      : null,
    boolLabel("BOS", row.bos),
    boolLabel("CHOCH", row.choch),
    boolLabel("FVG", row.fvg),
    band("SMCScore", row.smc_score),
    band("Backtest1m", row.backtest_win_rate_1m, 5),
    band("Backtest3m", row.backtest_win_rate_3m, 5),
  ];
  return values.filter((value): value is string => value !== null);
}

function featureName(value: string): string {
  const index = value.indexOf(":");
  return index >= 0 ? value.slice(0, index) : value;
}

function combinations(values: string[], size: number): string[][] {
  const output: string[][] = [];
  const walk = (start: number, current: string[]): void => {
    if (current.length === size) {
      output.push([...current]);
      return;
    }
    for (let index = start; index < values.length; index += 1) {
      current.push(values[index]);
      walk(index + 1, current);
      current.pop();
    }
  };
  walk(0, []);
  return output;
}

function canCombine(values: string[]): boolean {
  return new Set(values.map(featureName)).size === values.length;
}

function oppositeDirection(direction: StableEdgeDirection): StableEdgeDirection {
  return direction === "HIGH" ? "LOW" : "HIGH";
}

function wilsonLowerBound(wins: number, total: number, z = 1.96): number | null {
  if (total <= 0) return null;
  const p = wins / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return round(((centre - margin) / denominator) * 100, 2);
}

function loadRows(db: Database.Database, featureVersion: string): ObservationRow[] {
  return db.prepare(`
    SELECT
      id, epoch, high_result, low_result, high_profit, low_profit,
      high_score, low_score, selected_score, selected_direction,
      ema_diff, rci9, rci26, rci52, atr, trend, session, hour, weekday,
      bos, choch, fvg, smc_score, backtest_win_rate_1m, backtest_win_rate_3m
    FROM ${TABLE_NAME}
    WHERE feature_version = ?
      AND high_result IN ('WIN', 'LOST', 'DRAW')
      AND low_result IN ('WIN', 'LOST', 'DRAW')
    ORDER BY epoch ASC, id ASC
  `).all(featureVersion) as ObservationRow[];
}

function assertTable(db: Database.Database): void {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(TABLE_NAME) as { name?: string } | undefined;
  if (!row?.name) throw new Error("market_observations table not found in SQLite database.");
}

function statsForRows(rows: ParsedObservation[], executionDirection: StableEdgeDirection): StableEdgeStats {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let profit = 0;

  for (const row of rows) {
    const result = executionDirection === "HIGH" ? row.highStatus : row.lowStatus;
    profit += executionDirection === "HIGH" ? row.highProfitValue : row.lowProfitValue;
    if (result === "WIN") wins += 1;
    else if (result === "LOST") losses += 1;
    else draws += 1;
  }

  const decided = wins + losses;
  return {
    sample: rows.length,
    decided,
    wins,
    losses,
    draws,
    winRate: decided > 0 ? round((wins / decided) * 100, 2) : null,
    profit: round(profit, 4),
    avgProfit: decided > 0 ? round(profit / decided, 4) : null,
    wilsonLowerBound: wilsonLowerBound(wins, decided),
  };
}

function resolveFoldIndexes(length: number): {
  trainEndIndex: number;
  validationAEndIndex: number;
  validationBEndIndex: number;
  recentStartIndex: number;
} {
  const trainEndIndex = Math.floor(length * 0.4);
  const validationAEndIndex = Math.floor(length * 0.6);
  const validationBEndIndex = Math.floor(length * 0.8);
  return {
    trainEndIndex,
    validationAEndIndex,
    validationBEndIndex,
    recentStartIndex: validationBEndIndex,
  };
}

function dependencyLevel(share: number, mediumThreshold: number): "LOW" | "MEDIUM" | "HIGH" {
  if (share >= mediumThreshold) return "HIGH";
  if (share >= mediumThreshold * 0.7) return "MEDIUM";
  return "LOW";
}

function maxShare(values: string[]): number {
  if (values.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Math.max(...counts.values()) / values.length;
}

function riskNote(values: string[]): string | null {
  const risky = values.filter((value) => value.startsWith("Backtest1m:") || value.startsWith("Backtest3m:"));
  return risky.length > 0
    ? `${risky.join(" / ")}を使用しています。算出時の未来情報混入リスクが未確認のため、自動強候補・Demo接続候補として扱いません。`
    : null;
}

function classifyCandidate(
  candidate: Omit<InternalStableEdgeCandidate, "classification" | "stabilityScore" | "reasons">,
  options: Required<MarketObservationStableEdgeOptions>,
): { classification: StableEdgeClassification; stabilityScore: number; reasons: string[] } {
  const reasons: string[] = [];
  const segmentRates = [
    candidate.firstHalfWinRate,
    candidate.secondHalfWinRate,
    candidate.recent100WinRate,
    ...candidate.folds.map((fold) => fold.winRate),
  ];
  const completeRates = segmentRates.filter((rate): rate is number => rate !== null);
  const allFoldSamplesEnough = candidate.folds.every((fold) => fold.decided >= options.minFoldDecided);
  const allBaseSegments = [
    candidate.overallWinRate,
    candidate.firstHalfWinRate,
    candidate.secondHalfWinRate,
    candidate.recent100WinRate,
  ].every((rate) => rate !== null && rate >= options.minSegmentWinRate);
  const allPersistentSegments = [
    candidate.overallWinRate,
    candidate.firstHalfWinRate,
    candidate.secondHalfWinRate,
    candidate.recent100WinRate,
    ...candidate.folds.map((fold) => fold.winRate),
  ].every((rate) => rate !== null && rate >= options.persistentWinRate);
  const allFoldsBase = candidate.folds.every(
    (fold) => fold.winRate !== null && fold.winRate >= options.minSegmentWinRate,
  );
  const allFoldsProfitable = candidate.folds.every((fold) => fold.profit > 0);
  const enough = candidate.decided >= options.minDecided;
  const profitable = candidate.totalProfit > 0;
  const wilsonOkay = (candidate.wilsonLowerBound ?? 0) >= options.minWilsonLowerBound;
  const gapOkay =
    candidate.maxSegmentWinRateGap !== null &&
    candidate.maxSegmentWinRateGap <= options.maxSegmentGap;
  const dependencyOkay =
    candidate.maxHourShare <= options.maxHourDependency &&
    candidate.maxDayShare <= options.maxDayDependency;
  const eligible = candidate.automaticStrongEligible;

  if (!enough) reasons.push(`最低${options.minDecided}決着に未達です。`);
  if (!allFoldSamplesEnough) reasons.push("TRAIN / VALIDATION_A / VALIDATION_B / RECENTの決着件数が不足しています。");
  if (!allBaseSegments) reasons.push(`全体・前半・後半・直近で勝率${options.minSegmentWinRate}%以上を維持していません。`);
  if (!allFoldsBase) reasons.push(`4区間すべてで勝率${options.minSegmentWinRate}%以上を維持していません。`);
  if (!profitable) reasons.push("全体Profitがプラスではありません。");
  if (!allFoldsProfitable) reasons.push("Profitがマイナスの検証区間があります。");
  if (!wilsonOkay) reasons.push(`Wilson下限が${options.minWilsonLowerBound}%未満です。`);
  if (!gapOkay) reasons.push(`最大区間勝率差が${options.maxSegmentGap}ポイントを超えています。`);
  if (!dependencyOkay) reasons.push("特定時間帯または特定日への依存が強すぎます。");
  if (!eligible) reasons.push("未来情報混入リスク未確認の特徴量を含むため、自動強候補から除外します。");

  const averageRate =
    completeRates.length > 0
      ? completeRates.reduce((sum, rate) => sum + rate, 0) / completeRates.length
      : 0;
  const gapPenalty = candidate.maxSegmentWinRateGap ?? 50;
  const dependencyPenalty = (candidate.maxHourShare + candidate.maxDayShare) * 12;
  const sampleBonus = Math.min(8, Math.log10(Math.max(10, candidate.decided)) * 3);
  const wilsonBonus = Math.max(0, (candidate.wilsonLowerBound ?? 0) - 45) * 0.4;
  const stabilityScore = round(
    averageRate - gapPenalty * 0.9 - dependencyPenalty + sampleBonus + wilsonBonus,
    3,
  );

  const persistentReady =
    enough &&
    allFoldSamplesEnough &&
    allPersistentSegments &&
    profitable &&
    allFoldsProfitable &&
    wilsonOkay &&
    gapOkay &&
    dependencyOkay &&
    eligible;

  const stableReady =
    enough &&
    allFoldSamplesEnough &&
    allBaseSegments &&
    allFoldsBase &&
    profitable &&
    wilsonOkay &&
    gapOkay &&
    dependencyOkay &&
    eligible;

  if (persistentReady) {
    return {
      classification:
        candidate.mode === "FORWARD" ? "PERSISTENT_STRONG" : "REVERSE_PERSISTENT_STRONG",
      stabilityScore,
      reasons: [
        `全体・前後半・直近・4区間のすべてで${options.persistentWinRate}%以上を維持し、Profitと依存度基準も通過しています。`,
      ],
    };
  }

  if (stableReady) {
    return {
      classification: candidate.mode === "FORWARD" ? "STABLE_EDGE" : "REVERSE_STABLE_EDGE",
      stabilityScore,
      reasons: [
        `全体・前後半・直近・4区間で${options.minSegmentWinRate}%以上を維持し、過学習防止基準を通過しています。`,
      ],
    };
  }

  if (!enough || !allFoldSamplesEnough) {
    return { classification: "WATCH", stabilityScore, reasons };
  }

  const hasEdge = (candidate.overallWinRate ?? 0) >= options.minOverallWinRate && profitable;
  if (hasEdge && (!gapOkay || !dependencyOkay || !allFoldsBase || !allFoldsProfitable)) {
    return { classification: "UNSTABLE", stabilityScore, reasons };
  }

  return { classification: "REJECT", stabilityScore, reasons };
}

function buildCandidate(
  accumulator: CandidateAccumulator,
  rowsById: Map<number, ParsedObservation>,
  globalIndexById: Map<number, number>,
  totalRecordCount: number,
  foldIndexes: ReturnType<typeof resolveFoldIndexes>,
  options: Required<MarketObservationStableEdgeOptions>,
): InternalStableEdgeCandidate {
  const rows = accumulator.observationIds
    .map((id) => rowsById.get(id))
    .filter((row): row is ParsedObservation => Boolean(row));

  const firstHalfIndex = Math.floor(rows.length / 2);
  const firstHalfRows = rows.slice(0, firstHalfIndex);
  const secondHalfRows = rows.slice(firstHalfIndex);
  const recent100Rows = rows.slice(-Math.min(options.recentWindow, rows.length));

  const foldDefinitions: Array<{ name: StableEdgeFoldName; rows: ParsedObservation[] }> = [
    {
      name: "TRAIN",
      rows: rows.filter((row) => (globalIndexById.get(row.id) ?? -1) < foldIndexes.trainEndIndex),
    },
    {
      name: "VALIDATION_A",
      rows: rows.filter((row) => {
        const index = globalIndexById.get(row.id) ?? -1;
        return index >= foldIndexes.trainEndIndex && index < foldIndexes.validationAEndIndex;
      }),
    },
    {
      name: "VALIDATION_B",
      rows: rows.filter((row) => {
        const index = globalIndexById.get(row.id) ?? -1;
        return index >= foldIndexes.validationAEndIndex && index < foldIndexes.validationBEndIndex;
      }),
    },
    {
      name: "RECENT",
      rows: rows.filter((row) => (globalIndexById.get(row.id) ?? -1) >= foldIndexes.recentStartIndex),
    },
  ];

  const overall = statsForRows(rows, accumulator.executionDirection);
  const firstHalf = statsForRows(firstHalfRows, accumulator.executionDirection);
  const secondHalf = statsForRows(secondHalfRows, accumulator.executionDirection);
  const recent100 = statsForRows(recent100Rows, accumulator.executionDirection);
  const folds = foldDefinitions.map(({ name, rows: foldRows }) => ({
    name,
    ...statsForRows(foldRows, accumulator.executionDirection),
  }));

  const segmentRates = [
    firstHalf.winRate,
    secondHalf.winRate,
    recent100.winRate,
    ...folds.map((fold) => fold.winRate),
  ].filter((rate): rate is number => rate !== null);
  const minSegmentWinRate = segmentRates.length === 7 ? Math.min(...segmentRates) : null;
  const maxSegmentWinRate = segmentRates.length === 7 ? Math.max(...segmentRates) : null;
  const maxSegmentWinRateGap =
    minSegmentWinRate === null || maxSegmentWinRate === null
      ? null
      : round(maxSegmentWinRate - minSegmentWinRate, 2);

  const hourValues = rows.map((row) => String(Math.trunc(row.hour ?? new Date(row.epoch * 1000).getUTCHours())));
  const dayValues = rows.map((row) => row.dayKey);
  const maxHourShare = round(maxShare(hourValues), 4);
  const maxDayShare = round(maxShare(dayValues), 4);
  const note = riskNote(accumulator.values);

  const base: Omit<
    InternalStableEdgeCandidate,
    "classification" | "stabilityScore" | "reasons"
  > = {
    key: accumulator.key,
    conditionLabel: `${accumulator.values.join(" × ")} × Signal:${accumulator.signalDirection} × ${accumulator.mode} → Execute:${accumulator.executionDirection}`,
    values: accumulator.values,
    featureCount: accumulator.values.length,
    signalDirection: accumulator.signalDirection,
    executionDirection: accumulator.executionDirection,
    mode: accumulator.mode,
    sample: overall.sample,
    decided: overall.decided,
    wins: overall.wins,
    losses: overall.losses,
    draws: overall.draws,
    overallWinRate: overall.winRate,
    firstHalfWinRate: firstHalf.winRate,
    secondHalfWinRate: secondHalf.winRate,
    recent100WinRate: recent100.winRate,
    firstHalf,
    secondHalf,
    recent100,
    folds,
    totalProfit: overall.profit,
    avgProfit: overall.avgProfit,
    wilsonLowerBound: overall.wilsonLowerBound,
    directionalEdgeFrom50:
      overall.winRate === null ? null : round(Math.abs(overall.winRate - 50), 2),
    minSegmentWinRate,
    maxSegmentWinRate,
    maxSegmentWinRateGap,
    occurrenceRate:
      totalRecordCount > 0 ? round((overall.sample / totalRecordCount) * 100, 4) : 0,
    uniqueHourCount: new Set(hourValues).size,
    maxHourShare,
    timeDependency: dependencyLevel(maxHourShare, options.maxHourDependency),
    uniqueDayCount: new Set(dayValues).size,
    maxDayShare,
    dayDependency: dependencyLevel(maxDayShare, options.maxDayDependency),
    riskNote: note,
    automaticStrongEligible: note === null,
    observationIds: accumulator.observationIds,
  };

  const classification = classifyCandidate(base, options);
  return {
    ...base,
    ...classification,
  };
}

function candidatePriority(candidate: MarketObservationStableEdgeCandidate): number {
  switch (candidate.classification) {
    case "PERSISTENT_STRONG":
    case "REVERSE_PERSISTENT_STRONG":
      return 7;
    case "STABLE_EDGE":
    case "REVERSE_STABLE_EDGE":
      return 6;
    case "WATCH":
      return 4;
    case "UNSTABLE":
      return 2;
    case "REJECT":
      return 1;
  }
}

function baseSort(
  left: MarketObservationStableEdgeCandidate,
  right: MarketObservationStableEdgeCandidate,
): number {
  return (
    candidatePriority(right) - candidatePriority(left) ||
    right.stabilityScore - left.stabilityScore ||
    (right.overallWinRate ?? -1) - (left.overallWinRate ?? -1) ||
    right.totalProfit - left.totalProfit ||
    right.decided - left.decided ||
    left.key.localeCompare(right.key)
  );
}

function jaccard(left: number[], right: number[]): {
  intersection: number;
  union: number;
  score: number;
} {
  const leftSet = new Set(left);
  let intersection = 0;
  for (const id of right) if (leftSet.has(id)) intersection += 1;
  const union = left.length + right.length - intersection;
  return {
    intersection,
    union,
    score: union > 0 ? intersection / union : 0,
  };
}

function deduplicateCandidates(
  candidates: InternalStableEdgeCandidate[],
  threshold: number,
): { kept: InternalStableEdgeCandidate[]; pairs: StableEdgeDedupPair[] } {
  const kept: InternalStableEdgeCandidate[] = [];
  const pairs: StableEdgeDedupPair[] = [];

  for (const candidate of [...candidates].sort(baseSort)) {
    let duplicate: InternalStableEdgeCandidate | undefined;
    let duplicateOverlap: ReturnType<typeof jaccard> | undefined;

    for (const existing of kept) {
      if (existing.mode !== candidate.mode) continue;
      if (existing.executionDirection !== candidate.executionDirection) continue;

      const smaller = Math.min(existing.observationIds.length, candidate.observationIds.length);
      const larger = Math.max(existing.observationIds.length, candidate.observationIds.length);
      if (larger === 0 || smaller / larger < threshold) continue;

      const overlap = jaccard(existing.observationIds, candidate.observationIds);
      if (overlap.score >= threshold) {
        duplicate = existing;
        duplicateOverlap = overlap;
        break;
      }
    }

    if (!duplicate || !duplicateOverlap) {
      kept.push(candidate);
      continue;
    }

    pairs.push({
      keptKey: duplicate.key,
      removedKey: candidate.key,
      intersection: duplicateOverlap.intersection,
      union: duplicateOverlap.union,
      jaccard: round(duplicateOverlap.score, 4),
    });
  }
  return { kept, pairs };
}

function toPublicCandidate(candidate: InternalStableEdgeCandidate): MarketObservationStableEdgeCandidate {
  const { observationIds: _observationIds, ...publicCandidate } = candidate;
  return publicCandidate;
}

function visibleCandidate(
  candidate: MarketObservationStableEdgeCandidate,
  options: Required<MarketObservationStableEdgeOptions>,
): boolean {
  if (candidate.classification === "WATCH") return options.includeWatch;
  if (candidate.classification === "UNSTABLE") return options.includeUnstable;
  if (candidate.classification === "REJECT") return options.includeRejected;
  return true;
}

function takeRanking(
  candidates: MarketObservationStableEdgeCandidate[],
  limit: number,
  sorter: (
    left: MarketObservationStableEdgeCandidate,
    right: MarketObservationStableEdgeCandidate,
  ) => number,
): MarketObservationStableEdgeCandidate[] {
  return [...candidates].sort(sorter).slice(0, limit);
}

function buildDirectionComparisons(
  candidates: MarketObservationStableEdgeCandidate[],
  limit: number,
): StableEdgeDirectionComparison[] {
  const grouped = new Map<string, MarketObservationStableEdgeCandidate[]>();
  for (const candidate of candidates) {
    const valuesKey = candidate.values.join(" × ");
    const current = grouped.get(valuesKey);
    if (current) current.push(candidate);
    else grouped.set(valuesKey, [candidate]);
  }

  return [...grouped.entries()]
    .map(([valuesKey, group]) => {
      const best = [...group].sort(
        (left, right) =>
          (right.overallWinRate ?? -1) - (left.overallWinRate ?? -1) ||
          right.totalProfit - left.totalProfit ||
          right.stabilityScore - left.stabilityScore,
      )[0];
      const rates = group
        .map((candidate) => candidate.overallWinRate)
        .filter((rate): rate is number => rate !== null);
      const findKey = (mode: StableEdgeMode, signalDirection: StableEdgeDirection): string | null =>
        group.find(
          (candidate) =>
            candidate.mode === mode && candidate.signalDirection === signalDirection,
        )?.key ?? null;

      return {
        values: valuesKey.split(" × "),
        forwardHighKey: findKey("FORWARD", "HIGH"),
        forwardLowKey: findKey("FORWARD", "LOW"),
        reverseHighKey: findKey("REVERSE", "HIGH"),
        reverseLowKey: findKey("REVERSE", "LOW"),
        bestKey: best.key,
        bestMode: best.mode,
        bestSignalDirection: best.signalDirection,
        bestExecutionDirection: best.executionDirection,
        bestWinRate: best.overallWinRate,
        bestProfit: best.totalProfit,
        winRateSpread:
          rates.length > 1 ? round(Math.max(...rates) - Math.min(...rates), 2) : null,
      };
    })
    .sort(
      (left, right) =>
        (right.bestWinRate ?? -1) - (left.bestWinRate ?? -1) ||
        right.bestProfit - left.bestProfit,
    )
    .slice(0, limit);
}

export function discoverMarketObservationStableEdges(
  input?: MarketObservationStableEdgeOptions,
): MarketObservationStableEdgeResult {
  const options = resolveOptions(input);
  const db = new Database(options.dbPath, { readonly: true });

  try {
    assertTable(db);
    const rows = loadRows(db, options.featureVersion);
    const parsedRows: ParsedObservation[] = rows.map((row) => ({
      ...row,
      highStatus: normalizeResult(row.high_result),
      lowStatus: normalizeResult(row.low_result),
      highProfitValue: finiteNumber(row.high_profit) ?? 0,
      lowProfitValue: finiteNumber(row.low_profit) ?? 0,
      featureValues: featureValues(row),
      dayKey: new Date(row.epoch * 1000).toISOString().slice(0, 10),
    }));

    const rowsById = new Map(parsedRows.map((row) => [row.id, row]));
    const globalIndexById = new Map(parsedRows.map((row, index) => [row.id, index]));
    const foldBoundaries = resolveFoldIndexes(parsedRows.length);
    const groups = new Map<string, CandidateAccumulator>();

    for (const row of parsedRows) {
      for (let size = 1; size <= options.maxCombinationSize; size += 1) {
        for (const rawCombination of combinations(row.featureValues, size)) {
          if (!canCombine(rawCombination)) continue;
          const values = [...rawCombination].sort();
          for (const signalDirection of ["HIGH", "LOW"] as const) {
            for (const mode of ["FORWARD", "REVERSE"] as const) {
              const executionDirection =
                mode === "FORWARD" ? signalDirection : oppositeDirection(signalDirection);
              const key = `${values.join(" × ")} × Signal:${signalDirection} × Mode:${mode}`;
              const existing = groups.get(key);
              if (existing) {
                existing.observationIds.push(row.id);
              } else {
                groups.set(key, {
                  key,
                  values,
                  signalDirection,
                  executionDirection,
                  mode,
                  observationIds: [row.id],
                });
              }
            }
          }
        }
      }
    }

    const generatedGroups = groups.size;
    const allCandidates = [...groups.values()]
      .filter((group) => group.observationIds.length >= options.minDecided)
      .map((group) =>
        buildCandidate(
          group,
          rowsById,
          globalIndexById,
          parsedRows.length,
          foldBoundaries,
          options,
        ),
      );

    const dedupPool = allCandidates.filter(
      (candidate) =>
        candidate.classification !== "REJECT" &&
        candidate.classification !== "UNSTABLE",
    );
    const excludedFromDedup = allCandidates.filter(
      (candidate) =>
        candidate.classification === "REJECT" ||
        candidate.classification === "UNSTABLE",
    );
    const deduplicated = deduplicateCandidates(dedupPool, options.dedupThreshold);
    const allAfterDedup = [...deduplicated.kept, ...excludedFromDedup];
    const visible = allAfterDedup
      .filter((candidate) => visibleCandidate(candidate, options))
      .map(toPublicCandidate);
    const rankingPool = deduplicated.kept.map(toPublicCandidate);

    const byClassification = (classification: StableEdgeClassification) =>
      visible.filter((candidate) => candidate.classification === classification).sort(baseSort);

    const persistent58PlusInternal = allAfterDedup
      .filter(
        (candidate) =>
          candidate.classification === "PERSISTENT_STRONG" ||
          candidate.classification === "REVERSE_PERSISTENT_STRONG",
      )
      .sort(baseSort);
    const persistent58Plus = persistent58PlusInternal.map(toPublicCandidate);

    const classifications: Record<
      StableEdgeClassification,
      MarketObservationStableEdgeCandidate[]
    > = {
      PERSISTENT_STRONG: byClassification("PERSISTENT_STRONG"),
      STABLE_EDGE: byClassification("STABLE_EDGE"),
      REVERSE_PERSISTENT_STRONG: byClassification("REVERSE_PERSISTENT_STRONG"),
      REVERSE_STABLE_EDGE: byClassification("REVERSE_STABLE_EDGE"),
      WATCH: byClassification("WATCH"),
      UNSTABLE: byClassification("UNSTABLE"),
      REJECT: byClassification("REJECT"),
    };

    return {
      ok: true,
      stage: "market_observation_stable_edge_discovery",
      generatedAt: new Date().toISOString(),
      dbPath: options.dbPath,
      tableName: TABLE_NAME,
      featureVersion: options.featureVersion,
      totalRecords: rows.length,
      usedRecords: parsedRows.length,
      options,
      foldBoundaries,
      summary: {
        generatedGroups,
        evaluatedCandidates: allCandidates.length,
        deduplicatedCandidates: allAfterDedup.length,
        persistentStrong: allAfterDedup.filter(
          (candidate) => candidate.classification === "PERSISTENT_STRONG",
        ).length,
        stableEdge: allAfterDedup.filter(
          (candidate) => candidate.classification === "STABLE_EDGE",
        ).length,
        reversePersistentStrong: allAfterDedup.filter(
          (candidate) => candidate.classification === "REVERSE_PERSISTENT_STRONG",
        ).length,
        reverseStableEdge: allAfterDedup.filter(
          (candidate) => candidate.classification === "REVERSE_STABLE_EDGE",
        ).length,
        watch: allAfterDedup.filter(
          (candidate) => candidate.classification === "WATCH",
        ).length,
        unstable: allAfterDedup.filter(
          (candidate) => candidate.classification === "UNSTABLE",
        ).length,
        reject: allAfterDedup.filter(
          (candidate) => candidate.classification === "REJECT",
        ).length,
        persistent58Plus: persistent58Plus.length,
        futureLeakageRiskCandidates: allAfterDedup.filter(
          (candidate) => candidate.riskNote !== null,
        ).length,
      },
      persistent58Plus: persistent58Plus.slice(0, options.limitPerRanking),
      classifications,
      rankings: {
        stability: takeRanking(
          rankingPool,
          options.limitPerRanking,
          (left, right) =>
            right.stabilityScore - left.stabilityScore ||
            (right.overallWinRate ?? -1) - (left.overallWinRate ?? -1) ||
            right.decided - left.decided,
        ),
        winRate: takeRanking(
          rankingPool,
          options.limitPerRanking,
          (left, right) =>
            (right.overallWinRate ?? -1) - (left.overallWinRate ?? -1) ||
            (right.wilsonLowerBound ?? -1) - (left.wilsonLowerBound ?? -1) ||
            right.decided - left.decided,
        ),
        profit: takeRanking(
          rankingPool,
          options.limitPerRanking,
          (left, right) =>
            right.totalProfit - left.totalProfit ||
            (right.overallWinRate ?? -1) - (left.overallWinRate ?? -1),
        ),
        frequency: takeRanking(
          rankingPool,
          options.limitPerRanking,
          (left, right) =>
            right.occurrenceRate - left.occurrenceRate ||
            right.decided - left.decided ||
            (right.overallWinRate ?? -1) - (left.overallWinRate ?? -1),
        ),
        forward: takeRanking(
          rankingPool.filter((candidate) => candidate.mode === "FORWARD"),
          options.limitPerRanking,
          baseSort,
        ),
        reverse: takeRanking(
          rankingPool.filter((candidate) => candidate.mode === "REVERSE"),
          options.limitPerRanking,
          baseSort,
        ),
        directionalEdge: takeRanking(
          rankingPool,
          options.limitPerRanking,
          (left, right) =>
            (right.directionalEdgeFrom50 ?? -1) -
              (left.directionalEdgeFrom50 ?? -1) ||
            right.stabilityScore - left.stabilityScore,
        ),
        bothDirections: buildDirectionComparisons(
          rankingPool,
          options.limitPerRanking,
        ),
      },
      dedupPairs: deduplicated.pairs.slice(0, 1000),
      candidates: visible.sort(baseSort),
      message:
        "market_observations全体から単独・2条件・3条件を探索し、FORWARDとREVERSEを実際のHIGH/LOW勝敗・DRAW・Profitで独立集計しました。Backtest1m/3mを含む候補は未来情報混入リスク未確認として自動強候補から除外しています。Trading Engine / Demo Buy / Deriv APIには接続していません。",
    };
  } finally {
    db.close();
  }
}
