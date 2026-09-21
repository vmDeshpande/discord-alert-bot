import { Logger } from '../logger';
import WebSocket from 'ws';

export interface DeltaConfig {
  wsUrl: string;
  symbols: string[];
  reconnectIntervalMs: number;
  maxReconnectIntervalMs: number;
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export interface PriceSnapshot {
  price: number;
  timestamp: number;
}

export interface PriceUpdatePayload {
  symbol: string;
  currentPrice: number;
  previousPrice: number | null;
  timestamp: number;
}

export type PriceHandler = (payload: PriceUpdatePayload) => void;

export interface DeltaClient {
  connect: () => void;
  disconnect: () => void;
  isConnected: () => boolean;
  getConnectionState: () => ConnectionState;
  getPrice: (symbol: string) => PriceSnapshot | undefined;
  getPreviousPrice: (symbol: string) => PriceSnapshot | undefined;
  getLastUpdateTimestamp: () => number;
  getMonitoredSymbols: () => string[];
}

export interface ParsedTicker {
  symbol: string;
  price: number;
  timestamp: number;
}

export function parseDeltaTicker(data: string): ParsedTicker | null {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }

  if (typeof msg !== 'object' || msg === null) return null;
  if (msg.type !== 'ticker') return null;

  let symbol: string | undefined;
  let priceStr: string | number | undefined;

  if (msg.sy !== undefined && msg.sp !== undefined) {
    symbol = typeof msg.sy === 'string' ? msg.sy : undefined;
    priceStr = typeof msg.sp === 'string' || typeof msg.sp === 'number' ? msg.sp : undefined;
  } else if (msg.ticker !== undefined && typeof msg.ticker === 'object') {
    const ticker = msg.ticker as Record<string, unknown>;
    symbol =
      typeof ticker.symbol === 'string'
        ? ticker.symbol
        : typeof ticker.sy === 'string'
          ? ticker.sy
          : undefined;
    const close = ticker.close;
    priceStr =
      typeof close === 'string' || typeof close === 'number'
        ? close
        : typeof ticker.sp === 'string' || typeof ticker.sp === 'number'
          ? ticker.sp
          : typeof ticker.mark_price === 'string' || typeof ticker.mark_price === 'number'
            ? ticker.mark_price
            : typeof ticker.mp === 'string' || typeof ticker.mp === 'number'
              ? ticker.mp
              : undefined;
  }

  if (!symbol) return null;
  if (priceStr === undefined || priceStr === null) return null;

  const price = typeof priceStr === 'number' ? priceStr : parseFloat(String(priceStr));
  if (!Number.isFinite(price)) return null;

  return { symbol, price, timestamp: Date.now() };
}

export function createDeltaClient(
  config: DeltaConfig,
  logger: Logger,
  onPrice: PriceHandler,
): DeltaClient {
  let ws: WebSocket | null = null;
  let connectionState: ConnectionState = 'disconnected';
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let priceHistory: Map<string, { previous: PriceSnapshot | undefined; current: PriceSnapshot }> =
    new Map();
  let lastUpdateTimestamp = 0;
  let manualDisconnect = false;

  function getReconnectDelay(): number {
    const base = config.reconnectIntervalMs;
    const max = config.maxReconnectIntervalMs;
    const delay = Math.min(base * Math.pow(2, reconnectAttempts), max);
    return delay;
  }

  function subscribeSymbols(): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      const msg = JSON.stringify({
        type: 'subscribe',
        payload: { channels: [{ name: 'ticker', symbols: config.symbols }] },
      });
      ws.send(msg);
      logger.info('Subscribed to Delta ticker', { symbols: config.symbols });
    } catch (err) {
      logger.error('Failed to send subscribe message', { error: String(err) });
    }
  }

  function handleMessage(raw: string): void {
    const parsed = parseDeltaTicker(raw);
    if (!parsed) return;

    const entry = priceHistory.get(parsed.symbol);
    const previous = entry?.current;

    priceHistory.set(parsed.symbol, {
      previous,
      current: { price: parsed.price, timestamp: parsed.timestamp },
    });

    lastUpdateTimestamp = parsed.timestamp;
    onPrice({
      symbol: parsed.symbol,
      currentPrice: parsed.price,
      previousPrice: previous?.price ?? null,
      timestamp: parsed.timestamp,
    });
  }

  function setState(state: ConnectionState): void {
    connectionState = state;
    if (state === 'connected') {
      reconnectAttempts = 0;
    }
  }

  function connect(): void {
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      ws = null;
    }

    setState('connecting');

    try {
      logger.info('Connecting to Delta WebSocket', { url: config.wsUrl });
      ws = new WebSocket(config.wsUrl);

      ws.on('open', (): void => {
        setState('connected');
        logger.info('Delta WebSocket connected');
        subscribeSymbols();
      });

      ws.on('message', (data: WebSocket.Data): void => {
        if (typeof data === 'string') {
          handleMessage(data);
        }
      });

      ws.on('close', (): void => {
        setState('disconnected');
        logger.warn('Delta WebSocket disconnected');
        if (!manualDisconnect) {
          const delay = getReconnectDelay();
          reconnectAttempts++;
          logger.info('Reconnecting to Delta in ' + Math.round(delay / 1000) + 's');
          setState('reconnecting');
          reconnectTimer = setTimeout(connect, delay);
        }
      });

      ws.on('error', (err: Error): void => {
        logger.error('Delta WebSocket error', { error: err.message });
      });
    } catch (err) {
      logger.error('Failed to create Delta WebSocket', { error: String(err) });
      setState('disconnected');
      if (!manualDisconnect) {
        const delay = getReconnectDelay();
        reconnectTimer = setTimeout(connect, delay);
      }
    }
  }

  function disconnect(): void {
    manualDisconnect = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      ws = null;
    }
    setState('disconnected');
    logger.info('Delta WebSocket disconnected (manual)');
  }

  return {
    connect: (): void => {
      manualDisconnect = false;
      connect();
    },
    disconnect,
    isConnected: (): boolean => connectionState === 'connected',
    getConnectionState: (): ConnectionState => connectionState,
    getPrice: (symbol: string): PriceSnapshot | undefined => priceHistory.get(symbol)?.current,
    getPreviousPrice: (symbol: string): PriceSnapshot | undefined =>
      priceHistory.get(symbol)?.previous,
    getLastUpdateTimestamp: (): number => lastUpdateTimestamp,
    getMonitoredSymbols: (): string[] => [...config.symbols],
  };
}
