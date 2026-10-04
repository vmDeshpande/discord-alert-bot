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
  btcChannelId: string;
}

export function loadConfig(logger: Logger): AppConfig {
  const discordToken = process.env.DISCORD_BOT_TOKEN || '';
  const databasePath = process.env.DATABASE_PATH || './alerts.db';
  const logLevel = process.env.LOG_LEVEL || 'info';

  const deltaWsUrl = process.env.DELTA_WS_URL || 'wss://public-socket.india.delta.exchange';
  const deltaSymbols = ['ETHUSD', 'SOLUSD', 'BTCUSD'];
  const deltaReconnectIntervalMs = parseInt(process.env.DELTA_RECONNECT_INTERVAL_MS || '2000', 10);
  const deltaMaxReconnectIntervalMs = parseInt(
    process.env.DELTA_MAX_RECONNECT_INTERVAL_MS || '60000',
    10,
  );

  const ethChannelId = process.env.ETHUSD_CHANNEL_ID || '';
  const solChannelId = process.env.SOLUSD_CHANNEL_ID || '';
  const btcChannelId = process.env.BTCUSD_CHANNEL_ID || '';

  if (!discordToken) {
    logger.error('DISCORD_BOT_TOKEN is not set');
  }

  const channelIds: Array<[string, string]> = [
    ['ETHUSD_CHANNEL_ID', ethChannelId],
    ['SOLUSD_CHANNEL_ID', solChannelId],
    ['BTCUSD_CHANNEL_ID', btcChannelId],
  ];

  const missing = channelIds.filter(([, value]) => value.trim() === '').map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `Missing required channel configuration: ${missing.join(', ')} must be set to a Discord channel ID. ` +
        'Each symbol (ETHUSD, SOLUSD, BTCUSD) requires its own channel.',
    );
  }

  const byValue = new Map<string, string[]>();
  for (const [name, value] of channelIds) {
    const names = byValue.get(value) ?? [];
    names.push(name);
    byValue.set(value, names);
  }
  const duplicates = [...byValue.values()].filter((names) => names.length > 1);
  if (duplicates.length > 0) {
    const described = duplicates
      .map((names) => names.join(', ').replace(/, ([^,]+)$/, ' and $1'))
      .join('; ');
    throw new Error(
      `Duplicate channel configuration: ${described} resolve to the same Discord channel ID. ` +
        'Each symbol (ETHUSD, SOLUSD, BTCUSD) must use a different channel.',
    );
  }

  logger.info('Configuration loaded', {
    databasePath,
    deltaSymbols,
    deltaWsUrl,
    logLevel,
    ethChannelId,
    solChannelId,
    btcChannelId,
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
    btcChannelId,
  };
}
