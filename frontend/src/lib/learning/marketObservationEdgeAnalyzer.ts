import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type MarketObservationDirection = "HIGH" | "LOW";
export type MarketObservationResult = "WIN" | "LOST" | "DRAW";
export type MarketObservationSelectedDirection = "HIGH" | "LOW" | "NEUTRAL";
export type MarketObservationEdgeClassification =
  | "HIGH_ADOPT"
  | "LOW_ADOPT"
  | "HIGH_WATCH"
  | "LOW_WATCH"
  | "BLOCK"
  | "NEUTRAL";

export type MarketObservationEdgeOptions = {
  minSample?: number;
  watchMinSample?: number;
  adoptMinSample?: number;
  watchEffectiveWinRate?: number;
  adoptEffectiveWinRate?: number;
  neutralEdgeThreshold?: number;
  limit?: number;
  includeNeutral?: boolean;
  includeUnknown?: boolean;
  featureVersion?: string;
};

type MarketObservationRow = {
  id: number;
  pair: string | null;
  deriv_symbol: string | null;
  epoch: number | null;
  exit_epoch: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  exit_close: number | null;
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
  source: string | null;
  created_at: number | null;
  updated_at: number | null;
};

type CountRow = { count: number };
type GroupAccumulator = {
  feature: string;
  value: string;
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
};

export type MarketObservationEdgeItem = {
  feature: string;
  value: string;
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
  directionalEdge: number;
  effectiveWinRate: number;
  selectedDirection: MarketObservationSelectedDirection;
  selectedProfit: number;
  classification: MarketObservationEdgeClassification;
  observationIds: number[];
};

export type MarketObservationEdgeAnalysis = {
  generatedAt: string;
  dbPath: string;
  tableName: "market_observations";
  totalRecords: number;
  usedRecords: number;
  options: Required<MarketObservationEdgeOptions>;
  edges: MarketObservationEdgeItem[];
  highAdopt: MarketObservationEdgeItem[];
  lowAdopt: MarketObservationEdgeItem[];
  highWatch: MarketObservationEdgeItem[];
  lowWatch: MarketObservationEdgeItem[];
  block: MarketObservationEdgeItem[];
  neutral: MarketObservationEdgeItem[];
  message: string;
};

const TABLE_NAME = "market_observations" as const;
const DEFAULT_OPTIONS: Required<MarketObservationEdgeOptions> = {
  minSample: 10,
  watchMinSample: 30,
  adoptMinSample: 80,
  watchEffectiveWinRate: 60,
  adoptEffectiveWinRate: 70,
  neutralEdgeThreshold: 7,
  limit: 100,
  includeNeutral: false,
  includeUnknown: false,
  featureVersion: "phase16-k-market-observation-v1",
};

function resolveOptions(input?: MarketObservationEdgeOptions): Required<MarketObservationEdgeOptions> {
  return {
    minSample: numberOr(input?.minSample, DEFAULT_OPTIONS.minSample),
    watchMinSample: numberOr(input?.watchMinSample, DEFAULT_OPTIONS.watchMinSample),
    adoptMinSample: numberOr(input?.adoptMinSample, DEFAULT_OPTIONS.adoptMinSample),
    watchEffectiveWinRate: numberOr(input?.watchEffectiveWinRate, DEFAULT_OPTIONS.watchEffectiveWinRate),
    adoptEffectiveWinRate: numberOr(input?.adoptEffectiveWinRate, DEFAULT_OPTIONS.adoptEffectiveWinRate),
    neutralEdgeThreshold: numberOr(input?.neutralEdgeThreshold, DEFAULT_OPTIONS.neutralEdgeThreshold),
    limit: numberOr(input?.limit, DEFAULT_OPTIONS.limit),
    includeNeutral: input?.includeNeutral ?? DEFAULT_OPTIONS.includeNeutral,
    includeUnknown: input?.includeUnknown ?? DEFAULT_OPTIONS.includeUnknown,
    featureVersion: input?.featureVersion?.trim() || DEFAULT_OPTIONS.featureVersion,
  };
}

function numberOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function round(value: number, digits = 2): number {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function dbPath(): string {
  const candidates = [
    path.join(process.cwd(), "data", "ai.db"),
    path.join(process.cwd(), "..", "data", "ai.db"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`SQLite database not found. Checked: ${candidates.join(", ")}`);
  return found;
}

function assertTable(db: Database.Database): void {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(TABLE_NAME) as { name?: string } | undefined;
  if (!row?.name) throw new Error("market_observations table not found in SQLite database.");
}

function n(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function t(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function boolLabel(value: number | null, label: string): string {
  if (value === 1) return `${label}:YES`;
  if (value === 0) return `${label}:NO`;
  return `${label}:UNKNOWN`;
}

function scoreBand(label: string, value: number | null): string {
  if (value === null) return `${label}:UNKNOWN`;
  const lower = Math.floor(value / 10) * 10;
  return `${label}:${lower}-${lower + 9}`;
}

function rciBand(label: string, value: number | null): string {
  if (value === null) return `${label}:UNKNOWN`;
  if (value >= 80) return `${label}:OVERBOUGHT(>=80)`;
  if (value >= 50) return `${label}:STRONG_UP(50-79)`;
  if (value <= -80) return `${label}:OVERSOLD(<=-80)`;
  if (value <= -50) return `${label}:STRONG_DOWN(-79--50)`;
  return `${label}:NEUTRAL(-49-49)`;
}

function atrBand(value: number | null): string {
  if (value === null) return "ATR:UNKNOWN";
  if (value < 0.5) return "ATR:LOW(<0.5)";
  if (value < 0.8) return "ATR:MID(0.5-0.79)";
  if (value < 1.1) return "ATR:HIGH(0.8-1.09)";
  return "ATR:EXTREME(>=1.1)";
}

function emaBand(row: MarketObservationRow): string {
  const diff = n(row.ema_diff);
  if (diff === null) return "EMA:UNKNOWN";
  if (Math.abs(diff) < 0.05) return "EMA:FLAT";
  return diff > 0 ? "EMA:UP" : "EMA:DOWN";
}

function normalizeResult(value: string | null): MarketObservationResult | null {
  if (value === "WIN" || value === "WON") return "WIN";
  if (value === "LOST" || value === "LOSE") return "LOST";
  if (value === "DRAW") return "DRAW";
  return null;
}

function featureValues(row: MarketObservationRow): string[] {
  const selectedDirection = t(row.selected_direction)?.toUpperCase() ?? "UNKNOWN";
  const trend = t(row.trend)?.toUpperCase() ?? "UNKNOWN";
  const session = t(row.session)?.toUpperCase() ?? "UNKNOWN";
  const pair = t(row.pair) ?? "UNKNOWN";
  const smc = `SMC:${boolLabel(row.bos, "BOS").replace("BOS:", "BOS=")}+${boolLabel(row.choch, "CHOCH").replace("CHOCH:", "CHOCH=")}+${boolLabel(row.fvg, "FVG").replace("FVG:", "FVG=")}`;

  return [
    `Pair:${pair}`,
    emaBand(row),
    atrBand(n(row.atr)),
    rciBand("RCI9", n(row.rci9)),
    rciBand("RCI26", n(row.rci26)),
    rciBand("RCI52", n(row.rci52)),
    `Trend:${trend}`,
    `Session:${session}`,
    `Hour:${n(row.hour) ?? "UNKNOWN"}`,
    `Weekday:${n(row.weekday) ?? "UNKNOWN"}`,
    boolLabel(row.bos, "BOS"),
    boolLabel(row.choch, "CHOCH"),
    boolLabel(row.fvg, "FVG"),
    smc,
    scoreBand("HighScore", n(row.high_score)),
    scoreBand("LowScore", n(row.low_score)),
    scoreBand("SelectedScore", n(row.selected_score)),
    `SelectedDirection:${selectedDirection}`,
    scoreBand("Backtest1m", n(row.backtest_win_rate_1m)),
    scoreBand("Backtest3m", n(row.backtest_win_rate_3m)),
  ];
}

function addGroup(groups: Map<string, GroupAccumulator>, row: MarketObservationRow, value: string, includeUnknown: boolean): void {
  if (!includeUnknown && value.toUpperCase().includes("UNKNOWN")) return;
  const [feature] = value.split(":", 1);
  const key = `${feature}=${value}`;
  const existing = groups.get(key) ?? {
    feature,
    value,
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
  };

  const highResult = normalizeResult(row.high_result);
  const lowResult = normalizeResult(row.low_result);
  if (!highResult || !lowResult) return;

  existing.sample += 1;
  if (highResult === "WIN") existing.highWins += 1;
  else if (highResult === "LOST") existing.highLosses += 1;
  else existing.highDraws += 1;

  if (lowResult === "WIN") existing.lowWins += 1;
  else if (lowResult === "LOST") existing.lowLosses += 1;
  else existing.lowDraws += 1;

  existing.highProfit += n(row.high_profit) ?? 0;
  existing.lowProfit += n(row.low_profit) ?? 0;
  existing.observationIds.push(row.id);
  groups.set(key, existing);
}

function classify(item: Omit<MarketObservationEdgeItem, "classification">, options: Required<MarketObservationEdgeOptions>): MarketObservationEdgeClassification {
  if (item.selectedDirection === "NEUTRAL" || item.directionalEdge < options.neutralEdgeThreshold) return "NEUTRAL";
  if (item.sample >= options.adoptMinSample && item.effectiveWinRate >= options.adoptEffectiveWinRate && item.selectedProfit > 0) {
    return item.selectedDirection === "HIGH" ? "HIGH_ADOPT" : "LOW_ADOPT";
  }
  if (item.sample >= options.watchMinSample && item.effectiveWinRate >= options.watchEffectiveWinRate && item.selectedProfit > 0) {
    return item.selectedDirection === "HIGH" ? "HIGH_WATCH" : "LOW_WATCH";
  }
  if (item.sample >= options.adoptMinSample && item.effectiveWinRate <= 55) return "BLOCK";
  return "NEUTRAL";
}

function groupToItem(group: GroupAccumulator, options: Required<MarketObservationEdgeOptions>): MarketObservationEdgeItem | null {
  if (group.sample < options.minSample) return null;
  const highDecided = group.highWins + group.highLosses;
  const lowDecided = group.lowWins + group.lowLosses;
  if (highDecided === 0 || lowDecided === 0) return null;

  const highWinRate = round((group.highWins / highDecided) * 100);
  const lowWinRate = round((group.lowWins / lowDecided) * 100);
  const highEdge = Math.abs(highWinRate - 50);
  const lowEdge = Math.abs(lowWinRate - 50);
  const selectedDirection: MarketObservationSelectedDirection =
    Math.max(highEdge, lowEdge) < options.neutralEdgeThreshold
      ? "NEUTRAL"
      : highEdge >= lowEdge
        ? "HIGH"
        : "LOW";
  const effectiveWinRate = selectedDirection === "HIGH" ? highWinRate : selectedDirection === "LOW" ? lowWinRate : Math.max(highWinRate, lowWinRate);
  const selectedProfit = selectedDirection === "HIGH" ? group.highProfit : selectedDirection === "LOW" ? group.lowProfit : Math.max(group.highProfit, group.lowProfit);
  const base = {
    feature: group.feature,
    value: group.value,
    sample: group.sample,
    highWins: group.highWins,
    highLosses: group.highLosses,
    highDraws: group.highDraws,
    highWinRate,
    lowWins: group.lowWins,
    lowLosses: group.lowLosses,
    lowDraws: group.lowDraws,
    lowWinRate,
    highProfit: round(group.highProfit, 4),
    lowProfit: round(group.lowProfit, 4),
    avgHighProfit: round(group.highProfit / highDecided, 4),
    avgLowProfit: round(group.lowProfit / lowDecided, 4),
    directionalEdge: round(Math.max(highEdge, lowEdge)),
    effectiveWinRate,
    selectedDirection,
    selectedProfit: round(selectedProfit, 4),
    observationIds: group.observationIds,
  } satisfies Omit<MarketObservationEdgeItem, "classification">;
  return { ...base, classification: classify(base, options) };
}

function sortEdges(a: MarketObservationEdgeItem, b: MarketObservationEdgeItem): number {
  if (b.directionalEdge !== a.directionalEdge) return b.directionalEdge - a.directionalEdge;
  if (b.effectiveWinRate !== a.effectiveWinRate) return b.effectiveWinRate - a.effectiveWinRate;
  if (b.sample !== a.sample) return b.sample - a.sample;
  return b.selectedProfit - a.selectedProfit;
}

export function analyzeMarketObservationEdges(input?: MarketObservationEdgeOptions): MarketObservationEdgeAnalysis {
  const options = resolveOptions(input);
  const databasePath = dbPath();
  const db = new Database(databasePath, { readonly: true });
  try {
    assertTable(db);
    const totalRecords = (db.prepare(`SELECT COUNT(*) as count FROM ${TABLE_NAME}`).get() as CountRow).count;
    const rows = db
      .prepare(`SELECT * FROM ${TABLE_NAME} WHERE feature_version = ? ORDER BY epoch ASC`)
      .all(options.featureVersion) as MarketObservationRow[];

    const groups = new Map<string, GroupAccumulator>();
    for (const row of rows) {
      for (const value of featureValues(row)) {
        addGroup(groups, row, value, options.includeUnknown);
      }
    }

    const allEdges = [...groups.values()]
      .map((group) => groupToItem(group, options))
      .filter((item): item is MarketObservationEdgeItem => item !== null)
      .filter((item) => options.includeNeutral || item.classification !== "NEUTRAL")
      .sort(sortEdges);

    const limited = allEdges.slice(0, options.limit);
    const byClass = (classification: MarketObservationEdgeClassification) => allEdges.filter((edge) => edge.classification === classification).slice(0, options.limit);

    return {
      generatedAt: new Date().toISOString(),
      dbPath: databasePath,
      tableName: TABLE_NAME,
      totalRecords,
      usedRecords: rows.length,
      options,
      edges: limited,
      highAdopt: byClass("HIGH_ADOPT"),
      lowAdopt: byClass("LOW_ADOPT"),
      highWatch: byClass("HIGH_WATCH"),
      lowWatch: byClass("LOW_WATCH"),
      block: byClass("BLOCK"),
      neutral: byClass("NEUTRAL"),
      message: "Market Observation DatasetからHIGH/LOW両方向のDirectional Edgeを解析しました。Trading Engineには接続していません。",
    };
  } finally {
    db.close();
  }
}
