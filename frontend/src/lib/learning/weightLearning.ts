import db from "@/lib/db/database";
import type { TradeFeatureSnapshot } from "@/lib/db/tradeRepository";

export type WeightLearningInput = {
  pair: string;
  direction: "HIGH" | "LOW";
  score: number;
  payoutRate?: number | null;
  startTime?: number | null;
  features?: TradeFeatureSnapshot | null;
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
    emaTrendWeight: number;
    smcWeight: number;
    atrWeight: number;
    entryGateWeight: number;
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

function getAtrBand(atr?: number | null) {
  if (!atr || atr <= 0) return "unknown";
  if (atr < 0.03) return "LOW";
  if (atr < 0.08) return "NORMAL";
  return "HIGH";
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

function statToWeight(
  label: string,
  stat: { totalTrades: number; winRate: number | null } | undefined,
  reasons: string[]
) {
  const totalTrades = stat?.totalTrades ?? 0;
  const winRate = stat?.winRate ?? null;
  const weight = getWinRateWeight(winRate, totalTrades);

  if (totalTrades < 5) {
    reasons.push(`${label}: データ不足`);
  } else {
    reasons.push(`${label}: 勝率${winRate}% / 補正${weight}`);
  }

  return weight;
}

export function applyWeightLearning(
  input: WeightLearningInput
): WeightLearningResult {
  const hour = getCurrentHour(input.startTime);
  const scoreBand = getScoreBand(input.score);
  const payoutBand = getPayoutBand(input.payoutRate);
  const atrBand = getAtrBand(input.features?.atr);

  const emaTrend =
    input.features?.emaDiff == null
      ? "unknown"
      : Number(input.features.emaDiff) > 0
      ? "UP"
      : Number(input.features.emaDiff) < 0
      ? "DOWN"
      : "RANGE";

  const smcKey = [
    input.features?.bos ? "BOS" : "",
    input.features?.choch ? "CHOCH" : "",
    input.features?.fvg ? "FVG" : "",
  ]
    .filter(Boolean)
    .join("+") || "NONE";

  const entryGateKey =
    input.features?.entryGate === true
      ? "PASS"
      : input.features?.entryGate === false
      ? "BLOCK"
      : "unknown";

  const reasons: string[] = [];

  const hourStat = getStat(
    `
    SELECT
      COUNT(*) as totalTrades,
      ROUND(100.0 * SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) / COUNT(*), 2) as winRate
    FROM trade_history
    WHERE COALESCE(hour, CAST(strftime('%H', datetime(start_time, 'unixepoch', 'localtime')) AS INTEGER)) = ?
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

  const emaTrendStat = getStat(
    `
    SELECT
      COUNT(*) as totalTrades,
      ROUND(100.0 * SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) / COUNT(*), 2) as winRate
    FROM trade_history
    WHERE
      CASE
        WHEN ema_diff > 0 THEN 'UP'
        WHEN ema_diff < 0 THEN 'DOWN'
        ELSE 'RANGE'
      END = ?
    `,
    [emaTrend]
  );

  const smcStat = getStat(
    `
    SELECT
      COUNT(*) as totalTrades,
      ROUND(100.0 * SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) / COUNT(*), 2) as winRate
    FROM trade_history
    WHERE
      (
        CASE WHEN bos = 1 THEN 'BOS' ELSE '' END ||
        CASE WHEN choch = 1 THEN '+CHOCH' ELSE '' END ||
        CASE WHEN fvg = 1 THEN '+FVG' ELSE '' END
      ) LIKE ?
    `,
    [`%${smcKey.split("+")[0] === "NONE" ? "" : smcKey.split("+")[0]}%`]
  );

  const atrStat = getStat(
    `
    SELECT
      COUNT(*) as totalTrades,
      ROUND(100.0 * SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) / COUNT(*), 2) as winRate
    FROM trade_history
    WHERE
      CASE
        WHEN atr IS NULL OR atr <= 0 THEN 'unknown'
        WHEN atr < 0.03 THEN 'LOW'
        WHEN atr < 0.08 THEN 'NORMAL'
        ELSE 'HIGH'
      END = ?
    `,
    [atrBand]
  );

  const entryGateStat = getStat(
    `
    SELECT
      COUNT(*) as totalTrades,
      ROUND(100.0 * SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) / COUNT(*), 2) as winRate
    FROM trade_history
    WHERE json_extract(feature_snapshot, '$.entryGate') = ?
    `,
    [entryGateKey === "PASS" ? 1 : entryGateKey === "BLOCK" ? 0 : null]
  );

  const hourWeight = statToWeight(`時間帯${hour}時`, hourStat, reasons);
  const pairWeight = statToWeight(input.pair, pairStat, reasons);
  const directionWeight = statToWeight(input.direction, directionStat, reasons);
  const payoutWeight = statToWeight(`Payout ${payoutBand}`, payoutStat, reasons);
  const scoreBandWeight = statToWeight(`Score ${scoreBand}`, scoreBandStat, reasons);
  const emaTrendWeight = statToWeight(`EMA ${emaTrend}`, emaTrendStat, reasons);
  const smcWeight = statToWeight(`SMC ${smcKey}`, smcStat, reasons);
  const atrWeight = statToWeight(`ATR ${atrBand}`, atrStat, reasons);
  const entryGateWeight = statToWeight(`EntryGate ${entryGateKey}`, entryGateStat, reasons);

  const weights = {
    hourWeight,
    pairWeight,
    directionWeight,
    payoutWeight,
    scoreBandWeight,
    emaTrendWeight,
    smcWeight,
    atrWeight,
    entryGateWeight,
  };

  const totalWeight =
    hourWeight +
    pairWeight +
    directionWeight +
    payoutWeight +
    scoreBandWeight +
    emaTrendWeight +
    smcWeight +
    atrWeight +
    entryGateWeight;

  return {
    baseScore: input.score,
    adjustedScore: clampScore(input.score + totalWeight),
    totalWeight,
    weights,
    reasons,
  };
}