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
    return profit > 0 ? "WIN" : "LOSE";
  }

  return "OPEN";
}

export async function monitorDerivContract(input: ContractMonitorInput) {
  const maxWaitMs = input.maxWaitMs ?? 7 * 60 * 1000;
  const intervalMs = input.intervalMs ?? 5_000;
  const startedAt = Date.now();

  return await withDerivSession(input.accountId, async (sendAndWait) => {
    while (Date.now() - startedAt < maxWaitMs) {
      const message = await sendAndWait({
        proposal_open_contract: 1,
        contract_id: input.contractId,
      });

      const contract = message?.proposal_open_contract ?? null;
      const isSold = Boolean(contract?.is_sold);
      const status = normalizeStatus(contract);

      if (isSold || status === "WON" || status === "LOST") {
        return {
          ok: true,
          stage: "contract_closed",
          contractId: input.contractId,
          status,
          isSold,
          profit: Number(contract?.profit ?? 0),
          buyPrice: Number(contract?.buy_price ?? 0),
          payout: Number(contract?.payout ?? 0),
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

      await sleep(intervalMs);
    }

    return {
      ok: false,
      stage: "contract_monitor_timeout",
      contractId: input.contractId,
      error: "Contract監視がタイムアウトしました",
    };
  });
}