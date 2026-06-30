import Database from "better-sqlite3";

const DB_PATH = process.env.SQLITE_DB_PATH || "data/trades.db";

export type Demo100Status = {
  enabled: boolean;
  targetTrades: number;
  currentCount: number;
  remainingCount: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  totalProfit: number;
  currentWinStreak: number;
  currentLoseStreak: number;
  completed: boolean;
  message: string;
};

function getDb() {
  return new Database(DB_PATH);
}

function ensureDemo100Tables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS demo_100_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_trades INTEGER NOT NULL DEFAULT 100,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      completed_notified INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
  `);
}

function getOrCreateActiveRun(db: Database.Database) {
  ensureDemo100Tables(db);

  const activeRun = db
    .prepare(
      `
      SELECT *
      FROM demo_100_runs
      WHERE active = 1
      ORDER BY id DESC
      LIMIT 1
    `
    )
    .get() as any;

  if (activeRun) return activeRun;

  const result = db
    .prepare(
      `
      INSERT INTO demo_100_runs (target_trades, active)
      VALUES (100, 1)
    `
    )
    .run();

  return db
    .prepare(
      `
      SELECT *
      FROM demo_100_runs
      WHERE id = ?
    `
    )
    .get(result.lastInsertRowid) as any;
}

function getTradeRows(db: Database.Database, startedAt: string) {
  const tables = db
    .prepare(
      `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
    `
    )
    .all() as { name: string }[];

  const tableNames = tables.map((t) => t.name);

  const tradeTable =
    tableNames.find((name) => name === "trade_history") ||
    tableNames.find((name) => name === "trades") ||
    tableNames.find((name) => name.includes("trade"));

  if (!tradeTable) return [];

  const columns = db.prepare(`PRAGMA table_info(${tradeTable})`).all() as {
    name: string;
  }[];

  const columnNames = columns.map((c) => c.name);

  const resultColumn =
    columnNames.find((c) => c === "result") ||
    columnNames.find((c) => c === "status") ||
    columnNames.find((c) => c === "outcome");

  const profitColumn =
    columnNames.find((c) => c === "profit") ||
    columnNames.find((c) => c === "profit_loss") ||
    columnNames.find((c) => c === "pnl");

  const createdColumn =
    columnNames.find((c) => c === "created_at") ||
    columnNames.find((c) => c === "closed_at") ||
    columnNames.find((c) => c === "finished_at") ||
    columnNames.find((c) => c === "notifiedAt");

  if (!resultColumn || !profitColumn) return [];

  const where = createdColumn ? `WHERE ${createdColumn} >= ?` : "";
  const params = createdColumn ? [startedAt] : [];

  return db
    .prepare(
      `
      SELECT
        ${resultColumn} as result,
        ${profitColumn} as profit
      FROM ${tradeTable}
      ${where}
      ORDER BY rowid ASC
    `
    )
    .all(...params) as { result: string; profit: number }[];
}

function calcStreaks(rows: { result: string; profit: number }[]) {
  let currentWinStreak = 0;
  let currentLoseStreak = 0;

  for (let i = rows.length - 1; i >= 0; i--) {
    const result = String(rows[i].result).toUpperCase();

    if (result.includes("WIN")) {
      if (currentLoseStreak > 0) break;
      currentWinStreak++;
      continue;
    }

    if (result.includes("LOSE") || result.includes("LOSS")) {
      if (currentWinStreak > 0) break;
      currentLoseStreak++;
      continue;
    }

    break;
  }

  return { currentWinStreak, currentLoseStreak };
}

export function getDemo100Status(): Demo100Status {
  const db = getDb();

  try {
    const run = getOrCreateActiveRun(db);
    const rows = getTradeRows(db, run.started_at).slice(0, run.target_trades);

    const wins = rows.filter((r) =>
      String(r.result).toUpperCase().includes("WIN")
    ).length;

    const losses = rows.filter((r) => {
      const result = String(r.result).toUpperCase();
      return result.includes("LOSE") || result.includes("LOSS");
    }).length;

    const draws = rows.length - wins - losses;

    const totalProfit = rows.reduce((sum, r) => {
      return sum + Number(r.profit || 0);
    }, 0);

    const winRate =
      wins + losses > 0 ? Number(((wins / (wins + losses)) * 100).toFixed(2)) : 0;

    const remainingCount = Math.max(run.target_trades - rows.length, 0);
    const completed = rows.length >= run.target_trades;

    if (completed && !run.completed_at) {
      db.prepare(
        `
        UPDATE demo_100_runs
        SET completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      ).run(run.id);
    }

    const { currentWinStreak, currentLoseStreak } = calcStreaks(rows);

    return {
      enabled: true,
      targetTrades: run.target_trades,
      currentCount: rows.length,
      remainingCount,
      wins,
      losses,
      draws,
      winRate,
      totalProfit: Number(totalProfit.toFixed(2)),
      currentWinStreak,
      currentLoseStreak,
      completed,
      message: completed
        ? "100件デモ運用が完了しました。次はPhase14-CのAI分析に進めます。"
        : `100件デモ運用中：${rows.length}/${run.target_trades}件`,
    };
  } finally {
    db.close();
  }
}

export function resetDemo100Run() {
  const db = getDb();

  try {
    ensureDemo100Tables(db);

    db.prepare(
      `
      UPDATE demo_100_runs
      SET active = 0
      WHERE active = 1
    `
    ).run();

    db.prepare(
      `
      INSERT INTO demo_100_runs (target_trades, active)
      VALUES (100, 1)
    `
    ).run();

    return getDemo100Status();
  } finally {
    db.close();
  }
}

export function markDemo100CompletedNotified() {
  const db = getDb();

  try {
    ensureDemo100Tables(db);

    db.prepare(
      `
      UPDATE demo_100_runs
      SET completed_notified = 1
      WHERE active = 1
    `
    ).run();
  } finally {
    db.close();
  }
}

export function shouldNotifyDemo100Completed() {
  const db = getDb();

  try {
    const run = getOrCreateActiveRun(db);

    return Number(run.completed_notified) === 0;
  } finally {
    db.close();
  }
}

export async function notifyDemo100CompletedIfNeeded() {
  const status = getDemo100Status();

  if (!status.completed) {
    return {
      notified: false,
      reason: "not_completed",
      status,
    };
  }

  if (!shouldNotifyDemo100Completed()) {
    return {
      notified: false,
      reason: "already_notified",
      status,
    };
  }

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = process.env.LINE_USER_ID;

  if (!token || !userId) {
    return {
      notified: false,
      reason: "line_env_missing",
      status,
    };
  }

  const text = [
    "✅ 100件デモ運用が完了しました",
    "",
    `件数: ${status.currentCount}/${status.targetTrades}`,
    `勝率: ${status.winRate}%`,
    `勝ち: ${status.wins}`,
    `負け: ${status.losses}`,
    `引き分け: ${status.draws}`,
    `利益: ${status.totalProfit} USD`,
    `連勝: ${status.currentWinStreak}`,
    `連敗: ${status.currentLoseStreak}`,
    "",
    "次はPhase14-Cで、勝率改善だけを目的にAI分析します。",
  ].join("\n");

  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: "text", text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE通知に失敗しました: ${body}`);
  }

  markDemo100CompletedNotified();

  return {
    notified: true,
    reason: "completed",
    status,
  };
}