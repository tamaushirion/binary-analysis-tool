import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { SyntheticObservationFeature } from "@/lib/market/derivSyntheticFeatureProvider";

export type MarketObservationResult = "WIN" | "LOST" | "DRAW";
export type MarketObservationDirection = "HIGH" | "LOW";

export type MarketObservationOptions = {
  dbPath?: string;
  limit?: number;
};

export type MarketObservationRecord = {
  id: number;
  pair: string;
  deriv_symbol: string;
  epoch: number;
  exit_epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
  exit_close: number;
  high_result: MarketObservationResult;
  low_result: MarketObservationResult;
  high_profit: number;
  low_profit: number;
  high_score: number | null;
  low_score: number | null;
  selected_score: number | null;
  selected_direction: MarketObservationDirection | null;
  ema9: number | null;
  ema21: number | null;
  ema_diff: number | null;
  rci9: number | null;
  rci26: number | null;
  rci52: number | null;
  atr: number | null;
  trend: string | null;
  session: string | null;
  hour: number | null;
  weekday: number | null;
  bos: number | null;
  choch: number | null;
  fvg: number | null;
  smc_score: number | null;
  backtest_win_rate_1m: number | null;
  backtest_win_rate_3m: number | null;
  feature_version: string;
  ai_version: string;
  feature_snapshot: string;
  source: string;
  created_at: number;
  updated_at: number;
};

export type MarketObservationSummary = {
  generatedAt: string;
  dbPath: string;
  tableName: string;
  totalRecords: number;
  latestEpoch: number | null;
  inserted?: number;
  skippedDuplicates?: number;
  recent: MarketObservationRecord[];
  stats: {
    highWins: number;
    highLosses: number;
    highDraws: number;
    highWinRate: number | null;
    lowWins: number;
    lowLosses: number;
    lowDraws: number;
    lowWinRate: number | null;
  };
  message: string;
};

type CountRow = { count: number };
type LatestRow = { latest_epoch: number | null };
type StatRow = {
  high_wins: number | null;
  high_losses: number | null;
  high_draws: number | null;
  low_wins: number | null;
  low_losses: number | null;
  low_draws: number | null;
};

const DB_RELATIVE_PATH = path.join("data", "ai.db");
const TABLE_NAME = "market_observations";
const SOURCE = "server_auto_runner_phase16_k_market_observation";
const FEATURE_VERSION = "phase16-k-market-observation-v1";
const AI_VERSION = "phase16-k-market-observation";

function projectRoot() {
  return process.cwd();
}

function defaultDbPath() {
  return path.join(projectRoot(), DB_RELATIVE_PATH);
}

function resolveDbPath(input?: string) {
  return input ? path.resolve(input) : defaultDbPath();
}

function openDb(options?: MarketObservationOptions) {
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

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function boolToFlag(value: unknown): number | null {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" && Number.isFinite(value)) return value ? 1 : 0;
  return null;
}

function normalizeDirection(value: unknown): MarketObservationDirection | null {
  if (value === "HIGH" || value === "LOW") return value;
  return null;
}

function normalizeResult(value: unknown): MarketObservationResult {
  if (value === "WIN" || value === "LOST" || value === "DRAW") return value;
  return "DRAW";
}

function hourUtc(epoch: number) {
  return new Date(epoch * 1000).getUTCHours();
}

function weekdayUtc(epoch: number) {
  return new Date(epoch * 1000).getUTCDay();
}

function inferSession(hour: number) {
  if (hour >= 0 && hour < 7) return "TOKYO";
  if (hour >= 7 && hour < 13) return "LONDON";
  if (hour >= 13 && hour < 22) return "NEW_YORK";
  return "OFF_HOURS";
}

function ensureSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pair TEXT NOT NULL,
      deriv_symbol TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      exit_epoch INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      exit_close REAL NOT NULL,
      high_result TEXT NOT NULL,
      low_result TEXT NOT NULL,
      high_profit REAL NOT NULL,
      low_profit REAL NOT NULL,
      high_score REAL,
      low_score REAL,
      selected_score REAL,
      selected_direction TEXT,
      ema9 REAL,
      ema21 REAL,
      ema_diff REAL,
      rci9 REAL,
      rci26 REAL,
      rci52 REAL,
      atr REAL,
      trend TEXT,
      session TEXT,
      hour INTEGER,
      weekday INTEGER,
      bos INTEGER,
      choch INTEGER,
      fvg INTEGER,
      smc_score REAL,
      backtest_win_rate_1m REAL,
      backtest_win_rate_3m REAL,
      feature_version TEXT NOT NULL,
      ai_version TEXT NOT NULL,
      feature_snapshot TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_market_observations_unique_epoch
      ON ${TABLE_NAME} (pair, deriv_symbol, epoch, feature_version);

    CREATE INDEX IF NOT EXISTS idx_market_observations_epoch
      ON ${TABLE_NAME} (epoch);

    CREATE INDEX IF NOT EXISTS idx_market_observations_feature_version
      ON ${TABLE_NAME} (feature_version, epoch);
  `);
}

function rowToRecord(row: unknown): MarketObservationRecord {
  const record = row as MarketObservationRecord;
  return {
    ...record,
    high_result: normalizeResult(record.high_result),
    low_result: normalizeResult(record.low_result),
    selected_direction: normalizeDirection(record.selected_direction),
  };
}

function latestEpoch(db: Database.Database) {
  const row = db.prepare(`SELECT MAX(epoch) as latest_epoch FROM ${TABLE_NAME}`).get() as LatestRow;
  return row.latest_epoch;
}

function countRows(db: Database.Database) {
  const row = db.prepare(`SELECT COUNT(*) as count FROM ${TABLE_NAME}`).get() as CountRow;
  return row.count;
}

function buildStats(db: Database.Database) {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN high_result = 'WIN' THEN 1 ELSE 0 END) as high_wins,
      SUM(CASE WHEN high_result = 'LOST' THEN 1 ELSE 0 END) as high_losses,
      SUM(CASE WHEN high_result = 'DRAW' THEN 1 ELSE 0 END) as high_draws,
      SUM(CASE WHEN low_result = 'WIN' THEN 1 ELSE 0 END) as low_wins,
      SUM(CASE WHEN low_result = 'LOST' THEN 1 ELSE 0 END) as low_losses,
      SUM(CASE WHEN low_result = 'DRAW' THEN 1 ELSE 0 END) as low_draws
    FROM ${TABLE_NAME}
  `).get() as StatRow;
  const highWins = row.high_wins ?? 0;
  const highLosses = row.high_losses ?? 0;
  const highDraws = row.high_draws ?? 0;
  const lowWins = row.low_wins ?? 0;
  const lowLosses = row.low_losses ?? 0;
  const lowDraws = row.low_draws ?? 0;
  const highDecided = highWins + highLosses;
  const lowDecided = lowWins + lowLosses;
  return {
    highWins,
    highLosses,
    highDraws,
    highWinRate: highDecided > 0 ? round((highWins / highDecided) * 100, 2) : null,
    lowWins,
    lowLosses,
    lowDraws,
    lowWinRate: lowDecided > 0 ? round((lowWins / lowDecided) * 100, 2) : null,
  };
}

export function recordMarketObservations(
  observations: SyntheticObservationFeature[],
  options?: MarketObservationOptions,
): MarketObservationSummary {
  const dbPath = resolveDbPath(options?.dbPath);
  const db = openDb(options);
  const createdAt = nowMs();
  try {
    ensureSchema(db);
    const latest = latestEpoch(db);
    const insert = db.prepare(`
      INSERT OR IGNORE INTO ${TABLE_NAME} (
        pair,
        deriv_symbol,
        epoch,
        exit_epoch,
        open,
        high,
        low,
        close,
        exit_close,
        high_result,
        low_result,
        high_profit,
        low_profit,
        high_score,
        low_score,
        selected_score,
        selected_direction,
        ema9,
        ema21,
        ema_diff,
        rci9,
        rci26,
        rci52,
        atr,
        trend,
        session,
        hour,
        weekday,
        bos,
        choch,
        fvg,
        smc_score,
        backtest_win_rate_1m,
        backtest_win_rate_3m,
        feature_version,
        ai_version,
        feature_snapshot,
        source,
        created_at,
        updated_at
      ) VALUES (
        @pair,
        @deriv_symbol,
        @epoch,
        @exit_epoch,
        @open,
        @high,
        @low,
        @close,
        @exit_close,
        @high_result,
        @low_result,
        @high_profit,
        @low_profit,
        @high_score,
        @low_score,
        @selected_score,
        @selected_direction,
        @ema9,
        @ema21,
        @ema_diff,
        @rci9,
        @rci26,
        @rci52,
        @atr,
        @trend,
        @session,
        @hour,
        @weekday,
        @bos,
        @choch,
        @fvg,
        @smc_score,
        @backtest_win_rate_1m,
        @backtest_win_rate_3m,
        @feature_version,
        @ai_version,
        @feature_snapshot,
        @source,
        @created_at,
        @updated_at
      )
    `);

    let inserted = 0;
    let skippedDuplicates = 0;
    const transaction = db.transaction((items: SyntheticObservationFeature[]) => {
      for (const item of items) {
        if (latest !== null && item.candle.time <= latest) {
          skippedDuplicates += 1;
          continue;
        }
        const hour = hourUtc(item.candle.time);
        const weekday = weekdayUtc(item.candle.time);
        const features = item.features ?? {};
        const result = insert.run({
          pair: item.pair,
          deriv_symbol: item.derivSymbol,
          epoch: item.candle.time,
          exit_epoch: item.exitCandle.time,
          open: item.candle.open,
          high: item.candle.high,
          low: item.candle.low,
          close: item.candle.close,
          exit_close: item.exitCandle.close,
          high_result: item.highResult,
          low_result: item.lowResult,
          high_profit: item.highProfit,
          low_profit: item.lowProfit,
          high_score: numberOrNull(item.highScore),
          low_score: numberOrNull(item.lowScore),
          selected_score: numberOrNull(item.selectedScore),
          selected_direction: normalizeDirection(item.selectedDirection),
          ema9: numberOrNull(features.ema9),
          ema21: numberOrNull(features.ema21),
          ema_diff: numberOrNull(features.emaDiff),
          rci9: numberOrNull(features.rci9),
          rci26: numberOrNull(features.rci26),
          rci52: numberOrNull(features.rci52),
          atr: numberOrNull(features.atr),
          trend: textOrNull(features.trend),
          session: textOrNull(features.session) ?? inferSession(hour),
          hour,
          weekday,
          bos: boolToFlag(features.bos),
          choch: boolToFlag(features.choch),
          fvg: boolToFlag(features.fvg),
          smc_score: numberOrNull(features.smcScore),
          backtest_win_rate_1m: numberOrNull(features.backtestWinRate1m) ?? numberOrNull(features.backtest1mWinRate),
          backtest_win_rate_3m: numberOrNull(features.backtestWinRate3m) ?? numberOrNull(features.backtest3mWinRate),
          feature_version: textOrNull(features.featureVersion) ?? FEATURE_VERSION,
          ai_version: textOrNull(features.aiVersion) ?? AI_VERSION,
          feature_snapshot: JSON.stringify(features),
          source: SOURCE,
          created_at: createdAt,
          updated_at: createdAt,
        });
        if (result.changes > 0) inserted += 1;
        else skippedDuplicates += 1;
      }
    });

    transaction(observations);
    return getMarketObservationSummary({ ...options, limit: options?.limit ?? 20, __inserted: inserted, __skippedDuplicates: skippedDuplicates } as MarketObservationOptions & { __inserted?: number; __skippedDuplicates?: number });
  } finally {
    db.close();
  }
}

export function getMarketObservationSummary(options?: MarketObservationOptions & { __inserted?: number; __skippedDuplicates?: number }): MarketObservationSummary {
  const dbPath = resolveDbPath(options?.dbPath);
  const limit = options?.limit ?? 50;
  const db = openDb(options);
  try {
    ensureSchema(db);
    const recentRows = db.prepare(`SELECT * FROM ${TABLE_NAME} ORDER BY epoch DESC LIMIT ?`).all(limit) as unknown[];
    return {
      generatedAt: new Date().toISOString(),
      dbPath,
      tableName: TABLE_NAME,
      totalRecords: countRows(db),
      latestEpoch: latestEpoch(db),
      inserted: options?.__inserted,
      skippedDuplicates: options?.__skippedDuplicates,
      recent: recentRows.map(rowToRecord),
      stats: buildStats(db),
      message: "Market Observation Datasetの状態です。実Buyなし・確定足のみ・1時点=1観測で保存します。",
    };
  } finally {
    db.close();
  }
}
