import db from "@/lib/db/database";

export type WeightLearningInput = {
  pair: string;
  direction: "HIGH" | "LOW";
  score: number;
  payoutRate?: number | null;
  startTime?: number | null;
};

export type WeightLearningResult = {
  baseScore: number;
  adjustedScore: number;
  totalWeight: number;
  weights: {
    hourWeight: number;
    pairWeight: number;
    directionWeight: number;
    payoutWeight: number;
    scoreBandWeight: number;
  };
  reasons: string[];
};

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function getWinRateWeight(winRate: number | null, totalTrades: number) {
  if (!winRate || totalTrades < 5) return 0;

  if (winRate >= 80) return 8;
  if (winRate >= 70) return 5;
  if (winRate >= 60) return 2;
  if (winRate <= 35) return -10;
  if (winRate <= 45) return -6;
  if (winRate <= 50) return -3;

  return 0;
}

function getScoreBand(score: number) {
  if (score >= 90) return "90-100";
  if (score >= 80) return "80-89";
  if (score >= 70) return "70-79";
  return "0-69";
}

function getPayoutBand(payoutRate?: number | null) {
  if (!payoutRate) return "unknown";
  if (payoutRate >= 1.95) return "1.95+";
  if (payoutRate >= 1.9) return "1.90-1.94";
  if (payoutRate >= 1.8) return "1.80-1.89";
  return "0-1.79";
}

function getCurrentHour(startTime?: number | null) {
  const date = startTime ? new Date(startTime * 1000) : new Date();
  return date.getHours();
}

function getStat(query: string, params: any[]) {
  return db.prepare(query).get(...params) as
    | {
        totalTrades: number;
        winRate: number | null;
      }
    | undefined;
}

export function applyWeightLearning(
  input: WeightLearningInput
): WeightLearningResult {
  const hour = getCurrentHour(input.startTime);
  const scoreBand = getScoreBand(input.score);
  const payoutBand = getPayoutBand(input.payoutRate);

  const reasons: string[] = [];

  const hourStat = getStat(
    `
    SELECT
      COUNT(*) as totalTrades,
      ROUND(100.0 * SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) / COUNT(*), 2) as winRate
    FROM trade_history
    WHERE CAST(strftime('%H', datetime(start_time, 'unixepoch', 'localtime')) AS INTEGER) = ?
    `,
    [hour]
  );

  const pairStat = getStat(
    `
    SELECT
      COUNT(*) as totalTrades,
      ROUND(100.0 * SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) / COUNT(*), 2) as winRate
    FROM trade_history
    WHERE pair = ?
    `,
    [input.pair]
  );

  const directionStat = getStat(
    `
    SELECT
      COUNT(*) as totalTrades,
      ROUND(100.0 * SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) / COUNT(*), 2) as winRate
    FROM trade_history
    WHERE direction = ?
    `,
    [input.direction]
  );

  const scoreBandStat = getStat(
    `
    SELECT
      COUNT(*) as totalTrades,
      ROUND(100.0 * SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) / COUNT(*), 2) as winRate
    FROM trade_history
    WHERE
      CASE
        WHEN score >= 90 THEN '90-100'
        WHEN score >= 80 THEN '80-89'
        WHEN score >= 70 THEN '70-79'
        ELSE '0-69'
      END = ?
    `,
    [scoreBand]
  );

  const payoutStat = getStat(
    `
    SELECT
      COUNT(*) as totalTrades,
      ROUND(100.0 * SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) / COUNT(*), 2) as winRate
    FROM trade_history
    WHERE
      CASE
        WHEN payout_rate >= 1.95 THEN '1.95+'
        WHEN payout_rate >= 1.90 THEN '1.90-1.94'
        WHEN payout_rate >= 1.80 THEN '1.80-1.89'
        ELSE '0-1.79'
      END = ?
    `,
    [payoutBand]
  );

  const hourWeight = getWinRateWeight(
    hourStat?.winRate ?? null,
    hourStat?.totalTrades ?? 0
  );

  const pairWeight = getWinRateWeight(
    pairStat?.winRate ?? null,
    pairStat?.totalTrades ?? 0
  );

  const directionWeight = getWinRateWeight(
    directionStat?.winRate ?? null,
    directionStat?.totalTrades ?? 0
  );

  const payoutWeight = getWinRateWeight(
    payoutStat?.winRate ?? null,
    payoutStat?.totalTrades ?? 0
  );

  const scoreBandWeight = getWinRateWeight(
    scoreBandStat?.winRate ?? null,
    scoreBandStat?.totalTrades ?? 0
  );

  const weights = {
    hourWeight,
    pairWeight,
    directionWeight,
    payoutWeight,
    scoreBandWeight,
  };

  const totalWeight =
    hourWeight +
    pairWeight +
    directionWeight +
    payoutWeight +
    scoreBandWeight;

  if ((hourStat?.totalTrades ?? 0) < 5) reasons.push(`時間帯${hour}時: データ不足`);
  else reasons.push(`時間帯${hour}時補正: ${hourWeight}`);

  if ((pairStat?.totalTrades ?? 0) < 5) reasons.push(`${input.pair}: データ不足`);
  else reasons.push(`${input.pair}補正: ${pairWeight}`);

  if ((directionStat?.totalTrades ?? 0) < 5)
    reasons.push(`${input.direction}: データ不足`);
  else reasons.push(`${input.direction}補正: ${directionWeight}`);

  if ((payoutStat?.totalTrades ?? 0) < 5)
    reasons.push(`Payout ${payoutBand}: データ不足`);
  else reasons.push(`Payout ${payoutBand}補正: ${payoutWeight}`);

  if ((scoreBandStat?.totalTrades ?? 0) < 5)
    reasons.push(`Score ${scoreBand}: データ不足`);
  else reasons.push(`Score ${scoreBand}補正: ${scoreBandWeight}`);

  return {
    baseScore: input.score,
    adjustedScore: clampScore(input.score + totalWeight),
    totalWeight,
    weights,
    reasons,
  };
}