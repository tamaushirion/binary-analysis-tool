export type ResearchResult = {
  name: string;
  winRate: number;
  trades: number;
  level?: string;
  adaptiveScore?: number;
  timeSlot?: string;
  highWinRate?: number;
  lowWinRate?: number;
  directionWinRate?: number;
};
