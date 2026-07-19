import { withDerivSession } from "./derivSession";

export type ContractMonitorInput = {
  accountId: string;
  contractId: number;
  maxWaitMs?: number;
  intervalMs?: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeStatus(contract: any) {
  if (!contract) return "UNKNOWN";

  if (contract.status) return String(contract.status).toUpperCase();

  if (contract.is_sold) {
    const profit = Number(contract.profit ?? 0);
    return profit > 0 ? "WON" : "LOST";
  }

  return "OPEN";
}

function nullableNumber(value: any) {
  if (value === null || value === undefined || value === "") return null;

  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildClosedResult(input: ContractMonitorInput, message: any) {
  const contract = message?.proposal_open_contract ?? null;
  const isSold = Boolean(contract?.is_sold);
  const status = normalizeStatus(contract);

  return {
    ok: true,
    stage: "contract_closed",
    contractId: input.contractId,
    status,
    isSold,
    profit: nullableNumber(contract?.profit) ?? 0,
    buyPrice: nullableNumber(contract?.buy_price),
    payout: nullableNumber(contract?.payout),
    entrySpot: contract?.entry_spot ?? null,
    exitSpot:
      contract?.exit_spot ??
      contract?.exit_tick ??
      contract?.sell_spot ??
      null,
    startTime: contract?.date_start ?? contract?.purchase_time ?? null,
    endTime: contract?.date_expiry ?? contract?.sell_time ?? null,
    raw: message,
  };
}

function buildTimeoutResult(
  input: ContractMonitorInput,
  lastContract: any,
  lastMessage: any,
  pollCount: number,
  error: string,
) {
  return {
    ok: false,
    stage: "contract_monitor_timeout",
    contractId: input.contractId,
    error,
    status: normalizeStatus(lastContract),
    isSold: Boolean(lastContract?.is_sold),
    profit: nullableNumber(lastContract?.profit),
    buyPrice: nullableNumber(lastContract?.buy_price),
    payout: nullableNumber(lastContract?.payout),
    entrySpot: lastContract?.entry_spot ?? null,
    exitSpot:
      lastContract?.exit_spot ??
      lastContract?.exit_tick ??
      lastContract?.sell_spot ??
      null,
    startTime: lastContract?.date_start ?? lastContract?.purchase_time ?? null,
    endTime: lastContract?.date_expiry ?? lastContract?.sell_time ?? null,
    pollCount,
    raw: lastMessage,
  };
}

function isClosedContract(message: any) {
  const contract = message?.proposal_open_contract ?? null;
  const status = normalizeStatus(contract);
  return Boolean(contract?.is_sold) || status === "WON" || status === "LOST";
}

export async function monitorDerivContract(input: ContractMonitorInput) {
  const maxWaitMs = input.maxWaitMs ?? 7 * 60 * 1000;

  // 最終照会1回を追加しても最大APIコール数を増やさないよう、通常ポーリングは6秒以上にする。
  const intervalMs = Math.max(input.intervalMs ?? 6_000, 6_000);
  const startedAt = Date.now();

  return await withDerivSession(input.accountId, async (sendAndWait) => {
    let lastMessage: any = null;
    let lastContract: any = null;
    let pollCount = 0;

    while (Date.now() - startedAt < maxWaitMs) {
      const message = await sendAndWait({
        proposal_open_contract: 1,
        contract_id: input.contractId,
      });

      pollCount += 1;
      lastMessage = message;
      lastContract = message?.proposal_open_contract ?? lastContract;

      if (isClosedContract(message)) {
        return {
          ...buildClosedResult(input, message),
          pollCount,
          recoveredByFinalCheck: false,
        };
      }

      await sleep(intervalMs);
    }

    try {
      const finalMessage = await sendAndWait({
        proposal_open_contract: 1,
        contract_id: input.contractId,
      });

      pollCount += 1;
      lastMessage = finalMessage;
      lastContract = finalMessage?.proposal_open_contract ?? lastContract;

      if (isClosedContract(finalMessage)) {
        return {
          ...buildClosedResult(input, finalMessage),
          pollCount,
          recoveredByFinalCheck: true,
        };
      }
    } catch (error: any) {
      return buildTimeoutResult(
        input,
        lastContract,
        lastMessage,
        pollCount,
        "Contract監視がタイムアウトし、最終照会にも失敗しました: " +
          (error?.message ?? "unknown"),
      );
    }

    return buildTimeoutResult(
      input,
      lastContract,
      lastMessage,
      pollCount,
      "Contract監視がタイムアウトしました",
    );
  });
}