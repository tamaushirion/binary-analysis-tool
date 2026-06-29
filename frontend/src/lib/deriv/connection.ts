import WebSocket from "ws";

export const DERIV_REST_BASE = "https://api.derivws.com";

export function getDerivEnv() {
  const appId = process.env.DERIV_APP_ID?.trim();
  const pat = process.env.DERIV_PAT?.trim();

  if (!appId) {
    throw new Error("DERIV_APP_ID が未設定です");
  }

  if (!pat) {
    throw new Error("DERIV_PAT が未設定です");
  }

  return {
    appId,
    pat,
  };
}

export async function readJsonSafe(res: Response) {
  const text = await res.text();

  if (!text) {
    return {
      __empty: true,
      status: res.status,
      statusText: res.statusText,
    };
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      __parseError: true,
      text,
      status: res.status,
      statusText: res.statusText,
    };
  }
}

export async function fetchDerivOtpUrl(accountId: string): Promise<string> {
  const { appId, pat } = getDerivEnv();

  const res = await fetch(
    `${DERIV_REST_BASE}/trading/v1/options/accounts/${accountId}/otp`,
    {
      method: "POST",
      headers: {
        "Deriv-App-ID": appId,
        Authorization: `Bearer ${pat}`,
      },
      cache: "no-store",
    }
  );

  const json = await readJsonSafe(res);

  if (!res.ok) {
    throw new Error(
      JSON.stringify({
        stage: "otp",
        status: res.status,
        raw: json,
      })
    );
  }

  const wsUrl =
    json?.data?.url ??
    json?.url ??
    json?.websocket_url ??
    json?.data?.websocket_url;

  if (!wsUrl || typeof wsUrl !== "string") {
    throw new Error(
      JSON.stringify({
        stage: "otp_normalize",
        message: "WebSocket URLを取得できませんでした",
        raw: json,
      })
    );
  }

  return wsUrl;
}

export function requestDerivWs<TResponse = any>(
  wsUrl: string,
  payload: Record<string, any>,
  timeoutMs = 12_000
): Promise<{
  latencyMs: number;
  response: TResponse;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const startedAt = Date.now();

    const timeout = setTimeout(() => {
      try {
        ws.close();
      } catch {}

      reject(new Error("Deriv WebSocket request timeout"));
    }, timeoutMs);

    ws.on("open", () => {
      ws.send(JSON.stringify(payload));
    });

    ws.on("message", (raw) => {
      const text = raw.toString();

      let data: any;

      try {
        data = JSON.parse(text);
      } catch {
        data = {
          __parseError: true,
          text,
        };
      }

      clearTimeout(timeout);

      try {
        ws.close();
      } catch {}

      resolve({
        latencyMs: Date.now() - startedAt,
        response: data as TResponse,
      });
    });

    ws.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

export async function pingDerivWs(accountId: string) {
  const wsUrl = await fetchDerivOtpUrl(accountId);

  return requestDerivWs(wsUrl, {
    ping: 1,
    req_id: 1,
  });
}