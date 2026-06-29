import type { DerivAccount } from "./types";
import { DERIV_REST_BASE, getDerivEnv, readJsonSafe } from "./connection";

export async function fetchDerivAccounts(): Promise<DerivAccount[]> {
  const { appId, pat } = getDerivEnv();

  const res = await fetch(`${DERIV_REST_BASE}/trading/v1/options/accounts`, {
    method: "GET",
    headers: {
      "Deriv-App-ID": appId,
      Authorization: `Bearer ${pat}`,
    },
    cache: "no-store",
  });

  const json = await readJsonSafe(res);

  if (!res.ok) {
    throw new Error(
      JSON.stringify({
        stage: "accounts",
        status: res.status,
        raw: json,
      })
    );
  }

  const rawAccounts = Array.isArray(json?.data) ? json.data : [];

  return rawAccounts
    .map((account: any) => {
      const accountId = account?.account_id;
      const currency = account?.currency ?? "USD";
      const accountType = account?.account_type;

      if (!accountId) return null;

      return {
        accountId,
        currency,
        accountType: accountType === "real" ? "real" : "demo",
      } satisfies DerivAccount;
    })
    .filter(Boolean) as DerivAccount[];
}

export async function fetchPreferredDerivDemoAccount(): Promise<DerivAccount> {
  const accounts = await fetchDerivAccounts();

  const demoAccount =
    accounts.find((account) => account.accountType === "demo") ?? accounts[0];

  if (!demoAccount) {
    throw new Error("Derivデモ口座が見つかりません");
  }

  return demoAccount;
}