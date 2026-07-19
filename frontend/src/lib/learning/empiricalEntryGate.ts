import Database from "better-sqlite3";

export type EmpiricalEntryGateInput = {
  pair: string;
  direction: "HIGH" | "LOW";
  score: number;
  finalScore?: number | null;
  minTrades?: number;
  minWinRate?: number;
};

export type EmpiricalEntryGateResult = {
  allow: boolean;
  score: number;
  originalScore: number;
  adjustedScore: number;
  adjustment: number;
  scoreBand: string;
  sampleSize: number;
  winRate: number | null;
  totalProfit: number;
  avgProfit: number;
  confidence: "none" | "low" | "medium" | "high";
  reasons: string[];
};

type TradeRow = {
  score: number | null;
  final_score: number | null;
  profit: number | null;
  status: string | null;
  pair: string | null;
  direction: string | null;
};

const DB_PATH = "data/ai.db";

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}

function scoreBand(score: number) {
  if (score < 70) return "0-69";
  if (score < 80) return "70-79";
  if (score < 90) return "80-89";
  return "90-100";
}

function bandRange(band: string) {
  if (band === "0-69") return { min: 0, max: 69 };
  if (band === "70-79") return { min: 70, max: 79 };
  if (band === "80-89") return { min: 80, max: 89 };
  return { min: 90, max: 100 };
}

function isWin(row: TradeRow) {
  const status = String(row.status ?? "").toUpperCase();
  const profit = Number(row.profit ?? 0);

  if (["WIN", "WON", "PROFIT"].includes(status)) return true;
  if (["LOSE", "LOST", "LOSS"].includes(status)) return false;

  return profit > 0;
}

function getConfidence(sampleSize: number) {
  if (sampleSize >= 50) return "high";
  if (sampleSize >= 20) return "medium";
  if (sampleSize >= 10) return "low";
  return "none";
}

function getTableExists(db: Database.Database, tableName: string) {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
    )
    .get(tableName) as { name?: string } | undefined;

  return !!row?.name;
}

function getTradeRows(params: {
  db: Database.Database;
  pair: string;
  direction: "HIGH" | "LOW";
  band: string;
  limit: number;
}) {
  const range = bandRange(params.band);

  if (!getTableExists(params.db, "trade_history")) {
    return [];
  }

  return params.db
    .prepare(
      `
      SELECT
        score,
        final_score,
        profit,
        status,
        pair,
        direction
      FROM trade_history
      WHERE profit IS NOT NULL
        AND pair = @pair
        AND direction = @direction
        AND score >= @minScore
        AND score <= @maxScore
      ORDER BY id DESC
      LIMIT @limit
      `
    )
    .all({
      pair: params.pair,
      direction: params.direction,
      minScore: range.min,
      maxScore: range.max,
      limit: params.limit,
    }) as TradeRow[];
}

function getFallbackRows(params: {
  db: Database.Database;
  band: string;
  limit: number;
}) {
  const range = bandRange(params.band);

  if (!getTableExists(params.db, "trade_history")) {
    return [];
  }

  return params.db
    .prepare(
      `
      SELECT
        score,
        final_score,
        profit,
        status,
        pair,
        direction
      FROM trade_history
      WHERE profit IS NOT NULL
        AND score >= @minScore
        AND score <= @maxScore
      ORDER BY id DESC
      LIMIT @limit
      `
    )
    .all({
      minScore: range.min,
      maxScore: range.max,
      limit: params.limit,
    }) as TradeRow[];
}

function decideAdjustment(params: {
  band: string;
  sampleSize: number;
  winRate: number | null;
  totalProfit: number;
  minTrades: number;
  minWinRate: number;
}) {
  const reasons: string[] = [];

  if (params.sampleSize < params.minTrades || params.winRate === null) {
    reasons.push(
      `Score ${params.band}: サンプル不足 ${params.sampleSize}/${params.minTrades}`
    );
    return {
      allow: true,
      adjustment: 0,
      reasons: [...reasons, "実績補正なし"],
    };
  }

  reasons.push(
    `Score ${params.band}: ${params.sampleSize}件 / 勝率${params.winRate}% / 損益${round4(
      params.totalProfit
    )}`
  );

  if (params.band === "80-89" && params.winRate < 50) {
    return {
      allow: false,
      adjustment: -12,
      reasons: [
        ...reasons,
        "Score 80-89は直近実績が弱いためSKIP候補",
        "勝率改善優先: 80-89帯を一時停止",
      ],
    };
  }

  if (params.band === "80-89" && params.totalProfit < 0) {
    return {
      allow: false,
      adjustment: -8,
      reasons: [
        ...reasons,
        "Score 80-89は損益がマイナスのためSKIP候補",
      ],
    };
  }

  if (params.band === "70-79" && params.winRate >= params.minWinRate) {
    return {
      allow: true,
      adjustment: 4,
      reasons: [
        ...reasons,
        "Score 70-79は実績良好のため加点候補",
      ],
    };
  }

  if (params.band === "90-100" && params.winRate < 55) {
    return {
      allow: true,
      adjustment: -4,
      reasons: [
        ...reasons,
        "Score 90-100は過信禁止。実績が伸びていないため軽く減点",
      ],
    };
  }

  if (params.winRate < 50) {
    return {
      allow: false,
      adjustment: -8,
      reasons: [...reasons, "勝率50%未満のScore帯のためSKIP候補"],
    };
  }

  return {
    allow: true,
    adjustment: 0,
    reasons: [...reasons, "実績上は通過可能"],
  };
}

export function applyEmpiricalEntryGate(
  input: EmpiricalEntryGateInput
): EmpiricalEntryGateResult {
  const originalScore = clampScore(Number(input.finalScore ?? input.score ?? 0));
  const band = scoreBand(originalScore);
  const minTrades = input.minTrades ?? 10;
  const minWinRate = input.minWinRate ?? 57;
  const reasons: string[] = [];

  const db = new Database(DB_PATH);

  try {
    let rows = getTradeRows({
      db,
      pair: input.pair,
      direction: input.direction,
      band,
      limit: 300,
    });

    if (rows.length < minTrades) {
      const fallbackRows = getFallbackRows({
        db,
        band,
        limit: 300,
      });

      if (fallbackRows.length > rows.length) {
        reasons.push(
          `ペア/方向別はサンプル不足のため、全体Score帯実績を使用: ${rows.length}件 → ${fallbackRows.length}件`
        );
        rows = fallbackRows;
      }
    }

    const sampleSize = rows.length;
    const wins = rows.filter(isWin).length;
    const totalProfit = rows.reduce(
      (sum, row) => sum + Number(row.profit ?? 0),
      0
    );
    const winRate = sampleSize > 0 ? round2((wins / sampleSize) * 100) : null;
    const avgProfit = sampleSize > 0 ? round4(totalProfit / sampleSize) : 0;

    const decision = decideAdjustment({
      band,
      sampleSize,
      winRate,
      totalProfit,
      minTrades,
      minWinRate,
    });

    const adjustedScore = clampScore(originalScore + decision.adjustment);

    return {
      allow: decision.allow,
      score: adjustedScore,
      originalScore,
      adjustedScore,
      adjustment: decision.adjustment,
      scoreBand: band,
      sampleSize,
      winRate,
      totalProfit: round4(totalProfit),
      avgProfit,
      confidence: getConfidence(sampleSize),
      reasons: [...reasons, ...decision.reasons],
    };
  } catch (error: any) {
    return {
      allow: true,
      score: originalScore,
      originalScore,
      adjustedScore: originalScore,
      adjustment: 0,
      scoreBand: band,
      sampleSize: 0,
      winRate: null,
      totalProfit: 0,
      avgProfit: 0,
      confidence: "none",
      reasons: [
        "Empirical Entry Gateでエラー。安全のため既存Gateを優先",
        error?.message ?? "unknown error",
      ],
    };
  } finally {
    db.close();
  }
}
