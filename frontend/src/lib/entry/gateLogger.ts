import db from "@/lib/db/database";

export type GateLogName =
  | "confidence"
  | "entry_gate"
  | "empirical_entry_gate"
  | "feature_win_rate_gate"
  | "feature_robust_hard_gate_policy"
  | "pattern_weight"
  | "robust_hard_gate_policy";

export type GateLogInput = {
  evaluationId: string;
  gateName: GateLogName;
  aiVersion?: string | null;
  pair: string;
  direction: "HIGH" | "LOW";
  inputScore: number;
  allow: boolean;
  score?: number | null;
  adjustedScore?: number | null;
  reasons?: string[];
  details?: unknown;
};

let evaluationSequence = 0;

function ensureGateLogTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entry_gate_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evaluation_id TEXT NOT NULL,
      gate_name TEXT NOT NULL,
      ai_version TEXT,
      pair TEXT NOT NULL,
      direction TEXT NOT NULL,
      input_score REAL NOT NULL,
      allow INTEGER NOT NULL,
      score REAL,
      adjusted_score REAL,
      reasons_json TEXT NOT NULL,
      details_json TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_entry_gate_logs_evaluation_id
    ON entry_gate_logs(evaluation_id);

    CREATE INDEX IF NOT EXISTS idx_entry_gate_logs_gate_name
    ON entry_gate_logs(gate_name);

    CREATE INDEX IF NOT EXISTS idx_entry_gate_logs_created_at
    ON entry_gate_logs(created_at);
  `);
}

try {
  ensureGateLogTable();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : "Gate Log初期化失敗";
  console.error("Gate Log初期化失敗", message);
}

export function createGateEvaluationId() {
  evaluationSequence = (evaluationSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${Date.now()}-${process.pid}-${evaluationSequence}`;
}

export function recordGateLog(input: GateLogInput) {
  try {
    db.prepare(
      `
      INSERT INTO entry_gate_logs (
        evaluation_id,
        gate_name,
        ai_version,
        pair,
        direction,
        input_score,
        allow,
        score,
        adjusted_score,
        reasons_json,
        details_json,
        created_at
      ) VALUES (
        @evaluationId,
        @gateName,
        @aiVersion,
        @pair,
        @direction,
        @inputScore,
        @allow,
        @score,
        @adjustedScore,
        @reasonsJson,
        @detailsJson,
        @createdAt
      )
      `,
    ).run({
      evaluationId: input.evaluationId,
      gateName: input.gateName,
      aiVersion: input.aiVersion ?? null,
      pair: input.pair,
      direction: input.direction,
      inputScore: input.inputScore,
      allow: input.allow ? 1 : 0,
      score: input.score ?? null,
      adjustedScore: input.adjustedScore ?? null,
      reasonsJson: JSON.stringify(input.reasons ?? []),
      detailsJson: input.details === undefined ? null : JSON.stringify(input.details),
      createdAt: Date.now(),
    });

    return { ok: true as const };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Gate Log記録失敗";
    console.error("Gate Log記録失敗", message);
    return { ok: false as const, error: message };
  }
}
