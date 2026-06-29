import type { ResearchResult } from "./research";

export type PairAdaptiveData = {
  pair: string;
  timeSlot: string;
  bestLogic: any;
  bestDirections: {
    bestHigh: any;
    bestLow: any;
  };
  results?: ResearchResult[];
};

const KEY = "pair_adaptive_store_v1";

export function loadAdaptiveStore(): Record<string, PairAdaptiveData> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function saveAdaptiveData(pair: string, results: ResearchResult[]) {
  if (typeof window === "undefined") return;

  const current = loadAdaptiveStore();

  current[pair] = {
    pair,
    timeSlot: new Date().getHours().toString(),
    bestLogic: results[0] ?? null,
    bestDirections: {
      bestHigh: results[0] ?? null,
      bestLow: results[0] ?? null,
    },
    results,
  };

  localStorage.setItem(KEY, JSON.stringify(current));
}
