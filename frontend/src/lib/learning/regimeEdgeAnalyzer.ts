import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type RegimeSelectedDirection = "FORWARD" | "REVERSE" | "NEUTRAL";

export type RegimeClassification =
  | "FORWARD_ADOPT"
  | "REVERSE_ADOPT"
  | "FORWARD_WATCH"
  | "REVERSE_WATCH"
  | "BLOCK"
  | "NEUTRAL";

export type RegimeEdgeOptions = {
  minSample?: number;
  adoptMinSample?: number;
  watchMinSample?: number;
  adoptEffectiveWinRate?: number;
  watchEffectiveWinRate?: number;
  neutralEdgeThreshold?: number;
  limit?: number;
  includeNeutral?: boolean;
  includeUnknown?: boolean;
};

export type RegimeEdgePattern = {
  key: string;
  features: string[];
  values: string[];
  sample: number;
  wins: number;
  losses: number;
  draws: number;
  rawWinRate: number;
  reverseWinRate: number;
  directionalEdge: number;
  rawProfit: number;
  reverseProfit: number;
  avgRawProfit: number;
  avgReverseProfit: number;
  effectiveWinRate: number;
  selectedDirection: RegimeSelectedDirection;
  classification: RegimeClassification;
  tradeIds: number[];
};

export type RegimeEdgeResult = {
  totalTrades: number;
  usedTrades: number;
  dbPath: string;
  tableName: "trade_history";
  generatedAt: string;
  options: Required<RegimeEdgeOptions>;
  patterns: RegimeEdgePattern[];
  forwardAdopt: RegimeEdgePattern[];
  reverseAdopt: RegimeEdgePattern[];
  forwardWatch: RegimeEdgePattern[];
  reverseWatch: RegimeEdgePattern[];
  block: RegimeEdgePattern[];
  neutral: RegimeEdgePattern[];
};

type TradeRow = {
  id: number;
  pair: string | null;
  direction: string | null;
  score: number | null;
  profit: number | null;
  status: string | null;
  ema9: number | null;
  ema21: number | null;
  ema_diff: number | null;
  rci9: number | null;
  rci26: number | null;
  rci52: number | null;
  atr: number | null;
  trend: string | null;
  market_phase: string | null;
  volatility_level: string | null;
  session: string | null;
  bos: number | null;
  choch: number | null;
  fvg: number | null;
  order_block: number | null;
  weight_score: number | null;
  similarity_score: number | null;
  final_score: number | null;
  hour: number | null;
  weekday: number | null;
  feature_snapshot: string | null;
  ai_version: string | null;
};

type Snapshot = Record<string, unknown>;

type NormalizedTrade = {
  id: number;
  won: boolean;
  lost: boolean;
  draw: boolean;
  profit: number;
  features: Map<string, string>;
};

type Aggregate = {
  features: string[];
  values: string[];
  sample: number;
  wins: number;
  losses: number;
  draws: number;
  profit: number;
  tradeIds: number[];
};

const DEFAULT_OPTIONS: Required<RegimeEdgeOptions> = {
  minSample: 5,
  adoptMinSample: 50,
  watchMinSample: 15,
  adoptEffectiveWinRate: 70,
  watchEffectiveWinRate: 65,
  neutralEdgeThreshold: 10,
  limit: 150,
  includeNeutral: false,
  includeUnknown: false,
};

const TABLE_NAME = "trade_history" as const;

function round(value: number, digits = 2): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toText(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return null;
}

function toBoolLike(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1"].includes(normalized)) return true;
    if (["false", "no", "0"].includes(normalized)) return false;
  }
  return null;
}

function parseSnapshot(raw: string | null): Snapshot {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Snapshot;
    }
  } catch {
    return {};
  }
  return {};
}

function pickNumber(row: TradeRow, snapshot: Snapshot, columnKey: keyof TradeRow, snapshotKeys: string[]): number | null {
  const fromColumn = toFiniteNumber(row[columnKey]);
  if (fromColumn !== null) return fromColumn;
  for (const key of snapshotKeys) {
    const fromSnapshot = toFiniteNumber(snapshot[key]);
    if (fromSnapshot !== null) return fromSnapshot;
  }
  return null;
}

function pickText(row: TradeRow, snapshot: Snapshot, columnKey: keyof TradeRow, snapshotKeys: string[]): string | null {
  const fromColumn = toText(row[columnKey]);
  if (fromColumn !== null) return fromColumn;
  for (const key of snapshotKeys) {
    const fromSnapshot = toText(snapshot[key]);
    if (fromSnapshot !== null) return fromSnapshot;
  }
  return null;
}

function pickBool(row: TradeRow, snapshot: Snapshot, columnKey: keyof TradeRow, snapshotKeys: string[]): boolean | null {
  const fromColumn = toBoolLike(row[columnKey]);
  if (fromColumn !== null) return fromColumn;
  for (const key of snapshotKeys) {
    const fromSnapshot = toBoolLike(snapshot[key]);
    if (fromSnapshot !== null) return fromSnapshot;
  }
  return null;
}

function bandScore(label: string, value: number | null): string {
  if (value === null) return `${label}:UNKNOWN`;
  const lower = Math.floor(value / 10) * 10;
  return `${label}:${lower}-${lower + 9}`;
}

function bandAtr(value: number | null, volatilityLevel: string | null): string {
  if (volatilityLevel && volatilityLevel.toUpperCase() !== "UNKNOWN") {
    return `ATR:${volatilityLevel.toUpperCase()}`;
  }
  if (value === null) return "ATR:UNKNOWN";
  if (value < 0.2) return "ATR:LOW(<0.2)";
  if (value < 0.8) return "ATR:NORMAL(0.2-0.8)";
  if (value < 1.5) return "ATR:HIGH(0.8-1.5)";
  return "ATR:EXTREME(>=1.5)";
}

function bandRci(label: string, value: number | null): string {
  if (value === null) return `${label}:UNKNOWN`;
  if (value >= 80) return `${label}:OVERBOUGHT(>=80)`;
  if (value >= 50) return `${label}:STRONG_UP(50-79)`;
  if (value > -50) return `${label}:NEUTRAL(-49-49)`;
  if (value > -80) return `${label}:STRONG_DOWN(-79--50)`;
  return `${label}:OVERSOLD(<=-80)`;
}

function boolFeature(label: string, value: boolean | null): string {
  if (value === null) return `${label}:UNKNOWN`;
  return `${label}:${value ? "YES" : "NO"}`;
}

function deriveEma(emaDiff: number | null, ema9: number | null, ema21: number | null, trend: string | null): string {
  if (trend) {
    const upper = trend.toUpperCase();
    if (["UP", "DOWN", "FLAT", "RANGE"].includes(upper)) return `EMA:${upper}`;
  }
  const diff = emaDiff ?? (ema9 !== null && ema21 !== null ? ema9 - ema21 : null);
  if (diff === null) return "EMA:UNKNOWN";
  if (diff > 0.05) return "EMA:UP";
  if (diff < -0.05) return "EMA:DOWN";
  return "EMA:FLAT";
}

function deriveRegime(marketPhase: string | null, trend: string | null, volatility: string | null, rci9: number | null): string {
  const phase = marketPhase?.toUpperCase();
  if (phase && phase !== "UNKNOWN") return `Regime:${phase}`;

  const trendUpper = trend?.toUpperCase();
  const volatilityUpper = volatility?.toUpperCase();

  if (trendUpper === "UP" || trendUpper === "DOWN") {
    if (volatilityUpper === "HIGH" || volatilityUpper === "EXTREME") return `Regime:TREND_${volatilityUpper}`;
    return "Regime:TREND_NORMAL";
  }

  if (trendUpper === "FLAT" || trendUpper === "RANGE") {
    if (rci9 !== null && Math.abs(rci9) >= 80) return "Regime:MEAN_REVERSION_ZONE";
    return "Regime:RANGE";
  }

  if (rci9 !== null && Math.abs(rci9) >= 80) return "Regime:RCI_EXTREME";
  return "Regime:UNKNOWN";
}

function getDbPath(): string {
  const candidates = [
    path.join(process.cwd(), "data", "ai.db"),
    path.join(process.cwd(), "..", "data", "ai.db"),
    path.join(process.cwd(), "data", "trades.db"),
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error("SQLite database not found. Expected ./data/ai.db.");
  }
  return found;
}

function readTrades(dbPath: string): TradeRow[] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(TABLE_NAME) as { name: string } | undefined;

    if (!table) {
      throw new Error("trade_history table not found in SQLite database.");
    }

    return db
      .prepare(
        `SELECT id, pair, direction, score, profit, status, ema9, ema21, ema_diff, rci9, rci26, rci52,
                atr, trend, market_phase, volatility_level, session, bos, choch, fvg, order_block,
                weight_score, similarity_score, final_score, hour, weekday, feature_snapshot, ai_version
           FROM ${TABLE_NAME}
          ORDER BY id ASC`,
      )
      .all() as TradeRow[];
  } finally {
    db.close();
  }
}

function normalizeTrade(row: TradeRow): NormalizedTrade {
  const snapshot = parseSnapshot(row.feature_snapshot);
  const profit = toFiniteNumber(row.profit) ?? 0;
  const status = row.status?.toUpperCase() ?? "";

  const won = status === "WON" || status === "WIN" || profit > 0;
  const lost = status === "LOST" || status === "LOSE" || profit < 0;
  const draw = !won && !lost;

  const pair = pickText(row, snapshot, "pair", ["pair"]);
  const direction = pickText(row, snapshot, "direction", ["direction"]);
  const score = pickNumber(row, snapshot, "score", ["score", "finalScore", "aiScore"]);
  const confidence = pickNumber(row, snapshot, "weight_score", ["confidence", "confidenceScore", "weightScore"]);
  const similarity = pickNumber(row, snapshot, "similarity_score", ["similarity", "similarityScore"]);
  const finalScore = pickNumber(row, snapshot, "final_score", ["finalScore"]);
  const ema9 = pickNumber(row, snapshot, "ema9", ["ema9"]);
  const ema21 = pickNumber(row, snapshot, "ema21", ["ema21"]);
  const emaDiff = pickNumber(row, snapshot, "ema_diff", ["emaDiff"]);
  const rci9 = pickNumber(row, snapshot, "rci9", ["rci9"]);
  const rci26 = pickNumber(row, snapshot, "rci26", ["rci26"]);
  const rci52 = pickNumber(row, snapshot, "rci52", ["rci52"]);
  const atr = pickNumber(row, snapshot, "atr", ["atr"]);
  const trend = pickText(row, snapshot, "trend", ["trend", "emaTrend"]);
  const marketPhase = pickText(row, snapshot, "market_phase", ["marketPhase"]);
  const volatilityLevel = pickText(row, snapshot, "volatility_level", ["volatilityLevel", "atrLevel"]);
  const session = pickText(row, snapshot, "session", ["session"]);
  const hour = pickNumber(row, snapshot, "hour", ["hour"]);
  const weekday = pickNumber(row, snapshot, "weekday", ["weekday"]);
  const bos = pickBool(row, snapshot, "bos", ["bos"]);
  const choch = pickBool(row, snapshot, "choch", ["choch"]);
  const fvg = pickBool(row, snapshot, "fvg", ["fvg"]);
  const orderBlock = pickBool(row, snapshot, "order_block", ["orderBlock", "order_block"]);

  const ema = deriveEma(emaDiff, ema9, ema21, trend);
  const atrBand = bandAtr(atr, volatilityLevel);
  const rci9Band = bandRci("RCI9", rci9);
  const rci26Band = bandRci("RCI26", rci26);
  const rci52Band = bandRci("RCI52", rci52);
  const regime = deriveRegime(marketPhase, trend, volatilityLevel, rci9);
  const smc = [boolFeature("BOS", bos), boolFeature("CHOCH", choch), boolFeature("FVG", fvg), boolFeature("OrderBlock", orderBlock)]
    .filter((value) => !value.endsWith(":UNKNOWN"))
    .join("+") || "SMC:UNKNOWN";

  const features = new Map<string, string>([
    ["Pair", `Pair:${pair ?? "UNKNOWN"}`],
    ["Direction", `Direction:${direction ?? "UNKNOWN"}`],
    ["Regime", regime],
    ["EMA", ema],
    ["ATR", atrBand],
    ["RCI9", rci9Band],
    ["RCI26", rci26Band],
    ["RCI52", rci52Band],
    ["SMC", smc],
    ["BOS", boolFeature("BOS", bos)],
    ["CHOCH", boolFeature("CHOCH", choch)],
    ["FVG", boolFeature("FVG", fvg)],
    ["OrderBlock", boolFeature("OrderBlock", orderBlock)],
    ["Session", `Session:${session ?? "UNKNOWN"}`],
    ["Hour", hour === null ? "Hour:UNKNOWN" : `Hour:${Math.trunc(hour)}`],
    ["Weekday", weekday === null ? "Weekday:UNKNOWN" : `Weekday:${Math.trunc(weekday)}`],
    ["ScoreBand", bandScore("Score", score)],
    ["ConfidenceBand", bandScore("Confidence", confidence)],
    ["SimilarityBand", bandScore("Similarity", similarity)],
    ["FinalScoreBand", bandScore("FinalScore", finalScore)],
  ]);

  return { id: row.id, won, lost, draw, profit, features };
}

const REGIME_COMBINATIONS: string[][] = [
  ["Regime", "Direction"],
  ["Regime", "EMA"],
  ["Regime", "ATR"],
  ["Regime", "RCI9"],
  ["Regime", "SMC"],
  ["Regime", "Session"],
  ["Regime", "Hour"],
  ["Regime", "Pair"],
  ["Direction", "EMA"],
  ["Direction", "ATR"],
  ["Direction", "RCI9"],
  ["Direction", "SMC"],
  ["Direction", "Session"],
  ["Direction", "Hour"],
  ["Direction", "Pair"],
  ["EMA", "ATR"],
  ["EMA", "RCI9"],
  ["EMA", "SMC"],
  ["EMA", "Session"],
  ["EMA", "Hour"],
  ["ATR", "RCI9"],
  ["ATR", "SMC"],
  ["ATR", "Session"],
  ["ATR", "Hour"],
  ["RCI9", "SMC"],
  ["RCI9", "Session"],
  ["RCI9", "Hour"],
  ["SMC", "Session"],
  ["SMC", "Hour"],
  ["Session", "Hour"],
  ["SimilarityBand", "Regime"],
  ["SimilarityBand", "Direction"],
  ["SimilarityBand", "EMA"],
  ["SimilarityBand", "ATR"],
  ["SimilarityBand", "RCI9"],
  ["SimilarityBand", "SMC"],
  ["SimilarityBand", "Session"],
  ["SimilarityBand", "Hour"],
  ["ConfidenceBand", "Regime"],
  ["ConfidenceBand", "Direction"],
  ["ConfidenceBand", "EMA"],
  ["ConfidenceBand", "ATR"],
  ["ConfidenceBand", "RCI9"],
  ["ConfidenceBand", "SMC"],
  ["ConfidenceBand", "Session"],
  ["ConfidenceBand", "Hour"],
  ["ScoreBand", "Regime"],
  ["ScoreBand", "Direction"],
  ["ScoreBand", "EMA"],
  ["ScoreBand", "ATR"],
  ["ScoreBand", "RCI9"],
  ["ScoreBand", "Session"],
  ["ScoreBand", "Hour"],
  ["SimilarityBand", "Regime", "Direction"],
  ["SimilarityBand", "EMA", "Direction"],
  ["SimilarityBand", "ATR", "Direction"],
  ["SimilarityBand", "RCI9", "Direction"],
  ["ConfidenceBand", "Regime", "Direction"],
  ["ConfidenceBand", "EMA", "Direction"],
  ["Regime", "EMA", "Direction"],
  ["Regime", "ATR", "Direction"],
  ["Regime", "RCI9", "Direction"],
  ["Session", "Hour", "Direction"],
  ["Pair", "Hour", "Direction"],
];

function classify(input: {
  sample: number;
  rawWinRate: number;
  reverseWinRate: number;
  directionalEdge: number;
  rawProfit: number;
  reverseProfit: number;
  options: Required<RegimeEdgeOptions>;
}): { selectedDirection: RegimeSelectedDirection; classification: RegimeClassification; effectiveWinRate: number } {
  const { sample, rawWinRate, reverseWinRate, directionalEdge, rawProfit, reverseProfit, options } = input;
  const selectedDirection: RegimeSelectedDirection =
    directionalEdge < options.neutralEdgeThreshold ? "NEUTRAL" : rawWinRate >= reverseWinRate ? "FORWARD" : "REVERSE";
  const effectiveWinRate = Math.max(rawWinRate, reverseWinRate);

  if (selectedDirection === "NEUTRAL") {
    return { selectedDirection, classification: "NEUTRAL", effectiveWinRate };
  }

  if (
    selectedDirection === "FORWARD" &&
    sample >= options.adoptMinSample &&
    rawWinRate >= options.adoptEffectiveWinRate &&
    rawProfit > 0
  ) {
    return { selectedDirection, classification: "FORWARD_ADOPT", effectiveWinRate };
  }

  if (
    selectedDirection === "REVERSE" &&
    sample >= options.adoptMinSample &&
    reverseWinRate >= options.adoptEffectiveWinRate &&
    reverseProfit > 0
  ) {
    return { selectedDirection, classification: "REVERSE_ADOPT", effectiveWinRate };
  }

  if (selectedDirection === "FORWARD" && sample >= options.watchMinSample && rawWinRate >= options.watchEffectiveWinRate) {
    return { selectedDirection, classification: "FORWARD_WATCH", effectiveWinRate };
  }

  if (selectedDirection === "REVERSE" && sample >= options.watchMinSample && reverseWinRate >= options.watchEffectiveWinRate) {
    return { selectedDirection, classification: "REVERSE_WATCH", effectiveWinRate };
  }

  if (sample >= options.adoptMinSample && effectiveWinRate <= 55) {
    return { selectedDirection, classification: "BLOCK", effectiveWinRate };
  }

  return { selectedDirection, classification: "NEUTRAL", effectiveWinRate };
}

function toPattern(aggregate: Aggregate, options: Required<RegimeEdgeOptions>): RegimeEdgePattern | null {
  if (aggregate.sample < options.minSample) return null;

  const rawWinRate = aggregate.sample === 0 ? 0 : round((aggregate.wins / aggregate.sample) * 100);
  const reverseWinRate = round(100 - rawWinRate);
  const directionalEdge = round(Math.abs(rawWinRate - 50));
  const rawProfit = round(aggregate.profit);
  const reverseProfit = round(-aggregate.profit);
  const avgRawProfit = aggregate.sample === 0 ? 0 : round(rawProfit / aggregate.sample, 4);
  const avgReverseProfit = aggregate.sample === 0 ? 0 : round(reverseProfit / aggregate.sample, 4);
  const classified = classify({
    sample: aggregate.sample,
    rawWinRate,
    reverseWinRate,
    directionalEdge,
    rawProfit,
    reverseProfit,
    options,
  });

  if (!options.includeNeutral && classified.classification === "NEUTRAL") return null;

  return {
    key: aggregate.values.join(" × "),
    features: aggregate.features,
    values: aggregate.values,
    sample: aggregate.sample,
    wins: aggregate.wins,
    losses: aggregate.losses,
    draws: aggregate.draws,
    rawWinRate,
    reverseWinRate,
    directionalEdge,
    rawProfit,
    reverseProfit,
    avgRawProfit,
    avgReverseProfit,
    effectiveWinRate: round(classified.effectiveWinRate),
    selectedDirection: classified.selectedDirection,
    classification: classified.classification,
    tradeIds: aggregate.tradeIds,
  };
}

function shouldSkipValues(values: string[], includeUnknown: boolean): boolean {
  if (includeUnknown) return false;
  return values.some((value) => value.toUpperCase().includes("UNKNOWN"));
}

function buildAggregates(trades: NormalizedTrade[], options: Required<RegimeEdgeOptions>): RegimeEdgePattern[] {
  const aggregates = new Map<string, Aggregate>();

  for (const trade of trades) {
    for (const features of REGIME_COMBINATIONS) {
      const values: string[] = [];
      let missing = false;

      for (const feature of features) {
        const value = trade.features.get(feature);
        if (!value) {
          missing = true;
          break;
        }
        values.push(value);
      }

      if (missing || shouldSkipValues(values, options.includeUnknown)) continue;

      const key = `${features.join("+")}::${values.join("|")}`;
      const current = aggregates.get(key) ?? {
        features,
        values,
        sample: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        profit: 0,
        tradeIds: [],
      };

      current.sample += 1;
      if (trade.won) current.wins += 1;
      else if (trade.lost) current.losses += 1;
      else current.draws += 1;
      current.profit += trade.profit;
      current.tradeIds.push(trade.id);
      aggregates.set(key, current);
    }
  }

  return Array.from(aggregates.values())
    .map((aggregate) => toPattern(aggregate, options))
    .filter((pattern): pattern is RegimeEdgePattern => pattern !== null)
    .sort((a, b) => {
      const classRank: Record<RegimeClassification, number> = {
        REVERSE_ADOPT: 6,
        FORWARD_ADOPT: 6,
        REVERSE_WATCH: 5,
        FORWARD_WATCH: 5,
        BLOCK: 4,
        NEUTRAL: 1,
      };
      return (
        classRank[b.classification] - classRank[a.classification] ||
        b.directionalEdge - a.directionalEdge ||
        b.effectiveWinRate - a.effectiveWinRate ||
        b.sample - a.sample ||
        Math.abs(b.reverseProfit) - Math.abs(a.reverseProfit)
      );
    })
    .slice(0, options.limit);
}

export function analyzeRegimeEdges(input: RegimeEdgeOptions = {}): RegimeEdgeResult {
  const options: Required<RegimeEdgeOptions> = { ...DEFAULT_OPTIONS, ...input };
  const dbPath = getDbPath();
  const rows = readTrades(dbPath);
  const trades = rows.map(normalizeTrade);
  const patterns = buildAggregates(trades, options);

  return {
    totalTrades: rows.length,
    usedTrades: trades.length,
    dbPath,
    tableName: TABLE_NAME,
    generatedAt: new Date().toISOString(),
    options,
    patterns,
    forwardAdopt: patterns.filter((pattern) => pattern.classification === "FORWARD_ADOPT"),
    reverseAdopt: patterns.filter((pattern) => pattern.classification === "REVERSE_ADOPT"),
    forwardWatch: patterns.filter((pattern) => pattern.classification === "FORWARD_WATCH"),
    reverseWatch: patterns.filter((pattern) => pattern.classification === "REVERSE_WATCH"),
    block: patterns.filter((pattern) => pattern.classification === "BLOCK"),
    neutral: patterns.filter((pattern) => pattern.classification === "NEUTRAL"),
  };
}
