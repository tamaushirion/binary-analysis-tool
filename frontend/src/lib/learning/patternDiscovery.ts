import Database from "better-sqlite3";
import path from "node:path";

export type PatternDecision = "ADOPT" | "WATCH" | "BLOCK";

export type DiscoveredPattern = {
  pattern: string;
  decision: PatternDecision;
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
  avgProfit: number;
};

export type PatternDiscoveryResult = {
  totalTrades: number;
  usedTrades: number;
  dbPath: string;
  tableName: "trade_history";
  generatedAt: string;
  patterns: DiscoveredPattern[];
  adopt: DiscoveredPattern[];
  watch: DiscoveredPattern[];
  block: DiscoveredPattern[];
};

type TradeHistoryRow = {
  id: number;
  direction: string | null;
  score: number | null;
  profit: number | null;
  status: string | null;
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

type MutablePattern = {
  pattern: string;
  total: number;
  wins: number;
  losses: number;
  totalProfit: number;
};

const DB_PATH = path.join(process.cwd(), "data", "ai.db");
const TABLE_NAME = "trade_history" as const;

const PAIRS: Array<[string, string]> = [
  ["EMA", "BOS"],
  ["EMA", "ATR"],
  ["EMA", "SMC"],
  ["EMA", "RCI"],
  ["SMC", "ATR"],
  ["Direction", "EMA"],
  ["Direction", "ATR"],
  ["Hour", "Direction"],
  ["Weekday", "Direction"],
];

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

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "UNKNOWN";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "UNKNOWN";
}

function boolLabel(name: string, value: unknown): string {
  if (value === true || value === 1 || value === "1" || value === "true") return `${name}:YES`;
  if (value === false || value === 0 || value === "0" || value === "false") return `${name}:NO`;
  return `${name}:UNKNOWN`;
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

function atrLabel(row: TradeHistoryRow, snapshot: ParsedSnapshot): string {
  const snapshotLevel = normalizeText(snapshot.atrLevel);
  if (snapshotLevel !== "UNKNOWN") return `ATR:${snapshotLevel}`;

  const atr = toNumber(row.atr);
  if (atr === null) return "ATR:UNKNOWN";
  if (atr < 0.2) return "ATR:LOW";
  if (atr < 0.5) return "ATR:MID";
  if (atr < 1) return "ATR:HIGH";
  return "ATR:EXTREME";
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

function rciLabel(row: TradeHistoryRow): string {
  const rci9 = toNumber(row.rci9);
  const rci26 = toNumber(row.rci26);
  const rci52 = toNumber(row.rci52);
  if (rci9 === null || rci26 === null || rci52 === null) return "RCI:UNKNOWN";
  if (rci9 >= 50 && rci26 >= 0 && rci52 >= 0) return "RCI:UP_ALIGN";
  if (rci9 <= -50 && rci26 <= 0 && rci52 <= 0) return "RCI:DOWN_ALIGN";
  if (rci9 >= 80) return "RCI:OVERBOUGHT";
  if (rci9 <= -80) return "RCI:OVERSOLD";
  return "RCI:MIXED";
}

function smcLabel(row: TradeHistoryRow, snapshot: ParsedSnapshot): string {
  const bos = row.bos ?? snapshot.bos;
  const choch = row.choch ?? snapshot.choch;
  const fvg = row.fvg ?? snapshot.fvg;
  const orderBlock = row.order_block ?? snapshot.orderBlock;

  const parts = [
    boolLabel("BOS", bos),
    boolLabel("CHOCH", choch),
    boolLabel("FVG", fvg),
    boolLabel("OB", orderBlock),
  ];

  return `SMC:${parts.join("+")}`;
}

function featureMap(row: TradeHistoryRow): Record<string, string> {
  const snapshot = parseSnapshot(row.feature_snapshot);

  return {
    EMA: emaLabel(row, snapshot),
    ATR: atrLabel(row, snapshot),
    RCI: rciLabel(row),
    SMC: smcLabel(row, snapshot),
    BOS: boolLabel("BOS", row.bos ?? snapshot.bos),
    Direction: `Direction:${normalizeText(row.direction ?? snapshot.direction)}`,
    Hour: `Hour:${toNumber(row.hour ?? snapshot.hour) ?? "UNKNOWN"}`,
    Weekday: `Weekday:${toNumber(row.weekday ?? snapshot.weekday) ?? "UNKNOWN"}`,
  };
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

function decide(total: number, winRate: number, totalProfit: number): PatternDecision | null {
  if (winRate >= 70 && total >= 50 && totalProfit > 0) return "ADOPT";
  if (winRate >= 65 && total >= 30 && total <= 49) return "WATCH";
  if (winRate <= 45 && total >= 50 && totalProfit < 0) return "BLOCK";
  return null;
}

function addPattern(map: Map<string, MutablePattern>, pattern: string, row: TradeHistoryRow): void {
  const current = map.get(pattern) ?? {
    pattern,
    total: 0,
    wins: 0,
    losses: 0,
    totalProfit: 0,
  };

  current.total += 1;
  if (isWin(row)) current.wins += 1;
  if (isLoss(row)) current.losses += 1;
  current.totalProfit += toNumber(row.profit) ?? 0;
  map.set(pattern, current);
}

function finalize(map: Map<string, MutablePattern>): DiscoveredPattern[] {
  return [...map.values()]
    .map((item) => {
      const winRate = item.total > 0 ? round((item.wins / item.total) * 100, 2) : 0;
      const totalProfit = round(item.totalProfit, 4);
      const decision = decide(item.total, winRate, totalProfit);
      if (!decision) return null;

      return {
        pattern: item.pattern,
        decision,
        total: item.total,
        wins: item.wins,
        losses: item.losses,
        winRate,
        totalProfit,
        avgProfit: item.total > 0 ? round(item.totalProfit / item.total, 4) : 0,
      } satisfies DiscoveredPattern;
    })
    .filter((item): item is DiscoveredPattern => item !== null)
    .sort((a, b) => {
      const rank: Record<PatternDecision, number> = { ADOPT: 3, WATCH: 2, BLOCK: 1 };
      return rank[b.decision] - rank[a.decision] || b.winRate - a.winRate || b.total - a.total || b.totalProfit - a.totalProfit;
    });
}

function ensureTableExists(db: Database.Database): void {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(TABLE_NAME) as { name?: string } | undefined;

  if (!row?.name) {
    throw new Error("trade_history table not found in data/ai.db.");
  }
}

export function discoverPatterns(): PatternDiscoveryResult {
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

  try {
    ensureTableExists(db);

    const rows = db
      .prepare(
        `SELECT
          id, direction, score, profit, status,
          ema_diff,
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

    const map = new Map<string, MutablePattern>();

    for (const row of rows) {
      if (!isWin(row) && !isLoss(row)) continue;
      const features = featureMap(row);

      for (const [left, right] of PAIRS) {
        const leftValue = features[left];
        const rightValue = features[right];
        if (!leftValue || !rightValue) continue;
        addPattern(map, `${leftValue} × ${rightValue}`, row);
      }
    }

    const patterns = finalize(map);

    return {
      totalTrades: rows.length,
      usedTrades: rows.filter((row) => isWin(row) || isLoss(row)).length,
      dbPath: DB_PATH,
      tableName: TABLE_NAME,
      generatedAt: new Date().toISOString(),
      patterns,
      adopt: patterns.filter((pattern) => pattern.decision === "ADOPT"),
      watch: patterns.filter((pattern) => pattern.decision === "WATCH"),
      block: patterns.filter((pattern) => pattern.decision === "BLOCK"),
    };
  } finally {
    db.close();
  }
}
