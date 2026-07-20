import db from "@/lib/db/database";

export type RejectShadowClassification =
  | "COLLECTING"
  | "HOLD"
  | "WATCH"
  | "REVIEW_CANDIDATE"
  | "REJECT_CONTINUE";

type ShadowRow = {
  rejectStage: string;
  direction: "HIGH" | "LOW";
  inputScore: number;
  status: "WIN" | "LOST" | "DRAW";
  profit: number;
  featureSnapshotJson: string | null;
};

type SegmentAccumulator = {
  rejectStage: string;
  dimension: string;
  label: string;
  settled: number;
  wins: number;
  losses: number;
  draws: number;
  totalProfit: number;
};

type FeatureSnapshot = Record<string, unknown>;

const WATCH_MIN_SAMPLE = 30;
const REVIEW_MIN_SAMPLE = 50;
const TARGET_WIN_RATE = 58;
const REVIEW_WILSON_LOWER_BOUND = 45;

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonEmptyText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function parseSnapshot(value: string | null): FeatureSnapshot {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as FeatureSnapshot)
      : {};
  } catch {
    return {};
  }
}

function scoreBand(value: number) {
  const start = Math.floor(value / 10) * 10;
  return `${start}-${start + 9}`;
}

function rciBand(value: number) {
  if (value <= -80) return "OVERSOLD(<=-80)";
  if (value < -50) return "STRONG_DOWN(-79--51)";
  if (value < 50) return "NEUTRAL(-50-49)";
  if (value < 80) return "STRONG_UP(50-79)";
  return "OVERBOUGHT(>=80)";
}

function wilsonLowerBound(wins: number, losses: number) {
  const total = wins + losses;
  if (total === 0) return null;
  const z = 1.96;
  const p = wins / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin =
    z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return round2(((centre - margin) / denominator) * 100);
}

function classify(input: {
  settled: number;
  winRate: number | null;
  totalProfit: number;
  wilsonLowerBound: number | null;
}): RejectShadowClassification {
  if (input.settled < WATCH_MIN_SAMPLE) return "COLLECTING";
  if ((input.winRate ?? 0) < 50 || input.totalProfit <= 0) {
    return "REJECT_CONTINUE";
  }
  if (
    input.settled >= REVIEW_MIN_SAMPLE &&
    (input.winRate ?? 0) >= TARGET_WIN_RATE &&
    input.totalProfit > 0 &&
    (input.wilsonLowerBound ?? 0) >= REVIEW_WILSON_LOWER_BOUND
  ) {
    return "REVIEW_CANDIDATE";
  }
  if ((input.winRate ?? 0) >= TARGET_WIN_RATE && input.totalProfit > 0) {
    return "WATCH";
  }
  return "HOLD";
}

function segmentValues(row: ShadowRow, snapshot: FeatureSnapshot) {
  const values: Array<{ dimension: string; label: string }> = [
    { dimension: "gate", label: row.rejectStage },
    { dimension: "direction", label: row.direction },
    { dimension: "input_score", label: scoreBand(row.inputScore) },
  ];

  for (const key of ["rci9", "rci26", "rci52"] as const) {
    const value = finiteNumber(snapshot[key]);
    if (value !== null) values.push({ dimension: key, label: rciBand(value) });
  }

  const hour = finiteNumber(snapshot.hour);
  if (hour !== null && Number.isInteger(hour)) {
    values.push({ dimension: "hour", label: String(hour) });
  }
  const weekday = finiteNumber(snapshot.weekday);
  if (weekday !== null && Number.isInteger(weekday)) {
    values.push({ dimension: "weekday", label: String(weekday) });
  }
  const session = nonEmptyText(snapshot.session);
  if (session !== null) values.push({ dimension: "session", label: session });

  return values;
}

export function analyzeRejectShadows(input?: { sinceDays?: number | null }) {
  const sinceDays = input?.sinceDays ?? 30;
  const since =
    sinceDays === null ? null : Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  const rows = db
    .prepare(
      `SELECT
         reject_stage AS rejectStage,
         direction,
         input_score AS inputScore,
         status,
         COALESCE(profit, 0) AS profit,
         feature_snapshot_json AS featureSnapshotJson
       FROM entry_reject_shadows
       WHERE status IN ('WIN', 'LOST', 'DRAW')
         AND (@since IS NULL OR created_at >= @since)
       ORDER BY created_at ASC`,
    )
    .all({ since }) as ShadowRow[];

  const segments = new Map<string, SegmentAccumulator>();
  for (const row of rows) {
    const snapshot = parseSnapshot(row.featureSnapshotJson);
    for (const value of segmentValues(row, snapshot)) {
      const key = `${row.rejectStage}\u0000${value.dimension}\u0000${value.label}`;
      const segment = segments.get(key) ?? {
        rejectStage: row.rejectStage,
        dimension: value.dimension,
        label: value.label,
        settled: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        totalProfit: 0,
      };
      segment.settled += 1;
      if (row.status === "WIN") segment.wins += 1;
      if (row.status === "LOST") segment.losses += 1;
      if (row.status === "DRAW") segment.draws += 1;
      segment.totalProfit += row.profit;
      segments.set(key, segment);
    }
  }

  const priority: Record<RejectShadowClassification, number> = {
    REVIEW_CANDIDATE: 0,
    WATCH: 1,
    HOLD: 2,
    COLLECTING: 3,
    REJECT_CONTINUE: 4,
  };
  const candidates = [...segments.values()]
    .map((segment) => {
      const decided = segment.wins + segment.losses;
      const winRate =
        decided > 0 ? round2((segment.wins / decided) * 100) : null;
      const lowerBound = wilsonLowerBound(segment.wins, segment.losses);
      const totalProfit = round2(segment.totalProfit);
      const classification = classify({
        settled: segment.settled,
        winRate,
        totalProfit,
        wilsonLowerBound: lowerBound,
      });
      return {
        ...segment,
        totalProfit,
        winRate,
        wilsonLowerBound: lowerBound,
        classification,
        remainingToWatch: Math.max(WATCH_MIN_SAMPLE - segment.settled, 0),
        remainingToReview: Math.max(REVIEW_MIN_SAMPLE - segment.settled, 0),
      };
    })
    .sort(
      (a, b) =>
        priority[a.classification] - priority[b.classification] ||
        b.settled - a.settled ||
        (b.winRate ?? -1) - (a.winRate ?? -1) ||
        a.rejectStage.localeCompare(b.rejectStage),
    );

  return {
    ok: true as const,
    stage: "reject_shadow_analysis" as const,
    generatedAt: new Date().toISOString(),
    trackingOnly: true,
    appliesAutomatically: false,
    thresholds: {
      watchMinSample: WATCH_MIN_SAMPLE,
      reviewMinSample: REVIEW_MIN_SAMPLE,
      targetWinRate: TARGET_WIN_RATE,
      reviewWilsonLowerBound: REVIEW_WILSON_LOWER_BOUND,
      requiresPositiveProfit: true,
    },
    settledShadows: rows.length,
    reviewCandidates: candidates.filter(
      (item) => item.classification === "REVIEW_CANDIDATE",
    ).length,
    candidates,
    message:
      "拒否候補を条件別に分析しています。50件・勝率58%以上・Profitプラス・Wilson下限45%以上でも自動適用せず、レビュー候補として提示します。",
  };
}
