import {
  createPayoutCacheKey,
  getPayoutCache,
  setPayoutCache,
} from "./payoutCache";

export type DerivProposalDirection = "HIGH" | "LOW";

export type DerivProposalInput = {
  accountId: string;
  pair: string;
  direction: DerivProposalDirection;
  amount?: number;
  duration?: number;
  durationUnit?: "s" | "m" | "h" | "d";
  currency?: string;
  useCache?: boolean;
};

const DERIV_REST_BASE_URL = "https://api.derivws.com";

const PAIR_TO_UNDERLYING_SYMBOL: Record<string, string> = {
  "USD/JPY": "frxUSDJPY",
  "EUR/USD": "frxEURUSD",
  "GBP/USD": "frxGBPUSD",
  "EUR/GBP": "frxEURGBP",
  "GBP/JPY": "frxGBPJPY",
  "EUR/JPY": "frxEURJPY",

  "Volatility 100 Index": "R_100",
};

function getEnv() {
  const appId = process.env.DERIV_APP_ID?.trim();
  const pat = process.env.DERIV_PAT?.trim();

  if (!appId) throw new Error("DERIV_APP_ID が未設定です");
  if (!pat) throw new Error("DERIV_PAT が未設定です");

  return { appId, pat };
}

function toContractType(direction: DerivProposalDirection) {
  return direction === "HIGH" ? "CALL" : "PUT";
}

function toUnderlyingSymbol(pair: string) {
  const symbol = PAIR_TO_UNDERLYING_SYMBOL[pair];
  if (!symbol) {
    throw new Error(`未対応の通貨ペアです: ${pair}`);
  }
  return symbol;
}

async function getOptionsWsUrl(accountId: string) {
  const { appId, pat } = getEnv();

  const res = await fetch(
    `${DERIV_REST_BASE_URL}/trading/v1/options/accounts/${accountId}/otp`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pat}`,
        "Deriv-App-ID": appId,
      },
      cache: "no-store",
    }
  );

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      data?.errors?.[0]?.message ??
        data?.error?.message ??
        "Deriv OTP取得に失敗しました"
    );
  }

  const wsUrl = data?.data?.url;
  if (!wsUrl) throw new Error("OTPレスポンスにWebSocket URLがありません");

  return wsUrl as string;
}

export async function requestDerivProposal(input: DerivProposalInput) {
  const amount = input.amount ?? 1;
  const duration = input.duration ?? 5;
  const durationUnit = input.durationUnit ?? "m";
  const currency = input.currency ?? "USD";

  const cacheKey = createPayoutCacheKey({
    accountId: input.accountId,
    pair: input.pair,
    direction: input.direction,
    amount,
    duration,
    durationUnit,
    currency,
  });

  if (input.useCache !== false) {
    const cached = getPayoutCache(cacheKey);
    if (cached) {
      return {
        ok: true,
        cacheHit: true,
        cache: cached,
        proposalId: cached.proposalId,
        askPrice: cached.askPrice,
        payout: cached.payout,
        payoutRate: cached.payoutRate,
        spot: cached.spot,
      };
    }
  }

  const wsUrl = await getOptionsWsUrl(input.accountId);

  const payload = {
    proposal: 1,
    amount,
    basis: "stake",
    contract_type: toContractType(input.direction),
    currency,
    duration,
    duration_unit: durationUnit,
    underlying_symbol: toUnderlyingSymbol(input.pair),
    req_id: Date.now(),
  };

  return await new Promise<any>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);

    const timeout = setTimeout(() => {
      try {
        ws.close();
      } catch {}

      reject(new Error("Proposal取得がタイムアウトしました"));
    }, 10_000);

    ws.onopen = () => {
      ws.send(JSON.stringify(payload));
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Options WebSocket接続エラー"));
    };

    ws.onmessage = (event) => {
      clearTimeout(timeout);

      const message = JSON.parse(event.data.toString());

      try {
        ws.close();
      } catch {}

      if (message?.error) {
        reject(
          new Error(
            message.error.message ??
              message.error.code ??
              "Deriv Proposal API エラー"
          )
        );
        return;
      }

      const proposal = message?.proposal ?? null;
      const proposalId = proposal?.id ?? null;
      const askPrice = proposal?.ask_price ?? null;
      const payout = proposal?.payout ?? null;
      const payoutRate =
        typeof payout === "number" && typeof askPrice === "number" && askPrice > 0
          ? payout / askPrice
          : null;
      const spot = proposal?.spot ?? null;

      const cache = setPayoutCache({
        key: cacheKey,
        accountId: input.accountId,
        pair: input.pair,
        direction: input.direction,
        amount,
        duration,
        durationUnit,
        currency,
        proposalId,
        askPrice,
        payout,
        payoutRate,
        spot,
      });

      resolve({
        ok: true,
        cacheHit: false,
        request: payload,
        raw: message,
        proposal,
        proposalId,
        askPrice,
        payout,
        payoutRate,
        spot,
        cache,
      });
    };
  });
}