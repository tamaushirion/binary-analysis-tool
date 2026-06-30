import { NextResponse } from "next/server";
import { getTradeStats } from "@/lib/db/tradeRepository";
import { sendLinePushMessage } from "@/lib/line/lineClient";

export async function POST() {
  try {
    const stats = getTradeStats() as any;
    const overall = stats?.overall ?? {};

    const totalTrades = Number(overall.totalTrades ?? 0);
    const wins = Number(overall.wins ?? 0);
    const losses = Number(overall.losses ?? 0);
    const winRate = Number(overall.winRate ?? 0);
    const totalProfit = Number(overall.totalProfit ?? 0);
    const avgProfit = Number(overall.avgProfit ?? 0);

    const sign = totalProfit > 0 ? "+" : "";

    const text =
      `📊 今日のデモ取引レポート\n\n` +
      `取引回数：${totalTrades}回\n` +
      `勝ち：${wins}回\n` +
      `負け：${losses}回\n` +
      `勝率：${winRate.toFixed(1)}%\n\n` +
      `利益：${sign}${totalProfit.toFixed(2)} USD\n` +
      `平均損益：${avgProfit.toFixed(2)} USD\n\n` +
      `ひとこと：${
        totalTrades < 100
          ? "まずは100件のデモ検証を優先します。"
          : "100件以上のデータが集まっています。改善分析に進めます。"
      }`;

    const line = await sendLinePushMessage({ text });

    return NextResponse.json({
      ok: true,
      stage: "daily_line_report_sent",
      line,
      stats,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        stage: "daily_line_report_error",
        error: error?.message ?? "日次LINEレポート送信失敗",
      },
      { status: 500 }
    );
  }
}