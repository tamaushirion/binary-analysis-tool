import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

type Direction = "HIGH" | "LOW";
type Result = "WIN" | "LOST" | "DRAW";
type FoldName = "TRAIN" | "VALIDATION_A" | "VALIDATION_B" | "RECENT";
type Classification = "FOCUSED_STRONG" | "FOCUSED_STABLE" | "IMPROVED_WATCH" | "NO_IMPROVEMENT" | "REJECT";

export type MarketObservationFocusedTripleEdgeOptions = {
  dbPath?: string;
  featureVersion?: string;
  minDecided?: number;
  minFoldDecided?: number;
  minSegmentWinRate?: number;
  persistentWinRate?: number;
  minWilsonLowerBound?: number;
  maxSegmentGap?: number;
  recentWindow?: number;
  minWinRateImprovement?: number;
  minWilsonImprovement?: number;
  minOccurrenceRate?: number;
  limit?: number;
};

type Row = {
  id: number; epoch: number;
  high_result: string; low_result: string;
  high_profit: number | null; low_profit: number | null;
  high_score: number | null; low_score: number | null;
  selected_score: number | null; selected_direction: string | null;
  ema_diff: number | null; rci9: number | null; rci26: number | null; rci52: number | null;
  atr: number | null; trend: string | null; session: string | null;
  hour: number | null; weekday: number | null;
  bos: number | null; choch: number | null; fvg: number | null; smc_score: number | null;
  backtest_win_rate_1m: number | null; backtest_win_rate_3m: number | null;
};

type ParsedRow = Row & {
  highStatus: Result; lowStatus: Result;
  highProfitValue: number; lowProfitValue: number;
  features: string[];
};

type Stats = {
  sample: number; decided: number; wins: number; losses: number; draws: number;
  winRate: number | null; profit: number; avgProfit: number | null; wilsonLowerBound: number | null;
};

type FoldStats = Stats & { name: FoldName };

type ParentDefinition = {
  id: string;
  values: [string, string];
  executionDirection: Direction;
};

export type FocusedTripleCandidate = {
  parentId: string;
  parentValues: string[];
  addedValue: string;
  values: string[];
  executionDirection: Direction;
  sample: number;
  decided: number;
  overallWinRate: number | null;
  firstHalfWinRate: number | null;
  secondHalfWinRate: number | null;
  recent100WinRate: number | null;
  folds: FoldStats[];
  totalProfit: number;
  avgProfit: number | null;
  wilsonLowerBound: number | null;
  minSegmentWinRate: number | null;
  maxSegmentWinRateGap: number | null;
  occurrenceRate: number;
  riskNote: string | null;
  parentDecided: number;
  parentWinRate: number | null;
  parentProfit: number;
  parentWilsonLowerBound: number | null;
  winRateImprovement: number | null;
  profitImprovement: number;
  wilsonImprovement: number | null;
  retentionRate: number;
  classification: Classification;
  score: number;
  reasons: string[];
};

export type MarketObservationFocusedTripleEdgeResult = {
  ok: true;
  stage: "market_observation_focused_triple_edge_discovery";
  generatedAt: string;
  dbPath: string;
  featureVersion: string;
  totalRecords: number;
  options: Required<MarketObservationFocusedTripleEdgeOptions>;
  parents: Array<{
    id: string; values: string[]; executionDirection: Direction;
    decided: number; winRate: number | null; profit: number; wilsonLowerBound: number | null;
  }>;
  summary: {
    generatedCandidates: number;
    evaluatedCandidates: number;
    focusedStrong: number;
    focusedStable: number;
    improvedWatch: number;
    noImprovement: number;
    reject: number;
    futureLeakageRiskCandidates: number;
  };
  rankings: {
    stability: FocusedTripleCandidate[];
    winRate: FocusedTripleCandidate[];
    profit: FocusedTripleCandidate[];
    improvement: FocusedTripleCandidate[];
    frequency: FocusedTripleCandidate[];
  };
  candidates: FocusedTripleCandidate[];
  message: string;
};

const TABLE = "market_observations";
const FEATURE_VERSION = "phase16-k-market-observation-v1";

const PARENTS: ParentDefinition[] = [
  {
    id: "atr_normal_rci52_strong_up_high",
    values: ["ATR:NORMAL(0.4-0.79)", "RCI52:STRONG_UP(50-79)"],
    executionDirection: "HIGH",
  },
  {
    id: "rci26_strong_up_rci52_strong_down_high",
    values: ["RCI26:STRONG_UP(50-79)", "RCI52:STRONG_DOWN(-79--50)"],
    executionDirection: "HIGH",
  },
];

const DEFAULTS: Required<MarketObservationFocusedTripleEdgeOptions> = {
  dbPath: "",
  featureVersion: FEATURE_VERSION,
  minDecided: 100,
  minFoldDecided: 15,
  minSegmentWinRate: 55,
  persistentWinRate: 58,
  minWilsonLowerBound: 50,
  maxSegmentGap: 12,
  recentWindow: 100,
  minWinRateImprovement: 1,
  minWilsonImprovement: 0,
  minOccurrenceRate: 0.5,
  limit: 50,
};

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function round(v: number, d = 2): number {
  const b = 10 ** d;
  return Math.round(v * b) / b;
}
function bounded(v: unknown, fallback: number, min: number, max: number): number {
  const n = finite(v);
  return n === null ? fallback : Math.min(max, Math.max(min, n));
}
function integer(v: unknown, fallback: number, min: number, max: number): number {
  return Math.floor(bounded(v, fallback, min, max));
}
function resolveDbPath(input?: string): string {
  if (input?.trim()) return path.resolve(input.trim());
  const candidates = [path.join(process.cwd(), "data", "ai.db"), path.join(process.cwd(), "..", "data", "ai.db")];
  const found = candidates.find(fs.existsSync);
  if (!found) throw new Error(`SQLite database not found. Checked: ${candidates.join(", ")}`);
  return found;
}
function options(input?: MarketObservationFocusedTripleEdgeOptions): Required<MarketObservationFocusedTripleEdgeOptions> {
  return {
    dbPath: resolveDbPath(input?.dbPath),
    featureVersion: input?.featureVersion?.trim() || DEFAULTS.featureVersion,
    minDecided: integer(input?.minDecided, DEFAULTS.minDecided, 20, 1000000),
    minFoldDecided: integer(input?.minFoldDecided, DEFAULTS.minFoldDecided, 1, 100000),
    minSegmentWinRate: bounded(input?.minSegmentWinRate, DEFAULTS.minSegmentWinRate, 50, 100),
    persistentWinRate: bounded(input?.persistentWinRate, DEFAULTS.persistentWinRate, 50, 100),
    minWilsonLowerBound: bounded(input?.minWilsonLowerBound, DEFAULTS.minWilsonLowerBound, 0, 100),
    maxSegmentGap: bounded(input?.maxSegmentGap, DEFAULTS.maxSegmentGap, 0, 50),
    recentWindow: integer(input?.recentWindow, DEFAULTS.recentWindow, 20, 10000),
    minWinRateImprovement: bounded(input?.minWinRateImprovement, DEFAULTS.minWinRateImprovement, -20, 20),
    minWilsonImprovement: bounded(input?.minWilsonImprovement, DEFAULTS.minWilsonImprovement, -20, 20),
    minOccurrenceRate: bounded(input?.minOccurrenceRate, DEFAULTS.minOccurrenceRate, 0, 100),
    limit: integer(input?.limit, DEFAULTS.limit, 1, 500),
  };
}
function normalize(v: string): Result {
  return v === "WIN" || v === "LOST" || v === "DRAW" ? v : "DRAW";
}
function safeText(v: string | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.toUpperCase() : null;
}
function band(prefix: string, v: number | null, width = 10): string | null {
  const n = finite(v);
  if (n === null) return null;
  const lower = Math.floor(n / width) * width;
  return `${prefix}:${lower}-${lower + width - 1}`;
}
function signedBand(prefix: string, v: number | null): string | null {
  const n = finite(v);
  if (n === null) return null;
  if (n <= -80) return `${prefix}:OVERSOLD(<=-80)`;
  if (n <= -50) return `${prefix}:STRONG_DOWN(-79--50)`;
  if (n < 50) return `${prefix}:NEUTRAL(-49-49)`;
  if (n < 80) return `${prefix}:STRONG_UP(50-79)`;
  return `${prefix}:OVERBOUGHT(>=80)`;
}
function emaLabel(v: number | null): string | null {
  const n = finite(v);
  if (n === null) return null;
  if (Math.abs(n) < 0.05) return "EMA:FLAT";
  return n > 0 ? "EMA:UP" : "EMA:DOWN";
}
function atrLabel(v: number | null): string | null {
  const n = finite(v);
  if (n === null) return null;
  if (n < 0.4) return "ATR:LOW(<0.4)";
  if (n < 0.8) return "ATR:NORMAL(0.4-0.79)";
  if (n < 1.2) return "ATR:HIGH(0.8-1.19)";
  return "ATR:EXTREME(>=1.2)";
}
function boolLabel(prefix: string, v: number | null): string | null {
  const n = finite(v);
  return n === null ? null : `${prefix}:${n !== 0 ? "YES" : "NO"}`;
}
function features(row: Row): string[] {
  const trend = safeText(row.trend);
  const session = safeText(row.session);
  const values: Array<string | null> = [
    emaLabel(row.ema_diff), atrLabel(row.atr),
    signedBand("RCI9", row.rci9), signedBand("RCI26", row.rci26), signedBand("RCI52", row.rci52),
    trend ? `Trend:${trend}` : null, session ? `Session:${session}` : null,
    finite(row.hour) !== null ? `Hour:${Math.trunc(row.hour as number)}` : null,
    finite(row.weekday) !== null ? `Weekday:${Math.trunc(row.weekday as number)}` : null,
    band("HighScore", row.high_score), band("LowScore", row.low_score), band("SelectedScore", row.selected_score),
    row.selected_direction === "HIGH" || row.selected_direction === "LOW" ? `SelectedDirection:${row.selected_direction}` : null,
    boolLabel("BOS", row.bos), boolLabel("CHOCH", row.choch), boolLabel("FVG", row.fvg),
    band("SMCScore", row.smc_score),
    band("Backtest1m", row.backtest_win_rate_1m, 5), band("Backtest3m", row.backtest_win_rate_3m, 5),
  ];
  return values.filter((v): v is string => v !== null);
}
function featureName(v: string): string {
  const i = v.indexOf(":");
  return i >= 0 ? v.slice(0, i) : v;
}
function wilson(wins: number, total: number, z = 1.96): number | null {
  if (total <= 0) return null;
  const p = wins / total;
  const den = 1 + z * z / total;
  const centre = p + z * z / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total);
  return round(((centre - margin) / den) * 100, 2);
}
function stats(rows: ParsedRow[], direction: Direction): Stats {
  let wins = 0, losses = 0, draws = 0, profit = 0;
  for (const row of rows) {
    const result = direction === "HIGH" ? row.highStatus : row.lowStatus;
    profit += direction === "HIGH" ? row.highProfitValue : row.lowProfitValue;
    if (result === "WIN") wins += 1;
    else if (result === "LOST") losses += 1;
    else draws += 1;
  }
  const decided = wins + losses;
  return {
    sample: rows.length, decided, wins, losses, draws,
    winRate: decided ? round(wins / decided * 100, 2) : null,
    profit: round(profit, 4),
    avgProfit: decided ? round(profit / decided, 4) : null,
    wilsonLowerBound: wilson(wins, decided),
  };
}
function foldBounds(length: number) {
  return { train: Math.floor(length * 0.4), va: Math.floor(length * 0.6), vb: Math.floor(length * 0.8) };
}
function foldStats(rows: ParsedRow[], direction: Direction, indexById: Map<number, number>, total: number): FoldStats[] {
  const b = foldBounds(total);
  const defs: Array<[FoldName, (i: number) => boolean]> = [
    ["TRAIN", i => i < b.train],
    ["VALIDATION_A", i => i >= b.train && i < b.va],
    ["VALIDATION_B", i => i >= b.va && i < b.vb],
    ["RECENT", i => i >= b.vb],
  ];
  return defs.map(([name, predicate]) => ({ name, ...stats(rows.filter(r => predicate(indexById.get(r.id) ?? -1)), direction) }));
}
function riskNote(values: string[]): string | null {
  const risky = values.filter(v => v.startsWith("Backtest1m:") || v.startsWith("Backtest3m:"));
  return risky.length ? `${risky.join(" / ")}を使用。未来情報混入リスク未確認のため自動強候補・Demo接続候補から除外。` : null;
}
function loadRows(db: Database.Database, featureVersion: string): Row[] {
  return db.prepare(`
    SELECT id, epoch, high_result, low_result, high_profit, low_profit,
      high_score, low_score, selected_score, selected_direction,
      ema_diff, rci9, rci26, rci52, atr, trend, session, hour, weekday,
      bos, choch, fvg, smc_score, backtest_win_rate_1m, backtest_win_rate_3m
    FROM ${TABLE}
    WHERE feature_version = ?
      AND high_result IN ('WIN','LOST','DRAW')
      AND low_result IN ('WIN','LOST','DRAW')
    ORDER BY epoch ASC, id ASC
  `).all(featureVersion) as Row[];
}
function classify(
  candidate: Omit<FocusedTripleCandidate, "classification" | "score" | "reasons">,
  o: Required<MarketObservationFocusedTripleEdgeOptions>,
): Pick<FocusedTripleCandidate, "classification" | "score" | "reasons"> {
  const reasons: string[] = [];
  const rates = [
    candidate.overallWinRate, candidate.firstHalfWinRate, candidate.secondHalfWinRate,
    candidate.recent100WinRate, ...candidate.folds.map(f => f.winRate),
  ];
  const complete = rates.filter((r): r is number => r !== null);
  const enough = candidate.decided >= o.minDecided;
  const foldsEnough = candidate.folds.every(f => f.decided >= o.minFoldDecided);
  const baseStable = rates.every(r => r !== null && r >= o.minSegmentWinRate);
  const persistent = rates.every(r => r !== null && r >= o.persistentWinRate);
  const profitable = candidate.totalProfit > 0;
  const foldsProfitable = candidate.folds.every(f => f.profit > 0);
  const wilsonOkay = (candidate.wilsonLowerBound ?? 0) >= o.minWilsonLowerBound;
  const gapOkay = candidate.maxSegmentWinRateGap !== null && candidate.maxSegmentWinRateGap <= o.maxSegmentGap;
  const improved = (candidate.winRateImprovement ?? -999) >= o.minWinRateImprovement;
  const wilsonImproved = (candidate.wilsonImprovement ?? -999) >= o.minWilsonImprovement;
  const occurrenceOkay = candidate.occurrenceRate >= o.minOccurrenceRate;
  const safe = candidate.riskNote === null;

  if (!enough) reasons.push(`最低${o.minDecided}決着に未達。`);
  if (!foldsEnough) reasons.push("4区間の決着件数不足。");
  if (!baseStable) reasons.push(`全評価区間で${o.minSegmentWinRate}%以上を維持していない。`);
  if (!profitable || !foldsProfitable) reasons.push("全体または検証区間にProfitマイナスあり。");
  if (!wilsonOkay) reasons.push(`Wilson下限${o.minWilsonLowerBound}%未満。`);
  if (!gapOkay) reasons.push(`最大区間差${o.maxSegmentGap}ポイント超過。`);
  if (!improved) reasons.push(`親候補から勝率${o.minWinRateImprovement}ポイント以上改善していない。`);
  if (!wilsonImproved) reasons.push("親候補よりWilson下限が改善していない。");
  if (!occurrenceOkay) reasons.push(`occurrence rate ${o.minOccurrenceRate}%未満。`);
  if (!safe) reasons.push("Backtest特徴量を含むため自動強候補対象外。");

  const avg = complete.length ? complete.reduce((a, b) => a + b, 0) / complete.length : 0;
  const score = round(
    avg - (candidate.maxSegmentWinRateGap ?? 50) * 0.9
    + Math.min(8, Math.log10(Math.max(10, candidate.decided)) * 3)
    + Math.max(0, candidate.winRateImprovement ?? 0) * 1.5
    + Math.max(0, candidate.wilsonImprovement ?? 0),
    3,
  );

  if (enough && foldsEnough && persistent && profitable && foldsProfitable && wilsonOkay && gapOkay && improved && wilsonImproved && occurrenceOkay && safe)
    return { classification: "FOCUSED_STRONG", score, reasons: ["全区間58%以上かつ親候補より改善し、過学習防止基準を通過。"] };
  if (enough && foldsEnough && baseStable && profitable && wilsonOkay && gapOkay && improved && wilsonImproved && occurrenceOkay && safe)
    return { classification: "FOCUSED_STABLE", score, reasons: ["全区間55%以上かつ親候補より改善し、安定基準を通過。"] };
  if (enough && profitable && improved && safe)
    return { classification: "IMPROVED_WATCH", score, reasons };
  if (enough && safe)
    return { classification: "NO_IMPROVEMENT", score, reasons };
  return { classification: "REJECT", score, reasons };
}

export function discoverMarketObservationFocusedTripleEdges(
  input?: MarketObservationFocusedTripleEdgeOptions,
): MarketObservationFocusedTripleEdgeResult {
  const o = options(input);
  const db = new Database(o.dbPath, { readonly: true });
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(TABLE) as {name?: string}|undefined;
    if (!table?.name) throw new Error("market_observations table not found.");

    const raw = loadRows(db, o.featureVersion);
    const rows: ParsedRow[] = raw.map(row => ({
      ...row,
      highStatus: normalize(row.high_result), lowStatus: normalize(row.low_result),
      highProfitValue: finite(row.high_profit) ?? 0, lowProfitValue: finite(row.low_profit) ?? 0,
      features: features(row),
    }));
    const indexById = new Map(rows.map((r, i) => [r.id, i]));

    const parentOutputs = PARENTS.map(parent => {
      const parentRows = rows.filter(r => parent.values.every(v => r.features.includes(v)));
      return { parent, rows: parentRows, stats: stats(parentRows, parent.executionDirection) };
    });

    const candidates: FocusedTripleCandidate[] = [];
    let generatedCandidates = 0;

    for (const parentOutput of parentOutputs) {
      const parentFeatureNames = new Set(parentOutput.parent.values.map(featureName));
      const addedValues = new Set<string>();
      for (const row of parentOutput.rows) {
        for (const value of row.features) {
          if (!parentFeatureNames.has(featureName(value))) addedValues.add(value);
        }
      }

      for (const addedValue of addedValues) {
        generatedCandidates += 1;
        const values = [...parentOutput.parent.values, addedValue];
        const matched = parentOutput.rows.filter(r => r.features.includes(addedValue));
        if (matched.length < o.minDecided) continue;

        const overall = stats(matched, parentOutput.parent.executionDirection);
        if (overall.decided < o.minDecided) continue;

        const half = Math.floor(matched.length / 2);
        const first = stats(matched.slice(0, half), parentOutput.parent.executionDirection);
        const second = stats(matched.slice(half), parentOutput.parent.executionDirection);
        const recent = stats(matched.slice(-Math.min(o.recentWindow, matched.length)), parentOutput.parent.executionDirection);
        const folds = foldStats(matched, parentOutput.parent.executionDirection, indexById, rows.length);
        const segmentRates = [first.winRate, second.winRate, recent.winRate, ...folds.map(f => f.winRate)]
          .filter((r): r is number => r !== null);
        const minRate = segmentRates.length === 7 ? Math.min(...segmentRates) : null;
        const maxRate = segmentRates.length === 7 ? Math.max(...segmentRates) : null;
        const gap = minRate === null || maxRate === null ? null : round(maxRate - minRate, 2);
        const note = riskNote(values);

        const base: Omit<FocusedTripleCandidate, "classification" | "score" | "reasons"> = {
          parentId: parentOutput.parent.id,
          parentValues: parentOutput.parent.values,
          addedValue,
          values,
          executionDirection: parentOutput.parent.executionDirection,
          sample: overall.sample,
          decided: overall.decided,
          overallWinRate: overall.winRate,
          firstHalfWinRate: first.winRate,
          secondHalfWinRate: second.winRate,
          recent100WinRate: recent.winRate,
          folds,
          totalProfit: overall.profit,
          avgProfit: overall.avgProfit,
          wilsonLowerBound: overall.wilsonLowerBound,
          minSegmentWinRate: minRate,
          maxSegmentWinRateGap: gap,
          occurrenceRate: rows.length ? round(overall.sample / rows.length * 100, 4) : 0,
          riskNote: note,
          parentDecided: parentOutput.stats.decided,
          parentWinRate: parentOutput.stats.winRate,
          parentProfit: parentOutput.stats.profit,
          parentWilsonLowerBound: parentOutput.stats.wilsonLowerBound,
          winRateImprovement: overall.winRate === null || parentOutput.stats.winRate === null ? null : round(overall.winRate - parentOutput.stats.winRate, 2),
          profitImprovement: round(overall.profit - parentOutput.stats.profit, 4),
          wilsonImprovement: overall.wilsonLowerBound === null || parentOutput.stats.wilsonLowerBound === null ? null : round(overall.wilsonLowerBound - parentOutput.stats.wilsonLowerBound, 2),
          retentionRate: parentOutput.stats.decided ? round(overall.decided / parentOutput.stats.decided * 100, 2) : 0,
        };
        candidates.push({ ...base, ...classify(base, o) });
      }
    }

    const priority: Record<Classification, number> = {
      FOCUSED_STRONG: 5, FOCUSED_STABLE: 4, IMPROVED_WATCH: 3, NO_IMPROVEMENT: 2, REJECT: 1,
    };
    const baseSort = (a: FocusedTripleCandidate, b: FocusedTripleCandidate) =>
      priority[b.classification] - priority[a.classification] || b.score - a.score ||
      (b.overallWinRate ?? -1) - (a.overallWinRate ?? -1) || b.decided - a.decided;

    const take = (sorter: (a: FocusedTripleCandidate, b: FocusedTripleCandidate) => number) =>
      [...candidates].sort(sorter).slice(0, o.limit);

    return {
      ok: true,
      stage: "market_observation_focused_triple_edge_discovery",
      generatedAt: new Date().toISOString(),
      dbPath: o.dbPath,
      featureVersion: o.featureVersion,
      totalRecords: rows.length,
      options: o,
      parents: parentOutputs.map(p => ({
        id: p.parent.id, values: p.parent.values, executionDirection: p.parent.executionDirection,
        decided: p.stats.decided, winRate: p.stats.winRate, profit: p.stats.profit, wilsonLowerBound: p.stats.wilsonLowerBound,
      })),
      summary: {
        generatedCandidates,
        evaluatedCandidates: candidates.length,
        focusedStrong: candidates.filter(c => c.classification === "FOCUSED_STRONG").length,
        focusedStable: candidates.filter(c => c.classification === "FOCUSED_STABLE").length,
        improvedWatch: candidates.filter(c => c.classification === "IMPROVED_WATCH").length,
        noImprovement: candidates.filter(c => c.classification === "NO_IMPROVEMENT").length,
        reject: candidates.filter(c => c.classification === "REJECT").length,
        futureLeakageRiskCandidates: candidates.filter(c => c.riskNote !== null).length,
      },
      rankings: {
        stability: take(baseSort),
        winRate: take((a,b) => (b.overallWinRate ?? -1) - (a.overallWinRate ?? -1) || (b.wilsonLowerBound ?? -1) - (a.wilsonLowerBound ?? -1) || b.decided - a.decided),
        profit: take((a,b) => b.totalProfit - a.totalProfit || (b.overallWinRate ?? -1) - (a.overallWinRate ?? -1)),
        improvement: take((a,b) => (b.winRateImprovement ?? -999) - (a.winRateImprovement ?? -999) || (b.wilsonImprovement ?? -999) - (a.wilsonImprovement ?? -999) || b.decided - a.decided),
        frequency: take((a,b) => b.occurrenceRate - a.occurrenceRate || b.decided - a.decided),
      },
      candidates: [...candidates].sort(baseSort),
      message: "Phase16-Tで得た有望2条件を親として第3条件のみ追加探索しました。親候補との勝率・Wilson・Profit・保持率を比較し、同一データ内の改善候補選定までを行います。前向き検証・Demo2・Trading Engine・Deriv APIには接続していません。",
    };
  } finally {
    db.close();
  }
}
