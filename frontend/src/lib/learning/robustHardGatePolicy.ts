import type { Demo2RobustCandidateMatch } from "@/lib/learning/demo2RobustCandidateGate";

export type GateAppliedLike = {
  key?: string;
  label?: string;
  action?: string;
  totalTrades?: number;
  winRate?: number | null;
  totalProfit?: number | null;
  overfitGuard?: string[];
};

export type RobustHardGatePolicyResult = {
  eligible: boolean;
  canOverrideFeatureHardGate: boolean;
  canOverridePatternHardGate: boolean;
  blockingFeatureHardGates: GateAppliedLike[];
  overridableFeatureHardGates: GateAppliedLike[];
  blockingPatternHardGates: GateAppliedLike[];
  reasons: string[];
};

const OVERRIDABLE_FEATURE_KEYS = new Set([
  "Score",
  "Similarity Score",
  "EMA + SMC",
  "EMA + BOS",
  "EMA + FVG",
  "EMA + RCI",
  "EMA + ATR",
  "BOS + FVG",
  "EMA + BOS + FVG",
  "SMC + ATR",
]);

const NEVER_OVERRIDE_TERMS = [
  "ATR異常",
  "急変動",
  "ボラ異常",
  "データ不正",
  "欠損",
  "NaN",
  "Infinity",
  "Payout",
  "Proposal",
];

function isHardGate(item: GateAppliedLike): boolean {
  return item.action === "SKIP_CANDIDATE";
}

function hasNeverOverrideTerm(item: GateAppliedLike): boolean {
  const text = [
    item.key ?? "",
    item.label ?? "",
    ...(item.overfitGuard ?? []),
  ].join(" ");
  return NEVER_OVERRIDE_TERMS.some((term) => text.includes(term));
}

function candidateIsStrong(candidate: Demo2RobustCandidateMatch | null): boolean {
  if (!candidate?.enabled) return false;
  return (
    candidate.historicalSample >= 150 &&
    candidate.historicalWinRate >= 60 &&
    candidate.recentWinRate >= 58 &&
    candidate.historicalProfit > 0
  );
}

export function evaluateRobustHardGatePolicy(input: {
  candidate: Demo2RobustCandidateMatch | null;
  featureApplied: GateAppliedLike[];
  patternApplied: GateAppliedLike[];
}): RobustHardGatePolicyResult {
  const eligible = candidateIsStrong(input.candidate);
  const featureHardGates = input.featureApplied.filter(isHardGate);
  const patternHardGates = input.patternApplied.filter(isHardGate);

  const overridableFeatureHardGates = featureHardGates.filter((item) => {
    const key = item.key ?? "";
    return OVERRIDABLE_FEATURE_KEYS.has(key) && !hasNeverOverrideTerm(item);
  });

  const blockingFeatureHardGates = featureHardGates.filter(
    (item) => !overridableFeatureHardGates.includes(item),
  );

  const reasons: string[] = [];
  if (!eligible) {
    reasons.push(
      "Robust候補の最低基準未達: 過去150件以上・全体60%以上・直近58%以上・Profitプラスが必要",
    );
  } else {
    reasons.push(
      `Robust候補基準合格: ${input.candidate?.historicalSample ?? 0}件 / 全体${input.candidate?.historicalWinRate ?? 0}% / 直近${input.candidate?.recentWinRate ?? 0}%`,
    );
  }

  if (overridableFeatureHardGates.length > 0) {
    reasons.push(
      `候補固有の強い実績を優先し、汎用Feature Hard Gate ${overridableFeatureHardGates.length}件をDemo2限定で解除`,
    );
  }
  if (blockingFeatureHardGates.length > 0) {
    reasons.push(`解除不可のFeature Hard Gateが${blockingFeatureHardGates.length}件あります`);
  }
  if (patternHardGates.length > 0) {
    reasons.push(`Pattern Hard Gate ${patternHardGates.length}件は解除しません`);
  }

  return {
    eligible,
    canOverrideFeatureHardGate:
      eligible &&
      featureHardGates.length > 0 &&
      blockingFeatureHardGates.length === 0,
    canOverridePatternHardGate: false,
    blockingFeatureHardGates,
    overridableFeatureHardGates,
    blockingPatternHardGates: patternHardGates,
    reasons,
  };
}
