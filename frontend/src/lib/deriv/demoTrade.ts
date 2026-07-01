import { judgeFinalDecision } from "./finalDecision";
import { withDerivSession } from "./derivSession";

export type DemoTradeInput = {
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
};

type DerivAssetConfig = {
  displayName: string;
  underlyingSymbol: string;
  category: "synthetic" | "forex";
  demoPriority: number;
  supportedDurations: Array<{
    duration: number;
    durationUnit: "s" | "m" | "h" | "d";
  }>;
};

const DERIV_ASSETS: Record<string, DerivAssetConfig> = {
  "Volatility 100 Index": {
    displayName: "Volatility 100 Index",
    underlyingSymbol: "R_100",
    category: "synthetic",
    demoPriority: 1,
    supportedDurations: [{ duration: 1, durationUnit: "m" }],
  },
  "Volatility 75 Index": {
    displayName: "Volatility 75 Index",
    underlyingSymbol: "R_75",
    category: "synthetic",
    demoPriority: 2,
    supportedDurations: [{ duration: 1, durationUnit: "m" }],
  },
  "Volatility 50 Index": {
    displayName: "Volatility 50 Index",
    underlyingSymbol: "R_50",
    category: "synthetic",
    demoPriority: 3,
    supportedDurations: [{ duration: 1, durationUnit: "m" }],
  },
  "Volatility 25 Index": {
    displayName: "Volatility 25 Index",
    underlyingSymbol: "R_25",
    category: "synthetic",
    demoPriority: 4,
    supportedDurations: [{ duration: 1, durationUnit: "m" }],
  },
  "Volatility 10 Index": {
    displayName: "Volatility 10 Index",
    underlyingSymbol: "R_10",
    category: "synthetic",
    demoPriority: 5,
    supportedDurations: [{ duration: 1, durationUnit: "m" }],
  },

  "USD/JPY": {
    displayName: "USD/JPY",
    underlyingSymbol: "frxUSDJPY",
    category: "forex",
    demoPriority: 100,
    supportedDurations: [],
  },
  "EUR/USD": {
    displayName: "EUR/USD",
    underlyingSymbol: "frxEURUSD",
    category: "forex",
    demoPriority: 101,
    supportedDurations: [],
  },
  "GBP/USD": {
    displayName: "GBP/USD",
    underlyingSymbol: "frxGBPUSD",
    category: "forex",
    demoPriority: 102,
    supportedDurations: [],
  },
  "EUR/GBP": {
    displayName: "EUR/GBP",
    underlyingSymbol: "frxEURGBP",
    category: "forex",
    demoPriority: 103,
    supportedDurations: [],
  },
  "GBP/JPY": {
    displayName: "GBP/JPY",
    underlyingSymbol: "frxGBPJPY",
    category: "forex",
    demoPriority: 104,
    supportedDurations: [],
  },
  "EUR/JPY": {
    displayName: "EUR/JPY",
    underlyingSymbol: "frxEURJPY",
    category: "forex",
    demoPriority: 105,
    supportedDurations: [],
  },
};

function toContractType(direction: "HIGH" | "LOW") {
  return direction === "HIGH" ? "CALL" : "PUT";
}

function getDerivAsset(pair: string) {
  const asset = DERIV_ASSETS[pair];
  if (!asset) throw new Error(`未対応の銘柄です: ${pair}`);
  return asset;
}

function isDurationSupported(
  asset: DerivAssetConfig,
  duration: number,
  durationUnit: "s" | "m" | "h" | "d"
) {
  return asset.supportedDurations.some(
    (item) => item.duration === duration && item.durationUnit === durationUnit
  );
}

function isDurationNotOfferedError(message: string) {
  return message.toLowerCase().includes("trading is not offered for this duration");
}

export async function executeDemoTrade(input: DemoTradeInput) {
  const amount = input.amount ?? 1;
  const duration = input.duration ?? 1;
  const durationUnit = input.durationUnit ?? "m";
  const currency = input.currency ?? "USD";

  const asset = getDerivAsset(input.pair);
  const underlyingSymbol = asset.underlyingSymbol;
  const contractType = toContractType(input.direction);

  const baseDebug = {
    inputPair: input.pair,
    derivDisplayName: asset.displayName,
    assetCategory: asset.category,
    demoPriority: asset.demoPriority,
    direction: input.direction,
    amount,
    duration,
    durationUnit,
    currency,
    underlyingSymbol,
    contractType,
    supportedDurations: asset.supportedDurations,
  };

  if (!isDurationSupported(asset, duration, durationUnit)) {
    return {
      ok: true,
      stage: "demo_trade_duration_unsupported",
      accountId: input.accountId,
      pair: input.pair,
      direction: input.direction,
      score: input.score,
      debug: baseDebug,
      finalDecision: null,
      proposal: null,
      buy: null,
      shouldSaveTrade: false,
      message:
        `${input.pair} は Deriv で ${duration}${durationUnit} 取引非対応のためSKIPしました。` +
        " 非対応durationは失敗トレードとして保存しません。",
    };
  }

  return await withDerivSession(input.accountId, async (sendAndWait) => {
    const proposalRequest = {
      proposal: 1,
      amount,
      basis: "stake",
      contract_type: contractType,
      currency,
      duration,
      duration_unit: durationUnit,
      underlying_symbol: underlyingSymbol,
    };

    const debug = {
      ...baseDebug,
      proposalRequest,
    };

    let proposalMessage;

    try {
      proposalMessage = await sendAndWait(proposalRequest);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Proposal取得に失敗しました";

      if (isDurationNotOfferedError(message)) {
        return {
          ok: true,
          stage: "demo_trade_duration_unsupported",
          accountId: input.accountId,
          pair: input.pair,
          direction: input.direction,
          score: input.score,
          debug,
          finalDecision: null,
          proposal: null,
          buy: null,
          shouldSaveTrade: false,
          message:
            `${input.pair} は Deriv 側で ${duration}${durationUnit} 取引非対応のためSKIPしました。` +
            " 非対応durationは失敗トレードとして保存しません。",
        };
      }

      throw new Error(
        JSON.stringify({
          message,
          debug,
        })
      );
    }

    const proposal = proposalMessage?.proposal ?? null;
    const proposalId = proposal?.id ?? null;
    const askPrice = proposal?.ask_price ?? null;
    const payout = proposal?.payout ?? null;

    const payoutRate =
      typeof payout === "number" && typeof askPrice === "number" && askPrice > 0
        ? payout / askPrice
        : null;

    const finalDecision = judgeFinalDecision({
      pair: input.pair,
      direction: input.direction,
      score: input.score,
      payoutRate,
      minScore: input.minScore ?? 80,
      minPayoutRate: input.minPayoutRate ?? 1.8,
    });

    if (finalDecision.action !== "BUY") {
      return {
        ok: true,
        stage: "demo_trade_skipped",
        accountId: input.accountId,
        pair: input.pair,
        direction: input.direction,
        score: input.score,
        debug,
        finalDecision,
        proposal: {
          raw: proposalMessage,
          proposalId,
          askPrice,
          payout,
          payoutRate,
          spot: proposal?.spot ?? null,
        },
        buy: null,
        shouldSaveTrade: false,
        message: "Final Decision が SKIP のためDemo Buyしませんでした",
      };
    }

    if (!proposalId || typeof askPrice !== "number") {
      throw new Error("proposalId または askPrice が取得できません");
    }

    const buyMessage = await sendAndWait({
      buy: proposalId,
      price: askPrice,
    });

    return {
      ok: true,
      stage: "demo_trade_executed",
      accountId: input.accountId,
      pair: input.pair,
      direction: input.direction,
      score: input.score,
      debug,
      finalDecision,
      proposal: {
        raw: proposalMessage,
        proposalId,
        askPrice,
        payout,
        payoutRate,
        spot: proposal?.spot ?? null,
      },
      buy: {
        raw: buyMessage,
        buy: buyMessage?.buy ?? null,
        contractId:
          buyMessage?.buy?.contract_id ?? buyMessage?.buy?.contractId ?? null,
        transactionId:
          buyMessage?.buy?.transaction_id ??
          buyMessage?.buy?.transactionId ??
          null,
      },
      shouldSaveTrade: true,
      message: "Demo Buy成功",
    };
  });
}