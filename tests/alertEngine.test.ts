import { evaluateAlert, shouldMonitorSymbol, createAlertEngine } from '../src/alerts/engine';
import { parseDeltaTicker } from '../src/delta/client';
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

const makeAlert = (overrides: Partial<AlertConfig> = {}): AlertConfig => ({
  id: `alert-${Math.random().toString(36).substring(2, 8)}`,
  symbol: 'ETHUSD',
  channelId: '123456789012345678',
  targetPrice: 4500,
  baselinePrice: null,
  direction: 'upward',
  enabled: true,
  triggered: false,
  createdAt: '2024-01-01T00:00:00Z',
  triggeredAt: null,
  ...overrides,
});

const makeStorage = (alerts: AlertConfig[] = []): AlertStorage => ({
  getAll: jest.fn().mockReturnValue(alerts),
  getById: jest.fn().mockReturnValue(undefined),
  getByChannel: jest.fn().mockReturnValue(undefined),
  getActiveBySymbol: jest.fn().mockReturnValue(alerts.filter((a) => a.enabled && !a.triggered)),
  save: jest.fn(),
  update: jest.fn(),
  deleteByChannel: jest.fn(),
});

const makeDiscordClient = (sendSuccess = true): DiscordClient => ({
  start: jest.fn(),
  stop: jest.fn(),
  isReady: jest.fn().mockReturnValue(true),
  sendAlert: jest.fn().mockResolvedValue(sendSuccess),
});

const makePriceUpdate = (price: number, timestamp = Date.now()): PriceUpdate => ({
  symbol: 'ETHUSD',
  price,
  timestamp,
});

describe('Delta Ticker Parser', () => {
  describe('Valid ticker payloads', () => {
    it('should parse compact ticker format', () => {
      const result = parseDeltaTicker(JSON.stringify({ type: 'ticker', sy: 'ETHUSD', sp: 4500 }));
      expect(result).not.toBeNull();
      expect(result!.symbol).toBe('ETHUSD');
      expect(result!.price).toBe(4500);
    });

    it('should parse compact ticker with SOLUSD', () => {
      const result = parseDeltaTicker(JSON.stringify({ type: 'ticker', sy: 'SOLUSD', sp: 250 }));
      expect(result).not.toBeNull();
      expect(result!.symbol).toBe('SOLUSD');
      expect(result!.price).toBe(250);
    });

    it('should parse compact ticker with string price', () => {
      const result = parseDeltaTicker(JSON.stringify({ type: 'ticker', sy: 'ETHUSD', sp: '4500.50' }));
      expect(result).not.toBeNull();
      expect(result!.symbol).toBe('ETHUSD');
      expect(result!.price).toBe(4500.5);
    });

    it('should parse nested ticker with close field', () => {
      const result = parseDeltaTicker(
        JSON.stringify({ type: 'ticker', ticker: { symbol: 'ETHUSD', close: 4500 } }),
      );
      expect(result).not.toBeNull();
      expect(result!.symbol).toBe('ETHUSD');
      expect(result!.price).toBe(4500);
    });

    it('should parse nested ticker with sp field', () => {
      const result = parseDeltaTicker(
        JSON.stringify({ type: 'ticker', ticker: { sy: 'SOLUSD', sp: 250 } }),
      );
      expect(result).not.toBeNull();
      expect(result!.symbol).toBe('SOLUSD');
      expect(result!.price).toBe(250);
    });
  });

  describe('Invalid inputs', () => {
    it('should return null for invalid JSON', () => {
      expect(parseDeltaTicker('not json')).toBeNull();
    });

    it('should return null for non-ticker type', () => {
      expect(parseDeltaTicker(JSON.stringify({ type: 'trade', sy: 'ETHUSD', sp: 4500 }))).toBeNull();
    });

    it('should return null for missing symbol', () => {
      expect(parseDeltaTicker(JSON.stringify({ type: 'ticker', sp: 4500 }))).toBeNull();
    });

    it('should return null for missing price', () => {
      expect(parseDeltaTicker(JSON.stringify({ type: 'ticker', sy: 'ETHUSD' }))).toBeNull();
    });

    it('should return null for non-numeric price', () => {
      expect(parseDeltaTicker(JSON.stringify({ type: 'ticker', sy: 'ETHUSD', sp: 'abc' }))).toBeNull();
    });
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
  it('should validate correct input', () => {
    const result = validateAlertInput({
      price: 4500,
      channelId: 'eth-channel-id',
      ethChannelId: 'eth-channel-id',
      solChannelId: 'sol-channel-id',
      symbol: 'ETHUSD',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject non-numeric price', () => {
    const result = validateAlertInput({
      price: 'abc',
      channelId: 'eth-channel-id',
      ethChannelId: 'eth-channel-id',
      solChannelId: 'sol-channel-id',
      symbol: 'ETHUSD',
    });
    expect(result.valid).toBe(false);
  });

  it('should reject negative price', () => {
    const result = validateAlertInput({
      price: -100,
      channelId: 'eth-channel-id',
      ethChannelId: 'eth-channel-id',
      solChannelId: 'sol-channel-id',
      symbol: 'ETHUSD',
    });
    expect(result.valid).toBe(false);
  });

  it('should reject zero price', () => {
    const result = validateAlertInput({
      price: 0,
      channelId: 'eth-channel-id',
      ethChannelId: 'eth-channel-id',
      solChannelId: 'sol-channel-id',
      symbol: 'ETHUSD',
    });
    expect(result.valid).toBe(false);
  });

  it('should reject Infinity price', () => {
    const result = validateAlertInput({
      price: Infinity,
      channelId: 'eth-channel-id',
      ethChannelId: 'eth-channel-id',
      solChannelId: 'sol-channel-id',
      symbol: 'ETHUSD',
    });
    expect(result.valid).toBe(false);
  });

  it('should reject other channels', () => {
    const result = validateAlertInput({
      price: 4500,
      channelId: 'other-channel',
      ethChannelId: 'eth-channel-id',
      solChannelId: 'sol-channel-id',
      symbol: 'ETHUSD',
    });
    expect(result.valid).toBe(false);
  });
});

describe('Alert Engine - evaluateAlert', () => {
  describe('Upward target', () => {
    it('should trigger when price crosses above target', () => {
      const alert = makeAlert({ direction: 'upward', baselinePrice: 4400, targetPrice: 4500 });
      const result = evaluateAlert(alert, makePriceUpdate(4530));
      expect(result.triggered).toBe(true);
    });

    it('should NOT trigger when price is already above target at creation', () => {
      const alert = makeAlert({ direction: 'upward', baselinePrice: 4400, targetPrice: 4500 });
      const result = evaluateAlert(alert, makePriceUpdate(4400));
      expect(result.triggered).toBe(false);
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

    it('should NOT trigger if alert is disabled', () => {
      const alert = makeAlert({ direction: 'upward', baselinePrice: 4400, targetPrice: 4500, enabled: false });
      const result = evaluateAlert(alert, makePriceUpdate(4530));
      expect(result.triggered).toBe(false);
    });
  });

  describe('Downward target', () => {
    it('should trigger when price crosses below target', () => {
      const alert = makeAlert({ direction: 'downward', baselinePrice: 4600, targetPrice: 4500 });
      const result = evaluateAlert(alert, makePriceUpdate(4470));
      expect(result.triggered).toBe(true);
    });

    it('should NOT trigger when price is already below target at creation', () => {
      const alert = makeAlert({ direction: 'downward', baselinePrice: 4600, targetPrice: 4500 });
      const result = evaluateAlert(alert, makePriceUpdate(4600));
      expect(result.triggered).toBe(false);
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

  describe('Baseline not set (first update)', () => {
    it('should not trigger when baseline is null', () => {
      const alert = makeAlert({ baselinePrice: null, direction: 'upward', targetPrice: 4500 });
      const result = evaluateAlert(alert, makePriceUpdate(5000));
      expect(result.triggered).toBe(false);
    });

    it('should not trigger when baseline is undefined', () => {
      const alert = makeAlert({ baselinePrice: undefined, direction: 'upward', targetPrice: 4500 });
      const result = evaluateAlert(alert, makePriceUpdate(5000));
      expect(result.triggered).toBe(false);
    });
  });

  describe('Edge case: target equals baseline', () => {
    it('should not trigger upward when target equals baseline', () => {
      const alert = makeAlert({ direction: 'upward', baselinePrice: 4500, targetPrice: 4500 });
      const result = evaluateAlert(alert, makePriceUpdate(4600));
      expect(result.triggered).toBe(false);
    });

    it('should not trigger downward when target equals baseline', () => {
      const alert = makeAlert({ direction: 'downward', baselinePrice: 4500, targetPrice: 4500 });
      const result = evaluateAlert(alert, makePriceUpdate(4400));
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

  it('should return false for disabled alerts', () => {
    const alert = makeAlert({ enabled: false });
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
    const discord = makeDiscordClient(true);
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
    const discord = makeDiscordClient(false);
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
    const discord = makeDiscordClient(true);
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
    const discord = makeDiscordClient(true);
    const engine = createAlertEngine(storage, discord, logger);

    const priceUpdate = { symbol: 'SOLUSD', currentPrice: 250, previousPrice: 240, timestamp: Date.now() };
    expect(() => engine.onPriceUpdate(priceUpdate)).not.toThrow();
    expect(discord.sendAlert).not.toHaveBeenCalled();
  });
});

describe('Alert Engine - processAlert flow', () => {
  it('should format correct Discord message', async () => {
    const storage = makeStorage();
    const discord = makeDiscordClient(true);
    const engine = createAlertEngine(storage, discord, logger);

    const alert = makeAlert({
      direction: 'upward',
      baselinePrice: 4400,
      targetPrice: 4500,
    });
    storage.save(alert);
    (storage.getActiveBySymbol as jest.Mock).mockReturnValue([alert]);

    const priceUpdate = { symbol: 'ETHUSD', currentPrice: 4530, previousPrice: 4400, timestamp: Date.now() };
    engine.onPriceUpdate(priceUpdate);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const callArgs = (discord.sendAlert as jest.Mock).mock.calls[0];
    expect(callArgs).toHaveLength(2);
    expect(callArgs[0]).toBe('123456789012345678');
    expect(callArgs[1]).toContain('ETHUSD Price Alert');
    expect(callArgs[1]).toContain('4,500');
    expect(callArgs[1]).toContain('4,530');
  });
});
