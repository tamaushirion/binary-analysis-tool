import Database from "better-sqlite3";
import path from "path";

export type ForwardValidationAdoptionStatus = "INSUFFICIENT" | "WATCH" | "STABLE" | "REJECT";

export type ForwardValidationAdoptionOptions = {
  watchMinSample?: number;
  stableMinSample?: number;
  matureMinSample?: number;
  stableWinRate?: number;
  watchWinRate?: number;
  rejectMaxSample?: number;
  rejectWinRate?: number;
  minProfit?: number;
  minWilsonLowerBound?: number;
  limit?: number;
  includePending?: boolean;
};

type Row = Record<string, unknown>;

export type ForwardValidationAdoptionItem = {
  candidateId: string;
  candidateKey: string;
  selectedDirection: string;
  status: ForwardValidationAdoptionStatus;
  settled: number;
  pending: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number | null;
  totalProfit: number;
  avgProfit: number | null;
  wilsonLowerBound: number | null;
  sampleStage: "EMPTY" | "EARLY" | "WATCH_30" | "STABLE_50" | "MATURE_100";
  canUseForDemo: boolean;
  canUseForTradingEngine: false;
  latestCreatedAt: number | null;
  latestSettledAt: number | null;
  reason: string;
};

export type ForwardValidationAdoptionResult = {
  generatedAt: string;
  dbPath: string;
  tableName: "forward_validation_records";
  tableExists: boolean;
  totalRecords: number;
  pendingRecords: number;
  settledRecords: number;
  options: Required<ForwardValidationAdoptionOptions>;
  stable: ForwardValidationAdoptionItem[];
  watch: ForwardValidationAdoptionItem[];
  insufficient: ForwardValidationAdoptionItem[];
  reject: ForwardValidationAdoptionItem[];
  all: ForwardValidationAdoptionItem[];
  message: string;
};

const TABLE_NAME = "forward_validation_records" as const;

function getDbPath(): string {
  return path.join(process.cwd(), "data", "ai.db");
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = toNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function toText(value: unknown, fallback = "unknown"): string {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName) as { name?: string } | undefined;
  return row?.name === tableName;
}

function pick(row: Row, keys: string[], fallback: unknown = null): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const value = row[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  return fallback;
}

function getStatus(row: Row): "PENDING" | "SETTLED" | "EXPIRED" {
  const raw = toText(pick(row, ["status", "settle_status", "record_status"], "pending"), "pending").toUpperCase();
  if (raw === "SETTLED" || raw === "WIN" || raw === "WON" || raw === "LOST" || raw === "LOSS" || raw === "DRAW") return "SETTLED";
  if (raw === "EXPIRED") return "EXPIRED";
  return "PENDING";
}

function getResult(row: Row): "WIN" | "LOSS" | "DRAW" | null {
  const explicitResult = toText(pick(row, ["result", "outcome", "trade_result"], ""), "").toUpperCase();
  if (explicitResult === "WIN" || explicitResult === "WON") return "WIN";
  if (explicitResult === "LOSS" || explicitResult === "LOST") return "LOSS";
  if (explicitResult === "DRAW") return "DRAW";

  const statusResult = toText(pick(row, ["status", "settle_status", "record_status"], ""), "").toUpperCase();
  if (statusResult === "WIN" || statusResult === "WON") return "WIN";
  if (statusResult === "LOSS" || statusResult === "LOST") return "LOSS";
  if (statusResult === "DRAW") return "DRAW";

  const profit = toNullableNumber(pick(row, ["result_profit", "profit", "selected_profit", "virtual_profit"]));
  if (profit === null) return null;
  if (profit > 0) return "WIN";
  if (profit < 0) return "LOSS";
  return "DRAW";
}

function wilsonLowerBound(wins: number, losses: number, confidenceZ = 1.96): number | null {
  const n = wins + losses;
  if (n <= 0) return null;
  const p = wins / n;
  const z2 = confidenceZ * confidenceZ;
  const denominator = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = confidenceZ * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return round2(((center - margin) / denominator) * 100);
}

function getSampleStage(settled: number, stableMinSample: number, matureMinSample: number, watchMinSample: number): ForwardValidationAdoptionItem["sampleStage"] {
  if (settled <= 0) return "EMPTY";
  if (settled >= matureMinSample) return "MATURE_100";
  if (settled >= stableMinSample) return "STABLE_50";
  if (settled >= watchMinSample) return "WATCH_30";
  return "EARLY";
}

type MutableItem = Omit<ForwardValidationAdoptionItem, "status" | "winRate" | "avgProfit" | "wilsonLowerBound" | "sampleStage" | "canUseForDemo" | "reason"> & {
  status?: ForwardValidationAdoptionStatus;
  winRate?: number | null;
  avgProfit?: number | null;
  wilsonLowerBound?: number | null;
  sampleStage?: ForwardValidationAdoptionItem["sampleStage"];
  canUseForDemo?: boolean;
  reason?: string;
};

function buildItems(rows: Row[], options: Required<ForwardValidationAdoptionOptions>): ForwardValidationAdoptionItem[] {
  const map = new Map<string, MutableItem>();

  for (const row of rows) {
    const candidateId = toText(pick(row, ["candidate_id", "candidateId", "edge_id"], "unknown"), "unknown");
    const candidateKey = toText(pick(row, ["candidate_key", "candidateKey", "key"], candidateId), candidateId);
    const selectedDirection = toText(pick(row, ["selected_direction", "selectedDirection", "direction"], "unknown"), "unknown");
    const mapKey = `${candidateId}::${candidateKey}::${selectedDirection}`;
    const status = getStatus(row);
    const result = getResult(row);
    const profit = toNullableNumber(pick(row, ["result_profit", "profit", "selected_profit", "virtual_profit"])) ?? 0;
    const createdAt = toNullableNumber(pick(row, ["created_at", "createdAt", "entry_time"]));
    const settledAt = toNullableNumber(pick(row, ["settled_at", "settledAt", "exit_time"]));

    if (!options.includePending && status === "PENDING") continue;

    const item =
      map.get(mapKey) ??
      ({
        candidateId,
        candidateKey,
        selectedDirection,
        settled: 0,
        pending: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        totalProfit: 0,
        latestCreatedAt: null,
        latestSettledAt: null,
        canUseForTradingEngine: false,
      } satisfies MutableItem);

    if (status === "PENDING") item.pending += 1;
    if (status === "SETTLED") {
      item.settled += 1;
      item.totalProfit += profit;
      if (result === "WIN") item.wins += 1;
      else if (result === "LOSS") item.losses += 1;
      else if (result === "DRAW") item.draws += 1;
    }

    if (createdAt !== null) item.latestCreatedAt = Math.max(item.latestCreatedAt ?? createdAt, createdAt);
    if (settledAt !== null) item.latestSettledAt = Math.max(item.latestSettledAt ?? settledAt, settledAt);

    map.set(mapKey, item);
  }

  return Array.from(map.values()).map((item) => finalizeItem(item, options));
}

function finalizeItem(item: MutableItem, options: Required<ForwardValidationAdoptionOptions>): ForwardValidationAdoptionItem {
  const decisionCount = item.wins + item.losses;
  const winRate = decisionCount > 0 ? round2((item.wins / decisionCount) * 100) : null;
  const avgProfit = item.settled > 0 ? round2(item.totalProfit / item.settled) : null;
  const lowerBound = wilsonLowerBound(item.wins, item.losses);
  const sampleStage = getSampleStage(item.settled, options.stableMinSample, options.matureMinSample, options.watchMinSample);

  let status: ForwardValidationAdoptionStatus = "INSUFFICIENT";
  let canUseForDemo = false;
  let reason = "前向き検証データが不足しています。";

  const hasWinRate = winRate !== null;
  const hasLowerBound = lowerBound !== null;
  const profitOk = item.totalProfit >= options.minProfit;
  const stableByRate = hasWinRate && winRate >= options.stableWinRate;
  const watchByRate = hasWinRate && winRate >= options.watchWinRate;
  const lowerBoundOk = hasLowerBound && lowerBound >= options.minWilsonLowerBound;

  if (item.settled >= options.stableMinSample && stableByRate && profitOk && lowerBoundOk) {
    status = "STABLE";
    canUseForDemo = true;
    reason = `前向き検証${item.settled}件 / 勝率${winRate}% / Profit ${round2(item.totalProfit)} / Wilson下限${lowerBound}% のためDemo前向き検証候補です。Trading Engine自動採用はまだ禁止です。`;
  } else if (item.settled >= options.rejectMaxSample && hasWinRate && winRate <= options.rejectWinRate) {
    status = "REJECT";
    reason = `前向き検証${item.settled}件 / 勝率${winRate}% が低いため棄却候補です。`;
  } else if (item.settled >= options.watchMinSample && watchByRate && profitOk) {
    status = "WATCH";
    reason = `前向き検証${item.settled}件 / 勝率${winRate}% / Profit ${round2(item.totalProfit)} のため監視継続です。STABLEには${options.stableMinSample}件以上とWilson下限${options.minWilsonLowerBound}%以上が必要です。`;
  } else if (item.settled >= options.watchMinSample) {
    status = "WATCH";
    reason = `前向き検証${item.settled}件に到達しましたが、勝率・利益・信頼性の条件が不足しています。監視継続です。`;
  } else {
    status = "INSUFFICIENT";
    reason = `前向き検証${item.settled}件です。最低${options.watchMinSample}件までは採用判定しません。`;
  }

  return {
    candidateId: item.candidateId,
    candidateKey: item.candidateKey,
    selectedDirection: item.selectedDirection,
    status,
    settled: item.settled,
    pending: item.pending,
    wins: item.wins,
    losses: item.losses,
    draws: item.draws,
    winRate,
    totalProfit: round2(item.totalProfit),
    avgProfit,
    wilsonLowerBound: lowerBound,
    sampleStage,
    canUseForDemo,
    canUseForTradingEngine: false,
    latestCreatedAt: item.latestCreatedAt,
    latestSettledAt: item.latestSettledAt,
    reason,
  };
}

function normalizeOptions(options: ForwardValidationAdoptionOptions): Required<ForwardValidationAdoptionOptions> {
  return {
    watchMinSample: Math.max(1, options.watchMinSample ?? 30),
    stableMinSample: Math.max(1, options.stableMinSample ?? 50),
    matureMinSample: Math.max(1, options.matureMinSample ?? 100),
    stableWinRate: Math.max(0, Math.min(options.stableWinRate ?? 70, 100)),
    watchWinRate: Math.max(0, Math.min(options.watchWinRate ?? 60, 100)),
    rejectMaxSample: Math.max(1, options.rejectMaxSample ?? 30),
    rejectWinRate: Math.max(0, Math.min(options.rejectWinRate ?? 50, 100)),
    minProfit: options.minProfit ?? 0.01,
    minWilsonLowerBound: Math.max(0, Math.min(options.minWilsonLowerBound ?? 55, 100)),
    limit: Math.max(1, Math.min(options.limit ?? 100, 300)),
    includePending: options.includePending ?? true,
  };
}

function sortItems(items: ForwardValidationAdoptionItem[]): ForwardValidationAdoptionItem[] {
  return [...items].sort((a, b) => {
    const statusRank: Record<ForwardValidationAdoptionStatus, number> = {
      STABLE: 4,
      WATCH: 3,
      INSUFFICIENT: 2,
      REJECT: 1,
    };
    const aRate = a.winRate ?? -1;
    const bRate = b.winRate ?? -1;
    const aWilson = a.wilsonLowerBound ?? -1;
    const bWilson = b.wilsonLowerBound ?? -1;
    if (statusRank[b.status] !== statusRank[a.status]) return statusRank[b.status] - statusRank[a.status];
    if (b.settled !== a.settled) return b.settled - a.settled;
    if (bRate !== aRate) return bRate - aRate;
    if (bWilson !== aWilson) return bWilson - aWilson;
    return b.totalProfit - a.totalProfit;
  });
}

export function evaluateForwardValidationAdoption(options: ForwardValidationAdoptionOptions = {}): ForwardValidationAdoptionResult {
  const normalized = normalizeOptions(options);
  const dbPath = getDbPath();
  const db = new Database(dbPath, { readonly: true });

  try {
    const exists = tableExists(db, TABLE_NAME);
    if (!exists) {
      return {
        generatedAt: new Date().toISOString(),
        dbPath,
        tableName: TABLE_NAME,
        tableExists: false,
        totalRecords: 0,
        pendingRecords: 0,
        settledRecords: 0,
        options: normalized,
        stable: [],
        watch: [],
        insufficient: [],
        reject: [],
        all: [],
        message: "forward_validation_recordsテーブルがまだ存在しません。Phase16-Fの初回実行後に作成されます。",
      };
    }

    const rows = db.prepare(`SELECT * FROM ${TABLE_NAME}`).all() as Row[];
    const totalRecords = rows.length;
    const pendingRecords = rows.filter((row) => getStatus(row) === "PENDING").length;
    const settledRecords = rows.filter((row) => getStatus(row) === "SETTLED").length;
    const allItems = sortItems(buildItems(rows, normalized)).slice(0, normalized.limit);

    return {
      generatedAt: new Date().toISOString(),
      dbPath,
      tableName: TABLE_NAME,
      tableExists: true,
      totalRecords,
      pendingRecords,
      settledRecords,
      options: normalized,
      stable: allItems.filter((item) => item.status === "STABLE"),
      watch: allItems.filter((item) => item.status === "WATCH"),
      insufficient: allItems.filter((item) => item.status === "INSUFFICIENT"),
      reject: allItems.filter((item) => item.status === "REJECT"),
      all: allItems,
      message: "Forward Validationの前向きデータから採用判定を行いました。Trading Engineには接続していません。",
    };
  } finally {
    db.close();
  }
}
