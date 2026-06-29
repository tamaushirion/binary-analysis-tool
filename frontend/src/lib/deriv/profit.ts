import type { ContractStatus } from "./types";

export type TradeResult = "WIN" | "LOSE" | "DRAW" | "OPEN";

export type ProfitSummary = {
  contractId: string;
  result: TradeResult;
  profit: number;
  sellPrice: number;
  isFinished: boolean;
  message: string;
  raw: unknown;
};

export function summarizeProfit(contract: ContractStatus): ProfitSummary {
  const isFinished = contract.isSold || contract.isExpired;

  if (!isFinished) {
    return {
      contractId: contract.contractId,
      result: "OPEN",
      profit: contract.profit,
      sellPrice: contract.sellPrice,
      isFinished: false,
      message: "契約はまだ判定中です",
      raw: contract.raw,
    };
  }

  if (contract.profit > 0) {
    return {
      contractId: contract.contractId,
      result: "WIN",
      profit: contract.profit,
      sellPrice: contract.sellPrice,
      isFinished: true,
      message: "WIN：利益が出ました",
      raw: contract.raw,
    };
  }

  if (contract.profit < 0) {
    return {
      contractId: contract.contractId,
      result: "LOSE",
      profit: contract.profit,
      sellPrice: contract.sellPrice,
      isFinished: true,
      message: "LOSE：損失になりました",
      raw: contract.raw,
    };
  }

  return {
    contractId: contract.contractId,
    result: "DRAW",
    profit: contract.profit,
    sellPrice: contract.sellPrice,
    isFinished: true,
    message: "DRAW：損益なし",
    raw: contract.raw,
  };
}