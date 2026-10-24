import { Logger } from '../logger';
import { AuthenticatedDeltaClient } from '../delta/authenticatedClient';
import { TradeStorage } from '../database/tradeStorage';
import { LevelStorage } from '../database/levelStorage';
import { createStopLossManager } from './stopLoss';
import { TradeManagementConfig } from '../config';

export interface TradeIntegration {
  stop: () => void;
}

export function createTradeIntegration(
  config: TradeManagementConfig,
  client: AuthenticatedDeltaClient,
  tradeStorage: TradeStorage,
  _levelStorage: LevelStorage,
  logger: Logger,
  stopLossEnabled: boolean,
  closeEnabled: boolean,
): TradeIntegration {
  void closeEnabled;
  const stopLossManager = createStopLossManager(config, client, tradeStorage, logger);
  let stopped = false;

  async function tick() {
    if (stopped) return;
    try {
      const trades = tradeStorage.getAll();
      for (const trade of trades) {
        if (trade.monitoringStatus === 'closed') continue;
        if (trade.stopLossStatus === 'verified') continue;
        if (!stopLossEnabled) continue;
        try {
          const positions = await (client as any).getPositions();
          const pos = positions.find((p: any) => p.product_id === trade.productId);
          if (pos) {
            await stopLossManager.protect(trade, pos, !stopLossEnabled);
          }
        } catch {
          // ignore
        }
      }
    } catch (err) {
      logger.error('Trade integration tick failed', { error: String(err) });
    }
  }

  const timer = setInterval(tick, Math.max(config.pollIntervalMs, 5000));
  tick().catch(() => {});

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
