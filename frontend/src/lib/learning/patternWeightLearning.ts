import Database from "better-sqlite3";
import path from "path";

export type PatternWeightInput = {
  pair?: string;
  score?: number;
  finalScore?: number;
  weightScore?: number;
  similarityScore?: number;
  direction?: string;
  features?: Record<string, any>;
};

export type PatternSignal = {
  key: string;
  label: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalProfit: number;
  avgProfit: number | null;
  adjustment: number;
  action: "BOOST" | "PENALTY" | "SKIP_CANDIDATE" | "IGNORE";
  confidence: "none" | "low" | "medium" | "high";
  overfitGuard: string[];
};

export type PatternWeightResult = {
  allow: boolean;
  originalScore: number;
  adjustedScore: number;
  totalAdjustment: number;
  signals: PatternSignal[];
  applied: PatternSignal[];
  reasons: string[];
  dbPath: string;
};

function getDbPath() {
  return process.env.SQLITE_DB_PATH || path.join(process.cwd(), "data", "ai.db");
}

function scoreBand(score: any) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "unknown";
  if (n < 70) return "0-69";
  if (n < 80) return "70-79";
  if (n < 90) return "80-89";
  return "90-100";
}


function bandRange(band: string): [number, number] | null {
  if (band === "0-69") return [0, 70];
  if (band === "70-79") return [70, 80];
  if (band === "80-89") return [80, 90];
  if (band === "90-100") return [90, 101];
  return null;
}

function normalizeBool(v: any) {
  if (v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true") return "ON";
  if (v === false || v === 0 || v === "0" || String(v).toLowerCase() === "false") return "OFF";
  return "unknown";
}

function confidence(total: number): PatternSignal["confidence"] {
  if (total >= 50) return "high";
  if (total >= 30) return "medium";
  if (total >= 12) return "low";
  return "none";
}

function safeNumber(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function aggregate(db: Database.Database, where: string, params: any[]): Omit<PatternSignal, "key" | "label" | "adjustment" | "action" | "confidence" | "overfitGuard"> {
  const row = db
    .prepare(
      `SELECT COUNT(*) as totalTrades,
              SUM(CASE WHEN status = 'WON' OR profit > 0 THEN 1 ELSE 0 END) as wins,
              SUM(CASE WHEN status = 'LOST' OR profit < 0 THEN 1 ELSE 0 END) as losses,
              COALESCE(SUM(profit), 0) as totalProfit
       FROM trade_history
       WHERE ${where}`,
    )
    .get(...params) as any;

  const totalTrades = safeNumber(row?.totalTrades);
  const wins = safeNumber(row?.wins);
  const losses = safeNumber(row?.losses);
  const totalProfit = Number(safeNumber(row?.totalProfit).toFixed(4));
  const winRate = totalTrades > 0 ? Number(((wins / totalTrades) * 100).toFixed(2)) : null;
  const avgProfit = totalTrades > 0 ? Number((totalProfit / totalTrades).toFixed(4)) : null;

  return { totalTrades, wins, losses, winRate, totalProfit, avgProfit };
}

const HARD_SKIP_MIN_SAMPLE_STRONG = 30;
const HARD_SKIP_MIN_SAMPLE_PROFIT = 20;
const HARD_SKIP_WIN_RATE_STRONG = 45;
const HARD_SKIP_WIN_RATE_PROFIT = 48;
const HARD_SKIP_TOTAL_PROFIT = -3;

function makeSignal(db: Database.Database, key: string, label: string, where: string, params: any[]): PatternSignal {
  const stats = aggregate(db, where, params);
  const guards: string[] = [];
  const conf = confidence(stats.totalTrades);
  let adjustment = 0;
  let action: PatternSignal["action"] = "IGNORE";

  const hardSkipByWinRate =
    stats.winRate !== null &&
    stats.totalTrades >= HARD_SKIP_MIN_SAMPLE_STRONG &&
    stats.winRate < HARD_SKIP_WIN_RATE_STRONG &&
    stats.totalProfit < 0;

  const hardSkipByProfit =
    stats.winRate !== null &&
    stats.totalTrades >= HARD_SKIP_MIN_SAMPLE_PROFIT &&
    stats.winRate < HARD_SKIP_WIN_RATE_PROFIT &&
    stats.totalProfit <= HARD_SKIP_TOTAL_PROFIT;

  if (stats.totalTrades < 12) {
    guards.push(`サンプル不足: ${stats.totalTrades}件。採用しない`);
  } else if (hardSkipByWinRate || hardSkipByProfit) {
    adjustment = -8;
    action = "SKIP_CANDIDATE";
    guards.push(
      hardSkipByWinRate
        ? `Danger Pattern Hard Gate: ${stats.totalTrades}件 / 勝率${stats.winRate}% / 損益${stats.totalProfit.toFixed(2)} のため強制SKIP`
        : `Danger Pattern Hard Gate: ${stats.totalTrades}件 / 勝率${stats.winRate}% / 損益${stats.totalProfit.toFixed(2)} <= ${HARD_SKIP_TOTAL_PROFIT} のため強制SKIP`
    );
  } else if (stats.winRate !== null && stats.winRate <= 48 && stats.totalProfit < 0) {
    adjustment = stats.totalTrades >= 20 ? -5 : -3;
    action = "PENALTY";
  } else if (stats.totalTrades >= 30 && stats.winRate !== null && stats.winRate >= 62 && stats.totalProfit > 0) {
    adjustment = stats.winRate >= 70 ? 5 : 3;
    action = "BOOST";
  }

  return { key, label, ...stats, confidence: conf, adjustment, action, overfitGuard: guards };
}

export function evaluatePatternWeight(input: PatternWeightInput): PatternWeightResult {
  const dbPath = getDbPath();
  const db = new Database(dbPath, { readonly: true });
  const originalScore = safeNumber(input.finalScore ?? input.score);
  const features = input.features ?? {};

  const score = scoreBand(input.score);
  const finalScore = scoreBand(input.finalScore ?? input.score);
  const weightScore = scoreBand(input.weightScore);
  const similarityScore = scoreBand(input.similarityScore);
  const direction = String(input.direction ?? features.direction ?? "unknown").toUpperCase();
  const weekday = String(features.weekday ?? "unknown");
  const trend = String(features.trend ?? features.emaTrend ?? "unknown").toUpperCase();
  const bos = normalizeBool(features.bos);
  const fvg = normalizeBool(features.fvg);
  const choch = normalizeBool(features.choch);

  const signals: PatternSignal[] = [];

  const scoreRange = bandRange(score);
  const finalScoreRange = bandRange(finalScore);
  const weightScoreRange = bandRange(weightScore);
  const similarityScoreRange = bandRange(similarityScore);

  if (scoreRange && finalScoreRange) {
    signals.push(
      makeSignal(
        db,
        "Score + Final Score",
        `Score:${score} | Final Score:${finalScore}`,
        "score >= ? AND score < ? AND final_score >= ? AND final_score < ?",
        [...scoreRange, ...finalScoreRange],
      ),
    );
  }

  if (direction !== "unknown" && scoreRange) {
    signals.push(
      makeSignal(
        db,
        "Score + Direction",
        `Score:${score} | Direction:${direction}`,
        "score >= ? AND score < ? AND direction = ?",
        [...scoreRange, direction],
      ),
    );
  }

  if (direction !== "unknown" && finalScoreRange) {
    signals.push(
      makeSignal(
        db,
        "Final Score + Direction",
        `Final Score:${finalScore} | Direction:${direction}`,
        "final_score >= ? AND final_score < ? AND direction = ?",
        [...finalScoreRange, direction],
      ),
    );
  }

  if (scoreRange && similarityScoreRange) {
    signals.push(
      makeSignal(
        db,
        "Score + Similarity Score",
        `Score:${score} | Similarity Score:${similarityScore}`,
        "score >= ? AND score < ? AND similarity_score >= ? AND similarity_score < ?",
        [...scoreRange, ...similarityScoreRange],
      ),
    );
  }

  if (weekday !== "unknown" && weightScoreRange) {
    signals.push(
      makeSignal(
        db,
        "Weight Score + Weekday",
        `Weight Score:${weightScore} | Weekday:${weekday}`,
        "weight_score >= ? AND weight_score < ? AND weekday = ?",
        [...weightScoreRange, weekday],
      ),
    );
  }

  if (trend !== "unknown" && bos !== "unknown") {
    signals.push(makeSignal(db, "EMA/Trend + BOS", `EMA/Trend:${trend} | BOS:${bos}`, "trend = ? AND bos = ?", [trend, bos === "ON" ? 1 : 0]));
  }

  if (bos !== "unknown" && fvg !== "unknown") {
    signals.push(makeSignal(db, "BOS + FVG", `BOS:${bos} | FVG:${fvg}`, "bos = ? AND fvg = ?", [bos === "ON" ? 1 : 0, fvg === "ON" ? 1 : 0]));
  }

  if (trend !== "unknown" && bos !== "unknown" && fvg !== "unknown") {
    signals.push(makeSignal(db, "EMA/Trend + BOS + FVG", `EMA/Trend:${trend} | BOS:${bos} | FVG:${fvg}`, "trend = ? AND bos = ? AND fvg = ?", [trend, bos === "ON" ? 1 : 0, fvg === "ON" ? 1 : 0]));
  }

  if (trend !== "unknown" && choch !== "unknown") {
    signals.push(makeSignal(db, "EMA/Trend + CHOCH", `EMA/Trend:${trend} | CHOCH:${choch}`, "trend = ? AND choch = ?", [trend, choch === "ON" ? 1 : 0]));
  }

  db.close();

  const applied = signals.filter((s) => s.overfitGuard.length === 0 && s.adjustment !== 0);
  const rawAdjustment = applied.reduce((sum, s) => sum + s.adjustment, 0);
  const totalAdjustment = Math.max(-10, Math.min(8, rawAdjustment));
  const adjustedScore = Math.max(0, Math.min(100, originalScore + totalAdjustment));
  const skipCandidate = applied.some((s) => s.action === "SKIP_CANDIDATE");

  return {
    allow: !skipCandidate,
    originalScore,
    adjustedScore,
    totalAdjustment,
    signals,
    applied,
    reasons: [
      `Pattern Weight Learning: ${signals.length}パターンを評価`,
      `補正合計: ${rawAdjustment} → 上限適用後 ${totalAdjustment}`,
      skipCandidate ? "Danger Pattern Hard Gate: 危険パターン検出のため強制SKIP" : "強制SKIPなし",
    ],
    dbPath,
  };
}