import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { getEdgeCandidates, type EdgeCandidate } from "@/lib/learning/edgeCandidateTracker";

export type ValidationDirection = "FORWARD" | "REVERSE";
export type EdgeValidationStatus = "STABLE_WATCH" | "UNSTABLE" | "INSUFFICIENT" | "DUPLICATE";

export type EdgeCandidateValidationOptions = {
  minSample?: number;
  watchMinSample?: number;
  adoptMinSample?: number;
  watchEffectiveWinRate?: number;
  adoptEffectiveWinRate?: number;
  neutralEdgeThreshold?: number;
  candidateLimit?: number;
  limit?: number;
  includeUnknown?: boolean;
  includeDuplicates?: boolean;
  minValidationSample?: number;
  minFoldSample?: number;
  foldCount?: number;
  minStableWinRate?: number;
  minWilsonLowerBound?: number;
  overlapThreshold?: number;
};

type TradeRow = {
  id: number;
  status: string | null;
  profit: number | null;
  created_at: number | null;
};

export type ValidationSlice = {
  label: string;
  sample: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  profit: number;
  avgProfit: number;
  tradeIds: number[];
};

export type CandidateOverlap = {
  candidateId: string;
  key: string;
  jaccard: number;
  sharedTrades: number;
};

export type EdgeCandidateValidationItem = {
  id: string;
  key: string;
  kind: string;
  features: string[];
  values: string[];
  selectedDirection: ValidationDirection;
  sourceStatus: string;
  sourceClassification: string;
  sourcePriorityScore: number;
  sample: number;
  wins: number;
  losses: number;
  draws: number;
  rawWinRate: number;
  reverseWinRate: number;
  effectiveWinRate: number;
  directionalEdge: number;
  selectedProfit: number;
  avgSelectedProfit: number;
  wilsonLowerBound: number;
  firstHalf: ValidationSlice;
  secondHalf: ValidationSlice;
  folds: ValidationSlice[];
  passedFolds: number;
  maxOverlap: CandidateOverlap | null;
  duplicateOf: string | null;
  validationStatus: EdgeValidationStatus;
  priorityScore: number;
  reason: string;
  tradeIds: number[];
};

export type EdgeCandidateValidationResult = {
  generatedAt: string;
  totalTrades: number;
  usedTrades: number;
  dbPath: string;
  tableName: string;
  options: Required<EdgeCandidateValidationOptions>;
  validated: EdgeCandidateValidationItem[];
  stableWatch: EdgeCandidateValidationItem[];
  insufficient: EdgeCandidateValidationItem[];
  unstable: EdgeCandidateValidationItem[];
  duplicates: EdgeCandidateValidationItem[];
  message: string;
};

const DEFAULT_OPTIONS: Required<EdgeCandidateValidationOptions> = {
  minSample: 5,
  watchMinSample: 15,
  adoptMinSample: 50,
  watchEffectiveWinRate: 65,
  adoptEffectiveWinRate: 70,
  neutralEdgeThreshold: 10,
  candidateLimit: 150,
  limit: 100,
  includeUnknown: false,
  includeDuplicates: true,
  minValidationSample: 30,
  minFoldSample: 5,
  foldCount: 3,
  minStableWinRate: 55,
  minWilsonLowerBound: 45,
  overlapThreshold: 0.8,
};

const TABLE_NAME = "trade_history";

function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}

function resolveDbPath(): string {
  const candidates = [
    path.join(process.cwd(), "data", "ai.db"),
    path.join(process.cwd(), "data", "trades.db"),
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error("SQLite database not found. Expected ./data/ai.db.");
  }
  return found;
}

function openDb(): Database.Database {
  const dbPath = resolveDbPath();
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(TABLE_NAME) as { name: string } | undefined;

  if (!exists) {
    db.close();
    throw new Error("trade_history table not found in SQLite database.");
  }

  return db;
}

function parseProfit(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isForwardWin(row: TradeRow): boolean {
  const status = String(row.status ?? "").toUpperCase();
  if (status === "WON" || status === "WIN") return true;
  if (status === "LOST" || status === "LOSS") return false;
  return parseProfit(row.profit) > 0;
}

function isDraw(row: TradeRow): boolean {
  const status = String(row.status ?? "").toUpperCase();
  return status === "DRAW" || status === "TIE" || parseProfit(row.profit) === 0;
}

function selectedProfit(row: TradeRow, direction: ValidationDirection): number {
  const profit = parseProfit(row.profit);
  return direction === "REVERSE" ? -profit : profit;
}

function selectedWin(row: TradeRow, direction: ValidationDirection): boolean {
  if (isDraw(row)) return false;
  const forward = isForwardWin(row);
  return direction === "REVERSE" ? !forward : forward;
}

function buildSlice(label: string, rows: TradeRow[], direction: ValidationDirection): ValidationSlice {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let profit = 0;

  for (const row of rows) {
    profit += selectedProfit(row, direction);
    if (isDraw(row)) {
      draws += 1;
    } else if (selectedWin(row, direction)) {
      wins += 1;
    } else {
      losses += 1;
    }
  }

  const decisive = wins + losses;
  return {
    label,
    sample: rows.length,
    wins,
    losses,
    draws,
    winRate: decisive > 0 ? round((wins / decisive) * 100) : 0,
    profit: round(profit, 4),
    avgProfit: rows.length > 0 ? round(profit / rows.length, 4) : 0,
    tradeIds: rows.map((row) => row.id),
  };
}

function makeFolds(rows: TradeRow[], count: number): TradeRow[][] {
  const foldCount = Math.max(1, Math.floor(count));
  const folds: TradeRow[][] = [];
  for (let i = 0; i < foldCount; i += 1) {
    const start = Math.floor((rows.length * i) / foldCount);
    const end = Math.floor((rows.length * (i + 1)) / foldCount);
    folds.push(rows.slice(start, end));
  }
  return folds.filter((fold) => fold.length > 0);
}

function wilsonLowerBound(wins: number, total: number, z = 1.96): number {
  if (total <= 0) return 0;
  const p = wins / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  return round(((center - margin) / denominator) * 100);
}

function jaccard(a: number[], b: number[]): { score: number; shared: number } {
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const id of setA) {
    if (setB.has(id)) shared += 1;
  }
  const union = setA.size + setB.size - shared;
  return { score: union > 0 ? round(shared / union, 4) : 0, shared };
}

function validationReason(item: Omit<EdgeCandidateValidationItem, "reason">, options: Required<EdgeCandidateValidationOptions>): string {
  if (item.validationStatus === "DUPLICATE") {
    return `重複候補です。${item.duplicateOf ?? "上位候補"}と取引集合が大きく重なります。過学習防止のため単独採用しません。`;
  }

  if (item.validationStatus === "INSUFFICIENT") {
    return `サンプル${item.sample}件で検証最低件数${options.minValidationSample}件未満です。Edgeは監視しますが採用しません。`;
  }

  if (item.validationStatus === "UNSTABLE") {
    return `時系列検証が不安定です。後半勝率${item.secondHalf.winRate}%、通過Fold${item.passedFolds}/${item.folds.length}、Wilson下限${item.wilsonLowerBound}%のため採用しません。`;
  }

  return `前向き検証候補です。後半勝率${item.secondHalf.winRate}%、通過Fold${item.passedFolds}/${item.folds.length}、Wilson下限${item.wilsonLowerBound}%です。ただしTrading Engineには未接続です。`;
}

function fetchRowsForCandidate(db: Database.Database, candidate: EdgeCandidate): TradeRow[] {
  if (candidate.tradeIds.length === 0) return [];
  const placeholders = candidate.tradeIds.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT id, status, profit, created_at FROM ${TABLE_NAME} WHERE id IN (${placeholders}) ORDER BY created_at ASC, id ASC`)
    .all(...candidate.tradeIds) as TradeRow[];
  return rows;
}

function validateCandidate(
  candidate: EdgeCandidate,
  rows: TradeRow[],
  previous: EdgeCandidateValidationItem[],
  options: Required<EdgeCandidateValidationOptions>,
): EdgeCandidateValidationItem {
  const direction: ValidationDirection = candidate.selectedDirection === "REVERSE" ? "REVERSE" : "FORWARD";
  const midpoint = Math.floor(rows.length / 2);
  const firstHalf = buildSlice("first_half", rows.slice(0, midpoint), direction);
  const secondHalf = buildSlice("second_half", rows.slice(midpoint), direction);
  const folds = makeFolds(rows, options.foldCount).map((fold, index) => buildSlice(`fold_${index + 1}`, fold, direction));
  const totalSlice = buildSlice("all", rows, direction);
  const passedFolds = folds.filter(
    (fold) => fold.sample >= options.minFoldSample && fold.winRate >= options.minStableWinRate && fold.profit > 0,
  ).length;
  const wilson = wilsonLowerBound(totalSlice.wins, totalSlice.wins + totalSlice.losses);

  let maxOverlap: CandidateOverlap | null = null;
  let duplicateOf: string | null = null;
  for (const existing of previous) {
    const overlap = jaccard(candidate.tradeIds, existing.tradeIds);
    if (!maxOverlap || overlap.score > maxOverlap.jaccard) {
      maxOverlap = {
        candidateId: existing.id,
        key: existing.key,
        jaccard: overlap.score,
        sharedTrades: overlap.shared,
      };
    }
    if (overlap.score >= options.overlapThreshold) {
      duplicateOf = existing.id;
      break;
    }
  }

  let validationStatus: EdgeValidationStatus;
  if (duplicateOf !== null) {
    validationStatus = "DUPLICATE";
  } else if (rows.length < options.minValidationSample || secondHalf.sample < options.minFoldSample) {
    validationStatus = "INSUFFICIENT";
  } else if (
    secondHalf.winRate >= options.minStableWinRate &&
    secondHalf.profit > 0 &&
    passedFolds >= Math.max(1, Math.ceil(folds.length * 0.67)) &&
    wilson >= options.minWilsonLowerBound
  ) {
    validationStatus = "STABLE_WATCH";
  } else {
    validationStatus = "UNSTABLE";
  }

  const priorityScore = round(
    candidate.priorityScore +
      Math.max(secondHalf.winRate - 50, -20) * 1.5 +
      passedFolds * 3 +
      Math.max(wilson - 45, -20),
    4,
  );

  const withoutReason: Omit<EdgeCandidateValidationItem, "reason"> = {
    id: candidate.id,
    key: candidate.key,
    kind: candidate.kind,
    features: candidate.features,
    values: candidate.values,
    selectedDirection: direction,
    sourceStatus: candidate.status,
    sourceClassification: candidate.classification,
    sourcePriorityScore: candidate.priorityScore,
    sample: rows.length,
    wins: totalSlice.wins,
    losses: totalSlice.losses,
    draws: totalSlice.draws,
    rawWinRate: candidate.rawWinRate,
    reverseWinRate: candidate.reverseWinRate,
    effectiveWinRate: candidate.effectiveWinRate,
    directionalEdge: candidate.directionalEdge,
    selectedProfit: totalSlice.profit,
    avgSelectedProfit: totalSlice.avgProfit,
    wilsonLowerBound: wilson,
    firstHalf,
    secondHalf,
    folds,
    passedFolds,
    maxOverlap,
    duplicateOf,
    validationStatus,
    priorityScore,
    tradeIds: rows.map((row) => row.id),
  };

  return {
    ...withoutReason,
    reason: validationReason(withoutReason, options),
  };
}

export function validateEdgeCandidates(options: EdgeCandidateValidationOptions = {}): EdgeCandidateValidationResult {
  const resolved: Required<EdgeCandidateValidationOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  const candidateResult = getEdgeCandidates({
    minSample: resolved.minSample,
    watchMinSample: resolved.watchMinSample,
    adoptMinSample: resolved.adoptMinSample,
    watchEffectiveWinRate: resolved.watchEffectiveWinRate,
    adoptEffectiveWinRate: resolved.adoptEffectiveWinRate,
    neutralEdgeThreshold: resolved.neutralEdgeThreshold,
    limit: resolved.candidateLimit,
    includeUnknown: resolved.includeUnknown,
    includeBlock: false,
  });

  const dbPath = resolveDbPath();
  const db = openDb();
  try {
    const validated: EdgeCandidateValidationItem[] = [];
    for (const candidate of candidateResult.candidates) {
      const rows = fetchRowsForCandidate(db, candidate);
      const item = validateCandidate(candidate, rows, validated, resolved);
      if (resolved.includeDuplicates || item.validationStatus !== "DUPLICATE") {
        validated.push(item);
      }
    }

    const sorted = validated
      .sort((a, b) => {
        const rank = (status: EdgeValidationStatus): number => {
          if (status === "STABLE_WATCH") return 0;
          if (status === "INSUFFICIENT") return 1;
          if (status === "UNSTABLE") return 2;
          return 3;
        };
        const statusDiff = rank(a.validationStatus) - rank(b.validationStatus);
        if (statusDiff !== 0) return statusDiff;
        if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
        if (b.directionalEdge !== a.directionalEdge) return b.directionalEdge - a.directionalEdge;
        return b.sample - a.sample;
      })
      .slice(0, resolved.limit);

    return {
      generatedAt: new Date().toISOString(),
      totalTrades: candidateResult.totalTrades,
      usedTrades: candidateResult.usedTrades,
      dbPath,
      tableName: TABLE_NAME,
      options: resolved,
      validated: sorted,
      stableWatch: sorted.filter((item) => item.validationStatus === "STABLE_WATCH"),
      insufficient: sorted.filter((item) => item.validationStatus === "INSUFFICIENT"),
      unstable: sorted.filter((item) => item.validationStatus === "UNSTABLE"),
      duplicates: sorted.filter((item) => item.validationStatus === "DUPLICATE"),
      message: "Edge候補を重複・時系列・Walk-Forward・Wilson下限で検証しました。Trading Engineには接続していません。",
    };
  } finally {
    db.close();
  }
}
