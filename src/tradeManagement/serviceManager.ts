import { Logger } from '../logger';
import { AuthenticatedDeltaClient } from '../delta/authenticatedClient';
import { TradeStorage } from '../database/tradeStorage';
import { LevelStorage } from '../database/levelStorage';
import { TradeInteractionStorage } from '../database/tradeInteractionStorage';
import { createPositionPoller } from './polling';
import { createStopLossManager } from './stopLoss';
import { TradeManagementConfig } from '../config';

export interface TradeServiceManager {
  start: () => void;
  stop: () => void;
}

export function createTradeServiceManager(
  config: TradeManagementConfig,
  client: AuthenticatedDeltaClient,
  tradeStorage: TradeStorage,
  _levelStorage: LevelStorage,
  _tradeInteractionStorage: TradeInteractionStorage,
  logger: Logger,
): TradeServiceManager {
  const poller = createPositionPoller(config.pollIntervalMs, client, tradeStorage, logger);
  // stopLossManager available for explicit gating only
  createStopLossManager(config, client, tradeStorage, logger);

  return {
    start: () => {
      poller.start();
      logger.info('Trade service manager started (read-only monitoring/polling)');
    },
    stop: () => {
      poller.stop();
    },
  };
}
