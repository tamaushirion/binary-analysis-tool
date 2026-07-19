import db from "@/lib/db/database";

const REQUIRED_LOG_TABLES = [
  "entry_gate_logs",
  "entry_reject_logs",
  "entry_near_miss_logs",
] as const;

function ensureRestartTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS demo2_restart_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ai_version TEXT NOT NULL,
      interval_ms INTEGER NOT NULL,
      previous_trade_count INTEGER NOT NULL,
      restart_reason TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_demo2_restart_runs_created_at
    ON demo2_restart_runs(created_at);
  `);
}

try {
  ensureRestartTable();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : "Demo2 Restart初期化失敗";
  console.error("Demo2 Restart初期化失敗", message);
}

export function getDemo2LoggingReadiness() {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name IN (${REQUIRED_LOG_TABLES.map(() => "?").join(", ")})`,
    )
    .all(...REQUIRED_LOG_TABLES) as Array<{ name: string }>;
  const existing = new Set(rows.map((row) => row.name));
  const missing = REQUIRED_LOG_TABLES.filter((name) => !existing.has(name));

  return {
    ready: missing.length === 0,
    required: [...REQUIRED_LOG_TABLES],
    missing,
  };
}

export function recordDemo2Restart(input: {
  aiVersion: string;
  intervalMs: number;
  previousTradeCount: number;
  restartReason: string;
}) {
  try {
    const result = db
      .prepare(
        `
        INSERT INTO demo2_restart_runs (
          ai_version,
          interval_ms,
          previous_trade_count,
          restart_reason,
          created_at
        ) VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.aiVersion,
        input.intervalMs,
        input.previousTradeCount,
        input.restartReason,
        Date.now(),
      );

    return { ok: true as const, restartRunId: Number(result.lastInsertRowid) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Demo2 Restart記録失敗";
    console.error("Demo2 Restart記録失敗", message);
    return { ok: false as const, error: message };
  }
}
