import type { Candle } from "./backtest";
import type { ResearchResult } from "./research";

export async function runResearchInWorker(_candles: Candle[]): Promise<ResearchResult[]> {
  return [];
}
