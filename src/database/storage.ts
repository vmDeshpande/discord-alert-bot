import { Logger } from '../logger';
import { DatabaseInitResult } from './index';
import { AlertConfig } from '../alerts/types';

export interface AlertStorage {
  getAll: () => AlertConfig[];
  getById: (id: string) => AlertConfig | undefined;
  getByChannel: (channelId: string) => AlertConfig | undefined;
  getActiveBySymbol: (symbol: string) => AlertConfig[];
  save: (alert: AlertConfig) => void;
  update: (alert: AlertConfig) => void;
  deleteByChannel: (channelId: string) => void;
}

export function createAlertStorage(dbResult: DatabaseInitResult, logger: Logger): AlertStorage {
  const { db } = dbResult;

  return {
    getAll: (): AlertConfig[] => {
      try {
        return db
          .prepare(
            'SELECT id, symbol, channel_id AS channelId, target_price AS targetPrice, baseline_price AS baselinePrice, direction, enabled, triggered, created_at AS createdAt, triggered_at AS triggeredAt FROM alerts ORDER BY created_at DESC',
          )
          .all() as AlertConfig[];
      } catch (err) {
        logger.error('Failed to fetch all alerts', { error: String(err) });
        return [];
      }
    },
    getById: (id: string): AlertConfig | undefined => {
      try {
        return db
          .prepare(
            'SELECT id, symbol, channel_id AS channelId, target_price AS targetPrice, baseline_price AS baselinePrice, direction, enabled, triggered, created_at AS createdAt, triggered_at AS triggeredAt FROM alerts WHERE id = ?',
          )
          .get(id) as AlertConfig | undefined;
      } catch (err) {
        logger.error('Failed to fetch alert by id', { error: String(err), id });
        return undefined;
      }
    },
    getByChannel: (channelId: string): AlertConfig | undefined => {
      try {
        return db
          .prepare(
            'SELECT id, symbol, channel_id AS channelId, target_price AS targetPrice, baseline_price AS baselinePrice, direction, enabled, triggered, created_at AS createdAt, triggered_at AS triggeredAt FROM alerts WHERE channel_id = ?',
          )
          .get(channelId) as AlertConfig | undefined;
      } catch (err) {
        logger.error('Failed to fetch alert by channel', { error: String(err), channelId });
        return undefined;
      }
    },
    getActiveBySymbol: (symbol: string): AlertConfig[] => {
      try {
        return db
          .prepare(
            `SELECT id, symbol, channel_id AS channelId, target_price AS targetPrice, baseline_price AS baselinePrice, direction, enabled, triggered, created_at AS createdAt, triggered_at AS triggeredAt
             FROM alerts WHERE symbol = ? AND enabled = 1 AND triggered = 0`,
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
          'INSERT INTO alerts (id, symbol, channel_id, target_price, baseline_price, direction, enabled, triggered, created_at, triggered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          alert.id,
          alert.symbol,
          alert.channelId,
          alert.targetPrice,
          alert.baselinePrice || null,
          alert.direction,
          alert.enabled ? 1 : 0,
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
          'UPDATE alerts SET symbol = ?, channel_id = ?, target_price = ?, baseline_price = ?, direction = ?, enabled = ?, triggered = ?, triggered_at = ? WHERE id = ?',
        ).run(
          alert.symbol,
          alert.channelId,
          alert.targetPrice,
          alert.baselinePrice || null,
          alert.direction,
          alert.enabled ? 1 : 0,
          alert.triggered ? 1 : 0,
          alert.triggeredAt || null,
          alert.id,
        );
        logger.info('Alert updated in database', { id: alert.id });
      } catch (err) {
        logger.error('Failed to update alert', { error: String(err), id: alert.id });
      }
    },
    deleteByChannel: (channelId: string): void => {
      try {
        db.prepare('DELETE FROM alerts WHERE channel_id = ?').run(channelId);
        logger.info('Alert deleted from database', { channelId });
      } catch (err) {
        logger.error('Failed to delete alert', { error: String(err), channelId });
      }
    },
  };
}
