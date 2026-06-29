export type DerivBuyInput = {
  accountId: string;
  proposalId: string;
  price: number;
};

const DERIV_REST_BASE_URL = "https://api.derivws.com";

function getEnv() {
  const appId = process.env.DERIV_APP_ID?.trim();
  const pat = process.env.DERIV_PAT?.trim();

  if (!appId) throw new Error("DERIV_APP_ID が未設定です");
  if (!pat) throw new Error("DERIV_PAT が未設定です");

  return { appId, pat };
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

export async function buyDerivContract(input: DerivBuyInput) {
  const wsUrl = await getOptionsWsUrl(input.accountId);

  const payload = {
    buy: input.proposalId,
    price: input.price,
    req_id: Date.now(),
  };

  return await new Promise<any>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);

    const timeout = setTimeout(() => {
      try {
        ws.close();
      } catch {}

      reject(new Error("Demo Buy がタイムアウトしました"));
    }, 10_000);

    ws.onopen = () => {
      ws.send(JSON.stringify(payload));
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Options WebSocket Buy接続エラー"));
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
              "Deriv Buy API エラー"
          )
        );
        return;
      }

      resolve({
        ok: true,
        request: payload,
        raw: message,
        buy: message?.buy ?? null,
        contractId:
          message?.buy?.contract_id ??
          message?.buy?.contractId ??
          null,
        transactionId:
          message?.buy?.transaction_id ??
          message?.buy?.transactionId ??
          null,
      });
    };
  });
}