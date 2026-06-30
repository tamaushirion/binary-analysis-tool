import db from "@/lib/db/database";

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

type Demo100Run = {
  id: number;
  target_trades: number;
  started_at: string | null;
  started_at_ms: number | null;
  completed_at: string | null;
  completed_notified: number;
  active: number;
};

type Demo100Trade = {
  status: string;
  profit: number | null;
  created_at: number | null;
};

function ensureDemo100Tables() {
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

  const columns = db.prepare(`PRAGMA table_info(demo_100_runs)`).all() as Array<{
    name: string;
  }>;

  const hasStartedAtMs = columns.some((column) => column.name === "started_at_ms");

  if (!hasStartedAtMs) {
    db.prepare(`ALTER TABLE demo_100_runs ADD COLUMN started_at_ms INTEGER`).run();
  }
}

function getStartedAtMs(run: Demo100Run) {
  if (run.started_at_ms) return run.started_at_ms;

  const fallback = run.started_at
    ? new Date(run.started_at.replace(" ", "T")).getTime()
    : Date.now();

  const startedAtMs = Number.isFinite(fallback) ? fallback : Date.now();

  db.prepare(
    `
    UPDATE demo_100_runs
    SET started_at_ms = ?
    WHERE id = ?
    `
  ).run(startedAtMs, run.id);

  return startedAtMs;
}

function getOrCreateActiveRun() {
  ensureDemo100Tables();

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
    .get() as Demo100Run | undefined;

  if (activeRun) return activeRun;

  const now = Date.now();

  const result = db
    .prepare(
      `
      INSERT INTO demo_100_runs (
        target_trades,
        started_at,
        started_at_ms,
        active
      ) VALUES (
        100,
        CURRENT_TIMESTAMP,
        ?,
        1
      )
      `
    )
    .run(now);

  return db
    .prepare(
      `
      SELECT *
      FROM demo_100_runs
      WHERE id = ?
      `
    )
    .get(result.lastInsertRowid) as Demo100Run;
}

function getDemo100Trades(run: Demo100Run) {
  const startedAtMs = getStartedAtMs(run);

  return db
    .prepare(
      `
      SELECT
        status,
        profit,
        created_at
      FROM trade_history
      WHERE created_at >= ?
        AND profit IS NOT NULL
        AND status IN ('WON', 'LOST')
      ORDER BY created_at ASC
      LIMIT ?
      `
    )
    .all(startedAtMs, run.target_trades) as Demo100Trade[];
}

function calcStreaks(trades: Demo100Trade[]) {
  let currentWinStreak = 0;
  let currentLoseStreak = 0;

  for (let i = trades.length - 1; i >= 0; i--) {
    const status = String(trades[i].status).toUpperCase();

    if (status === "WON") {
      if (currentLoseStreak > 0) break;
      currentWinStreak++;
      continue;
    }

    if (status === "LOST") {
      if (currentWinStreak > 0) break;
      currentLoseStreak++;
      continue;
    }

    break;
  }

  return {
    currentWinStreak,
    currentLoseStreak,
  };
}

export function getDemo100Status(): Demo100Status {
  const run = getOrCreateActiveRun();
  const trades = getDemo100Trades(run);

  const wins = trades.filter((trade) => trade.status === "WON").length;
  const losses = trades.filter((trade) => trade.status === "LOST").length;
  const draws = Math.max(trades.length - wins - losses, 0);

  const totalProfit = Number(
    trades.reduce((sum, trade) => sum + Number(trade.profit ?? 0), 0).toFixed(2)
  );

  const winRate =
    wins + losses > 0 ? Number(((wins / (wins + losses)) * 100).toFixed(2)) : 0;

  const completed = trades.length >= run.target_trades;
  const remainingCount = Math.max(run.target_trades - trades.length, 0);

  if (completed && !run.completed_at) {
    db.prepare(
      `
      UPDATE demo_100_runs
      SET completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `
    ).run(run.id);
  }

  const { currentWinStreak, currentLoseStreak } = calcStreaks(trades);

  return {
    enabled: true,
    targetTrades: run.target_trades,
    currentCount: trades.length,
    remainingCount,
    wins,
    losses,
    draws,
    winRate,
    totalProfit,
    currentWinStreak,
    currentLoseStreak,
    completed,
    message: completed
      ? "100件デモ運用が完了しました。次はPhase14-CのAI分析に進めます。"
      : `100件デモ運用中：${trades.length}/${run.target_trades}件`,
  };
}

export function resetDemo100Run() {
  ensureDemo100Tables();

  db.prepare(
    `
    UPDATE demo_100_runs
    SET active = 0
    WHERE active = 1
    `
  ).run();

  db.prepare(
    `
    INSERT INTO demo_100_runs (
      target_trades,
      started_at,
      started_at_ms,
      active
    ) VALUES (
      100,
      CURRENT_TIMESTAMP,
      ?,
      1
    )
    `
  ).run(Date.now());

  return getDemo100Status();
}

export function markDemo100CompletedNotified() {
  ensureDemo100Tables();

  db.prepare(
    `
    UPDATE demo_100_runs
    SET completed_notified = 1
    WHERE active = 1
    `
  ).run();
}

export function shouldNotifyDemo100Completed() {
  const run = getOrCreateActiveRun();

  return Number(run.completed_notified) === 0;
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