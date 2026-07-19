export const CURRENT_AI_VERSION = "phase15-n-danger-hard-gate" as const;

export const CURRENT_AI_PHASE = "Phase15-N" as const;

export const AI_VERSION_DESCRIPTION =
  "Phase15-N: Danger Hard Gate + Feature Gate Hard Skip + Pattern Weight Hard Skip";

export function getCurrentAiVersion() {
  return {
    version: CURRENT_AI_VERSION,
    phase: CURRENT_AI_PHASE,
    description: AI_VERSION_DESCRIPTION,
    createdAt: new Date().toISOString(),
    safetyPolicy: {
      demoRequired: true,
      liveTradingAllowed: false,
      overfitGuard: true,
      apiCallIncrease: false,
    },
  };
}

export function normalizeAiVersion(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  return CURRENT_AI_VERSION;
}