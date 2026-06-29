"use client";

export type ExecutionEventType =
  | "SIGNAL"
  | "PROPOSAL_REQUEST"
  | "PROPOSAL_SUCCESS"
  | "PROPOSAL_REJECT"
  | "BUY_REQUEST"
  | "BUY_SUCCESS"
  | "BUY_FAILED"
  | "CONTRACT_SETTLED";

export type ExecutionAnalyticsLog = {
  id: string;
  type: ExecutionEventType;
  pair: string;
  symbol: string;
  direction: "HIGH" | "LOW";
  contractType: "CALL" | "PUT";
  score: number | null;
  stake: number | null;
  payoutRate: number | null;
  latencyMs: number | null;
  profit: number | null;
  message: string;
  createdAt: number;
};

const STORAGE_KEY = "deriv_execution_analytics_v1";
const MAX_LOGS = 300;

export function loadExecutionLogs(): ExecutionAnalyticsLog[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const logs = JSON.parse(raw);

    if (!Array.isArray(logs)) return [];

    return logs;
  } catch {
    return [];
  }
}

export function saveExecutionLog(
  log: Omit<ExecutionAnalyticsLog, "id" | "createdAt">
) {
  if (typeof window === "undefined") return;

  const logs = loadExecutionLogs();

  const nextLog: ExecutionAnalyticsLog = {
    ...log,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  };

  const nextLogs = [nextLog, ...logs].slice(0, MAX_LOGS);

  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextLogs));
}

export function clearExecutionLogs() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function calcExecutionStats() {
  const logs = loadExecutionLogs();

  const proposalSuccess = logs.filter((log) => log.type === "PROPOSAL_SUCCESS");
  const buySuccess = logs.filter((log) => log.type === "BUY_SUCCESS");

  const avgProposalLatency =
    proposalSuccess.length > 0
      ? proposalSuccess.reduce((sum, log) => sum + (log.latencyMs ?? 0), 0) /
        proposalSuccess.length
      : 0;

  const avgPayoutRate =
    proposalSuccess.length > 0
      ? proposalSuccess.reduce((sum, log) => sum + (log.payoutRate ?? 0), 0) /
        proposalSuccess.length
      : 0;

  return {
    totalLogs: logs.length,
    proposalSuccessCount: proposalSuccess.length,
    buySuccessCount: buySuccess.length,
    avgProposalLatency,
    avgPayoutRate,
  };
}