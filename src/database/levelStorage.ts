import { Logger } from '../logger';
import { DatabaseInitResult } from './index';
import { LevelRecord } from '../types';

export interface LevelStorage {
  getAll: () => LevelRecord[];
  getByTrade: (tradeId: string) => LevelRecord[];
  getById: (id: string) => LevelRecord | undefined;
  upsert: (level: LevelRecord) => void;
  deleteById: (id: string) => void;
}

export function createLevelStorage(dbResult: DatabaseInitResult, logger: Logger): LevelStorage {
  const { db } = dbResult;
  function mapRow(row: any): LevelRecord {
    return {
      id: row.id,
      tradeId: row.trade_id,
      symbol: row.symbol,
      side: row.side,
      levelPrice: row.level_price,
      condition: row.condition,
      status: row.status,
      monitoringState: row.monitoring_state,
      triggerCandleTs: row.trigger_candle_ts,
      nextCandleTs: row.next_candle_ts,
      lastProcessedCandleTs: row.last_processed_candle_ts,
      holdCount: row.hold_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  return {
    getAll: () => {
      try {
        return db.prepare('SELECT * FROM levels').all().map(mapRow) as LevelRecord[];
      } catch (err) {
        logger.error('Failed to fetch levels', { error: String(err) });
        return [];
      }
    },
    getByTrade: (tradeId) => {
      try {
        return db
          .prepare('SELECT * FROM levels WHERE trade_id = ?')
          .all(tradeId)
          .map(mapRow) as LevelRecord[];
      } catch (err) {
        logger.error('Failed to fetch levels by trade', { error: String(err), tradeId });
        return [];
      }
    },
    getById: (id) => {
      try {
        const row = db.prepare('SELECT * FROM levels WHERE id = ?').get(id);
        return row ? mapRow(row) : undefined;
      } catch (err) {
        logger.error('Failed to fetch level', { error: String(err), id });
        return undefined;
      }
    },
    upsert: (level) => {
      try {
        db.prepare(
          `INSERT INTO levels (id, trade_id, symbol, side, level_price, condition, status, monitoring_state, trigger_candle_ts, next_candle_ts, last_processed_candle_ts, hold_count, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET trade_id=excluded.trade_id, symbol=excluded.symbol, side=excluded.side, level_price=excluded.level_price, condition=excluded.condition, status=excluded.status, monitoring_state=excluded.monitoring_state, trigger_candle_ts=excluded.trigger_candle_ts, next_candle_ts=excluded.next_candle_ts, last_processed_candle_ts=excluded.last_processed_candle_ts, hold_count=excluded.hold_count, updated_at=excluded.updated_at`,
        ).run(
          level.id,
          level.tradeId,
          level.symbol,
          level.side,
          level.levelPrice,
          level.condition,
          level.status,
          level.monitoringState,
          level.triggerCandleTs,
          level.nextCandleTs,
          level.lastProcessedCandleTs,
          level.holdCount,
          level.createdAt,
          level.updatedAt,
        );
      } catch (err) {
        logger.error('Failed to upsert level', { error: String(err), id: level.id });
      }
    },
    deleteById: (id) => {
      try {
        db.prepare('DELETE FROM levels WHERE id = ?').run(id);
      } catch (err) {
        logger.error('Failed to delete level', { error: String(err), id });
      }
    },
  };
}
