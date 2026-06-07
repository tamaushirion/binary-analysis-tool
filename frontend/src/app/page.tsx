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

  return (
    <main className="min-h-screen bg-black text-white p-6">
      <div className="mb-6">
        <h1 className="text-4xl font-bold">AI Binary Analysis Pro</h1>
        <p className="text-gray-400 mt-2">
          SMC・ICT・Wyckoff・EMA・RCI統合分析システム
        </p>
      </div>

      <div className="grid grid-cols-6 gap-2 mb-6">
        {pairs.map((pair) => (
          <button
            key={pair}
            className="rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-sm font-bold hover:bg-zinc-800"
          >
            {pair}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="rounded-xl border border-zinc-700 bg-zinc-950 p-4 h-[300px]">
          <ChartPanel title="15分足" subtitle="大きな方向・SMC・Wyckoff" height={220} />
        </div>

        <div className="rounded-xl border border-zinc-700 bg-zinc-950 p-4 h-[300px]">
          <ChartPanel title="5分足" subtitle="FVG・Liquidity・RCI方向" height={220} />
        </div>

        <div className="rounded-xl border border-emerald-500 bg-zinc-950 p-4 h-[300px]">
          <h2 className="text-lg font-bold">総合判定</h2>
          <div className="mt-6 text-5xl font-black text-yellow-400">見送り</div>
          <p className="mt-4 text-sm text-gray-400">
            条件が揃うまでエントリーしない
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-700 bg-zinc-950 p-4 h-[420px] mb-4">
        <ChartPanel
          title="1分足：エントリー判断"
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