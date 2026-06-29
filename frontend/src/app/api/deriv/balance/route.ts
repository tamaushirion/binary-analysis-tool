import { NextResponse } from "next/server";
import WebSocket from "ws";

export const runtime = "nodejs";

const DERIV_REST_BASE = "https://api.derivws.com";

function getDerivEnv() {
  const appId = process.env.DERIV_APP_ID?.trim();
  const pat = process.env.DERIV_PAT?.trim();

  if (!appId) throw new Error("DERIV_APP_ID が未設定です");
  if (!pat) throw new Error("DERIV_PAT が未設定です");

  return { appId, pat };
}

async function safeJson(res: Response) {
  const text = await res.text();

  if (!text) {
    return {
      __empty: true,
      __status: res.status,
      __statusText: res.statusText,
    };
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      __parseError: true,
      __text: text,
      __status: res.status,
      __statusText: res.statusText,
    };
  }
}

async function fetchDemoAccount() {
  const { appId, pat } = getDerivEnv();

  const res = await fetch(`${DERIV_REST_BASE}/trading/v1/options/accounts`, {
    method: "GET",
    headers: {
      "Deriv-App-ID": appId,
      Authorization: `Bearer ${pat}`,
    },
    cache: "no-store",
  });

  const json = await safeJson(res);

  if (!res.ok) {
    throw new Error(
      JSON.stringify({
        stage: "accounts",
        status: res.status,
        body: json,
      })
    );
  }

  const accounts = Array.isArray(json?.data) ? json.data : [];
  const demoAccount =
    accounts.find((a: any) => a.account_type === "demo") ?? accounts[0];

  if (!demoAccount?.account_id) {
    throw new Error(
      JSON.stringify({
        stage: "accounts_normalize",
        message: "Derivデモ口座が見つかりません",
        body: json,
      })
    );
  }

  return demoAccount;
}

async function fetchOtpWsUrl(accountId: string) {
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

  const json = await safeJson(res);

  if (!res.ok) {
    throw new Error(
      JSON.stringify({
        stage: "otp",
        status: res.status,
        body: json,
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
        message: "Deriv WebSocket URLを取得できませんでした",
        body: json,
      })
    );
  }

  return wsUrl;
}

function wsProbe(wsUrl: string) {
  return new Promise<any>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);

    const results: any[] = [];
    let step = 0;
    let settled = false;

    const tests = [
      { name: "ping", payload: { ping: 1, req_id: 1 } },
      { name: "website_status", payload: { website_status: 1, req_id: 2 } },
      {
        name: "active_symbols",
        payload: {
          active_symbols: "brief",
          product_type: "basic",
          req_id: 3,
        },
      },
      {
        name: "contracts_for",
        payload: {
          contracts_for: "frxUSDJPY",
          currency: "USD",
          product_type: "basic",
          req_id: 4,
        },
      },
    ];

    const done = (payload: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        ws.close();
      } catch {}
      resolve(payload);
    };

    const timeout = setTimeout(() => {
      done({
        ok: true,
        mode: "probe_timeout",
        message: "Probe timeout。取得できた結果だけ返します。",
        results,
      });
    }, 20000);

    function sendNext() {
      if (step >= tests.length) {
        done({
          ok: true,
          mode: "probe_complete",
          message: "Deriv WebSocket Probe完了",
          results,
        });
        return;
      }

      const test = tests[step];

      try {
        ws.send(JSON.stringify(test.payload));
      } catch (error) {
        results.push({
          test: test.name,
          sendError: error instanceof Error ? error.message : String(error),
        });
        step += 1;
        setTimeout(sendNext, 300);
      }
    }

    ws.on("open", () => {
      sendNext();
    });

    ws.on("message", (raw) => {
      const text = raw.toString();
      const current = tests[step];

      let response: any;

      try {
        response = JSON.parse(text);
      } catch {
        response = {
          __parseError: true,
          __text: text,
        };
      }

      results.push({
        test: current?.name ?? `step_${step}`,
        payload: current?.payload ?? null,
        response,
      });

      step += 1;
      setTimeout(sendNext, 300);
    });

    ws.on("error", (error) => {
      results.push({
        stage: "ws_error",
        message: error instanceof Error ? error.message : String(error),
      });

      done({
        ok: false,
        mode: "ws_error",
        results,
      });
    });

    ws.on("close", (code, reason) => {
      done({
        ok: true,
        mode: "closed",
        closeCode: code,
        closeReason: reason.toString(),
        results,
      });
    });
  });
}

export async function POST() {
  try {
    const account = await fetchDemoAccount();
    const wsUrl = await fetchOtpWsUrl(account.account_id);
    const probe = await wsProbe(wsUrl);

    return NextResponse.json({
      ok: true,
      accountId: account.account_id,
      currency: account.currency,
      ...probe,
    });
  } catch (error) {
    console.error("===== Deriv Proposal Error =====");
    console.error(error);
    let detail: any = null;

    const message =
      error instanceof Error ? error.message : "Deriv Probe取得エラー";

    try {
      detail = JSON.parse(message);
    } catch {
      detail = null;
    }

    return NextResponse.json(
      {
        ok: false,
        message,
        detail,
      },
      { status: 500 }
    );
  }
}