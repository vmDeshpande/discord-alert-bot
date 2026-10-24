import { Logger } from '../logger';
import { DatabaseInitResult } from './index';
import { TradeRecord } from '../types';

export interface TradeStorage {
  getAll: () => TradeRecord[];
  getById: (id: string) => TradeRecord | undefined;
  getByProduct: (productId: number) => TradeRecord | undefined;
  upsert: (trade: TradeRecord) => void;
  markClosed: (id: string, now: string) => void;
}

export function createTradeStorage(dbResult: DatabaseInitResult, logger: Logger): TradeStorage {
  const { db } = dbResult;
  return {
    getAll: () => {
      try {
        return db.prepare('SELECT * FROM trades').all().map(mapRow) as TradeRecord[];
      } catch (err) {
        logger.error('Failed to fetch trades', { error: String(err) });
        return [];
      }
    },
    getById: (id) => {
      try {
        const row = db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
        return row ? mapRow(row) : undefined;
      } catch (err) {
        logger.error('Failed to fetch trade', { error: String(err), id });
        return undefined;
      }
    },
    getByProduct: (productId) => {
      try {
        const row = db
          .prepare('SELECT * FROM trades WHERE product_id = ? AND monitoring_status != ?')
          .get(productId, 'closed');
        return row ? mapRow(row) : undefined;
      } catch (err) {
        logger.error('Failed to fetch trade by product', { error: String(err), productId });
        return undefined;
      }
    },
    upsert: (trade) => {
      try {
        db.prepare(
          `INSERT INTO trades (id, product_id, symbol, side, size, entry_price, mark_price, unrealized_pnl, unrealized_pnl_currency, liquidation_price, stop_loss_order_id, stop_loss_price, stop_loss_status, monitoring_status, discord_channel_id, discord_message_id, last_event, last_event_at, created_at, updated_at, last_seen_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id, symbol=excluded.symbol, side=excluded.side, size=excluded.size, entry_price=excluded.entry_price, mark_price=excluded.mark_price, unrealized_pnl=excluded.unrealized_pnl, unrealized_pnl_currency=excluded.unrealized_pnl_currency, liquidation_price=excluded.liquidation_price, stop_loss_order_id=excluded.stop_loss_order_id, stop_loss_price=excluded.stop_loss_price, stop_loss_status=excluded.stop_loss_status, monitoring_status=excluded.monitoring_status, discord_channel_id=excluded.discord_channel_id, discord_message_id=excluded.discord_message_id, last_event=excluded.last_event, last_event_at=excluded.last_event_at, updated_at=excluded.updated_at, last_seen_at=excluded.last_seen_at`,
        ).run(
          trade.id,
          trade.productId,
          trade.symbol,
          trade.side,
          trade.size,
          trade.entryPrice,
          trade.markPrice,
          trade.unrealizedPnl,
          trade.unrealizedPnlCurrency,
          trade.liquidationPrice,
          trade.stopLossOrderId,
          trade.stopLossPrice,
          trade.stopLossStatus,
          trade.monitoringStatus,
          trade.discordChannelId,
          trade.discordMessageId,
          trade.lastEvent,
          trade.lastEventAt,
          trade.createdAt,
          trade.updatedAt,
          trade.lastSeenAt,
        );
      } catch (err) {
        logger.error('Failed to upsert trade', { error: String(err), id: trade.id });
      }
    },
    markClosed: (id, now) => {
      try {
        db.prepare(
          "UPDATE trades SET monitoring_status='closed', updated_at=?, last_seen_at=? WHERE id=?",
        ).run(now, now, id);
      } catch (err) {
        logger.error('Failed to mark trade closed', { error: String(err), id });
      }
    },
  };
}

function mapRow(row: any): TradeRecord {
  return {
    id: row.id,
    productId: row.product_id,
    symbol: row.symbol,
    side: row.side,
    size: row.size,
    entryPrice: row.entry_price,
    markPrice: row.mark_price,
    unrealizedPnl: row.unrealized_pnl,
    unrealizedPnlCurrency: row.unrealized_pnl_currency,
    liquidationPrice: row.liquidation_price,
    stopLossOrderId: row.stop_loss_order_id,
    stopLossPrice: row.stop_loss_price,
    stopLossStatus: row.stop_loss_status,
    monitoringStatus: row.monitoring_status,
    discordChannelId: row.discord_channel_id,
    discordMessageId: row.discord_message_id,
    lastEvent: row.last_event,
    lastEventAt: row.last_event_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
  };
}
