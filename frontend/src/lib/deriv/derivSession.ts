export type DerivSessionMessage = Record<string, any>;

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

export async function withDerivSession<T>(
  accountId: string,
  handler: (sendAndWait: (payload: DerivSessionMessage) => Promise<any>) => Promise<T>
): Promise<T> {
  const wsUrl = await getOptionsWsUrl(accountId);

  return await new Promise<T>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);

    let opened = false;
    const pending = new Map<
      number,
      {
        resolve: (value: any) => void;
        reject: (reason?: any) => void;
        timeout: NodeJS.Timeout;
      }
    >();

    const cleanup = () => {
      for (const item of pending.values()) {
        clearTimeout(item.timeout);
      }
      pending.clear();

      try {
        ws.close();
      } catch {}
    };

    const sendAndWait = (payload: DerivSessionMessage) => {
      if (!opened) {
        return Promise.reject(new Error("WebSocketがまだ接続されていません"));
      }

      const reqId = payload.req_id ?? Date.now() + Math.floor(Math.random() * 1000);
      const finalPayload = {
        ...payload,
        req_id: reqId,
      };

      return new Promise<any>((res, rej) => {
        const timeout = setTimeout(() => {
          pending.delete(reqId);
          rej(new Error(`Deriv応答タイムアウト: req_id=${reqId}`));
        }, 10_000);

        pending.set(reqId, {
          resolve: res,
          reject: rej,
          timeout,
        });

        ws.send(JSON.stringify(finalPayload));
      });
    };

    ws.onopen = async () => {
      opened = true;

      try {
        const result = await handler(sendAndWait);
        cleanup();
        resolve(result);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    ws.onerror = () => {
      cleanup();
      reject(new Error("Options WebSocket接続エラー"));
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data.toString());
      const reqId = message?.req_id;

      if (message?.error) {
        const item = pending.get(reqId);
        if (item) {
          clearTimeout(item.timeout);
          pending.delete(reqId);
          item.reject(
            new Error(
              message.error.message ??
                message.error.code ??
                "Deriv WebSocket API エラー"
            )
          );
        }
        return;
      }

      const item = pending.get(reqId);
      if (!item) return;

      clearTimeout(item.timeout);
      pending.delete(reqId);
      item.resolve(message);
    };
  });
}