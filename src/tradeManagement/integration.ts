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
  let running = false;

  async function tick(): Promise<void> {
    if (stopped || running || !stopLossEnabled) return;
    running = true;
    try {
      const trades = tradeStorage.getAll().filter(
        (trade) => trade.monitoringStatus !== 'closed' && trade.stopLossStatus !== 'verified',
      );
      if (trades.length === 0) return;

      // Fetch positions once per pass, rather than making one request per trade.
      // This also avoids a 30-second wait before protecting newly discovered positions.
      const positions = await client.getPositions();
      const positionsByProduct = new Map(positions.map((position) => [position.product_id, position]));
      for (const trade of trades) {
        if (stopped) break;
        const position = positionsByProduct.get(trade.productId);
        if (!position) continue;
        try {
          await stopLossManager.protect(trade, position, false);
        } catch (err) {
          logger.error('Stop-loss protection attempt failed', {
            tradeId: trade.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      logger.error('Trade integration tick failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => {
    void tick();
  }, Math.max(config.pollIntervalMs, 5000));
  void tick();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
