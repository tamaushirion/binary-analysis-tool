import type { ResearchResult } from "@/app/lib/research";

export function getCurrentTimeSlot() {
  const hour = new Date().getHours();

  if (hour >= 6 && hour < 9) return "朝";
  if (hour >= 9 && hour < 12) return "午前";
  if (hour >= 12 && hour < 15) return "昼";
  if (hour >= 15 && hour < 18) return "午後";
  if (hour >= 18 && hour < 22) return "夜";
  return "深夜";
}

export function selectBestAdaptiveLogic(
  results: ResearchResult[],
  timeSlot: string
) {
  const candidates = results
    .filter((item: any) => {
      if (!item) return false;
      if (item.timeSlot && item.timeSlot !== timeSlot) return false;
      return Number(item.trades ?? 0) >= 5;
    })
    .sort((a: any, b: any) => {
      const aScore =
        Number(a.adaptiveScore ?? 0) ||
        Number(a.winRate ?? 0) + Math.min(10, Number(a.trades ?? 0) * 0.2);

      const bScore =
        Number(b.adaptiveScore ?? 0) ||
        Number(b.winRate ?? 0) + Math.min(10, Number(b.trades ?? 0) * 0.2);

      return bScore - aScore;
    });

  return candidates[0] ?? null;
}

export function selectBestDirections(
  results: ResearchResult[],
  timeSlot: string
) {
  const filtered = results.filter((item: any) => {
    if (!item) return false;
    if (item.timeSlot && item.timeSlot !== timeSlot) return false;
    return Number(item.trades ?? 0) >= 5;
  });

  const highCandidates = filtered
    .filter((item: any) => Number(item.highTrades ?? item.trades ?? 0) >= 5)
    .sort((a: any, b: any) => {
      const aw = Number(a.highWinRate ?? a.directionWinRate ?? a.winRate ?? 0);
      const bw = Number(b.highWinRate ?? b.directionWinRate ?? b.winRate ?? 0);
      return bw - aw;
    });

  const lowCandidates = filtered
    .filter((item: any) => Number(item.lowTrades ?? item.trades ?? 0) >= 5)
    .sort((a: any, b: any) => {
      const aw = Number(a.lowWinRate ?? a.directionWinRate ?? a.winRate ?? 0);
      const bw = Number(b.lowWinRate ?? b.directionWinRate ?? b.winRate ?? 0);
      return bw - aw;
    });

  return {
    bestHigh: highCandidates[0] ?? null,
    bestLow: lowCandidates[0] ?? null,
  };
}
