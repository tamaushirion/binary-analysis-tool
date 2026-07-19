import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import { getCurrentAiVersion } from "@/lib/versioning/aiVersion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getDbPath() {
  return process.env.SQLITE_DB_PATH || path.join(process.cwd(), "data", "ai.db");
}

export async function GET() {
  try {
    const dbPath = getDbPath();
    const db = new Database(dbPath, { readonly: false });

    const columns = db.prepare("PRAGMA table_info(trade_history)").all() as any[];
    const hasAiVersion = columns.some((c) => c.name === "ai_version");

    if (!hasAiVersion) {
      db.prepare("ALTER TABLE trade_history ADD COLUMN ai_version TEXT").run();
    }

    const summary = db
      .prepare(
        `SELECT COALESCE(ai_version, 'legacy_or_unknown') as aiVersion,
                COUNT(*) as totalTrades,
                SUM(CASE WHEN status = 'WON' OR profit > 0 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN status = 'LOST' OR profit < 0 THEN 1 ELSE 0 END) as losses,
                ROUND(COALESCE(SUM(profit), 0), 4) as totalProfit
         FROM trade_history
         GROUP BY COALESCE(ai_version, 'legacy_or_unknown')
         ORDER BY totalTrades DESC`,
      )
      .all();

    db.close();

    return NextResponse.json({
      ok: true,
      stage: "ai_version_summary",
      current: getCurrentAiVersion(),
      dbPath,
      summary,
      message: "AIバージョン別の集計を返しました。",
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, stage: "ai_version_summary_error", message: error?.message ?? "AI Version Summary error" },
      { status: 500 },
    );
  }
}
