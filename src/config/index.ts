import { Logger } from '../logger';

export interface AppConfig {
  discordToken: string;
  databasePath: string;
  logLevel: string;
  deltaWsUrl: string;
  deltaSymbols: string[];
  deltaReconnectIntervalMs: number;
  deltaMaxReconnectIntervalMs: number;
  ethChannelId: string;
  solChannelId: string;
}

export function loadConfig(logger: Logger): AppConfig {
  const discordToken = process.env.DISCORD_BOT_TOKEN || '';
  const databasePath = process.env.DATABASE_PATH || './alerts.db';
  const logLevel = process.env.LOG_LEVEL || 'info';

  const deltaWsUrl = process.env.DELTA_WS_URL || 'wss://public-socket.india.delta.exchange';
  const deltaSymbols = ['ETHUSD', 'SOLUSD'];
  const deltaReconnectIntervalMs = parseInt(process.env.DELTA_RECONNECT_INTERVAL_MS || '2000', 10);
  const deltaMaxReconnectIntervalMs = parseInt(
    process.env.DELTA_MAX_RECONNECT_INTERVAL_MS || '60000',
    10,
  );

  const ethChannelId = process.env.ETHUSD_CHANNEL_ID || '';
  const solChannelId = process.env.SOLUSD_CHANNEL_ID || '';

  if (!discordToken) {
    logger.error('DISCORD_BOT_TOKEN is not set');
  }

  if (!ethChannelId || !solChannelId) {
    logger.error('ETHUSD_CHANNEL_ID and SOLUSD_CHANNEL_ID must be set');
  }

  logger.info('Configuration loaded', {
    databasePath,
    deltaSymbols,
    deltaWsUrl,
    logLevel,
    ethChannelId,
    solChannelId,
  });

  return {
    discordToken,
    databasePath,
    logLevel,
    deltaWsUrl,
    deltaSymbols,
    deltaReconnectIntervalMs,
    deltaMaxReconnectIntervalMs,
    ethChannelId,
    solChannelId,
  };
}
