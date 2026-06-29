type Props = {
  bosBull: boolean;
  bosBear: boolean;
  chochBull: boolean;
  chochBear: boolean;
  liquidityBull: boolean;
  liquidityBear: boolean;
  label: string;
  score: number;
  fvgBull: boolean;
  fvgBear: boolean;
};

export default function SMCPanel({
  bosBull,
  bosBear,
  chochBull,
  chochBear,
  liquidityBull,
  liquidityBear,
  fvgBull,
  fvgBear,
  label,
  score,
}: Props) {
    const structure =
    bosBull || chochBull || liquidityBull || fvgBull
        ? "強気"
        : bosBear || chochBear || liquidityBear || fvgBear
        ? "弱気"
        : "中立";

  return (
    <div className="rounded-2xl border border-zinc-700 bg-zinc-950 p-4 text-white">
      <h2 className="mb-3 text-lg font-bold">SMC詳細分析</h2>

      <div className="mb-4 rounded-xl bg-zinc-900 p-3">
        <p className="text-sm text-zinc-400">現在構造</p>
        <p className="text-2xl font-bold">{structure}</p>
      </div>

      <div className="mb-4 rounded-xl bg-zinc-900 p-3">
        <p className="text-sm text-zinc-400">SMC判定</p>
        <p className="font-bold">{label}</p>
      </div>

      <div className="mb-4 rounded-xl bg-zinc-900 p-3">
        <p className="text-sm text-zinc-400">SMCスコア</p>
        <p className="text-2xl font-bold">{score}点</p>
      </div>

      <div className="space-y-2 text-sm">
        <p>{bosBull ? "✅" : "ー"} BOS上方向</p>
        <p>{bosBear ? "✅" : "ー"} BOS下方向</p>
        <p>{chochBull ? "✅" : "ー"} CHOCH上方向</p>
        <p>{chochBear ? "✅" : "ー"} CHOCH下方向</p>
        <p>{liquidityBull ? "✅" : "ー"} 下ヒゲ狩り後のHIGH候補</p>
        <p>{liquidityBear ? "✅" : "ー"} 上ヒゲ狩り後のLOW候補</p>
        <p>{fvgBull ? "✅" : "ー"} FVG上方向</p>
        <p>{fvgBear ? "✅" : "ー"} FVG下方向</p>
      </div>
    </div>
  );
}