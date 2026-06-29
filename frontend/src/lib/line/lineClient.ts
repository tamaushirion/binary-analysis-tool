type LinePushMessageInput = {
  text: string;
};

export type TradeResultLineMessageInput = {
  pair: string;
  direction: "HIGH" | "LOW";
  status: string | null | undefined;
  buyPrice: number | null | undefined;
  profit: number | null | undefined;
  finalScore: number;
  confidence: number;
  entryGate?: {
    allow: boolean;
    score: number;
    reasons: string[];
  } | null;
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

export function createTradeResultLineText(input: TradeResultLineMessageInput) {
  const profit = Number(input.profit ?? 0);
  const buyPrice = Number(input.buyPrice ?? 0);

  const isWin = input.status === "WON";
  const icon = isWin ? "🟢" : "🔴";
  const resultText = isWin ? "勝ち ✅" : "負け ❌";
  const profitLabel = profit >= 0 ? "利益" : "損益";
  const profitSign = profit > 0 ? "+" : "";

  const gateText = input.entryGate
    ? `${input.entryGate.allow ? "PASS ✅" : "BLOCK ❌"} / ${input.entryGate.score}点`
    : "未使用";

  const gateReasons =
    input.entryGate?.reasons && input.entryGate.reasons.length > 0
      ? input.entryGate.reasons.slice(0, 5).map((reason) => `・${reason}`).join("\n")
      : "・なし";

  return (
    `${icon} デモ取引結果\n\n` +
    `結果：${resultText}\n` +
    `銘柄：${input.pair}\n` +
    `方向：${input.direction}\n\n` +
    `掛け金：${buyPrice.toFixed(2)} USD（${usdToJpyText(buyPrice)}）\n` +
    `${profitLabel}：${profitSign}${profit.toFixed(2)} USD（${usdToJpyText(profit)}）\n\n` +
    `Final Score：${input.finalScore}\n` +
    `Confidence：${input.confidence}\n` +
    `Entry Gate：${gateText}\n\n` +
    `判定理由\n${gateReasons}\n\n` +
    `ひとこと：${
      isWin
        ? "良い結果です。条件が合う場面だけデモ検証を続けます。"
        : "負けも検証データとして保存しました。次はEntry Gateと類似学習で改善します。"
    }`
  );
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