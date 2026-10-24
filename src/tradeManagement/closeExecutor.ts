import { Logger } from '../logger';
import { AuthenticatedDeltaClient } from '../delta/authenticatedClient';
import { TradeStorage } from '../database/tradeStorage';
import { LevelStorage } from '../database/levelStorage';
import { TradeRecord, LevelRecord, CandleDecision } from '../types';
import { TradeManagementConfig } from '../config';

export interface CloseExecutionResult {
  status: 'executed' | 'dry-run' | 'skipped' | 'failed';
  reason: string;
  orderId?: string;
}

export interface CloseExecutorDeps {
  client: AuthenticatedDeltaClient;
  tradeStorage: TradeStorage;
  levelStorage: LevelStorage;
  logger: Logger;
  config: TradeManagementConfig;
}

export async function executeCloseDecision(
  deps: CloseExecutorDeps,
  decision: CandleDecision,
  level: LevelRecord,
  trade: TradeRecord,
  dryRun: boolean,
): Promise<CloseExecutionResult> {
  const { client, tradeStorage, levelStorage, logger, config } = deps;
  if (decision.action !== 'close') return { status: 'skipped', reason: 'not close' };
  if (level.status !== 'active' || level.tradeId !== trade.id)
    return { status: 'skipped', reason: 'level inactive or unbound' };
  if (trade.monitoringStatus !== 'active') return { status: 'skipped', reason: 'trade not active' };
  if (trade.stopLossStatus !== 'verified')
    return { status: 'skipped', reason: 'stop not verified' };

  // fresh position
  let positions: any[];
  try {
    positions = await client.getPositions();
  } catch (e) {
    return { status: 'failed', reason: 'position fetch failed' };
  }
  const pos = positions.find((p: any) => p.product_id === trade.productId);
  if (!pos || Math.abs(pos.size) === 0)
    return { status: 'skipped', reason: 'position already closed' };
  const size = Math.abs(pos.size);
  const side = pos.size > 0 ? 'BUY' : 'SELL';
  if (side !== trade.side) return { status: 'skipped', reason: 'direction changed' };

  const closeSide = trade.side === 'BUY' ? 'sell' : 'buy';

  if (dryRun) {
    logger.info('Dry-run close', { tradeId: trade.id, levelId: level.id, side: closeSide, size });
    return { status: 'dry-run', reason: 'dry-run' };
  }
  if (!config.demoMode === false) {
    // live requires demoMode false; if demoMode true skip
  }
  if (config.demoMode) {
    return { status: 'skipped', reason: 'demo mode enabled' };
  }

  // submit
  const payload = {
    product_id: trade.productId,
    size,
    side: closeSide,
    order_type: 'market_order',
    reduce_only: true,
  };
  let placed: any;
  try {
    placed = await client.placeOrder(payload);
  } catch (e) {
    return { status: 'failed', reason: String(e) };
  }
  const orderId = placed && placed.id ? String(placed.id) : undefined;

  // verify flat
  let flat = false;
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 50));
    try {
      const ps = await client.getPositions();
      const p = ps.find((x: any) => x.product_id === trade.productId);
      if (!p || Math.abs(p.size) === 0) {
        flat = true;
        break;
      }
    } catch {
      /* retry */
    }
  }
  if (!flat) {
    return { status: 'failed', reason: 'position not flat after close', orderId };
  }
  const now = new Date().toISOString();
  tradeStorage.markClosed(trade.id, now);
  const updatedLevel = {
    ...level,
    status: 'inactive' as any,
    monitoringState: 'idle' as any,
    lastProcessedCandleTs: decision.candleTs,
    updatedAt: now,
  };
  levelStorage.upsert(updatedLevel);
  logger.info('Close executed and verified', { tradeId: trade.id, orderId });
  return { status: 'executed', reason: 'verified flat', orderId };
}
