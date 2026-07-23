import db from "@/lib/db/database";
import type { Demo2ShadowOverrideMatch } from "@/lib/entry/demo2ShadowGateOverride";

export type Demo2ShadowOverrideRunStatus =
  | "MATCHED"
  | "POST_GATE_REJECTED"
  | "FINAL_SKIPPED"
  | "EXECUTION_FAILED"
  | "BUY_EXECUTED"
  | "SETTLED"
  | "MONITOR_FAILED";

function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS demo2_shadow_override_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evaluation_id TEXT NOT NULL UNIQUE,
      candidate_id TEXT NOT NULL,
      candidate_name TEXT NOT NULL,
      rejected_gate TEXT NOT NULL,
      condition_key TEXT NOT NULL,
      condition_value TEXT NOT NULL,
      pair TEXT NOT NULL,
      direction TEXT NOT NULL,
      input_score REAL NOT NULL,
      status TEXT NOT NULL,
      contract_id TEXT,
      trade_status TEXT,
      profit REAL,
      detail_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_demo2_shadow_override_candidate
    ON demo2_shadow_override_runs(candidate_id, status);

    CREATE INDEX IF NOT EXISTS idx_demo2_shadow_override_created
    ON demo2_shadow_override_runs(created_at);
  `);
}

try {
  ensureTable();
} catch (error: unknown) {
  console.error(
    "Demo2 Shadow Override初期化失敗",
    error instanceof Error ? error.message : String(error),
  );
}

export function recordDemo2ShadowOverrideMatch(input: {
  evaluationId: string;
  match: Demo2ShadowOverrideMatch;
  pair: string;
  direction: "HIGH" | "LOW";
  inputScore: number;
}) {
  try {
    const now = Date.now();
    db.prepare(
      `INSERT OR IGNORE INTO demo2_shadow_override_runs (
         evaluation_id, candidate_id, candidate_name, rejected_gate,
         condition_key, condition_value, pair, direction, input_score,
         status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'MATCHED', ?, ?)`,
    ).run(
      input.evaluationId,
      input.match.candidateId,
      input.match.candidateName,
      input.match.rejectedGate,
      input.match.conditionKey,
      input.match.conditionValue,
      input.pair,
      input.direction,
      input.inputScore,
      now,
      now,
    );
    const row = db
      .prepare(
        "SELECT id FROM demo2_shadow_override_runs WHERE evaluation_id = ? LIMIT 1",
      )
      .get(input.evaluationId) as { id: number } | undefined;
    return row
      ? { ok: true as const, overrideRunId: row.id }
      : { ok: false as const, error: "Override Run ID取得失敗" };
  } catch (error: unknown) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Override Match記録失敗",
    };
  }
}

export function updateDemo2ShadowOverrideRun(input: {
  overrideRunId: number;
  status: Demo2ShadowOverrideRunStatus;
  contractId?: number | string | null;
  tradeStatus?: string | null;
  profit?: number | null;
  detail?: unknown;
}) {
  try {
    db.prepare(
      `UPDATE demo2_shadow_override_runs
       SET status = ?, contract_id = COALESCE(?, contract_id),
           trade_status = COALESCE(?, trade_status),
           profit = COALESCE(?, profit), detail_json = COALESCE(?, detail_json),
           updated_at = ?
       WHERE id = ?`,
    ).run(
      input.status,
      input.contractId === null || input.contractId === undefined
        ? null
        : String(input.contractId),
      input.tradeStatus ?? null,
      input.profit ?? null,
      input.detail === undefined ? null : JSON.stringify(input.detail),
      Date.now(),
      input.overrideRunId,
    );
    return { ok: true as const };
  } catch (error: unknown) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Override Run更新失敗",
    };
  }
}

type SummaryRow = {
  candidateId: string;
  candidateName: string;
  rejectedGate: string;
  matched: number;
  postGateRejected: number;
  finalSkipped: number;
  executionFailed: number;
  buyExecuted: number;
  settled: number;
  monitorFailed: number;
  wins: number;
  losses: number;
  draws: number;
  totalProfit: number;
};

export type Demo2ActualCandidateClassification =
  | "COLLECTING"
  | "WATCH"
  | "PROVEN"
  | "GATE_CANDIDATE"
  | "REVERSE_CANDIDATE";

function classifyActualCandidate(input: {
  settled: number;
  wins: number;
  losses: number;
  totalProfit: number;
}) {
  const decided = input.wins + input.losses;
  const winRate = decided > 0 ? (input.wins / decided) * 100 : null;
  if (
    decided >= 50 &&
    winRate !== null &&
    winRate <= 42 &&
    input.totalProfit < 0
  ) {
    return {
      classification: "REVERSE_CANDIDATE" as const,
      blocksForwardEntry: true,
      reason: "実決着50件以上・勝率42%以下・損益マイナスのため逆方向検証候補",
    };
  }
  if (
    decided >= 30 &&
    winRate !== null &&
    winRate < 52.08 &&
    input.totalProfit < 0
  ) {
    return {
      classification: "GATE_CANDIDATE" as const,
      blocksForwardEntry: true,
      reason: "実決着30件以上・損益分岐勝率52.08%未満・損益マイナスのためGate候補",
    };
  }
  if (
    decided >= 50 &&
    winRate !== null &&
    winRate >= 58 &&
    input.totalProfit > 0
  ) {
    return {
      classification: "PROVEN" as const,
      blocksForwardEntry: false,
      reason: "実決着50件以上・勝率58%以上・損益プラス",
    };
  }
  if (decided < 20) {
    return {
      classification: "COLLECTING" as const,
      blocksForwardEntry: false,
      reason: `実決着${decided}件。20件までは収集中`,
    };
  }
  return {
    classification: "WATCH" as const,
    blocksForwardEntry: false,
    reason: "実成績を継続監視中",
  };
}

export function getDemo2ActualCandidateDecision(candidateId: string) {
  const row = db
    .prepare(
      `SELECT
         SUM(status = 'SETTLED') AS settled,
         SUM(status = 'SETTLED' AND (trade_status IN ('WIN','WON') OR profit > 0)) AS wins,
         SUM(status = 'SETTLED' AND (trade_status IN ('LOST','LOSS') OR profit < 0)) AS losses,
         ROUND(COALESCE(SUM(CASE WHEN status = 'SETTLED' THEN profit ELSE 0 END), 0), 4) AS totalProfit
       FROM demo2_shadow_override_runs
       WHERE candidate_id = ?`,
    )
    .get(candidateId) as {
    settled: number | null;
    wins: number | null;
    losses: number | null;
    totalProfit: number | null;
  };
  return classifyActualCandidate({
    settled: Number(row.settled ?? 0),
    wins: Number(row.wins ?? 0),
    losses: Number(row.losses ?? 0),
    totalProfit: Number(row.totalProfit ?? 0),
  });
}

export function getDemo2ShadowOverrideSummary() {
  const rows = db
    .prepare(
      `SELECT candidate_id AS candidateId, candidate_name AS candidateName,
              rejected_gate AS rejectedGate, COUNT(*) AS matched,
              SUM(status = 'POST_GATE_REJECTED') AS postGateRejected,
              SUM(status = 'FINAL_SKIPPED') AS finalSkipped,
              SUM(status = 'EXECUTION_FAILED') AS executionFailed,
              SUM(status IN ('BUY_EXECUTED','SETTLED','MONITOR_FAILED')) AS buyExecuted,
              SUM(status = 'SETTLED') AS settled,
              SUM(status = 'MONITOR_FAILED') AS monitorFailed,
              SUM(status = 'SETTLED' AND (trade_status IN ('WIN','WON') OR profit > 0)) AS wins,
              SUM(status = 'SETTLED' AND (trade_status IN ('LOST','LOSS') OR profit < 0)) AS losses,
              SUM(status = 'SETTLED' AND COALESCE(profit, 0) = 0) AS draws,
              ROUND(COALESCE(SUM(CASE WHEN status = 'SETTLED' THEN profit ELSE 0 END), 0), 4) AS totalProfit
       FROM demo2_shadow_override_runs
       GROUP BY candidate_id, candidate_name, rejected_gate
       ORDER BY matched DESC, candidate_id ASC`,
    )
    .all() as SummaryRow[];
  return {
    ok: true as const,
    stage: "demo2_shadow_override_summary" as const,
    candidates: rows.map((row) => {
      const actualDecision = classifyActualCandidate(row);
      return {
        ...row,
        entryConversionRate:
        row.matched > 0
          ? Math.round((row.buyExecuted / row.matched) * 10000) / 100
          : null,
        winRate:
        row.wins + row.losses > 0
          ? Math.round((row.wins / (row.wins + row.losses)) * 10000) / 100
          : null,
        ...actualDecision,
        remainingToGate: Math.max(0, 30 - (row.wins + row.losses)),
        remainingToReverse: Math.max(0, 50 - (row.wins + row.losses)),
      };
    }),
    enabledForDemo2: true,
    changesProductionTrading: false,
    actualEntryLearningEnabled: true,
    thresholds: {
      collectingMinimum: 20,
      gateMinimum: 30,
      breakEvenWinRate: 52.08,
      reverseMinimum: 50,
      reverseMaximumWinRate: 42,
      provenMinimum: 50,
      provenMinimumWinRate: 58,
    },
  };
}
