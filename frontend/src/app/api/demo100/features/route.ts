import { NextResponse } from "next/server";
import Database from "better-sqlite3";

const DB_PATH = "data/ai.db";

type RawTrade = Record<string, any>;

type FeatureRow = {
  feature: string;
  label: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
  avgProfit: number;
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}

function getTableNames(db: Database.Database) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC")
    .all()
    .map((row: any) => String(row.name));
}

function getColumns(db: Database.Database, table: string) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row: any) => String(row.name));
}

function findTradeTable(tableNames: string[]) {
  for (const table of ["trade_history", "tradeHistory", "trades"]) {
    if (tableNames.includes(table)) return table;
  }

  return (
    tableNames.find((table) =>
      ["trade", "history"].some((keyword) =>
        table.toLowerCase().includes(keyword)
      )
    ) ?? null
  );
}

function getProfit(trade: RawTrade) {
  return Number(trade.profit ?? 0);
}

function isWin(trade: RawTrade) {
  const status = String(trade.status ?? "").toUpperCase();
  const profit = getProfit(trade);

  if (["WIN", "WON", "PROFIT"].includes(status)) return true;
  if (["LOSE", "LOST", "LOSS"].includes(status)) return false;

  return profit > 0;
}

function isLoss(trade: RawTrade) {
  const status = String(trade.status ?? "").toUpperCase();
  const profit = getProfit(trade);

  if (["LOSE", "LOST", "LOSS"].includes(status)) return true;
  if (["WIN", "WON", "PROFIT"].includes(status)) return false;

  return profit < 0;
}

function scoreBand(value: unknown) {
  const n = Number(value);

  if (!Number.isFinite(n)) return "unknown";
  if (n < 70) return "0-69";
  if (n < 80) return "70-79";
  if (n < 90) return "80-89";
  return "90-100";
}

function boolLabel(value: unknown) {
  if (value === true || value === 1 || value === "1" || value === "true") {
    return "ON";
  }

  if (value === false || value === 0 || value === "0" || value === "false") {
    return "OFF";
  }

  return "unknown";
}

function numberBand(value: unknown, bands: number[]) {
  const n = Number(value);

  if (!Number.isFinite(n)) return "unknown";

  for (let i = 0; i < bands.length - 1; i++) {
    const min = bands[i];
    const max = bands[i + 1];

    if (n >= min && n < max) return `${min}-${max - 1}`;
  }

  return `${bands[bands.length - 1]}+`;
}

function decimalBand(value: unknown, bands: number[]) {
  const n = Number(value);

  if (!Number.isFinite(n)) return "unknown";

  for (let i = 0; i < bands.length - 1; i++) {
    const min = bands[i];
    const max = bands[i + 1];

    if (n >= min && n < max) return `${min}〜${max}`;
  }

  return `${bands[bands.length - 1]}以上`;
}

function signedBand(value: unknown, cuts: number[]) {
  const n = Number(value);

  if (!Number.isFinite(n)) return "unknown";

  if (n < cuts[0]) return `${cuts[0]}未満`;

  for (let i = 0; i < cuts.length - 1; i++) {
    const min = cuts[i];
    const max = cuts[i + 1];

    if (n >= min && n < max) return `${min}〜${max}`;
  }

  return `${cuts[cuts.length - 1]}以上`;
}

function rciBand(value: unknown) {
  const n = Number(value);

  if (!Number.isFinite(n)) return "unknown";
  if (n >= 70) return "70以上";
  if (n >= 30) return "30〜69";
  if (n > -30) return "-29〜29";
  if (n > -70) return "-69〜-30";
  return "-70以下";
}

function buildRows(
  trades: RawTrade[],
  feature: string,
  getLabel: (trade: RawTrade) => string,
  minTrades = 1
): FeatureRow[] {
  const map = new Map<
    string,
    {
      totalTrades: number;
      wins: number;
      losses: number;
      totalProfit: number;
    }
  >();

  for (const trade of trades) {
    const label = getLabel(trade);

    const current =
      map.get(label) ??
      {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        totalProfit: 0,
      };

    current.totalTrades += 1;
    current.wins += isWin(trade) ? 1 : 0;
    current.losses += isLoss(trade) ? 1 : 0;
    current.totalProfit += getProfit(trade);

    map.set(label, current);
  }

  return Array.from(map.entries())
    .map(([label, row]) => ({
      feature,
      label,
      totalTrades: row.totalTrades,
      wins: row.wins,
      losses: row.losses,
      winRate:
        row.totalTrades > 0 ? round2((row.wins / row.totalTrades) * 100) : 0,
      totalProfit: round4(row.totalProfit),
      avgProfit:
        row.totalTrades > 0 ? round4(row.totalProfit / row.totalTrades) : 0,
    }))
    .filter((row) => row.totalTrades >= minTrades)
    .sort((a, b) => {
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      return b.totalTrades - a.totalTrades;
    });
}

function pickBest(rows: FeatureRow[]) {
  const valid = rows.filter((row) => row.label !== "unknown");

  if (valid.length === 0) return null;

  return [...valid].sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return b.totalTrades - a.totalTrades;
  })[0];
}

function pickWorst(rows: FeatureRow[]) {
  const valid = rows.filter((row) => row.label !== "unknown");

  if (valid.length === 0) return null;

  return [...valid].sort((a, b) => {
    if (a.winRate !== b.winRate) return a.winRate - b.winRate;
    return b.totalTrades - a.totalTrades;
  })[0];
}

function makeRecommendations(allRows: FeatureRow[]) {
  const recommendations: string[] = [];

  const strong = allRows
    .filter((row) => row.label !== "unknown")
    .filter((row) => row.totalTrades >= 10 && row.winRate >= 58)
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, 5);

  const weak = allRows
    .filter((row) => row.label !== "unknown")
    .filter((row) => row.totalTrades >= 10 && row.winRate < 50)
    .sort((a, b) => a.winRate - b.winRate)
    .slice(0, 5);

  for (const row of strong) {
    recommendations.push(
      `${row.feature}:${row.label} は勝率${row.winRate}% / ${row.totalTrades}件。加点またはEntry Gate通過条件候補。`
    );
  }

  for (const row of weak) {
    recommendations.push(
      `${row.feature}:${row.label} は勝率${row.winRate}% / ${row.totalTrades}件。減点またはSKIP候補。`
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "10件以上で明確に強い特徴量がまだ少ないため、追加Demo検証を推奨。"
    );
  }

  return recommendations;
}

export async function GET() {
  const db = new Database(DB_PATH);

  try {
    const tablesChecked = getTableNames(db);
    const tableUsed = findTradeTable(tablesChecked);

    if (!tableUsed) {
      return NextResponse.json({
        ok: true,
        stage: "feature_win_rate_analysis",
        analyzerVersion: "phase15-d-feature-columns-v2",
        analyzedTrades: 0,
        tablesChecked,
        tableUsed: null,
        columnsUsed: [],
        features: {},
        recommendations: ["取引履歴テーブルが見つかりませんでした。"],
      });
    }

    const columnsUsed = getColumns(db, tableUsed);
    const orderColumn = columnsUsed.includes("id") ? "id" : "rowid";

    const trades = db
      .prepare(
        `
        SELECT *
        FROM ${tableUsed}
        WHERE profit IS NOT NULL
        ORDER BY ${orderColumn} DESC
        LIMIT 300
        `
      )
      .all() as RawTrade[];

    const features = {
      scoreBand: buildRows(trades, "Score", (trade) => scoreBand(trade.score)),
      finalScoreBand: buildRows(trades, "Final Score", (trade) =>
        scoreBand(trade.final_score ?? trade.finalScore)
      ),
      direction: buildRows(trades, "Direction", (trade) =>
        String(trade.direction ?? "unknown")
      ),
      pair: buildRows(trades, "Pair", (trade) =>
        String(trade.pair ?? "unknown")
      ),
      hour: buildRows(trades, "Hour", (trade) =>
        String(trade.hour ?? "unknown")
      ),
      weekday: buildRows(trades, "Weekday", (trade) =>
        String(trade.weekday ?? "unknown")
      ),
      session: buildRows(trades, "Session", (trade) =>
        String(trade.session ?? "unknown")
      ),
      trend: buildRows(trades, "Trend", (trade) =>
        String(trade.trend ?? "unknown")
      ),
      marketPhase: buildRows(trades, "Market Phase", (trade) =>
        String(trade.market_phase ?? "unknown")
      ),
      volatilityLevel: buildRows(trades, "Volatility Level", (trade) =>
        String(trade.volatility_level ?? "unknown")
      ),
      emaDiff: buildRows(trades, "EMA Diff", (trade) =>
        signedBand(trade.ema_diff, [-10, -1, 0, 1, 10])
      ),
      rci9: buildRows(trades, "RCI9", (trade) => rciBand(trade.rci9)),
      rci26: buildRows(trades, "RCI26", (trade) => rciBand(trade.rci26)),
      rci52: buildRows(trades, "RCI52", (trade) => rciBand(trade.rci52)),
      atr: buildRows(trades, "ATR", (trade) =>
        decimalBand(trade.atr, [0, 0.1, 0.5, 1, 2, 5])
      ),
      bos: buildRows(trades, "BOS", (trade) => boolLabel(trade.bos)),
      choch: buildRows(trades, "CHOCH", (trade) => boolLabel(trade.choch)),
      fvg: buildRows(trades, "FVG", (trade) => boolLabel(trade.fvg)),
      orderBlock: buildRows(trades, "Order Block", (trade) =>
        boolLabel(trade.order_block)
      ),
      weightScoreBand: buildRows(trades, "Weight Score", (trade) =>
        scoreBand(trade.weight_score)
      ),
      similarityScoreBand: buildRows(trades, "Similarity Score", (trade) =>
        scoreBand(trade.similarity_score)
      ),
    };

    const allRows = Object.values(features).flat();

    const strongCandidates = allRows
      .filter((row) => row.label !== "unknown")
      .filter((row) => row.totalTrades >= 10 && row.winRate >= 58)
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 10);

    const weakCandidates = allRows
      .filter((row) => row.label !== "unknown")
      .filter((row) => row.totalTrades >= 10 && row.winRate < 50)
      .sort((a, b) => a.winRate - b.winRate)
      .slice(0, 10);

    return NextResponse.json({
      ok: true,
      stage: "feature_win_rate_analysis",
      analyzerVersion: "phase15-d-feature-columns-v2",
      analyzedTrades: trades.length,
      tablesChecked,
      tableUsed,
      columnsUsed,
      summary: {
        bestFeature: pickBest(allRows),
        worstFeature: pickWorst(allRows),
        strongCandidates,
        weakCandidates,
      },
      features,
      recommendations: makeRecommendations(allRows),
      message:
        "trade_history実カラムからEMA / RCI / ATR / BOS / CHOCH / FVG / OrderBlock / Score帯ごとの勝率を集計しました。",
    });
  } catch (error: any) {
    console.error(error);

    return NextResponse.json(
      {
        ok: false,
        stage: "feature_win_rate_analysis_error",
        analyzerVersion: "phase15-d-feature-columns-v2",
        error: error?.message ?? "特徴量勝率分析に失敗しました",
      },
      { status: 500 }
    );
  } finally {
    db.close();
  }
}
