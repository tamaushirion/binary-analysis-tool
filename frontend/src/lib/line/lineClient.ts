type LinePushMessageInput = {
  text: string;
};

const LINE_PUSH_API_URL = "https://api.line.me/v2/bot/message/push";

export function usdToJpyText(usd: number | null | undefined) {
  if (usd === null || usd === undefined || Number.isNaN(Number(usd))) {
    return "約0円";
  }

  const rate = Number(process.env.LINE_USD_JPY_RATE ?? 157);
  const jpy = Math.round(Number(usd) * rate);

  const sign = jpy > 0 ? "+" : "";

  return `約${sign}${jpy.toLocaleString()}円`;
}

export async function sendLinePushMessage(input: LinePushMessageInput) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = process.env.LINE_USER_ID;

  if (!token || !userId) {
    console.log("LINE通知スキップ: 環境変数が未設定です");
    return {
      ok: false,
      skipped: true,
      reason: "LINE_CHANNEL_ACCESS_TOKEN または LINE_USER_ID が未設定",
    };
  }

  const res = await fetch(LINE_PUSH_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: userId,
      messages: [
        {
          type: "text",
          text: input.text,
        },
      ],
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");

    console.error("LINE通知失敗", {
      status: res.status,
      errorText,
    });

    return {
      ok: false,
      skipped: false,
      status: res.status,
      errorText,
    };
  }

  return {
    ok: true,
    skipped: false,
  };
}