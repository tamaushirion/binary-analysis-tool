import Database from "better-sqlite3";
import path from "path";

export type TradeDirection = "HIGH" | "LOW";

export type ScorePerformanceBreakdown = {
  label: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
  avgProfit: number;
};

export type ScorePerformanceAdjustment = {
  originalScore: number;
  adjustedScore: number;
  adjustment: number;
  scoreBand: string;
  sampleSize: number;
  winRate: number | null;
  confidence: "high" | "medium" | "low" | "none";
  reasons: string[];
};

const DB_PATH = path.join(process.cwd(), "data", "ai.db");
const MIN_SAMPLE_SIZE = 10;
const STRONG_SAMPLE_SIZE = 30;

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function getScoreBand(score: number) {
  const safeScore = clampScore(score);

  if (safeScore < 70) return "0-69";
  if (safeScore < 80) return "70-79";
  if (safeScore < 90) return "80-89";
  return "90-100";
}

function getScoreColumnName(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(trade_history)").all() as Array<{
    name: string;
  }>;

  const names = columns.map((column) => column.name);

  if (names.includes("finalScore")) return "finalScore";
  if (names.includes("final_score")) return "final_score";
  if (names.includes("score")) return "score";

  return null;
}

function getProfitColumnName(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(trade_history)").all() as Array<{
    name: string;
  }>;

  const names = columns.map((column) => column.name);

  if (names.includes("profit")) return "profit";
  if (names.includes("pnl")) return "pnl";

  return null;
}

function getResultWhereClause() {
  return `
    (
      result = 'WIN'
      OR result = 'LOSE'
      OR status = 'WIN'
      OR status = 'LOSE'
      OR outcome = 'WIN'
      OR outcome = 'LOSE'
    )
  `;
}

function getWinCaseSql() {
  return `
    CASE
      WHEN result = 'WIN' THEN 1
      WHEN status = 'WIN' THEN 1
      WHEN outcome = 'WIN' THEN 1
      ELSE 0
    END
  `;
}

function getLoseCaseSql() {
  return `
    CASE
      WHEN result = 'LOSE' THEN 1
      WHEN status = 'LOSE' THEN 1
      WHEN outcome = 'LOSE' THEN 1
      ELSE 0
    END
  `;
}

function buildScoreBandCase(scoreColumn: string) {
  return `
    CASE
      WHEN ${scoreColumn} IS NULL THEN 'unknown'
      WHEN ${scoreColumn} < 70 THEN '0-69'
      WHEN ${scoreColumn} < 80 THEN '70-79'
      WHEN ${scoreColumn} < 90 THEN '80-89'
      ELSE '90-100'
    END
  `;
}

export function getScorePerformanceBreakdowns(limit = 100): ScorePerformanceBreakdown[] {
  const db = new Database(DB_PATH, { readonly: true });

  try {
    const scoreColumn = getScoreColumnName(db);
    const profitColumn = getProfitColumnName(db);

    if (!scoreColumn) return [];

    const scoreBandCase = buildScoreBandCase(scoreColumn);
    const profitSql = profitColumn ? `COALESCE(${profitColumn}, 0)` : "0";

    const rows = db
      .prepare(
        `
          WITH recent_trades AS (
            SELECT *
            FROM trade_history
            WHERE ${getResultWhereClause()}
            ORDER BY id DESC
            LIMIT ?
          )
          SELECT
            ${scoreBandCase} AS label,
            COUNT(*) AS totalTrades,
            SUM(${getWinCaseSql()}) AS wins,
            SUM(${getLoseCaseSql()}) AS losses,
            ROUND(SUM(${getWinCaseSql()}) * 100.0 / COUNT(*), 2) AS winRate,
            ROUND(SUM(${profitSql}), 4) AS totalProfit,
            ROUND(SUM(${profitSql}) * 1.0 / COUNT(*), 4) AS avgProfit
          FROM recent_trades
          WHERE ${scoreColumn} IS NOT NULL
          GROUP BY label
          ORDER BY winRate DESC, totalTrades DESC
        `
      )
      .all(limit) as ScorePerformanceBreakdown[];

    return rows;
  } catch (error) {
    console.error("scorePerformanceAdjuster error", error);
    return [];
  } finally {
    db.close();
  }
}

function calcAdjustment(winRate: number, sampleSize: number) {
  if (sampleSize < MIN_SAMPLE_SIZE) return 0;

  const samplePower = sampleSize >= STRONG_SAMPLE_SIZE ? 1 : 0.5;

  if (winRate >= 65) return Math.round(8 * samplePower);
  if (winRate >= 60) return Math.round(5 * samplePower);
  if (winRate >= 56) return Math.round(3 * samplePower);
  if (winRate >= 52) return 0;
  if (winRate >= 48) return Math.round(-3 * samplePower);
  if (winRate >= 44) return Math.round(-6 * samplePower);
  return Math.round(-10 * samplePower);
}

function getConfidence(sampleSize: number): ScorePerformanceAdjustment["confidence"] {
  if (sampleSize >= STRONG_SAMPLE_SIZE) return "high";
  if (sampleSize >= MIN_SAMPLE_SIZE) return "medium";
  if (sampleSize > 0) return "low";
  return "none";
}

export function adjustScoreByPerformance(score: number): ScorePerformanceAdjustment {
  const originalScore = clampScore(score);
  const scoreBand = getScoreBand(originalScore);
  const breakdowns = getScorePerformanceBreakdowns(100);
  const matched = breakdowns.find((item) => item.label === scoreBand);

  if (!matched) {
    return {
      originalScore,
      adjustedScore: originalScore,
      adjustment: 0,
      scoreBand,
      sampleSize: 0,
      winRate: null,
      confidence: "none",
      reasons: [
        `Score帯${scoreBand}: 実績データなし`,
        "補正なし",
      ],
    };
  }

  const adjustment = calcAdjustment(matched.winRate, matched.totalTrades);
  const adjustedScore = clampScore(originalScore + adjustment);
  const confidence = getConfidence(matched.totalTrades);

  const reasons = [
    `Score帯${scoreBand}: ${matched.totalTrades}件 / 勝率${matched.winRate}%`,
    confidence === "high"
      ? "サンプル十分: 補正を強めに反映"
      : confidence === "medium"
      ? "サンプル中: 補正を控えめに反映"
      : "サンプル不足: 補正なし",
    adjustment > 0
      ? `実績良好のため +${adjustment}点補正`
      : adjustment < 0
      ? `実績悪化のため ${adjustment}点補正`
      : "実績が中立またはサンプル不足のため補正なし",
  ];

  return {
    originalScore,
    adjustedScore,
    adjustment,
    scoreBand,
    sampleSize: matched.totalTrades,
    winRate: matched.winRate,
    confidence,
    reasons,
  };
}
