import Database from 'better-sqlite3';
import { Logger } from '../logger';

export interface DatabaseInitResult {
  db: Database.Database;
  close: () => void;
}

export function initDatabase(dbPath: string, logger: Logger): DatabaseInitResult {
  let db: Database.Database;
  try {
    db = new Database(dbPath);
  } catch (err) {
    logger.error('Failed to open database', { error: String(err), path: dbPath });
    throw err;
  }

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      channel_id TEXT NOT NULL DEFAULT '',
      target_price REAL NOT NULL,
      baseline_price REAL,
      direction TEXT NOT NULL DEFAULT 'upward',
      active INTEGER NOT NULL DEFAULT 1,
      triggered INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      triggered_at TEXT
    )
  `);

  const columns = db.prepare("SELECT name FROM pragma_table_info('alerts')").all() as {
    name: string;
  }[];
  const columnNames = columns.map((c) => c.name);

  if (columnNames.includes('condition') && !columnNames.includes('direction')) {
    db.exec('ALTER TABLE alerts RENAME COLUMN condition TO direction');
    db.exec("UPDATE alerts SET direction = 'upward' WHERE direction IS NULL OR direction = ''");
    logger.info('Migrated condition column to direction');
  }

  if (columnNames.includes('discord_channel_id') && !columnNames.includes('channel_id')) {
    db.exec('ALTER TABLE alerts RENAME COLUMN discord_channel_id TO channel_id');
    logger.info('Migrated discord_channel_id to channel_id');
  }

  if (!columnNames.includes('baseline_price')) {
    db.exec('ALTER TABLE alerts ADD COLUMN baseline_price REAL');
    logger.info('Added baseline_price column');
  }

  if (!columnNames.includes('active')) {
    db.exec('ALTER TABLE alerts ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
    logger.info('Added active column');
  }

  if (!columnNames.includes('direction')) {
    db.exec("ALTER TABLE alerts ADD COLUMN direction TEXT NOT NULL DEFAULT 'upward'");
    logger.info('Added direction column');
  }

  if (!columnNames.includes('channel_id')) {
    db.exec("ALTER TABLE alerts ADD COLUMN channel_id TEXT NOT NULL DEFAULT ''");
    logger.info('Added channel_id column');
  }

  // ---- Trade management tables ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      product_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      size REAL NOT NULL,
      entry_price REAL NOT NULL,
      mark_price REAL,
      unrealized_pnl REAL,
      unrealized_pnl_currency TEXT,
      liquidation_price REAL,
      stop_loss_order_id TEXT,
      stop_loss_price REAL,
      stop_loss_status TEXT NOT NULL DEFAULT 'none',
      monitoring_status TEXT NOT NULL DEFAULT 'pending',
      discord_channel_id TEXT,
      discord_message_id TEXT,
      last_event TEXT,
      last_event_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS levels (
      id TEXT PRIMARY KEY,
      trade_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      level_price REAL NOT NULL,
      condition TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'inactive',
      monitoring_state TEXT NOT NULL DEFAULT 'idle',
      trigger_candle_ts INTEGER,
      next_candle_ts INTEGER,
      last_processed_candle_ts INTEGER,
      hold_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS processed_candles (
      level_id TEXT NOT NULL,
      candle_ts INTEGER NOT NULL,
      decision TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (level_id, candle_ts)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS trade_interactions (
      id TEXT PRIMARY KEY,
      trade_id TEXT NOT NULL,
      type TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'open',
      user_id TEXT,
      channel_id TEXT,
      message_id TEXT,
      data TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE
    )
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_trades_stop_order ON trades(stop_loss_order_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_levels_trade ON levels(trade_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_levels_status ON levels(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_levels_monitoring ON levels(monitoring_state)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_processed_candles_level ON processed_candles(level_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_interactions_trade ON trade_interactions(trade_id)');

  logger.info('Database initialized', { path: dbPath });

  return {
    db,
    close: () => {
      try {
        db.close();
        logger.info('Database closed');
      } catch (err) {
        logger.error('Failed to close database', { error: String(err) });
      }
    },
  };
}
