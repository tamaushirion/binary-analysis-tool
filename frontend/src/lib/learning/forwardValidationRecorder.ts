import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type TradeDirection = "HIGH" | "LOW";
export type ForwardValidationStatus = "PENDING" | "WIN" | "LOST" | "DRAW" | "EXPIRED";
export type CandidateDirectionMode = "FORWARD" | "REVERSE";

export type ForwardValidationInput = {
  pair: string;
  sourceDirection: TradeDirection;
  entrySpot: number;
  observedAt?: number;
  durationMs?: number;
  score?: number | null;
  confidenceScore?: number | null;
  similarityScore?: number | null;
  finalScore?: number | null;
  weightScore?: number | null;
  ema9?: number | null;
  ema21?: number | null;
  emaDiff?: number | null;
  rci9?: number | null;
  rci26?: number | null;
  rci52?: number | null;
  atr?: number | null;
  trend?: string | null;
  marketPhase?: string | null;
  volatilityLevel?: string | null;
  session?: string | null;
  hour?: number | null;
  weekday?: number | null;
  bos?: boolean | number | null;
  choch?: boolean | number | null;
  fvg?: boolean | number | null;
  orderBlock?: boolean | number | null;
  featureSnapshot?: Record<string, unknown> | null;
  source?: string | null;
};

export type ForwardValidationOptions = {
  dbPath?: string;
  durationMs?: number;
  pendingGraceMs?: number;
  limit?: number;
};

export type ForwardCandidateDefinition = {
  candidateId: string;
  key: string;
  selectedDirection: CandidateDirectionMode;
  priority: number;
  reason: string;
};

export type ForwardValidationRecord = {
  id: number;
  candidate_id: string;
  candidate_key: string;
  selected_direction: CandidateDirectionMode;
  pair: string;
  source_direction: TradeDirection;
  virtual_direction: TradeDirection;
  entry_spot: number;
  exit_spot: number | null;
  status: ForwardValidationStatus;
  result_profit: number | null;
  observed_at: number;
  expires_at: number;
  settled_at: number | null;
  score: number | null;
  confidence_score: number | null;
  similarity_score: number | null;
  final_score: number | null;
  weight_score: number | null;
  ema9: number | null;
  ema21: number | null;
  ema_diff: number | null;
  rci9: number | null;
  rci26: number | null;
  rci52: number | null;
  atr: number | null;
  trend: string | null;
  market_phase: string | null;
  volatility_level: string | null;
  session: string | null;
  hour: number | null;
  weekday: number | null;
  bos: number | null;
  choch: number | null;
  fvg: number | null;
  order_block: number | null;
  feature_snapshot: string | null;
  source: string | null;
  created_at: number;
  updated_at: number;
};

export type ForwardValidationCandidateStats = {
  candidateId: string;
  candidateKey: string;
  selectedDirection: CandidateDirectionMode;
  total: number;
  pending: number;
  settled: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number | null;
  totalProfit: number;
  avgProfit: number | null;
  lastObservedAt: number | null;
  lastSettledAt: number | null;
};

export type ForwardValidationSummary = {
  generatedAt: string;
  dbPath: string;
  tableName: string;
  totalRecords: number;
  pendingRecords: number;
  settledRecords: number;
  candidates: ForwardValidationCandidateStats[];
  recent: ForwardValidationRecord[];
  message: string;
};

export type ForwardValidationRecordResult = {
  ok: boolean;
  matchedCandidates: ForwardCandidateDefinition[];
  inserted: number;
  skippedDuplicates: number;
  records: ForwardValidationRecord[];
  message: string;
};

export type ForwardValidationSettleInput = {
  pair: string;
  currentSpot: number;
  now?: number;
};

export type ForwardValidationSettleResult = {
  ok: boolean;
  settled: number;
  expired: number;
  records: ForwardValidationRecord[];
  message: string;
};

type SqliteCountRow = { count: number };
type CandidateStatRow = {
  candidate_id: string;
  candidate_key: string;
  selected_direction: CandidateDirectionMode;
  total: number;
  pending: number;
  settled: number;
  wins: number;
  losses: number;
  draws: number;
  total_profit: number | null;
  last_observed_at: number | null;
  last_settled_at: number | null;
};

const DB_RELATIVE_PATH = path.join("data", "ai.db");
const TABLE_NAME = "forward_validation_records";
const DEFAULT_DURATION_MS = 60_000;
const DEFAULT_PENDING_GRACE_MS = 30_000;

function projectRoot() {
  return process.cwd();
}

function defaultDbPath() {
  return path.join(projectRoot(), DB_RELATIVE_PATH);
}

function resolveDbPath(input?: string) {
  return input ? path.resolve(input) : defaultDbPath();
}

function openDb(options?: ForwardValidationOptions) {
  const dbPath = resolveDbPath(options?.dbPath);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return new Database(dbPath);
}

function nowMs() {
  return Date.now();
}

function round(value: number, digits = 4) {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function normalizeDirection(value: string): TradeDirection {
  return value === "LOW" ? "LOW" : "HIGH";
}

function reverseDirection(direction: TradeDirection): TradeDirection {
  return direction === "HIGH" ? "LOW" : "HIGH";
}

function toNullableNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toNullableText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toFlag(value: boolean | number | null | undefined): number | null {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" && Number.isFinite(value)) return value ? 1 : 0;
  return null;
}

function normalizeSession(value: string | null | undefined): string | null {
  const text = toNullableText(value);
  return text ? text.toUpperCase() : null;
}

function band(value: number | null | undefined) {
  const numeric = toNullableNumber(value);
  if (numeric === null) return null;
  const lower = Math.floor(numeric / 10) * 10;
  return `${lower}-${lower + 9}`;
}

function isRci9Oversold(value: number | null | undefined) {
  const numeric = toNullableNumber(value);
  return numeric !== null && numeric <= -80;
}

function ensureSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id TEXT NOT NULL,
      candidate_key TEXT NOT NULL,
      selected_direction TEXT NOT NULL,
      pair TEXT NOT NULL,
      source_direction TEXT NOT NULL,
      virtual_direction TEXT NOT NULL,
      entry_spot REAL NOT NULL,
      exit_spot REAL,
      status TEXT NOT NULL,
      result_profit REAL,
      observed_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      settled_at INTEGER,
      score REAL,
      confidence_score REAL,
      similarity_score REAL,
      final_score REAL,
      weight_score REAL,
      ema9 REAL,
      ema21 REAL,
      ema_diff REAL,
      rci9 REAL,
      rci26 REAL,
      rci52 REAL,
      atr REAL,
      trend TEXT,
      market_phase TEXT,
      volatility_level TEXT,
      session TEXT,
      hour INTEGER,
      weekday INTEGER,
      bos INTEGER,
      choch INTEGER,
      fvg INTEGER,
      order_block INTEGER,
      feature_snapshot TEXT,
      source TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_forward_validation_unique_candidate_time
      ON ${TABLE_NAME} (candidate_id, pair, observed_at, source_direction, entry_spot);

    CREATE INDEX IF NOT EXISTS idx_forward_validation_status_expires
      ON ${TABLE_NAME} (status, expires_at);

    CREATE INDEX IF NOT EXISTS idx_forward_validation_candidate
      ON ${TABLE_NAME} (candidate_id, status, observed_at);
  `);
}

function rowToRecord(row: unknown): ForwardValidationRecord {
  const record = row as ForwardValidationRecord;
  return {
    ...record,
    source_direction: normalizeDirection(record.source_direction),
    virtual_direction: normalizeDirection(record.virtual_direction),
    selected_direction: record.selected_direction === "FORWARD" ? "FORWARD" : "REVERSE",
    status: normalizeStatus(record.status),
  };
}

function normalizeStatus(value: string): ForwardValidationStatus {
  if (value === "WIN" || value === "LOST" || value === "DRAW" || value === "EXPIRED") return value;
  return "PENDING";
}

function getRecordById(db: Database.Database, id: number) {
  const row = db.prepare(`SELECT * FROM ${TABLE_NAME} WHERE id = ?`).get(id);
  return row ? rowToRecord(row) : null;
}

export function detectForwardValidationCandidates(input: ForwardValidationInput): ForwardCandidateDefinition[] {
  const candidates: ForwardCandidateDefinition[] = [];
  const similarityBand = band(input.similarityScore);
  const confidenceBand = band(input.confidenceScore);
  const session = normalizeSession(input.session);

  if (similarityBand === "100-109") {
    candidates.push({
      candidateId: "BIDIRECTIONAL:Similarity:Similarity:100-109",
      key: "Similarity=Similarity:100-109",
      selectedDirection: "REVERSE",
      priority: 1,
      reason: "既存SQLiteでSimilarity:100-109が反転73.33%のWATCH候補。",
    });
  }

  if (confidenceBand === "100-109") {
    candidates.push({
      candidateId: "BIDIRECTIONAL:Confidence:Confidence:100-109",
      key: "Confidence=Confidence:100-109",
      selectedDirection: "REVERSE",
      priority: 2,
      reason: "Similarity:100-109と重複しやすいが、Confidence:100-109も反転WATCH候補。",
    });
  }

  if (isRci9Oversold(input.rci9) && session === "NEW_YORK") {
    candidates.push({
      candidateId: "REGIME:RCI9:OVERSOLD(<=-80) × Session:NEW_YORK",
      key: "RCI9:OVERSOLD(<=-80) × Session:NEW_YORK",
      selectedDirection: "REVERSE",
      priority: 3,
      reason: "最近のRegimeで反転Edgeが強まっている可能性があるWATCH候補。",
    });
  }

  return candidates.sort((a, b) => a.priority - b.priority);
}

export function recordForwardValidationCandidate(
  input: ForwardValidationInput,
  options?: ForwardValidationOptions,
): ForwardValidationRecordResult {
  const durationMs = options?.durationMs ?? input.durationMs ?? DEFAULT_DURATION_MS;
  const observedAt = input.observedAt ?? nowMs();
  const entrySpot = toNullableNumber(input.entrySpot);
  if (entrySpot === null) {
    return {
      ok: false,
      matchedCandidates: [],
      inserted: 0,
      skippedDuplicates: 0,
      records: [],
      message: "entrySpotが不正なためForward Validationを保存しませんでした。",
    };
  }

  const matchedCandidates = detectForwardValidationCandidates(input);
  if (matchedCandidates.length === 0) {
    return {
      ok: true,
      matchedCandidates,
      inserted: 0,
      skippedDuplicates: 0,
      records: [],
      message: "Forward Validation対象候補に一致しませんでした。",
    };
  }

  const db = openDb(options);
  try {
    ensureSchema(db);
    const insert = db.prepare(`
      INSERT OR IGNORE INTO ${TABLE_NAME} (
        candidate_id,
        candidate_key,
        selected_direction,
        pair,
        source_direction,
        virtual_direction,
        entry_spot,
        status,
        observed_at,
        expires_at,
        score,
        confidence_score,
        similarity_score,
        final_score,
        weight_score,
        ema9,
        ema21,
        ema_diff,
        rci9,
        rci26,
        rci52,
        atr,
        trend,
        market_phase,
        volatility_level,
        session,
        hour,
        weekday,
        bos,
        choch,
        fvg,
        order_block,
        feature_snapshot,
        source,
        created_at,
        updated_at
      ) VALUES (
        @candidate_id,
        @candidate_key,
        @selected_direction,
        @pair,
        @source_direction,
        @virtual_direction,
        @entry_spot,
        'PENDING',
        @observed_at,
        @expires_at,
        @score,
        @confidence_score,
        @similarity_score,
        @final_score,
        @weight_score,
        @ema9,
        @ema21,
        @ema_diff,
        @rci9,
        @rci26,
        @rci52,
        @atr,
        @trend,
        @market_phase,
        @volatility_level,
        @session,
        @hour,
        @weekday,
        @bos,
        @choch,
        @fvg,
        @order_block,
        @feature_snapshot,
        @source,
        @created_at,
        @updated_at
      )
    `);

    const records: ForwardValidationRecord[] = [];
    let inserted = 0;
    let skippedDuplicates = 0;
    const sourceDirection = normalizeDirection(input.sourceDirection);

    for (const candidate of matchedCandidates) {
      const virtualDirection = candidate.selectedDirection === "REVERSE" ? reverseDirection(sourceDirection) : sourceDirection;
      const result = insert.run({
        candidate_id: candidate.candidateId,
        candidate_key: candidate.key,
        selected_direction: candidate.selectedDirection,
        pair: input.pair,
        source_direction: sourceDirection,
        virtual_direction: virtualDirection,
        entry_spot: entrySpot,
        observed_at: observedAt,
        expires_at: observedAt + durationMs,
        score: toNullableNumber(input.score),
        confidence_score: toNullableNumber(input.confidenceScore),
        similarity_score: toNullableNumber(input.similarityScore),
        final_score: toNullableNumber(input.finalScore),
        weight_score: toNullableNumber(input.weightScore),
        ema9: toNullableNumber(input.ema9),
        ema21: toNullableNumber(input.ema21),
        ema_diff: toNullableNumber(input.emaDiff),
        rci9: toNullableNumber(input.rci9),
        rci26: toNullableNumber(input.rci26),
        rci52: toNullableNumber(input.rci52),
        atr: toNullableNumber(input.atr),
        trend: toNullableText(input.trend),
        market_phase: toNullableText(input.marketPhase),
        volatility_level: toNullableText(input.volatilityLevel),
        session: normalizeSession(input.session),
        hour: toNullableNumber(input.hour),
        weekday: toNullableNumber(input.weekday),
        bos: toFlag(input.bos),
        choch: toFlag(input.choch),
        fvg: toFlag(input.fvg),
        order_block: toFlag(input.orderBlock),
        feature_snapshot: input.featureSnapshot ? JSON.stringify(input.featureSnapshot) : null,
        source: toNullableText(input.source) ?? "phase16-f-forward-validation-recorder",
        created_at: observedAt,
        updated_at: observedAt,
      });

      if (result.changes > 0) {
        inserted += 1;
        const record = getRecordById(db, Number(result.lastInsertRowid));
        if (record) records.push(record);
      } else {
        skippedDuplicates += 1;
      }
    }

    return {
      ok: true,
      matchedCandidates,
      inserted,
      skippedDuplicates,
      records,
      message: `Forward Validation候補を${inserted}件保存しました。実際のDeriv Buyは行っていません。`,
    };
  } finally {
    db.close();
  }
}

function judgeVirtualResult(direction: TradeDirection, entrySpot: number, exitSpot: number): ForwardValidationStatus {
  if (exitSpot === entrySpot) return "DRAW";
  if (direction === "HIGH") return exitSpot > entrySpot ? "WIN" : "LOST";
  return exitSpot < entrySpot ? "WIN" : "LOST";
}

function profitForStatus(status: ForwardValidationStatus) {
  if (status === "WIN") return 0.92;
  if (status === "LOST") return -1;
  return 0;
}

export function settleForwardValidationCandidates(
  input: ForwardValidationSettleInput,
  options?: ForwardValidationOptions,
): ForwardValidationSettleResult {
  const currentSpot = toNullableNumber(input.currentSpot);
  if (currentSpot === null) {
    return {
      ok: false,
      settled: 0,
      expired: 0,
      records: [],
      message: "currentSpotが不正なためForward Validationを確定できませんでした。",
    };
  }

  const now = input.now ?? nowMs();
  const pendingGraceMs = options?.pendingGraceMs ?? DEFAULT_PENDING_GRACE_MS;
  const db = openDb(options);

  try {
    ensureSchema(db);
    const pendingRows = db
      .prepare(
        `SELECT * FROM ${TABLE_NAME}
         WHERE status = 'PENDING'
           AND pair = ?
           AND expires_at <= ?
         ORDER BY expires_at ASC`,
      )
      .all(input.pair, now) as unknown[];

    const update = db.prepare(`
      UPDATE ${TABLE_NAME}
      SET exit_spot = @exit_spot,
          status = @status,
          result_profit = @result_profit,
          settled_at = @settled_at,
          updated_at = @updated_at
      WHERE id = @id
    `);

    const records: ForwardValidationRecord[] = [];
    let settled = 0;
    let expired = 0;

    for (const row of pendingRows) {
      const record = rowToRecord(row);
      const shouldExpire = now > record.expires_at + pendingGraceMs;
      const status = shouldExpire
        ? "EXPIRED"
        : judgeVirtualResult(record.virtual_direction, record.entry_spot, currentSpot);
      const resultProfit = profitForStatus(status);

      update.run({
        id: record.id,
        exit_spot: currentSpot,
        status,
        result_profit: resultProfit,
        settled_at: now,
        updated_at: now,
      });

      const updated = getRecordById(db, record.id);
      if (updated) records.push(updated);
      if (status === "EXPIRED") expired += 1;
      else settled += 1;
    }

    return {
      ok: true,
      settled,
      expired,
      records,
      message: `Forward Validationを${settled}件確定、${expired}件期限切れにしました。`,
    };
  } finally {
    db.close();
  }
}

function countRows(db: Database.Database, where: string) {
  const row = db.prepare(`SELECT COUNT(*) as count FROM ${TABLE_NAME} ${where}`).get() as SqliteCountRow;
  return row.count;
}

function statsFromRow(row: CandidateStatRow): ForwardValidationCandidateStats {
  const settled = row.settled;
  const wins = row.wins;
  const losses = row.losses;
  const draws = row.draws;
  const totalProfit = round(row.total_profit ?? 0, 4);
  return {
    candidateId: row.candidate_id,
    candidateKey: row.candidate_key,
    selectedDirection: row.selected_direction,
    total: row.total,
    pending: row.pending,
    settled,
    wins,
    losses,
    draws,
    winRate: settled > 0 ? round((wins / settled) * 100, 2) : null,
    totalProfit,
    avgProfit: settled > 0 ? round(totalProfit / settled, 4) : null,
    lastObservedAt: row.last_observed_at,
    lastSettledAt: row.last_settled_at,
  };
}

export function getForwardValidationSummary(options?: ForwardValidationOptions): ForwardValidationSummary {
  const dbPath = resolveDbPath(options?.dbPath);
  const limit = options?.limit ?? 50;
  const db = openDb(options);

  try {
    ensureSchema(db);
    const totalRecords = countRows(db, "");
    const pendingRecords = countRows(db, "WHERE status = 'PENDING'");
    const settledRecords = countRows(db, "WHERE status IN ('WIN', 'LOST', 'DRAW')");

    const statRows = db
      .prepare(
        `SELECT
           candidate_id,
           candidate_key,
           selected_direction,
           COUNT(*) as total,
           SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending,
           SUM(CASE WHEN status IN ('WIN', 'LOST', 'DRAW') THEN 1 ELSE 0 END) as settled,
           SUM(CASE WHEN status = 'WIN' THEN 1 ELSE 0 END) as wins,
           SUM(CASE WHEN status = 'LOST' THEN 1 ELSE 0 END) as losses,
           SUM(CASE WHEN status = 'DRAW' THEN 1 ELSE 0 END) as draws,
           SUM(CASE WHEN status IN ('WIN', 'LOST', 'DRAW') THEN COALESCE(result_profit, 0) ELSE 0 END) as total_profit,
           MAX(observed_at) as last_observed_at,
           MAX(settled_at) as last_settled_at
         FROM ${TABLE_NAME}
         GROUP BY candidate_id, candidate_key, selected_direction
         ORDER BY settled DESC, total_profit DESC, total DESC`,
      )
      .all() as CandidateStatRow[];

    const recentRows = db
      .prepare(`SELECT * FROM ${TABLE_NAME} ORDER BY observed_at DESC, id DESC LIMIT ?`)
      .all(limit) as unknown[];

    return {
      generatedAt: new Date().toISOString(),
      dbPath,
      tableName: TABLE_NAME,
      totalRecords,
      pendingRecords,
      settledRecords,
      candidates: statRows.map(statsFromRow),
      recent: recentRows.map(rowToRecord),
      message: "Forward Validationの前向き仮想検証状況です。実際のDeriv Buyは行いません。",
    };
  } finally {
    db.close();
  }
}

export function recordAndSettleForwardValidation(
  input: ForwardValidationInput & { currentSpot?: number | null },
  options?: ForwardValidationOptions,
) {
  const settleResult = typeof input.currentSpot === "number"
    ? settleForwardValidationCandidates({ pair: input.pair, currentSpot: input.currentSpot, now: input.observedAt }, options)
    : null;
  const recordResult = recordForwardValidationCandidate(input, options);
  const summary = getForwardValidationSummary(options);

  return {
    ok: recordResult.ok && (settleResult?.ok ?? true),
    settleResult,
    recordResult,
    summary,
  };
}
