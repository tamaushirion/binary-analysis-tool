import db from "@/lib/db/database";
import type { RejectStage } from "@/lib/entry/rejectLogger";

export type RejectShadowStatus = "PENDING" | "WIN" | "LOST" | "DRAW" | "EXPIRED";

export type RejectShadowCandidateInput = {
  rejectLogId: number;
  evaluationId: string;
  rejectStage: RejectStage;
  aiVersion?: string | null;
  pair: string;
  direction: "HIGH" | "LOW";
  inputScore: number;
  finalScore: number;
  confidence: number;
  observationEpoch: number;
  exitEpoch: number;
  entrySpot: number;
  featureSnapshot?: unknown;
};

type PendingShadowRow = {
  id: number;
  pair: string;
  direction: "HIGH" | "LOW";
  observation_epoch: number;
  exit_epoch: number;
  entry_spot: number;
};

type ObservationResultRow = {
  exit_epoch: number;
  exit_close: number;
};

type SummaryRow = {
  rejectStage: string;
  total: number;
  pending: number;
  settled: number;
  wins: number;
  losses: number;
  draws: number;
  expired: number;
  totalProfit: number;
  latestSettledAt: number | null;
};

const EXPIRATION_GRACE_MS = 10 * 60 * 1000;

function ensureRejectShadowTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entry_reject_shadows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reject_log_id INTEGER NOT NULL UNIQUE,
      evaluation_id TEXT NOT NULL UNIQUE,
      reject_stage TEXT NOT NULL,
      ai_version TEXT,
      pair TEXT NOT NULL,
      direction TEXT NOT NULL,
      input_score REAL NOT NULL,
      final_score REAL NOT NULL,
      confidence REAL NOT NULL,
      observation_epoch INTEGER NOT NULL,
      exit_epoch INTEGER NOT NULL,
      entry_spot REAL NOT NULL,
      exit_spot REAL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      profit REAL,
      feature_snapshot_json TEXT,
      created_at INTEGER NOT NULL,
      settled_at INTEGER,
      FOREIGN KEY (reject_log_id) REFERENCES entry_reject_logs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_entry_reject_shadows_status_exit
    ON entry_reject_shadows(status, exit_epoch);

    CREATE INDEX IF NOT EXISTS idx_entry_reject_shadows_stage
    ON entry_reject_shadows(reject_stage, status);

    CREATE INDEX IF NOT EXISTS idx_entry_reject_shadows_observation
    ON entry_reject_shadows(pair, observation_epoch);
  `);
}

try {
  ensureRejectShadowTable();
} catch (error: unknown) {
  const message =
    error instanceof Error ? error.message : "Reject Shadow初期化失敗";
  console.error("Reject Shadow初期化失敗", message);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function settleStatus(
  direction: "HIGH" | "LOW",
  entrySpot: number,
  exitSpot: number,
): Exclude<RejectShadowStatus, "PENDING" | "EXPIRED"> {
  if (entrySpot === exitSpot) return "DRAW";
  if (direction === "HIGH") return exitSpot > entrySpot ? "WIN" : "LOST";
  return exitSpot < entrySpot ? "WIN" : "LOST";
}

function shadowProfit(status: Exclude<RejectShadowStatus, "PENDING" | "EXPIRED">) {
  if (status === "WIN") return 0.92;
  if (status === "LOST") return -1;
  return 0;
}

export function recordRejectShadowCandidate(input: RejectShadowCandidateInput) {
  try {
    const result = db
      .prepare(
        `
        INSERT OR IGNORE INTO entry_reject_shadows (
          reject_log_id,
          evaluation_id,
          reject_stage,
          ai_version,
          pair,
          direction,
          input_score,
          final_score,
          confidence,
          observation_epoch,
          exit_epoch,
          entry_spot,
          feature_snapshot_json,
          created_at
        ) VALUES (
          @rejectLogId,
          @evaluationId,
          @rejectStage,
          @aiVersion,
          @pair,
          @direction,
          @inputScore,
          @finalScore,
          @confidence,
          @observationEpoch,
          @exitEpoch,
          @entrySpot,
          @featureSnapshotJson,
          @createdAt
        )
        `,
      )
      .run({
        rejectLogId: input.rejectLogId,
        evaluationId: input.evaluationId,
        rejectStage: input.rejectStage,
        aiVersion: input.aiVersion ?? null,
        pair: input.pair,
        direction: input.direction,
        inputScore: input.inputScore,
        finalScore: input.finalScore,
        confidence: input.confidence,
        observationEpoch: input.observationEpoch,
        exitEpoch: input.exitEpoch,
        entrySpot: input.entrySpot,
        featureSnapshotJson:
          input.featureSnapshot === undefined
            ? null
            : JSON.stringify(input.featureSnapshot),
        createdAt: Date.now(),
      });

    return { ok: true as const, recorded: result.changes > 0 };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Reject Shadow記録失敗";
    console.error("Reject Shadow記録失敗", message);
    return { ok: false as const, error: message };
  }
}

export function settleRejectShadows(input?: { now?: number }) {
  const now = input?.now ?? Date.now();

  try {
    const pending = db
      .prepare(
        `SELECT id, pair, direction, observation_epoch, exit_epoch, entry_spot
         FROM entry_reject_shadows
         WHERE status = 'PENDING'
           AND exit_epoch <= ?
         ORDER BY exit_epoch ASC`,
      )
      .all(Math.floor(now / 1000)) as PendingShadowRow[];

    const findObservation = db.prepare(
      `SELECT exit_epoch, exit_close
       FROM market_observations
       WHERE pair = ?
         AND epoch = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
    );
    const settle = db.prepare(
      `UPDATE entry_reject_shadows
       SET exit_epoch = @exitEpoch,
           exit_spot = @exitSpot,
           status = @status,
           profit = @profit,
           settled_at = @settledAt
       WHERE id = @id
         AND status = 'PENDING'`,
    );
    const expire = db.prepare(
      `UPDATE entry_reject_shadows
       SET status = 'EXPIRED',
           settled_at = @settledAt
       WHERE id = @id
         AND status = 'PENDING'`,
    );

    let settledCount = 0;
    let expiredCount = 0;

    const transaction = db.transaction((rows: PendingShadowRow[]) => {
      for (const row of rows) {
        const observation = findObservation.get(
          row.pair,
          row.observation_epoch,
        ) as ObservationResultRow | undefined;

        if (observation) {
          const status = settleStatus(
            row.direction,
            row.entry_spot,
            observation.exit_close,
          );
          const profit = shadowProfit(status);
          const result = settle.run({
            id: row.id,
            exitEpoch: observation.exit_epoch,
            exitSpot: observation.exit_close,
            status,
            profit,
            settledAt: now,
          });
          settledCount += result.changes;
          continue;
        }

        if (now > row.exit_epoch * 1000 + EXPIRATION_GRACE_MS) {
          const result = expire.run({ id: row.id, settledAt: now });
          expiredCount += result.changes;
        }
      }
    });

    transaction(pending);

    return {
      ok: true as const,
      checked: pending.length,
      settled: settledCount,
      expired: expiredCount,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Reject Shadow確定失敗";
    console.error("Reject Shadow確定失敗", message);
    return { ok: false as const, error: message };
  }
}

export function getRejectShadowSummary(input?: { sinceDays?: number | null }) {
  const sinceDays = input?.sinceDays ?? null;
  const since =
    sinceDays === null ? null : Date.now() - sinceDays * 24 * 60 * 60 * 1000;

  const rows = db
    .prepare(
      `
      SELECT
        reject_stage AS rejectStage,
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status IN ('WIN', 'LOST', 'DRAW') THEN 1 ELSE 0 END) AS settled,
        SUM(CASE WHEN status = 'WIN' THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN status = 'LOST' THEN 1 ELSE 0 END) AS losses,
        SUM(CASE WHEN status = 'DRAW' THEN 1 ELSE 0 END) AS draws,
        SUM(CASE WHEN status = 'EXPIRED' THEN 1 ELSE 0 END) AS expired,
        COALESCE(SUM(CASE WHEN status IN ('WIN', 'LOST', 'DRAW') THEN profit ELSE 0 END), 0) AS totalProfit,
        MAX(settled_at) AS latestSettledAt
      FROM entry_reject_shadows
      WHERE (@since IS NULL OR created_at >= @since)
      GROUP BY reject_stage
      ORDER BY settled DESC, total DESC, reject_stage ASC
      `,
    )
    .all({ since }) as SummaryRow[];

  const stages = rows.map((row) => {
    const decided = row.wins + row.losses;
    return {
      ...row,
      winRate: decided > 0 ? round2((row.wins / decided) * 100) : null,
      totalProfit: round2(row.totalProfit),
    };
  });

  return {
    ok: true as const,
    stage: "reject_shadow_summary" as const,
    generatedAt: new Date().toISOString(),
    trackingOnly: true,
    executesDemoBuy: false,
    changesEntryDecision: false,
    settlementDurationMinutes: 1,
    total: stages.reduce((sum, row) => sum + row.total, 0),
    pending: stages.reduce((sum, row) => sum + row.pending, 0),
    settled: stages.reduce((sum, row) => sum + row.settled, 0),
    stages,
    message:
      "拒否候補を実取引せず、既存Market Observationの1分後結果でシャドー検証しています。",
  };
}
