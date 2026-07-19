import Database from "better-sqlite3";
import path from "path";

export type ForwardValidationDashboardOptions = {
  limit?: number;
  recentLimit?: number;
  includePending?: boolean;
};

type Row = Record<string, unknown>;

type CandidateSummary = {
  candidateId: string;
  candidateKey: string;
  selectedDirection: string;
  total: number;
  pending: number;
  settled: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number | null;
  totalProfit: number;
  avgProfit: number | null;
  latestCreatedAt: number | null;
  latestSettledAt: number | null;
};

type RecentRecord = {
  id: number | null;
  candidateId: string;
  candidateKey: string;
  selectedDirection: string;
  status: string;
  result: string | null;
  profit: number | null;
  entrySpot: number | null;
  exitSpot: number | null;
  createdAt: number | null;
  settledAt: number | null;
};

export type ForwardValidationDashboard = {
  generatedAt: string;
  dbPath: string;
  tableName: "forward_validation_records";
  tableExists: boolean;
  totalRecords: number;
  pendingRecords: number;
  settledRecords: number;
  candidates: CandidateSummary[];
  recent: RecentRecord[];
  message: string;
};

const TABLE_NAME = "forward_validation_records" as const;

function getDbPath() {
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

function getStatus(row: Row): string {
  const raw = toText(pick(row, ["status", "settle_status", "record_status"], "pending"), "pending").toUpperCase();
  if (raw === "SETTLED" || raw === "WIN" || raw === "WON" || raw === "LOST" || raw === "LOSS" || raw === "DRAW") return "SETTLED";
  if (raw === "EXPIRED") return "EXPIRED";
  return "PENDING";
}

function getResult(row: Row): string | null {
  const raw = toText(pick(row, ["result", "outcome", "trade_result"], ""), "").toUpperCase();
  if (raw === "WIN" || raw === "WON") return "WIN";
  if (raw === "LOSS" || raw === "LOST") return "LOSS";
  if (raw === "DRAW") return "DRAW";

  const profit = toNullableNumber(pick(row, ["profit", "selected_profit", "virtual_profit"]));
  if (profit === null) return null;
  if (profit > 0) return "WIN";
  if (profit < 0) return "LOSS";
  return "DRAW";
}

function normalizeRecent(row: Row): RecentRecord {
  return {
    id: toNullableNumber(pick(row, ["id"])) ?? null,
    candidateId: toText(pick(row, ["candidate_id", "candidateId", "edge_id"], "unknown"), "unknown"),
    candidateKey: toText(pick(row, ["candidate_key", "candidateKey", "key"], "unknown"), "unknown"),
    selectedDirection: toText(pick(row, ["selected_direction", "selectedDirection", "direction"], "unknown"), "unknown"),
    status: getStatus(row),
    result: getResult(row),
    profit: toNullableNumber(pick(row, ["profit", "selected_profit", "virtual_profit"])),
    entrySpot: toNullableNumber(pick(row, ["entry_spot", "entrySpot", "entry_price"])),
    exitSpot: toNullableNumber(pick(row, ["exit_spot", "exitSpot", "exit_price"])),
    createdAt: toNullableNumber(pick(row, ["created_at", "createdAt", "entry_time"])),
    settledAt: toNullableNumber(pick(row, ["settled_at", "settledAt", "exit_time"])),
  };
}

function summarize(rows: Row[], limit: number, includePending: boolean): CandidateSummary[] {
  const map = new Map<string, CandidateSummary>();

  for (const row of rows) {
    const candidateId = toText(pick(row, ["candidate_id", "candidateId", "edge_id"], "unknown"), "unknown");
    const candidateKey = toText(pick(row, ["candidate_key", "candidateKey", "key"], candidateId), candidateId);
    const selectedDirection = toText(pick(row, ["selected_direction", "selectedDirection", "direction"], "unknown"), "unknown");
    const mapKey = `${candidateId}::${candidateKey}::${selectedDirection}`;
    const status = getStatus(row);
    const result = getResult(row);
    const profit = toNullableNumber(pick(row, ["profit", "selected_profit", "virtual_profit"])) ?? 0;
    const createdAt = toNullableNumber(pick(row, ["created_at", "createdAt", "entry_time"]));
    const settledAt = toNullableNumber(pick(row, ["settled_at", "settledAt", "exit_time"]));

    if (!includePending && status === "PENDING") continue;

    const item =
      map.get(mapKey) ??
      ({
        candidateId,
        candidateKey,
        selectedDirection,
        total: 0,
        pending: 0,
        settled: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        winRate: null,
        totalProfit: 0,
        avgProfit: null,
        latestCreatedAt: null,
        latestSettledAt: null,
      } satisfies CandidateSummary);

    item.total += 1;
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

  const values = Array.from(map.values()).map((item) => {
    const decisionCount = item.wins + item.losses;
    return {
      ...item,
      winRate: decisionCount > 0 ? round2((item.wins / decisionCount) * 100) : null,
      totalProfit: round2(item.totalProfit),
      avgProfit: item.settled > 0 ? round2(item.totalProfit / item.settled) : null,
    };
  });

  values.sort((a, b) => {
    const aRate = a.winRate ?? -1;
    const bRate = b.winRate ?? -1;
    if (b.settled !== a.settled) return b.settled - a.settled;
    if (bRate !== aRate) return bRate - aRate;
    return b.totalProfit - a.totalProfit;
  });

  return values.slice(0, limit);
}

export function getForwardValidationDashboard(options: ForwardValidationDashboardOptions = {}): ForwardValidationDashboard {
  const dbPath = getDbPath();
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const recentLimit = Math.max(1, Math.min(options.recentLimit ?? 30, 100));
  const includePending = options.includePending ?? true;

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
        candidates: [],
        recent: [],
        message: "forward_validation_recordsテーブルがまだ存在しません。Phase16-Fの初回実行後に作成されます。",
      };
    }

    const rows = db.prepare(`SELECT * FROM ${TABLE_NAME}`).all() as Row[];
    const totalRecords = rows.length;
    const pendingRecords = rows.filter((row) => getStatus(row) === "PENDING").length;
    const settledRecords = rows.filter((row) => getStatus(row) === "SETTLED").length;

    const orderedRecent = [...rows].sort((a, b) => {
      const aTime = toNumber(pick(a, ["created_at", "createdAt", "entry_time", "id"], 0));
      const bTime = toNumber(pick(b, ["created_at", "createdAt", "entry_time", "id"], 0));
      return bTime - aTime;
    });

    return {
      generatedAt: new Date().toISOString(),
      dbPath,
      tableName: TABLE_NAME,
      tableExists: true,
      totalRecords,
      pendingRecords,
      settledRecords,
      candidates: summarize(rows, limit, includePending),
      recent: orderedRecent.slice(0, recentLimit).map(normalizeRecent),
      message: "Forward Validationの候補別ダッシュボードです。実際のDeriv Buyは行いません。",
    };
  } finally {
    db.close();
  }
}
