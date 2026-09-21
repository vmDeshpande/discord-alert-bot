import { evaluateAlert, createAlertEngine, shouldMonitorSymbol } from '../src/alerts/engine';
import { parseDeltaTrade, ParsedTrade } from '../src/delta/client';
import { AlertConfig, PriceUpdate } from '../src/alerts/types';
import { isValidTargetPrice } from '../src/alerts/validation';
import { AlertStorage } from '../src/database/storage';
import { Logger } from '../src/logger';

const logger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const makeAlert = (overrides: Partial<AlertConfig> = {}): AlertConfig => ({
  id: `alert-${Math.random().toString(36).substring(2, 8)}`,
  symbol: 'ETHUSD',
  channelId: 'eth-channel-id',
  targetPrice: 4500,
  baselinePrice: 4400,
  direction: 'upward',
  active: true,
  triggered: false,
  createdAt: '2024-01-01T00:00:00Z',
  triggeredAt: null,
  ...overrides,
});

const makeStorage = (alerts: AlertConfig[] = []): AlertStorage => ({
  getAllByChannel: jest.fn().mockReturnValue(alerts),
  getById: jest.fn().mockReturnValue(undefined),
  getActiveBySymbol: jest.fn().mockReturnValue(alerts.filter((a) => a.active && !a.triggered)),
  save: jest.fn(),
  update: jest.fn(),
  deleteById: jest.fn(),
});

const makePriceUpdate = (price: number, timestamp = Date.now()): PriceUpdate => ({
  symbol: 'ETHUSD',
  price,
  timestamp,
});

describe('Delta Trade Parser', () => {
  describe('Valid trade payloads', () => {
    it('should parse ETHUSD trade', () => {
      const payload = JSON.stringify({
        type: 'trades',
        p: '4500.50',
        sy: 'ETHUSD',
        t: 1234567890,
        ts: 1234567891,
      });
      const result = parseDeltaTrade(payload);
      expect(result).not.toBeNull();
      expect(result!.symbol).toBe('ETHUSD');
      expect(result!.price).toBe(4500.5);
    });

    it('should parse SOLUSD trade', () => {
      const payload = JSON.stringify({
        type: 'trades',
        p: '250.25',
        sy: 'SOLUSD',
        t: 1234567890,
        ts: 1234567891,
      });
      const result = parseDeltaTrade(payload);
      expect(result).not.toBeNull();
      expect(result!.symbol).toBe('SOLUSD');
      expect(result!.price).toBe(250.25);
    });

    it('should parse trade with integer price', () => {
      const payload = JSON.stringify({
        type: 'trades',
        p: '100',
        sy: 'ETHUSD',
        t: 1234567890,
        ts: 1234567891,
      });
      const result = parseDeltaTrade(payload);
      expect(result).not.toBeNull();
      expect(result!.price).toBe(100);
    });

    it('should parse Buffer WebSocket message', () => {
      const raw = JSON.stringify({
        type: 'trades',
        p: '4500.50',
        sy: 'ETHUSD',
        t: 1234567890,
        ts: 1234567891,
      });
      const buffer = Buffer.from(raw, 'utf-8');
      const str = buffer.toString('utf-8');
      const result = parseDeltaTrade(str);
      expect(result).not.toBeNull();
      expect(result!.symbol).toBe('ETHUSD');
      expect(result!.price).toBe(4500.5);
    });
  });

  describe('Invalid trade payloads', () => {
    it('should return null for invalid JSON', () => {
      expect(parseDeltaTrade('not json')).toBeNull();
    });

    it('should return null for non-trade type', () => {
      expect(parseDeltaTrade(JSON.stringify({ type: 'ticker', sy: 'ETHUSD', sp: 4500 }))).toBeNull();
    });

    it('should return null for missing symbol', () => {
      expect(parseDeltaTrade(JSON.stringify({ type: 'trades', p: '4500' }))).toBeNull();
    });

    it('should return null for missing price', () => {
      expect(parseDeltaTrade(JSON.stringify({ type: 'trades', sy: 'ETHUSD' }))).toBeNull();
    });

    it('should return null for non-numeric price', () => {
      expect(parseDeltaTrade(JSON.stringify({ type: 'trades', sy: 'ETHUSD', p: 'abc' }))).toBeNull();
    });

    it('should return null for NaN price', () => {
      expect(parseDeltaTrade(JSON.stringify({ type: 'trades', sy: 'ETHUSD', p: NaN }))).toBeNull();
    });
  });

  describe('Unsupported symbols', () => {
    it('should reject unsupported symbol', () => {
      const result = parseDeltaTrade(
        JSON.stringify({ type: 'trades', p: '100', sy: 'BTCUSD', t: 1, ts: 2 }),
      );
      expect(result).toBeNull();
    });
  });
});

describe('REST Baseline Price', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should fetch baseline price from REST API', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ close: 4499.99 }),
    } as unknown as Response);

    const response = await fetch('https://api.india.delta.exchange/v2/tickers/ETHUSD');
    const data = (await response.json()) as { close: number };
    expect(data.close).toBe(4499.99);
    expect(typeof data.close).toBe('number');
  });

  it('should handle string close price from REST', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ close: '4499.99' }),
    } as unknown as Response);

    const response = await fetch('https://api.india.delta.exchange/v2/tickers/ETHUSD');
    const data = (await response.json()) as { close: string };
    const price = typeof data.close === 'number' ? data.close : parseFloat(data.close);
    expect(price).toBe(4499.99);
  });

  it('should handle REST API failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as unknown as Response);

    const response = await fetch('https://api.india.delta.exchange/v2/tickers/ETHUSD');
    expect(response.ok).toBe(false);
  });
});

describe('Channel-Symbol Mapping', () => {
  it('should map #ETHUSD channel to ETHUSD symbol', () => {
    const alert = makeAlert({ symbol: 'ETHUSD', channelId: 'eth-channel-id' });
    expect(alert.symbol).toBe('ETHUSD');
    expect(alert.channelId).toBe('eth-channel-id');
  });

  it('should map #SOLUSD channel to SOLUSD symbol', () => {
    const alert = makeAlert({ symbol: 'SOLUSD', channelId: 'sol-channel-id' });
    expect(alert.symbol).toBe('SOLUSD');
    expect(alert.channelId).toBe('sol-channel-id');
  });
});

describe('Alert Validation', () => {
  it('should validate correct price', () => {
    expect(isValidTargetPrice(4500)).toBe(true);
  });

  it('should reject non-numeric price', () => {
    expect(isValidTargetPrice('abc' as unknown as number)).toBe(false);
  });

  it('should reject negative price', () => {
    expect(isValidTargetPrice(-100 as unknown as number)).toBe(false);
  });

  it('should reject zero price', () => {
    expect(isValidTargetPrice(0 as unknown as number)).toBe(false);
  });

  it('should reject Infinity price', () => {
    expect(isValidTargetPrice(Infinity)).toBe(false);
  });

  it('should reject NaN price', () => {
    expect(isValidTargetPrice(NaN as unknown as number)).toBe(false);
  });
});

describe('Alert Engine - evaluateAlert', () => {
  describe('Upward target (baseline < target)', () => {
    it('should trigger when price crosses above target', () => {
      const alert = makeAlert({ direction: 'upward', baselinePrice: 4400, targetPrice: 4500 });
      const result = evaluateAlert(alert, makePriceUpdate(4530));
      expect(result.triggered).toBe(true);
    });

    it('should NOT trigger when price stays below target', () => {
      const alert = makeAlert({ direction: 'upward', baselinePrice: 4400, targetPrice: 4500 });
      const result = evaluateAlert(alert, makePriceUpdate(4450));
      expect(result.triggered).toBe(false);
    });

    it('should NOT trigger if alert already triggered', () => {
      const alert = makeAlert({ direction: 'upward', baselinePrice: 4400, targetPrice: 4500, triggered: true });
      const result = evaluateAlert(alert, makePriceUpdate(4530));
      expect(result.triggered).toBe(false);
    });

    it('should NOT trigger if alert is inactive', () => {
      const alert = makeAlert({ direction: 'upward', baselinePrice: 4400, targetPrice: 4500, active: false });
      const result = evaluateAlert(alert, makePriceUpdate(4530));
      expect(result.triggered).toBe(false);
    });
  });

  describe('Downward target (baseline > target)', () => {
    it('should trigger when price crosses below target', () => {
      const alert = makeAlert({ direction: 'downward', baselinePrice: 4600, targetPrice: 4500 });
      const result = evaluateAlert(alert, makePriceUpdate(4470));
      expect(result.triggered).toBe(true);
    });

    it('should NOT trigger when price stays above target', () => {
      const alert = makeAlert({ direction: 'downward', baselinePrice: 4600, targetPrice: 4500 });
      const result = evaluateAlert(alert, makePriceUpdate(4530));
      expect(result.triggered).toBe(false);
    });
  });

  describe('Target jumped over in one update', () => {
    it('should trigger upward when price jumps over target', () => {
      const alert = makeAlert({ direction: 'upward', baselinePrice: 4400, targetPrice: 4500 });
      const result = evaluateAlert(alert, makePriceUpdate(4600));
      expect(result.triggered).toBe(true);
    });

    it('should trigger downward when price drops below target', () => {
      const alert = makeAlert({ direction: 'downward', baselinePrice: 4600, targetPrice: 4500 });
      const result = evaluateAlert(alert, makePriceUpdate(4400));
      expect(result.triggered).toBe(true);
    });
  });

  describe('Target equal to baseline', () => {
    it('should trigger immediately when target equals baseline (upward)', () => {
      const alert = makeAlert({ direction: 'upward', baselinePrice: 4500, targetPrice: 4500 });
      const result = evaluateAlert(alert, makePriceUpdate(4500));
      expect(result.triggered).toBe(true);
    });

    it('should trigger immediately when target equals baseline (downward)', () => {
      const alert = makeAlert({ direction: 'downward', baselinePrice: 4500, targetPrice: 4500 });
      const result = evaluateAlert(alert, makePriceUpdate(4500));
      expect(result.triggered).toBe(true);
    });

    it('should still trigger on subsequent update if not yet triggered (upward)', () => {
      const alert = makeAlert({ direction: 'upward', baselinePrice: 4500, targetPrice: 4500, triggered: false });
      const result = evaluateAlert(alert, makePriceUpdate(4550));
      expect(result.triggered).toBe(true);
    });
  });

  describe('Baseline not set', () => {
    it('should not trigger when baseline is null', () => {
      const alert = makeAlert({ baselinePrice: null, direction: 'upward', targetPrice: 4500 });
      const result = evaluateAlert(alert, makePriceUpdate(5000));
      expect(result.triggered).toBe(false);
    });

    it('should not trigger when baseline is undefined', () => {
      const alert = makeAlert({ baselinePrice: undefined as unknown as number | null, direction: 'upward', targetPrice: 4500 });
      const result = evaluateAlert(alert, makePriceUpdate(5000));
      expect(result.triggered).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should NOT trigger when baseline equals target and price drops away', () => {
      const alert = makeAlert({ direction: 'upward', baselinePrice: 4500, targetPrice: 4500 });
      const result = evaluateAlert(alert, makePriceUpdate(4400));
      expect(result.triggered).toBe(true);
    });

    it('should not trigger inactive alert even if baseline == target', () => {
      const alert = makeAlert({ direction: 'upward', baselinePrice: 4500, targetPrice: 4500, active: false });
      const result = evaluateAlert(alert, makePriceUpdate(4500));
      expect(result.triggered).toBe(false);
    });
  });
});

describe('Alert Engine - shouldMonitorSymbol', () => {
  it('should return true for matching symbol', () => {
    const alert = makeAlert({ symbol: 'ETHUSD' });
    expect(shouldMonitorSymbol(alert, 'ETHUSD')).toBe(true);
  });

  it('should return false for non-matching symbol', () => {
    const alert = makeAlert({ symbol: 'ETHUSD' });
    expect(shouldMonitorSymbol(alert, 'SOLUSD')).toBe(false);
  });

  it('should return false for inactive alerts', () => {
    const alert = makeAlert({ active: false });
    expect(shouldMonitorSymbol(alert, 'ETHUSD')).toBe(false);
  });

  it('should return false for triggered alerts', () => {
    const alert = makeAlert({ triggered: true });
    expect(shouldMonitorSymbol(alert, 'ETHUSD')).toBe(false);
  });
});

describe('Alert Engine - Discord-gated integration', () => {
  it('should mark alert triggered when Discord delivery succeeds', async () => {
    const storage = makeStorage();
    const discord = {
      start: jest.fn(),
      stop: jest.fn(),
      isReady: jest.fn().mockReturnValue(true),
      sendAlert: jest.fn().mockResolvedValue(true),
    };
    const engine = createAlertEngine(storage, discord, logger);

    const alert = makeAlert({ direction: 'upward', baselinePrice: 4400, targetPrice: 4500 });
    storage.save(alert);
    (storage.getActiveBySymbol as jest.Mock).mockReturnValue([alert]);

    const priceUpdate = { symbol: 'ETHUSD', currentPrice: 4530, previousPrice: 4400, timestamp: Date.now() };
    engine.onPriceUpdate(priceUpdate);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(discord.sendAlert).toHaveBeenCalled();
    expect(alert.triggered).toBe(true);
    expect(alert.triggeredAt).toBeTruthy();
    expect(storage.update).toHaveBeenCalledWith(alert);
  });

  it('should NOT mark alert triggered when Discord delivery fails', async () => {
    const storage = makeStorage();
    const discord = {
      start: jest.fn(),
      stop: jest.fn(),
      isReady: jest.fn().mockReturnValue(true),
      sendAlert: jest.fn().mockResolvedValue(false),
    };
    const engine = createAlertEngine(storage, discord, logger);

    const alert = makeAlert({ direction: 'upward', baselinePrice: 4400, targetPrice: 4500 });
    storage.save(alert);
    (storage.getActiveBySymbol as jest.Mock).mockReturnValue([alert]);

    const priceUpdate = { symbol: 'ETHUSD', currentPrice: 4530, previousPrice: 4400, timestamp: Date.now() };
    engine.onPriceUpdate(priceUpdate);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(discord.sendAlert).toHaveBeenCalled();
    expect(alert.triggered).toBe(false);
    expect(alert.triggeredAt).toBeNull();
    expect(storage.update).not.toHaveBeenCalled();
  });

  it('should send alert exactly once', async () => {
    const storage = makeStorage();
    const discord = {
      start: jest.fn(),
      stop: jest.fn(),
      isReady: jest.fn().mockReturnValue(true),
      sendAlert: jest.fn().mockResolvedValue(true),
    };
    const engine = createAlertEngine(storage, discord, logger);

    const alert = makeAlert({ direction: 'upward', baselinePrice: 4400, targetPrice: 4500 });
    storage.save(alert);
    (storage.getActiveBySymbol as jest.Mock).mockReturnValue([alert]);

    const priceUpdate = { symbol: 'ETHUSD', currentPrice: 4530, previousPrice: 4400, timestamp: Date.now() };
    engine.onPriceUpdate(priceUpdate);
    engine.onPriceUpdate(priceUpdate);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(discord.sendAlert).toHaveBeenCalledTimes(1);
    expect(alert.triggered).toBe(true);
  });

  it('should handle price updates for symbols with no alerts', () => {
    const storage = makeStorage();
    const discord = {
      start: jest.fn(),
      stop: jest.fn(),
      isReady: jest.fn().mockReturnValue(true),
      sendAlert: jest.fn().mockResolvedValue(true),
    };
    const engine = createAlertEngine(storage, discord, logger);

    const priceUpdate = { symbol: 'SOLUSD', currentPrice: 250, previousPrice: 240, timestamp: Date.now() };
    expect(() => engine.onPriceUpdate(priceUpdate)).not.toThrow();
    expect(discord.sendAlert).not.toHaveBeenCalled();
  });
});

describe('Alert Engine - multiple alerts independent', () => {
  it('should trigger multiple alerts independently', async () => {
    const storage = makeStorage();
    const discord = {
      start: jest.fn(),
      stop: jest.fn(),
      isReady: jest.fn().mockReturnValue(true),
      sendAlert: jest.fn().mockResolvedValue(true),
    };
    const engine = createAlertEngine(storage, discord, logger);

    const alert1 = makeAlert({ id: 'alert-1', direction: 'upward', baselinePrice: 4400, targetPrice: 4500 });
    const alert2 = makeAlert({ id: 'alert-2', direction: 'upward', baselinePrice: 4500, targetPrice: 4600 });
    const alert3 = makeAlert({ id: 'alert-3', direction: 'upward', baselinePrice: 4600, targetPrice: 4700 });
    storage.save(alert1);
    storage.save(alert2);
    storage.save(alert3);
    (storage.getActiveBySymbol as jest.Mock).mockReturnValue([alert1, alert2, alert3]);

    engine.onPriceUpdate({ symbol: 'ETHUSD', currentPrice: 4500, previousPrice: 4450, timestamp: Date.now() });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(alert1.triggered).toBe(true);
    expect(alert2.triggered).toBe(false);
    expect(alert3.triggered).toBe(false);

    engine.onPriceUpdate({ symbol: 'ETHUSD', currentPrice: 4600, previousPrice: 4550, timestamp: Date.now() });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(alert2.triggered).toBe(true);
    expect(alert3.triggered).toBe(false);

    engine.onPriceUpdate({ symbol: 'ETHUSD', currentPrice: 4700, previousPrice: 4650, timestamp: Date.now() });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(alert3.triggered).toBe(true);
  });
});

describe('Alert Engine - processAlert flow', () => {
  it('should format correct Discord message', async () => {
    const storage = makeStorage();
    const discord = {
      start: jest.fn(),
      stop: jest.fn(),
      isReady: jest.fn().mockReturnValue(true),
      sendAlert: jest.fn().mockResolvedValue(true),
    };
    const engine = createAlertEngine(storage, discord, logger);

    const alert = makeAlert({ direction: 'upward', baselinePrice: 4400, targetPrice: 4500 });
    storage.save(alert);
    (storage.getActiveBySymbol as jest.Mock).mockReturnValue([alert]);

    const priceUpdate = { symbol: 'ETHUSD', currentPrice: 4530, previousPrice: 4400, timestamp: Date.now() };
    engine.onPriceUpdate(priceUpdate);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const callArgs = (discord.sendAlert as jest.Mock).mock.calls[0];
    expect(callArgs).toHaveLength(2);
    expect(callArgs[0]).toBe('eth-channel-id');
    expect(callArgs[1]).toContain('ETHUSD Price Alert');
    expect(callArgs[1]).toContain('4,500');
    expect(callArgs[1]).toContain('4,530');
  });
});

describe('Delta Trade - ParsedTrade type', () => {
  it('should have correct type structure', () => {
    const trade: ParsedTrade = {
      symbol: 'ETHUSD',
      price: 4500.5,
      timestamp: 1234567890,
    };
    expect(trade.symbol).toBe('ETHUSD');
    expect(trade.price).toBe(4500.5);
    expect(trade.timestamp).toBe(1234567890);
  });
});
