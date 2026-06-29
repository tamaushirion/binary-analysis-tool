import type { ResearchResult } from "./research";

export function getCurrentTimeSlot() {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 9) return "朝";
  if (hour >= 9 && hour < 12) return "午前";
  if (hour >= 12 && hour < 15) return "昼";
  if (hour >= 15 && hour < 18) return "午後";
  if (hour >= 18 && hour < 22) return "夜";
  return "深夜";
}

export function selectBestAdaptiveLogic(results: ResearchResult[], timeSlot: string) {
  return results
    .filter((item: any) => item && (!item.timeSlot || item.timeSlot === timeSlot))
    .sort((a: any, b: any) => Number(b.winRate ?? 0) - Number(a.winRate ?? 0))[0] ?? null;
}

export function selectBestDirections(results: ResearchResult[], timeSlot: string) {
  const filtered = results.filter(
    (item: any) => item && (!item.timeSlot || item.timeSlot === timeSlot)
  );

  return {
    bestHigh: filtered
      .slice()
      .sort((a: any, b: any) => Number(b.highWinRate ?? b.directionWinRate ?? b.winRate ?? 0) - Number(a.highWinRate ?? a.directionWinRate ?? a.winRate ?? 0))[0] ?? null,
    bestLow: filtered
      .slice()
      .sort((a: any, b: any) => Number(b.lowWinRate ?? b.directionWinRate ?? b.winRate ?? 0) - Number(a.lowWinRate ?? a.directionWinRate ?? a.winRate ?? 0))[0] ?? null,
  };
}
