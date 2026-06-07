"use client";

import { useEffect, useState } from "react";
import ChartPanel from "./components/ChartPanel";

export default function Home() {
  const pairs = [
    "USD/JPY",
    "EUR/USD",
    "GBP/USD",
    "EUR/GBP",
    "GBP/JPY",
    "EUR/JPY",
  ];

  const [selectedPair, setSelectedPair] = useState("USD/JPY");
  const [price, setPrice] = useState("接続中...");

  const finnhubSymbols: Record<string, string> = {
    "USD/JPY": "BINANCE:BTCUSDT",
    "EUR/USD": "OANDA:EUR_USD",
    "GBP/USD": "OANDA:GBP_USD",
    "EUR/GBP": "OANDA:EUR_GBP",
    "GBP/JPY": "OANDA:GBP_JPY",
    "EUR/JPY": "OANDA:EUR_JPY",
  };

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_FINNHUB_API_KEY;
    console.log("API KEY:", apiKey);

    const symbol = finnhubSymbols[selectedPair];
    console.log("SYMBOL:", symbol);

    if (!apiKey) {
      setPrice("APIキー未設定");
      return;
    }

    setPrice("接続中...");

    const socket = new WebSocket(`wss://ws.finnhub.io?token=${apiKey}`);

    socket.addEventListener("open", () => {
      console.log("WEBSOCKET OPEN");
      console.log("SUBSCRIBE:", symbol);

      setPrice("接続済み・価格待ち");

      socket.send(
        JSON.stringify({
          type: "subscribe",
          symbol,
        })
      );
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      console.log("FINNHUB MESSAGE:", message);

      if (message.type === "trade" && message.data?.length > 0) {
        const latestPrice = message.data[message.data.length - 1].p;
        setPrice(String(latestPrice));
      }
    });

    socket.addEventListener("error", (error) => {
      console.log("WEBSOCKET ERROR:", error);
      setPrice("接続エラー");
    });

    socket.addEventListener("close", () => {
      console.log("WEBSOCKET CLOSED");
    });

    return () => {
      socket.close();
    };
  }, [selectedPair]);

  return (
    <main className="min-h-screen bg-black text-white p-6">
      <div className="mb-6">
        <h1 className="text-4xl font-bold">AI Binary Analysis Pro</h1>
        <p className="text-gray-400 mt-2">
          SMC・ICT・Wyckoff・EMA・RCI統合分析システム
        </p>
      </div>

      <div className="mb-4 rounded-xl border border-zinc-700 bg-zinc-950 p-4">
        <p className="text-sm text-gray-400">選択中の通貨ペア</p>
        <h2 className="text-3xl font-black text-emerald-400">
          {selectedPair}
        </h2>
        <p className="mt-2 text-xl text-white">現在価格：{price}</p>
      </div>

      <div className="grid grid-cols-6 gap-2 mb-6">
        {pairs.map((pair) => (
          <button
            key={pair}
            onClick={() => setSelectedPair(pair)}
            className={`rounded-lg border p-3 text-sm font-bold ${
              selectedPair === pair
                ? "border-emerald-500 bg-emerald-500 text-black"
                : "border-zinc-700 bg-zinc-900 hover:bg-zinc-800"
            }`}
          >
            {pair}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="rounded-xl border border-zinc-700 bg-zinc-950 p-4 h-[300px]">
          <ChartPanel
            title={`${selectedPair} 15分足`}
            subtitle="大きな方向・SMC・Wyckoff"
            height={220}
          />
        </div>

        <div className="rounded-xl border border-zinc-700 bg-zinc-950 p-4 h-[300px]">
          <ChartPanel
            title={`${selectedPair} 5分足`}
            subtitle="FVG・Liquidity・RCI方向"
            height={220}
          />
        </div>

        <div className="rounded-xl border border-emerald-500 bg-zinc-950 p-4 h-[300px]">
          <h2 className="text-lg font-bold">総合判定</h2>
          <div className="mt-6 text-5xl font-black text-yellow-400">
            見送り
          </div>
          <p className="mt-4 text-sm text-gray-400">
            条件が揃うまでエントリーしない
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-700 bg-zinc-950 p-4 h-[420px] mb-4">
        <ChartPanel
          title={`${selectedPair} 1分足：エントリー判断`}
          subtitle="EMA・RCI・ローソク足・直近の転換確認"
          height={330}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-zinc-700 bg-zinc-950 p-4">
          <h2 className="text-lg font-bold mb-3">根拠</h2>
          <ul className="space-y-2 text-sm text-gray-300">
            <li>15分足：判定待ち</li>
            <li>5分足：判定待ち</li>
            <li>1分足：判定待ち</li>
            <li>危険条件：確認中</li>
          </ul>
        </div>

        <div className="rounded-xl border border-zinc-700 bg-zinc-950 p-4">
          <h2 className="text-lg font-bold mb-3">過去200回の成績</h2>
          <p className="text-sm text-gray-300">勝率：未計算</p>
          <p className="text-sm text-gray-300">勝ち：-</p>
          <p className="text-sm text-gray-300">負け：-</p>
        </div>
      </div>
    </main>
  );
}