import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type Phase16QDirection = "HIGH" | "LOW";
export type Phase16QResult = "WIN" | "LOST" | "DRAW";
export type Phase16QClassification =
  | "STRONG_ADOPT"
  | "DEMO_CANDIDATE"
  | "FORWARD_STRONG"
  | "WATCH"
  | "TOO_EARLY"
  | "REJECT";

export type Phase16QOptions = {
  dbPath?: string;
  featureVersion?: string;
  dedupThreshold?: number;
  primaryMinSample?: number;
  demoMinSample?: number;
  strongMinSample?: number;
  recentWindow?: number;
};

export type Phase16QCandidateDefinition = {
  id: "phase16_q_backtest3m_rci26_smc_low" | "phase16_q_high40_low70_high" | "phase16_q_lowscore70_newyork_high";
  name: string;
  direction: Phase16QDirection;
  conditionLabel: string;
  phase16OSample: number;
  phase16OWinRate: number;
  phase16OProfit: number;
  phase16OWilsonLowerBound: number;
  riskNote: string | null;
};

export type Phase16QDedupPair = {
  leftCandidateId: string;
  rightCandidateId: string;
  intersection: number;
  union: number;
  jaccard: number;
  duplicate: boolean;
};

export type Phase16QBoundary = {
  featureVersion: string;
  phase: string;
  startedAt: string;
  startedAtMs: number;
  boundaryObservationId: number;
  boundaryEpoch: number | null;
  boundaryIso: string | null;
};

export type Phase16QCandidateResult = Phase16QCandidateDefinition & {
  active: boolean;
  duplicateOf: string | null;
  historicalMatchedObservations: number;
  matchedObservations: number;
  wins: number;
  losses: number;
  draws: number;
  decided: number;
  winRate: number | null;
  profit: number;
  avgProfit: number | null;
  wilsonLowerBound: number | null;
  phase16OWinRateGap: number | null;
  firstHalfWinRate: number | null;
  secondHalfWinRate: number | null;
  firstSecondGap: number | null;
  recentWinRate: number | null;
  recentSample: number;
  directionalEdgeFrom50: number | null;
  stableEnough: boolean;
  classification: Phase16QClassification;
  message: string;
};

export type Phase16QResultPayload = {
  ok: true;
  stage: "market_observation_phase16_q_forward_validation";
  generatedAt: string;
  dbPath: string;
  tableName: "market_observations";
  stateTableName: "market_observation_phase16_q_state";
  countedTableName: "market_observation_phase16_q_counts";
  candidateStateTableName: "market_observation_phase16_q_candidates";
  featureVersion: string;
  boundary: Phase16QBoundary;
  newObservationsAfterBoundary: number;
  newlyCounted: number;
  dedupThreshold: number;
  dedupPairs: Phase16QDedupPair[];
  activeCandidateIds: string[];
  candidates: Phase16QCandidateResult[];
  summary: {
    totalCandidates: number;
    activeCandidates: number;
    strongAdopt: number;
    demoCandidate: number;
    forwardStrong: number;
    watch: number;
    tooEarly: number;
    reject: number;
  };
  message: string;
};

type ObservationRow = {
  id: number;
  epoch: number | null;
  high_result: string | null;
  low_result: string | null;
  high_profit: number | null;
  low_profit: number | null;
  high_score: number | null;
  low_score: number | null;
  selected_score: number | null;
  selected_direction: string | null;
  ema_diff: number | null;
  rci52: number | null;
  fvg: number | null;
  choch: number | null;
  smc_score: number | null;
  backtest_win_rate_1m: number | null;
  backtest_win_rate_3m: number | null;
  rci26: number | null;
  session: string | null;
  feature_version: string | null;
};

type StateRow = {
  feature_version: string;
  phase: string;
  started_at_ms: number;
  boundary_observation_id: number;
  boundary_epoch: number | null;
};

type CandidateStateRow = {
  candidate_id: string;
  active: number;
  duplicate_of: string | null;
  historical_match_count: number;
};

type CountedRow = {
  candidate_id: string;
  observation_id: number;
  epoch: number | null;
  result: Phase16QResult;
  profit: number;
};

type BoundaryRow = { max_id: number | null; max_epoch: number | null };
type CountRow = { count: number };

const TABLE_NAME = "market_observations" as const;
const STATE_TABLE_NAME = "market_observation_phase16_q_state" as const;
const COUNTED_TABLE_NAME = "market_observation_phase16_q_counts" as const;
const CANDIDATE_STATE_TABLE_NAME = "market_observation_phase16_q_candidates" as const;
const DEFAULT_FEATURE_VERSION = "phase16-k-market-observation-v1";
const PHASE = "phase16-q-deduplicated-forward-validation";

const CANDIDATES: Phase16QCandidateDefinition[] = [
  {
    id: "phase16_q_backtest3m_rci26_smc_low",
    name: "Backtest3m・RCI26・SMC型",
    direction: "LOW",
    conditionLabel: "Backtest3m:45-49 × RCI26:NEUTRAL(-49-49) × SMCScore:0-9 × LOW",
    phase16OSample: 149,
    phase16OWinRate: 64.19,
    phase16OProfit: 34.4,
    phase16OWilsonLowerBound: 56.2,
    riskNote: "Backtest3m算出に未来情報が混入していないことをDemo接続前に再確認する必要があります。",
  },
  {
    id: "phase16_q_high40_low70_high",
    name: "HighScore40・LowScore70型",
    direction: "HIGH",
    conditionLabel: "HighScore:40-49 × LowScore:70-79 × HIGH",
    phase16OSample: 185,
    phase16OWinRate: 61.75,
    phase16OProfit: 33.96,
    phase16OWilsonLowerBound: 54.53,
    riskNote: null,
  },
  {
    id: "phase16_q_lowscore70_newyork_high",
    name: "LowScore70・NY型",
    direction: "HIGH",
    conditionLabel: "LowScore:70-79 × Session:NEW_YORK × HIGH",
    phase16OSample: 155,
    phase16OWinRate: 62.99,
    phase16OProfit: 32.24,
    phase16OWilsonLowerBound: 55.13,
    riskNote: null,
  },
];

function resolveDbPath(input?: string): string {
  if (input) return path.resolve(input);
  const candidates = [
    path.join(process.cwd(), "data", "ai.db"),
    path.join(process.cwd(), "..", "data", "ai.db"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  return found ?? candidates[0];
}

function openDb(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return new Database(dbPath);
}

function round(value: number, digits = 2): number {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeResult(value: string | null): Phase16QResult | null {
  if (value === "WIN" || value === "LOST" || value === "DRAW") return value;
  return null;
}

function winRate(wins: number, losses: number): number | null {
  const decided = wins + losses;
  return decided > 0 ? round((wins / decided) * 100, 2) : null;
}

function wilsonLowerBound(wins: number, total: number, z = 1.96): number | null {
  if (total <= 0) return null;
  const p = wins / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return round(((centre - margin) / denominator) * 100, 2);
}

function ensureBaseTableExists(db: Database.Database): void {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(TABLE_NAME) as
    | { name?: string }
    | undefined;
  if (!row?.name) throw new Error("market_observations table not found in SQLite database.");
}

function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${STATE_TABLE_NAME} (
      feature_version TEXT NOT NULL,
      phase TEXT NOT NULL,
      started_at_ms INTEGER NOT NULL,
      boundary_observation_id INTEGER NOT NULL,
      boundary_epoch INTEGER,
      PRIMARY KEY (feature_version, phase)
    );

    CREATE TABLE IF NOT EXISTS ${CANDIDATE_STATE_TABLE_NAME} (
      feature_version TEXT NOT NULL,
      phase TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      active INTEGER NOT NULL,
      duplicate_of TEXT,
      historical_match_count INTEGER NOT NULL,
      condition_label TEXT NOT NULL,
      direction TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (feature_version, phase, candidate_id)
    );

    CREATE TABLE IF NOT EXISTS ${COUNTED_TABLE_NAME} (
      feature_version TEXT NOT NULL,
      phase TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      observation_id INTEGER NOT NULL,
      epoch INTEGER,
      result TEXT NOT NULL,
      profit REAL NOT NULL,
      counted_at_ms INTEGER NOT NULL,
      PRIMARY KEY (feature_version, phase, candidate_id, observation_id)
    );

    CREATE INDEX IF NOT EXISTS idx_phase16_q_counts_candidate
      ON ${COUNTED_TABLE_NAME} (feature_version, phase, candidate_id, observation_id);

    CREATE INDEX IF NOT EXISTS idx_phase16_q_counts_observation
      ON ${COUNTED_TABLE_NAME} (feature_version, phase, observation_id);
  `);
}

function resolveOptions(input?: Phase16QOptions): Required<Phase16QOptions> {
  return {
    dbPath: resolveDbPath(input?.dbPath),
    featureVersion: input?.featureVersion?.trim() || DEFAULT_FEATURE_VERSION,
    dedupThreshold:
      typeof input?.dedupThreshold === "number" && Number.isFinite(input.dedupThreshold)
        ? Math.min(1, Math.max(0.5, input.dedupThreshold))
        : 0.95,
    primaryMinSample:
      typeof input?.primaryMinSample === "number" && Number.isFinite(input.primaryMinSample)
        ? Math.max(20, Math.floor(input.primaryMinSample))
        : 50,
    demoMinSample:
      typeof input?.demoMinSample === "number" && Number.isFinite(input.demoMinSample)
        ? Math.max(50, Math.floor(input.demoMinSample))
        : 100,
    strongMinSample:
      typeof input?.strongMinSample === "number" && Number.isFinite(input.strongMinSample)
        ? Math.max(100, Math.floor(input.strongMinSample))
        : 200,
    recentWindow:
      typeof input?.recentWindow === "number" && Number.isFinite(input.recentWindow)
        ? Math.max(20, Math.floor(input.recentWindow))
        : 50,
  };
}

function loadAllRows(db: Database.Database, featureVersion: string): ObservationRow[] {
  return db.prepare(`
    SELECT
      id, epoch, high_result, low_result, high_profit, low_profit,
      high_score, low_score, selected_score, selected_direction,
      ema_diff, rci52, rci26, session, fvg, choch, smc_score, backtest_win_rate_1m, backtest_win_rate_3m,
      feature_version
    FROM ${TABLE_NAME}
    WHERE feature_version = ?
      AND high_result IN ('WIN', 'LOST', 'DRAW')
      AND low_result IN ('WIN', 'LOST', 'DRAW')
    ORDER BY id ASC
  `).all(featureVersion) as ObservationRow[];
}

function matchesCandidate(row: ObservationRow, candidateId: Phase16QCandidateDefinition["id"]): boolean {
  if (candidateId === "phase16_q_backtest3m_rci26_smc_low") {
    const backtest3m = finiteNumber(row.backtest_win_rate_3m);
    const rci26 = finiteNumber(row.rci26);
    const smcScore = finiteNumber(row.smc_score);
    return (
      backtest3m !== null &&
      backtest3m >= 45 &&
      backtest3m < 50 &&
      rci26 !== null &&
      rci26 >= -49 &&
      rci26 < 50 &&
      smcScore !== null &&
      smcScore >= 0 &&
      smcScore < 10
    );
  }

  if (candidateId === "phase16_q_high40_low70_high") {
    const highScore = finiteNumber(row.high_score);
    const lowScore = finiteNumber(row.low_score);
    return (
      highScore !== null &&
      highScore >= 40 &&
      highScore < 50 &&
      lowScore !== null &&
      lowScore >= 70 &&
      lowScore < 80
    );
  }

  const lowScore = finiteNumber(row.low_score);
  return (
    lowScore !== null &&
    lowScore >= 70 &&
    lowScore < 80 &&
    typeof row.session === "string" &&
    row.session.trim().toUpperCase() === "NEW_YORK"
  );
}

function getOrCreateBoundary(db: Database.Database, featureVersion: string): StateRow {
  const existing = db.prepare(`
    SELECT feature_version, phase, started_at_ms, boundary_observation_id, boundary_epoch
    FROM ${STATE_TABLE_NAME}
    WHERE feature_version = ? AND phase = ?
  `).get(featureVersion, PHASE) as StateRow | undefined;

  if (existing) return existing;

  const boundary = db.prepare(`
    SELECT MAX(id) AS max_id, MAX(epoch) AS max_epoch
    FROM ${TABLE_NAME}
    WHERE feature_version = ?
  `).get(featureVersion) as BoundaryRow;

  const now = Date.now();
  const row: StateRow = {
    feature_version: featureVersion,
    phase: PHASE,
    started_at_ms: now,
    boundary_observation_id: boundary.max_id ?? 0,
    boundary_epoch: boundary.max_epoch ?? null,
  };

  db.prepare(`
    INSERT INTO ${STATE_TABLE_NAME} (
      feature_version, phase, started_at_ms, boundary_observation_id, boundary_epoch
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    row.feature_version,
    row.phase,
    row.started_at_ms,
    row.boundary_observation_id,
    row.boundary_epoch,
  );

  return row;
}

function jaccard(left: Set<number>, right: Set<number>): {
  intersection: number;
  union: number;
  value: number;
} {
  let intersection = 0;
  for (const id of left) if (right.has(id)) intersection += 1;
  const union = left.size + right.size - intersection;
  return {
    intersection,
    union,
    value: union > 0 ? round(intersection / union, 4) : 0,
  };
}

function initializeCandidateState(
  db: Database.Database,
  featureVersion: string,
  boundaryObservationId: number,
  dedupThreshold: number,
): Phase16QDedupPair[] {
  const count = db.prepare(`
    SELECT COUNT(*) AS count
    FROM ${CANDIDATE_STATE_TABLE_NAME}
    WHERE feature_version = ? AND phase = ?
  `).get(featureVersion, PHASE) as CountRow;

  const historicalRows = db.prepare(`
    SELECT
      id, epoch, high_result, low_result, high_profit, low_profit,
      high_score, low_score, selected_score, selected_direction,
      ema_diff, rci52, rci26, session, fvg, choch, smc_score, backtest_win_rate_1m, backtest_win_rate_3m,
      feature_version
    FROM ${TABLE_NAME}
    WHERE feature_version = ? AND id <= ?
    ORDER BY id ASC
  `).all(featureVersion, boundaryObservationId) as ObservationRow[];

  const sets = new Map<string, Set<number>>();
  for (const candidate of CANDIDATES) {
    sets.set(
      candidate.id,
      new Set(
        historicalRows
          .filter((row) => matchesCandidate(row, candidate.id))
          .map((row) => row.id),
      ),
    );
  }

  const pairs: Phase16QDedupPair[] = [];
  for (let i = 0; i < CANDIDATES.length; i += 1) {
    for (let j = i + 1; j < CANDIDATES.length; j += 1) {
      const left = CANDIDATES[i];
      const right = CANDIDATES[j];
      const stats = jaccard(sets.get(left.id) ?? new Set<number>(), sets.get(right.id) ?? new Set<number>());
      pairs.push({
        leftCandidateId: left.id,
        rightCandidateId: right.id,
        intersection: stats.intersection,
        union: stats.union,
        jaccard: stats.value,
        duplicate: stats.value >= dedupThreshold,
      });
    }
  }

  if (count.count > 0) return pairs;

  const duplicateOf = new Map<string, string>();
  for (const pair of pairs) {
    if (!pair.duplicate) continue;
    const left = CANDIDATES.find((candidate) => candidate.id === pair.leftCandidateId);
    const right = CANDIDATES.find((candidate) => candidate.id === pair.rightCandidateId);
    if (!left || !right) continue;

    const leftSetSize = sets.get(left.id)?.size ?? 0;
    const rightSetSize = sets.get(right.id)?.size ?? 0;
    const representative =
      left.phase16OWilsonLowerBound > right.phase16OWilsonLowerBound
        ? left
        : right.phase16OWilsonLowerBound > left.phase16OWilsonLowerBound
          ? right
          : leftSetSize >= rightSetSize
            ? left
            : right;
    const duplicate = representative.id === left.id ? right : left;
    if (!duplicateOf.has(duplicate.id)) duplicateOf.set(duplicate.id, representative.id);
  }

  const now = Date.now();
  const insert = db.prepare(`
    INSERT INTO ${CANDIDATE_STATE_TABLE_NAME} (
      feature_version, phase, candidate_id, active, duplicate_of,
      historical_match_count, condition_label, direction, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    for (const candidate of CANDIDATES) {
      const duplicate = duplicateOf.get(candidate.id) ?? null;
      insert.run(
        featureVersion,
        PHASE,
        candidate.id,
        duplicate === null ? 1 : 0,
        duplicate,
        sets.get(candidate.id)?.size ?? 0,
        candidate.conditionLabel,
        candidate.direction,
        now,
        now,
      );
    }
  });
  transaction();

  return pairs;
}

function loadCandidateStates(db: Database.Database, featureVersion: string): CandidateStateRow[] {
  return db.prepare(`
    SELECT candidate_id, active, duplicate_of, historical_match_count
    FROM ${CANDIDATE_STATE_TABLE_NAME}
    WHERE feature_version = ? AND phase = ?
    ORDER BY candidate_id ASC
  `).all(featureVersion, PHASE) as CandidateStateRow[];
}

function countNewObservations(db: Database.Database, featureVersion: string, boundaryId: number): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM ${TABLE_NAME}
    WHERE feature_version = ? AND id > ?
  `).get(featureVersion, boundaryId) as CountRow;
  return row.count;
}

function countNewMatches(
  db: Database.Database,
  featureVersion: string,
  boundaryId: number,
  states: CandidateStateRow[],
): number {
  const rows = db.prepare(`
    SELECT
      id, epoch, high_result, low_result, high_profit, low_profit,
      high_score, low_score, selected_score, selected_direction,
      ema_diff, rci52, rci26, session, fvg, choch, smc_score, backtest_win_rate_1m, backtest_win_rate_3m,
      feature_version
    FROM ${TABLE_NAME}
    WHERE feature_version = ? AND id > ?
    ORDER BY id ASC
  `).all(featureVersion, boundaryId) as ObservationRow[];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO ${COUNTED_TABLE_NAME} (
      feature_version, phase, candidate_id, observation_id,
      epoch, result, profit, counted_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  const activeStates = states.filter((state) => state.active === 1);
  const now = Date.now();

  const transaction = db.transaction(() => {
    for (const row of rows) {
      for (const state of activeStates) {
        const candidate = CANDIDATES.find((item) => item.id === state.candidate_id);
        if (!candidate || !matchesCandidate(row, candidate.id)) continue;

        const result = candidate.direction === "HIGH"
          ? normalizeResult(row.high_result)
          : normalizeResult(row.low_result);
        if (!result) continue;

        const profit = candidate.direction === "HIGH"
          ? finiteNumber(row.high_profit) ?? 0
          : finiteNumber(row.low_profit) ?? 0;

        const changes = insert.run(
          featureVersion,
          PHASE,
          candidate.id,
          row.id,
          row.epoch,
          result,
          profit,
          now,
        ).changes;
        inserted += changes;
      }
    }
  });
  transaction();

  return inserted;
}

function loadCountedRows(
  db: Database.Database,
  featureVersion: string,
  candidateId: string,
): CountedRow[] {
  return db.prepare(`
    SELECT candidate_id, observation_id, epoch, result, profit
    FROM ${COUNTED_TABLE_NAME}
    WHERE feature_version = ? AND phase = ? AND candidate_id = ?
    ORDER BY observation_id ASC
  `).all(featureVersion, PHASE, candidateId) as CountedRow[];
}

function statsForRows(rows: CountedRow[]): {
  wins: number;
  losses: number;
  draws: number;
  decided: number;
  winRate: number | null;
} {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const row of rows) {
    if (row.result === "WIN") wins += 1;
    else if (row.result === "LOST") losses += 1;
    else draws += 1;
  }
  const decided = wins + losses;
  return { wins, losses, draws, decided, winRate: winRate(wins, losses) };
}

function classifyCandidate(input: {
  active: boolean;
  decided: number;
  winRate: number | null;
  profit: number;
  avgProfit: number | null;
  wilsonLowerBound: number | null;
  firstSecondGap: number | null;
  recentWinRate: number | null;
  primaryMinSample: number;
  demoMinSample: number;
  strongMinSample: number;
}): Phase16QClassification {
  if (!input.active) return "REJECT";
  if (input.decided < input.primaryMinSample) return "TOO_EARLY";
  if (input.winRate === null || input.avgProfit === null) return "TOO_EARLY";
  if (input.profit <= 0 || input.avgProfit <= 0) return "REJECT";

  const stable = input.firstSecondGap === null || input.firstSecondGap <= 10;
  const recent = input.recentWinRate ?? input.winRate;
  const wilson = input.wilsonLowerBound ?? 0;

  if (
    input.decided >= input.strongMinSample &&
    input.winRate >= 60 &&
    wilson >= 54 &&
    recent >= 60 &&
    stable
  ) {
    return "STRONG_ADOPT";
  }

  if (
    input.decided >= input.demoMinSample &&
    input.winRate >= 58 &&
    wilson >= 52 &&
    recent >= 58 &&
    stable
  ) {
    return "DEMO_CANDIDATE";
  }

  if (
    input.decided >= input.demoMinSample &&
    input.winRate >= 57 &&
    wilson >= 50 &&
    recent >= 56 &&
    stable
  ) {
    return "FORWARD_STRONG";
  }

  if (input.winRate >= 55 && recent >= 54 && stable) return "WATCH";
  return "REJECT";
}

function buildCandidateResult(
  db: Database.Database,
  featureVersion: string,
  definition: Phase16QCandidateDefinition,
  state: CandidateStateRow | undefined,
  options: Required<Phase16QOptions>,
): Phase16QCandidateResult {
  const active = state?.active === 1;
  const rows = active ? loadCountedRows(db, featureVersion, definition.id) : [];
  const stats = statsForRows(rows);
  const profit = round(rows.reduce((sum, row) => sum + row.profit, 0), 4);
  const avgProfit = stats.decided > 0 ? round(profit / stats.decided, 4) : null;
  const wilson = wilsonLowerBound(stats.wins, stats.decided);
  const gap = stats.winRate === null ? null : round(stats.winRate - definition.phase16OWinRate, 2);

  const mid = Math.floor(rows.length / 2);
  const first = statsForRows(rows.slice(0, mid));
  const second = statsForRows(rows.slice(mid));
  const firstSecondGap =
    first.winRate === null || second.winRate === null
      ? null
      : round(Math.abs(first.winRate - second.winRate), 2);

  const recentRows = rows.slice(Math.max(0, rows.length - options.recentWindow));
  const recentStats = statsForRows(recentRows);
  const directionalEdge = stats.winRate === null ? null : round(Math.abs(stats.winRate - 50), 2);
  const stableEnough = firstSecondGap === null || firstSecondGap <= 10;

  const classification = classifyCandidate({
    active,
    decided: stats.decided,
    winRate: stats.winRate,
    profit,
    avgProfit,
    wilsonLowerBound: wilson,
    firstSecondGap,
    recentWinRate: recentStats.winRate,
    primaryMinSample: options.primaryMinSample,
    demoMinSample: options.demoMinSample,
    strongMinSample: options.strongMinSample,
  });

  const message =
    !active
      ? `過去Observation集合が${state?.duplicate_of ?? "別候補"}と高重複のため、独立候補としては停止しました。`
      : classification === "STRONG_ADOPT"
        ? "前向き200件以上で強い採用基準を満たしました。Demo候補比較の最上位です。"
        : classification === "DEMO_CANDIDATE"
          ? "前向き100件以上で勝率・Profit・Wilson下限・直近成績・時系列安定性を満たしました。Demo候補です。"
        : classification === "FORWARD_STRONG"
          ? "前向き検証で優位性が残っています。Demo接続前に追加観察します。"
          : classification === "WATCH"
            ? "利益側の監視候補です。100件到達まで継続評価します。"
            : classification === "TOO_EARLY"
              ? "前向き件数が不足しています。Phase16-Q開始前のデータは成績に混ぜていません。"
              : "前向き検証で利益・勝率・安定性のいずれかが不足しています。";

  return {
    ...definition,
    active,
    duplicateOf: state?.duplicate_of ?? null,
    historicalMatchedObservations: state?.historical_match_count ?? 0,
    matchedObservations: rows.length,
    wins: stats.wins,
    losses: stats.losses,
    draws: stats.draws,
    decided: stats.decided,
    winRate: stats.winRate,
    profit,
    avgProfit,
    wilsonLowerBound: wilson,
    phase16OWinRateGap: gap,
    firstHalfWinRate: first.winRate,
    secondHalfWinRate: second.winRate,
    firstSecondGap,
    recentWinRate: recentStats.winRate,
    recentSample: recentRows.length,
    directionalEdgeFrom50: directionalEdge,
    stableEnough,
    classification,
    message,
  };
}

export function runMarketObservationPhase16QForwardValidation(
  input?: Phase16QOptions,
): Phase16QResultPayload {
  const options = resolveOptions(input);
  const db = openDb(options.dbPath);

  try {
    ensureBaseTableExists(db);
    ensureSchema(db);

    const boundary = getOrCreateBoundary(db, options.featureVersion);
    const dedupPairs = initializeCandidateState(
      db,
      options.featureVersion,
      boundary.boundary_observation_id,
      options.dedupThreshold,
    );
    const states = loadCandidateStates(db, options.featureVersion);
    const newObservationsAfterBoundary = countNewObservations(
      db,
      options.featureVersion,
      boundary.boundary_observation_id,
    );
    const newlyCounted = countNewMatches(
      db,
      options.featureVersion,
      boundary.boundary_observation_id,
      states,
    );

    const candidates = CANDIDATES.map((definition) =>
      buildCandidateResult(
        db,
        options.featureVersion,
        definition,
        states.find((state) => state.candidate_id === definition.id),
        options,
      ),
    );

    const countClass = (classification: Phase16QClassification): number =>
      candidates.filter((candidate) => candidate.classification === classification).length;

    return {
      ok: true,
      stage: "market_observation_phase16_q_forward_validation",
      generatedAt: new Date().toISOString(),
      dbPath: options.dbPath,
      tableName: TABLE_NAME,
      stateTableName: STATE_TABLE_NAME,
      countedTableName: COUNTED_TABLE_NAME,
      candidateStateTableName: CANDIDATE_STATE_TABLE_NAME,
      featureVersion: options.featureVersion,
      boundary: {
        featureVersion: boundary.feature_version,
        phase: boundary.phase,
        startedAt: new Date(boundary.started_at_ms).toISOString(),
        startedAtMs: boundary.started_at_ms,
        boundaryObservationId: boundary.boundary_observation_id,
        boundaryEpoch: boundary.boundary_epoch,
        boundaryIso:
          boundary.boundary_epoch === null
            ? null
            : new Date(boundary.boundary_epoch * 1000).toISOString(),
      },
      newObservationsAfterBoundary,
      newlyCounted,
      dedupThreshold: options.dedupThreshold,
      dedupPairs,
      activeCandidateIds: candidates.filter((candidate) => candidate.active).map((candidate) => candidate.id),
      candidates,
      summary: {
        totalCandidates: candidates.length,
        activeCandidates: candidates.filter((candidate) => candidate.active).length,
        strongAdopt: countClass("STRONG_ADOPT"),
        demoCandidate: countClass("DEMO_CANDIDATE"),
        forwardStrong: countClass("FORWARD_STRONG"),
        watch: countClass("WATCH"),
        tooEarly: countClass("TOO_EARLY"),
        reject: countClass("REJECT"),
      },
      message:
        "Phase16-O候補を過去Observation集合で重複排除し、Phase16-Q開始後の新規market_observationsだけで前向き検証しました。Trading Engine / Demo Buyには接続していません。",
    };
  } finally {
    db.close();
  }
}
