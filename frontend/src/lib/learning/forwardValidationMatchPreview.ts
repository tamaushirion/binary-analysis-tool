import { getServerAutoRunnerStatus } from "@/lib/serverAutoRunner";

export type ForwardValidationDirection = "FORWARD" | "REVERSE";
export type CandidateMatchStatus = "MATCH" | "NO_MATCH" | "UNKNOWN";

type CandidateRule = {
  id: string;
  key: string;
  selectedDirection: ForwardValidationDirection;
  priority: number;
  conditions: Array<{
    label: string;
    field: string;
    expected: string;
    test: (ctx: PreviewContext) => boolean | null;
  }>;
};

type PreviewContext = {
  generatedAt: string;
  lastRunAt: string | null;
  stage: string | null;
  pair: string | null;
  selectedDirection: string | null;
  selectedScore: number | null;
  highScore: number | null;
  lowScore: number | null;
  confidence: number | null;
  similarityScore: number | null;
  rci9: number | null;
  rci26: number | null;
  rci52: number | null;
  atr: number | null;
  ema9: number | null;
  ema21: number | null;
  emaTrend: string;
  hourJst: number | null;
  session: string;
  scoreBand: string;
  confidenceBand: string;
  similarityBand: string;
  rci9Band: string;
  debugSource: string;
  scoreSource: string;
  similaritySource: string;
  confidenceSource: string;
};

export type ForwardValidationMatchPreview = {
  generatedAt: string;
  analyzerVersion: "phase16-h2-forward-validation-match-preview-v2";
  context: PreviewContext;
  matched: CandidateMatchResult[];
  unmatched: CandidateMatchResult[];
  unknown: CandidateMatchResult[];
  message: string;
};

export type CandidateMatchResult = {
  id: string;
  key: string;
  selectedDirection: ForwardValidationDirection;
  priority: number;
  status: CandidateMatchStatus;
  matchedConditions: number;
  totalConditions: number;
  details: Array<{
    label: string;
    field: string;
    expected: string;
    actual: string;
    pass: boolean | null;
  }>;
  reason: string;
};

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readPath(source: unknown, path: string): unknown {
  if (!source || typeof source !== "object") return null;
  let current: unknown = source;
  for (const key of path.split(".")) {
    if (!current || typeof current !== "object" || !(key in current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function numberFromPaths(source: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const n = toNumber(readPath(source, path));
    if (n !== null) return n;
  }
  return null;
}


function valueFromPaths(source: unknown, paths: string[]): { value: unknown; path: string | null } {
  for (const path of paths) {
    const value = readPath(source, path);
    if (value !== null && value !== undefined && value !== "") return { value, path };
  }
  return { value: null, path: null };
}

function numberWithSource(source: unknown, paths: string[]): { value: number | null; path: string | null } {
  for (const path of paths) {
    const n = toNumber(readPath(source, path));
    if (n !== null) return { value: n, path };
  }
  return { value: null, path: null };
}

function resolveDebugSource(last: unknown): { debug: unknown; source: string } {
  const candidates: Array<{ source: string; value: unknown }> = [
    { source: "autoRunnerProviderDebug", value: readPath(last, "autoRunnerProviderDebug") },
    { source: "providerDebug", value: readPath(last, "providerDebug") },
    { source: "debug", value: readPath(last, "debug") },
    { source: "forwardValidation.recordResult.context", value: readPath(last, "forwardValidation.recordResult.context") },
    { source: "forwardValidation.context", value: readPath(last, "forwardValidation.context") },
  ];

  for (const candidate of candidates) {
    if (candidate.value && typeof candidate.value === "object") {
      return { debug: candidate.value, source: candidate.source };
    }
  }

  return { debug: null, source: "none" };
}

function deriveSelectedScore(input: {
  last: unknown;
  debug: unknown;
  selectedDirection: string | null;
  highScore: number | null;
  lowScore: number | null;
}): { value: number | null; source: string } {
  const direct = numberWithSource(input.last, [
    "autoRunnerProviderDebug.selectedScore",
    "providerDebug.selectedScore",
    "debug.selectedScore",
    "forwardValidation.recordResult.context.selectedScore",
    "finalScore",
    "empiricalEntryGate.originalScore",
    "empiricalEntryGate.adjustedScore",
    "entryGate.score",
  ]);

  if (direct.value !== null && direct.value > 0) {
    return { value: direct.value, source: direct.path ?? "direct" };
  }

  const debugDirect = numberWithSource(input.debug, ["selectedScore", "score"]);
  if (debugDirect.value !== null && debugDirect.value > 0) {
    return { value: debugDirect.value, source: `debug.${debugDirect.path}` };
  }

  if (input.selectedDirection === "HIGH" && input.highScore !== null) {
    return { value: input.highScore, source: "derived:HIGH->highScore" };
  }

  if (input.selectedDirection === "LOW" && input.lowScore !== null) {
    return { value: input.lowScore, source: "derived:LOW->lowScore" };
  }

  if (input.highScore !== null && input.lowScore !== null) {
    return input.highScore >= input.lowScore
      ? { value: input.highScore, source: "derived:max(highScore,lowScore)" }
      : { value: input.lowScore, source: "derived:max(highScore,lowScore)" };
  }

  if (direct.value !== null) {
    return { value: direct.value, source: direct.path ?? "direct_zero" };
  }

  return { value: null, source: "unresolved" };
}

function stringFromPaths(source: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const v = readPath(source, path);
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

function getJstHour(iso: string | null): number | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  return Number.isFinite(hour) ? hour : null;
}

function sessionFromJstHour(hour: number | null): string {
  if (hour === null) return "UNKNOWN";
  if (hour >= 8 && hour <= 15) return "TOKYO";
  if (hour >= 16 && hour <= 21) return "LONDON";
  if (hour >= 22 || hour <= 5) return "NEW_YORK";
  return "OFF_HOURS";
}

function band(value: number | null, label: string): string {
  if (value === null) return `${label}:UNKNOWN`;
  const start = Math.floor(value / 10) * 10;
  return `${label}:${start}-${start + 9}`;
}

function rciBand(value: number | null): string {
  if (value === null) return "RCI9:UNKNOWN";
  if (value <= -80) return "RCI9:OVERSOLD(<=-80)";
  if (value <= -50) return "RCI9:STRONG_DOWN(-79--50)";
  if (value < 50) return "RCI9:NEUTRAL(-49-49)";
  if (value < 80) return "RCI9:STRONG_UP(50-79)";
  return "RCI9:OVERBOUGHT(>=80)";
}

function buildContext(): PreviewContext {
  const status = getServerAutoRunnerStatus();
  const last = status.lastResult ?? null;
  const resolvedDebug = resolveDebugSource(last);
  const debug = resolvedDebug.debug;
  const lastRunAt = typeof status.lastRunAt === "string" ? status.lastRunAt : null;
  const hourJst = getJstHour(lastRunAt);

  const selectedDirection = stringFromPaths(debug, ["selectedDirection", "direction"])
    ?? stringFromPaths(last, ["autoRunnerProviderDebug.selectedDirection", "providerDebug.selectedDirection", "debug.selectedDirection", "direction"]);
  const highScore = numberFromPaths(debug, ["highScore"]);
  const lowScore = numberFromPaths(debug, ["lowScore"]);
  const selectedScoreResult = deriveSelectedScore({ last, debug, selectedDirection, highScore, lowScore });
  const selectedScore = selectedScoreResult.value;

  const confidenceResult = numberWithSource(last, [
    "confidence.confidence",
    "forwardValidation.recordResult.context.confidence",
    "features.confidence",
  ]);
  const confidence = confidenceResult.value;

  const similarityResult = numberWithSource(last, [
    "similarity.adjustedScore",
    "similarity.baseScore",
    "autoRunnerProviderDebug.similarityScore",
    "providerDebug.similarityScore",
    "debug.similarityScore",
    "forwardValidation.recordResult.context.similarityScore",
    "features.similarityScore",
  ]);
  const similarityScore = similarityResult.value;

  const rci9 = numberFromPaths(debug, ["rci9"]);
  const rci26 = numberFromPaths(debug, ["rci26"]);
  const rci52 = numberFromPaths(debug, ["rci52"]);
  const ema9 = numberFromPaths(debug, ["ema9"]);
  const ema21 = numberFromPaths(debug, ["ema21"]);
  const emaTrend = ema9 === null || ema21 === null ? "UNKNOWN" : ema9 > ema21 ? "UP" : ema9 < ema21 ? "DOWN" : "FLAT";

  return {
    generatedAt: new Date().toISOString(),
    lastRunAt,
    stage: stringFromPaths(last, ["stage"]),
    pair: stringFromPaths(debug, ["asset.pair", "pair"]),
    selectedDirection,
    selectedScore,
    highScore,
    lowScore,
    confidence,
    similarityScore,
    rci9,
    rci26,
    rci52,
    atr: numberFromPaths(debug, ["atr"]),
    ema9,
    ema21,
    emaTrend,
    hourJst,
    session: sessionFromJstHour(hourJst),
    scoreBand: band(selectedScore, "Score"),
    confidenceBand: band(confidence, "Confidence"),
    similarityBand: band(similarityScore, "Similarity"),
    rci9Band: rciBand(rci9),
    debugSource: resolvedDebug.source,
    scoreSource: selectedScoreResult.source,
    similaritySource: similarityResult.path ?? "unresolved",
    confidenceSource: confidenceResult.path ?? "unresolved",
  };
}
function actualValue(ctx: PreviewContext, field: string): string {
  const value = (ctx as unknown as Record<string, unknown>)[field];
  if (value === null || value === undefined || value === "") return "UNKNOWN";
  return String(value);
}

const CANDIDATE_RULES: CandidateRule[] = [
  {
    id: "BIDIRECTIONAL:Similarity:100-109:REVERSE",
    key: "Similarity:100-109",
    selectedDirection: "REVERSE",
    priority: 1,
    conditions: [
      {
        label: "Similarity band",
        field: "similarityBand",
        expected: "Similarity:100-109",
        test: (ctx) => (ctx.similarityScore === null ? null : ctx.similarityBand === "Similarity:100-109"),
      },
    ],
  },
  {
    id: "REGIME:RCI9_OVERSOLD_NEW_YORK:REVERSE",
    key: "RCI9:OVERSOLD(<=-80) × Session:NEW_YORK",
    selectedDirection: "REVERSE",
    priority: 2,
    conditions: [
      {
        label: "RCI9 oversold",
        field: "rci9Band",
        expected: "RCI9:OVERSOLD(<=-80)",
        test: (ctx) => (ctx.rci9 === null ? null : ctx.rci9 <= -80),
      },
      {
        label: "Session",
        field: "session",
        expected: "NEW_YORK",
        test: (ctx) => (ctx.session === "UNKNOWN" ? null : ctx.session === "NEW_YORK"),
      },
    ],
  },
  {
    id: "REGIME:Similarity_70_79_Hour_23:REVERSE",
    key: "Similarity:70-79 × Hour:23",
    selectedDirection: "REVERSE",
    priority: 3,
    conditions: [
      {
        label: "Similarity band",
        field: "similarityBand",
        expected: "Similarity:70-79",
        test: (ctx) => (ctx.similarityScore === null ? null : ctx.similarityBand === "Similarity:70-79"),
      },
      {
        label: "Hour JST",
        field: "hourJst",
        expected: "23",
        test: (ctx) => (ctx.hourJst === null ? null : ctx.hourJst === 23),
      },
    ],
  },
  {
    id: "REGIME:Similarity_90_99_RCI9_NEUTRAL:FORWARD",
    key: "Similarity:90-99 × RCI9:NEUTRAL(-49-49)",
    selectedDirection: "FORWARD",
    priority: 4,
    conditions: [
      {
        label: "Similarity band",
        field: "similarityBand",
        expected: "Similarity:90-99",
        test: (ctx) => (ctx.similarityScore === null ? null : ctx.similarityBand === "Similarity:90-99"),
      },
      {
        label: "RCI9 neutral",
        field: "rci9Band",
        expected: "RCI9:NEUTRAL(-49-49)",
        test: (ctx) => (ctx.rci9 === null ? null : ctx.rci9 > -50 && ctx.rci9 < 50),
      },
    ],
  },
  {
    id: "REGIME:Score_60_69_Direction_HIGH:FORWARD",
    key: "Score:60-69 × Direction:HIGH",
    selectedDirection: "FORWARD",
    priority: 5,
    conditions: [
      {
        label: "Score band",
        field: "scoreBand",
        expected: "Score:60-69",
        test: (ctx) => (ctx.selectedScore === null ? null : ctx.scoreBand === "Score:60-69"),
      },
      {
        label: "Direction",
        field: "selectedDirection",
        expected: "HIGH",
        test: (ctx) => (ctx.selectedDirection === null ? null : ctx.selectedDirection === "HIGH"),
      },
    ],
  },
];

function evaluateRule(rule: CandidateRule, ctx: PreviewContext): CandidateMatchResult {
  const details = rule.conditions.map((condition) => {
    const pass = condition.test(ctx);
    return {
      label: condition.label,
      field: condition.field,
      expected: condition.expected,
      actual: actualValue(ctx, condition.field),
      pass,
    };
  });
  const matchedConditions = details.filter((detail) => detail.pass === true).length;
  const hasUnknown = details.some((detail) => detail.pass === null);
  const status: CandidateMatchStatus = matchedConditions === details.length ? "MATCH" : hasUnknown ? "UNKNOWN" : "NO_MATCH";
  const failed = details.filter((detail) => detail.pass === false);
  const unknown = details.filter((detail) => detail.pass === null);
  const reason =
    status === "MATCH"
      ? "Forward Validation候補に一致しています。実Buyではなく仮想検証対象です。"
      : status === "UNKNOWN"
        ? `${unknown.map((item) => item.label).join(" / ")} が取得できないため判定保留です。`
        : `${failed.map((item) => `${item.label}: ${item.actual} != ${item.expected}`).join(" / ")} のため不一致です。`;

  return {
    id: rule.id,
    key: rule.key,
    selectedDirection: rule.selectedDirection,
    priority: rule.priority,
    status,
    matchedConditions,
    totalConditions: details.length,
    details,
    reason,
  };
}

export function previewForwardValidationCandidateMatches(): ForwardValidationMatchPreview {
  const context = buildContext();
  const results = CANDIDATE_RULES.map((rule) => evaluateRule(rule, context)).sort((a, b) => {
    if (a.status !== b.status) {
      const rank: Record<CandidateMatchStatus, number> = { MATCH: 0, UNKNOWN: 1, NO_MATCH: 2 };
      return rank[a.status] - rank[b.status];
    }
    return a.priority - b.priority;
  });

  return {
    generatedAt: new Date().toISOString(),
    analyzerVersion: "phase16-h2-forward-validation-match-preview-v2",
    context,
    matched: results.filter((item) => item.status === "MATCH"),
    unmatched: results.filter((item) => item.status === "NO_MATCH"),
    unknown: results.filter((item) => item.status === "UNKNOWN"),
    message: "直近Auto Runner結果がForward Validation候補に一致しているかを判定しました。H2ではdebug/providerDebug/engine結果からScoreを補完します。外部APIやDeriv追加コールは行いません。",
  };
}
