import {
  evaluateDemo2RobustCandidate,
  type Demo2RobustCandidateId,
  type Demo2RobustCandidateDecision,
  type Demo2RobustFeatureInput,
} from "./demo2RobustCandidateGate";

export type Demo2RobustCandidatePreviewCase = {
  id: string;
  name: string;
  expectedCandidateId: Demo2RobustCandidateId | null;
  expectedExecutionMode?: "FORWARD" | "REVERSE";
  input: Demo2RobustFeatureInput;
  decision: Demo2RobustCandidateDecision;
  passed: boolean;
};

export type Demo2RobustCandidatePreviewResult = {
  ok: true;
  stage: "demo_part2_robust_candidate_preview";
  generatedAt: string;
  dryRun: true;
  executedDemoBuy: false;
  evaluatedCandidates: number;
  passedCases: number;
  failedCases: number;
  cases: Demo2RobustCandidatePreviewCase[];
  customDecision?: Demo2RobustCandidateDecision;
};

const BASE_INPUT: Demo2RobustFeatureInput = {
  pair: "Volatility 100 Index",
  latestClose: 450,
  atr: 0.8,
  highScore: 60,
  lowScore: 60,
  selectedScore: 60,
  selectedDirection: "LOW",
  rci9: 0,
  rci26: 0,
  rci52: 0,
  smcScore: 0,
  choch: false,
  fvg: false,
  session: "LONDON",
  hour: 10,
  weekday: 1,
};

type PreviewCaseDefinition = {
  id: string;
  name: string;
  expectedCandidateId: Demo2RobustCandidateId | null;
  expectedExecutionMode?: "FORWARD" | "REVERSE";
  input: Demo2RobustFeatureInput;
};

const TEST_CASES: PreviewCaseDefinition[] = [
  {
    id: "case_hour7_lowscore40_high",
    name: "Hour7・LowScore40安定型",
    expectedCandidateId: "phase16_t_hour7_lowscore40_high",
    expectedExecutionMode: "REVERSE",
    input: {
      ...BASE_INPUT,
      hour: 7,
      lowScore: 45,
      highScore: 55,
    },
  },
  {
    id: "case_rci52_rci9_double_oversold_high",
    name: "RCI52・RCI9ダブルOversold高勝率型",
    expectedCandidateId: "phase16_t_rci52_oversold_rci9_oversold_high",
    input: {
      ...BASE_INPUT,
      rci52: -85,
      rci9: -90,
      highScore: 65,
      lowScore: 55,
    },
  },
  {
    id: "case_rci26_up_rci52_down_high",
    name: "RCI26 StrongUp・RCI52 StrongDown最近強化型",
    expectedCandidateId: "phase16_t_rci26_strongup_rci52_strongdown_high",
    input: {
      ...BASE_INPUT,
      rci26: 65,
      rci52: -65,
      highScore: 62,
      lowScore: 58,
    },
  },
  {
    id: "case_lowscore80_weekday5_high",
    name: "LowScore80・Weekday5高勝率型",
    expectedCandidateId: "phase16_t_lowscore80_weekday5_high",
    input: {
      ...BASE_INPUT,
      lowScore: 85,
      highScore: 55,
      weekday: 5,
    },
  },
  {
    id: "case_rci52_up_weekday3_high",
    name: "RCI52 StrongUp・Weekday3高勝率型",
    expectedCandidateId: "phase16_t_rci52_strongup_weekday3_high",
    input: {
      ...BASE_INPUT,
      rci52: 65,
      weekday: 3,
      highScore: 64,
      lowScore: 56,
    },
  },
  {
    id: "case_high_win_rate_keeps_forward",
    name: "元方向HIGHの高勝率候補はそのままエントリー",
    expectedCandidateId: "phase16_t_hour7_lowscore40_high",
    expectedExecutionMode: "FORWARD",
    input: {
      ...BASE_INPUT,
      selectedDirection: "HIGH",
      hour: 7,
      lowScore: 45,
      highScore: 55,
    },
  },
  {
    id: "case_no_match",
    name: "固定5候補すべて不一致",
    expectedCandidateId: null,
    input: {
      ...BASE_INPUT,
      hour: 10,
      weekday: 1,
      highScore: 60,
      lowScore: 60,
      rci9: 0,
      rci26: 0,
      rci52: 0,
    },
  },
  {
    id: "case_priority_multiple_match",
    name: "複数一致時は優先順位1を採用",
    expectedCandidateId: "phase16_t_hour7_lowscore40_high",
    input: {
      ...BASE_INPUT,
      hour: 7,
      lowScore: 45,
      highScore: 70,
      rci9: -90,
      rci52: -85,
    },
  },
];

function evaluateCase(
  testCase: PreviewCaseDefinition,
): Demo2RobustCandidatePreviewCase {
  const decision = evaluateDemo2RobustCandidate(testCase.input);
  const actualCandidateId = decision.allow
    ? decision.match.candidateId
    : null;
  const actualExecutionMode = decision.allow
    ? decision.match.executionMode
    : undefined;

  return {
    ...testCase,
    decision,
    passed:
      actualCandidateId === testCase.expectedCandidateId &&
      (testCase.expectedExecutionMode === undefined ||
        actualExecutionMode === testCase.expectedExecutionMode),
  };
}

export function runDemo2RobustCandidatePreview(
  customInput?: Demo2RobustFeatureInput,
): Demo2RobustCandidatePreviewResult {
  const cases = TEST_CASES.map(evaluateCase);
  const passedCases = cases.filter((item) => item.passed).length;

  return {
    ok: true,
    stage: "demo_part2_robust_candidate_preview",
    generatedAt: new Date().toISOString(),
    dryRun: true,
    executedDemoBuy: false,
    evaluatedCandidates: 5,
    passedCases,
    failedCases: cases.length - passedCases,
    cases,
    ...(customInput
      ? { customDecision: evaluateDemo2RobustCandidate(customInput) }
      : {}),
  };
}
