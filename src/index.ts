import 'dotenv/config';
import { loadConfig } from './config';
import { createLogger } from './logger';
import { initDatabase, DatabaseInitResult } from './database/index';
import { createAlertStorage } from './database/storage';
import { createDeltaClient, DeltaClient } from './delta/client';
import { createDiscordClient, DiscordClient } from './discord/client';
import { createAlertEngine, AlertEngine } from './alerts/engine';
import { AlertStorage } from './database/storage';
import { createTradeStorage } from './database/tradeStorage';
import { createLevelStorage } from './database/levelStorage';
import { createTradeInteractionStorage } from './database/tradeInteractionStorage';
import { createDashboardService } from './tradeManagement/dashboardService';
import { routeInteraction } from './discord/router';
import { createAuthenticatedDeltaClient } from './delta/authenticatedClient';
import { createTradeServiceManager } from './tradeManagement/serviceManager';
import { createTradeIntegration } from './tradeManagement/integration';
import { createLevelMonitor } from './tradeManagement/levelMonitor';

let deltaClient: DeltaClient | null = null;
let discordClient: DiscordClient | null = null;
let alertEngine: AlertEngine | null = null;
let dbResult: DatabaseInitResult | null = null;
let storage: AlertStorage | null = null;
let dashboardService: ReturnType<typeof createDashboardService> | null = null;
let dashboardInterval: any = null;
let dashboardInteractionBound = false;
let tradeServiceManager: ReturnType<typeof createTradeServiceManager> | null = null;
let tradeIntegration: ReturnType<typeof createTradeIntegration> | null = null;
let levelMonitor: ReturnType<typeof createLevelMonitor> | null = null;

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
      config.ethChannelId,
      config.solChannelId,
      config.btcChannelId,
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

  if (config.tradeManagement.enabled && discordClient && dbResult) {
    try {
      const tradeStorage = createTradeStorage(dbResult, logger);
      const levelStorage = createLevelStorage(dbResult, logger);
      const tradeInteractionStorage = createTradeInteractionStorage(dbResult, logger);
      const dc: any = discordClient as any;
      const client = dc.getClient ? dc.getClient() : dc.client;

      const discordAdapter = {
        sendMessage: async (channelId: string, _content?: string, embed?: unknown) => {
          try {
            const channel = await client.channels.fetch(channelId);
            if (channel && 'send' in channel) {
              const msg = await (channel as any).send({ embeds: embed ? [embed] : [] });
              return { id: msg.id };
            }
            return null;
          } catch (err) {
            logger.error('Discord send failed', { error: String(err), channelId });
            return null;
          }
        },
        editMessage: async (
          channelId: string,
          messageId: string,
          _content?: string,
          embed?: unknown,
        ) => {
          try {
            const channel = await client.channels.fetch(channelId);
            if (channel && 'messages' in channel) {
              const msg = await (channel as any).messages.fetch(messageId);
              if (msg && msg.edit) {
                await msg.edit({ embeds: embed ? [embed] : [] });
                return true;
              }
            }
            return false;
          } catch (err) {
            logger.error('Discord edit failed', { error: String(err), channelId, messageId });
            return false;
          }
        },
      };

      try {
        const authClient = createAuthenticatedDeltaClient(
          {
            baseUrl: config.tradeManagement.apiBaseUrl,
            apiKey: config.tradeManagement.apiKey,
            apiSecret: config.tradeManagement.apiSecret,
          },
          logger,
        );
        tradeServiceManager = createTradeServiceManager(
          config.tradeManagement,
          authClient,
          tradeStorage,
          levelStorage,
          tradeInteractionStorage,
          logger,
        );
        tradeServiceManager.start();
        const stopEnabled =
          (process.env.TRADE_STOP_LOSS_ENABLED || 'false').toLowerCase() === 'true';
        const closeEnabled = (process.env.TRADE_CLOSE_ENABLED || 'false').toLowerCase() === 'true';
        tradeIntegration = createTradeIntegration(
          config.tradeManagement,
          authClient,
          tradeStorage,
          levelStorage,
          logger,
          stopEnabled,
          closeEnabled,
        );
        levelMonitor = createLevelMonitor(
          tradeStorage,
          levelStorage,
          async (symbol: string, resolution: string, limit: number) => {
            const base = config.tradeManagement.apiBaseUrl;
            const url = `${base}/v2/history/candles?symbol=${encodeURIComponent(symbol)}&resolution=${encodeURIComponent(resolution)}&limit=${limit}`;
            const res = await fetch(url);
            if (!res.ok) return [];
            const data = (await res.json()) as any;
            const result = data.result || data.data || [];
            return result.map((c: any) => ({
              time: Number(c.time || c.timestamp || c.t),
              open: Number(c.open || c.o),
              high: Number(c.high || c.h),
              low: Number(c.low || c.l),
              close: Number(c.close || c.c),
              volume: Number(c.volume || c.v || 0),
            }));
          },
          {
            client: authClient,
            tradeStorage,
            levelStorage,
            logger,
            config: config.tradeManagement,
          } as any,
          logger,
          config.tradeManagement.demoMode || !closeEnabled,
          {
            channelId: config.tradeManagement.discordChannelId,
            sendMessage: discordAdapter.sendMessage,
          },
        );
      } catch (err) {
        logger.error('Failed to start trade services', { error: String(err) });
      }

      if (dashboardService) {
        dashboardService.stop();
      }
      dashboardService = createDashboardService(
        tradeStorage,
        discordAdapter,
        config.tradeManagement.discordChannelId,
        config.tradeManagement.dashboardThrottleMs,
        logger,
      );
      if (!dashboardInteractionBound) {
        client.removeAllListeners('interactionCreate');
        client.on('interactionCreate', async (interaction: any) => {
          await routeInteraction(interaction, {
            logger,
            storage: storage!,
            channelToSymbol: {
              [config.ethChannelId]: 'ETHUSD',
              [config.solChannelId]: 'SOLUSD',
              [config.btcChannelId]: 'BTCUSD',
            },
            tradeStorage,
            levelStorage,
            tradeInteractionStorage,
          });
        });
        dashboardInteractionBound = true;
      }
      await dashboardService.initialize();
      if (dashboardInterval) {
        clearInterval(dashboardInterval);
      }
      dashboardInterval = setInterval(
        () => {
          if (dashboardService) {
            dashboardService.refresh().catch(() => {});
          }
        },
        Math.max(config.tradeManagement.dashboardThrottleMs, 5000),
      );
      logger.info('Trade dashboard initialized');
    } catch (err) {
      logger.error('Failed to initialize trade management', { error: String(err) });
    }
  }

  if (deltaClient) {
    deltaClient.connect();
    logger.info('Delta WebSocket connected');
  }

  logger.info('Bot started successfully');
  logger.info('Delta WebSocket URL', { url: config.deltaWsUrl });
  logger.info('Monitoring symbols', { symbols: config.deltaSymbols });
}

function shutdown(): void {
  const logger = createLogger('info');
  logger.info('Shutting down...');

  if (dashboardInterval) {
    clearInterval(dashboardInterval);
    dashboardInterval = null;
  }

  if (dashboardService) {
    dashboardService.stop();
    dashboardService = null;
  }

  if (levelMonitor) {
    levelMonitor.stop();
    levelMonitor = null;
  }

  if (tradeIntegration) {
    tradeIntegration.stop();
    tradeIntegration = null;
  }

  if (tradeServiceManager) {
    tradeServiceManager.stop();
    tradeServiceManager = null;
  }

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
  process.exit(0);
});
