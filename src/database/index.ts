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
      condition TEXT NOT NULL,
      target_price REAL NOT NULL,
      discord_channel_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      triggered INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      triggered_at TEXT
    )
  `);

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
