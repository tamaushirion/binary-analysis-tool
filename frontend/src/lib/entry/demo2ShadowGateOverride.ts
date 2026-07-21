export type Demo2ShadowOverrideId =
  | "feature_hour_8"
  | "feature_hour_12"
  | "feature_hour_16"
  | "feature_hour_18"
  | "empirical_rci52_strong_up";

export type Demo2ShadowOverrideMatch = {
  enabled: true;
  candidateId: Demo2ShadowOverrideId;
  candidateName: string;
  rejectedGate:
    | "engine_skipped_by_empirical_entry_gate"
    | "engine_skipped_by_feature_win_rate_gate";
  conditionKey: "hour" | "rci52";
  conditionValue: string;
  reasons: string[];
};

type AppliedGate = {
  key?: string;
  label?: string;
  overfitGuard?: string[];
};

const FEATURE_HOURS = new Set([8, 12, 16, 18]);
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
    if (rci52 !== null && rci52 >= 50 && rci52 < 80) {
      return {
        enabled: true,
        candidateId: "empirical_rci52_strong_up",
        candidateName: "Empirical拒否・RCI52 Strong Up",
        rejectedGate: input.rejectedGate,
        conditionKey: "rci52",
        conditionValue: "50-79",
        reasons: [
          `RCI52 ${rci52}`,
          "Shadow採用候補としてDemo2限定でEmpirical Gateを例外通過",
        ],
      };
    }
    return null;
  }

  const hour = finiteNumber(features.hour);
  if (hour === null || !Number.isInteger(hour) || !FEATURE_HOURS.has(hour)) {
    return null;
  }

  return {
    enabled: true,
    candidateId: `feature_hour_${hour}` as Demo2ShadowOverrideId,
    candidateName: `Feature拒否・Hour ${hour}`,
    rejectedGate: input.rejectedGate,
    conditionKey: "hour",
    conditionValue: String(hour),
    reasons: [
      `Hour ${hour}`,
      "Shadow採用候補としてDemo2限定でFeature Gateを例外通過",
    ],
  };
}
