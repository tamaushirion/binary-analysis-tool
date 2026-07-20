import db from "@/lib/db/database";

export type RejectStage =
  | "engine_skipped_by_confidence"
  | "engine_skipped_by_entry_gate"
  | "engine_skipped_by_empirical_entry_gate"
  | "engine_skipped_by_feature_win_rate_gate"
  | "engine_skipped_by_pattern_weight";

export type RejectLogInput = {
  evaluationId: string;
  rejectStage: RejectStage;
  aiVersion?: string | null;
  pair: string;
  direction: "HIGH" | "LOW";
  inputScore: number;
  finalScore: number;
  confidence: number;
  reason: string;
  featureSnapshot?: unknown;
  details?: unknown;
};

function ensureRejectLogTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entry_reject_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evaluation_id TEXT NOT NULL UNIQUE,
      reject_stage TEXT NOT NULL,
      ai_version TEXT,
      pair TEXT NOT NULL,
      direction TEXT NOT NULL,
      input_score REAL NOT NULL,
      final_score REAL NOT NULL,
      confidence REAL NOT NULL,
      reason TEXT NOT NULL,
      feature_snapshot_json TEXT,
      details_json TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_entry_reject_logs_stage
    ON entry_reject_logs(reject_stage);

    CREATE INDEX IF NOT EXISTS idx_entry_reject_logs_pair_direction
    ON entry_reject_logs(pair, direction);

    CREATE INDEX IF NOT EXISTS idx_entry_reject_logs_created_at
    ON entry_reject_logs(created_at);
  `);
}

try {
  ensureRejectLogTable();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : "Reject Log初期化失敗";
  console.error("Reject Log初期化失敗", message);
}

export function recordRejectLog(input: RejectLogInput) {
  try {
    db.prepare(
      `
      INSERT OR IGNORE INTO entry_reject_logs (
        evaluation_id,
        reject_stage,
        ai_version,
        pair,
        direction,
        input_score,
        final_score,
        confidence,
        reason,
        feature_snapshot_json,
        details_json,
        created_at
      ) VALUES (
        @evaluationId,
        @rejectStage,
        @aiVersion,
        @pair,
        @direction,
        @inputScore,
        @finalScore,
        @confidence,
        @reason,
        @featureSnapshotJson,
        @detailsJson,
        @createdAt
      )
      `,
    ).run({
      evaluationId: input.evaluationId,
      rejectStage: input.rejectStage,
      aiVersion: input.aiVersion ?? null,
      pair: input.pair,
      direction: input.direction,
      inputScore: input.inputScore,
      finalScore: input.finalScore,
      confidence: input.confidence,
      reason: input.reason,
      featureSnapshotJson:
        input.featureSnapshot === undefined
          ? null
          : JSON.stringify(input.featureSnapshot),
      detailsJson: input.details === undefined ? null : JSON.stringify(input.details),
      createdAt: Date.now(),
    });

    const row = db
      .prepare(
        `SELECT id
         FROM entry_reject_logs
         WHERE evaluation_id = ?
         LIMIT 1`,
      )
      .get(input.evaluationId) as { id: number } | undefined;

    if (!row) {
      return {
        ok: false as const,
        error: "Reject Log記録後のID取得に失敗しました",
      };
    }

    return { ok: true as const, rejectLogId: row.id };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Reject Log記録失敗";
    console.error("Reject Log記録失敗", message);
    return { ok: false as const, error: message };
  }
}
