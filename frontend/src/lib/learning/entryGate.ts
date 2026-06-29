export type EntryGateInput = {
  confidence: number;
  similarityScore: number;
  weightScore: number;
  smcScore: number;
  atr: number;
  atrThreshold: number;
  backtestWinRate1m: number;
};

export type EntryGateResult = {
  allow: boolean;
  score: number;
  reasons: string[];
};

export function applyEntryGate(
  input: EntryGateInput
): EntryGateResult {
  const reasons: string[] = [];
  let score = 0;

  // Confidence
  if (input.confidence >= 75) {
    score += 20;
    reasons.push("Confidence OK");
  } else {
    reasons.push("Confidence不足");
  }

  // Similarity
  if (input.similarityScore >= 80) {
    score += 20;
    reasons.push("Similarity OK");
  } else {
    reasons.push("Similarity不足");
  }

  // Weight Learning
  if (input.weightScore >= 0) {
    score += 15;
    reasons.push("Weight OK");
  } else {
    reasons.push("Weightマイナス");
  }

  // Strong SMC
  if (input.smcScore >= 60) {
    score += 20;
    reasons.push("Strong SMC");
  } else {
    reasons.push("SMC不足");
  }

  // ATR
  if (input.atr >= input.atrThreshold) {
    score += 10;
    reasons.push("ATR OK");
  } else {
    reasons.push("ATR不足");
  }

  // 1分バックテスト
  if (input.backtestWinRate1m >= 78) {
    score += 15;
    reasons.push("1分Backtest OK");
  } else {
    reasons.push("1分Backtest弱い");
  }

  return {
    allow: score >= 80,
    score,
    reasons,
  };
}