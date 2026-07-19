import type Database from "better-sqlite3";
import db from "@/lib/db/database";

type CountRow = {
  total: number;
};

type GateSummaryRow = {
  gateName: string;
  totalEvaluations: number;
  allowed: number;
  rejected: number;
  avgScore: number | null;
  avgAdjustedScore: number | null;
};

type RejectSummaryRow = {
  rejectStage: string;
  totalRejects: number;
  avgInputScore: number | null;
  avgFinalScore: number | null;
  avgConfidence: number | null;
};

type NearMissSummaryRow = {
  rejectStage: string;
  metric: string;
  totalNearMisses: number;
  avgGap: number | null;
  minGap: number | null;
  maxGap: number | null;
};

function tableExists(database: Database.Database, tableName: string) {
  const row = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    )
    .get(tableName) as { name?: string } | undefined;

  return row?.name === tableName;
}

function round2(value: number | null) {
  return value === null ? null : Math.round(value * 100) / 100;
}

function getTotal(tableName: string, since: number | null) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total FROM ${tableName}
       WHERE (@since IS NULL OR created_at >= @since)`,
    )
    .get({ since }) as CountRow;

  return Number(row.total ?? 0);
}

export function analyzeGates(input?: { sinceDays?: number | null }) {
  const sinceDays = input?.sinceDays ?? null;
  const since =
    sinceDays === null ? null : Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  const hasGateLogs = tableExists(db, "entry_gate_logs");
  const hasRejectLogs = tableExists(db, "entry_reject_logs");
  const hasNearMissLogs = tableExists(db, "entry_near_miss_logs");

  const gateRows = hasGateLogs
    ? (db
        .prepare(
          `
          SELECT
            gate_name AS gateName,
            COUNT(*) AS totalEvaluations,
            SUM(CASE WHEN allow = 1 THEN 1 ELSE 0 END) AS allowed,
            SUM(CASE WHEN allow = 0 THEN 1 ELSE 0 END) AS rejected,
            AVG(score) AS avgScore,
            AVG(adjusted_score) AS avgAdjustedScore
          FROM entry_gate_logs
          WHERE (@since IS NULL OR created_at >= @since)
          GROUP BY gate_name
          ORDER BY rejected DESC, totalEvaluations DESC, gate_name ASC
          `,
        )
        .all({ since }) as GateSummaryRow[])
    : [];

  const rejectRows = hasRejectLogs
    ? (db
        .prepare(
          `
          SELECT
            reject_stage AS rejectStage,
            COUNT(*) AS totalRejects,
            AVG(input_score) AS avgInputScore,
            AVG(final_score) AS avgFinalScore,
            AVG(confidence) AS avgConfidence
          FROM entry_reject_logs
          WHERE (@since IS NULL OR created_at >= @since)
          GROUP BY reject_stage
          ORDER BY totalRejects DESC, reject_stage ASC
          `,
        )
        .all({ since }) as RejectSummaryRow[])
    : [];

  const nearMissRows = hasNearMissLogs
    ? (db
        .prepare(
          `
          SELECT
            reject_stage AS rejectStage,
            metric,
            COUNT(*) AS totalNearMisses,
            AVG(gap) AS avgGap,
            MIN(gap) AS minGap,
            MAX(gap) AS maxGap
          FROM entry_near_miss_logs
          WHERE (@since IS NULL OR created_at >= @since)
          GROUP BY reject_stage, metric
          ORDER BY totalNearMisses DESC, reject_stage ASC
          `,
        )
        .all({ since }) as NearMissSummaryRow[])
    : [];

  const totalEvaluations = hasGateLogs
    ? Number(
        (
          db
            .prepare(
              `SELECT COUNT(DISTINCT evaluation_id) AS total
               FROM entry_gate_logs
               WHERE (@since IS NULL OR created_at >= @since)`,
            )
            .get({ since }) as CountRow
        ).total ?? 0,
      )
    : 0;
  const totalRejects = hasRejectLogs ? getTotal("entry_reject_logs", since) : 0;
  const totalNearMisses = hasNearMissLogs
    ? getTotal("entry_near_miss_logs", since)
    : 0;

  const gates = gateRows.map((row) => ({
    gateName: row.gateName,
    totalEvaluations: Number(row.totalEvaluations),
    allowed: Number(row.allowed),
    rejected: Number(row.rejected),
    passRate:
      row.totalEvaluations > 0
        ? round2((row.allowed / row.totalEvaluations) * 100)
        : 0,
    avgScore: round2(row.avgScore),
    avgAdjustedScore: round2(row.avgAdjustedScore),
  }));
  const rejects = rejectRows.map((row) => ({
    rejectStage: row.rejectStage,
    totalRejects: Number(row.totalRejects),
    shareOfRejects:
      totalRejects > 0
        ? round2((row.totalRejects / totalRejects) * 100)
        : 0,
    avgInputScore: round2(row.avgInputScore),
    avgFinalScore: round2(row.avgFinalScore),
    avgConfidence: round2(row.avgConfidence),
  }));
  const nearMisses = nearMissRows.map((row) => ({
    rejectStage: row.rejectStage,
    metric: row.metric,
    totalNearMisses: Number(row.totalNearMisses),
    avgGap: round2(row.avgGap),
    minGap: round2(row.minGap),
    maxGap: round2(row.maxGap),
  }));

  return {
    ok: true as const,
    stage: "gate_analysis" as const,
    generatedAt: new Date().toISOString(),
    period: {
      sinceDays,
      sinceIso: since === null ? null : new Date(since).toISOString(),
    },
    available: {
      gateLogs: hasGateLogs,
      rejectLogs: hasRejectLogs,
      nearMissLogs: hasNearMissLogs,
    },
    totals: {
      evaluations: totalEvaluations,
      rejects: totalRejects,
      nearMisses: totalNearMisses,
      rejectRate:
        totalEvaluations > 0
          ? round2((totalRejects / totalEvaluations) * 100)
          : 0,
      nearMissRateAmongRejects:
        totalRejects > 0
          ? round2((totalNearMisses / totalRejects) * 100)
          : 0,
    },
    bottleneck: rejects[0] ?? null,
    gates,
    rejects,
    nearMisses,
  };
}
