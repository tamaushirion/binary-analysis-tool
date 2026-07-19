import Database from "better-sqlite3";

export type FeatureWinRateRow = {
  feature: string;
  label: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
  avgProfit: number;
};

export type FeatureWinRateAnalysis = {
  ok: boolean;
  stage: "feature_win_rate_analysis";
  analyzedTrades: number;
  tablesChecked: string[];
  tableUsed: string | null;
  summary: {
    bestFeature: FeatureWinRateRow | null;
    worstFeature: FeatureWinRateRow | null;
    strongCandidates: FeatureWinRateRow[];
    weakCandidates: FeatureWinRateRow[];
  };
  features: {
    emaTrend: FeatureWinRateRow[];
    rci9: FeatureWinRateRow[];
    rci26: FeatureWinRateRow[];
    rci52: FeatureWinRateRow[];
    atr: FeatureWinRateRow[];
    bos: FeatureWinRateRow[];
    choch: FeatureWinRateRow[];
    fvg: FeatureWinRateRow[];
    liquidity: FeatureWinRateRow[];
    smcScore: FeatureWinRateRow[];
    entryGate: FeatureWinRateRow[];
    scoreBand: FeatureWinRateRow[];
    finalScoreBand: FeatureWinRateRow[];
  };
  recommendations: string[];
  message: string;
};

type RawTrade = {
  status?: string | null;
  profit?: number | null;
  score?: number | null;
  features?: string | null;
};

const DB_PATH = "data/ai.db";

const CANDIDATE_TABLES = [
  "trade_history",
  "tradeHistory",
  "trades",
  "demo_trades",
  "trade_histories",
];

function openDb() {
  return new Database(DB_PATH);
}

function getTableNames(db: Database.Database) {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC"
    )
    .all()
    .map((row: any) => String(row.name));
}

function findTradeTable(db: Database.Database) {
  const tableNames = getTableNames(db);

  for (const table of CANDIDATE_TABLES) {
    if (tableNames.includes(table)) return table;
  }

  return (
    tableNames.find((table) =>
      ["trade", "history", "demo"].some((keyword) =>
        table.toLowerCase().includes(keyword)
      )
    ) ?? null
  );
}

function safeJsonParse(value: string | null | undefined) {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function isWin(trade: RawTrade) {
  const status = String(trade.status ?? "").toUpperCase();
  const profit = Number(trade.profit ?? 0);

  if (status === "WIN" || status === "WON") return true;
  if (status === "LOSE" || status === "LOST") return false;

  return profit > 0;
}

function isLoss(trade: RawTrade) {
  const status = String(trade.status ?? "").toUpperCase();
  const profit = Number(trade.profit ?? 0);

  if (status === "LOSE" || status === "LOST") return true;
  if (status === "WIN" || status === "WON") return false;

  return profit < 0;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}

function bandNumber(value: any, bands: number[]) {
  const n = Number(value);

  if (!Number.isFinite(n)) return "unknown";

  for (let i = 0; i < bands.length - 1; i++) {
    const min = bands[i];
    const max = bands[i + 1];

    if (n >= min && n < max) return `${min}-${max - 1}`;
  }

  const last = bands[bands.length - 1];
  return `${last}+`;
}

function scoreBand(value: any) {
  const n = Number(value);

  if (!Number.isFinite(n)) return "unknown";
  if (n < 70) return "0-69";
  if (n < 80) return "70-79";
  if (n < 90) return "80-89";
  return "90-100";
}

function boolLabel(value: any) {
  if (value === true || value === 1 || value === "true" || value === "1") {
    return "ON";
  }

  if (value === false || value === 0 || value === "false" || value === "0") {
    return "OFF";
  }

  return "unknown";
}

function trendLabel(features: any) {
  if (typeof features.trend === "string") return features.trend;

  const ema9 = Number(features.ema9);
  const ema21 = Number(features.ema21);

  if (!Number.isFinite(ema9) || !Number.isFinite(ema21)) return "unknown";
  if (ema9 > ema21) return "UP";
  if (ema9 < ema21) return "DOWN";
  return "RANGE";
}

function rciLabel(value: any) {
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
  getLabel: (trade: RawTrade, features: any) => string,
  minTrades = 3
): FeatureWinRateRow[] {
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
    const features = safeJsonParse(trade.features);
    const label = getLabel(trade, features);

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
    current.totalProfit += Number(trade.profit ?? 0);

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

function flattenFeatureRows(features: FeatureWinRateAnalysis["features"]) {
  return Object.values(features).flat();
}

function buildRecommendations(params: {
  features: FeatureWinRateAnalysis["features"];
  bestFeature: FeatureWinRateRow | null;
  worstFeature: FeatureWinRateRow | null;
}) {
  const recommendations: string[] = [];

  if (params.bestFeature) {
    recommendations.push(
      `${params.bestFeature.feature}:${params.bestFeature.label} は勝率${params.bestFeature.winRate}% / ${params.bestFeature.totalTrades}件。Entry Gateの加点候補。`
    );
  }

  if (params.worstFeature) {
    recommendations.push(
      `${params.worstFeature.feature}:${params.worstFeature.label} は勝率${params.worstFeature.winRate}% / ${params.worstFeature.totalTrades}件。停止条件または減点候補。`
    );
  }

  const goodScoreBand = params.features.scoreBand.find(
    (row) => row.winRate >= 58 && row.totalTrades >= 10
  );

  if (goodScoreBand) {
    recommendations.push(
      `Score ${goodScoreBand.label} が比較的強い。現時点では高スコア盲信より、実績Score帯を優先。`
    );
  }

  const badScoreBand = params.features.scoreBand.find(
    (row) => row.winRate < 50 && row.totalTrades >= 10
  );

  if (badScoreBand) {
    recommendations.push(
      `Score ${badScoreBand.label} は勝率50%未満。次Phaseで減点またはSKIP候補。`
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "まだ特徴量ごとの優位性が弱い。Demo件数を追加してからEntry Gateへ反映。"
    );
  }

  return recommendations;
}

export function analyzeFeatureWinRates(): FeatureWinRateAnalysis {
  const db = openDb();

  try {
    const tablesChecked = getTableNames(db);
    const tableUsed = findTradeTable(db);

    if (!tableUsed) {
      return {
        ok: true,
        stage: "feature_win_rate_analysis",
        analyzedTrades: 0,
        tablesChecked,
        tableUsed: null,
        summary: {
          bestFeature: null,
          worstFeature: null,
          strongCandidates: [],
          weakCandidates: [],
        },
        features: {
          emaTrend: [],
          rci9: [],
          rci26: [],
          rci52: [],
          atr: [],
          bos: [],
          choch: [],
          fvg: [],
          liquidity: [],
          smcScore: [],
          entryGate: [],
          scoreBand: [],
          finalScoreBand: [],
        },
        recommendations: ["取引履歴テーブルが見つかりませんでした。"],
        message: "特徴量分析を実行しましたが、取引履歴テーブルが未検出です。",
      };
    }

    const trades = db
      .prepare(
        `
        SELECT
          status,
          profit,
          score,
          features
        FROM ${tableUsed}
        WHERE profit IS NOT NULL
        ORDER BY id DESC
        LIMIT 300
        `
      )
      .all() as RawTrade[];

    const features = {
      emaTrend: buildRows(trades, "EMA Trend", (_trade, f) => trendLabel(f)),
      rci9: buildRows(trades, "RCI9", (_trade, f) => rciLabel(f.rci9)),
      rci26: buildRows(trades, "RCI26", (_trade, f) => rciLabel(f.rci26)),
      rci52: buildRows(trades, "RCI52", (_trade, f) => rciLabel(f.rci52)),
      atr: buildRows(trades, "ATR", (_trade, f) =>
        bandNumber(f.atr, [0, 0.1, 0.5, 1, 2, 5])
      ),
      bos: buildRows(trades, "BOS", (_trade, f) => boolLabel(f.bos)),
      choch: buildRows(trades, "CHOCH", (_trade, f) => boolLabel(f.choch)),
      fvg: buildRows(trades, "FVG", (_trade, f) => boolLabel(f.fvg)),
      liquidity: buildRows(trades, "Liquidity", (_trade, f) =>
        boolLabel(f.liquidity)
      ),
      smcScore: buildRows(trades, "SMC Score", (_trade, f) =>
        bandNumber(f.smcScore, [0, 10, 20, 30, 40, 50, 70, 100])
      ),
      entryGate: buildRows(trades, "Entry Gate", (_trade, f) =>
        boolLabel(f.entryGate)
      ),
      scoreBand: buildRows(trades, "Score", (trade, f) =>
        scoreBand(f.aiScore ?? trade.score)
      ),
      finalScoreBand: buildRows(trades, "Final Score", (_trade, f) =>
        scoreBand(f.finalScore)
      ),
    };

    const allRows = flattenFeatureRows(features).filter(
      (row) => row.label !== "unknown"
    );

    const bestFeature =
      allRows.length > 0
        ? [...allRows].sort((a, b) => {
            if (b.winRate !== a.winRate) return b.winRate - a.winRate;
            return b.totalTrades - a.totalTrades;
          })[0]
        : null;

    const worstFeature =
      allRows.length > 0
        ? [...allRows].sort((a, b) => {
            if (a.winRate !== b.winRate) return a.winRate - b.winRate;
            return b.totalTrades - a.totalTrades;
          })[0]
        : null;

    const strongCandidates = allRows
      .filter((row) => row.totalTrades >= 10 && row.winRate >= 58)
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 8);

    const weakCandidates = allRows
      .filter((row) => row.totalTrades >= 10 && row.winRate < 50)
      .sort((a, b) => a.winRate - b.winRate)
      .slice(0, 8);

    const recommendations = buildRecommendations({
      features,
      bestFeature,
      worstFeature,
    });

    return {
      ok: true,
      stage: "feature_win_rate_analysis",
      analyzedTrades: trades.length,
      tablesChecked,
      tableUsed,
      summary: {
        bestFeature,
        worstFeature,
        strongCandidates,
        weakCandidates,
      },
      features,
      recommendations,
      message:
        "Demo履歴からEMA / RCI / ATR / SMC / Score帯ごとの勝率を集計しました。",
    };
  } finally {
    db.close();
  }
}
