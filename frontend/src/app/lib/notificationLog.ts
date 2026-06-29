export type NotificationLog = {
  id: string;
  pair: string;
  signal: "HIGH" | "LOW";
  confidence: number;
  reasons: string[];
  createdAt: string;
  result?: "WIN" | "LOSE" | "DRAW";
};

const KEY = "notification_logs_v1";

export function loadNotificationLogs(): NotificationLog[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}

export function saveNotificationLog(input: Omit<NotificationLog, "createdAt">) {
  if (typeof window === "undefined") return;
  const logs = loadNotificationLogs();
  logs.unshift({ ...input, createdAt: new Date().toLocaleString() });
  localStorage.setItem(KEY, JSON.stringify(logs.slice(0, 200)));
}

export function updateNotificationResult(id: string, result: "WIN" | "LOSE" | "DRAW", _exitPrice?: number) {
  if (typeof window === "undefined") return;
  const logs = loadNotificationLogs().map((log) => log.id === id ? { ...log, result } : log);
  localStorage.setItem(KEY, JSON.stringify(logs));
}
