import Database from "better-sqlite3";
import path from "node:path";

export type FeatureEffectMetric = {
  feature: string;
  value: string;
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
  avgProfit: number;
};

export type FeatureEffectAnalysisResult = {
  totalTrades: number;
  usedTrades: number;
  dbPath: string;
  tableName: "trade_history";
  generatedAt: string;
  effects: Record<string, FeatureEffectMetric[]>;
};

type TradeHistoryRow = {
  id: number;
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
  session: string | null;
  bos: number | null;
  choch: number | null;
  fvg: number | null;
  order_block: number | null;
  similarity_score: number | null;
  final_score: number | null;
  hour: number | null;
  weekday: number | null;
  feature_snapshot: string | null;
};

type ParsedSnapshot = Record<string, unknown>;

type MutableMetric = {
  feature: string;
  value: string;
  total: number;
  wins: number;
  losses: number;
  totalProfit: number;
};

const DB_PATH = path.join(process.cwd(), "data", "ai.db");
const TABLE_NAME = "trade_history" as const;

function round(value: number, digits = 2): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toBoolLabel(value: unknown): string {
  if (value === true || value === 1 || value === "1" || value === "true") return "YES";
  if (value === false || value === 0 || value === "0" || value === "false") return "NO";
  return "UNKNOWN";
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "UNKNOWN";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "UNKNOWN";
}

function parseSnapshot(raw: string | null): ParsedSnapshot {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ParsedSnapshot;
    }
  } catch {
    return {};
  }
  return {};
}

function band(value: number | null, size: number, label: string): string {
  if (value === null) return `${label}:UNKNOWN`;
  const lower = Math.floor(value / size) * size;
  const upper = lower + size - 1;
  return `${label}:${lower}-${upper}`;
}

function atrBand(value: number | null): string {
  if (value === null) return "ATR:UNKNOWN";
  if (value < 0.2) return "ATR:LOW(<0.2)";
  if (value < 0.5) return "ATR:MID(0.2-0.5)";
  if (value < 1) return "ATR:HIGH(0.5-1.0)";
  return "ATR:EXTREME(>=1.0)";
}

function rciBand(value: number | null, name: string): string {
  if (value === null) return `${name}:UNKNOWN`;
  if (value >= 80) return `${name}:OVERBOUGHT(>=80)`;
  if (value >= 50) return `${name}:STRONG_UP(50-79)`;
  if (value > -50) return `${name}:NEUTRAL(-49-49)`;
  if (value > -80) return `${name}:STRONG_DOWN(-79--50)`;
  return `${name}:OVERSOLD(<=-80)`;
}

function emaLabel(row: TradeHistoryRow, snapshot: ParsedSnapshot): string {
  const snapshotTrend = normalizeText(snapshot.emaTrend);
  if (snapshotTrend !== "UNKNOWN") return `EMA:${snapshotTrend}`;

  const diff = toNumber(row.ema_diff);
  if (diff === null) return "EMA:UNKNOWN";
  if (diff > 0) return "EMA:UP";
  if (diff < 0) return "EMA:DOWN";
  return "EMA:FLAT";
}

function scoreBand(row: TradeHistoryRow, snapshot: ParsedSnapshot): string {
  return band(toNumber(snapshot.score) ?? toNumber(row.final_score) ?? toNumber(row.score), 10, "Score");
}

function confidenceBand(row: TradeHistoryRow, snapshot: ParsedSnapshot): string {
  return band(toNumber(snapshot.confidence) ?? toNumber(snapshot.weightScore) ?? null, 10, "Confidence");
}

function similarityBand(row: TradeHistoryRow, snapshot: ParsedSnapshot): string {
  return band(toNumber(snapshot.similarityScore) ?? toNumber(row.similarity_score), 10, "Similarity");
}

function isWin(row: TradeHistoryRow): boolean {
  const profit = toNumber(row.profit) ?? 0;
  if (profit > 0) return true;
  const status = normalizeText(row.status).toUpperCase();
  return status === "WON" || status === "WIN";
}

function isLoss(row: TradeHistoryRow): boolean {
  const profit = toNumber(row.profit) ?? 0;
  if (profit < 0) return true;
  const status = normalizeText(row.status).toUpperCase();
  return status === "LOST" || status === "LOSE" || status === "LOSS";
}

function addMetric(map: Map<string, MutableMetric>, feature: string, value: string, row: TradeHistoryRow): void {
  const key = `${feature}::${value}`;
  const current = map.get(key) ?? {
    feature,
    value,
    total: 0,
    wins: 0,
    losses: 0,
    totalProfit: 0,
  };

  current.total += 1;
  if (isWin(row)) current.wins += 1;
  if (isLoss(row)) current.losses += 1;
  current.totalProfit += toNumber(row.profit) ?? 0;
  map.set(key, current);
}

function finalize(metrics: Map<string, MutableMetric>): FeatureEffectMetric[] {
  return [...metrics.values()]
    .map((item) => ({
      feature: item.feature,
      value: item.value,
      total: item.total,
      wins: item.wins,
      losses: item.losses,
      winRate: item.total > 0 ? round((item.wins / item.total) * 100, 2) : 0,
      totalProfit: round(item.totalProfit, 4),
      avgProfit: item.total > 0 ? round(item.totalProfit / item.total, 4) : 0,
    }))
    .sort((a, b) => b.total - a.total || b.winRate - a.winRate || b.totalProfit - a.totalProfit);
}

function ensureTableExists(db: Database.Database): void {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(TABLE_NAME) as { name?: string } | undefined;

  if (!row?.name) {
    throw new Error("trade_history table not found in data/ai.db.");
  }
}

export function analyzeFeatureEffects(): FeatureEffectAnalysisResult {
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

  try {
    ensureTableExists(db);

    const rows = db
      .prepare(
        `SELECT
          id, direction, score, profit, status,
          ema9, ema21, ema_diff,
          rci9, rci26, rci52,
          atr, session,
          bos, choch, fvg, order_block,
          similarity_score, final_score,
          hour, weekday, feature_snapshot
        FROM trade_history
        WHERE status IS NOT NULL
        ORDER BY id ASC`,
      )
      .all() as TradeHistoryRow[];

    const groups: Record<string, Map<string, MutableMetric>> = {
      EMA: new Map(),
      ATR: new Map(),
      RCI: new Map(),
      BOS: new Map(),
      CHOCH: new Map(),
      FVG: new Map(),
      OrderBlock: new Map(),
      Session: new Map(),
      Hour: new Map(),
      Weekday: new Map(),
      Direction: new Map(),
      ScoreBand: new Map(),
      ConfidenceBand: new Map(),
      SimilarityBand: new Map(),
    };

    for (const row of rows) {
      const snapshot = parseSnapshot(row.feature_snapshot);

      addMetric(groups.EMA, "EMA", emaLabel(row, snapshot), row);
      addMetric(groups.ATR, "ATR", normalizeText(snapshot.atrLevel) !== "UNKNOWN" ? `ATR:${normalizeText(snapshot.atrLevel)}` : atrBand(toNumber(row.atr)), row);
      addMetric(groups.RCI, "RCI", rciBand(toNumber(row.rci9), "RCI9"), row);
      addMetric(groups.RCI, "RCI", rciBand(toNumber(row.rci26), "RCI26"), row);
      addMetric(groups.RCI, "RCI", rciBand(toNumber(row.rci52), "RCI52"), row);
      addMetric(groups.BOS, "BOS", `BOS:${toBoolLabel(row.bos ?? snapshot.bos)}`, row);
      addMetric(groups.CHOCH, "CHOCH", `CHOCH:${toBoolLabel(row.choch ?? snapshot.choch)}`, row);
      addMetric(groups.FVG, "FVG", `FVG:${toBoolLabel(row.fvg ?? snapshot.fvg)}`, row);
      addMetric(groups.OrderBlock, "OrderBlock", `OrderBlock:${toBoolLabel(row.order_block ?? snapshot.orderBlock)}`, row);
      addMetric(groups.Session, "Session", `Session:${normalizeText(row.session ?? snapshot.session)}`, row);
      addMetric(groups.Hour, "Hour", `Hour:${toNumber(row.hour ?? snapshot.hour) ?? "UNKNOWN"}`, row);
      addMetric(groups.Weekday, "Weekday", `Weekday:${toNumber(row.weekday ?? snapshot.weekday) ?? "UNKNOWN"}`, row);
      addMetric(groups.Direction, "Direction", `Direction:${normalizeText(row.direction ?? snapshot.direction)}`, row);
      addMetric(groups.ScoreBand, "ScoreBand", scoreBand(row, snapshot), row);
      addMetric(groups.ConfidenceBand, "ConfidenceBand", confidenceBand(row, snapshot), row);
      addMetric(groups.SimilarityBand, "SimilarityBand", similarityBand(row, snapshot), row);
    }

    return {
      totalTrades: rows.length,
      usedTrades: rows.filter((row) => isWin(row) || isLoss(row)).length,
      dbPath: DB_PATH,
      tableName: TABLE_NAME,
      generatedAt: new Date().toISOString(),
      effects: Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, finalize(value)])),
    };
  } finally {
    db.close();
  }
}
