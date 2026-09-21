import { Logger } from '../logger';
import { DatabaseInitResult } from './index';
import { AlertConfig } from '../alerts/types';

export interface AlertStorage {
  getAll: () => AlertConfig[];
  getById: (id: string) => AlertConfig | undefined;
  getActiveBySymbol: (symbol: string) => AlertConfig[];
  save: (alert: AlertConfig) => void;
  update: (alert: AlertConfig) => void;
  delete: (id: string) => void;
}

export function createAlertStorage(dbResult: DatabaseInitResult, logger: Logger): AlertStorage {
  const { db } = dbResult;

  return {
    getAll: (): AlertConfig[] => {
      try {
        return db
          .prepare(
            'SELECT id, symbol, condition, target_price AS targetPrice, discord_channel_id AS discordChannelId, enabled, triggered, created_at AS createdAt, triggered_at AS triggeredAt FROM alerts ORDER BY created_at DESC',
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
            'SELECT id, symbol, condition, target_price AS targetPrice, discord_channel_id AS discordChannelId, enabled, triggered, created_at AS createdAt, triggered_at AS triggeredAt FROM alerts WHERE id = ?',
          )
          .get(id) as AlertConfig | undefined;
      } catch (err) {
        logger.error('Failed to fetch alert by id', { error: String(err), id });
        return undefined;
      }
    },
    getActiveBySymbol: (symbol: string): AlertConfig[] => {
      try {
        return db
          .prepare(
            `SELECT id, symbol, condition, target_price AS targetPrice, discord_channel_id AS discordChannelId, enabled, triggered, created_at AS createdAt, triggered_at AS triggeredAt
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
          'INSERT INTO alerts (id, symbol, condition, target_price, discord_channel_id, enabled, triggered, created_at, triggered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          alert.id,
          alert.symbol,
          alert.condition,
          alert.targetPrice,
          alert.discordChannelId,
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
          'UPDATE alerts SET symbol = ?, condition = ?, target_price = ?, discord_channel_id = ?, enabled = ?, triggered = ?, triggered_at = ? WHERE id = ?',
        ).run(
          alert.symbol,
          alert.condition,
          alert.targetPrice,
          alert.discordChannelId,
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
    delete: (id: string): void => {
      try {
        db.prepare('DELETE FROM alerts WHERE id = ?').run(id);
        logger.info('Alert deleted from database', { id });
      } catch (err) {
        logger.error('Failed to delete alert', { error: String(err), id });
      }
    },
  };
}

export function seedSampleAlertsIfEmpty(storage: AlertStorage, logger: Logger): void {
  const existing = storage.getAll();
  if (existing.length === 0) {
    logger.info('No alerts found in database, skipping seed');
  }
}
