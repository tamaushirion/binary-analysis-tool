import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "ai.db");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS trade_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id TEXT NOT NULL UNIQUE,
    proposal_id TEXT,
    pair TEXT NOT NULL,
    direction TEXT NOT NULL,
    score INTEGER,
    payout_rate REAL,
    buy_price REAL,
    payout REAL,
    profit REAL,
    status TEXT,
    entry_spot REAL,
    exit_spot REAL,
    start_time INTEGER,
    end_time INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_trade_history_pair
  ON trade_history(pair);

  CREATE INDEX IF NOT EXISTS idx_trade_history_direction
  ON trade_history(direction);

  CREATE INDEX IF NOT EXISTS idx_trade_history_status
  ON trade_history(status);

  CREATE INDEX IF NOT EXISTS idx_trade_history_created_at
  ON trade_history(created_at);
`);

export default db;