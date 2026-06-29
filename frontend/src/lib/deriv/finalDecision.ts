export type FinalDecisionInput = {
  pair: string;
  direction: "HIGH" | "LOW";
  score?: number;
  payoutRate: number | null;
  minScore?: number;
  minPayoutRate?: number;
};

export type FinalDecisionResult = {
  action: "BUY" | "SKIP";
  finalScore: number;
  reasons: string[];
};

export function judgeFinalDecision(
  input: FinalDecisionInput
): FinalDecisionResult {
  const score = input.score ?? 0;
  const minScore = input.minScore ?? 80;
  const minPayoutRate = input.minPayoutRate ?? 1.8;

  const reasons: string[] = [];
  let finalScore = score;

  if (input.payoutRate === null) {
    reasons.push("PayoutRateが取得できないため見送り");
    return { action: "SKIP", finalScore, reasons };
  }

  if (input.payoutRate < minPayoutRate) {
    reasons.push(`PayoutRate不足: ${input.payoutRate} < ${minPayoutRate}`);
    finalScore -= 20;
  } else {
    reasons.push(`PayoutRate合格: ${input.payoutRate}`);
    finalScore += 5;
  }

  if (score < minScore) {
    reasons.push(`AIスコア不足: ${score} < ${minScore}`);
  } else {
    reasons.push(`AIスコア合格: ${score}`);
  }

  const action =
    finalScore >= minScore && input.payoutRate >= minPayoutRate
      ? "BUY"
      : "SKIP";

  return {
    action,
    finalScore,
    reasons,
  };
}