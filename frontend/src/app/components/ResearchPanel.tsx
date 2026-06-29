"use client";

type ResearchResult = {
  name: string;
  timeSlot?: string;

  trades: number;
  wins: number;
  losses: number;
  winRate: number;

  highTrades?: number;
  highWinRate?: number;

  lowTrades?: number;
  lowWinRate?: number;

  oneMinWinRate?: number;
  threeMinWinRate?: number;

  expectancy?: number;
};

type Props = {
  results?: ResearchResult[];
};

function ResultTable({ results }: { results: ResearchResult[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1200px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-700 text-zinc-300">
            <th className="p-2 text-left">順位</th>
            <th className="p-2 text-left">ロジック</th>
            <th className="p-2 text-left">時間帯</th>
            <th className="p-2 text-right">取引数</th>
            <th className="p-2 text-right">HIGH数</th>
            <th className="p-2 text-right">HIGH勝率</th>
            <th className="p-2 text-right">LOW数</th>
            <th className="p-2 text-right">LOW勝率</th>
            <th className="p-2 text-right">総合勝率</th>
            <th className="p-2 text-right">1分後</th>
            <th className="p-2 text-right">3分後</th>
            <th className="p-2 text-right">期待値</th>
          </tr>
        </thead>

        <tbody>
          {results.map((r, index) => {
            const highWinRate = r.highWinRate ?? 0;
            const lowWinRate = r.lowWinRate ?? 0;
            const highTrades = r.highTrades ?? 0;
            const lowTrades = r.lowTrades ?? 0;
            const oneMinWinRate = r.oneMinWinRate ?? 0;
            const threeMinWinRate = r.threeMinWinRate ?? 0;
            const expectancy = r.expectancy ?? 0;

            return (
              <tr
                key={`${r.name}-${r.timeSlot ?? "all"}-${index}`}
                className="border-b border-zinc-800"
              >
                <td className="p-2 text-left">{index + 1}</td>

                <td className="p-2 text-left font-semibold">{r.name}</td>

                <td className="p-2 text-left font-bold text-yellow-400">
                  {r.timeSlot ?? "-"}
                </td>

                <td className="p-2 text-right font-bold">{r.trades}</td>

                <td className="p-2 text-right">{highTrades}</td>

                <td className="p-2 text-right text-emerald-400">
                  {highWinRate.toFixed(1)}%
                </td>

                <td className="p-2 text-right">{lowTrades}</td>

                <td className="p-2 text-right text-red-400">
                  {lowWinRate.toFixed(1)}%
                </td>

                <td className="p-2 text-right font-bold text-cyan-400">
                  {r.winRate.toFixed(1)}%
                </td>

                <td className="p-2 text-right">
                  {oneMinWinRate.toFixed(1)}%
                </td>

                <td className="p-2 text-right">
                  {threeMinWinRate.toFixed(1)}%
                </td>

                <td
                  className={`p-2 text-right font-bold ${
                    expectancy > 0
                      ? "text-emerald-400"
                      : expectancy < 0
                      ? "text-red-400"
                      : "text-zinc-400"
                  }`}
                >
                  {expectancy.toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ResearchPanel({ results = [] }: Props) {
  const sortedResults = [...results].sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return b.trades - a.trades;
  });

  const adoptedResults = sortedResults.filter(
    (r) => r.winRate >= 60 && r.trades >= 50
  );

  return (
    <div className="rounded-2xl border border-zinc-700 bg-zinc-950 p-4 text-white">
      <h2 className="mb-4 text-xl font-bold">
        Research Ver5：採用候補ランキング
      </h2>

      {sortedResults.length === 0 ? (
        <div className="rounded-xl bg-zinc-900 p-4 text-sm text-zinc-400">
          研究データ待ちです。ローソク足データが60本以上たまると表示されます。
        </div>
      ) : (
        <>
          <div className="mb-6 rounded-xl border border-emerald-700 bg-emerald-950/20 p-4">
            <h3 className="mb-3 text-lg font-bold text-emerald-400">
              採用候補：勝率60%以上 / 取引数50回以上
            </h3>

            {adoptedResults.length === 0 ? (
              <p className="text-sm text-zinc-400">
                条件を満たす採用候補はありません。
              </p>
            ) : (
              <ResultTable results={adoptedResults} />
            )}
          </div>

          <div className="rounded-xl border border-zinc-700 bg-zinc-950 p-4">
            <h3 className="mb-3 text-lg font-bold text-zinc-300">
              全ランキング
            </h3>

            <ResultTable results={sortedResults} />
          </div>
        </>
      )}

      <div className="mt-4 rounded-xl bg-zinc-900 p-3 text-sm text-zinc-400">
        採用候補は「総合勝率60%以上」かつ「取引数50回以上」。
        HIGH勝率・LOW勝率を見て、片方向だけ通知するか判断する。
      </div>
    </div>
  );
}