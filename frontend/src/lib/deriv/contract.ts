import type { ContractStatus } from "./types";

import { fetchPreferredDerivDemoAccount } from "./accounts";
import { fetchDerivOtpUrl, requestDerivWs } from "./connection";

import { saveExecutionLog } from "./executionAnalytics";

export async function fetchContractStatus(input: {
  contractId: string;
  pair: string;
  direction: "HIGH" | "LOW";
  score: number;
  stake: number;
}): Promise<ContractStatus> {
  const account = await fetchPreferredDerivDemoAccount();
  const wsUrl = await fetchDerivOtpUrl(account.accountId);

  const result = await requestDerivWs<any>(wsUrl, {
    proposal_open_contract: 1,
    contract_id: input.contractId,
    req_id: 1,
  });

  const contract =
    result.response?.proposal_open_contract ??
    result.response?.contract ??
    result.response;

  const isSold = Boolean(contract?.is_sold);
  const isExpired = Boolean(contract?.is_expired);

  const profit = Number(contract?.profit ?? 0);
  const sellPrice = Number(contract?.sell_price ?? 0);

  if (isSold || isExpired) {
    saveExecutionLog({
      type: "CONTRACT_SETTLED",
      pair: input.pair,
      symbol: input.pair.replace("/", ""),
      direction: input.direction,
      contractType: input.direction === "HIGH" ? "CALL" : "PUT",
      score: input.score,
      stake: input.stake,
      payoutRate: null,
      latencyMs: result.latencyMs,
      profit,
      message: profit > 0 ? "WIN：契約勝利" : "LOSE：契約敗北",
    });
  }

  return {
    contractId: input.contractId,
    isSold,
    isExpired,
    profit,
    sellPrice,
    raw: result.response,
  };
}