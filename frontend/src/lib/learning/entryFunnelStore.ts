import fs from "fs";
import path from "path";

export type EntryFunnelStage =
  | "engine_started"
  | "engine_stopped_by_demo_100_completed"
  | "engine_skipped_by_confidence"
  | "engine_skipped_by_entry_gate"
  | "engine_skipped_by_empirical_entry_gate"
  | "engine_skipped_by_feature_win_rate_gate"
  | "engine_skipped_by_pattern_weight"
  | "engine_skipped_by_final_decision"
  | "engine_error"
  | "engine_completed"
  | "engine_monitor_failed";

export type EntryFunnelEvent = {
  stage: EntryFunnelStage;
  createdAtIso?: string;
  aiVersion?: string | null;
  pair?: string | null;
  direction?: string | null;
  inputScore?: number | null;
  finalScore?: number | null;
  confidence?: number | null;
  featureGateAllow?: boolean | null;
  patternWeightAllow?: boolean | null;
  hasFeatureHardGate?: boolean;
  hasPatternHardGate?: boolean;
  reason?: string | null;
  details?: Record<string, any> | null;
};

type FunnelStore = {
  schemaVersion: 1;
  startedAtIso: string;
  updatedAtIso: string;
  totalEvents: number;
  counts: Record<string, number>;
  rawCandidates: number;
  engineStarts: number;
  completedTrades: number;
  monitorFailed: number;
  skipped: {
    demo100Completed: number;
    confidence: number;
    entryGate: number;
    empiricalEntryGate: number;
    featureWinRateGate: number;
    featureHardGate: number;
    patternWeight: number;
    patternHardGate: number;
    finalDecision: number;
    engineError: number;
  };
  recentEvents: EntryFunnelEvent[];
};

const MAX_RECENT_EVENTS = 80;

function getStorePath() {
  return path.join(process.cwd(), "data", "entry_funnel_phase15n.json");
}

function ensureDataDir() {
  const dir = path.dirname(getStorePath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function emptyStore(): FunnelStore {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    startedAtIso: now,
    updatedAtIso: now,
    totalEvents: 0,
    counts: {},
    rawCandidates: 0,
    engineStarts: 0,
    completedTrades: 0,
    monitorFailed: 0,
    skipped: {
      demo100Completed: 0,
      confidence: 0,
      entryGate: 0,
      empiricalEntryGate: 0,
      featureWinRateGate: 0,
      featureHardGate: 0,
      patternWeight: 0,
      patternHardGate: 0,
      finalDecision: 0,
      engineError: 0,
    },
    recentEvents: [],
  };
}

function readStore(): FunnelStore {
  ensureDataDir();
  const filePath = getStorePath();
  if (!fs.existsSync(filePath)) return emptyStore();

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      ...emptyStore(),
      ...parsed,
      skipped: {
        ...emptyStore().skipped,
        ...(parsed?.skipped ?? {}),
      },
      recentEvents: Array.isArray(parsed?.recentEvents) ? parsed.recentEvents : [],
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: FunnelStore) {
  ensureDataDir();
  fs.writeFileSync(getStorePath(), JSON.stringify(store, null, 2));
}

function bool(value: any): boolean {
  return value === true;
}

export function resetEntryFunnelStore() {
  const store = emptyStore();
  writeStore(store);
  return store;
}

export function recordEntryFunnelEvent(input: EntryFunnelEvent) {
  try {
    const event: EntryFunnelEvent = {
      ...input,
      createdAtIso: input.createdAtIso ?? new Date().toISOString(),
    };

    const store = readStore();
    store.updatedAtIso = event.createdAtIso ?? new Date().toISOString();
    store.totalEvents += 1;
    store.counts[event.stage] = (store.counts[event.stage] ?? 0) + 1;

    if (event.stage === "engine_started") {
      store.rawCandidates += 1;
      store.engineStarts += 1;
    }

    if (event.stage === "engine_completed") store.completedTrades += 1;
    if (event.stage === "engine_monitor_failed") store.monitorFailed += 1;

    if (event.stage === "engine_stopped_by_demo_100_completed") store.skipped.demo100Completed += 1;
    if (event.stage === "engine_skipped_by_confidence") store.skipped.confidence += 1;
    if (event.stage === "engine_skipped_by_entry_gate") store.skipped.entryGate += 1;
    if (event.stage === "engine_skipped_by_empirical_entry_gate") store.skipped.empiricalEntryGate += 1;

    if (event.stage === "engine_skipped_by_feature_win_rate_gate") {
      store.skipped.featureWinRateGate += 1;
      if (bool(event.hasFeatureHardGate)) store.skipped.featureHardGate += 1;
    }

    if (event.stage === "engine_skipped_by_pattern_weight") {
      store.skipped.patternWeight += 1;
      if (bool(event.hasPatternHardGate)) store.skipped.patternHardGate += 1;
    }

    if (event.stage === "engine_skipped_by_final_decision") store.skipped.finalDecision += 1;
    if (event.stage === "engine_error") store.skipped.engineError += 1;

    store.recentEvents = [event, ...store.recentEvents].slice(0, MAX_RECENT_EVENTS);
    writeStore(store);

    return { ok: true, storePath: getStorePath() };
  } catch (error: any) {
    console.error("Entry Funnel記録失敗", error?.message ?? error);
    return { ok: false, error: error?.message ?? "Entry Funnel記録失敗" };
  }
}

export function getEntryFunnelStatus() {
  const store = readStore();
  const totalDrops =
    store.skipped.demo100Completed +
    store.skipped.confidence +
    store.skipped.entryGate +
    store.skipped.empiricalEntryGate +
    store.skipped.featureWinRateGate +
    store.skipped.patternWeight +
    store.skipped.finalDecision +
    store.skipped.engineError +
    store.monitorFailed;

  const denominator = store.engineStarts > 0 ? store.engineStarts : store.rawCandidates;
  const entryRate = denominator > 0 ? Number(((store.completedTrades / denominator) * 100).toFixed(2)) : 0;
  const hardGateCount = store.skipped.featureHardGate + store.skipped.patternHardGate;
  const hardGateRate = denominator > 0 ? Number(((hardGateCount / denominator) * 100).toFixed(2)) : 0;

  return {
    ok: true,
    stage: "entry_funnel_status",
    storePath: getStorePath(),
    startedAtIso: store.startedAtIso,
    updatedAtIso: store.updatedAtIso,
    rawCandidates: store.rawCandidates,
    engineStarts: store.engineStarts,
    completedTrades: store.completedTrades,
    monitorFailed: store.monitorFailed,
    totalDrops,
    entryRate,
    hardGateCount,
    hardGateRate,
    skipped: store.skipped,
    counts: store.counts,
    note:
      "このFunnelはTrading Engine到達後の候補を記録します。auto_runner_feature_skip（score不足など）はserverAutoRunner側に記録を追加するまで集計対象外です。",
    recentEvents: store.recentEvents,
  };
}
