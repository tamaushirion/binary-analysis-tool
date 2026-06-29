export type PriorityNotificationLog = {
  id: string;
  pair: string;
  signal: "HIGH" | "LOW";
  score: number;
  entryPrice: number;
  notifiedAt: string;
  result?: "WIN" | "LOSE" | "DRAW";
  exitPrice?: number;
};

const KEY = "priority_notification_logs_v1";

export function loadPriorityLogs(): PriorityNotificationLog[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}

export function savePriorityLog(log: PriorityNotificationLog) {
  if (typeof window === "undefined") return;
  const logs = loadPriorityLogs();
  logs.unshift(log);
  localStorage.setItem(KEY, JSON.stringify(logs.slice(0, 300)));
}

export function updatePriorityLog(id: string, result: "WIN" | "LOSE" | "DRAW", exitPrice: number) {
  if (typeof window === "undefined") return;
  const logs = loadPriorityLogs().map((log) => log.id === id ? { ...log, result, exitPrice } : log);
  localStorage.setItem(KEY, JSON.stringify(logs));
}
