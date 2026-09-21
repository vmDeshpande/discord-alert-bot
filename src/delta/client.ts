import { Logger } from '../logger';
import WebSocket from 'ws';

export interface DeltaConfig {
  wsUrl: string;
  symbols: string[];
  reconnectIntervalMs: number;
  maxReconnectIntervalMs: number;
}

export interface DeltaClient {
  connect: () => void;
  disconnect: () => void;
  isConnected: () => boolean;
  getLastPrice: (symbol: string) => { price: number; timestamp: number } | undefined;
  getLastUpdateTimestamp: () => number;
  getConnected: () => boolean;
}

export type PriceHandler = (symbol: string, price: number, timestamp: number) => void;

export function createDeltaClient(
  config: DeltaConfig,
  logger: Logger,
  onPrice: PriceHandler,
): DeltaClient {
  let ws: WebSocket | null = null;
  let connected = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPrices: Map<string, { price: number; timestamp: number }> = new Map();
  let lastUpdateTimestamp = 0;
  let shouldReconnect = true;

  function getReconnectDelay(): number {
    const base = config.reconnectIntervalMs;
    const max = config.maxReconnectIntervalMs;
    const attempts = (globalThis as any)._deltaReconnectAttempts || 0;
    return Math.min(base * Math.pow(2, attempts), max);
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

  function handleMessage(data: string): void {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'ticker' && msg.ticker) {
        const ticker = msg.ticker;
        const symbol = ticker.symbol || ticker.sy;
        const priceStr = ticker.close || ticker.sp || ticker.mark_price || ticker.mp;
        if (symbol && priceStr !== undefined) {
          const price = parseFloat(priceStr);
          if (Number.isFinite(price)) {
            const now = Date.now();
            lastPrices.set(symbol, { price, timestamp: now });
            lastUpdateTimestamp = now;
            onPrice(symbol, price, now);
          }
        }
      }
    } catch (err) {
      logger.debug('Failed to parse Delta message', { error: String(err) });
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

    try {
      logger.info('Connecting to Delta WebSocket', { url: config.wsUrl });
      ws = new WebSocket(config.wsUrl);

      ws.on('open', (): void => {
        connected = true;
        (globalThis as any)._deltaReconnectAttempts = 0;
        logger.info('Delta WebSocket connected');
        subscribeSymbols();
      });

      ws.on('message', (data: WebSocket.Data): void => {
        if (typeof data === 'string') {
          handleMessage(data);
        }
      });

      ws.on('close', (): void => {
        connected = false;
        logger.warn('Delta WebSocket disconnected');
        if (shouldReconnect) {
          const delay = getReconnectDelay();
          (globalThis as any)._deltaReconnectAttempts =
            ((globalThis as any)._deltaReconnectAttempts || 0) + 1;
          logger.info('Reconnecting to Delta in ' + Math.round(delay / 1000) + 's');
          reconnectTimer = setTimeout(connect, delay);
        }
      });

      ws.on('error', (err: Error): void => {
        logger.error('Delta WebSocket error', { error: err.message });
      });
    } catch (err) {
      logger.error('Failed to create Delta WebSocket', { error: String(err) });
      if (shouldReconnect) {
        const delay = getReconnectDelay();
        reconnectTimer = setTimeout(connect, delay);
      }
    }
  }

  function disconnect(): void {
    shouldReconnect = false;
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
    connected = false;
    logger.info('Delta WebSocket disconnected (manual)');
  }

  connect();

  return {
    connect: (): void => {
      shouldReconnect = true;
      connect();
    },
    disconnect,
    isConnected: (): boolean => connected,
    getLastPrice: (symbol: string): { price: number; timestamp: number } | undefined => {
      return lastPrices.get(symbol);
    },
    getLastUpdateTimestamp: (): number => lastUpdateTimestamp,
    getConnected: (): boolean => connected,
  };
}
