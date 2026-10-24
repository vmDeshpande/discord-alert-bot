import { Logger } from '../logger';

export interface TradeManagementConfig {
  enabled: boolean;
  demoMode: boolean;
  apiKey: string;
  apiSecret: string;
  apiBaseUrl: string;
  stopLossOffset: number;
  pollIntervalMs: number;
  discordChannelId: string;
  dashboardThrottleMs: number;
}

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
  tradeManagement: TradeManagementConfig;
}

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return value.trim().toLowerCase() === 'true';
}

function readNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = parseInt(value.trim(), 10);
  return Number.isFinite(n) ? n : fallback;
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

  const tradeEnabled = readBool(process.env.TRADE_MANAGEMENT_ENABLED, false);
  const tradeDemoMode = readBool(process.env.TRADE_DEMO_MODE, false);
  const apiKey = process.env.DELTA_API_KEY || '';
  const apiSecret = process.env.DELTA_API_SECRET || '';
  const apiBaseUrl = (process.env.DELTA_API_BASE_URL || 'https://api.india.delta.exchange').replace(
    /\/+$/,
    '',
  );
  const stopLossOffset = readNumber(process.env.TRADE_STOP_LOSS_OFFSET, 100);
  const pollIntervalMs = readNumber(process.env.TRADE_POLL_INTERVAL_MS, 30000);
  const tradeDiscordChannelId = (process.env.TRADE_DISCORD_CHANNEL_ID || '').trim();
  const dashboardThrottleMs = readNumber(process.env.TRADE_DASHBOARD_THROTTLE_MS, 5000);

  if (tradeEnabled) {
    if (!apiKey || !apiSecret) {
      throw new Error(
        'Trade management is enabled (TRADE_MANAGEMENT_ENABLED=true) but DELTA_API_KEY or DELTA_API_SECRET is missing.',
      );
    }
    if (stopLossOffset <= 0) {
      throw new Error('TRADE_STOP_LOSS_OFFSET must be a positive number.');
    }
    if (pollIntervalMs < 1000) {
      throw new Error('TRADE_POLL_INTERVAL_MS must be at least 1000.');
    }
    if (dashboardThrottleMs < 1000) {
      throw new Error('TRADE_DASHBOARD_THROTTLE_MS must be at least 1000.');
    }
    if (!tradeDiscordChannelId) {
      throw new Error(
        'TRADE_DISCORD_CHANNEL_ID must be configured for trade management dashboard (no fallback to alert channels).',
      );
    }
  }

  const tradeManagement: TradeManagementConfig = {
    enabled: tradeEnabled,
    demoMode: tradeDemoMode,
    apiKey,
    apiSecret,
    apiBaseUrl,
    stopLossOffset,
    pollIntervalMs,
    discordChannelId: tradeDiscordChannelId,
    dashboardThrottleMs,
  };

  logger.info('Configuration loaded', {
    databasePath,
    deltaSymbols,
    deltaWsUrl,
    logLevel,
    ethChannelId,
    solChannelId,
    btcChannelId,
    tradeManagementEnabled: tradeManagement.enabled,
    tradeDemoMode: tradeManagement.demoMode,
    tradeApiBaseUrl: tradeManagement.apiBaseUrl,
    tradeStopLossOffset: tradeManagement.stopLossOffset,
    tradeDiscordChannelId: tradeManagement.discordChannelId,
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
    tradeManagement,
  };
}
