import { evaluateAlert, shouldMonitorSymbol, createAlertEngine } from '../src/alerts/engine';
import { parseDeltaTicker, PriceUpdatePayload } from '../src/delta/client';
import { AlertConfig, PriceUpdate } from '../src/alerts/types';
import { validateAlertInput } from '../src/alerts/validation';
import { DiscordClient } from '../src/discord/client';
import { AlertStorage } from '../src/database/storage';
import { Logger } from '../src/logger';

const logger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

describe('Delta Ticker Parser', () => {
  describe('Compact format', () => {
    it('should parse compact ticker format', () => {
      const result = parseDeltaTicker(JSON.stringify({ type: 'ticker', sy: 'BTCUSD', sp: 100000 }));
      expect(result).not.toBeNull();
      expect(result!.symbol).toBe('BTCUSD');
      expect(result!.price).toBe(100000);
    });

    it('should parse compact ticker with string price', () => {
      const result = parseDeltaTicker(JSON.stringify({ type: 'ticker', sy: 'BTCUSD', sp: '100000.50' }));
      expect(result).not.toBeNull();
      expect(result!.symbol).toBe('BTCUSD');
      expect(result!.price).toBe(100000.50);
    });

    it('should parse compact ticker with zero price', () => {
      const result = parseDeltaTicker(JSON.stringify({ type: 'ticker', sy: 'BTCUSD', sp: 0 }));
      expect(result).not.toBeNull();
      expect(result!.price).toBe(0);
    });
  });

  describe('Nested format (new)', () => {
    it('should parse nested ticker with close field', () => {
      const result = parseDeltaTicker(JSON.stringify({ type: 'ticker', ticker: { symbol: 'BTCUSD', close: 95000 } }));
      expect(result).not.toBeNull();
      expect(result!.symbol).toBe('BTCUSD');
      expect(result!.price).toBe(95000);
    });

    it('should parse nested ticker with sp field', () => {
      const result = parseDeltaTicker(JSON.stringify({ type: 'ticker', ticker: { sy: 'ETHUSD', sp: '3500.25' } }));
      expect(result).not.toBeNull();
      expect(result!.symbol).toBe('ETHUSD');
      expect(result!.price).toBe(3500.25);
    });

    it('should parse nested ticker with mark_price field', () => {
      const result = parseDeltaTicker(JSON.stringify({ type: 'ticker', ticker: { symbol: 'BTCUSD', mark_price: 99500.75 } }));
      expect(result).not.toBeNull();
      expect(result!.price).toBe(99500.75);
    });

    it('should parse nested ticker with mp field', () => {
      const result = parseDeltaTicker(JSON.stringify({ type: 'ticker', ticker: { sy: 'ETHUSD', mp: 3499 } }));
      expect(result).not.toBeNull();
      expect(result!.symbol).toBe('ETHUSD');
      expect(result!.price).toBe(3499);
    });
  });

  describe('Invalid inputs', () => {
    it('should return null for invalid JSON', () => {
      const result = parseDeltaTicker('not json');
      expect(result).toBeNull();
    });

    it('should return null for non-ticker type', () => {
      const result = parseDeltaTicker(JSON.stringify({ type: 'trade', sy: 'BTCUSD', sp: 100000 }));
      expect(result).toBeNull();
    });

    it('should return null for empty object', () => {
      const result = parseDeltaTicker(JSON.stringify({}));
      expect(result).toBeNull();
    });

    it('should return null for null input', () => {
      const result = parseDeltaTicker('null');
      expect(result).toBeNull();
    });

    it('should return null when symbol is missing', () => {
      const result = parseDeltaTicker(JSON.stringify({ type: 'ticker', sp: 100000 }));
      expect(result).toBeNull();
    });

    it('should return null when price is missing', () => {
      const result = parseDeltaTicker(JSON.stringify({ type: 'ticker', sy: 'BTCUSD' }));
      expect(result).toBeNull();
    });

    it('should return null for non-numeric price', () => {
      const result = parseDeltaTicker(JSON.stringify({ type: 'ticker', sy: 'BTCUSD', sp: 'not-a-number' }));
      expect(result).toBeNull();
    });

    it('should return null for NaN price', () => {
      const result = parseDeltaTicker(JSON.stringify({ type: 'ticker', sy: 'BTCUSD', sp: NaN }));
      expect(result).toBeNull();
    });
  });
});

describe('Alert Engine - evaluateAlert', () => {
  const baseAlert: AlertConfig = {
    id: 'test-alert-1',
    symbol: 'BTCUSD',
    condition: 'crossed_above',
    targetPrice: 100000,
    discordChannelId: '123456789012345678',
    enabled: true,
    triggered: false,
    createdAt: '2024-01-01T00:00:00Z',
    triggeredAt: null,
  };

  const makePriceUpdate = (price: number, timestamp = Date.now()): PriceUpdate => ({
    symbol: 'BTCUSD',
    price,
    timestamp,
  });

  describe('Price crosses above target', () => {
    it('should trigger when price crosses above target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'crossed_above' };
      const result = evaluateAlert(alert, makePriceUpdate(100020), 99950);
      expect(result.triggered).toBe(true);
    });

    it('should not trigger when price is already above target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'crossed_above' };
      const result = evaluateAlert(alert, makePriceUpdate(100020), 100050);
      expect(result.triggered).toBe(false);
    });

    it('should not trigger when price is below target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'crossed_above' };
      const result = evaluateAlert(alert, makePriceUpdate(99900), 99950);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Price crosses below target', () => {
    it('should trigger when price crosses below target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'crossed_below' };
      const result = evaluateAlert(alert, makePriceUpdate(99980), 100050);
      expect(result.triggered).toBe(true);
    });

    it('should not trigger when price is already below target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'crossed_below' };
      const result = evaluateAlert(alert, makePriceUpdate(99900), 99800);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Price reaches or above target', () => {
    it('should trigger when price reaches target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'reaches_or_above' };
      const result = evaluateAlert(alert, makePriceUpdate(100000), 99950);
      expect(result.triggered).toBe(true);
    });

    it('should trigger when price is above target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'reaches_or_above' };
      const result = evaluateAlert(alert, makePriceUpdate(105000), 99000);
      expect(result.triggered).toBe(true);
    });

    it('should not trigger when price is below target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'reaches_or_above' };
      const result = evaluateAlert(alert, makePriceUpdate(95000), 94000);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Price reaches or below target', () => {
    it('should trigger when price reaches target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'reaches_or_below' };
      const result = evaluateAlert(alert, makePriceUpdate(95000), 100000);
      expect(result.triggered).toBe(true);
    });

    it('should trigger when price is below target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'reaches_or_below' };
      const result = evaluateAlert(alert, makePriceUpdate(80000), 90000);
      expect(result.triggered).toBe(true);
    });

    it('should not trigger when price is above target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'reaches_or_below' };
      const result = evaluateAlert(alert, makePriceUpdate(105000), 110000);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Price jumping over target', () => {
    it('should trigger crossed_above even when price jumps over target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'crossed_above' };
      const result = evaluateAlert(alert, makePriceUpdate(105000), 95000);
      expect(result.triggered).toBe(true);
    });

    it('should trigger crossed_below even when price drops below target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'crossed_below' };
      const result = evaluateAlert(alert, makePriceUpdate(85000), 105000);
      expect(result.triggered).toBe(true);
    });
  });

  describe('Alert deduplication', () => {
    it('should not trigger if alert is already triggered', () => {
      const alert: AlertConfig = { ...baseAlert, triggered: true };
      const result = evaluateAlert(alert, makePriceUpdate(105000), 100000);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Disabled alerts', () => {
    it('should not trigger disabled alerts', () => {
      const alert: AlertConfig = { ...baseAlert, enabled: false };
      const result = evaluateAlert(alert, makePriceUpdate(105000), 95000);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Previous price null (first update)', () => {
    it('should not trigger crossed_above on first update', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'crossed_above' };
      const result = evaluateAlert(alert, makePriceUpdate(105000), null);
      expect(result.triggered).toBe(false);
      expect(result.previousPrice).toBe(0);
    });

    it('should not trigger crossed_below on first update', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'crossed_below' };
      const result = evaluateAlert(alert, makePriceUpdate(95000), null);
      expect(result.triggered).toBe(false);
    });

    it('should not trigger reaches_or_above on first update', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'reaches_or_above' };
      const result = evaluateAlert(alert, makePriceUpdate(105000), null);
      expect(result.triggered).toBe(false);
    });

    it('should not trigger reaches_or_below on first update', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'reaches_or_below' };
      const result = evaluateAlert(alert, makePriceUpdate(95000), null);
      expect(result.triggered).toBe(false);
    });

    it('should still report correct currentPrice when previousPrice is null', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'crossed_above' };
      const result = evaluateAlert(alert, makePriceUpdate(105000), null);
      expect(result.currentPrice).toBe(105000);
      expect(result.targetPrice).toBe(100000);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Boundary conditions', () => {
    it('should trigger crossed_above when price equals target from below', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'crossed_above' };
      const result = evaluateAlert(alert, makePriceUpdate(100000), 99999);
      expect(result.triggered).toBe(true);
    });

    it('should trigger crossed_below when price equals target from above', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'crossed_below' };
      const result = evaluateAlert(alert, makePriceUpdate(100000), 100001);
      expect(result.triggered).toBe(true);
    });

    it('should not trigger crossed_above when both prices equal target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'crossed_above' };
      const result = evaluateAlert(alert, makePriceUpdate(100000), 100000);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Trigger result metadata', () => {
    it('should include correct prices in trigger result', () => {
      const alert: AlertConfig = { ...baseAlert };
      const result = evaluateAlert(alert, makePriceUpdate(100020), 99950);
      expect(result.previousPrice).toBe(99950);
      expect(result.currentPrice).toBe(100020);
      expect(result.targetPrice).toBe(100000);
      expect(result.condition).toBe('crossed_above');
    });
  });
});

describe('Alert Engine - shouldMonitorSymbol', () => {
  it('should return true for matching symbol', () => {
    const alert: AlertConfig = {
      id: 'test-1',
      symbol: 'BTCUSD',
      condition: 'crossed_above',
      targetPrice: 100000,
      discordChannelId: '123456789012345678',
      enabled: true,
      triggered: false,
      createdAt: '2024-01-01T00:00:00Z',
      triggeredAt: null,
    };
    expect(shouldMonitorSymbol(alert, 'BTCUSD')).toBe(true);
  });

  it('should return false for non-matching symbol', () => {
    const alert: AlertConfig = {
      id: 'test-1',
      symbol: 'BTCUSD',
      condition: 'crossed_above',
      targetPrice: 100000,
      discordChannelId: '123456789012345678',
      enabled: true,
      triggered: false,
      createdAt: '2024-01-01T00:00:00Z',
      triggeredAt: null,
    };
    expect(shouldMonitorSymbol(alert, 'ETHUSD')).toBe(false);
  });

  it('should return false for disabled alerts', () => {
    const alert: AlertConfig = {
      id: 'test-1',
      symbol: 'BTCUSD',
      condition: 'crossed_above',
      targetPrice: 100000,
      discordChannelId: '123456789012345678',
      enabled: false,
      triggered: false,
      createdAt: '2024-01-01T00:00:00Z',
      triggeredAt: null,
    };
    expect(shouldMonitorSymbol(alert, 'BTCUSD')).toBe(false);
  });

  it('should return false for triggered alerts', () => {
    const alert: AlertConfig = {
      id: 'test-1',
      symbol: 'BTCUSD',
      condition: 'crossed_above',
      targetPrice: 100000,
      discordChannelId: '123456789012345678',
      enabled: true,
      triggered: true,
      createdAt: '2024-01-01T00:00:00Z',
      triggeredAt: '2024-01-02T00:00:00Z',
    };
    expect(shouldMonitorSymbol(alert, 'BTCUSD')).toBe(false);
  });
});

describe('Alert Engine - Validation', () => {
  it('should validate correct input', () => {
    const result = validateAlertInput({
      symbol: 'BTCUSD',
      condition: 'crossed_above',
      targetPrice: 100000,
      discordChannelId: '123456789012345678',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject invalid symbol', () => {
    const result = validateAlertInput({
      symbol: 'btc$%',
      condition: 'crossed_above',
      targetPrice: 100000,
      discordChannelId: '123456789012345678',
    });
    expect(result.valid).toBe(false);
  });

  it('should reject invalid condition', () => {
    const result = validateAlertInput({
      symbol: 'BTCUSD',
      condition: 'invalid_condition',
      targetPrice: 100000,
      discordChannelId: '123456789012345678',
    });
    expect(result.valid).toBe(false);
  });

  it('should reject invalid target price', () => {
    const result = validateAlertInput({
      symbol: 'BTCUSD',
      condition: 'crossed_above',
      targetPrice: -100,
      discordChannelId: '123456789012345678',
    });
    expect(result.valid).toBe(false);
  });

  it('should reject invalid channel ID', () => {
    const result = validateAlertInput({
      symbol: 'BTCUSD',
      condition: 'crossed_above',
      targetPrice: 100000,
      discordChannelId: 'abc',
    });
    expect(result.valid).toBe(false);
  });

  it('should reject zero target price', () => {
    const result = validateAlertInput({
      symbol: 'BTCUSD',
      condition: 'crossed_above',
      targetPrice: 0,
      discordChannelId: '123456789012345678',
    });
    expect(result.valid).toBe(false);
  });
});

describe('Alert Engine - Discord-gated integration', () => {
  const symbol = 'BTCUSD';

  const makeAlert = (overrides: Partial<AlertConfig> = {}): AlertConfig => ({
    id: `alert-${Math.random().toString(36).substring(2, 8)}`,
    symbol,
    condition: 'crossed_above',
    targetPrice: 100000,
    discordChannelId: '123456789012345678',
    enabled: true,
    triggered: false,
    createdAt: '2024-01-01T00:00:00Z',
    triggeredAt: null,
    ...overrides,
  });

  const makeStorage = (alerts: AlertConfig[] = []): AlertStorage => ({
    getAll: jest.fn().mockReturnValue(alerts),
    getById: jest.fn().mockReturnValue(undefined),
    getActiveBySymbol: jest.fn().mockReturnValue(alerts.filter((a) => a.enabled && !a.triggered)),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  });

  const makeDiscordClient = (sendSuccess = true): DiscordClient => ({
    start: jest.fn(),
    stop: jest.fn(),
    isReady: jest.fn().mockReturnValue(true),
    sendAlert: jest.fn().mockResolvedValue(sendSuccess),
  });

  it('should mark alert as triggered when Discord delivery succeeds', async () => {
    const storage = makeStorage();
    const discord = makeDiscordClient(true);
    const engine = createAlertEngine(storage, discord, logger);

    const alert = makeAlert();
    storage.save(alert);
    (storage.getActiveBySymbol as jest.Mock).mockReturnValue([alert]);

    const priceUpdate: PriceUpdatePayload = {
      symbol,
      currentPrice: 100050,
      previousPrice: 99900,
      timestamp: Date.now(),
    };

    engine.onPriceUpdate(priceUpdate);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(discord.sendAlert).toHaveBeenCalledWith('123456789012345678', expect.stringContaining(symbol));
    expect(alert.triggered).toBe(true);
    expect(alert.triggeredAt).toBeTruthy();
    expect(storage.update).toHaveBeenCalledWith(alert);
  });

  it('should NOT mark alert as triggered when Discord delivery fails', async () => {
    const storage = makeStorage();
    const discord = makeDiscordClient(false);
    const engine = createAlertEngine(storage, discord, logger);

    const alert = makeAlert();
    storage.save(alert);
    (storage.getActiveBySymbol as jest.Mock).mockReturnValue([alert]);

    const priceUpdate: PriceUpdatePayload = {
      symbol,
      currentPrice: 100050,
      previousPrice: 99900,
      timestamp: Date.now(),
    };

    engine.onPriceUpdate(priceUpdate);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(discord.sendAlert).toHaveBeenCalled();
    expect(alert.triggered).toBe(false);
    expect(alert.triggeredAt).toBeNull();
    expect(storage.update).not.toHaveBeenCalled();
  });

  it('should not duplicate pending sends for same alert', async () => {
    const storage = makeStorage();
    const discord = makeDiscordClient(true);
    (discord.sendAlert as jest.Mock).mockImplementation(
      () => new Promise<void>((resolve) => setTimeout(() => resolve(), 100)),
    );
    const engine = createAlertEngine(storage, discord, logger);

    const alert = makeAlert();
    storage.save(alert);
    (storage.getActiveBySymbol as jest.Mock).mockReturnValue([alert]);

    const priceUpdate: PriceUpdatePayload = {
      symbol,
      currentPrice: 100050,
      previousPrice: 99900,
      timestamp: Date.now(),
    };

    engine.onPriceUpdate(priceUpdate);
    engine.onPriceUpdate(priceUpdate);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(discord.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('should handle price updates when no alerts exist for symbol', () => {
    const storage = makeStorage();
    const discord = makeDiscordClient(true);
    const engine = createAlertEngine(storage, discord, logger);

    const priceUpdate: PriceUpdatePayload = {
      symbol,
      currentPrice: 100050,
      previousPrice: 99900,
      timestamp: Date.now(),
    };

    expect(() => engine.onPriceUpdate(priceUpdate)).not.toThrow();
    expect(discord.sendAlert).not.toHaveBeenCalled();
  });

  it('should skip processing for alerts already in pending sends', async () => {
    const storage = makeStorage();
    const discord = makeDiscordClient(true);
    (discord.sendAlert as jest.Mock).mockImplementation(
      () => new Promise<void>((resolve) => setTimeout(() => resolve(), 200)),
    );
    const engine = createAlertEngine(storage, discord, logger);

    const alert = makeAlert();
    storage.save(alert);
    (storage.getActiveBySymbol as jest.Mock).mockReturnValue([alert]);

    const priceUpdate: PriceUpdatePayload = {
      symbol,
      currentPrice: 100050,
      previousPrice: 99900,
      timestamp: Date.now(),
    };

    engine.onPriceUpdate(priceUpdate);
    engine.onPriceUpdate(priceUpdate);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(discord.sendAlert).toHaveBeenCalledTimes(1);

    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    expect(discord.sendAlert).toHaveBeenCalledTimes(1);
  });
});
