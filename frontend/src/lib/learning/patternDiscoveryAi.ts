import Database from "better-sqlite3";
import path from "path";

export type PatternDiscoveryOptions = {
  minSample?: number;
  strongMinSample?: number;
  weakMinSample?: number;
  maxPatternSize?: number;
  limit?: number;
  includeUnknown?: boolean;
};

export type PatternDiscoveryRow = {
  rank: number;
  type: "STRONG" | "WEAK" | "WATCH";
  actionHint: "BOOST_CANDIDATE" | "PENALTY_CANDIDATE" | "WATCH_ONLY";
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
  overfitGuard: string[];
};

export type PatternDiscoveryResult = {
  analyzedTrades: number;
  dbPath: string;
  options: Required<PatternDiscoveryOptions>;
  summary: {
    totalPatternsChecked: number;
    totalRowsEvaluated: number;
    strongCandidates: number;
    weakCandidates: number;
    watchList: number;
  };
  topStrong: PatternDiscoveryRow[];
  topWeak: PatternDiscoveryRow[];
  watchList: PatternDiscoveryRow[];
  reasons: string[];
};

type TradeRow = Record<string, any>;

type FeatureDef = {
  field: string;
  label: string;
  getter: (row: TradeRow) => string | null;
};

function resolveDbPath() {
  return path.join(process.cwd(), "data", "ai.db");
}

function toNumber(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function scoreBand(value: any) {
  const n = toNumber(value);
  if (n === null) return "unknown";
  if (n < 70) return "0-69";
  if (n < 80) return "70-79";
  if (n < 90) return "80-89";
  return "90-100";
}

function boolLabel(value: any) {
  if (value === null || value === undefined) return "unknown";
  if (value === true || value === 1 || value === "1" || value === "true") return "ON";
  if (value === false || value === 0 || value === "0" || value === "false") return "OFF";
  return "unknown";
}

function textLabel(value: any) {
  if (value === null || value === undefined || value === "") return "unknown";
  return String(value).trim() || "unknown";
}

function numberBucket(value: any, buckets: Array<[number, number, string]>) {
  const n = toNumber(value);
  if (n === null) return "unknown";
  for (const [min, max, label] of buckets) {
    if (n >= min && n <= max) return label;
  }
  return "other";
}

function parseSnapshot(row: TradeRow) {
  if (!row.feature_snapshot) return {};
  try {
    const parsed = JSON.parse(row.feature_snapshot);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function getFeatureDefs(): FeatureDef[] {
  return [
    { field: "scoreBand", label: "Score", getter: (r) => scoreBand(r.score) },
    { field: "finalScoreBand", label: "Final Score", getter: (r) => scoreBand(r.final_score) },
    { field: "weightScoreBand", label: "Weight Score", getter: (r) => scoreBand(r.weight_score) },
    { field: "similarityScoreBand", label: "Similarity Score", getter: (r) => scoreBand(r.similarity_score) },
    { field: "direction", label: "Direction", getter: (r) => textLabel(r.direction) },
    { field: "trend", label: "EMA/Trend", getter: (r) => textLabel(r.trend || parseSnapshot(r).emaTrend) },
    { field: "rciDirection", label: "RCI Direction", getter: (r) => textLabel(parseSnapshot(r).rciDirection) },
    { field: "atrLevel", label: "ATR Level", getter: (r) => textLabel(parseSnapshot(r).atrLevel) },
    { field: "smcStrength", label: "SMC Strength", getter: (r) => textLabel(parseSnapshot(r).smcStrength) },
    { field: "bos", label: "BOS", getter: (r) => boolLabel(r.bos) },
    { field: "choch", label: "CHOCH", getter: (r) => boolLabel(r.choch) },
    { field: "fvg", label: "FVG", getter: (r) => boolLabel(r.fvg) },
    { field: "orderBlock", label: "Order Block", getter: (r) => boolLabel(r.order_block) },
    { field: "marketPhase", label: "Market Phase", getter: (r) => textLabel(r.market_phase || parseSnapshot(r).marketPhase) },
    { field: "volatilityLevel", label: "Volatility Level", getter: (r) => textLabel(r.volatility_level || parseSnapshot(r).volatilityLevel) },
    { field: "session", label: "Session", getter: (r) => textLabel(r.session || parseSnapshot(r).session) },
    { field: "weekday", label: "Weekday", getter: (r) => textLabel(r.weekday) },
    { field: "hour", label: "Hour", getter: (r) => textLabel(r.hour) },
    { field: "rci9", label: "RCI9", getter: (r) => numberBucket(r.rci9, [[-100, -70, "-100〜-70"], [-69, -30, "-69〜-30"], [-29, 29, "-29〜29"], [30, 69, "30〜69"], [70, 100, "70〜100"]]) },
    { field: "atr", label: "ATR", getter: (r) => numberBucket(r.atr, [[0, 0.1, "0〜0.1"], [0.100001, 0.3, "0.1〜0.3"], [0.300001, 999999, "0.3以上"]]) },
  ];
}

function combinations<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  const walk = (start: number, current: T[]) => {
    if (current.length === size) {
      result.push([...current]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      current.push(arr[i]);
      walk(i + 1, current);
      current.pop();
    }
  };
  walk(0, []);
  return result;
}

function confidence(totalTrades: number): PatternDiscoveryRow["confidence"] {
  if (totalTrades >= 50) return "high";
  if (totalTrades >= 30) return "medium";
  if (totalTrades >= 12) return "low";
  return "none";
}

function classify(row: Omit<PatternDiscoveryRow, "rank" | "type" | "actionHint" | "confidence" | "overfitGuard">, options: Required<PatternDiscoveryOptions>): PatternDiscoveryRow {
  const overfitGuard: string[] = [];
  const conf = confidence(row.totalTrades);
  let type: PatternDiscoveryRow["type"] = "WATCH";
  let actionHint: PatternDiscoveryRow["actionHint"] = "WATCH_ONLY";

  if (row.totalTrades < options.minSample) {
    overfitGuard.push(`サンプル不足: ${row.totalTrades}件。採用しない`);
  }

  const strongEnough =
    row.totalTrades >= options.strongMinSample &&
    row.winRate !== null &&
    row.winRate >= 60 &&
    row.totalProfit > 0 &&
    row.avgProfit !== null &&
    row.avgProfit > 0;

  const weakEnough =
    row.totalTrades >= options.weakMinSample &&
    row.winRate !== null &&
    (row.winRate <= 45 || row.totalProfit < 0) &&
    row.avgProfit !== null &&
    row.avgProfit < 0;

  if (strongEnough) {
    type = "STRONG";
    actionHint = "BOOST_CANDIDATE";
  } else if (weakEnough) {
    type = "WEAK";
    actionHint = "PENALTY_CANDIDATE";
  } else if (row.totalTrades < options.strongMinSample && row.winRate !== null && row.winRate >= 65) {
    overfitGuard.push("高勝率だがサンプル不足。Watch List止まり");
  }

  return { ...row, rank: 0, type, actionHint, confidence: conf, overfitGuard };
}

function evaluateGroup(rows: TradeRow[]) {
  const totalTrades = rows.length;
  let wins = 0;
  let losses = 0;
  let totalProfit = 0;

  for (const row of rows) {
    const status = String(row.status || "").toUpperCase();
    const profit = toNumber(row.profit) ?? 0;
    totalProfit += profit;
    if (status === "WON" || profit > 0) wins++;
    else if (status === "LOST" || profit < 0) losses++;
  }

  const winRate = totalTrades > 0 ? Number(((wins / totalTrades) * 100).toFixed(2)) : null;
  const avgProfit = totalTrades > 0 ? Number((totalProfit / totalTrades).toFixed(4)) : null;

  return {
    totalTrades,
    wins,
    losses,
    winRate,
    totalProfit: Number(totalProfit.toFixed(4)),
    avgProfit,
  };
}

export function discoverFeaturePatterns(inputOptions: PatternDiscoveryOptions = {}): PatternDiscoveryResult {
  const options: Required<PatternDiscoveryOptions> = {
    minSample: inputOptions.minSample ?? 8,
    strongMinSample: inputOptions.strongMinSample ?? 30,
    weakMinSample: inputOptions.weakMinSample ?? 12,
    maxPatternSize: Math.min(Math.max(inputOptions.maxPatternSize ?? 5, 2), 5),
    limit: inputOptions.limit ?? 20,
    includeUnknown: inputOptions.includeUnknown ?? false,
  };

  const dbPath = resolveDbPath();
  const db = new Database(dbPath, { readonly: true });

  try {
    const trades = db
      .prepare(`
        SELECT *
        FROM trade_history
        WHERE status IS NOT NULL
          AND profit IS NOT NULL
        ORDER BY id ASC
      `)
      .all() as TradeRow[];

    const defs = getFeatureDefs();
    const results: PatternDiscoveryRow[] = [];
    let totalPatternsChecked = 0;
    let totalRowsEvaluated = 0;

    const decorated = trades.map((trade) => {
      const featureValues: Record<string, string> = {};
      for (const def of defs) {
        featureValues[def.field] = def.getter(trade) ?? "unknown";
      }
      return { trade, featureValues };
    });

    for (let size = 2; size <= options.maxPatternSize; size++) {
      for (const combo of combinations(defs, size)) {
        totalPatternsChecked++;
        const groups = new Map<string, { labels: string[]; fields: string[]; rows: TradeRow[] }>();

        for (const item of decorated) {
          const values = combo.map((def) => item.featureValues[def.field] ?? "unknown");
          if (!options.includeUnknown && values.some((v) => v === "unknown" || v === "NONE")) continue;
          const key = values.join("__");
          const existing = groups.get(key);
          if (existing) existing.rows.push(item.trade);
          else groups.set(key, {
            fields: combo.map((def) => def.field),
            labels: combo.map((def, i) => `${def.label}:${values[i]}`),
            rows: [item.trade],
          });
        }

        for (const group of groups.values()) {
          totalRowsEvaluated++;
          const stats = evaluateGroup(group.rows);
          if (stats.totalTrades < options.minSample) continue;

          const row = classify({
            key: combo.map((def) => def.label).join(" + "),
            label: group.labels.join(" | "),
            fields: group.fields,
            ...stats,
          }, options);

          if (row.type !== "WATCH" || row.overfitGuard.length > 0) {
            results.push(row);
          }
        }
      }
    }

    const strong = results
      .filter((r) => r.type === "STRONG")
      .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0) || b.totalProfit - a.totalProfit)
      .slice(0, options.limit)
      .map((r, i) => ({ ...r, rank: i + 1 }));

    const weak = results
      .filter((r) => r.type === "WEAK")
      .sort((a, b) => (a.winRate ?? 999) - (b.winRate ?? 999) || a.totalProfit - b.totalProfit)
      .slice(0, options.limit)
      .map((r, i) => ({ ...r, rank: i + 1 }));

    const watch = results
      .filter((r) => r.type === "WATCH")
      .sort((a, b) => b.totalTrades - a.totalTrades)
      .slice(0, options.limit)
      .map((r, i) => ({ ...r, rank: i + 1 }));

    return {
      analyzedTrades: trades.length,
      dbPath,
      options,
      summary: {
        totalPatternsChecked,
        totalRowsEvaluated,
        strongCandidates: strong.length,
        weakCandidates: weak.length,
        watchList: watch.length,
      },
      topStrong: strong,
      topWeak: weak,
      watchList: watch,
      reasons: [
        `Pattern Discovery AI: ${trades.length}件のtrade_historyを分析`,
        `2〜${options.maxPatternSize}個の特徴量パターンを${totalPatternsChecked}系統チェック`,
        `加点候補: ${options.strongMinSample}件以上 / 勝率60%以上 / 損益プラスのみ`,
        `減点候補: ${options.weakMinSample}件以上 / 勝率45%以下または損益マイナス`,
        "少数サンプルの高勝率はWatch List止まりでGate採用しない",
      ],
    };
  } finally {
    db.close();
  }
}
