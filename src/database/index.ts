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
