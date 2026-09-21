import 'dotenv/config';
import { loadConfig } from './config';
import { createLogger } from './logger';
import { initDatabase, DatabaseInitResult } from './database/index';
import { createAlertStorage } from './database/storage';
import { createDeltaClient, DeltaClient } from './delta/client';
import { createDiscordClient, DiscordClient } from './discord/client';
import { createAlertEngine, AlertEngine } from './alerts/engine';
import { AlertStorage } from './database/storage';
let deltaClient: DeltaClient | null = null;
let discordClient: DiscordClient | null = null;
let alertEngine: AlertEngine | null = null;
let dbResult: DatabaseInitResult | null = null;
let storage: AlertStorage | null = null;

async function main(): Promise<void> {
  const logger = createLogger('info');
  logger.info('Starting Discord Alert Bot');

  const config = loadConfig(logger);

  process.on('unhandledRejection', (reason: unknown): void => {
    logger.error('Unhandled promise rejection', { error: String(reason) });
  });

  process.on('uncaughtException', (err: Error): void => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  });

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  try {
    dbResult = initDatabase(config.databasePath, logger);
    storage = createAlertStorage(dbResult, logger);
  } catch (err) {
    logger.error('Failed to initialize database', { error: String(err) });
    process.exit(1);
  }

  try {
    deltaClient = createDeltaClient(
      {
        wsUrl: config.deltaWsUrl,
        symbols: config.deltaSymbols,
        reconnectIntervalMs: config.deltaReconnectIntervalMs,
        maxReconnectIntervalMs: config.deltaMaxReconnectIntervalMs,
      },
      logger,
      (payload): void => {
        if (alertEngine) {
          alertEngine.onPriceUpdate(payload);
        }
      },
    );
  } catch (err) {
    logger.error('Failed to initialize Delta client', { error: String(err) });
  }

  try {
    discordClient = createDiscordClient(
      logger,
      storage!,
      deltaClient,
      config.ethChannelId,
      config.solChannelId,
    );
    if (config.discordToken) {
      await discordClient.start(config.discordToken);
    } else {
      logger.warn('No Discord token provided; Discord client not started');
    }
  } catch (err) {
    logger.error('Failed to initialize Discord client', { error: String(err) });
  }

  alertEngine = createAlertEngine(storage!, discordClient!, logger);

  logger.info('Bot started successfully');
  logger.info('Delta WebSocket URL', { url: config.deltaWsUrl });
  logger.info('Monitoring symbols', { symbols: config.deltaSymbols });
}

function shutdown(): void {
  const logger = createLogger('info');
  logger.info('Shutting down...');

  if (deltaClient) {
    deltaClient.disconnect();
    deltaClient = null;
  }

  if (discordClient) {
    discordClient.stop().catch(() => {});
    discordClient = null;
  }

  if (dbResult) {
    dbResult.close();
    dbResult = null;
  }

  process.exit(0);
}

main().catch((err: Error): void => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
