import { getDemo2ActualCandidateDecision } from "@/lib/entry/demo2ShadowOverrideStore";

export type Demo2ShadowOverrideId =
  | `feature_hour_${number}`
  | "empirical_rci52_oversold"
  | "empirical_rci52_strong_down"
  | "empirical_rci52_neutral"
  | "empirical_rci52_strong_up"
  | "empirical_rci52_overbought";

export type Demo2ShadowOverrideMatch = {
  enabled: true;
  candidateId: Demo2ShadowOverrideId;
  candidateName: string;
  rejectedGate:
    | "engine_skipped_by_empirical_entry_gate"
    | "engine_skipped_by_feature_win_rate_gate";
  conditionKey: "hour" | "rci52";
  conditionValue: string;
  executionMode: "FORWARD" | "REVERSE";
  originalDirection: "HIGH" | "LOW";
  direction: "HIGH" | "LOW";
  actualWinRate: number | null;
  actualDecided: number;
  reasons: string[];
};

type AppliedGate = {
  key?: string;
  label?: string;
  overfitGuard?: string[];
};

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

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function hasSafetyBlock(applied: AppliedGate[]) {
  return applied.some((item) => {
    const text = [
      item.key ?? "",
      item.label ?? "",
      ...(item.overfitGuard ?? []),
    ].join(" ");
    return NEVER_OVERRIDE_TERMS.some((term) => text.includes(term));
  });
}

export function canContinueDemo2ShadowOverride(input: {
  match: Demo2ShadowOverrideMatch;
  appliedGates?: AppliedGate[];
}) {
  return input.match.enabled && !hasSafetyBlock(input.appliedGates ?? []);
}

export function evaluateDemo2ShadowGateOverride(input: {
  demo2Enabled: boolean;
  rejectedGate: Demo2ShadowOverrideMatch["rejectedGate"];
  direction: "HIGH" | "LOW";
  features?: Record<string, unknown> | null;
  appliedGates?: AppliedGate[];
}): Demo2ShadowOverrideMatch | null {
  if (!input.demo2Enabled) return null;

  const features = input.features ?? {};
  const atr = finiteNumber(features.atr);
  const entrySpot = finiteNumber(features.shadowEntrySpot);
  const observationEpoch = finiteNumber(features.shadowObservationEpoch);
  if (
    atr === null ||
    atr <= 0 ||
    entrySpot === null ||
    entrySpot <= 0 ||
    observationEpoch === null
  ) {
    return null;
  }

  if (hasSafetyBlock(input.appliedGates ?? [])) return null;

  if (input.rejectedGate === "engine_skipped_by_empirical_entry_gate") {
    const rci52 = finiteNumber(features.rci52);
    if (rci52 === null) return null;
    const band =
      rci52 <= -80
        ? {
            id: "empirical_rci52_oversold" as const,
            name: "RCI52 Oversold",
            value: "<=-80",
          }
        : rci52 < -50
          ? {
              id: "empirical_rci52_strong_down" as const,
              name: "RCI52 Strong Down",
              value: "-79--51",
            }
          : rci52 < 50
            ? {
                id: "empirical_rci52_neutral" as const,
                name: "RCI52 Neutral",
                value: "-50-49",
              }
            : rci52 < 80
              ? {
                  id: "empirical_rci52_strong_up" as const,
                  name: "RCI52 Strong Up",
                  value: "50-79",
                }
              : {
                  id: "empirical_rci52_overbought" as const,
                  name: "RCI52 Overbought",
                  value: ">=80",
                };
    const decision = getDemo2ActualCandidateDecision(band.id);
    if (decision.blocksForwardEntry && !decision.reverseEligible) return null;
    const executionMode = decision.reverseEligible ? "REVERSE" : "FORWARD";
    const direction =
      executionMode === "REVERSE"
        ? input.direction === "HIGH"
          ? "LOW"
          : "HIGH"
        : input.direction;
    return {
      enabled: true,
      candidateId: band.id,
      candidateName: `Empirical拒否・${band.name}`,
      rejectedGate: input.rejectedGate,
      conditionKey: "rci52",
      conditionValue: band.value,
      executionMode,
      originalDirection: input.direction,
      direction,
      actualWinRate: decision.winRate,
      actualDecided: decision.decided,
      reasons: [
        `RCI52 ${rci52}`,
        `実エントリー学習 ${decision.classification}`,
        "Demo2限定でEmpirical Gateを外し、実約定結果を収集",
      ],
    };
  }

  const hour = finiteNumber(features.hour);
  if (hour === null || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    return null;
  }
  const candidateId = `feature_hour_${hour}` as const;
  const decision = getDemo2ActualCandidateDecision(candidateId);
  if (decision.blocksForwardEntry && !decision.reverseEligible) return null;
  const executionMode = decision.reverseEligible ? "REVERSE" : "FORWARD";
  const direction =
    executionMode === "REVERSE"
      ? input.direction === "HIGH"
        ? "LOW"
        : "HIGH"
      : input.direction;

  return {
    enabled: true,
    candidateId,
    candidateName: `Feature拒否・Hour ${hour}`,
    rejectedGate: input.rejectedGate,
    conditionKey: "hour",
    conditionValue: String(hour),
    executionMode,
    originalDirection: input.direction,
    direction,
    actualWinRate: decision.winRate,
    actualDecided: decision.decided,
    reasons: [
      `Hour ${hour}`,
      `実エントリー学習 ${decision.classification}`,
      "Demo2限定でFeature Gateを外し、実約定結果を収集",
    ],
  };
}
