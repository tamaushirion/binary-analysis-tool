import type { Result } from "../lib/backtest";

type Props = {
  winRate: number;
  wins: number;
  loses: number;
  total: number;
  results: Result[];
  smc: string;
};

export default function BacktestPanel({
  winRate,
  wins,
  loses,
  total,
  results,
  smc,
}: Props) {
  const recentResults = results.slice(-10).reverse();

  return (
    <div className="rounded-2xl bg-slate-900 p-4 text-white shadow-lg">
      <h2 className="mb-3 text-lg font-bold">過去200回の実績</h2>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-slate-800 p-3">
          <p className="text-slate-400">勝率</p>
          <p className="text-2xl font-bold">{winRate}%</p>
        </div>

        <div className="rounded-xl bg-slate-800 p-3">
          <p className="text-slate-400">取引数</p>
          <p className="text-2xl font-bold">{total}</p>
        </div>

        <div className="rounded-xl bg-green-900/40 p-3">
          <p className="text-slate-400">勝ち</p>
          <p className="text-2xl font-bold text-green-400">{wins}</p>
        </div>

        <div className="rounded-xl bg-red-900/40 p-3">
          <p className="text-slate-400">負け</p>
          <p className="text-2xl font-bold text-red-400">{loses}</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-slate-800 p-3">
        <p className="text-sm text-slate-400">SMC判定</p>
        <p className="mt-1 font-bold">{smc}</p>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-sm text-slate-400">直近10回</p>

        <div className="flex flex-wrap gap-2">
          {recentResults.length === 0 && (
            <span className="text-sm text-slate-500">まだ結果なし</span>
          )}

          {recentResults.map((result, index) => (
            <span
              key={index}
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                result === "WIN"
                  ? "bg-green-500 text-white"
                  : "bg-red-500 text-white"
              }`}
            >
              {result}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}