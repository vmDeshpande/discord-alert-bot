import { Logger } from '../logger';
import { DatabaseInitResult } from './index';
import { TradeInteractionRecord } from '../types';

export interface TradeInteractionStorage {
  getById: (id: string) => TradeInteractionRecord | undefined;
  getByTradeId: (tradeId: string) => TradeInteractionRecord[];
  create: (interaction: TradeInteractionRecord) => void;
  update: (interaction: TradeInteractionRecord) => void;
}

export function createTradeInteractionStorage(
  dbResult: DatabaseInitResult,
  logger: Logger,
): TradeInteractionStorage {
  const { db } = dbResult;

  function mapRow(row: any): TradeInteractionRecord {
    return {
      id: row.id,
      tradeId: row.trade_id,
      type: row.type,
      state: row.state,
      userId: row.user_id,
      channelId: row.channel_id,
      messageId: row.message_id,
      data: row.data,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  return {
    getById: (id: string): TradeInteractionRecord | undefined => {
      try {
        const row = db.prepare('SELECT * FROM trade_interactions WHERE id = ?').get(id);
        return row ? mapRow(row) : undefined;
      } catch (err) {
        logger.error('Failed to fetch trade interaction', { error: String(err), id });
        return undefined;
      }
    },
    getByTradeId: (tradeId: string): TradeInteractionRecord[] => {
      try {
        return db
          .prepare('SELECT * FROM trade_interactions WHERE trade_id = ? ORDER BY created_at DESC')
          .all(tradeId)
          .map(mapRow) as TradeInteractionRecord[];
      } catch (err) {
        logger.error('Failed to fetch trade interactions by trade', {
          error: String(err),
          tradeId,
        });
        return [];
      }
    },
    create: (interaction: TradeInteractionRecord): void => {
      try {
        db.prepare(
          `INSERT INTO trade_interactions (id, trade_id, type, state, user_id, channel_id, message_id, data, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          interaction.id,
          interaction.tradeId,
          interaction.type,
          interaction.state,
          interaction.userId,
          interaction.channelId,
          interaction.messageId,
          interaction.data,
          interaction.createdAt,
          interaction.updatedAt,
        );
      } catch (err) {
        logger.error('Failed to create trade interaction', {
          error: String(err),
          id: interaction.id,
        });
      }
    },
    update: (interaction: TradeInteractionRecord): void => {
      try {
        db.prepare(
          `UPDATE trade_interactions SET trade_id = ?, type = ?, state = ?, user_id = ?, channel_id = ?, message_id = ?, data = ?, updated_at = ? WHERE id = ?`,
        ).run(
          interaction.tradeId,
          interaction.type,
          interaction.state,
          interaction.userId,
          interaction.channelId,
          interaction.messageId,
          interaction.data,
          interaction.updatedAt,
          interaction.id,
        );
      } catch (err) {
        logger.error('Failed to update trade interaction', {
          error: String(err),
          id: interaction.id,
        });
      }
    },
  };
}
