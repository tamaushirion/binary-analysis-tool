import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import { CURRENT_AI_VERSION, getCurrentAiVersion } from "@/lib/versioning/aiVersion";

function getDbPath() {
  return path.join(process.cwd(), "data", "ai.db");
}

export async function GET() {
  try {
    const dbPath = getDbPath();
    const db = new Database(dbPath);

    const columns = db.prepare("PRAGMA table_info(trade_history)").all() as any[];
    const hasAiVersion = columns.some((c) => c.name === "ai_version");

    if (!hasAiVersion) {
      db.prepare("ALTER TABLE trade_history ADD COLUMN ai_version TEXT").run();
    }

    const summary = db
      .prepare(`
        SELECT
          COALESCE(ai_version, 'legacy_or_unknown') as aiVersion,
          COUNT(*) as totalTrades,
          SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END) as wins,
          SUM(CASE WHEN status = 'LOST' THEN 1 ELSE 0 END) as losses,
          ROUND(SUM(COALESCE(profit, 0)), 4) as totalProfit
        FROM trade_history
        GROUP BY COALESCE(ai_version, 'legacy_or_unknown')
        ORDER BY totalTrades DESC
      `)
      .all();

    db.close();

    return NextResponse.json({
      ok: true,
      stage: "phase15_l_ai_version_check",
      current: getCurrentAiVersion(),
      currentAiVersion: CURRENT_AI_VERSION,
      dbPath,
      hasAiVersionColumn: true,
      summary,
      message: "ai_versionカラム確認・必要なら追加完了",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "phase15_l_ai_version_check_error",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
