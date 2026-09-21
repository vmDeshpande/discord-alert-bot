import { Logger } from '../logger';
import { DatabaseInitResult } from './index';
import { AlertConfig } from '../alerts/types';

export interface AlertStorage {
  getAllByChannel: (channelId: string) => AlertConfig[];
  getById: (id: string) => AlertConfig | undefined;
  getActiveBySymbol: (symbol: string) => AlertConfig[];
  save: (alert: AlertConfig) => void;
  update: (alert: AlertConfig) => void;
  deleteById: (id: string) => void;
}

export function createAlertStorage(dbResult: DatabaseInitResult, logger: Logger): AlertStorage {
  const { db } = dbResult;

  function selectColumns(): string {
    return (
      'id, symbol, channel_id AS channelId, target_price AS targetPrice, ' +
      'baseline_price AS baselinePrice, direction, active, triggered, ' +
      'created_at AS createdAt, triggered_at AS triggeredAt'
    );
  }

  return {
    getAllByChannel: (channelId: string): AlertConfig[] => {
      try {
        return db
          .prepare(
            `SELECT ${selectColumns()} FROM alerts WHERE channel_id = ? ORDER BY created_at DESC`,
          )
          .all(channelId) as AlertConfig[];
      } catch (err) {
        logger.error('Failed to fetch alerts by channel', { error: String(err), channelId });
        return [];
      }
    },
    getById: (id: string): AlertConfig | undefined => {
      try {
        return db.prepare(`SELECT ${selectColumns()} FROM alerts WHERE id = ?`).get(id) as
          AlertConfig | undefined;
      } catch (err) {
        logger.error('Failed to fetch alert by id', { error: String(err), id });
        return undefined;
      }
    },
    getActiveBySymbol: (symbol: string): AlertConfig[] => {
      try {
        return db
          .prepare(
            `SELECT ${selectColumns()} FROM alerts WHERE symbol = ? AND active = 1 AND triggered = 0`,
          )
          .all(symbol) as AlertConfig[];
      } catch (err) {
        logger.error('Failed to fetch active alerts for symbol', { error: String(err), symbol });
        return [];
      }
    },
    save: (alert: AlertConfig): void => {
      try {
        db.prepare(
          'INSERT INTO alerts (id, symbol, channel_id, target_price, baseline_price, direction, active, triggered, created_at, triggered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          alert.id,
          alert.symbol,
          alert.channelId,
          alert.targetPrice,
          alert.baselinePrice || null,
          alert.direction,
          alert.active ? 1 : 0,
          alert.triggered ? 1 : 0,
          alert.createdAt,
          alert.triggeredAt || null,
        );
        logger.info('Alert saved to database', { id: alert.id, symbol: alert.symbol });
      } catch (err) {
        logger.error('Failed to save alert', { error: String(err), id: alert.id });
      }
    },
    update: (alert: AlertConfig): void => {
      try {
        db.prepare(
          'UPDATE alerts SET symbol = ?, channel_id = ?, target_price = ?, baseline_price = ?, direction = ?, active = ?, triggered = ?, triggered_at = ? WHERE id = ?',
        ).run(
          alert.symbol,
          alert.channelId,
          alert.targetPrice,
          alert.baselinePrice || null,
          alert.direction,
          alert.active ? 1 : 0,
          alert.triggered ? 1 : 0,
          alert.triggeredAt || null,
          alert.id,
        );
        logger.info('Alert updated in database', { id: alert.id });
      } catch (err) {
        logger.error('Failed to update alert', { error: String(err), id: alert.id });
      }
    },
    deleteById: (id: string): void => {
      try {
        db.prepare('DELETE FROM alerts WHERE id = ?').run(id);
        logger.info('Alert deleted from database', { id });
      } catch (err) {
        logger.error('Failed to delete alert', { error: String(err), id });
      }
    },
  };
}
