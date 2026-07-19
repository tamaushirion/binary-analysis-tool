export type Demo2RobustDirection = "HIGH" | "LOW";

export type Demo2RobustCandidateId =
  | "phase16_t_hour7_lowscore40_high"
  | "phase16_t_rci52_oversold_rci9_oversold_high"
  | "phase16_t_rci26_strongup_rci52_strongdown_high"
  | "phase16_t_lowscore80_weekday5_high"
  | "phase16_t_rci52_strongup_weekday3_high";

export type Demo2RobustCandidateMatch = {
  enabled: true;
  candidateId: Demo2RobustCandidateId;
  candidateName: string;
  direction: Demo2RobustDirection;
  directionalScore: number;
  historicalSample: number;
  historicalWinRate: number;
  recentWinRate: number;
  historicalProfit: number;
  reasons: string[];
};

export type Demo2RobustCandidateDecision =
  | {
      allow: true;
      match: Demo2RobustCandidateMatch;
      evaluatedCandidates: number;
      message: string;
    }
  | {
      allow: false;
      match: null;
      evaluatedCandidates: number;
      message: string;
      reasons: string[];
    };

export type Demo2RobustFeatureInput = {
  pair?: unknown;
  highScore?: unknown;
  lowScore?: unknown;
  selectedScore?: unknown;
  selectedDirection?: unknown;
  rci9?: unknown;
  rci26?: unknown;
  rci52?: unknown;
  smcScore?: unknown;
  choch?: unknown;
  fvg?: unknown;
  session?: unknown;
  hour?: unknown;
  weekday?: unknown;
  atr?: unknown;
  latestClose?: unknown;
};

const EVALUATED_CANDIDATES = 5;

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function inBand(
  value: number | null,
  min: number,
  maxExclusive: number,
): boolean {
  return value !== null && value >= min && value < maxExclusive;
}

function exactInteger(value: number | null, expected: number): boolean {
  return value !== null && Number.isInteger(value) && value === expected;
}

function buildAllowDecision(
  match: Demo2RobustCandidateMatch,
): Demo2RobustCandidateDecision {
  return {
    allow: true,
    evaluatedCandidates: EVALUATED_CANDIDATES,
    match,
    message:
      "Phase16-T固定Demo2候補に一致しました。優先順位により1候補だけ採用します。",
  };
}

export function evaluateDemo2RobustCandidate(
  input: Demo2RobustFeatureInput,
): Demo2RobustCandidateDecision {
  const highScore = finiteNumber(input.highScore);
  const lowScore = finiteNumber(input.lowScore);
  const rci9 = finiteNumber(input.rci9);
  const rci26 = finiteNumber(input.rci26);
  const rci52 = finiteNumber(input.rci52);
  const hour = finiteNumber(input.hour);
  const weekday = finiteNumber(input.weekday);
  const atr = finiteNumber(input.atr);
  const latestClose = finiteNumber(input.latestClose);

  const safetyReasons: string[] = [];

  if (latestClose === null) {
    safetyReasons.push("latestCloseが取得できません。");
  }

  if (atr === null || atr <= 0) {
    safetyReasons.push("ATRが未取得または0以下です。");
  }

  if (highScore === null || lowScore === null) {
    safetyReasons.push("HIGH/LOW両方向Scoreが取得できません。");
  }

  if (safetyReasons.length > 0) {
    return {
      allow: false,
      match: null,
      evaluatedCandidates: EVALUATED_CANDIDATES,
      message: "Phase16-T固定Demo2候補判定に必要な安全確認データが不足しています。",
      reasons: safetyReasons,
    };
  }

  // 優先順位1:
  // Hour=7 × LowScore=40-49 → HIGH
  // Phase16-T REVERSE安定性最有力。
  if (exactInteger(hour, 7) && inBand(lowScore, 40, 50)) {
    return buildAllowDecision({
      enabled: true,
      candidateId: "phase16_t_hour7_lowscore40_high",
      candidateName: "Hour7・LowScore40安定型",
      direction: "HIGH",
      directionalScore: highScore ?? 0,
      historicalSample: 147,
      historicalWinRate: 59.86,
      recentWinRate: 60,
      historicalProfit: 21.96,
      reasons: [
        `Hour ${hour}`,
        `LowScore ${lowScore}`,
        "全体勝率59.86%",
        "直近100件勝率60%",
        "147決着",
        "Phase16-T REVERSE安定性最有力",
        "Backtest値を条件に使用しない",
      ],
    });
  }

  // 優先順位2:
  // RCI52<=-80 × RCI9<=-80 → HIGH
  // Phase16-T REVERSE高勝率最有力。
  if (rci52 !== null && rci52 <= -80 && rci9 !== null && rci9 <= -80) {
    return buildAllowDecision({
      enabled: true,
      candidateId: "phase16_t_rci52_oversold_rci9_oversold_high",
      candidateName: "RCI52・RCI9ダブルOversold高勝率型",
      direction: "HIGH",
      directionalScore: highScore ?? 0,
      historicalSample: 102,
      historicalWinRate: 63.73,
      recentWinRate: 64,
      historicalProfit: 22.8,
      reasons: [
        `RCI52 ${rci52}`,
        `RCI9 ${rci9}`,
        "全体勝率63.73%",
        "直近100件勝率64%",
        "102決着",
        "Phase16-T REVERSE高勝率最有力",
        "Backtest値を条件に使用しない",
      ],
    });
  }

  // 優先順位3:
  // RCI26=50-79 × RCI52=-79--50 → HIGH
  // Phase16-T最近強化型。
  if (inBand(rci26, 50, 80) && inBand(rci52, -79, -49)) {
    return buildAllowDecision({
      enabled: true,
      candidateId: "phase16_t_rci26_strongup_rci52_strongdown_high",
      candidateName: "RCI26 StrongUp・RCI52 StrongDown最近強化型",
      direction: "HIGH",
      directionalScore: highScore ?? 0,
      historicalSample: 109,
      historicalWinRate: 59.63,
      recentWinRate: 59.18,
      historicalProfit: 15.8,
      reasons: [
        `RCI26 ${rci26}`,
        `RCI52 ${rci52}`,
        "全体勝率59.63%",
        "直近勝率59.18%",
        "109決着",
        "Phase16-T最近強化型",
        "Backtest値を条件に使用しない",
      ],
    });
  }

  // 優先順位4:
  // LowScore=80-89 × Weekday=5 → HIGH
  // 高勝率だが区間不足のためDemo実績で厳格監視。
  if (inBand(lowScore, 80, 90) && exactInteger(weekday, 5)) {
    return buildAllowDecision({
      enabled: true,
      candidateId: "phase16_t_lowscore80_weekday5_high",
      candidateName: "LowScore80・Weekday5高勝率型",
      direction: "HIGH",
      directionalScore: highScore ?? 0,
      historicalSample: 141,
      historicalWinRate: 62.41,
      recentWinRate: 61.22,
      historicalProfit: 0,
      reasons: [
        `LowScore ${lowScore}`,
        `Weekday ${weekday}`,
        "全体勝率62.41%",
        "直近勝率61.22%",
        "141決着",
        "Phase16-Tでは一部区間の件数不足あり",
        "Demo候補別実績で厳格監視",
        "Backtest値を条件に使用しない",
      ],
    });
  }

  // 優先順位5:
  // RCI52=50-79 × Weekday=3 → HIGH
  // 高勝率だが区間不足のためDemo実績で厳格監視。
  if (inBand(rci52, 50, 80) && exactInteger(weekday, 3)) {
    return buildAllowDecision({
      enabled: true,
      candidateId: "phase16_t_rci52_strongup_weekday3_high",
      candidateName: "RCI52 StrongUp・Weekday3高勝率型",
      direction: "HIGH",
      directionalScore: highScore ?? 0,
      historicalSample: 115,
      historicalWinRate: 62.61,
      recentWinRate: 63.64,
      historicalProfit: 0,
      reasons: [
        `RCI52 ${rci52}`,
        `Weekday ${weekday}`,
        "全体勝率62.61%",
        "直近勝率63.64%",
        "115決着",
        "Phase16-Tでは一部区間の件数不足あり",
        "Demo候補別実績で厳格監視",
        "Backtest値を条件に使用しない",
      ],
    });
  }

  return {
    allow: false,
    match: null,
    evaluatedCandidates: EVALUATED_CANDIDATES,
    message: "現在のFeatureはPhase16-T固定Demo2候補5条件に一致しません。",
    reasons: [
      `HighScore ${highScore}`,
      `LowScore ${lowScore}`,
      `RCI9 ${rci9}`,
      `RCI26 ${rci26}`,
      `RCI52 ${rci52}`,
      `Hour ${hour}`,
      `Weekday ${weekday}`,
      `ATR ${atr}`,
    ],
  };
}
