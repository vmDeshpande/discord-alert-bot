import { Logger } from '../logger';
import { AuthenticatedDeltaClient } from '../delta/authenticatedClient';
import { TradeStorage } from '../database/tradeStorage';
import { TradeRecord, DeltaPosition } from '../types';

export interface PositionPoller {
  start: () => void;
  stop: () => void;
  pollNow: () => Promise<void>;
  isPolling: () => boolean;
}

export function createPositionPoller(
  intervalMs: number,
  client: AuthenticatedDeltaClient,
  storage: TradeStorage,
  logger: Logger,
): PositionPoller {
  let timer: ReturnType<typeof setInterval> | null = null;
  let polling = false;

  function sideFromSize(size: number): 'BUY' | 'SELL' {
    return size > 0 ? 'BUY' : 'SELL';
  }

  async function reconcilePosition(pos: DeltaPosition): Promise<void> {
    const now = new Date().toISOString();
    const absSize = Math.abs(pos.size);
    const entry = Number(pos.entry_price);
    const existing = storage.getByProduct(pos.product_id);
    if (existing) {
      const updated: TradeRecord = {
        ...existing,
        side: sideFromSize(pos.size),
        size: absSize,
        entryPrice: Number.isFinite(entry) ? entry : existing.entryPrice,
        markPrice: pos.mark_price ? Number(pos.mark_price) : existing.markPrice,
        unrealizedPnl: pos.unrealized_pnl ? Number(pos.unrealized_pnl) : existing.unrealizedPnl,
        unrealizedPnlCurrency: pos.unrealized_pnl_currency ?? existing.unrealizedPnlCurrency,
        lastSeenAt: now,
        updatedAt: now,
        monitoringStatus:
          existing.monitoringStatus === 'closed' ? 'active' : existing.monitoringStatus,
        lastEvent: 'reconciled',
        lastEventAt: now,
      };
      storage.upsert(updated);
      logger.info('Trade reconciled', {
        id: existing.id,
        productId: pos.product_id,
        size: absSize,
      });
      return;
    }
    const trade: TradeRecord = {
      id: `trade-${pos.product_id}-${Date.now()}`,
      productId: pos.product_id,
      symbol: pos.product_symbol,
      side: sideFromSize(pos.size),
      size: absSize,
      entryPrice: Number.isFinite(entry) ? entry : 0,
      markPrice: pos.mark_price ? Number(pos.mark_price) : null,
      unrealizedPnl: pos.unrealized_pnl ? Number(pos.unrealized_pnl) : null,
      unrealizedPnlCurrency: pos.unrealized_pnl_currency ?? null,
      liquidationPrice: pos.liquidation_price ? Number(pos.liquidation_price) : null,
      stopLossOrderId: null,
      stopLossPrice: null,
      stopLossStatus: 'none',
      monitoringStatus: 'pending',
      discordChannelId: null,
      discordMessageId: null,
      lastEvent: 'discovered',
      lastEventAt: now,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
    storage.upsert(trade);
    logger.info('Trade discovered', { id: trade.id, symbol: trade.symbol, side: trade.side });
  }

  async function pollNow(): Promise<void> {
    if (polling) {
      logger.warn('Poll already in progress; skipping');
      return;
    }
    polling = true;
    try {
      const positions = await client.getPositions();
      const seenProducts = new Set<number>();
      for (const pos of positions) {
        seenProducts.add(pos.product_id);
        await reconcilePosition(pos);
      }
      const all = storage.getAll();
      for (const trade of all) {
        if (trade.monitoringStatus === 'closed') continue;
        if (!seenProducts.has(trade.productId)) {
          // only mark closed if we had a successful poll; positions list authoritative
          storage.markClosed(trade.id, new Date().toISOString());
          logger.info('Trade marked closed (not in exchange positions)', { id: trade.id });
        }
      }
    } catch (err) {
      logger.error('Position poll failed; not changing session state', { error: String(err) });
    } finally {
      polling = false;
    }
  }

  function start(): void {
    if (timer) return;
    timer = setInterval(() => {
      pollNow().catch((err) => logger.error('Poll error', { error: String(err) }));
    }, intervalMs);
    pollNow().catch((err) => logger.error('Initial poll error', { error: String(err) }));
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, pollNow, isPolling: () => polling };
}
