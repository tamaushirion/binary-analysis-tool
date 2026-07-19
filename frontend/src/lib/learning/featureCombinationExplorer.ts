import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export type FeatureCombinationExplorerOptions = {
  minSample?: number;
  strongMinSample?: number;
  weakMinSample?: number;
  maxCombinationSize?: 2 | 3 | 4;
  limit?: number;
  includeUnknown?: boolean;
};

export type FeatureCombinationRow = {
  rank: number;
  type: "STRONG" | "WEAK" | "NEUTRAL";
  key: string;
  label: string;
  fields: string[];
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalProfit: number;
  avgProfit: number | null;
  confidence: "none" | "low" | "medium" | "high";
  actionHint: "BONUS_CANDIDATE" | "PENALTY_CANDIDATE" | "SKIP_CANDIDATE" | "IGNORE";
  overfitGuard: string[];
};

export type FeatureCombinationExplorerResult = {
  analyzedTrades: number;
  dbPath: string;
  options: Required<FeatureCombinationExplorerOptions>;
  summary: {
    totalCombinationsChecked: number;
    totalRowsEvaluated: number;
    strongCandidates: number;
    weakCandidates: number;
    ignoredByOverfitGuard: number;
  };
  topStrong: FeatureCombinationRow[];
  topWeak: FeatureCombinationRow[];
  watchList: FeatureCombinationRow[];
  reasons: string[];
};

type FieldDef = {
  key: string;
  label: string;
  expr: string;
};

const DEFAULT_OPTIONS: Required<FeatureCombinationExplorerOptions> = {
  minSample: 8,
  strongMinSample: 30,
  weakMinSample: 12,
  maxCombinationSize: 3,
  limit: 20,
  includeUnknown: false,
};

const FIELDS: FieldDef[] = [
  {
    key: "scoreBand",
    label: "Score",
    expr: "CASE WHEN score IS NULL THEN 'unknown' WHEN score < 70 THEN '0-69' WHEN score < 80 THEN '70-79' WHEN score < 90 THEN '80-89' ELSE '90-100' END",
  },
  {
    key: "finalScoreBand",
    label: "Final Score",
    expr: "CASE WHEN final_score IS NULL THEN 'unknown' WHEN final_score < 70 THEN '0-69' WHEN final_score < 80 THEN '70-79' WHEN final_score < 90 THEN '80-89' ELSE '90-100' END",
  },
  {
    key: "similarityScoreBand",
    label: "Similarity Score",
    expr: "CASE WHEN similarity_score IS NULL THEN 'unknown' WHEN similarity_score < 70 THEN '0-69' WHEN similarity_score < 80 THEN '70-79' WHEN similarity_score < 90 THEN '80-89' ELSE '90-100' END",
  },
  {
    key: "weightScoreBand",
    label: "Weight Score",
    expr: "CASE WHEN weight_score IS NULL THEN 'unknown' WHEN weight_score < 70 THEN '0-69' WHEN weight_score < 80 THEN '70-79' WHEN weight_score < 90 THEN '80-89' ELSE '90-100' END",
  },
  { key: "direction", label: "Direction", expr: "COALESCE(direction, 'unknown')" },
  { key: "session", label: "Session", expr: "COALESCE(session, 'unknown')" },
  { key: "trend", label: "EMA/Trend", expr: "COALESCE(trend, 'unknown')" },
  { key: "marketPhase", label: "Market Phase", expr: "COALESCE(market_phase, 'unknown')" },
  { key: "volatilityLevel", label: "Volatility Level", expr: "COALESCE(volatility_level, 'unknown')" },
  { key: "rciDirection", label: "RCI Direction", expr: "COALESCE(json_extract(feature_snapshot, '$.rciDirection'), 'unknown')" },
  { key: "atrLevel", label: "ATR Level", expr: "COALESCE(json_extract(feature_snapshot, '$.atrLevel'), COALESCE(volatility_level, 'unknown'))" },
  { key: "smcStrength", label: "SMC Strength", expr: "COALESCE(json_extract(feature_snapshot, '$.smcStrength'), 'unknown')" },
  { key: "bos", label: "BOS", expr: "CASE WHEN bos = 1 THEN 'ON' WHEN bos = 0 THEN 'OFF' ELSE 'unknown' END" },
  { key: "choch", label: "CHOCH", expr: "CASE WHEN choch = 1 THEN 'ON' WHEN choch = 0 THEN 'OFF' ELSE 'unknown' END" },
  { key: "fvg", label: "FVG", expr: "CASE WHEN fvg = 1 THEN 'ON' WHEN fvg = 0 THEN 'OFF' ELSE 'unknown' END" },
  { key: "orderBlock", label: "Order Block", expr: "CASE WHEN order_block = 1 THEN 'ON' WHEN order_block = 0 THEN 'OFF' ELSE 'unknown' END" },
  { key: "hour", label: "Hour", expr: "COALESCE(CAST(hour AS TEXT), 'unknown')" },
  { key: "weekday", label: "Weekday", expr: "COALESCE(CAST(weekday AS TEXT), 'unknown')" },
];

function resolveDbPath(): string {
  const candidates = [
    process.env.TRADE_DB_PATH,
    process.env.SQLITE_DB_PATH,
    process.env.DATABASE_PATH,
    path.join(process.cwd(), "data", "ai.db"),
    path.join(process.cwd(), "data", "binary-analysis.sqlite"),
    path.join(process.cwd(), "data", "trades.sqlite"),
    path.join(process.cwd(), "data", "trade_history.sqlite"),
    path.join(process.cwd(), "data", "app.sqlite"),
    path.join(process.cwd(), "db", "ai.db"),
    path.join(process.cwd(), "db", "binary-analysis.sqlite"),
    path.join(process.cwd(), "db", "trades.sqlite"),
    path.join(process.cwd(), "ai.db"),
    path.join(process.cwd(), "trades.sqlite"),
    path.join(process.cwd(), "trade_history.sqlite"),
    path.join(process.cwd(), "database.sqlite"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }

  const roots = [process.cwd(), path.join(process.cwd(), "data"), path.join(process.cwd(), "db")];
  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue;
      for (const file of fs.readdirSync(root)) {
        if (!/\.(sqlite|sqlite3|db)$/i.test(file)) continue;
        const fullPath = path.join(root, file);
        try {
          const db = new Database(fullPath, { readonly: true, fileMustExist: true });
          const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='trade_history'").get();
          db.close();
          if (row) return fullPath;
        } catch {}
      }
    } catch {}
  }

  throw new Error("trade_history を含むSQLite DBが見つかりません。TRADE_DB_PATH または SQLITE_DB_PATH を確認してください。");
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [[]];
  if (items.length < size) return [];
  if (size === 1) return items.map((item) => [item]);

  const result: T[][] = [];
  for (let i = 0; i <= items.length - size; i++) {
    const head = items[i];
    const tailCombos = combinations(items.slice(i + 1), size - 1);
    for (const tail of tailCombos) result.push([head, ...tail]);
  }
  return result;
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function confidence(totalTrades: number): FeatureCombinationRow["confidence"] {
  if (totalTrades >= 50) return "high";
  if (totalTrades >= 30) return "medium";
  if (totalTrades >= 12) return "low";
  return "none";
}

function classify(row: Omit<FeatureCombinationRow, "rank" | "type" | "actionHint" | "overfitGuard" | "confidence">, options: Required<FeatureCombinationExplorerOptions>) {
  const overfitGuard: string[] = [];
  const winRate = row.winRate ?? 0;
  let type: FeatureCombinationRow["type"] = "NEUTRAL";
  let actionHint: FeatureCombinationRow["actionHint"] = "IGNORE";

  if (row.totalTrades < options.minSample) {
    overfitGuard.push(`最低集計件数未満: ${row.totalTrades}/${options.minSample}件`);
  }

  if (row.totalTrades < options.strongMinSample && winRate >= 60 && row.totalProfit > 0) {
    overfitGuard.push(`加点候補には不足: ${row.totalTrades}/${options.strongMinSample}件`);
  }

  if (winRate === 100 && row.totalTrades < options.strongMinSample) {
    overfitGuard.push("少数サンプルの100%勝率は過信禁止");
  }

  if (row.totalTrades >= options.strongMinSample && winRate >= 60 && row.totalProfit > 0 && row.avgProfit !== null && row.avgProfit > 0) {
    type = "STRONG";
    actionHint = "BONUS_CANDIDATE";
  } else if (row.totalTrades >= options.weakMinSample && (winRate < 45 || row.totalProfit < 0)) {
    type = "WEAK";
    actionHint = winRate < 38 && row.totalTrades >= 20 ? "SKIP_CANDIDATE" : "PENALTY_CANDIDATE";
  }

  return { type, actionHint, overfitGuard };
}

function toRow(raw: any, combo: FieldDef[], options: Required<FeatureCombinationExplorerOptions>): FeatureCombinationRow {
  const totalTrades = Number(raw.totalTrades ?? 0);
  const wins = Number(raw.wins ?? 0);
  const losses = Number(raw.losses ?? 0);
  const totalProfit = round(Number(raw.totalProfit ?? 0), 4);
  const winRate = totalTrades > 0 ? round((wins / totalTrades) * 100, 2) : null;
  const avgProfit = totalTrades > 0 ? round(totalProfit / totalTrades, 4) : null;
  const label = combo.map((field, index) => `${field.label}:${String(raw[`v${index}`] ?? "unknown")}`).join(" | ");
  const base = {
    key: combo.map((field) => field.label).join(" + "),
    label,
    fields: combo.map((field) => field.key),
    totalTrades,
    wins,
    losses,
    winRate,
    totalProfit,
    avgProfit,
  };
  const classified = classify(base, options);

  return {
    rank: 0,
    ...classified,
    ...base,
    confidence: confidence(totalTrades),
  };
}

function queryCombo(db: Database.Database, combo: FieldDef[], options: Required<FeatureCombinationExplorerOptions>): FeatureCombinationRow[] {
  const selectParts = combo.map((field, index) => `${field.expr} AS v${index}`);
  const groupParts = combo.map((_, index) => `v${index}`);
  const unknownFilter = options.includeUnknown
    ? ""
    : `AND ${groupParts.map((v) => `${v} <> 'unknown'`).join(" AND ")}`;

  const sql = `
    SELECT
      ${selectParts.join(",\n      ")},
      COUNT(*) AS totalTrades,
      SUM(CASE WHEN UPPER(status) IN ('WON', 'WIN') OR profit > 0 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN UPPER(status) IN ('LOST', 'LOSE') OR profit < 0 THEN 1 ELSE 0 END) AS losses,
      COALESCE(SUM(profit), 0) AS totalProfit
    FROM trade_history
    WHERE profit IS NOT NULL
    GROUP BY ${groupParts.join(", ")}
    HAVING totalTrades >= @minSample ${unknownFilter}
  `;

  return db.prepare(sql).all({ minSample: options.minSample }).map((raw) => toRow(raw, combo, options));
}

function sortStrong(a: FeatureCombinationRow, b: FeatureCombinationRow) {
  return (
    (b.winRate ?? 0) - (a.winRate ?? 0) ||
    b.totalProfit - a.totalProfit ||
    b.totalTrades - a.totalTrades ||
    (b.avgProfit ?? 0) - (a.avgProfit ?? 0)
  );
}

function sortWeak(a: FeatureCombinationRow, b: FeatureCombinationRow) {
  return (
    (a.winRate ?? 0) - (b.winRate ?? 0) ||
    a.totalProfit - b.totalProfit ||
    b.totalTrades - a.totalTrades ||
    (a.avgProfit ?? 0) - (b.avgProfit ?? 0)
  );
}

function withRanks(rows: FeatureCombinationRow[]): FeatureCombinationRow[] {
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function exploreFeatureCombinations(optionsInput: FeatureCombinationExplorerOptions = {}): FeatureCombinationExplorerResult {
  const options: Required<FeatureCombinationExplorerOptions> = {
    ...DEFAULT_OPTIONS,
    ...optionsInput,
    maxCombinationSize: Math.min(Math.max(Number(optionsInput.maxCombinationSize ?? DEFAULT_OPTIONS.maxCombinationSize), 2), 4) as 2 | 3 | 4,
    limit: Math.min(Math.max(Number(optionsInput.limit ?? DEFAULT_OPTIONS.limit), 5), 100),
    minSample: Math.max(Number(optionsInput.minSample ?? DEFAULT_OPTIONS.minSample), 1),
    strongMinSample: Math.max(Number(optionsInput.strongMinSample ?? DEFAULT_OPTIONS.strongMinSample), 5),
    weakMinSample: Math.max(Number(optionsInput.weakMinSample ?? DEFAULT_OPTIONS.weakMinSample), 5),
    includeUnknown: Boolean(optionsInput.includeUnknown ?? DEFAULT_OPTIONS.includeUnknown),
  };

  const dbPath = resolveDbPath();
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='trade_history'").get();
    if (!table) throw new Error("trade_history テーブルが見つかりません");

    const analyzedTradesRow = db.prepare("SELECT COUNT(*) AS total FROM trade_history WHERE profit IS NOT NULL").get() as { total?: number };
    const analyzedTrades = Number(analyzedTradesRow?.total ?? 0);

    let totalCombinationsChecked = 0;
    const rows: FeatureCombinationRow[] = [];

    for (let size = 2; size <= options.maxCombinationSize; size++) {
      for (const combo of combinations(FIELDS, size)) {
        totalCombinationsChecked += 1;
        rows.push(...queryCombo(db, combo, options));
      }
    }

    const strongRows = rows.filter((row) => row.type === "STRONG").sort(sortStrong);
    const weakRows = rows.filter((row) => row.type === "WEAK").sort(sortWeak);
    const watchRows = rows
      .filter((row) => row.type === "NEUTRAL" && row.overfitGuard.length > 0)
      .sort((a, b) => b.totalTrades - a.totalTrades || Math.abs((b.winRate ?? 50) - 50) - Math.abs((a.winRate ?? 50) - 50));

    const ignoredByOverfitGuard = rows.filter((row) => row.overfitGuard.length > 0).length;

    return {
      analyzedTrades,
      dbPath,
      options,
      summary: {
        totalCombinationsChecked,
        totalRowsEvaluated: rows.length,
        strongCandidates: strongRows.length,
        weakCandidates: weakRows.length,
        ignoredByOverfitGuard,
      },
      topStrong: withRanks(strongRows.slice(0, options.limit)),
      topWeak: withRanks(weakRows.slice(0, options.limit)),
      watchList: withRanks(watchRows.slice(0, Math.min(options.limit, 20))),
      reasons: [
        `Feature Combination Explorer: ${analyzedTrades}件のtrade_historyを分析`,
        `2〜${options.maxCombinationSize}個の特徴量組み合わせを${totalCombinationsChecked}通りチェック`,
        `加点候補は${options.strongMinSample}件以上、勝率60%以上、損益プラスのみ`,
        `減点候補は${options.weakMinSample}件以上、勝率45%未満または損益マイナス`,
        "少数サンプルの高勝率はWatch List止まりで、Gate採用しない",
      ],
    };
  } finally {
    db.close();
  }
}
