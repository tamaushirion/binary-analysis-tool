import db from "@/lib/db/database";
import type { RejectStage } from "@/lib/entry/rejectLogger";

export type NearMissMetric =
  | "confidence"
  | "entry_gate_score"
  | "empirical_win_rate";

export type NearMissInput = {
  evaluationId: string;
  rejectStage: RejectStage;
  metric: NearMissMetric;
  observedValue: number;
  thresholdValue: number;
  maxGap: number;
  aiVersion?: string | null;
  pair: string;
  direction: "HIGH" | "LOW";
  inputScore: number;
  finalScore: number;
  reason: string;
  featureSnapshot?: unknown;
  details?: unknown;
};

function ensureNearMissTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entry_near_miss_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evaluation_id TEXT NOT NULL UNIQUE,
      reject_stage TEXT NOT NULL,
      metric TEXT NOT NULL,
      observed_value REAL NOT NULL,
      threshold_value REAL NOT NULL,
      gap REAL NOT NULL,
      ai_version TEXT,
      pair TEXT NOT NULL,
      direction TEXT NOT NULL,
      input_score REAL NOT NULL,
      final_score REAL NOT NULL,
      reason TEXT NOT NULL,
      feature_snapshot_json TEXT,
      details_json TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_entry_near_miss_logs_stage
    ON entry_near_miss_logs(reject_stage);

    CREATE INDEX IF NOT EXISTS idx_entry_near_miss_logs_metric
    ON entry_near_miss_logs(metric);

    CREATE INDEX IF NOT EXISTS idx_entry_near_miss_logs_created_at
    ON entry_near_miss_logs(created_at);
  `);
}

try {
  ensureNearMissTable();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : "Near Miss初期化失敗";
  console.error("Near Miss初期化失敗", message);
}

export function recordNearMiss(input: NearMissInput) {
  const gap = input.thresholdValue - input.observedValue;
  if (gap <= 0 || gap > input.maxGap) {
    return { ok: true as const, recorded: false as const };
  }

  try {
    db.prepare(
      `
      INSERT OR IGNORE INTO entry_near_miss_logs (
        evaluation_id,
        reject_stage,
        metric,
        observed_value,
        threshold_value,
        gap,
        ai_version,
        pair,
        direction,
        input_score,
        final_score,
        reason,
        feature_snapshot_json,
        details_json,
        created_at
      ) VALUES (
        @evaluationId,
        @rejectStage,
        @metric,
        @observedValue,
        @thresholdValue,
        @gap,
        @aiVersion,
        @pair,
        @direction,
        @inputScore,
        @finalScore,
        @reason,
        @featureSnapshotJson,
        @detailsJson,
        @createdAt
      )
      `,
    ).run({
      evaluationId: input.evaluationId,
      rejectStage: input.rejectStage,
      metric: input.metric,
      observedValue: input.observedValue,
      thresholdValue: input.thresholdValue,
      gap,
      aiVersion: input.aiVersion ?? null,
      pair: input.pair,
      direction: input.direction,
      inputScore: input.inputScore,
      finalScore: input.finalScore,
      reason: input.reason,
      featureSnapshotJson:
        input.featureSnapshot === undefined
          ? null
          : JSON.stringify(input.featureSnapshot),
      detailsJson: input.details === undefined ? null : JSON.stringify(input.details),
      createdAt: Date.now(),
    });

    return { ok: true as const, recorded: true as const };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Near Miss記録失敗";
    console.error("Near Miss記録失敗", message);
    return { ok: false as const, error: message };
  }
}
