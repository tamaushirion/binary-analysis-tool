import Database from "better-sqlite3";
import path from "path";
import { CURRENT_AI_VERSION } from "@/lib/versioning/aiVersion";

export type DemoPart2Status = {
  aiVersion: string;
  targetTrades: number;
  currentCount: number;
  remainingCount: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalProfit: number;
  firstTradeAt: number | string | null;
  lastTradeAt: number | string | null;
  completed: boolean;
  message: string;
};

const DEMO_PART2_TARGET_TRADES = 300;

function getDbPath() {
  return process.env.SQLITE_DB_PATH || path.join(process.cwd(), "data", "ai.db");
}

function ensureAiVersionColumn(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(trade_history)").all() as any[];
  const hasAiVersion = columns.some((column) => column.name === "ai_version");

  if (!hasAiVersion) {
    db.prepare("ALTER TABLE trade_history ADD COLUMN ai_version TEXT").run();
  }
}

export function getDemoPart2Status(): DemoPart2Status {
  const dbPath = getDbPath();
  const db = new Database(dbPath, { readonly: false });

  try {
    ensureAiVersionColumn(db);

    const row = db
      .prepare(
        `SELECT COUNT(*) as totalTrades,
                SUM(CASE WHEN status = 'WON' OR profit > 0 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN status = 'LOST' OR profit < 0 THEN 1 ELSE 0 END) as losses,
                ROUND(COALESCE(SUM(profit), 0), 4) as totalProfit,
                MIN(created_at) as firstTradeAt,
                MAX(created_at) as lastTradeAt
         FROM trade_history
         WHERE ai_version = ?`,
      )
      .get(CURRENT_AI_VERSION) as any;

    const total = Number(row?.totalTrades ?? 0);
    const wins = Number(row?.wins ?? 0);
    const losses = Number(row?.losses ?? 0);
    const completed = total >= DEMO_PART2_TARGET_TRADES;

    return {
      aiVersion: CURRENT_AI_VERSION,
      targetTrades: DEMO_PART2_TARGET_TRADES,
      currentCount: total,
      remainingCount: Math.max(0, DEMO_PART2_TARGET_TRADES - total),
      wins,
      losses,
      winRate: total > 0 ? Number(((wins / total) * 100).toFixed(2)) : null,
      totalProfit: Number(row?.totalProfit ?? 0),
      firstTradeAt: row?.firstTradeAt ?? null,
      lastTradeAt: row?.lastTradeAt ?? null,
      completed,
      message: completed
        ? "Demo Part2の初期300件検証が完了しました。"
        : "Demo Part2検証中です。",
    };
  } finally {
    db.close();
  }
}
