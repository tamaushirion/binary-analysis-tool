import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type ForwardValidationDirection = "HIGH";
export type ForwardValidationTradeResult = "WIN" | "LOST" | "DRAW";
export type ForwardValidationCandidateId = "phase16_m_high_win" | "phase16_m_balanced" | "phase16_m_high_frequency";
export type ForwardValidationClassification =
  | "FORWARD_STRONG"
  | "PROFIT_EDGE"
  | "WATCH"
  | "TOO_EARLY"
  | "REJECT";

export type MarketObservationForwardValidationOptions = {
  dbPath?: string;
  featureVersion?: string;
  minSample?: number;
  strongMinSample?: number;
  recentWindow?: number;
};

export type MarketObservationForwardValidationCandidate = {
  id: ForwardValidationCandidateId;
  name: string;
  direction: ForwardValidationDirection;
  conditionLabel: string;
  phase16MPastSample: number;
  phase16MPastWinRate: number;
  phase16MPastProfit: number;
};

export type MarketObservationForwardValidationCandidateResult = MarketObservationForwardValidationCandidate & {
  matchedObservations: number;
  wins: number;
  losses: number;
  draws: number;
  decided: number;
  winRate: number | null;
  profit: number;
  avgProfit: number | null;
  wilsonLowerBound: number | null;
  phase16MWinRateGap: number | null;
  firstHalfWinRate: number | null;
  secondHalfWinRate: number | null;
  firstSecondGap: number | null;
  recentWinRate: number | null;
  recentSample: number;
  directionalEdgeFrom50: number | null;
  profitEdge: boolean;
  stableEnough: boolean;
  classification: ForwardValidationClassification;
  message: string;
};

export type MarketObservationForwardValidationBoundary = {
  featureVersion: string;
  startedAt: string;
  startedAtMs: number;
  boundaryObservationId: number;
  boundaryEpoch: number | null;
  boundaryIso: string | null;
};

export type MarketObservationForwardValidationResult = {
  ok: true;
  stage: "market_observation_forward_validation";
  generatedAt: string;
  dbPath: string;
  tableName: "market_observations";
  stateTableName: "market_observation_forward_validation_state";
  countedTableName: "market_observation_forward_validation_counts";
  featureVersion: string;
  boundary: MarketObservationForwardValidationBoundary;
  newObservationsAfterBoundary: number;
  newlyCounted: number;
  candidates: MarketObservationForwardValidationCandidateResult[];
  summary: {
    totalCandidates: number;
    forwardStrong: number;
    profitEdge: number;
    watch: number;
    tooEarly: number;
    reject: number;
  };
  message: string;
};

type StateRow = {
  feature_version: string;
  started_at_ms: number;
  boundary_observation_id: number;
  boundary_epoch: number | null;
};

type ObservationRow = {
  id: number;
  epoch: number | null;
  high_result: string | null;
  high_profit: number | null;
  rci52: number | null;
  smc_score: number | null;
  low_score: number | null;
  feature_version: string | null;
};

type CountRow = { count: number };
type BoundaryRow = { max_id: number | null; max_epoch: number | null };
type CountedRow = {
  candidate_id: ForwardValidationCandidateId;
  observation_id: number;
  epoch: number | null;
  result: ForwardValidationTradeResult;
  profit: number;
};

const TABLE_NAME = "market_observations" as const;
const STATE_TABLE_NAME = "market_observation_forward_validation_state" as const;
const COUNTED_TABLE_NAME = "market_observation_forward_validation_counts" as const;
const DEFAULT_FEATURE_VERSION = "phase16-k-market-observation-v1";
const PHASE = "phase16-n-market-observation-forward-validation";

const CANDIDATES: MarketObservationForwardValidationCandidate[] = [
  {
    id: "phase16_m_high_win",
    name: "高勝率型",
    direction: "HIGH",
    conditionLabel: "RCI52:NEUTRAL(-49-49) × SMCScore:0-9 × HIGH",
    phase16MPastSample: 83,
    phase16MPastWinRate: 70.73,
    phase16MPastProfit: 29.36,
  },
  {
    id: "phase16_m_balanced",
    name: "バランス型",
    direction: "HIGH",
    conditionLabel: "RCI52:NEUTRAL(-49-49) × SMCScore:0-9 × HIGH",
    phase16MPastSample: 116,
    phase16MPastWinRate: 67.83,
    phase16MPastProfit: 34.76,
  },
  {
    id: "phase16_m_high_frequency",
    name: "高頻度型",
    direction: "HIGH",
    conditionLabel: "LowScore:40-49 × RCI52:NEUTRAL(-49-49) × HIGH",
    phase16MPastSample: 199,
    phase16MPastWinRate: 61.62,
    phase16MPastProfit: 36.24,
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

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeResult(value: string | null): ForwardValidationTradeResult | null {
  if (value === "WIN" || value === "LOST" || value === "DRAW") return value;
  return null;
}

function winRate(wins: number, losses: number): number | null {
  const decided = wins + losses;
  if (decided <= 0) return null;
  return round((wins / decided) * 100, 2);
}

function wilsonLowerBound(wins: number, total: number, z = 1.96): number | null {
  if (total <= 0) return null;
  const p = wins / total;
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return round(((centre - margin) / denom) * 100, 2);
}

function epochToIso(epoch: number | null): string | null {
  if (epoch === null) return null;
  return new Date(epoch * 1000).toISOString();
}

function ensureBaseTableExists(db: Database.Database): void {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(TABLE_NAME) as { name?: string } | undefined;
  if (!row?.name) throw new Error("market_observations table not found in SQLite database.");
}

function ensureForwardValidationSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${STATE_TABLE_NAME} (
      feature_version TEXT PRIMARY KEY,
      phase TEXT NOT NULL,
      started_at_ms INTEGER NOT NULL,
      boundary_observation_id INTEGER NOT NULL,
      boundary_epoch INTEGER,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ${COUNTED_TABLE_NAME} (
      candidate_id TEXT NOT NULL,
      observation_id INTEGER NOT NULL,
      feature_version TEXT NOT NULL,
      epoch INTEGER,
      direction TEXT NOT NULL,
      result TEXT NOT NULL,
      profit REAL NOT NULL,
      counted_at_ms INTEGER NOT NULL,
      PRIMARY KEY (candidate_id, observation_id, feature_version)
    );

    CREATE INDEX IF NOT EXISTS idx_market_observation_forward_counts_candidate
      ON ${COUNTED_TABLE_NAME} (feature_version, candidate_id, epoch, observation_id);
  `);
}

function getOrCreateBoundary(db: Database.Database, featureVersion: string): StateRow {
  const existing = db
    .prepare(`SELECT * FROM ${STATE_TABLE_NAME} WHERE feature_version = ?`)
    .get(featureVersion) as StateRow | undefined;
  if (existing) return existing;

  const boundary = db
    .prepare(`SELECT MAX(id) as max_id, MAX(epoch) as max_epoch FROM ${TABLE_NAME} WHERE feature_version = ?`)
    .get(featureVersion) as BoundaryRow;
  const now = Date.now();
  const state: StateRow = {
    feature_version: featureVersion,
    started_at_ms: now,
    boundary_observation_id: boundary.max_id ?? 0,
    boundary_epoch: boundary.max_epoch ?? null,
  };
  db.prepare(`
    INSERT INTO ${STATE_TABLE_NAME} (
      feature_version,
      phase,
      started_at_ms,
      boundary_observation_id,
      boundary_epoch,
      created_at_ms,
      updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(featureVersion, PHASE, now, state.boundary_observation_id, state.boundary_epoch, now, now);
  return state;
}

function isRci52Neutral(value: number | null): boolean {
  return value !== null && value >= -49 && value < 50;
}

function isSmcScoreZeroToNine(value: number | null): boolean {
  return value !== null && value >= 0 && value < 10;
}

function isLowScoreFortyToFortyNine(value: number | null): boolean {
  return value !== null && value >= 40 && value < 50;
}

function matchesCandidate(candidateId: ForwardValidationCandidateId, row: ObservationRow): boolean {
  if (candidateId === "phase16_m_high_win" || candidateId === "phase16_m_balanced") {
    return isRci52Neutral(numberOrNull(row.rci52)) && isSmcScoreZeroToNine(numberOrNull(row.smc_score));
  }
  if (candidateId === "phase16_m_high_frequency") {
    return isRci52Neutral(numberOrNull(row.rci52)) && isLowScoreFortyToFortyNine(numberOrNull(row.low_score));
  }
  return false;
}

function loadNewRows(db: Database.Database, featureVersion: string, boundaryObservationId: number): ObservationRow[] {
  return db.prepare(`
    SELECT
      id,
      epoch,
      high_result,
      high_profit,
      rci52,
      smc_score,
      low_score,
      feature_version
    FROM ${TABLE_NAME}
    WHERE feature_version = ?
      AND id > ?
      AND high_result IN ('WIN', 'LOST', 'DRAW')
    ORDER BY id ASC
  `).all(featureVersion, boundaryObservationId) as ObservationRow[];
}

function countNewRows(db: Database.Database, featureVersion: string, boundaryObservationId: number): number {
  const row = db.prepare(`
    SELECT COUNT(*) as count
    FROM ${TABLE_NAME}
    WHERE feature_version = ?
      AND id > ?
      AND high_result IN ('WIN', 'LOST', 'DRAW')
  `).get(featureVersion, boundaryObservationId) as CountRow;
  return row.count;
}

function countForwardMatches(db: Database.Database, featureVersion: string, boundaryObservationId: number): number {
  const rows = loadNewRows(db, featureVersion, boundaryObservationId);
  let matched = 0;
  for (const row of rows) {
    if (CANDIDATES.some((candidate) => matchesCandidate(candidate.id, row))) matched += 1;
  }
  return matched;
}

function persistCandidateMatches(db: Database.Database, featureVersion: string, rows: ObservationRow[]): number {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO ${COUNTED_TABLE_NAME} (
      candidate_id,
      observation_id,
      feature_version,
      epoch,
      direction,
      result,
      profit,
      counted_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let newlyCounted = 0;
  const now = Date.now();
  const transaction = db.transaction((items: ObservationRow[]) => {
    for (const row of items) {
      const result = normalizeResult(row.high_result);
      if (!result) continue;
      const profit = numberOrNull(row.high_profit) ?? 0;
      for (const candidate of CANDIDATES) {
        if (!matchesCandidate(candidate.id, row)) continue;
        const info = insert.run(candidate.id, row.id, featureVersion, row.epoch, candidate.direction, result, profit, now);
        if (info.changes > 0) newlyCounted += 1;
      }
    }
  });
  transaction(rows);
  return newlyCounted;
}

function loadCountedRows(db: Database.Database, featureVersion: string, candidateId: ForwardValidationCandidateId): CountedRow[] {
  return db.prepare(`
    SELECT candidate_id, observation_id, epoch, result, profit
    FROM ${COUNTED_TABLE_NAME}
    WHERE feature_version = ?
      AND candidate_id = ?
    ORDER BY observation_id ASC
  `).all(featureVersion, candidateId) as CountedRow[];
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
    if (row.result === "LOST") losses += 1;
    if (row.result === "DRAW") draws += 1;
  }
  const decided = wins + losses;
  return { wins, losses, draws, decided, winRate: winRate(wins, losses) };
}

function rateForSlice(rows: CountedRow[]): number | null {
  return statsForRows(rows).winRate;
}

function classifyCandidate(input: {
  matchedObservations: number;
  decided: number;
  winRate: number | null;
  profit: number;
  avgProfit: number | null;
  wilsonLowerBound: number | null;
  directionalEdgeFrom50: number | null;
  firstSecondGap: number | null;
  recentWinRate: number | null;
  minSample: number;
  strongMinSample: number;
}): ForwardValidationClassification {
  if (input.decided < input.minSample) return "TOO_EARLY";
  if (input.winRate === null || input.avgProfit === null || input.directionalEdgeFrom50 === null) return "TOO_EARLY";
  if (input.profit <= 0 || input.avgProfit <= 0) return "REJECT";

  const stableEnough = input.firstSecondGap === null || input.firstSecondGap <= 18;
  const recentOkay = input.recentWinRate === null || input.recentWinRate >= 50;
  const wilson = input.wilsonLowerBound ?? 0;

  if (
    input.decided >= input.strongMinSample &&
    input.winRate >= 66 &&
    wilson >= 55 &&
    stableEnough &&
    recentOkay
  ) {
    return "FORWARD_STRONG";
  }

  if (input.directionalEdgeFrom50 >= 10 && stableEnough && recentOkay) return "PROFIT_EDGE";
  if (input.winRate >= 56 && stableEnough) return "WATCH";
  return "REJECT";
}

function buildCandidateResult(
  db: Database.Database,
  featureVersion: string,
  candidate: MarketObservationForwardValidationCandidate,
  minSample: number,
  strongMinSample: number,
  recentWindow: number,
): MarketObservationForwardValidationCandidateResult {
  const rows = loadCountedRows(db, featureVersion, candidate.id);
  const baseStats = statsForRows(rows);
  const profit = round(rows.reduce((sum, row) => sum + row.profit, 0), 4);
  const avgProfit = baseStats.decided > 0 ? round(profit / baseStats.decided, 4) : null;
  const wilson = wilsonLowerBound(baseStats.wins, baseStats.decided);
  const phase16MWinRateGap = baseStats.winRate === null ? null : round(baseStats.winRate - candidate.phase16MPastWinRate, 2);
  const mid = Math.floor(rows.length / 2);
  const firstHalf = rows.slice(0, mid);
  const secondHalf = rows.slice(mid);
  const firstHalfWinRate = rateForSlice(firstHalf);
  const secondHalfWinRate = rateForSlice(secondHalf);
  const firstSecondGap = firstHalfWinRate === null || secondHalfWinRate === null ? null : round(Math.abs(firstHalfWinRate - secondHalfWinRate), 2);
  const recentRows = rows.slice(Math.max(0, rows.length - recentWindow));
  const recentWinRate = rateForSlice(recentRows);
  const directionalEdgeFrom50 = baseStats.winRate === null ? null : round(Math.abs(baseStats.winRate - 50), 2);
  const profitEdge = profit > 0 && avgProfit !== null && avgProfit > 0;
  const stableEnough = firstSecondGap === null || firstSecondGap <= 18;
  const classification = classifyCandidate({
    matchedObservations: rows.length,
    decided: baseStats.decided,
    winRate: baseStats.winRate,
    profit,
    avgProfit,
    wilsonLowerBound: wilson,
    directionalEdgeFrom50,
    firstSecondGap,
    recentWinRate,
    minSample,
    strongMinSample,
  });

  return {
    ...candidate,
    matchedObservations: rows.length,
    wins: baseStats.wins,
    losses: baseStats.losses,
    draws: baseStats.draws,
    decided: baseStats.decided,
    winRate: baseStats.winRate,
    profit,
    avgProfit,
    wilsonLowerBound: wilson,
    phase16MWinRateGap,
    firstHalfWinRate,
    secondHalfWinRate,
    firstSecondGap,
    recentWinRate,
    recentSample: recentRows.length,
    directionalEdgeFrom50,
    profitEdge,
    stableEnough,
    classification,
    message:
      classification === "TOO_EARLY"
        ? "前向き検証の件数がまだ不足しています。Phase16-M以前のデータは混ぜていません。"
        : classification === "FORWARD_STRONG"
          ? "前向きデータでも強い候補です。ただしDemo接続前に継続観察します。"
          : classification === "PROFIT_EDGE"
            ? "勝率70%未満でもProfitと50%からの距離が残っている候補です。"
            : classification === "WATCH"
              ? "監視継続候補です。件数・直近安定性・Wilson下限の改善を確認します。"
              : "前向き検証では優位性が弱い、またはProfit/安定性が不足しています。",
  };
}

function resolveOptions(input?: MarketObservationForwardValidationOptions): Required<MarketObservationForwardValidationOptions> {
  return {
    dbPath: resolveDbPath(input?.dbPath),
    featureVersion: input?.featureVersion?.trim() || DEFAULT_FEATURE_VERSION,
    minSample: typeof input?.minSample === "number" && Number.isFinite(input.minSample) ? input.minSample : 30,
    strongMinSample: typeof input?.strongMinSample === "number" && Number.isFinite(input.strongMinSample) ? input.strongMinSample : 80,
    recentWindow: typeof input?.recentWindow === "number" && Number.isFinite(input.recentWindow) ? input.recentWindow : 30,
  };
}

export function runMarketObservationForwardValidation(
  input?: MarketObservationForwardValidationOptions,
): MarketObservationForwardValidationResult {
  const options = resolveOptions(input);
  const db = openDb(options.dbPath);
  try {
    ensureBaseTableExists(db);
    ensureForwardValidationSchema(db);
    const state = getOrCreateBoundary(db, options.featureVersion);
    const newRows = loadNewRows(db, options.featureVersion, state.boundary_observation_id);
    const newlyCounted = persistCandidateMatches(db, options.featureVersion, newRows);
    const candidates = CANDIDATES.map((candidate) =>
      buildCandidateResult(db, options.featureVersion, candidate, options.minSample, options.strongMinSample, options.recentWindow),
    );
    const classCount = (classification: ForwardValidationClassification) =>
      candidates.filter((candidate) => candidate.classification === classification).length;

    return {
      ok: true,
      stage: "market_observation_forward_validation",
      generatedAt: new Date().toISOString(),
      dbPath: options.dbPath,
      tableName: TABLE_NAME,
      stateTableName: STATE_TABLE_NAME,
      countedTableName: COUNTED_TABLE_NAME,
      featureVersion: options.featureVersion,
      boundary: {
        featureVersion: state.feature_version,
        startedAt: new Date(state.started_at_ms).toISOString(),
        startedAtMs: state.started_at_ms,
        boundaryObservationId: state.boundary_observation_id,
        boundaryEpoch: state.boundary_epoch,
        boundaryIso: epochToIso(state.boundary_epoch),
      },
      newObservationsAfterBoundary: countNewRows(db, options.featureVersion, state.boundary_observation_id),
      newlyCounted,
      candidates,
      summary: {
        totalCandidates: candidates.length,
        forwardStrong: classCount("FORWARD_STRONG"),
        profitEdge: classCount("PROFIT_EDGE"),
        watch: classCount("WATCH"),
        tooEarly: classCount("TOO_EARLY"),
        reject: classCount("REJECT"),
      },
      message:
        countForwardMatches(db, options.featureVersion, state.boundary_observation_id) === 0
          ? "Phase16-N境界は保存済みです。まだ前向き候補に一致する新規Observationはありません。Trading Engine / Demo Buyには接続していません。"
          : "Phase16-N開始後の新規market_observationsだけで前向き検証しました。Trading Engine / Demo Buyには接続していません。",
    };
  } finally {
    db.close();
  }
}
