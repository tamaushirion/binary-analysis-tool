import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type RobustDirection = "HIGH" | "LOW";
export type RobustResult = "WIN" | "LOST" | "DRAW";
export type RobustClassification = "ROBUST_STRONG" | "ROBUST_WATCH" | "UNSTABLE" | "REJECT";

export type MarketObservationRobustCandidateOptions = {
  dbPath?: string;
  featureVersion?: string;
  minTotalSample?: number;
  minFoldSample?: number;
  minFoldWinRate?: number;
  minOverallWinRate?: number;
  minWilsonLowerBound?: number;
  maxFoldGap?: number;
  maxCombinationSize?: 2 | 3;
  recentRatio?: number;
  limit?: number;
  includeWatch?: boolean;
  includeRejected?: boolean;
};

type ObservationRow = {
  id: number;
  epoch: number;
  high_result: string;
  low_result: string;
  high_profit: number;
  low_profit: number;
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
  highStatus: RobustResult;
  lowStatus: RobustResult;
  features: string[];
};

type Accumulator = {
  key: string;
  values: string[];
  direction: RobustDirection;
  observationIds: number[];
};

export type RobustFoldStats = {
  name: "TRAIN" | "VALIDATION_A" | "VALIDATION_B" | "RECENT";
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

export type MarketObservationRobustCandidate = {
  key: string;
  conditionLabel: string;
  values: string[];
  direction: RobustDirection;
  totalSample: number;
  decided: number;
  wins: number;
  losses: number;
  draws: number;
  overallWinRate: number | null;
  totalProfit: number;
  avgProfit: number | null;
  wilsonLowerBound: number | null;
  directionalEdgeFrom50: number | null;
  folds: RobustFoldStats[];
  minFoldWinRate: number | null;
  maxFoldWinRate: number | null;
  foldWinRateGap: number | null;
  profitableFoldCount: number;
  qualifyingFoldCount: number;
  recentWinRate: number | null;
  recentProfit: number;
  occurrenceRate: number;
  classification: RobustClassification;
  reasons: string[];
};

export type MarketObservationRobustCandidateResult = {
  ok: true;
  stage: "market_observation_robust_candidate_discovery";
  generatedAt: string;
  dbPath: string;
  tableName: "market_observations";
  featureVersion: string;
  totalRecords: number;
  usedRecords: number;
  foldBoundaries: {
    trainEndIndex: number;
    validationAEndIndex: number;
    validationBEndIndex: number;
    recentStartIndex: number;
  };
  options: Required<Omit<MarketObservationRobustCandidateOptions, "dbPath">> & { dbPath: string };
  candidates: MarketObservationRobustCandidate[];
  robustStrong: MarketObservationRobustCandidate[];
  robustWatch: MarketObservationRobustCandidate[];
  unstable: MarketObservationRobustCandidate[];
  reject: MarketObservationRobustCandidate[];
  summary: {
    totalEvaluated: number;
    robustStrong: number;
    robustWatch: number;
    unstable: number;
    reject: number;
    commonSixtyPercentCandidates: number;
  };
  message: string;
};

const TABLE_NAME = "market_observations" as const;
const DEFAULT_FEATURE_VERSION = "phase16-k-market-observation-v1";

const DEFAULT_OPTIONS: Required<Omit<MarketObservationRobustCandidateOptions, "dbPath">> = {
  featureVersion: DEFAULT_FEATURE_VERSION,
  minTotalSample: 120,
  minFoldSample: 20,
  minFoldWinRate: 60,
  minOverallWinRate: 60,
  minWilsonLowerBound: 54,
  maxFoldGap: 15,
  maxCombinationSize: 3,
  recentRatio: 0.3,
  limit: 100,
  includeWatch: true,
  includeRejected: false,
};

function resolveDbPath(input?: string): string {
  if (input) return path.resolve(input);
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

function round(value: number, digits = 2): number {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function normalizeResult(value: string): RobustResult {
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
  if (numeric === null) return null;
  return `${prefix}:${numeric !== 0 ? "YES" : "NO"}`;
}

function featureValues(row: ObservationRow): string[] {
  const values: Array<string | null> = [
    emaLabel(row.ema_diff),
    atrLabel(row.atr),
    signedBand("RCI9", row.rci9),
    signedBand("RCI26", row.rci26),
    signedBand("RCI52", row.rci52),
    safeText(row.trend) ? `Trend:${safeText(row.trend)}` : null,
    safeText(row.session) ? `Session:${safeText(row.session)}` : null,
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
  const names = values.map(featureName);
  return new Set(names).size === names.length;
}

function winRate(wins: number, losses: number): number | null {
  const decided = wins + losses;
  return decided > 0 ? round((wins / decided) * 100, 2) : null;
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
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(TABLE_NAME) as { name?: string } | undefined;
  if (!row?.name) throw new Error("market_observations table not found in SQLite database.");
}

function statsForRows(rows: ParsedObservation[], direction: RobustDirection, name: RobustFoldStats["name"]): RobustFoldStats {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let profit = 0;
  for (const row of rows) {
    const status = direction === "HIGH" ? row.highStatus : row.lowStatus;
    profit += direction === "HIGH" ? row.high_profit : row.low_profit;
    if (status === "WIN") wins += 1;
    else if (status === "LOST") losses += 1;
    else draws += 1;
  }
  const decided = wins + losses;
  return {
    name,
    sample: rows.length,
    decided,
    wins,
    losses,
    draws,
    winRate: winRate(wins, losses),
    profit: round(profit, 4),
    avgProfit: decided > 0 ? round(profit / decided, 4) : null,
    wilsonLowerBound: wilsonLowerBound(wins, decided),
  };
}

function resolveFoldIndexes(length: number, recentRatio: number): {
  trainEndIndex: number;
  validationAEndIndex: number;
  validationBEndIndex: number;
  recentStartIndex: number;
} {
  const recentSize = Math.max(1, Math.floor(length * recentRatio));
  const recentStartIndex = Math.max(0, length - recentSize);
  const historicalSize = recentStartIndex;
  const trainEndIndex = Math.floor(historicalSize * (3 / 7));
  const validationAEndIndex = trainEndIndex + Math.floor(historicalSize * (2 / 7));
  const validationBEndIndex = historicalSize;
  return { trainEndIndex, validationAEndIndex, validationBEndIndex, recentStartIndex };
}

function classify(
  candidate: Omit<MarketObservationRobustCandidate, "classification" | "reasons">,
  options: Required<Omit<MarketObservationRobustCandidateOptions, "dbPath">>,
): { classification: RobustClassification; reasons: string[] } {
  const reasons: string[] = [];
  const allFoldsEnough = candidate.folds.every((fold) => fold.decided >= options.minFoldSample);
  const allFoldsSixty = candidate.folds.every((fold) => fold.winRate !== null && fold.winRate >= options.minFoldWinRate);
  const allFoldsProfitable = candidate.folds.every((fold) => fold.profit > 0);
  const overallOkay = candidate.overallWinRate !== null && candidate.overallWinRate >= options.minOverallWinRate;
  const wilsonOkay = (candidate.wilsonLowerBound ?? 0) >= options.minWilsonLowerBound;
  const stable = candidate.foldWinRateGap !== null && candidate.foldWinRateGap <= options.maxFoldGap;

  if (!allFoldsEnough) reasons.push("区間ごとの最低決着件数を満たしていません。");
  if (!allFoldsSixty) reasons.push(`全期間で勝率${options.minFoldWinRate}%以上を維持していません。`);
  if (!allFoldsProfitable) reasons.push("損益がマイナスの期間があります。");
  if (!overallOkay) reasons.push(`全体勝率が${options.minOverallWinRate}%未満です。`);
  if (!wilsonOkay) reasons.push("Wilson下限が基準未満です。");
  if (!stable) reasons.push("期間ごとの勝率差が大きすぎます。");

  if (allFoldsEnough && allFoldsSixty && allFoldsProfitable && overallOkay && wilsonOkay && stable) {
    return {
      classification: "ROBUST_STRONG",
      reasons: ["過去・中間・直近の全区間で勝率とProfitが再現しています。"],
    };
  }

  const watchFoldCount = candidate.folds.filter(
    (fold) => fold.decided >= options.minFoldSample && (fold.winRate ?? 0) >= 57 && fold.profit > 0,
  ).length;
  if (
    candidate.totalSample >= options.minTotalSample &&
    candidate.overallWinRate !== null && candidate.overallWinRate >= 58 &&
    candidate.totalProfit > 0 &&
    watchFoldCount >= 3 &&
    (candidate.foldWinRateGap ?? Number.POSITIVE_INFINITY) <= options.maxFoldGap + 5
  ) {
    return { classification: "ROBUST_WATCH", reasons: reasons.length > 0 ? reasons : ["強候補の一歩手前です。"] };
  }

  if (candidate.overallWinRate !== null && candidate.overallWinRate >= options.minOverallWinRate && candidate.totalProfit > 0) {
    return { classification: "UNSTABLE", reasons };
  }
  return { classification: "REJECT", reasons };
}

function buildCandidate(
  accumulator: Accumulator,
  byId: Map<number, ParsedObservation>,
  allRecordCount: number,
  indexes: ReturnType<typeof resolveFoldIndexes>,
  options: Required<Omit<MarketObservationRobustCandidateOptions, "dbPath">>,
): MarketObservationRobustCandidate {
  const rows = accumulator.observationIds
    .map((id) => byId.get(id))
    .filter((row): row is ParsedObservation => Boolean(row));

  const trainRows = rows.filter((row) => byIdIndex(row.id, byId) < indexes.trainEndIndex);
  const validationARows = rows.filter((row) => {
    const index = byIdIndex(row.id, byId);
    return index >= indexes.trainEndIndex && index < indexes.validationAEndIndex;
  });
  const validationBRows = rows.filter((row) => {
    const index = byIdIndex(row.id, byId);
    return index >= indexes.validationAEndIndex && index < indexes.validationBEndIndex;
  });
  const recentRows = rows.filter((row) => byIdIndex(row.id, byId) >= indexes.recentStartIndex);

  const folds = [
    statsForRows(trainRows, accumulator.direction, "TRAIN"),
    statsForRows(validationARows, accumulator.direction, "VALIDATION_A"),
    statsForRows(validationBRows, accumulator.direction, "VALIDATION_B"),
    statsForRows(recentRows, accumulator.direction, "RECENT"),
  ];
  const overall = statsForRows(rows, accumulator.direction, "TRAIN");
  const rates = folds.map((fold) => fold.winRate).filter((value): value is number => value !== null);
  const minRate = rates.length === folds.length ? Math.min(...rates) : null;
  const maxRate = rates.length === folds.length ? Math.max(...rates) : null;
  const base: Omit<MarketObservationRobustCandidate, "classification" | "reasons"> = {
    key: accumulator.key,
    conditionLabel: `${accumulator.values.join(" × ")} × ${accumulator.direction}`,
    values: accumulator.values,
    direction: accumulator.direction,
    totalSample: rows.length,
    decided: overall.decided,
    wins: overall.wins,
    losses: overall.losses,
    draws: overall.draws,
    overallWinRate: overall.winRate,
    totalProfit: overall.profit,
    avgProfit: overall.avgProfit,
    wilsonLowerBound: overall.wilsonLowerBound,
    directionalEdgeFrom50: overall.winRate === null ? null : round(Math.abs(overall.winRate - 50), 2),
    folds,
    minFoldWinRate: minRate,
    maxFoldWinRate: maxRate,
    foldWinRateGap: minRate === null || maxRate === null ? null : round(maxRate - minRate, 2),
    profitableFoldCount: folds.filter((fold) => fold.profit > 0).length,
    qualifyingFoldCount: folds.filter(
      (fold) => fold.decided >= options.minFoldSample && (fold.winRate ?? 0) >= options.minFoldWinRate && fold.profit > 0,
    ).length,
    recentWinRate: folds[3].winRate,
    recentProfit: folds[3].profit,
    occurrenceRate: allRecordCount > 0 ? round((rows.length / allRecordCount) * 100, 2) : 0,
  };
  const assessment = classify(base, options);
  return { ...base, ...assessment };
}

const observationIndexCache = new Map<number, number>();
function byIdIndex(id: number, byId: Map<number, ParsedObservation>): number {
  const cached = observationIndexCache.get(id);
  if (cached !== undefined) return cached;
  let index = 0;
  for (const key of byId.keys()) {
    if (key === id) {
      observationIndexCache.set(id, index);
      return index;
    }
    index += 1;
  }
  return -1;
}

function sortCandidates(a: MarketObservationRobustCandidate, b: MarketObservationRobustCandidate): number {
  const rank = (value: RobustClassification): number => {
    if (value === "ROBUST_STRONG") return 4;
    if (value === "ROBUST_WATCH") return 3;
    if (value === "UNSTABLE") return 2;
    return 1;
  };
  if (rank(b.classification) !== rank(a.classification)) return rank(b.classification) - rank(a.classification);
  if (b.qualifyingFoldCount !== a.qualifyingFoldCount) return b.qualifyingFoldCount - a.qualifyingFoldCount;
  if ((b.minFoldWinRate ?? 0) !== (a.minFoldWinRate ?? 0)) return (b.minFoldWinRate ?? 0) - (a.minFoldWinRate ?? 0);
  if ((b.wilsonLowerBound ?? 0) !== (a.wilsonLowerBound ?? 0)) return (b.wilsonLowerBound ?? 0) - (a.wilsonLowerBound ?? 0);
  if (b.totalSample !== a.totalSample) return b.totalSample - a.totalSample;
  return b.totalProfit - a.totalProfit;
}

function resolveOptions(input?: MarketObservationRobustCandidateOptions) {
  const recentRatio = typeof input?.recentRatio === "number" && Number.isFinite(input.recentRatio)
    ? Math.min(0.45, Math.max(0.2, input.recentRatio))
    : DEFAULT_OPTIONS.recentRatio;
  return {
    dbPath: resolveDbPath(input?.dbPath),
    featureVersion: input?.featureVersion?.trim() || DEFAULT_OPTIONS.featureVersion,
    minTotalSample: typeof input?.minTotalSample === "number" && Number.isFinite(input.minTotalSample) ? Math.max(20, input.minTotalSample) : DEFAULT_OPTIONS.minTotalSample,
    minFoldSample: typeof input?.minFoldSample === "number" && Number.isFinite(input.minFoldSample) ? Math.max(5, input.minFoldSample) : DEFAULT_OPTIONS.minFoldSample,
    minFoldWinRate: typeof input?.minFoldWinRate === "number" && Number.isFinite(input.minFoldWinRate) ? input.minFoldWinRate : DEFAULT_OPTIONS.minFoldWinRate,
    minOverallWinRate: typeof input?.minOverallWinRate === "number" && Number.isFinite(input.minOverallWinRate) ? input.minOverallWinRate : DEFAULT_OPTIONS.minOverallWinRate,
    minWilsonLowerBound: typeof input?.minWilsonLowerBound === "number" && Number.isFinite(input.minWilsonLowerBound) ? input.minWilsonLowerBound : DEFAULT_OPTIONS.minWilsonLowerBound,
    maxFoldGap: typeof input?.maxFoldGap === "number" && Number.isFinite(input.maxFoldGap) ? input.maxFoldGap : DEFAULT_OPTIONS.maxFoldGap,
    maxCombinationSize: input?.maxCombinationSize === 2 ? 2 : DEFAULT_OPTIONS.maxCombinationSize,
    recentRatio,
    limit: typeof input?.limit === "number" && Number.isFinite(input.limit) ? Math.max(1, Math.floor(input.limit)) : DEFAULT_OPTIONS.limit,
    includeWatch: input?.includeWatch ?? DEFAULT_OPTIONS.includeWatch,
    includeRejected: input?.includeRejected ?? DEFAULT_OPTIONS.includeRejected,
  };
}

export function discoverMarketObservationRobustCandidates(
  input?: MarketObservationRobustCandidateOptions,
): MarketObservationRobustCandidateResult {
  const options = resolveOptions(input);
  const db = new Database(options.dbPath, { readonly: true });
  try {
    assertTable(db);
    const rows = loadRows(db, options.featureVersion);
    observationIndexCache.clear();
    const parsed: ParsedObservation[] = rows.map((row) => ({
      ...row,
      highStatus: normalizeResult(row.high_result),
      lowStatus: normalizeResult(row.low_result),
      features: featureValues(row),
    }));
    const byId = new Map(parsed.map((row) => [row.id, row]));
    parsed.forEach((row, index) => observationIndexCache.set(row.id, index));
    const indexes = resolveFoldIndexes(parsed.length, options.recentRatio);
    const groups = new Map<string, Accumulator>();

    for (const row of parsed) {
      for (let size = 2; size <= options.maxCombinationSize; size += 1) {
        for (const combination of combinations(row.features, size)) {
          if (!canCombine(combination)) continue;
          const values = [...combination].sort();
          for (const direction of ["HIGH", "LOW"] as const) {
            const key = `${values.join(" × ")} × Direction:${direction}`;
            const existing = groups.get(key);
            if (existing) existing.observationIds.push(row.id);
            else groups.set(key, { key, values, direction, observationIds: [row.id] });
          }
        }
      }
    }

    const allCandidates = [...groups.values()]
      .filter((group) => group.observationIds.length >= options.minTotalSample)
      .map((group) => buildCandidate(group, byId, parsed.length, indexes, options))
      .sort(sortCandidates);

    const visible = allCandidates.filter((candidate) => {
      if (candidate.classification === "ROBUST_WATCH" && !options.includeWatch) return false;
      if ((candidate.classification === "UNSTABLE" || candidate.classification === "REJECT") && !options.includeRejected) return false;
      return true;
    }).slice(0, options.limit);

    const byClass = (classification: RobustClassification) => visible.filter((candidate) => candidate.classification === classification);
    const commonSixtyPercentCandidates = allCandidates.filter(
      (candidate) => candidate.folds.every((fold) => fold.decided >= options.minFoldSample && (fold.winRate ?? 0) >= 60),
    ).length;

    return {
      ok: true,
      stage: "market_observation_robust_candidate_discovery",
      generatedAt: new Date().toISOString(),
      dbPath: options.dbPath,
      tableName: TABLE_NAME,
      featureVersion: options.featureVersion,
      totalRecords: rows.length,
      usedRecords: parsed.length,
      foldBoundaries: indexes,
      options,
      candidates: visible,
      robustStrong: byClass("ROBUST_STRONG"),
      robustWatch: byClass("ROBUST_WATCH"),
      unstable: byClass("UNSTABLE"),
      reject: byClass("REJECT"),
      summary: {
        totalEvaluated: allCandidates.length,
        robustStrong: allCandidates.filter((candidate) => candidate.classification === "ROBUST_STRONG").length,
        robustWatch: allCandidates.filter((candidate) => candidate.classification === "ROBUST_WATCH").length,
        unstable: allCandidates.filter((candidate) => candidate.classification === "UNSTABLE").length,
        reject: allCandidates.filter((candidate) => candidate.classification === "REJECT").length,
        commonSixtyPercentCandidates,
      },
      message: "Market Observation Datasetを時系列4区間に分割し、過去・中間・直近で共通して再現する候補だけを評価しました。実BuyおよびTrading Engine接続は行っていません。",
    };
  } finally {
    db.close();
  }
}
