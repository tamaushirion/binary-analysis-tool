import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";

const PHASE15_N_STARTED_AT_ISO =
  process.env.PHASE15_N_STARTED_AT_ISO ?? "2026-07-06T09:20:20.898Z";

const PHASE15_N_BASELINE = {
  trades: 113,
  wins: 54,
  losses: 59,
  winRate: 47.79,
  totalProfit: -9.32,
};

function getDbPath() {
  return process.env.SQLITE_DB_PATH || path.join(process.cwd(), "data", "ai.db");
}

function getCreatedAtMsExpression() {
  return `
    CASE
      WHEN typeof(created_at) = 'integer' OR typeof(created_at) = 'real' THEN
        CASE
          WHEN created_at > 100000000000 THEN created_at
          ELSE created_at * 1000
        END
      WHEN typeof(created_at) = 'text' THEN
        CASE
          WHEN CAST(created_at AS INTEGER) > 100000000000 THEN CAST(created_at AS INTEGER)
          WHEN CAST(created_at AS INTEGER) > 1000000000 THEN CAST(created_at AS INTEGER) * 1000
          ELSE strftime('%s', created_at) * 1000
        END
      ELSE NULL
    END
  `;
}

function calcWinRate(wins: number, total: number) {
  return total > 0 ? Number(((wins / total) * 100).toFixed(2)) : 0;
}

function normalizeSummary(row: any) {
  const trades = Number(row?.trades ?? 0);
  const wins = Number(row?.wins ?? 0);
  const losses = Number(row?.losses ?? 0);
  const totalProfit = Number(Number(row?.totalProfit ?? 0).toFixed(4));

  return {
    trades,
    wins,
    losses,
    winRate: calcWinRate(wins, trades),
    totalProfit,
  };
}

function getTradeSummary(db: Database.Database, whereSql: string, params: Record<string, any>) {
  const row = db
    .prepare(`
      SELECT
        COUNT(*) AS trades,
        SUM(CASE WHEN UPPER(status) IN ('WON', 'WIN') OR profit > 0 THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN UPPER(status) IN ('LOST', 'LOSE') OR profit < 0 THEN 1 ELSE 0 END) AS losses,
        COALESCE(SUM(profit), 0) AS totalProfit
      FROM trade_history
      WHERE profit IS NOT NULL
        ${whereSql}
    `)
    .get(params);

  return normalizeSummary(row);
}

export async function GET(req: NextRequest) {
  const dbPath = getDbPath();
  const startedAtIso =
    req.nextUrl.searchParams.get("startedAt") ?? PHASE15_N_STARTED_AT_ISO;
  const startedAtMs = Date.parse(startedAtIso);

  if (!Number.isFinite(startedAtMs)) {
    return NextResponse.json(
      {
        ok: false,
        stage: "phase15n_status_error",
        error: "startedAt が不正です。ISO形式で指定してください。",
        example: "/api/demo-part2/phase15n-status?startedAt=2026-07-06T09:20:20.898Z",
      },
      { status: 400 },
    );
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='trade_history'")
      .get();

    if (!table) {
      throw new Error("trade_history テーブルが見つかりません");
    }

    const columns = db.prepare("PRAGMA table_info(trade_history)").all() as any[];
    const columnNames = columns.map((c) => String(c.name));

    if (!columnNames.includes("created_at")) {
      throw new Error("trade_history.created_at が見つかりません");
    }

    const createdAtMsExpr = getCreatedAtMsExpression();

    const before = getTradeSummary(
      db,
      `AND (${createdAtMsExpr}) < @startedAtMs`,
      { startedAtMs },
    );

    const after = getTradeSummary(
      db,
      `AND (${createdAtMsExpr}) >= @startedAtMs`,
      { startedAtMs },
    );

    const all = getTradeSummary(db, "", {});

    return NextResponse.json({
      ok: true,
      stage: "phase15n_status",
      cutoff: {
        startedAtIso,
        startedAtMs,
      },
      baselineAtInstall: PHASE15_N_BASELINE,
      before,
      after,
      all,
      comparison: {
        winRateChangeFromBaseline: Number((after.winRate - PHASE15_N_BASELINE.winRate).toFixed(2)),
        profitChangeFromBaseline: Number((after.totalProfit - PHASE15_N_BASELINE.totalProfit).toFixed(4)),
        note:
          "after は Phase15-N導入後にSQLiteへ保存された約定済み取引だけを集計します。SKIP回数はtrade_historyに保存されないため、このAPIでは過去分を復元できません。",
      },
      dbPath,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        stage: "phase15n_status_error",
        error: error?.message ?? "Phase15-N status集計に失敗しました",
        dbPath,
      },
      { status: 500 },
    );
  } finally {
    db.close();
  }
}
