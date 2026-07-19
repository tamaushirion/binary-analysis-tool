import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export type FeatureGateDirection = "HIGH" | "LOW";

export type FeatureGateInput = {
  pair?: string;
  direction?: FeatureGateDirection;
  score?: number;
  finalScore?: number;
  weightScore?: number;
  similarityScore?: number;
  features?: Record<string, any>;
};

export type FeatureGateCandidate = {
  key: string;
  label: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalProfit: number;
  avgProfit: number | null;
  confidence: "none" | "low" | "medium" | "high";
  adjustment: number;
  action: "IGNORE" | "BONUS" | "PENALTY" | "SKIP_CANDIDATE";
  overfitGuard: string[];
};

export type FeatureWinRateGateResult = {
  allow: boolean;
  originalScore: number;
  adjustedScore: number;
  totalAdjustment: number;
  candidates: FeatureGateCandidate[];
  applied: FeatureGateCandidate[];
  reasons: string[];
  dbPath: string;
};

const MIN_SAMPLE_FOR_BONUS = 30;
const MIN_SAMPLE_FOR_PENALTY = 12;
const MIN_SAMPLE_FOR_SKIP = 20;
const HARD_SKIP_MIN_SAMPLE_STRONG = 30;
const HARD_SKIP_MIN_SAMPLE_PROFIT = 20;
const HARD_SKIP_WIN_RATE_STRONG = 45;
const HARD_SKIP_WIN_RATE_PROFIT = 48;
const HARD_SKIP_TOTAL_PROFIT = -3;
const MAX_TOTAL_ADJUSTMENT = 8;

function toNumber(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toBoolLabel(value: any): "ON" | "OFF" | "unknown" {
  if (value === true || value === 1 || value === "1" || value === "true" || value === "ON") return "ON";
  if (value === false || value === 0 || value === "0" || value === "false" || value === "OFF") return "OFF";
  return "unknown";
}

function norm(value: any): string {
  if (value === null || value === undefined || value === "") return "unknown";
  return String(value);
}

function scoreBand(value: any): string {
  const n = toNumber(value);
  if (n === null) return "unknown";
  if (n < 70) return "0-69";
  if (n < 80) return "70-79";
  if (n < 90) return "80-89";
  return "90-100";
}

function resolveDbPath(): string {
  const candidates = [
    process.env.TRADE_DB_PATH,
    process.env.SQLITE_DB_PATH,
    process.env.DATABASE_PATH,
    path.join(process.cwd(), "data", "binary-analysis.sqlite"),
    path.join(process.cwd(), "data", "trades.sqlite"),
    path.join(process.cwd(), "data", "trade_history.sqlite"),
    path.join(process.cwd(), "data", "app.sqlite"),
    path.join(process.cwd(), "db", "binary-analysis.sqlite"),
    path.join(process.cwd(), "db", "trades.sqlite"),
    path.join(process.cwd(), "trades.sqlite"),
    path.join(process.cwd(), "trade_history.sqlite"),
    path.join(process.cwd(), "database.sqlite"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (!p) continue;
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }

  // 既存APIと同じDBが候補名以外の場合の保険。
  const roots = [process.cwd(), path.join(process.cwd(), "data"), path.join(process.cwd(), "db")];
  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue;
      const files = fs.readdirSync(root);
      for (const file of files) {
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

  throw new Error(
    "trade_history を含むSQLite DBが見つかりません。TRADE_DB_PATH または SQLITE_DB_PATH にDBファイルのパスを設定してください。"
  );
}

function extractFeatureLabels(input: FeatureGateInput): Record<string, string> {
  const f = input.features ?? {};
  return {
    pair: norm(input.pair),
    direction: norm(input.direction),
    scoreBand: scoreBand(input.score),
    finalScoreBand: scoreBand(input.finalScore),
    weightScoreBand: scoreBand(input.weightScore),
    similarityScoreBand: scoreBand(input.similarityScore),
    emaTrend: norm(f.emaTrend ?? f.trend),
    rciDirection: norm(f.rciDirection),
    atrLevel: norm(f.atrLevel ?? f.volatilityLevel),
    smcStrength: norm(f.smcStrength),
    trend: norm(f.trend),
    marketPhase: norm(f.marketPhase),
    volatilityLevel: norm(f.volatilityLevel),
    session: norm(f.session),
    bos: toBoolLabel(f.bos),
    choch: toBoolLabel(f.choch),
    fvg: toBoolLabel(f.fvg),
    orderBlock: toBoolLabel(f.orderBlock),
    hour: norm(f.hour),
    weekday: norm(f.weekday),
  };
}

const COMBO_DEFINITIONS: Array<{ key: string; fields: string[] }> = [
  { key: "Score", fields: ["scoreBand"] },
  { key: "Final Score", fields: ["finalScoreBand"] },
  { key: "Similarity Score", fields: ["similarityScoreBand"] },
  { key: "EMA + SMC", fields: ["emaTrend", "smcStrength"] },
  { key: "EMA + BOS", fields: ["emaTrend", "bos"] },
  { key: "EMA + FVG", fields: ["emaTrend", "fvg"] },
  { key: "EMA + OrderBlock", fields: ["emaTrend", "orderBlock"] },
  { key: "EMA + RCI", fields: ["emaTrend", "rciDirection"] },
  { key: "EMA + ATR", fields: ["emaTrend", "atrLevel"] },
  { key: "BOS + FVG", fields: ["bos", "fvg"] },
  { key: "EMA + BOS + FVG", fields: ["emaTrend", "bos", "fvg"] },
  { key: "SMC + ATR", fields: ["smcStrength", "atrLevel"] },
  { key: "Session + Direction", fields: ["session", "direction"] },
  { key: "Weekday + Direction", fields: ["weekday", "direction"] },
];

function columnExpr(field: string): string {
  switch (field) {
    case "pair": return "COALESCE(pair, 'unknown')";
    case "direction": return "COALESCE(direction, 'unknown')";
    case "scoreBand": return "CASE WHEN score IS NULL THEN 'unknown' WHEN score < 70 THEN '0-69' WHEN score < 80 THEN '70-79' WHEN score < 90 THEN '80-89' ELSE '90-100' END";
    case "finalScoreBand": return "CASE WHEN final_score IS NULL THEN 'unknown' WHEN final_score < 70 THEN '0-69' WHEN final_score < 80 THEN '70-79' WHEN final_score < 90 THEN '80-89' ELSE '90-100' END";
    case "weightScoreBand": return "CASE WHEN weight_score IS NULL THEN 'unknown' WHEN weight_score < 70 THEN '0-69' WHEN weight_score < 80 THEN '70-79' WHEN weight_score < 90 THEN '80-89' ELSE '90-100' END";
    case "similarityScoreBand": return "CASE WHEN similarity_score IS NULL THEN 'unknown' WHEN similarity_score < 70 THEN '0-69' WHEN similarity_score < 80 THEN '70-79' WHEN similarity_score < 90 THEN '80-89' ELSE '90-100' END";
    case "emaTrend": return "COALESCE(trend, 'unknown')";
    case "trend": return "COALESCE(trend, 'unknown')";
    case "marketPhase": return "COALESCE(market_phase, 'unknown')";
    case "volatilityLevel": return "COALESCE(volatility_level, 'unknown')";
    case "session": return "COALESCE(session, 'unknown')";
    case "bos": return "CASE WHEN bos = 1 THEN 'ON' WHEN bos = 0 THEN 'OFF' ELSE 'unknown' END";
    case "choch": return "CASE WHEN choch = 1 THEN 'ON' WHEN choch = 0 THEN 'OFF' ELSE 'unknown' END";
    case "fvg": return "CASE WHEN fvg = 1 THEN 'ON' WHEN fvg = 0 THEN 'OFF' ELSE 'unknown' END";
    case "orderBlock": return "CASE WHEN order_block = 1 THEN 'ON' WHEN order_block = 0 THEN 'OFF' ELSE 'unknown' END";
    case "hour": return "COALESCE(CAST(hour AS TEXT), 'unknown')";
    case "weekday": return "COALESCE(CAST(weekday AS TEXT), 'unknown')";
    // rciDirection / atrLevel / smcStrength は古いDBでは標準カラムがないので feature_snapshot を使う。
    case "rciDirection": return "COALESCE(json_extract(feature_snapshot, '$.rciDirection'), 'unknown')";
    case "atrLevel": return "COALESCE(json_extract(feature_snapshot, '$.atrLevel'), COALESCE(volatility_level, 'unknown'))";
    case "smcStrength": return "COALESCE(json_extract(feature_snapshot, '$.smcStrength'), 'unknown')";
    default: return "'unknown'";
  }
}

function evaluateCandidate(key: string, label: string, row: any): FeatureGateCandidate {
  const totalTrades = Number(row?.totalTrades ?? 0);
  const wins = Number(row?.wins ?? 0);
  const losses = Number(row?.losses ?? 0);
  const totalProfit = Number(row?.totalProfit ?? 0);
  const winRate = totalTrades > 0 ? Number(((wins / totalTrades) * 100).toFixed(2)) : null;
  const avgProfit = totalTrades > 0 ? Number((totalProfit / totalTrades).toFixed(4)) : null;
  const overfitGuard: string[] = [];

  let confidence: FeatureGateCandidate["confidence"] = "none";
  if (totalTrades >= 50) confidence = "high";
  else if (totalTrades >= 30) confidence = "medium";
  else if (totalTrades >= 12) confidence = "low";

  let adjustment = 0;
  let action: FeatureGateCandidate["action"] = "IGNORE";

  const hardSkipByWinRate =
    winRate !== null &&
    totalTrades >= HARD_SKIP_MIN_SAMPLE_STRONG &&
    winRate < HARD_SKIP_WIN_RATE_STRONG &&
    totalProfit < 0;

  const hardSkipByProfit =
    winRate !== null &&
    totalTrades >= HARD_SKIP_MIN_SAMPLE_PROFIT &&
    winRate < HARD_SKIP_WIN_RATE_PROFIT &&
    totalProfit <= HARD_SKIP_TOTAL_PROFIT;

  if (totalTrades < MIN_SAMPLE_FOR_PENALTY) {
    overfitGuard.push(`サンプル不足: ${totalTrades}件。採用しない`);
  } else if (hardSkipByWinRate || hardSkipByProfit) {
    adjustment = -6;
    action = "SKIP_CANDIDATE";
    overfitGuard.push(
      hardSkipByWinRate
        ? `Danger Pattern Hard Gate: ${totalTrades}件 / 勝率${winRate}% / 損益${totalProfit.toFixed(2)} のため強制SKIP`
        : `Danger Pattern Hard Gate: ${totalTrades}件 / 勝率${winRate}% / 損益${totalProfit.toFixed(2)} <= ${HARD_SKIP_TOTAL_PROFIT} のため強制SKIP`
    );
  } else if (winRate !== null && winRate >= 60 && totalProfit > 0) {
    if (totalTrades >= MIN_SAMPLE_FOR_BONUS) {
      adjustment = winRate >= 68 ? 4 : 2;
      action = "BONUS";
    } else {
      overfitGuard.push(`勝率は高いが加点には不足: ${totalTrades}/${MIN_SAMPLE_FOR_BONUS}件`);
    }
  } else if (winRate !== null && (winRate < 50 || totalProfit < 0)) {
    adjustment = winRate < 45 && totalTrades >= MIN_SAMPLE_FOR_SKIP ? -6 : -3;
    action = adjustment <= -6 ? "SKIP_CANDIDATE" : "PENALTY";
  }

  if (winRate === 100 && totalTrades < MIN_SAMPLE_FOR_BONUS) {
    adjustment = Math.min(adjustment, 0);
    action = action === "BONUS" ? "IGNORE" : action;
    overfitGuard.push("少数サンプルの100%勝率は過信禁止");
  }

  return { key, label, totalTrades, wins, losses, winRate, totalProfit: Number(totalProfit.toFixed(4)), avgProfit, confidence, adjustment, action, overfitGuard };
}

export function previewFeatureWinRateGate(input: FeatureGateInput): FeatureWinRateGateResult {
  const dbPath = resolveDbPath();
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='trade_history'").get();
    if (!table) throw new Error("trade_history テーブルが見つかりません");

    const labels = extractFeatureLabels(input);
    const candidates: FeatureGateCandidate[] = [];

    for (const def of COMBO_DEFINITIONS) {
      const values = def.fields.map((field) => labels[field] ?? "unknown");
      if (values.some((v) => v === "unknown")) {
        candidates.push(evaluateCandidate(def.key, values.join(" + "), null));
        continue;
      }

      const where = def.fields.map((field, i) => `${columnExpr(field)} = @v${i}`).join(" AND ");
      const params = Object.fromEntries(values.map((v, i) => [`v${i}`, v]));

      const row = db.prepare(`
        SELECT
          COUNT(*) AS totalTrades,
          SUM(CASE WHEN UPPER(status) IN ('WON', 'WIN') OR profit > 0 THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN UPPER(status) IN ('LOST', 'LOSE') OR profit < 0 THEN 1 ELSE 0 END) AS losses,
          COALESCE(SUM(profit), 0) AS totalProfit
        FROM trade_history
        WHERE ${where}
      `).get(params);

      candidates.push(evaluateCandidate(def.key, values.join(" + "), row));
    }

    const applied = candidates.filter((c) => c.action !== "IGNORE" && c.adjustment !== 0);
    const totalAdjustmentRaw = applied.reduce((sum, c) => sum + c.adjustment, 0);
    const totalAdjustment = Math.max(-MAX_TOTAL_ADJUSTMENT, Math.min(MAX_TOTAL_ADJUSTMENT, totalAdjustmentRaw));
    const originalScore = toNumber(input.finalScore ?? input.score) ?? 0;
    const adjustedScore = Math.max(0, Math.min(100, originalScore + totalAdjustment));
    const skipCandidate = applied.some((c) => c.action === "SKIP_CANDIDATE");

    const reasons = [
      `Feature Gate Preview: ${candidates.length}条件を検証`,
      `補正合計: ${totalAdjustmentRaw} → 上限適用後 ${totalAdjustment}`,
      skipCandidate ? "Danger Pattern Hard Gate: 強制SKIP候補あり" : "強制SKIP候補なし",
    ];

    return {
      allow: !skipCandidate,
      originalScore,
      adjustedScore,
      totalAdjustment,
      candidates,
      applied,
      reasons,
      dbPath,
    };
  } finally {
    db.close();
  }
}
