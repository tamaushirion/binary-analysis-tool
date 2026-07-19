import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type ObservationTradeResult = "WIN" | "LOST" | "DRAW" | "UNKNOWN";
export type ObservationSelectedDirection = "HIGH" | "LOW" | "NEUTRAL";
export type ObservationCombinationClassification =
  | "EDGE_STRONG"
  | "FREQUENCY_STRONG"
  | "BALANCED_STRONG"
  | "WATCH"
  | "REJECT"
  | "NEUTRAL";

export type MarketObservationCombinationEdgeOptions = {
  minSample?: number;
  watchMinSample?: number;
  strongMinSample?: number;
  highFrequencyMinSample?: number;
  maxCombinationSize?: 2 | 3;
  watchEffectiveWinRate?: number;
  strongEffectiveWinRate?: number;
  frequencyEffectiveWinRate?: number;
  neutralEdgeThreshold?: number;
  maxTrainTestGap?: number;
  minWilsonLowerBound?: number;
  limit?: number;
  includeNeutral?: boolean;
  includeReject?: boolean;
  includeUnknown?: boolean;
  featureVersion?: string;
};

type ObservationRow = {
  id: number;
  pair: string | null;
  deriv_symbol: string | null;
  epoch: number | null;
  exit_epoch: number | null;
  high_result: string | null;
  low_result: string | null;
  high_profit: number | null;
  low_profit: number | null;
  high_score: number | null;
  low_score: number | null;
  selected_score: number | null;
  selected_direction: string | null;
  ema9: number | null;
  ema21: number | null;
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
  feature_version: string | null;
  ai_version: string | null;
  feature_snapshot: string | null;
};

type ParsedObservation = ObservationRow & {
  highStatus: ObservationTradeResult;
  lowStatus: ObservationTradeResult;
  parsedHighProfit: number;
  parsedLowProfit: number;
  featureValues: string[];
};

type GroupAccumulator = {
  key: string;
  features: string[];
  values: string[];
  sample: number;
  highWins: number;
  highLosses: number;
  highDraws: number;
  lowWins: number;
  lowLosses: number;
  lowDraws: number;
  highProfit: number;
  lowProfit: number;
  observationIds: number[];
  epochs: number[];
};

export type MarketObservationCombinationEdge = {
  key: string;
  features: string[];
  values: string[];
  sample: number;
  highWins: number;
  highLosses: number;
  highDraws: number;
  highWinRate: number;
  lowWins: number;
  lowLosses: number;
  lowDraws: number;
  lowWinRate: number;
  highProfit: number;
  lowProfit: number;
  avgHighProfit: number;
  avgLowProfit: number;
  selectedDirection: ObservationSelectedDirection;
  selectedWinRate: number;
  selectedProfit: number;
  selectedAvgProfit: number;
  directionalEdge: number;
  effectiveWinRate: number;
  wilsonLowerBound: number;
  trainWinRate: number | null;
  testWinRate: number | null;
  trainTestGap: number | null;
  recentWinRate: number | null;
  pastWinRate: number | null;
  recentPastGap: number | null;
  dependencyRatio: number;
  uniqueHourCount: number;
  uniqueDayCount: number;
  classification: ObservationCombinationClassification;
  observationIds: number[];
};

export type MarketObservationCombinationEdgeResult = {
  generatedAt: string;
  dbPath: string;
  tableName: "market_observations";
  totalRecords: number;
  usedRecords: number;
  options: Required<MarketObservationCombinationEdgeOptions>;
  edges: MarketObservationCombinationEdge[];
  edgeStrong: MarketObservationCombinationEdge[];
  frequencyStrong: MarketObservationCombinationEdge[];
  balancedStrong: MarketObservationCombinationEdge[];
  watch: MarketObservationCombinationEdge[];
  reject: MarketObservationCombinationEdge[];
  neutral: MarketObservationCombinationEdge[];
  message: string;
};

const TABLE_NAME = "market_observations" as const;

const DEFAULT_OPTIONS: Required<MarketObservationCombinationEdgeOptions> = {
  minSample: 20,
  watchMinSample: 30,
  strongMinSample: 80,
  highFrequencyMinSample: 180,
  maxCombinationSize: 3,
  watchEffectiveWinRate: 58,
  strongEffectiveWinRate: 68,
  frequencyEffectiveWinRate: 58,
  neutralEdgeThreshold: 6,
  maxTrainTestGap: 14,
  minWilsonLowerBound: 50,
  limit: 100,
  includeNeutral: false,
  includeReject: false,
  includeUnknown: false,
  featureVersion: "phase16-k-market-observation-v1",
};

function sanitizeNumber(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value;
}

function resolveOptions(input?: MarketObservationCombinationEdgeOptions): Required<MarketObservationCombinationEdgeOptions> {
  return {
    minSample: sanitizeNumber(input?.minSample, DEFAULT_OPTIONS.minSample),
    watchMinSample: sanitizeNumber(input?.watchMinSample, DEFAULT_OPTIONS.watchMinSample),
    strongMinSample: sanitizeNumber(input?.strongMinSample, DEFAULT_OPTIONS.strongMinSample),
    highFrequencyMinSample: sanitizeNumber(input?.highFrequencyMinSample, DEFAULT_OPTIONS.highFrequencyMinSample),
    maxCombinationSize: input?.maxCombinationSize === 2 ? 2 : DEFAULT_OPTIONS.maxCombinationSize,
    watchEffectiveWinRate: sanitizeNumber(input?.watchEffectiveWinRate, DEFAULT_OPTIONS.watchEffectiveWinRate),
    strongEffectiveWinRate: sanitizeNumber(input?.strongEffectiveWinRate, DEFAULT_OPTIONS.strongEffectiveWinRate),
    frequencyEffectiveWinRate: sanitizeNumber(input?.frequencyEffectiveWinRate, DEFAULT_OPTIONS.frequencyEffectiveWinRate),
    neutralEdgeThreshold: sanitizeNumber(input?.neutralEdgeThreshold, DEFAULT_OPTIONS.neutralEdgeThreshold),
    maxTrainTestGap: sanitizeNumber(input?.maxTrainTestGap, DEFAULT_OPTIONS.maxTrainTestGap),
    minWilsonLowerBound: sanitizeNumber(input?.minWilsonLowerBound, DEFAULT_OPTIONS.minWilsonLowerBound),
    limit: sanitizeNumber(input?.limit, DEFAULT_OPTIONS.limit),
    includeNeutral: input?.includeNeutral ?? DEFAULT_OPTIONS.includeNeutral,
    includeReject: input?.includeReject ?? DEFAULT_OPTIONS.includeReject,
    includeUnknown: input?.includeUnknown ?? DEFAULT_OPTIONS.includeUnknown,
    featureVersion: input?.featureVersion ?? DEFAULT_OPTIONS.featureVersion,
  };
}

function resolveDbPath(): string {
  const candidates = [
    path.join(process.cwd(), "data", "ai.db"),
    path.join(process.cwd(), "..", "data", "ai.db"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`SQLite database not found. Checked: ${candidates.join(", ")}`);
  return found;
}

function round(value: number, digits = 2): number {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function normalizeResult(value: string | null): ObservationTradeResult {
  if (value === "WIN") return "WIN";
  if (value === "LOST") return "LOST";
  if (value === "DRAW") return "DRAW";
  return "UNKNOWN";
}

function text(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function number(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolLabel(name: string, value: number | null | undefined): string {
  if (value === null || value === undefined) return `${name}:UNKNOWN`;
  return `${name}:${value ? "YES" : "NO"}`;
}

function band(prefix: string, value: number | null | undefined, width = 10): string {
  const numeric = number(value);
  if (numeric === null) return `${prefix}:UNKNOWN`;
  const lower = Math.floor(numeric / width) * width;
  return `${prefix}:${lower}-${lower + width - 1}`;
}

function signedBand(prefix: string, value: number | null | undefined): string {
  const numeric = number(value);
  if (numeric === null) return `${prefix}:UNKNOWN`;
  if (numeric <= -80) return `${prefix}:OVERSOLD(<=-80)`;
  if (numeric <= -50) return `${prefix}:STRONG_DOWN(-79--50)`;
  if (numeric < 50) return `${prefix}:NEUTRAL(-49-49)`;
  if (numeric < 80) return `${prefix}:STRONG_UP(50-79)`;
  return `${prefix}:OVERBOUGHT(>=80)`;
}

function emaLabel(row: ObservationRow): string {
  const diff = number(row.ema_diff);
  if (diff === null) return "EMA:UNKNOWN";
  if (Math.abs(diff) < 0.05) return "EMA:FLAT";
  return diff > 0 ? "EMA:UP" : "EMA:DOWN";
}

function atrLabel(row: ObservationRow): string {
  const atr = number(row.atr);
  if (atr === null) return "ATR:UNKNOWN";
  if (atr < 0.4) return "ATR:LOW(<0.4)";
  if (atr < 0.8) return "ATR:NORMAL(0.4-0.79)";
  if (atr < 1.2) return "ATR:HIGH(0.8-1.19)";
  return "ATR:EXTREME(>=1.2)";
}

function selectedDirectionLabel(row: ObservationRow): string {
  return row.selected_direction === "LOW" ? "SelectedDirection:LOW" : row.selected_direction === "HIGH" ? "SelectedDirection:HIGH" : "SelectedDirection:UNKNOWN";
}

function smcLabel(row: ObservationRow): string {
  const bos = row.bos ? "BOS:YES" : "BOS:NO";
  const choch = row.choch ? "CHOCH:YES" : "CHOCH:NO";
  const fvg = row.fvg ? "FVG:YES" : "FVG:NO";
  return `SMC:${bos}+${choch}+${fvg}`;
}

function featureValues(row: ObservationRow, includeUnknown: boolean): string[] {
  const values = [
    emaLabel(row),
    atrLabel(row),
    signedBand("RCI9", row.rci9),
    signedBand("RCI26", row.rci26),
    signedBand("RCI52", row.rci52),
    `Trend:${text(row.trend)?.toUpperCase() ?? "UNKNOWN"}`,
    `Session:${text(row.session)?.toUpperCase() ?? "UNKNOWN"}`,
    band("Hour", row.hour, 1).replace(/-(\d+)$/, ""),
    band("Weekday", row.weekday, 1).replace(/-(\d+)$/, ""),
    band("HighScore", row.high_score),
    band("LowScore", row.low_score),
    band("SelectedScore", row.selected_score),
    selectedDirectionLabel(row),
    boolLabel("BOS", row.bos),
    boolLabel("CHOCH", row.choch),
    boolLabel("FVG", row.fvg),
    smcLabel(row),
    band("SMCScore", row.smc_score, 10),
    band("Backtest1m", row.backtest_win_rate_1m, 5),
    band("Backtest3m", row.backtest_win_rate_3m, 5),
  ];

  if (includeUnknown) return values;
  return values.filter((value) => !value.includes("UNKNOWN"));
}

function parseRows(rows: ObservationRow[], includeUnknown: boolean): ParsedObservation[] {
  return rows.map((row) => ({
    ...row,
    highStatus: normalizeResult(row.high_result),
    lowStatus: normalizeResult(row.low_result),
    parsedHighProfit: number(row.high_profit) ?? 0,
    parsedLowProfit: number(row.low_profit) ?? 0,
    featureValues: featureValues(row, includeUnknown),
  }));
}

function combinations(values: string[], size: number): string[][] {
  const out: string[][] = [];
  const walk = (start: number, current: string[]) => {
    if (current.length === size) {
      out.push([...current]);
      return;
    }
    for (let i = start; i < values.length; i += 1) {
      current.push(values[i]);
      walk(i + 1, current);
      current.pop();
    }
  };
  walk(0, []);
  return out;
}

function featureName(value: string): string {
  const idx = value.indexOf(":");
  return idx >= 0 ? value.slice(0, idx) : value;
}

function canCombine(values: string[]): boolean {
  const names = values.map(featureName);
  return new Set(names).size === names.length;
}

function addToGroup(group: GroupAccumulator, row: ParsedObservation): void {
  group.sample += 1;
  if (row.highStatus === "WIN") group.highWins += 1;
  if (row.highStatus === "LOST") group.highLosses += 1;
  if (row.highStatus === "DRAW") group.highDraws += 1;
  if (row.lowStatus === "WIN") group.lowWins += 1;
  if (row.lowStatus === "LOST") group.lowLosses += 1;
  if (row.lowStatus === "DRAW") group.lowDraws += 1;
  group.highProfit += row.parsedHighProfit;
  group.lowProfit += row.parsedLowProfit;
  group.observationIds.push(row.id);
  if (typeof row.epoch === "number") group.epochs.push(row.epoch);
}

function wilsonLowerBound(wins: number, total: number, z = 1.96): number {
  if (total <= 0) return 0;
  const p = wins / total;
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return round(((centre - margin) / denom) * 100, 2);
}

function winRate(wins: number, losses: number): number {
  const total = wins + losses;
  return total > 0 ? round((wins / total) * 100, 2) : 0;
}

function selectedStats(group: GroupAccumulator): {
  selectedDirection: ObservationSelectedDirection;
  selectedWinRate: number;
  selectedProfit: number;
  selectedAvgProfit: number;
  effectiveWinRate: number;
  directionalEdge: number;
  wilsonLowerBound: number;
} {
  const highRate = winRate(group.highWins, group.highLosses);
  const lowRate = winRate(group.lowWins, group.lowLosses);
  const highEdge = Math.abs(highRate - 50);
  const lowEdge = Math.abs(lowRate - 50);
  const selectedDirection: ObservationSelectedDirection = highEdge >= lowEdge ? "HIGH" : "LOW";
  const selectedWinRate = selectedDirection === "HIGH" ? highRate : lowRate;
  const selectedProfit = selectedDirection === "HIGH" ? group.highProfit : group.lowProfit;
  const selectedSettled = selectedDirection === "HIGH" ? group.highWins + group.highLosses : group.lowWins + group.lowLosses;
  const selectedWins = selectedDirection === "HIGH" ? group.highWins : group.lowWins;
  const directionalEdge = Math.abs(selectedWinRate - 50);
  return {
    selectedDirection: directionalEdge === 0 ? "NEUTRAL" : selectedDirection,
    selectedWinRate,
    selectedProfit: round(selectedProfit, 4),
    selectedAvgProfit: selectedSettled > 0 ? round(selectedProfit / selectedSettled, 4) : 0,
    effectiveWinRate: selectedWinRate,
    directionalEdge: round(directionalEdge, 2),
    wilsonLowerBound: wilsonLowerBound(selectedWins, selectedSettled),
  };
}

function rateForRows(rows: ParsedObservation[], direction: ObservationSelectedDirection): number | null {
  if (direction === "NEUTRAL" || rows.length === 0) return null;
  let wins = 0;
  let losses = 0;
  for (const row of rows) {
    const status = direction === "HIGH" ? row.highStatus : row.lowStatus;
    if (status === "WIN") wins += 1;
    if (status === "LOST") losses += 1;
  }
  if (wins + losses === 0) return null;
  return round((wins / (wins + losses)) * 100, 2);
}

function buildTemporalStats(group: GroupAccumulator, byId: Map<number, ParsedObservation>, direction: ObservationSelectedDirection) {
  const rows = group.observationIds.map((id) => byId.get(id)).filter((row): row is ParsedObservation => Boolean(row)).sort((a, b) => (a.epoch ?? 0) - (b.epoch ?? 0));
  const mid = Math.floor(rows.length / 2);
  const train = rows.slice(0, mid);
  const test = rows.slice(mid);
  const trainWinRate = rateForRows(train, direction);
  const testWinRate = rateForRows(test, direction);
  const recentCount = Math.max(10, Math.floor(rows.length * 0.35));
  const past = rows.slice(0, Math.max(0, rows.length - recentCount));
  const recent = rows.slice(Math.max(0, rows.length - recentCount));
  const pastWinRate = rateForRows(past, direction);
  const recentWinRate = rateForRows(recent, direction);
  const trainTestGap = trainWinRate === null || testWinRate === null ? null : round(Math.abs(trainWinRate - testWinRate), 2);
  const recentPastGap = recentWinRate === null || pastWinRate === null ? null : round(Math.abs(recentWinRate - pastWinRate), 2);
  const uniqueHours = new Set(rows.map((row) => Math.floor((row.epoch ?? 0) / 3600))).size;
  const uniqueDays = new Set(rows.map((row) => Math.floor((row.epoch ?? 0) / 86400))).size;
  const dependencyRatio = rows.length > 0 ? round(uniqueHours / rows.length, 4) : 0;
  return {
    trainWinRate,
    testWinRate,
    trainTestGap,
    recentWinRate,
    pastWinRate,
    recentPastGap,
    dependencyRatio,
    uniqueHourCount: uniqueHours,
    uniqueDayCount: uniqueDays,
  };
}

function classify(edge: Omit<MarketObservationCombinationEdge, "classification">, options: Required<MarketObservationCombinationEdgeOptions>): ObservationCombinationClassification {
  if (edge.directionalEdge < options.neutralEdgeThreshold) return "NEUTRAL";
  if (edge.selectedProfit <= 0) return "REJECT";
  if (edge.testWinRate !== null && edge.testWinRate < 50) return "REJECT";
  if (edge.trainTestGap !== null && edge.trainTestGap > options.maxTrainTestGap && edge.sample < options.highFrequencyMinSample) return "REJECT";

  if (
    edge.sample >= options.strongMinSample &&
    edge.effectiveWinRate >= options.strongEffectiveWinRate &&
    edge.wilsonLowerBound >= options.minWilsonLowerBound
  ) {
    return "EDGE_STRONG";
  }

  if (
    edge.sample >= options.highFrequencyMinSample &&
    edge.effectiveWinRate >= options.frequencyEffectiveWinRate &&
    edge.wilsonLowerBound >= options.minWilsonLowerBound
  ) {
    return "FREQUENCY_STRONG";
  }

  if (
    edge.sample >= options.strongMinSample &&
    edge.effectiveWinRate >= options.watchEffectiveWinRate + 4 &&
    edge.wilsonLowerBound >= options.minWilsonLowerBound - 3
  ) {
    return "BALANCED_STRONG";
  }

  if (edge.sample >= options.watchMinSample && edge.effectiveWinRate >= options.watchEffectiveWinRate) return "WATCH";
  return "REJECT";
}

function groupToEdge(group: GroupAccumulator, byId: Map<number, ParsedObservation>, options: Required<MarketObservationCombinationEdgeOptions>): MarketObservationCombinationEdge {
  const highRate = winRate(group.highWins, group.highLosses);
  const lowRate = winRate(group.lowWins, group.lowLosses);
  const selected = selectedStats(group);
  const temporal = buildTemporalStats(group, byId, selected.selectedDirection);
  const base = {
    key: group.key,
    features: group.features,
    values: group.values,
    sample: group.sample,
    highWins: group.highWins,
    highLosses: group.highLosses,
    highDraws: group.highDraws,
    highWinRate: highRate,
    lowWins: group.lowWins,
    lowLosses: group.lowLosses,
    lowDraws: group.lowDraws,
    lowWinRate: lowRate,
    highProfit: round(group.highProfit, 4),
    lowProfit: round(group.lowProfit, 4),
    avgHighProfit: group.highWins + group.highLosses > 0 ? round(group.highProfit / (group.highWins + group.highLosses), 4) : 0,
    avgLowProfit: group.lowWins + group.lowLosses > 0 ? round(group.lowProfit / (group.lowWins + group.lowLosses), 4) : 0,
    ...selected,
    ...temporal,
    observationIds: group.observationIds,
  } satisfies Omit<MarketObservationCombinationEdge, "classification">;
  return { ...base, classification: classify(base, options) };
}

function sortEdges(a: MarketObservationCombinationEdge, b: MarketObservationCombinationEdge): number {
  const classScore = (edge: MarketObservationCombinationEdge) => {
    if (edge.classification === "EDGE_STRONG") return 5;
    if (edge.classification === "FREQUENCY_STRONG") return 4;
    if (edge.classification === "BALANCED_STRONG") return 3;
    if (edge.classification === "WATCH") return 2;
    if (edge.classification === "NEUTRAL") return 1;
    return 0;
  };
  if (classScore(b) !== classScore(a)) return classScore(b) - classScore(a);
  if (b.directionalEdge !== a.directionalEdge) return b.directionalEdge - a.directionalEdge;
  if (b.wilsonLowerBound !== a.wilsonLowerBound) return b.wilsonLowerBound - a.wilsonLowerBound;
  if (b.sample !== a.sample) return b.sample - a.sample;
  return b.selectedProfit - a.selectedProfit;
}

function assertTable(db: Database.Database): void {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(TABLE_NAME) as { name?: string } | undefined;
  if (!row?.name) throw new Error("market_observations table not found in SQLite database.");
}

function loadRows(db: Database.Database, featureVersion: string): ObservationRow[] {
  return db.prepare(`
    SELECT * FROM ${TABLE_NAME}
    WHERE feature_version = ?
      AND high_result IN ('WIN', 'LOST', 'DRAW')
      AND low_result IN ('WIN', 'LOST', 'DRAW')
    ORDER BY epoch ASC, id ASC
  `).all(featureVersion) as ObservationRow[];
}

export function analyzeMarketObservationCombinationEdges(input?: MarketObservationCombinationEdgeOptions): MarketObservationCombinationEdgeResult {
  const options = resolveOptions(input);
  const dbPath = resolveDbPath();
  const db = new Database(dbPath, { readonly: true });

  try {
    assertTable(db);
    const rows = loadRows(db, options.featureVersion);
    const parsed = parseRows(rows, options.includeUnknown);
    const byId = new Map(parsed.map((row) => [row.id, row]));
    const groups = new Map<string, GroupAccumulator>();

    for (const row of parsed) {
      const maxSize = options.maxCombinationSize;
      for (let size = 2; size <= maxSize; size += 1) {
        for (const combo of combinations(row.featureValues, size)) {
          if (!canCombine(combo)) continue;
          const sorted = [...combo].sort();
          const key = sorted.join(" × ");
          const existing = groups.get(key);
          const group = existing ?? {
            key,
            features: sorted.map(featureName),
            values: sorted,
            sample: 0,
            highWins: 0,
            highLosses: 0,
            highDraws: 0,
            lowWins: 0,
            lowLosses: 0,
            lowDraws: 0,
            highProfit: 0,
            lowProfit: 0,
            observationIds: [],
            epochs: [],
          };
          addToGroup(group, row);
          if (!existing) groups.set(key, group);
        }
      }
    }

    const edges = [...groups.values()]
      .filter((group) => group.sample >= options.minSample)
      .map((group) => groupToEdge(group, byId, options))
      .filter((edge) => {
        if (edge.classification === "NEUTRAL" && !options.includeNeutral) return false;
        if (edge.classification === "REJECT" && !options.includeReject) return false;
        return true;
      })
      .sort(sortEdges)
      .slice(0, options.limit);

    const byClass = (classification: ObservationCombinationClassification) => edges.filter((edge) => edge.classification === classification);

    return {
      generatedAt: new Date().toISOString(),
      dbPath,
      tableName: TABLE_NAME,
      totalRecords: rows.length,
      usedRecords: parsed.length,
      options,
      edges,
      edgeStrong: byClass("EDGE_STRONG"),
      frequencyStrong: byClass("FREQUENCY_STRONG"),
      balancedStrong: byClass("BALANCED_STRONG"),
      watch: byClass("WATCH"),
      reject: byClass("REJECT"),
      neutral: byClass("NEUTRAL"),
      message: "Market Observation Datasetから2条件/3条件のDirectional Edgeを解析しました。過学習防止のため時間分割・Wilson下限・連続依存の簡易評価を含みます。Trading Engineには接続していません。",
    };
  } finally {
    db.close();
  }
}
