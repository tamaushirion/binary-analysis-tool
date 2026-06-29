import db from "./database";

export type TradeFeatureSnapshot = {
  ema9?: number | null;
  ema21?: number | null;
  emaDiff?: number | null;
  rci9?: number | null;
  rci26?: number | null;
  rci52?: number | null;
  atr?: number | null;
  trend?: "UP" | "DOWN" | "RANGE" | string | null;
  marketPhase?: "TREND" | "RANGE" | "BREAKOUT" | "REVERSAL" | string | null;
  volatilityLevel?: "LOW" | "NORMAL" | "HIGH" | string | null;
  session?: "ASIA" | "LONDON" | "NEWYORK" | "OVERLAP" | string | null;
  bos?: boolean | null;
  choch?: boolean | null;
  fvg?: boolean | null;
  orderBlock?: boolean | null;
  hour?: number | null;
  weekday?: number | null;
  aiScore?: number | null;
  weightScore?: number | null;
  similarityScore?: number | null;
  finalScore?: number | null;
};

export type SaveTradeHistoryInput = {
  contractId: number | string;
  proposalId?: string | null;
  pair: string;
  direction: "HIGH" | "LOW";
  score?: number | null;
  payoutRate?: number | null;
  buyPrice?: number | null;
  payout?: number | null;
  profit?: number | null;
  status?: string | null;
  entrySpot?: number | string | null;
  exitSpot?: number | string | null;
  startTime?: number | null;
  endTime?: number | null;
  features?: TradeFeatureSnapshot | null;
};

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toBoolInt(value: unknown) {
  if (value === true) return 1;
  if (value === false) return 0;
  return null;
}

function getHourFromUnix(startTime?: number | null) {
  if (!startTime) return null;
  const date = new Date(startTime * 1000);
  return date.getHours();
}

function getWeekdayFromUnix(startTime?: number | null) {
  if (!startTime) return null;
  const date = new Date(startTime * 1000);
  return date.getDay();
}

function ensureColumn(columnName: string, columnDefinition: string) {
  const columns = db.prepare(`PRAGMA table_info(trade_history)`).all() as Array<{
    name: string;
  }>;

  const exists = columns.some((column) => column.name === columnName);

  if (!exists) {
    db.prepare(`ALTER TABLE trade_history ADD COLUMN ${columnDefinition}`).run();
  }
}

function ensureFeatureColumns() {
  ensureColumn("ema9", "ema9 REAL");
  ensureColumn("ema21", "ema21 REAL");
  ensureColumn("ema_diff", "ema_diff REAL");

  ensureColumn("rci9", "rci9 REAL");
  ensureColumn("rci26", "rci26 REAL");
  ensureColumn("rci52", "rci52 REAL");

  ensureColumn("atr", "atr REAL");

  ensureColumn("trend", "trend TEXT");
  ensureColumn("market_phase", "market_phase TEXT");
  ensureColumn("volatility_level", "volatility_level TEXT");
  ensureColumn("session", "session TEXT");

  ensureColumn("bos", "bos INTEGER");
  ensureColumn("choch", "choch INTEGER");
  ensureColumn("fvg", "fvg INTEGER");
  ensureColumn("order_block", "order_block INTEGER");

  ensureColumn("weight_score", "weight_score REAL");
  ensureColumn("similarity_score", "similarity_score REAL");
  ensureColumn("final_score", "final_score REAL");

  ensureColumn("hour", "hour INTEGER");
  ensureColumn("weekday", "weekday INTEGER");

  ensureColumn("feature_snapshot", "feature_snapshot TEXT");
}

ensureFeatureColumns();

export function saveTradeHistory(input: SaveTradeHistoryInput) {
  const features = input.features ?? null;

  const hour = features?.hour ?? getHourFromUnix(input.startTime);
  const weekday = features?.weekday ?? getWeekdayFromUnix(input.startTime);

  const featureSnapshot = features
    ? JSON.stringify({
        ...features,
        pair: input.pair,
        direction: input.direction,
        score: input.score ?? null,
        payoutRate: input.payoutRate ?? null,
        savedAt: Date.now(),
      })
    : null;

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO trade_history (
      contract_id,
      proposal_id,
      pair,
      direction,
      score,
      payout_rate,
      buy_price,
      payout,
      profit,
      status,
      entry_spot,
      exit_spot,
      start_time,
      end_time,

      ema9,
      ema21,
      ema_diff,
      rci9,
      rci26,
      rci52,
      atr,
      trend,
      market_phase,
      volatility_level,
      session,
      bos,
      choch,
      fvg,
      order_block,
      weight_score,
      similarity_score,
      final_score,
      hour,
      weekday,
      feature_snapshot,

      created_at
    ) VALUES (
      @contractId,
      @proposalId,
      @pair,
      @direction,
      @score,
      @payoutRate,
      @buyPrice,
      @payout,
      @profit,
      @status,
      @entrySpot,
      @exitSpot,
      @startTime,
      @endTime,

      @ema9,
      @ema21,
      @emaDiff,
      @rci9,
      @rci26,
      @rci52,
      @atr,
      @trend,
      @marketPhase,
      @volatilityLevel,
      @session,
      @bos,
      @choch,
      @fvg,
      @orderBlock,
      @weightScore,
      @similarityScore,
      @finalScore,
      @hour,
      @weekday,
      @featureSnapshot,

      @createdAt
    )
  `);

  return stmt.run({
    contractId: String(input.contractId),
    proposalId: input.proposalId ?? null,
    pair: input.pair,
    direction: input.direction,
    score: input.score ?? null,
    payoutRate: input.payoutRate ?? null,
    buyPrice: input.buyPrice ?? null,
    payout: input.payout ?? null,
    profit: input.profit ?? null,
    status: input.status ?? null,
    entrySpot: toNumber(input.entrySpot),
    exitSpot: toNumber(input.exitSpot),
    startTime: input.startTime ?? null,
    endTime: input.endTime ?? null,

    ema9: toNumber(features?.ema9),
    ema21: toNumber(features?.ema21),
    emaDiff: toNumber(features?.emaDiff),
    rci9: toNumber(features?.rci9),
    rci26: toNumber(features?.rci26),
    rci52: toNumber(features?.rci52),
    atr: toNumber(features?.atr),
    trend: features?.trend ?? null,
    marketPhase: features?.marketPhase ?? null,
    volatilityLevel: features?.volatilityLevel ?? null,
    session: features?.session ?? null,
    bos: toBoolInt(features?.bos),
    choch: toBoolInt(features?.choch),
    fvg: toBoolInt(features?.fvg),
    orderBlock: toBoolInt(features?.orderBlock),
    weightScore: toNumber(features?.weightScore),
    similarityScore: toNumber(features?.similarityScore),
    finalScore: toNumber(features?.finalScore),
    hour,
    weekday,
    featureSnapshot,

    createdAt: Date.now(),
  });
}

export function getRecentTradeHistory(limit = 50) {
  return db
    .prepare(
      `
      SELECT *
      FROM trade_history
      ORDER BY created_at DESC
      LIMIT ?
    `
    )
    .all(limit);
}

export function getTradeStats() {
  const overall = db
    .prepare(
      `
      SELECT
        COUNT(*) as totalTrades,
        SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN status = 'LOST' THEN 1 ELSE 0 END) as losses,
        ROUND(
          100.0 * SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
          2
        ) as winRate,
        ROUND(SUM(profit), 2) as totalProfit,
        ROUND(AVG(profit), 4) as avgProfit,
        ROUND(AVG(payout_rate), 4) as avgPayoutRate
      FROM trade_history
      `
    )
    .get();

  const byPair = db
    .prepare(
      `
      SELECT
        pair,
        COUNT(*) as totalTrades,
        SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN status = 'LOST' THEN 1 ELSE 0 END) as losses,
        ROUND(
          100.0 * SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
          2
        ) as winRate,
        ROUND(SUM(profit), 2) as totalProfit,
        ROUND(AVG(profit), 4) as avgProfit
      FROM trade_history
      GROUP BY pair
      ORDER BY totalTrades DESC
      `
    )
    .all();

  const byDirection = db
    .prepare(
      `
      SELECT
        direction,
        COUNT(*) as totalTrades,
        SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN status = 'LOST' THEN 1 ELSE 0 END) as losses,
        ROUND(
          100.0 * SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
          2
        ) as winRate,
        ROUND(SUM(profit), 2) as totalProfit,
        ROUND(AVG(profit), 4) as avgProfit
      FROM trade_history
      GROUP BY direction
      ORDER BY totalTrades DESC
      `
    )
    .all();

  return {
    overall,
    byPair,
    byDirection,
  };
}

export function getLearningStats() {
  const byScoreBand = db
    .prepare(
      `
      SELECT
        CASE
          WHEN score >= 90 THEN '90-100'
          WHEN score >= 80 THEN '80-89'
          WHEN score >= 70 THEN '70-79'
          ELSE '0-69'
        END as scoreBand,
        COUNT(*) as totalTrades,
        SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN status = 'LOST' THEN 1 ELSE 0 END) as losses,
        ROUND(100.0 * SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) as winRate,
        ROUND(SUM(profit), 2) as totalProfit,
        ROUND(AVG(profit), 4) as avgProfit
      FROM trade_history
      GROUP BY scoreBand
      ORDER BY scoreBand DESC
      `
    )
    .all();

  const byPayoutRateBand = db
    .prepare(
      `
      SELECT
        CASE
          WHEN payout_rate >= 1.95 THEN '1.95+'
          WHEN payout_rate >= 1.90 THEN '1.90-1.94'
          WHEN payout_rate >= 1.80 THEN '1.80-1.89'
          ELSE '0-1.79'
        END as payoutRateBand,
        COUNT(*) as totalTrades,
        SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN status = 'LOST' THEN 1 ELSE 0 END) as losses,
        ROUND(100.0 * SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) as winRate,
        ROUND(SUM(profit), 2) as totalProfit,
        ROUND(AVG(profit), 4) as avgProfit
      FROM trade_history
      GROUP BY payoutRateBand
      ORDER BY payoutRateBand DESC
      `
    )
    .all();

  const byHour = db
    .prepare(
      `
      SELECT
        COALESCE(hour, CAST(strftime('%H', datetime(start_time, 'unixepoch', 'localtime')) AS INTEGER)) as hour,
        COUNT(*) as totalTrades,
        SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN status = 'LOST' THEN 1 ELSE 0 END) as losses,
        ROUND(100.0 * SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) as winRate,
        ROUND(SUM(profit), 2) as totalProfit,
        ROUND(AVG(profit), 4) as avgProfit
      FROM trade_history
      WHERE start_time IS NOT NULL OR hour IS NOT NULL
      GROUP BY hour
      ORDER BY hour ASC
      `
    )
    .all();

  const byMarketPhase = db
    .prepare(
      `
      SELECT
        market_phase as marketPhase,
        COUNT(*) as totalTrades,
        SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN status = 'LOST' THEN 1 ELSE 0 END) as losses,
        ROUND(100.0 * SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) as winRate,
        ROUND(SUM(profit), 2) as totalProfit,
        ROUND(AVG(profit), 4) as avgProfit
      FROM trade_history
      WHERE market_phase IS NOT NULL
      GROUP BY market_phase
      ORDER BY totalTrades DESC
      `
    )
    .all();

  const bySession = db
    .prepare(
      `
      SELECT
        session,
        COUNT(*) as totalTrades,
        SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN status = 'LOST' THEN 1 ELSE 0 END) as losses,
        ROUND(100.0 * SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) as winRate,
        ROUND(SUM(profit), 2) as totalProfit,
        ROUND(AVG(profit), 4) as avgProfit
      FROM trade_history
      WHERE session IS NOT NULL
      GROUP BY session
      ORDER BY totalTrades DESC
      `
    )
    .all();

  return {
    byScoreBand,
    byPayoutRateBand,
    byHour,
    byMarketPhase,
    bySession,
  };
}

export function getSimilarityTradeCandidates(params: {
  pair: string;
  direction: "HIGH" | "LOW";
  limit?: number;
}) {
  const limit = params.limit ?? 300;

  return db
    .prepare(
      `
      SELECT
        contract_id as contractId,
        pair,
        direction,
        score,
        payout_rate as payoutRate,
        profit,
        status,
        start_time as startTime,
        end_time as endTime,

        ema9,
        ema21,
        ema_diff as emaDiff,
        rci9,
        rci26,
        rci52,
        atr,
        trend,
        market_phase as marketPhase,
        volatility_level as volatilityLevel,
        session,
        bos,
        choch,
        fvg,
        order_block as orderBlock,
        weight_score as weightScore,
        similarity_score as similarityScore,
        final_score as finalScore,
        hour,
        weekday,
        feature_snapshot as featureSnapshot
      FROM trade_history
      WHERE pair = ?
        AND direction = ?
        AND profit IS NOT NULL
      ORDER BY id DESC
      LIMIT ?
      `
    )
    .all(params.pair, params.direction, limit) as Array<{
    contractId: string;
    pair: string;
    direction: "HIGH" | "LOW";
    score: number;
    payoutRate: number | null;
    profit: number;
    status: string;
    startTime: string | null;
    endTime: string | null;

    ema9: number | null;
    ema21: number | null;
    emaDiff: number | null;
    rci9: number | null;
    rci26: number | null;
    rci52: number | null;
    atr: number | null;
    trend: string | null;
    marketPhase: string | null;
    volatilityLevel: string | null;
    session: string | null;
    bos: number | null;
    choch: number | null;
    fvg: number | null;
    orderBlock: number | null;
    weightScore: number | null;
    similarityScore: number | null;
    finalScore: number | null;
    hour: number | null;
    weekday: number | null;
    featureSnapshot: string | null;
  }>;
}

export function getClosedTradesForValidation(limit = 1000) {
  return db
    .prepare(
      `
      SELECT
        id,
        contract_id as contractId,
        pair,
        direction,
        score,
        payout_rate as payoutRate,
        profit,
        status,
        created_at as createdAt,
        start_time as startTime,
        end_time as endTime,
        weight_score as weightScore,
        similarity_score as similarityScore,
        final_score as finalScore,
        market_phase as marketPhase,
        session,
        hour,
        weekday
      FROM trade_history
      WHERE profit IS NOT NULL
        AND status IN ('WON', 'LOST')
      ORDER BY created_at ASC
      LIMIT ?
      `
    )
    .all(limit) as Array<{
    id: number;
    contractId: string;
    pair: string;
    direction: "HIGH" | "LOW";
    score: number | null;
    payoutRate: number | null;
    profit: number;
    status: "WON" | "LOST";
    createdAt: number;
    startTime: number | null;
    endTime: number | null;
    weightScore: number | null;
    similarityScore: number | null;
    finalScore: number | null;
    marketPhase: string | null;
    session: string | null;
    hour: number | null;
    weekday: number | null;
  }>;
}