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

export interface ParsedTrade {
  symbol: string;
  price: number;
  timestamp: number;
}

const SUPPORTED_SYMBOLS = ['ETHUSD', 'SOLUSD'];

export function parseDeltaTrade(data: string): ParsedTrade | null {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }

  if (typeof msg !== 'object' || msg === null) return null;
  if (msg.type !== 'trades') return null;

  if (!SUPPORTED_SYMBOLS.includes(msg.sy as string)) return null;

  const symbol = typeof msg.sy === 'string' ? msg.sy : undefined;
  const priceStr = msg.p;

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
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let lastActivityTime = 0;

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
        payload: { channels: [{ name: 'trades', symbols: config.symbols }] },
      });
      ws.send(msg);
      logger.info('Subscribed to Delta trades', { symbols: config.symbols });
    } catch (err) {
      logger.error('Failed to send subscribe message', { error: String(err) });
    }
  }

  function handleMessage(raw: string): void {
    lastActivityTime = Date.now();
    const parsed = parseDeltaTrade(raw);
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

  function startHeartbeat(): void {
    stopHeartbeat();
    heartbeatTimer = setInterval((): void => {
      if (connectionState === 'connected') {
        const now = Date.now();
        if (now - lastActivityTime > 30000) {
          logger.warn('Delta WebSocket stale connection, reconnecting');
          if (ws) {
            try {
              ws.close();
            } catch {
              /* ignore */
            }
            ws = null;
          }
          setState('disconnected');
          if (!manualDisconnect) {
            const delay = getReconnectDelay();
            reconnectAttempts++;
            logger.info('Reconnecting to Delta in ' + Math.round(delay / 1000) + 's');
            setState('reconnecting');
            reconnectTimer = setTimeout(connect, delay);
          }
        }
      }
    }, 10000);
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function setState(state: ConnectionState): void {
    connectionState = state;
    if (state === 'connected') {
      reconnectAttempts = 0;
      startHeartbeat();
    } else {
      stopHeartbeat();
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
        let raw: string;
        if (typeof data === 'string') {
          raw = data;
        } else if (Buffer.isBuffer(data)) {
          raw = data.toString('utf-8');
        } else {
          return;
        }
        handleMessage(raw);
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
    stopHeartbeat();
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
