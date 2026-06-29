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

const PAIR_TO_UNDERLYING_SYMBOL: Record<string, string> = {
  "USD/JPY": "frxUSDJPY",
  "EUR/USD": "frxEURUSD",
  "GBP/USD": "frxGBPUSD",
  "EUR/GBP": "frxEURGBP",
  "GBP/JPY": "frxGBPJPY",
  "EUR/JPY": "frxEURJPY",
  "Volatility 100 Index": "R_100",
};

function toContractType(direction: "HIGH" | "LOW") {
  return direction === "HIGH" ? "CALL" : "PUT";
}

function toUnderlyingSymbol(pair: string) {
  const symbol = PAIR_TO_UNDERLYING_SYMBOL[pair];
  if (!symbol) throw new Error(`未対応の通貨ペアです: ${pair}`);
  return symbol;
}

export async function executeDemoTrade(input: DemoTradeInput) {
  const amount = input.amount ?? 1;
  const duration = input.duration ?? 5;
  const durationUnit = input.durationUnit ?? "m";
  const currency = input.currency ?? "USD";

  return await withDerivSession(input.accountId, async (sendAndWait) => {
    const proposalRequest = {
      proposal: 1,
      amount,
      basis: "stake",
      contract_type: toContractType(input.direction),
      currency,
      duration,
      duration_unit: durationUnit,
      underlying_symbol: toUnderlyingSymbol(input.pair),
    };

    const proposalMessage = await sendAndWait(proposalRequest);

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
        finalDecision,
        proposal: {
          raw: proposalMessage,
          proposalId,
          askPrice,
          payout,
          payoutRate,
          spot: proposal?.spot ?? null,
        },
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
          buyMessage?.buy?.contract_id ??
          buyMessage?.buy?.contractId ??
          null,
        transactionId:
          buyMessage?.buy?.transaction_id ??
          buyMessage?.buy?.transactionId ??
          null,
      },
      message: "Demo Buy成功",
    };
  });
}