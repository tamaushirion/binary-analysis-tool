import { analyzeBidirectionalEdges, type BidirectionalEdgeOptions, type BidirectionalEdgeItem } from "@/lib/learning/bidirectionalEdgeAnalyzer";
import { analyzeRegimeEdges, type RegimeEdgeOptions, type RegimeEdgePattern } from "@/lib/learning/regimeEdgeAnalyzer";

export type EdgeCandidateKind = "BIDIRECTIONAL" | "REGIME";
export type EdgeCandidateDirection = "FORWARD" | "REVERSE";
export type EdgeCandidateStatus = "WATCH" | "ADOPT_READY" | "BLOCK";

export type EdgeCandidate = {
  id: string;
  kind: EdgeCandidateKind;
  key: string;
  feature?: string;
  value?: string;
  features: string[];
  values: string[];
  sample: number;
  wins: number;
  losses: number;
  draws: number;
  rawWinRate: number;
  reverseWinRate: number;
  effectiveWinRate: number;
  directionalEdge: number;
  rawProfit: number;
  reverseProfit: number;
  avgRawProfit: number;
  avgReverseProfit: number;
  selectedDirection: EdgeCandidateDirection;
  status: EdgeCandidateStatus;
  classification: string;
  priorityScore: number;
  reason: string;
  tradeIds: number[];
};

export type EdgeCandidateTrackerOptions = {
  minSample?: number;
  watchMinSample?: number;
  adoptMinSample?: number;
  watchEffectiveWinRate?: number;
  adoptEffectiveWinRate?: number;
  neutralEdgeThreshold?: number;
  limit?: number;
  includeUnknown?: boolean;
  includeBlock?: boolean;
};

export type EdgeCandidateTrackerResult = {
  generatedAt: string;
  totalTrades: number;
  usedTrades: number;
  dbPath: string;
  tableName: string;
  options: Required<EdgeCandidateTrackerOptions>;
  candidates: EdgeCandidate[];
  forwardWatch: EdgeCandidate[];
  reverseWatch: EdgeCandidate[];
  adoptReady: EdgeCandidate[];
  block: EdgeCandidate[];
  message: string;
};

const DEFAULT_OPTIONS: Required<EdgeCandidateTrackerOptions> = {
  minSample: 5,
  watchMinSample: 15,
  adoptMinSample: 50,
  watchEffectiveWinRate: 65,
  adoptEffectiveWinRate: 70,
  neutralEdgeThreshold: 10,
  limit: 100,
  includeUnknown: false,
  includeBlock: false,
};

function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}

function hasUnknown(values: string[]): boolean {
  return values.some((value) => value.toUpperCase().includes("UNKNOWN") || value.includes("unknown"));
}

function priorityScore(input: {
  sample: number;
  effectiveWinRate: number;
  directionalEdge: number;
  selectedDirection: EdgeCandidateDirection;
  rawProfit: number;
  reverseProfit: number;
}): number {
  const profit = input.selectedDirection === "REVERSE" ? input.reverseProfit : input.rawProfit;
  const sampleScore = Math.min(input.sample, 100) * 0.25;
  const winRateScore = input.effectiveWinRate * 0.45;
  const edgeScore = input.directionalEdge * 1.2;
  const profitScore = Math.max(Math.min(profit, 30), -30) * 0.8;
  return round(sampleScore + winRateScore + edgeScore + profitScore, 4);
}

function statusOf(input: {
  sample: number;
  effectiveWinRate: number;
  selectedDirection: EdgeCandidateDirection;
  rawProfit: number;
  reverseProfit: number;
  classification: string;
  options: Required<EdgeCandidateTrackerOptions>;
}): EdgeCandidateStatus {
  const profit = input.selectedDirection === "REVERSE" ? input.reverseProfit : input.rawProfit;

  if (
    input.sample >= input.options.adoptMinSample &&
    input.effectiveWinRate >= input.options.adoptEffectiveWinRate &&
    profit > 0
  ) {
    return "ADOPT_READY";
  }

  if (input.classification === "BLOCK") return "BLOCK";

  return "WATCH";
}

function reasonOf(candidate: {
  selectedDirection: EdgeCandidateDirection;
  sample: number;
  effectiveWinRate: number;
  directionalEdge: number;
  rawProfit: number;
  reverseProfit: number;
  status: EdgeCandidateStatus;
}): string {
  const directionText = candidate.selectedDirection === "REVERSE" ? "反転方向" : "順方向";
  const profit = candidate.selectedDirection === "REVERSE" ? candidate.reverseProfit : candidate.rawProfit;

  if (candidate.status === "ADOPT_READY") {
    return `${directionText}で有効勝率${candidate.effectiveWinRate}%、Edge${candidate.directionalEdge}%、Profit${round(profit, 2)}。採用候補だがTrading Engine接続前に前向き検証が必要。`;
  }

  if (candidate.status === "BLOCK") {
    return `有効勝率${candidate.effectiveWinRate}%、Edge${candidate.directionalEdge}%で優位性が弱い。現時点では採用しない。`;
  }

  return `${directionText}で有効勝率${candidate.effectiveWinRate}%、Edge${candidate.directionalEdge}%、Profit${round(profit, 2)}。サンプル${candidate.sample}件のため監視候補。`;
}

function fromBidirectional(edge: BidirectionalEdgeItem, options: Required<EdgeCandidateTrackerOptions>): EdgeCandidate {
  const selectedDirection = edge.selectedDirection === "REVERSE" ? "REVERSE" : "FORWARD";
  const values = [edge.value];
  const status = statusOf({
    sample: edge.sample,
    effectiveWinRate: edge.effectiveWinRate,
    selectedDirection,
    rawProfit: edge.rawProfit,
    reverseProfit: edge.reverseProfit,
    classification: edge.classification,
    options,
  });
  const candidate: EdgeCandidate = {
    id: `BIDIRECTIONAL:${edge.feature}:${edge.value}`,
    kind: "BIDIRECTIONAL",
    key: `${edge.feature}=${edge.value}`,
    feature: edge.feature,
    value: edge.value,
    features: [edge.feature],
    values,
    sample: edge.sample,
    wins: edge.wins,
    losses: edge.losses,
    draws: edge.draws,
    rawWinRate: edge.rawWinRate,
    reverseWinRate: edge.reverseWinRate,
    effectiveWinRate: edge.effectiveWinRate,
    directionalEdge: edge.directionalEdge,
    rawProfit: edge.rawProfit,
    reverseProfit: edge.reverseProfit,
    avgRawProfit: edge.avgRawProfit,
    avgReverseProfit: edge.avgReverseProfit,
    selectedDirection,
    status,
    classification: edge.classification,
    priorityScore: 0,
    reason: "",
    tradeIds: edge.tradeIds,
  };
  candidate.priorityScore = priorityScore(candidate);
  candidate.reason = reasonOf(candidate);
  return candidate;
}

function fromRegime(pattern: RegimeEdgePattern, options: Required<EdgeCandidateTrackerOptions>): EdgeCandidate {
  const selectedDirection = pattern.selectedDirection === "REVERSE" ? "REVERSE" : "FORWARD";
  const status = statusOf({
    sample: pattern.sample,
    effectiveWinRate: pattern.effectiveWinRate,
    selectedDirection,
    rawProfit: pattern.rawProfit,
    reverseProfit: pattern.reverseProfit,
    classification: pattern.classification,
    options,
  });
  const candidate: EdgeCandidate = {
    id: `REGIME:${pattern.key}`,
    kind: "REGIME",
    key: pattern.key,
    features: pattern.features,
    values: pattern.values,
    sample: pattern.sample,
    wins: pattern.wins,
    losses: pattern.losses,
    draws: pattern.draws,
    rawWinRate: pattern.rawWinRate,
    reverseWinRate: pattern.reverseWinRate,
    effectiveWinRate: pattern.effectiveWinRate,
    directionalEdge: pattern.directionalEdge,
    rawProfit: pattern.rawProfit,
    reverseProfit: pattern.reverseProfit,
    avgRawProfit: pattern.avgRawProfit,
    avgReverseProfit: pattern.avgReverseProfit,
    selectedDirection,
    status,
    classification: pattern.classification,
    priorityScore: 0,
    reason: "",
    tradeIds: pattern.tradeIds,
  };
  candidate.priorityScore = priorityScore(candidate);
  candidate.reason = reasonOf(candidate);
  return candidate;
}

function dedupeCandidates(candidates: EdgeCandidate[]): EdgeCandidate[] {
  const map = new Map<string, EdgeCandidate>();
  for (const candidate of candidates) {
    const current = map.get(candidate.id);
    if (!current || candidate.priorityScore > current.priorityScore) {
      map.set(candidate.id, candidate);
    }
  }
  return Array.from(map.values());
}

export function getEdgeCandidates(options: EdgeCandidateTrackerOptions = {}): EdgeCandidateTrackerResult {
  const resolved: Required<EdgeCandidateTrackerOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  const sharedOptions: BidirectionalEdgeOptions & RegimeEdgeOptions = {
    minSample: resolved.minSample,
    adoptMinSample: resolved.adoptMinSample,
    watchMinSample: resolved.watchMinSample,
    adoptEffectiveWinRate: resolved.adoptEffectiveWinRate,
    watchEffectiveWinRate: resolved.watchEffectiveWinRate,
    neutralEdgeThreshold: resolved.neutralEdgeThreshold,
    limit: Math.max(resolved.limit, 200),
    includeNeutral: false,
    includeUnknown: resolved.includeUnknown,
  };

  const bidirectional = analyzeBidirectionalEdges(sharedOptions);
  const regime = analyzeRegimeEdges(sharedOptions);

  const rawCandidates: EdgeCandidate[] = [
    ...bidirectional.edges.map((edge) => fromBidirectional(edge, resolved)),
    ...regime.patterns.map((pattern) => fromRegime(pattern, resolved)),
  ];

  const filtered = rawCandidates.filter((candidate) => {
    if (!resolved.includeUnknown && hasUnknown(candidate.values)) return false;
    if (!resolved.includeBlock && candidate.status === "BLOCK") return false;
    if (candidate.status === "ADOPT_READY") return true;
    if (candidate.sample < resolved.watchMinSample) return false;
    if (candidate.effectiveWinRate < resolved.watchEffectiveWinRate) return false;
    return true;
  });

  const candidates = dedupeCandidates(filtered)
    .sort((a, b) => {
      if (b.status !== a.status) {
        if (a.status === "ADOPT_READY") return -1;
        if (b.status === "ADOPT_READY") return 1;
      }
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      if (b.directionalEdge !== a.directionalEdge) return b.directionalEdge - a.directionalEdge;
      if (b.sample !== a.sample) return b.sample - a.sample;
      return b.effectiveWinRate - a.effectiveWinRate;
    })
    .slice(0, resolved.limit);

  return {
    generatedAt: new Date().toISOString(),
    totalTrades: Math.max(bidirectional.totalTrades, regime.totalTrades),
    usedTrades: Math.max(bidirectional.usedTrades, regime.usedTrades),
    dbPath: bidirectional.dbPath || regime.dbPath,
    tableName: bidirectional.tableName || regime.tableName,
    options: resolved,
    candidates,
    forwardWatch: candidates.filter((candidate) => candidate.status === "WATCH" && candidate.selectedDirection === "FORWARD"),
    reverseWatch: candidates.filter((candidate) => candidate.status === "WATCH" && candidate.selectedDirection === "REVERSE"),
    adoptReady: candidates.filter((candidate) => candidate.status === "ADOPT_READY"),
    block: candidates.filter((candidate) => candidate.status === "BLOCK"),
    message: "Edge候補をランキングしました。Trading Engineには接続していません。ADOPT_READYも前向き検証前は自動採用しません。",
  };
}
