export type PrioritySignal = {
  pair: string;
  signal: "HIGH" | "LOW" | "見送り" | "危険";
  score: number;
  priority: number;
};

export function selectTopPrioritySignal(results: any[]): PrioritySignal | null {
  const candidates = results
    .filter((r) => r.signal === "HIGH" || r.signal === "LOW")
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));

  const top = candidates[0];
  return top ? { ...top, priority: top.score } : null;
}
