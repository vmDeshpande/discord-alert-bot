import { Logger } from '../logger';
import { AuthenticatedDeltaClient } from '../delta/authenticatedClient';
import { TradeStorage } from '../database/tradeStorage';
import { TradeRecord, DeltaPosition } from '../types';
import { TradeManagementConfig } from '../config';

export interface StopLossManager {
  protect: (
    trade: TradeRecord,
    position: DeltaPosition,
    dryRun: boolean,
  ) => Promise<{ success: boolean; orderId?: string; reason: string }>;
}

export function calculateStopPrice(
  entryPrice: number,
  side: 'BUY' | 'SELL',
  offset: number,
): number {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) throw new Error('invalid entry price');
  if (offset <= 0) throw new Error('invalid offset');
  return side === 'BUY' ? entryPrice - offset : entryPrice + offset;
}

export function createStopLossManager(
  config: TradeManagementConfig,
  client: AuthenticatedDeltaClient,
  storage: TradeStorage,
  logger: Logger,
): StopLossManager {
  return {
    async protect(trade, position, dryRun) {
      const now = new Date().toISOString();
      const side = trade.side;
      const entry = Number(position.entry_price);
      if (!Number.isFinite(entry) || entry <= 0) {
        logger.error('Invalid entry price for stop', { tradeId: trade.id });
        return { success: false, reason: 'invalid entry price' };
      }
      const size = Math.abs(position.size);
      if (size <= 0) {
        return { success: false, reason: 'zero size position' };
      }
      const productId = position.product_id;
      if (!productId) {
        return { success: false, reason: 'missing product id' };
      }
      let stopPrice: number;
      try {
        stopPrice = calculateStopPrice(entry, side, config.stopLossOffset);
      } catch (e) {
        return { success: false, reason: String(e) };
      }
      if (stopPrice <= 0) {
        return { success: false, reason: 'non-positive stop price' };
      }

      // Check whether a bracket / stop already exists for this position so
      // polling cannot repeatedly replace it. Delta allows only a single
      // bracket order per open position.
      let existingOrders: any[] = [];
      try {
        existingOrders = (await client.getOpenOrders(productId)) as any[];
      } catch (e) {
        logger.error('Failed to fetch open orders', { error: String(e) });
        return { success: false, reason: 'order fetch failed' };
      }

      // Adopt an existing stop-loss order matching our calculated stop price.
      const matching = existingOrders.find((o: any) => {
        const sp = Number(o.stop_price);
        return o.product_id === productId && Number.isFinite(sp) && Math.abs(sp - stopPrice) < 1e-9;
      });
      if (matching) {
        const orderId = String(matching.id);
        const updated: TradeRecord = {
          ...trade,
          stopLossOrderId: orderId,
          stopLossPrice: stopPrice,
          stopLossStatus: 'verified',
          monitoringStatus: 'active',
          lastEvent: 'stop adopted',
          lastEventAt: now,
          updatedAt: now,
          lastSeenAt: now,
        };
        storage.upsert(updated);
        logger.info('Adopted existing bracket stop', { tradeId: trade.id, orderId });
        return { success: true, orderId, reason: 'adopted existing' };
      }

      if (dryRun) {
        logger.info('Dry-run: would place bracket stop', {
          tradeId: trade.id,
          productId,
          side,
          stopPrice,
          size,
        });
        const updated: TradeRecord = {
          ...trade,
          stopLossPrice: stopPrice,
          stopLossStatus: 'pending',
          monitoringStatus: 'pending',
          lastEvent: 'dry-run stop',
          lastEventAt: now,
          updatedAt: now,
          lastSeenAt: now,
        };
        storage.upsert(updated);
        return { success: true, reason: 'dry-run' };
      }

      // Live: attach a stop-loss bracket to the existing position via
      // POST /v2/orders/bracket. Size is not specified; a bracket order closes
      // the entire position. No take-profit leg is sent unless configured.
      const payload = {
        product_id: productId,
        stop_loss_order: {
          order_type: 'market_order',
          stop_price: String(stopPrice),
        },
        bracket_stop_trigger_method: 'mark_price',
      };
      let placed: any;
      try {
        placed = await client.placeBracketOrder(payload);
      } catch (e) {
        logger.error('Bracket placement failed', { tradeId: trade.id, error: String(e) });
        const updated: TradeRecord = {
          ...trade,
          stopLossPrice: stopPrice,
          stopLossStatus: 'failed',
          lastEvent: 'stop failed',
          lastEventAt: now,
          updatedAt: now,
          lastSeenAt: now,
        };
        storage.upsert(updated);
        return { success: false, reason: String(e) };
      }

      // Verify the bracket using Delta's API response or order/position data.
      // Never mark the stop verified just because the request returned without
      // throwing. Log the actual API response if confirmation fails.
      const bracketOrderId = placed && placed.id ? String(placed.id) : undefined;
      let verified = false;
      let confirmedId = bracketOrderId;
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 50));
        try {
          const orders = (await client.getOpenOrders(productId)) as any[];
          const found = orders.find((o: any) =>
            confirmedId ? String(o.id) === confirmedId : Number(o.stop_price) === stopPrice,
          );
          if (found) {
            verified = true;
            confirmedId = String(found.id);
            break;
          }
        } catch {
          /* retry */
        }
      }

      if (!verified) {
        logger.error('Bracket verification failed', {
          tradeId: trade.id,
          orderId: confirmedId,
          response: placed,
        });
        const updated: TradeRecord = {
          ...trade,
          stopLossOrderId: confirmedId ?? trade.stopLossOrderId,
          stopLossPrice: stopPrice,
          stopLossStatus: 'pending',
          monitoringStatus: 'pending',
          lastEvent: 'stop unverified',
          lastEventAt: now,
          updatedAt: now,
          lastSeenAt: now,
        };
        storage.upsert(updated);
        return { success: false, orderId: confirmedId, reason: 'verification failed' };
      }

      const updated: TradeRecord = {
        ...trade,
        stopLossOrderId: confirmedId ?? trade.stopLossOrderId,
        stopLossPrice: stopPrice,
        stopLossStatus: 'verified',
        monitoringStatus: 'active',
        lastEvent: 'stop verified',
        lastEventAt: now,
        updatedAt: now,
        lastSeenAt: now,
      };
      storage.upsert(updated);
      logger.info('Bracket stop verified', { tradeId: trade.id, orderId: confirmedId });
      return { success: true, orderId: confirmedId, reason: 'verified' };
    },
  };
}
