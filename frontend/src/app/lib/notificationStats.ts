export function calcNotificationStats(logs: any[]) {
  const total = logs.length;
  const wins = logs.filter((l) => l.result === "WIN").length;
  return { total, wins, winRate: total === 0 ? 0 : (wins / total) * 100 };
}
