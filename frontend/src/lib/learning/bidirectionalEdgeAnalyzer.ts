import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

export type BidirectionalSelectedDirection = "FORWARD" | "REVERSE" | "NEUTRAL";

export type BidirectionalClassification =
  | "FORWARD_ADOPT"
  | "REVERSE_ADOPT"
  | "FORWARD_WATCH"
  | "REVERSE_WATCH"
  | "BLOCK"
  | "NEUTRAL";

export type BidirectionalEdgeOptions = {
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

type TradeStatus = "WON" | "LOST" | "DRAW" | "UNKNOWN";

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

type FeatureSnapshot = Record<string, unknown>;

type ParsedTrade = TradeRow & {
  parsedStatus: TradeStatus;
  parsedProfit: number;
  snapshot: FeatureSnapshot;
};

type GroupAccumulator = {
  feature: string;
  value: string;
  sample: number;
  wins: number;
  losses: number;
  draws: number;
  rawProfit: number;
  tradeIds: number[];
};

export type BidirectionalEdgeItem = {
  feature: string;
  value: string;
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
  selectedDirection: BidirectionalSelectedDirection;
  classification: BidirectionalClassification;
  tradeIds: number[];
};

export type BidirectionalEdgeResult = {
  totalTrades: number;
  usedTrades: number;
  dbPath: string;
  tableName: "trade_history";
  generatedAt: string;
  options: Required<BidirectionalEdgeOptions>;
  edges: BidirectionalEdgeItem[];
  forwardAdopt: BidirectionalEdgeItem[];
  reverseAdopt: BidirectionalEdgeItem[];
  forwardWatch: BidirectionalEdgeItem[];
  reverseWatch: BidirectionalEdgeItem[];
  block: BidirectionalEdgeItem[];
  neutral: BidirectionalEdgeItem[];
};

const TABLE_NAME = "trade_history" as const;

const DEFAULT_OPTIONS: Required<BidirectionalEdgeOptions> = {
  minSample: 5,
  adoptMinSample: 50,
  watchMinSample: 15,
  adoptEffectiveWinRate: 70,
  watchEffectiveWinRate: 65,
  neutralEdgeThreshold: 10,
  limit: 100,
  includeNeutral: false,
  includeUnknown: false,
};

function resolveOptions(input?: BidirectionalEdgeOptions): Required<BidirectionalEdgeOptions> {
  return {
    minSample: sanitizeNumber(input?.minSample, DEFAULT_OPTIONS.minSample),
    adoptMinSample: sanitizeNumber(input?.adoptMinSample, DEFAULT_OPTIONS.adoptMinSample),
    watchMinSample: sanitizeNumber(input?.watchMinSample, DEFAULT_OPTIONS.watchMinSample),
    adoptEffectiveWinRate: sanitizeNumber(input?.adoptEffectiveWinRate, DEFAULT_OPTIONS.adoptEffectiveWinRate),
    watchEffectiveWinRate: sanitizeNumber(input?.watchEffectiveWinRate, DEFAULT_OPTIONS.watchEffectiveWinRate),
    neutralEdgeThreshold: sanitizeNumber(input?.neutralEdgeThreshold, DEFAULT_OPTIONS.neutralEdgeThreshold),
    limit: sanitizeNumber(input?.limit, DEFAULT_OPTIONS.limit),
    includeNeutral: input?.includeNeutral ?? DEFAULT_OPTIONS.includeNeutral,
    includeUnknown: input?.includeUnknown ?? DEFAULT_OPTIONS.includeUnknown,
  };
}

function sanitizeNumber(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value;
}

function resolveDbPath(): string {
  const candidates = [
    path.join(process.cwd(), "data", "ai.db"),
    path.join(process.cwd(), "..", "data", "ai.db"),
    path.join(process.cwd(), "data", "trades.db"),
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`SQLite database not found. Checked: ${candidates.join(", ")}`);
  }

  return found;
}

function assertTradeHistoryExists(db: Database.Database): void {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(TABLE_NAME) as { name?: string } | undefined;

  if (!row?.name) {
    throw new Error("trade_history table not found in SQLite database.");
  }
}

function parseSnapshot(value: string | null): FeatureSnapshot {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as FeatureSnapshot;
    }
    return {};
  } catch {
    return {};
  }
}

function getString(snapshot: FeatureSnapshot, key: string): string | null {
  const value = snapshot[key];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return null;
}

function getNumber(snapshot: FeatureSnapshot, key: string): number | null {
  const value = snapshot[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getBoolean(snapshot: FeatureSnapshot, key: string): boolean | null {
  const value = snapshot[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1"].includes(normalized)) return true;
    if (["false", "no", "0"].includes(normalized)) return false;
  }
  return null;
}

function parseStatus(row: TradeRow): TradeStatus {
  const normalizedStatus = (row.status ?? "").trim().toUpperCase();
  if (["WON", "WIN", "PROFIT"].includes(normalizedStatus)) return "WON";
  if (["LOST", "LOSE", "LOSS"].includes(normalizedStatus)) return "LOST";
  if (["DRAW", "TIE", "EVEN"].includes(normalizedStatus)) return "DRAW";

  const profit = toFiniteNumber(row.profit);
  if (profit > 0) return "WON";
  if (profit < 0) return "LOST";
  if (profit === 0) return "DRAW";

  return "UNKNOWN";
}

function toFiniteNumber(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeText(value: string | null | undefined, fallback = "UNKNOWN"): string {
  if (!value) return fallback;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function bandNumber(value: number | null, label: string, width: number, unknown = `${label}:UNKNOWN`): string {
  if (value === null || !Number.isFinite(value)) return unknown;
  const start = Math.floor(value / width) * width;
  const end = start + width - 1;
  return `${label}:${start}-${end}`;
}

function rciBand(value: number | null, label: string): string {
  if (value === null || !Number.isFinite(value)) return `${label}:UNKNOWN`;
  if (value >= 80) return `${label}:OVERBOUGHT(>=80)`;
  if (value >= 50) return `${label}:STRONG_UP(50-79)`;
  if (value <= -80) return `${label}:OVERSOLD(<=-80)`;
  if (value <= -50) return `${label}:STRONG_DOWN(-79--50)`;
  return `${label}:NEUTRAL(-49-49)`;
}

function emaState(trade: ParsedTrade): string {
  const snapshotTrend = getString(trade.snapshot, "emaTrend");
  if (snapshotTrend) return `EMA:${snapshotTrend.toUpperCase()}`;

  const diff = toFiniteNumber(trade.ema_diff);
  if (diff > 0.03) return "EMA:UP";
  if (diff < -0.03) return "EMA:DOWN";
  if (trade.ema9 !== null && trade.ema21 !== null) return "EMA:FLAT";
  return "EMA:UNKNOWN";
}

function atrState(trade: ParsedTrade): string {
  const snapshotLevel = getString(trade.snapshot, "atrLevel") ?? getString(trade.snapshot, "volatilityLevel");
  if (snapshotLevel) return `ATR:${snapshotLevel.toUpperCase()}`;

  const atr = trade.atr ?? getNumber(trade.snapshot, "atr");
  if (atr === null || !Number.isFinite(atr)) return "ATR:UNKNOWN";
  if (atr < 0.2) return "ATR:LOW(<0.2)";
  if (atr < 0.8) return "ATR:NORMAL(0.2-0.79)";
  return "ATR:HIGH(>=0.8)";
}

function boolState(label: string, dbValue: number | null, snapshot: FeatureSnapshot, snapshotKey: string): string {
  const snapshotValue = getBoolean(snapshot, snapshotKey);
  if (snapshotValue !== null) return `${label}:${snapshotValue ? "YES" : "NO"}`;
  if (dbValue === null) return `${label}:UNKNOWN`;
  return `${label}:${dbValue ? "YES" : "NO"}`;
}

function featureValuesForTrade(trade: ParsedTrade): string[] {
  const score = trade.final_score ?? trade.score ?? getNumber(trade.snapshot, "finalScore") ?? getNumber(trade.snapshot, "score");
  const confidence = trade.weight_score ?? getNumber(trade.snapshot, "confidence") ?? getNumber(trade.snapshot, "weightScore");
  const similarity = trade.similarity_score ?? getNumber(trade.snapshot, "similarityScore");
  const marketPhase = normalizeText(trade.market_phase ?? getString(trade.snapshot, "marketPhase"));
  const trend = normalizeText(trade.trend ?? getString(trade.snapshot, "trend") ?? getString(trade.snapshot, "emaTrend"));
  const volatility = normalizeText(trade.volatility_level ?? getString(trade.snapshot, "volatilityLevel") ?? getString(trade.snapshot, "atrLevel"));

  return [
    emaState(trade),
    atrState(trade),
    rciBand(trade.rci9 ?? getNumber(trade.snapshot, "rci9"), "RCI9"),
    rciBand(trade.rci26 ?? getNumber(trade.snapshot, "rci26"), "RCI26"),
    rciBand(trade.rci52 ?? getNumber(trade.snapshot, "rci52"), "RCI52"),
    boolState("BOS", trade.bos, trade.snapshot, "bos"),
    boolState("CHOCH", trade.choch, trade.snapshot, "choch"),
    boolState("FVG", trade.fvg, trade.snapshot, "fvg"),
    boolState("OrderBlock", trade.order_block, trade.snapshot, "orderBlock"),
    `Session:${normalizeText(trade.session ?? getString(trade.snapshot, "session"))}`,
    `Hour:${trade.hour ?? getNumber(trade.snapshot, "hour") ?? "UNKNOWN"}`,
    `Weekday:${trade.weekday ?? getNumber(trade.snapshot, "weekday") ?? "UNKNOWN"}`,
    `Direction:${normalizeText(trade.direction ?? getString(trade.snapshot, "direction"))}`,
    bandNumber(score, "Score", 10),
    bandNumber(confidence, "Confidence", 10),
    bandNumber(similarity, "Similarity", 10),
    `Trend:${trend}`,
    `MarketPhase:${marketPhase}`,
    `Volatility:${volatility}`,
    `Pair:${normalizeText(trade.pair ?? getString(trade.snapshot, "pair"))}`,
  ];
}

function featureName(value: string): string {
  const separatorIndex = value.indexOf(":");
  return separatorIndex === -1 ? value : value.slice(0, separatorIndex);
}

function addToGroup(groups: Map<string, GroupAccumulator>, value: string, trade: ParsedTrade): void {
  const key = value;
  const existing = groups.get(key);
  const group = existing ?? {
    feature: featureName(value),
    value,
    sample: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    rawProfit: 0,
    tradeIds: [],
  };

  group.sample += 1;
  group.rawProfit += trade.parsedProfit;
  group.tradeIds.push(trade.id);

  if (trade.parsedStatus === "WON") group.wins += 1;
  else if (trade.parsedStatus === "LOST") group.losses += 1;
  else if (trade.parsedStatus === "DRAW") group.draws += 1;

  groups.set(key, group);
}

function classify(item: Omit<BidirectionalEdgeItem, "classification">, options: Required<BidirectionalEdgeOptions>): BidirectionalClassification {
  if (item.selectedDirection === "NEUTRAL" || item.directionalEdge < options.neutralEdgeThreshold) return "NEUTRAL";

  if (
    item.selectedDirection === "FORWARD" &&
    item.sample >= options.adoptMinSample &&
    item.rawWinRate >= options.adoptEffectiveWinRate &&
    item.rawProfit > 0
  ) {
    return "FORWARD_ADOPT";
  }

  if (
    item.selectedDirection === "REVERSE" &&
    item.sample >= options.adoptMinSample &&
    item.reverseWinRate >= options.adoptEffectiveWinRate &&
    item.reverseProfit > 0
  ) {
    return "REVERSE_ADOPT";
  }

  if (item.selectedDirection === "FORWARD" && item.sample >= options.watchMinSample && item.rawWinRate >= options.watchEffectiveWinRate) {
    return "FORWARD_WATCH";
  }

  if (item.selectedDirection === "REVERSE" && item.sample >= options.watchMinSample && item.reverseWinRate >= options.watchEffectiveWinRate) {
    return "REVERSE_WATCH";
  }

  if (item.sample >= options.adoptMinSample && item.effectiveWinRate <= 55) return "BLOCK";

  return "NEUTRAL";
}

function groupToItem(group: GroupAccumulator, options: Required<BidirectionalEdgeOptions>): BidirectionalEdgeItem {
  const resolvedSample = group.wins + group.losses;
  const rawWinRate = resolvedSample > 0 ? (group.wins / resolvedSample) * 100 : 0;
  const reverseWinRate = resolvedSample > 0 ? 100 - rawWinRate : 0;
  const directionalEdge = Math.abs(rawWinRate - 50);
  const reverseProfit = -group.rawProfit;
  const selectedDirection: BidirectionalSelectedDirection =
    directionalEdge < options.neutralEdgeThreshold ? "NEUTRAL" : rawWinRate >= 50 ? "FORWARD" : "REVERSE";

  const baseItem = {
    feature: group.feature,
    value: group.value,
    sample: group.sample,
    wins: group.wins,
    losses: group.losses,
    draws: group.draws,
    rawWinRate: round(rawWinRate),
    reverseWinRate: round(reverseWinRate),
    directionalEdge: round(directionalEdge),
    rawProfit: round(group.rawProfit, 4),
    reverseProfit: round(reverseProfit, 4),
    avgRawProfit: group.sample > 0 ? round(group.rawProfit / group.sample, 4) : 0,
    avgReverseProfit: group.sample > 0 ? round(reverseProfit / group.sample, 4) : 0,
    effectiveWinRate: round(Math.max(rawWinRate, reverseWinRate)),
    selectedDirection,
    tradeIds: group.tradeIds.slice(-30),
  } satisfies Omit<BidirectionalEdgeItem, "classification">;

  return {
    ...baseItem,
    classification: classify(baseItem, options),
  };
}

function sortEdges(a: BidirectionalEdgeItem, b: BidirectionalEdgeItem): number {
  if (b.directionalEdge !== a.directionalEdge) return b.directionalEdge - a.directionalEdge;
  if (b.effectiveWinRate !== a.effectiveWinRate) return b.effectiveWinRate - a.effectiveWinRate;
  if (b.sample !== a.sample) return b.sample - a.sample;
  return b.reverseProfit + b.rawProfit - (a.reverseProfit + a.rawProfit);
}

function readTrades(db: Database.Database): ParsedTrade[] {
  const rows = db
    .prepare(
      `SELECT
        id,
        pair,
        direction,
        score,
        profit,
        status,
        ema9,
        ema21,
        ema_diff,
        rci9,
        rci26,
        rci52,
        atr,
        trend,
        market_phase,
        volatility_level,
        session,
        bos,
        choch,
        fvg,
        order_block,
        weight_score,
        similarity_score,
        final_score,
        hour,
        weekday,
        feature_snapshot,
        ai_version
      FROM ${TABLE_NAME}
      ORDER BY id ASC`,
    )
    .all() as TradeRow[];

  return rows.map((row) => ({
    ...row,
    parsedStatus: parseStatus(row),
    parsedProfit: toFiniteNumber(row.profit),
    snapshot: parseSnapshot(row.feature_snapshot),
  }));
}

export function analyzeBidirectionalEdges(input?: BidirectionalEdgeOptions): BidirectionalEdgeResult {
  const options = resolveOptions(input);
  const dbPath = resolveDbPath();
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  try {
    assertTradeHistoryExists(db);
    const trades = readTrades(db);
    const usableTrades = trades.filter((trade) => trade.parsedStatus === "WON" || trade.parsedStatus === "LOST" || trade.parsedStatus === "DRAW");
    const groups = new Map<string, GroupAccumulator>();

    for (const trade of usableTrades) {
      const values = featureValuesForTrade(trade);
      for (const value of values) {
        if (!options.includeUnknown && value.toUpperCase().includes("UNKNOWN")) continue;
        addToGroup(groups, value, trade);
      }
    }

    const edges = Array.from(groups.values())
      .filter((group) => group.sample >= options.minSample)
      .map((group) => groupToItem(group, options))
      .filter((item) => options.includeNeutral || item.classification !== "NEUTRAL")
      .sort(sortEdges)
      .slice(0, options.limit);

    const byClass = (classification: BidirectionalClassification): BidirectionalEdgeItem[] =>
      edges.filter((item) => item.classification === classification).sort(sortEdges);

    return {
      totalTrades: trades.length,
      usedTrades: usableTrades.length,
      dbPath,
      tableName: TABLE_NAME,
      generatedAt: new Date().toISOString(),
      options,
      edges,
      forwardAdopt: byClass("FORWARD_ADOPT"),
      reverseAdopt: byClass("REVERSE_ADOPT"),
      forwardWatch: byClass("FORWARD_WATCH"),
      reverseWatch: byClass("REVERSE_WATCH"),
      block: byClass("BLOCK"),
      neutral: byClass("NEUTRAL"),
    };
  } finally {
    db.close();
  }
}
