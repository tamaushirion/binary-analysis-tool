import { executeDemoTrade } from "@/lib/deriv/demoTrade";
import { monitorDerivContract } from "@/lib/deriv/contractMonitor";
import {
  saveTradeHistory,
  type TradeFeatureSnapshot,
} from "@/lib/db/tradeRepository";
import { applyWeightLearning } from "@/lib/learning/weightLearning";
import { applySimilarityLearning } from "@/lib/learning/similarityLearning";
import { calculateConfidence } from "@/lib/learning/confidenceEngine";
import {
  createTradeResultLineText,
  sendLinePushMessage,
} from "../line/lineClient";
import { applyEntryGate } from "@/lib/learning/entryGate";
import {
  getDemo100Status,
  notifyDemo100CompletedIfNeeded,
} from "@/lib/demo100Mode";

export type TradingEngineInput = {
  accountId: string;
  pair: string;
  direction: "HIGH" | "LOW";
  score: number;
  amount?: number;
  duration?: number;
  durationUnit?: "s" | "m" | "h" | "d";
  currency?: string;
  minScore?: number;
  minPayoutRate?: number;
  minConfidence?: number;
  features?: TradeFeatureSnapshot | null;
};

function durationToMs(duration: number, unit: "s" | "m" | "h" | "d") {
  if (unit === "s") return duration * 1000;
  if (unit === "m") return duration * 60 * 1000;
  if (unit === "h") return duration * 60 * 60 * 1000;
  if (unit === "d") return duration * 24 * 60 * 60 * 1000;
  return duration * 60 * 1000;
}

export async function executeDemoTradingEngine(input: TradingEngineInput) {
  const demo100Before = getDemo100Status();

  if (demo100Before.completed) {
    return {
      ok: true,
      stage: "engine_stopped_by_demo_100_completed",
      demo100: demo100Before,
      message:
        "100件デモ運用が完了済みのため、自動エントリーを停止しました。Phase14-CのAI分析に進んでください。",
    };
  }

  const duration = Number(input.duration ?? 5);
  const durationUnit = input.durationUnit ?? "m";

  const learning = applyWeightLearning({
    pair: input.pair,
    direction: input.direction,
    score: input.score,
    payoutRate: null,
  });

  const similarity = applySimilarityLearning({
    pair: input.pair,
    direction: input.direction,
    score: learning.adjustedScore,
    payoutRate: null,
    features: input.features ?? null,
  });

  const confidence = calculateConfidence({
    baseScore: input.score,
    weightAdjustedScore: learning.adjustedScore,
    similarity,
    minConfidence: input.minConfidence ?? 60,
  });

  const finalScore = similarity.adjustedScore;

  if (!confidence.trade) {
    return {
      ok: true,
      stage: "engine_skipped_by_confidence",
      demo100: demo100Before,
      learning,
      similarity,
      confidence,
      finalScore,
      message: `Confidence不足のため見送り: ${confidence.confidence}/${confidence.minConfidence}`,
    };
  }

  const gate = applyEntryGate({
    confidence: confidence.confidence,
    similarityScore: similarity.adjustedScore,
    weightScore: learning.adjustedScore,
    smcScore: Number(input.features?.smcScore ?? 0),
    atr: Number(input.features?.atr ?? 0),
    atrThreshold: Number(input.features?.atrThreshold ?? 0),
    backtestWinRate1m: Number(input.features?.backtestWinRate1m ?? 0),
  });

  if (!gate.allow) {
    return {
      ok: true,
      stage: "engine_skipped_by_entry_gate",
      demo100: demo100Before,
      learning,
      similarity,
      confidence,
      entryGate: gate,
      finalScore: similarity.adjustedScore,
      message: `Entry Gate: ${gate.reasons.join(" / ")}`,
    };
  }

  const demoTrade = await executeDemoTrade({
    accountId: input.accountId,
    pair: input.pair,
    direction: input.direction,
    score: finalScore,
    amount: input.amount ?? 1,
    duration,
    durationUnit,
    currency: input.currency ?? "USD",
    minScore: input.minScore ?? 80,
    minPayoutRate: input.minPayoutRate ?? 1.8,
  });

  if (demoTrade.stage !== "demo_trade_executed") {
    return {
      ok: true,
      stage: "engine_skipped",
      demo100: demo100Before,
      learning,
      similarity,
      confidence,
      finalScore,
      demoTrade,
      message: "Final Decision が SKIP のため監視・保存しませんでした",
    };
  }

  const contractId = demoTrade.buy?.contractId;

  if (!contractId) {
    return {
      ok: false,
      stage: "engine_error",
      demo100: demo100Before,
      learning,
      similarity,
      confidence,
      finalScore,
      demoTrade,
      error: "contractId が取得できませんでした",
    };
  }

  const maxWaitMs = durationToMs(duration, durationUnit) + 180_000;

  const monitor = await monitorDerivContract({
    accountId: input.accountId,
    contractId,
    maxWaitMs,
    intervalMs: 5_000,
  });

  let savedTrade = null;
  let demo100Notify = null;
  let demo100After = demo100Before;

  if (monitor.ok && monitor.stage === "contract_closed") {
    savedTrade = saveTradeHistory({
      contractId: monitor.contractId,
      proposalId: demoTrade.proposal?.proposalId ?? null,
      pair: input.pair,
      direction: input.direction,
      score: finalScore,
      payoutRate: demoTrade.proposal?.payoutRate ?? null,
      buyPrice: monitor.buyPrice,
      payout: monitor.payout,
      profit: monitor.profit,
      status: monitor.status,
      entrySpot: monitor.entrySpot,
      exitSpot: monitor.exitSpot,
      startTime: monitor.startTime,
      endTime: monitor.endTime,
      features: {
        ...(input.features ?? {}),
        aiScore: input.score,
        weightScore: learning.adjustedScore,
        similarityScore: similarity.adjustedScore,
        finalScore,
        entryGate: gate.allow,
        entryGateScore: gate.score,
        entryGateReasons: gate.reasons,
      },
    });

    demo100Notify = await notifyDemo100CompletedIfNeeded();
    demo100After = getDemo100Status();
  }

  await sendLinePushMessage({
    text: createTradeResultLineText({
      pair: input.pair,
      direction: input.direction,
      status: monitor.status,
      buyPrice: monitor.buyPrice,
      profit: monitor.profit,
      finalScore,
      confidence: confidence.confidence,
      entryGate: gate,
    }),
  });

  return {
    ok: monitor.ok,
    stage: monitor.ok ? "engine_completed" : "engine_monitor_failed",
    demo100: demo100After,
    learning,
    similarity,
    confidence,
    finalScore,
    demoTrade,
    monitor,
    savedTrade,
    demo100Notify,
    monitorConfig: {
      duration,
      durationUnit,
      maxWaitMs,
      intervalMs: 5_000,
    },
    message: monitor.ok
      ? "Weight → Similarity → Confidence → Demo Buy → Contract監視 → SQLite保存 → Demo100確認 完了"
      : "Demo Buy は成功しましたが Contract監視が完了しませんでした",
  };
}