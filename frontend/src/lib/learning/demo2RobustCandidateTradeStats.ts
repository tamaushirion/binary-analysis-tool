import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type Demo2RobustTradeClassification = "ACTIVE" | "WATCH" | "PAUSE_CANDIDATE" | "TOO_EARLY";

export type Demo2RobustCandidateTradeStat = {
  candidateId: string;
  candidateName: string;
  direction: "HIGH" | "LOW";
  total: number;
  wins: number;
  losses: number;
  draws: number;
  decided: number;
  winRate: number | null;
  totalProfit: number;
  avgProfit: number | null;
  recentSample: number;
  recentWinRate: number | null;
  currentWinStreak: number;
  currentLoseStreak: number;
  firstTradeId: number | null;
  lastTradeId: number | null;
  classification: Demo2RobustTradeClassification;
  shouldPause: boolean;
  reasons: string[];
};

export type Demo2RobustCandidateTradeStatsResult = {
  ok: true;
  stage: "demo_part2_robust_candidate_stats";
  generatedAt: string;
  dbPath: string;
  totalRobustTrades: number;
  candidates: Demo2RobustCandidateTradeStat[];
  pausedCandidateIds: string[];
  message: string;
};

type TradeRow = { id: number; status: string | null; profit: number | null; direction: string | null; feature_snapshot: string | null };
type ParsedCandidate = { candidateId: string; candidateName: string; direction: "HIGH" | "LOW" };

function resolveDbPath(input?: string): string {
  if (input) return path.resolve(input);
  const candidates = [path.join(process.cwd(), "data", "ai.db"), path.join(process.cwd(), "..", "data", "ai.db")];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}
function round(value: number, digits = 2): number { const base = 10 ** digits; return Math.round(value * base) / base; }
function normalizeStatus(row: TradeRow): "WIN" | "LOST" | "DRAW" {
  const status = String(row.status ?? "").toUpperCase(); const profit = Number(row.profit ?? 0);
  if (["WIN", "WON", "PROFIT"].includes(status) || profit > 0) return "WIN";
  if (["DRAW", "TIE", "EVEN"].includes(status) || profit === 0) return "DRAW";
  return "LOST";
}
function parseCandidate(row: TradeRow): ParsedCandidate | null {
  if (!row.feature_snapshot) return null;
  try {
    const snapshot = JSON.parse(row.feature_snapshot) as Record<string, unknown>;
    const direct = snapshot.robustDemo2Candidate as Record<string, unknown> | undefined;
    const mode = snapshot.robustDemo2Mode as Record<string, unknown> | undefined;
    const nested = mode?.candidate as Record<string, unknown> | undefined;
    const candidate = direct ?? nested;
    if (!candidate || typeof candidate.candidateId !== "string") return null;
    return {
      candidateId: candidate.candidateId,
      candidateName: typeof candidate.candidateName === "string" ? candidate.candidateName : candidate.candidateId,
      direction: candidate.direction === "LOW" ? "LOW" : candidate.direction === "HIGH" ? "HIGH" : row.direction === "LOW" ? "LOW" : "HIGH",
    };
  } catch { return null; }
}
function classify(decided: number, winRate: number | null, totalProfit: number, recentWinRate: number | null) {
  if (decided < 10) return { classification: "TOO_EARLY" as const, shouldPause: false, reasons: [`実Demo決着${decided}件。まだ判断しません。`] };
  if (decided >= 30 && (winRate ?? 0) < 50 && totalProfit < 0) return { classification: "PAUSE_CANDIDATE" as const, shouldPause: true, reasons: ["30件以上で勝率50%未満かつProfitマイナス。"] };
  if (decided >= 50 && ((winRate ?? 0) < 55 || (recentWinRate ?? 0) < 52) && totalProfit <= 0) return { classification: "PAUSE_CANDIDATE" as const, shouldPause: true, reasons: ["50件以上で全体または直近成績が弱く、Profitも残っていません。"] };
  if ((winRate ?? 0) >= 55 && totalProfit > 0) return { classification: "ACTIVE" as const, shouldPause: false, reasons: ["実Demoで勝率55%以上かつProfitプラス。"] };
  return { classification: "WATCH" as const, shouldPause: false, reasons: ["実Demo件数または成績が中間域のため監視継続。"] };
}

export function getDemo2RobustCandidateTradeStats(input?: { dbPath?: string; recentWindow?: number }): Demo2RobustCandidateTradeStatsResult {
  const dbPath = resolveDbPath(input?.dbPath); const recentWindow = Math.max(10, Math.floor(input?.recentWindow ?? 20));
  const db = new Database(dbPath, { readonly: true });
  try {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='trade_history'").get() as { name?: string } | undefined;
    if (!exists?.name) return { ok: true, stage: "demo_part2_robust_candidate_stats", generatedAt: new Date().toISOString(), dbPath, totalRobustTrades: 0, candidates: [], pausedCandidateIds: [], message: "trade_historyがないため候補別実績はまだありません。" };
    const rows = db.prepare("SELECT id, status, profit, direction, feature_snapshot FROM trade_history WHERE feature_snapshot IS NOT NULL ORDER BY id ASC").all() as TradeRow[];
    const groups = new Map<string, { candidate: ParsedCandidate; rows: TradeRow[] }>();
    for (const row of rows) { const candidate = parseCandidate(row); if (!candidate) continue; const current = groups.get(candidate.candidateId); current ? current.rows.push(row) : groups.set(candidate.candidateId, { candidate, rows: [row] }); }
    const candidates: Demo2RobustCandidateTradeStat[] = [];
    for (const { candidate, rows: candidateRows } of groups.values()) {
      const statuses = candidateRows.map(normalizeStatus); const wins = statuses.filter((v) => v === "WIN").length; const losses = statuses.filter((v) => v === "LOST").length; const draws = statuses.filter((v) => v === "DRAW").length; const decided = wins + losses;
      const winRate = decided > 0 ? round((wins / decided) * 100) : null; const totalProfit = round(candidateRows.reduce((sum, row) => sum + Number(row.profit ?? 0), 0), 4); const avgProfit = decided > 0 ? round(totalProfit / decided, 4) : null;
      const recentRows = candidateRows.slice(-recentWindow); const recentStatuses = recentRows.map(normalizeStatus); const recentWins = recentStatuses.filter((v) => v === "WIN").length; const recentLosses = recentStatuses.filter((v) => v === "LOST").length; const recentDecided = recentWins + recentLosses; const recentWinRate = recentDecided > 0 ? round((recentWins / recentDecided) * 100) : null;
      let currentWinStreak = 0; let currentLoseStreak = 0;
      for (let i = statuses.length - 1; i >= 0; i -= 1) { if (statuses[i] === "WIN" && currentLoseStreak === 0) currentWinStreak += 1; else if (statuses[i] === "LOST" && currentWinStreak === 0) currentLoseStreak += 1; else if (statuses[i] !== "DRAW") break; }
      const decision = classify(decided, winRate, totalProfit, recentWinRate);
      candidates.push({ candidateId: candidate.candidateId, candidateName: candidate.candidateName, direction: candidate.direction, total: candidateRows.length, wins, losses, draws, decided, winRate, totalProfit, avgProfit, recentSample: recentRows.length, recentWinRate, currentWinStreak, currentLoseStreak, firstTradeId: candidateRows[0]?.id ?? null, lastTradeId: candidateRows.at(-1)?.id ?? null, classification: decision.classification, shouldPause: decision.shouldPause, reasons: decision.reasons });
    }
    candidates.sort((a, b) => b.decided - a.decided);
    return { ok: true, stage: "demo_part2_robust_candidate_stats", generatedAt: new Date().toISOString(), dbPath, totalRobustTrades: candidates.reduce((sum, c) => sum + c.total, 0), candidates, pausedCandidateIds: candidates.filter((c) => c.shouldPause).map((c) => c.candidateId), message: "feature_snapshotのRobust候補情報から、候補別Demo2実取引成績を集計しました。" };
  } finally { db.close(); }
}
