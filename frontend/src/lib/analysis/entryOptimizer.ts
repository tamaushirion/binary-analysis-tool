import { analyzeGates } from "@/lib/analysis/gateAnalyzer";

type GateAnalysis = ReturnType<typeof analyzeGates>;
type RejectSummary = GateAnalysis["rejects"][number];
type NearMissSummary = GateAnalysis["nearMisses"][number];

type OptimizationStatus =
  | "COLLECT_MORE_DATA"
  | "MONITOR"
  | "SHADOW_VALIDATE"
  | "KEEP_CURRENT";

const MIN_TOTAL_EVALUATIONS = 100;
const MIN_STAGE_REJECTS = 30;
const MIN_STAGE_NEAR_MISSES = 20;
const MIN_NEAR_MISS_SHARE = 25;
const MAX_SIMULATION_RELAXATION = 3;

const SAFE_STAGE_CONFIG = {
  engine_skipped_by_confidence: {
    label: "Confidence",
    metric: "confidence",
  },
  engine_skipped_by_entry_gate: {
    label: "Entry Gate",
    metric: "entry_gate_score",
  },
  engine_skipped_by_empirical_entry_gate: {
    label: "Empirical Entry Gate",
    metric: "empirical_win_rate",
  },
} as const;

type SafeStage = keyof typeof SAFE_STAGE_CONFIG;

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function findReject(analysis: GateAnalysis, stage: SafeStage) {
  return analysis.rejects.find((row) => row.rejectStage === stage) ?? null;
}

function findNearMiss(analysis: GateAnalysis, stage: SafeStage) {
  const config = SAFE_STAGE_CONFIG[stage];
  return (
    analysis.nearMisses.find(
      (row) => row.rejectStage === stage && row.metric === config.metric,
    ) ?? null
  );
}

function getStatus(params: {
  totalEvaluations: number;
  reject: RejectSummary | null;
  nearMiss: NearMissSummary | null;
  nearMissShare: number;
}): OptimizationStatus {
  if (params.totalEvaluations < MIN_TOTAL_EVALUATIONS) {
    return "COLLECT_MORE_DATA";
  }
  if (!params.reject || !params.nearMiss) return "KEEP_CURRENT";
  if (
    params.reject.totalRejects >= MIN_STAGE_REJECTS &&
    params.nearMiss.totalNearMisses >= MIN_STAGE_NEAR_MISSES &&
    params.nearMissShare >= MIN_NEAR_MISS_SHARE
  ) {
    return "SHADOW_VALIDATE";
  }
  return "MONITOR";
}

function buildCandidate(analysis: GateAnalysis, stage: SafeStage) {
  const config = SAFE_STAGE_CONFIG[stage];
  const reject = findReject(analysis, stage);
  const nearMiss = findNearMiss(analysis, stage);
  const nearMissShare =
    reject && reject.totalRejects > 0 && nearMiss
      ? round2((nearMiss.totalNearMisses / reject.totalRejects) * 100)
      : 0;
  const status = getStatus({
    totalEvaluations: analysis.totals.evaluations,
    reject,
    nearMiss,
    nearMissShare,
  });
  const currentThreshold = nearMiss?.avgThresholdValue ?? null;
  const averageGap = nearMiss?.avgGap ?? null;
  const simulationRelaxation =
    status === "SHADOW_VALIDATE" && averageGap !== null
      ? Math.min(MAX_SIMULATION_RELAXATION, Math.max(1, Math.ceil(averageGap)))
      : null;

  return {
    rejectStage: stage,
    gate: config.label,
    metric: config.metric,
    status,
    evidence: {
      totalEvaluations: analysis.totals.evaluations,
      totalRejects: reject?.totalRejects ?? 0,
      totalNearMisses: nearMiss?.totalNearMisses ?? 0,
      nearMissShare,
      currentThreshold,
      averageObservedValue: nearMiss?.avgObservedValue ?? null,
      averageGap,
    },
    simulationOnly: {
      enabled: status === "SHADOW_VALIDATE",
      currentThreshold,
      candidateThreshold:
        currentThreshold !== null && simulationRelaxation !== null
          ? round2(currentThreshold - simulationRelaxation)
          : null,
      maxRelaxation: simulationRelaxation,
    },
    reason:
      status === "COLLECT_MORE_DATA"
        ? `全体評価が${analysis.totals.evaluations}/${MIN_TOTAL_EVALUATIONS}件のため、基準変更を検討しません`
        : status === "SHADOW_VALIDATE"
          ? "拒否数とNear Miss数が検証条件を満たしたため、実取引へ適用せずShadow検証候補にします"
          : status === "MONITOR"
            ? "一部データはありますが、安全な検証開始に必要な件数または比率が不足しています"
            : "Near Missの根拠がないため現在基準を維持します",
  };
}

export function optimizeEntry(input?: { sinceDays?: number | null }) {
  const analysis = analyzeGates(input);
  const candidates = (
    Object.keys(SAFE_STAGE_CONFIG) as SafeStage[]
  ).map((stage) => buildCandidate(analysis, stage));
  const shadowValidationCandidates = candidates.filter(
    (candidate) => candidate.status === "SHADOW_VALIDATE",
  );

  return {
    ok: true as const,
    stage: "entry_optimization_preview" as const,
    generatedAt: new Date().toISOString(),
    applyAutomatically: false as const,
    objective: "勝率を落とさず、十分な根拠があるGateだけをShadow検証する",
    safeguards: {
      minimumTotalEvaluations: MIN_TOTAL_EVALUATIONS,
      minimumStageRejects: MIN_STAGE_REJECTS,
      minimumStageNearMisses: MIN_STAGE_NEAR_MISSES,
      minimumNearMissShare: MIN_NEAR_MISS_SHARE,
      maximumSimulationRelaxation: MAX_SIMULATION_RELAXATION,
      hardGatesExcluded: true,
      existingAiLogicChanged: false,
    },
    readiness:
      analysis.totals.evaluations >= MIN_TOTAL_EVALUATIONS
        ? "READY_FOR_REVIEW"
        : "COLLECTING_DATA",
    warning:
      "拒否候補には実取引結果がないため、この提案だけでGateを緩和しません。Demo2のShadow検証で勝率と損益を確認する必要があります。",
    analysis,
    candidates,
    shadowValidationCandidates,
  };
}
