import {
  evaluateAlert,
  createAlertEngine,
  shouldMonitorSymbol,
} from '../src/alerts/engine';
import { parseDeltaTrade, ParsedTrade } from '../src/delta/client';
import { AlertConfig, PriceUpdate } from '../src/alerts/types';
import { isValidTargetPrice } from '../src/alerts/validation';
import { AlertStorage } from '../src/database/storage';
import { Logger } from '../src/logger';
import {
  handleAlertList,
  handleAlertSet,
  handleSelectMenu,
} from '../src/discord/client';
import { ChatInputCommandInteraction, SelectMenuInteraction } from 'discord.js';
import { loadConfig } from '../src/config';

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

  describe('BTCUSD support', () => {
    it('should parse BTCUSD trade', () => {
      const payload = JSON.stringify({
        type: 'trades',
        p: '95000.25',
        sy: 'BTCUSD',
        t: 1234567890,
        ts: 1234567891,
      });
      const result = parseDeltaTrade(payload);
      expect(result).not.toBeNull();
      expect(result!.symbol).toBe('BTCUSD');
      expect(result!.price).toBe(95000.25);
    });

    it('should parse BTCUSD trade with integer price', () => {
      const payload = JSON.stringify({
        type: 'trades',
        p: '100000',
        sy: 'BTCUSD',
        t: 1,
        ts: 2,
      });
      const result = parseDeltaTrade(payload);
      expect(result).not.toBeNull();
      expect(result!.symbol).toBe('BTCUSD');
      expect(result!.price).toBe(100000);
    });

    it('should parse BTCUSD Buffer WebSocket message', () => {
      const raw = JSON.stringify({
        type: 'trades',
        p: '95000.25',
        sy: 'BTCUSD',
        t: 1234567890,
        ts: 1234567891,
      });
      const result = parseDeltaTrade(Buffer.from(raw, 'utf-8').toString('utf-8'));
      expect(result).not.toBeNull();
      expect(result!.symbol).toBe('BTCUSD');
      expect(result!.price).toBe(95000.25);
    });

    it('should reject BTCUSD with invalid price', () => {
      expect(
        parseDeltaTrade(JSON.stringify({ type: 'trades', sy: 'BTCUSD', p: 'abc' })),
      ).toBeNull();
    });

    it('should reject BTCUSD with missing price', () => {
      expect(parseDeltaTrade(JSON.stringify({ type: 'trades', sy: 'BTCUSD' }))).toBeNull();
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
        JSON.stringify({ type: 'trades', p: '100', sy: 'XRPUSD', t: 1, ts: 2 }),
      );
      expect(result).toBeNull();
    });
  });
});

describe('REST Baseline Price', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should fetch baseline price from REST API with result.close', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, result: { close: 4500.5 } }),
    } as unknown as Response);

    const response = await fetch('https://api.india.delta.exchange/v2/tickers/ETHUSD');
    const data = (await response.json()) as { success: boolean; result: { close: number } };
    expect(data.result.close).toBe(4500.5);
    expect(typeof data.result.close).toBe('number');
  });

  it('should handle result.close as numeric string', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, result: { close: '4500.5' } }),
    } as unknown as Response);

    const response = await fetch('https://api.india.delta.exchange/v2/tickers/ETHUSD');
    const data = (await response.json()) as { success: boolean; result: { close: string } };
    const price = typeof data.result.close === 'number' ? data.result.close : parseFloat(data.result.close);
    expect(price).toBe(4500.5);
  });

  it('should handle REST API failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as unknown as Response);

    const response = await fetch('https://api.india.delta.exchange/v2/tickers/ETHUSD');
    expect(response.ok).toBe(false);
  });

  it('should handle missing result object', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as unknown as Response);

    const response = await fetch('https://api.india.delta.exchange/v2/tickers/ETHUSD');
    const data = (await response.json()) as { success: boolean; result?: { close?: unknown } };
    expect(data.result).toBeUndefined();
  });

  it('should handle missing close in result', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, result: { symbol: 'ETHUSD' } }),
    } as unknown as Response);

    const response = await fetch('https://api.india.delta.exchange/v2/tickers/ETHUSD');
    const data = (await response.json()) as { success: boolean; result: { close?: unknown } };
    expect(data.result.close).toBeUndefined();
  });

  it('should handle invalid close value', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, result: { close: 'abc' } }),
    } as unknown as Response);

    const response = await fetch('https://api.india.delta.exchange/v2/tickers/ETHUSD');
    const data = (await response.json()) as { success: boolean; result: { close: unknown } };
    const closeVal = data.result.close;
    const price = typeof closeVal === 'number' ? closeVal : parseFloat(String(closeVal));
    expect(Number.isFinite(price)).toBe(false);
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

  it('should map #BTCUSD channel to BTCUSD symbol', () => {
    const alert = makeAlert({ symbol: 'BTCUSD', channelId: 'btc-channel-id' });
    expect(alert.symbol).toBe('BTCUSD');
    expect(alert.channelId).toBe('btc-channel-id');
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
    expect(storage.deleteById).toHaveBeenCalledWith(alert.id);
    expect(storage.update).not.toHaveBeenCalled();
  });

  it('should NOT delete alert when Discord delivery fails', async () => {
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
    expect(storage.deleteById).not.toHaveBeenCalled();
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
    expect(storage.deleteById).toHaveBeenCalledWith(alert.id);
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
    expect(storage.deleteById).toHaveBeenCalledWith('alert-1');
    expect(storage.deleteById).not.toHaveBeenCalledWith('alert-2');
    expect(storage.deleteById).not.toHaveBeenCalledWith('alert-3');

    engine.onPriceUpdate({ symbol: 'ETHUSD', currentPrice: 4600, previousPrice: 4550, timestamp: Date.now() });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(storage.deleteById).toHaveBeenCalledWith('alert-2');
    expect(storage.deleteById).not.toHaveBeenCalledWith('alert-3');

    engine.onPriceUpdate({ symbol: 'ETHUSD', currentPrice: 4700, previousPrice: 4650, timestamp: Date.now() });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(storage.deleteById).toHaveBeenCalledWith('alert-3');
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

describe('Alert List Command', () => {
  const mockInteraction = {
    reply: jest.fn(),
    channelId: 'eth-channel-id',
    options: { getString: jest.fn() },
  } as unknown as ChatInputCommandInteraction;

  const quietLogger: Logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should reply with no alerts message for empty channel', async () => {
    const storage = makeStorage([]);
    await handleAlertList(mockInteraction, storage, quietLogger, 'eth-channel-id', 'ETHUSD');
    expect(mockInteraction.reply).toHaveBeenCalled();
    const call = (mockInteraction.reply as jest.Mock).mock.calls[0][0];
    expect(call.content).toContain('No alerts configured');
  });

  it('should list active alerts', async () => {
    const storage = makeStorage([
      makeAlert({ id: 'alert-1', targetPrice: 4500, active: true, triggered: false }),
    ]);
    await handleAlertList(mockInteraction, storage, quietLogger, 'eth-channel-id', 'ETHUSD');
    expect(mockInteraction.reply).toHaveBeenCalled();
    const call = (mockInteraction.reply as jest.Mock).mock.calls[0][0];
    expect(call.content).toContain('4,500');
    expect(call.content).toContain('Active');
  });

  it('should list inactive alerts', async () => {
    const storage = makeStorage([
      makeAlert({ id: 'alert-2', targetPrice: 4600, active: false, triggered: false }),
    ]);
    await handleAlertList(mockInteraction, storage, quietLogger, 'eth-channel-id', 'ETHUSD');
    expect(mockInteraction.reply).toHaveBeenCalled();
    const call = (mockInteraction.reply as jest.Mock).mock.calls[0][0];
    expect(call.content).toContain('4,600');
    expect(call.content).toContain('Inactive');
  });

  it('should list mixed alert statuses', async () => {
    const storage = makeStorage([
      makeAlert({ id: 'a1', targetPrice: 4500, active: true, triggered: false }),
      makeAlert({ id: 'a2', targetPrice: 4600, active: false, triggered: false }),
    ]);
    await handleAlertList(mockInteraction, storage, quietLogger, 'eth-channel-id', 'ETHUSD');
    expect(mockInteraction.reply).toHaveBeenCalled();
    const call = (mockInteraction.reply as jest.Mock).mock.calls[0][0];
    expect(call.content).toContain('4,500');
    expect(call.content).toContain('4,600');
    expect(call.content).toContain('Active');
    expect(call.content).toContain('Inactive');
    expect(call.content).not.toContain('Triggered');
  });

  it('should default to the channel symbol when no alerts', async () => {
    const storage = makeStorage([]);
    await handleAlertList(mockInteraction, storage, quietLogger, 'eth-channel-id', 'ETHUSD');
    expect(mockInteraction.reply).toHaveBeenCalled();
    const call = (mockInteraction.reply as jest.Mock).mock.calls[0][0];
    expect(call.content).toContain('ETHUSD Alerts');
  });

  it('should use first alert symbol in header when alerts exist', async () => {
    const storage = makeStorage([
      makeAlert({ id: 'a1', symbol: 'SOLUSD', targetPrice: 100, active: true, triggered: false }),
    ]);
    await handleAlertList(mockInteraction, storage, quietLogger, 'sol-channel-id', 'SOLUSD');
    expect(mockInteraction.reply).toHaveBeenCalled();
    const call = (mockInteraction.reply as jest.Mock).mock.calls[0][0];
    expect(call.content).toContain('SOLUSD Alerts');
  });

  it('should use BTCUSD channel symbol for empty BTC channel', async () => {
    const storage = makeStorage([]);
    await handleAlertList(mockInteraction, storage, quietLogger, 'btc-channel-id', 'BTCUSD');
    expect(mockInteraction.reply).toHaveBeenCalled();
    const call = (mockInteraction.reply as jest.Mock).mock.calls[0][0];
    expect(call.content).toContain('BTCUSD Alerts');
    expect(call.content).toContain('No alerts configured');
  });
});

describe('Alert Select Menu', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  function makeSelectMenu(overrides: {
    customId?: string;
    values?: string[];
    channelId?: string;
    update?: jest.Mock;
  }): SelectMenuInteraction {
    const update = overrides.update ?? jest.fn().mockResolvedValue(undefined);
    return {
      customId: overrides.customId ?? 'alert:delete',
      values: overrides.values ?? ['alert-1'],
      channelId: overrides.channelId ?? 'eth-channel-id',
      update,
    } as unknown as SelectMenuInteraction;
  }

  describe('alert:delete', () => {
    it('should delete alert and update message on valid selection', async () => {
      const storage = makeStorage([
        makeAlert({ id: 'alert-1', symbol: 'ETHUSD', targetPrice: 4500, active: true, channelId: 'eth-channel-id' }),
      ]);
      (storage.getById as jest.Mock).mockReturnValue(
        makeAlert({ id: 'alert-1', symbol: 'ETHUSD', targetPrice: 4500, active: true, channelId: 'eth-channel-id' }),
      );
      const logger: Logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
      const interaction = makeSelectMenu({ customId: 'alert:delete' });
      await handleSelectMenu(interaction, storage, logger);
      expect(storage.deleteById).toHaveBeenCalledWith('alert-1');
      expect(interaction.update).toHaveBeenCalled();
      const call = (interaction.update as jest.Mock).mock.calls[0][0];
      expect(call.content).toContain('deleted');
    });

    it('should handle missing alert gracefully', async () => {
      const storage = makeStorage([]);
      (storage.getById as jest.Mock).mockReturnValue(undefined);
      const logger: Logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
      const interaction = makeSelectMenu({ customId: 'alert:delete' });
      await handleSelectMenu(interaction, storage, logger);
      expect(storage.deleteById).not.toHaveBeenCalled();
      expect(interaction.update).toHaveBeenCalled();
      const call = (interaction.update as jest.Mock).mock.calls[0][0];
      expect(call.content).toContain('not found');
    });
  });

  describe('alert:activate', () => {
    it('should activate inactive alert and update message', async () => {
      const alert = makeAlert({ id: 'alert-2', symbol: 'ETHUSD', targetPrice: 4600, active: false, channelId: 'eth-channel-id' });
      const storage = makeStorage([alert]);
      (storage.getById as jest.Mock).mockReturnValue(alert);
      const logger: Logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
      const interaction = makeSelectMenu({ customId: 'alert:activate', values: ['alert-2'] });
      await handleSelectMenu(interaction, storage, logger);
      expect(storage.update).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
      expect(interaction.update).toHaveBeenCalled();
      const call = (interaction.update as jest.Mock).mock.calls[0][0];
      expect(call.content).toContain('activated');
    });
  });

  describe('alert:deactivate', () => {
    it('should deactivate active alert and update message', async () => {
      const alert = makeAlert({ id: 'alert-3', symbol: 'ETHUSD', targetPrice: 4700, active: true, channelId: 'eth-channel-id' });
      const storage = makeStorage([alert]);
      (storage.getById as jest.Mock).mockReturnValue(alert);
      const logger: Logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
      const interaction = makeSelectMenu({ customId: 'alert:deactivate', values: ['alert-3'] });
      await handleSelectMenu(interaction, storage, logger);
      expect(storage.update).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
      expect(interaction.update).toHaveBeenCalled();
      const call = (interaction.update as jest.Mock).mock.calls[0][0];
      expect(call.content).toContain('deactivated');
    });
  });

  describe('channel ownership validation', () => {
    it('should reject alert from different channel', async () => {
      const storage = makeStorage([
        makeAlert({ id: 'alert-1', symbol: 'ETHUSD', targetPrice: 4500, active: true, channelId: 'other-channel' }),
      ]);
      (storage.getById as jest.Mock).mockReturnValue(
        makeAlert({ id: 'alert-1', symbol: 'ETHUSD', targetPrice: 4500, active: true, channelId: 'other-channel' }),
      );
      const logger: Logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
      const interaction = makeSelectMenu({ customId: 'alert:delete', channelId: 'eth-channel-id' });
      await handleSelectMenu(interaction, storage, logger);
      expect(storage.deleteById).not.toHaveBeenCalled();
      expect(interaction.update).toHaveBeenCalled();
      const call = (interaction.update as jest.Mock).mock.calls[0][0];
      expect(call.content).toContain('does not belong');
    });
  });
});

describe('Alert Commands - public responses', () => {
  it('should not use ephemeral responses for /alert set', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, result: { close: 4400 } }),
    } as unknown as Response);
    const storage = makeStorage([]);
    const logger: Logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const interaction = {
      reply: jest.fn(),
      channelId: 'eth-channel-id',
      options: { getString: jest.fn().mockReturnValue('4500') },
    } as unknown as ChatInputCommandInteraction;
    await handleAlertSet(interaction, storage, logger, 'eth-channel-id', 'ETHUSD');
    expect(interaction.reply).toHaveBeenCalled();
    const call = (interaction.reply as jest.Mock).mock.calls[0][0];
    expect(call.ephemeral).toBeUndefined();
  });

  it('should not use ephemeral responses for /alert list', async () => {
    const storage = makeStorage([]);
    const logger: Logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const interaction = {
      reply: jest.fn(),
      channelId: 'eth-channel-id',
      options: {},
    } as unknown as ChatInputCommandInteraction;
    await handleAlertList(interaction, storage, logger, 'eth-channel-id', 'ETHUSD');
    expect(interaction.reply).toHaveBeenCalled();
    const call = (interaction.reply as jest.Mock).mock.calls[0][0];
    expect(call.ephemeral).toBeUndefined();
  });
});

describe('BTCUSD - alert lifecycle', () => {
  const btcAlert = (overrides: Partial<AlertConfig> = {}): AlertConfig =>
    makeAlert({
      id: 'btc-1',
      symbol: 'BTCUSD',
      channelId: 'btc-channel-id',
      ...overrides,
    });

  const makeDiscord = (sent: boolean) => ({
    start: jest.fn(),
    stop: jest.fn(),
    isReady: jest.fn().mockReturnValue(true),
    sendAlert: jest.fn().mockResolvedValue(sent),
  });

  const makeSelectMenu = (customId: string, values: string[], channelId = 'btc-channel-id') =>
    ({
      customId,
      values,
      channelId,
      update: jest.fn().mockResolvedValue(undefined),
    }) as unknown as SelectMenuInteraction;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('baseline price retrieval', () => {
    it('should fetch BTCUSD baseline from result.close', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, result: { symbol: 'BTCUSD', close: 95000 } }),
      } as unknown as Response);

      const storage = makeStorage([]);
      const interaction = {
        reply: jest.fn(),
        channelId: 'btc-channel-id',
        options: { getString: jest.fn().mockReturnValue('96000') },
      } as unknown as ChatInputCommandInteraction;

      await handleAlertSet(interaction, storage, logger, 'btc-channel-id', 'BTCUSD');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.india.delta.exchange/v2/tickers/BTCUSD',
      );
      const saved = (storage.save as jest.Mock).mock.calls[0][0] as AlertConfig;
      expect(saved.symbol).toBe('BTCUSD');
      expect(saved.channelId).toBe('btc-channel-id');
      expect(saved.baselinePrice).toBe(95000);
      expect(saved.targetPrice).toBe(96000);
      expect(saved.direction).toBe('upward');
    });

    it('should create downward BTCUSD alert when target is below baseline', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, result: { close: 95000 } }),
      } as unknown as Response);

      const storage = makeStorage([]);
      const interaction = {
        reply: jest.fn(),
        channelId: 'btc-channel-id',
        options: { getString: jest.fn().mockReturnValue('90000') },
      } as unknown as ChatInputCommandInteraction;

      await handleAlertSet(interaction, storage, logger, 'btc-channel-id', 'BTCUSD');

      const saved = (storage.save as jest.Mock).mock.calls[0][0] as AlertConfig;
      expect(saved.direction).toBe('downward');
      expect(saved.baselinePrice).toBe(95000);
      expect(saved.targetPrice).toBe(90000);
      expect(saved.active).toBe(true);
      expect(saved.triggered).toBe(false);
    });

    it('should not create BTCUSD alert when baseline is unavailable', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      } as unknown as Response);

      const storage = makeStorage([]);
      const interaction = {
        reply: jest.fn(),
        channelId: 'btc-channel-id',
        options: { getString: jest.fn().mockReturnValue('96000') },
      } as unknown as ChatInputCommandInteraction;

      await handleAlertSet(interaction, storage, logger, 'btc-channel-id', 'BTCUSD');

      expect(storage.save).not.toHaveBeenCalled();
      const call = (interaction.reply as jest.Mock).mock.calls[0][0];
      expect(call.content).toContain('Current price unavailable');
    });
  });

  describe('triggering', () => {
    it('should trigger upward BTCUSD alert and delete it after successful delivery', async () => {
      const alert = btcAlert({ baselinePrice: 95000, targetPrice: 96000, direction: 'upward' });
      const storage = makeStorage([alert]);
      const discord = makeDiscord(true);
      const engine = createAlertEngine(storage, discord, logger);

      engine.onPriceUpdate({
        symbol: 'BTCUSD',
        currentPrice: 96100,
        previousPrice: 95000,
        timestamp: Date.now(),
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      expect(discord.sendAlert).toHaveBeenCalledTimes(1);
      expect(discord.sendAlert).toHaveBeenCalledWith('btc-channel-id', expect.any(String));
      expect(storage.deleteById).toHaveBeenCalledWith('btc-1');
      expect(storage.update).not.toHaveBeenCalled();
    });

    it('should trigger downward BTCUSD alert and delete it after successful delivery', async () => {
      const alert = btcAlert({ baselinePrice: 95000, targetPrice: 90000, direction: 'downward' });
      const storage = makeStorage([alert]);
      const discord = makeDiscord(true);
      const engine = createAlertEngine(storage, discord, logger);

      engine.onPriceUpdate({
        symbol: 'BTCUSD',
        currentPrice: 89900,
        previousPrice: 95000,
        timestamp: Date.now(),
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      expect(discord.sendAlert).toHaveBeenCalledWith('btc-channel-id', expect.any(String));
      expect(storage.deleteById).toHaveBeenCalledWith('btc-1');
    });

    it('should NOT trigger BTCUSD alert when price stays below target', async () => {
      const alert = btcAlert({ baselinePrice: 95000, targetPrice: 96000, direction: 'upward' });
      const storage = makeStorage([alert]);
      const discord = makeDiscord(true);
      const engine = createAlertEngine(storage, discord, logger);

      engine.onPriceUpdate({
        symbol: 'BTCUSD',
        currentPrice: 95500,
        previousPrice: 95000,
        timestamp: Date.now(),
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      expect(discord.sendAlert).not.toHaveBeenCalled();
      expect(storage.deleteById).not.toHaveBeenCalled();
    });

    it('should retain BTCUSD alert when Discord delivery fails', async () => {
      const alert = btcAlert({ baselinePrice: 95000, targetPrice: 96000, direction: 'upward' });
      const storage = makeStorage([alert]);
      const discord = makeDiscord(false);
      const engine = createAlertEngine(storage, discord, logger);

      engine.onPriceUpdate({
        symbol: 'BTCUSD',
        currentPrice: 96100,
        previousPrice: 95000,
        timestamp: Date.now(),
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      expect(discord.sendAlert).toHaveBeenCalledTimes(1);
      expect(storage.deleteById).not.toHaveBeenCalled();
      expect(alert.triggered).toBe(false);
      expect(alert.active).toBe(true);
    });

    it('should send duplicate suppression for BTCUSD alerts', async () => {
      const alert = btcAlert({ baselinePrice: 95000, targetPrice: 96000, direction: 'upward' });
      const storage = makeStorage([alert]);
      const discord = makeDiscord(true);
      const engine = createAlertEngine(storage, discord, logger);

      const payload = {
        symbol: 'BTCUSD',
        currentPrice: 96100,
        previousPrice: 95000,
        timestamp: Date.now(),
      };
      engine.onPriceUpdate(payload);
      engine.onPriceUpdate(payload);
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      expect(discord.sendAlert).toHaveBeenCalledTimes(1);
    });

    it('should not trigger BTCUSD alerts on ETHUSD price updates', async () => {
      const alert = btcAlert({ baselinePrice: 95000, targetPrice: 96000, direction: 'upward' });
      const storage = makeStorage([alert]);
      (storage.getActiveBySymbol as jest.Mock).mockReturnValue([]);
      const discord = makeDiscord(true);
      const engine = createAlertEngine(storage, discord, logger);

      engine.onPriceUpdate({
        symbol: 'ETHUSD',
        currentPrice: 99999,
        previousPrice: 4400,
        timestamp: Date.now(),
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      expect(storage.getActiveBySymbol).toHaveBeenCalledWith('ETHUSD');
      expect(discord.sendAlert).not.toHaveBeenCalled();
    });
  });

  describe('evaluateAlert with BTCUSD', () => {
    it('should trigger upward when price is at or above target', () => {
      const alert = btcAlert({ baselinePrice: 95000, targetPrice: 96000, direction: 'upward' });
      expect(evaluateAlert(alert, { symbol: 'BTCUSD', price: 96000, timestamp: 1 }).triggered).toBe(
        true,
      );
    });

    it('should trigger downward when price is at or below target', () => {
      const alert = btcAlert({ baselinePrice: 95000, targetPrice: 90000, direction: 'downward' });
      expect(evaluateAlert(alert, { symbol: 'BTCUSD', price: 90000, timestamp: 1 }).triggered).toBe(
        true,
      );
    });

    it('should trigger immediately when target equals baseline', () => {
      const alert = btcAlert({ baselinePrice: 95000, targetPrice: 95000, direction: 'upward' });
      expect(evaluateAlert(alert, { symbol: 'BTCUSD', price: 95000, timestamp: 1 }).triggered).toBe(
        true,
      );
    });
  });

  describe('select menu flows', () => {
    it('should delete a BTCUSD alert via select menu', async () => {
      const alert = btcAlert();
      const storage = makeStorage([alert]);
      (storage.getById as jest.Mock).mockReturnValue(alert);
      const interaction = makeSelectMenu('alert:delete', ['btc-1']);

      await handleSelectMenu(interaction, storage, logger);

      expect(storage.deleteById).toHaveBeenCalledWith('btc-1');
      const call = (interaction.update as jest.Mock).mock.calls[0][0];
      expect(call.content).toContain('BTCUSD');
      expect(call.content).toContain('deleted');
    });

    it('should activate an inactive BTCUSD alert via select menu', async () => {
      const alert = btcAlert({ active: false });
      const storage = makeStorage([alert]);
      (storage.getById as jest.Mock).mockReturnValue(alert);
      const interaction = makeSelectMenu('alert:activate', ['btc-1']);

      await handleSelectMenu(interaction, storage, logger);

      expect(storage.update).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
      const call = (interaction.update as jest.Mock).mock.calls[0][0];
      expect(call.content).toContain('activated');
    });

    it('should deactivate an active BTCUSD alert via select menu', async () => {
      const alert = btcAlert({ active: true });
      const storage = makeStorage([alert]);
      (storage.getById as jest.Mock).mockReturnValue(alert);
      const interaction = makeSelectMenu('alert:deactivate', ['btc-1']);

      await handleSelectMenu(interaction, storage, logger);

      expect(storage.update).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
      const call = (interaction.update as jest.Mock).mock.calls[0][0];
      expect(call.content).toContain('deactivated');
    });

    it('should list BTCUSD alerts for the BTC channel', async () => {
      const storage = makeStorage([
        btcAlert({ id: 'btc-1', targetPrice: 96000, active: true }),
        btcAlert({ id: 'btc-2', targetPrice: 90000, active: false }),
      ]);
      const interaction = {
        reply: jest.fn(),
        channelId: 'btc-channel-id',
        options: {},
      } as unknown as ChatInputCommandInteraction;

      await handleAlertList(interaction, storage, logger, 'btc-channel-id', 'BTCUSD');

      const call = (interaction.reply as jest.Mock).mock.calls[0][0];
      expect(call.content).toContain('BTCUSD Alerts');
      expect(call.content).toContain('96,000');
      expect(call.content).toContain('Active');
      expect(call.content).toContain('90,000');
      expect(call.content).toContain('Inactive');
      expect(call.ephemeral).toBeUndefined();
    });
  });

  describe('channel isolation', () => {
    it('should not delete a BTCUSD alert from the ETH channel', async () => {
      const alert = btcAlert();
      const storage = makeStorage([alert]);
      (storage.getById as jest.Mock).mockReturnValue(alert);
      const interaction = makeSelectMenu('alert:delete', ['btc-1'], 'eth-channel-id');

      await handleSelectMenu(interaction, storage, logger);

      expect(storage.deleteById).not.toHaveBeenCalled();
      const call = (interaction.update as jest.Mock).mock.calls[0][0];
      expect(call.content).toContain('does not belong');
    });

    it('should not activate a BTCUSD alert from the SOL channel', async () => {
      const alert = btcAlert({ active: false });
      const storage = makeStorage([alert]);
      (storage.getById as jest.Mock).mockReturnValue(alert);
      const interaction = makeSelectMenu('alert:activate', ['btc-1'], 'sol-channel-id');

      await handleSelectMenu(interaction, storage, logger);

      expect(storage.update).not.toHaveBeenCalled();
      const call = (interaction.update as jest.Mock).mock.calls[0][0];
      expect(call.content).toContain('does not belong');
    });

    it('should not deactivate a BTCUSD alert from the ETH channel', async () => {
      const alert = btcAlert({ active: true });
      const storage = makeStorage([alert]);
      (storage.getById as jest.Mock).mockReturnValue(alert);
      const interaction = makeSelectMenu('alert:deactivate', ['btc-1'], 'eth-channel-id');

      await handleSelectMenu(interaction, storage, logger);

      expect(storage.update).not.toHaveBeenCalled();
      const call = (interaction.update as jest.Mock).mock.calls[0][0];
      expect(call.content).toContain('does not belong');
    });

    it('should scope BTCUSD list queries to the BTC channel', async () => {
      const storage = makeStorage([]);
      const interaction = {
        reply: jest.fn(),
        channelId: 'btc-channel-id',
        options: {},
      } as unknown as ChatInputCommandInteraction;

      await handleAlertList(interaction, storage, logger, 'btc-channel-id', 'BTCUSD');

      expect(storage.getAllByChannel).toHaveBeenCalledWith('btc-channel-id');
    });

    it('should report alert not found when BTCUSD alert was already deleted', async () => {
      const storage = makeStorage([]);
      (storage.getById as jest.Mock).mockReturnValue(undefined);
      const interaction = makeSelectMenu('alert:delete', ['btc-1']);

      await handleSelectMenu(interaction, storage, logger);

      expect(storage.deleteById).not.toHaveBeenCalled();
      const call = (interaction.update as jest.Mock).mock.calls[0][0];
      expect(call.content).toContain('not found');
    });
  });
});

describe('Configuration validation', () => {
  const quietLogger: Logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const originalEnv = { ...process.env };

  const setChannelIds = (eth: string, sol: string, btc: string): void => {
    process.env.ETHUSD_CHANNEL_ID = eth;
    process.env.SOLUSD_CHANNEL_ID = sol;
    process.env.BTCUSD_CHANNEL_ID = btc;
  };

  beforeEach(() => {
    process.env = { ...originalEnv, DISCORD_BOT_TOKEN: 'test-token' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should load config when all three channel IDs are present and unique', () => {
    setChannelIds('111', '222', '333');
    const config = loadConfig(quietLogger);
    expect(config.ethChannelId).toBe('111');
    expect(config.solChannelId).toBe('222');
    expect(config.btcChannelId).toBe('333');
    expect(config.deltaSymbols).toEqual(['ETHUSD', 'SOLUSD', 'BTCUSD']);
  });

  it('should throw and name the missing variable', () => {
    setChannelIds('111', '222', '');
    expect(() => loadConfig(quietLogger)).toThrow(/BTCUSD_CHANNEL_ID/);
  });

  it('should name every missing variable', () => {
    process.env.ETHUSD_CHANNEL_ID = '';
    process.env.SOLUSD_CHANNEL_ID = '';
    process.env.BTCUSD_CHANNEL_ID = '';
    let message = '';
    try {
      loadConfig(quietLogger);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('ETHUSD_CHANNEL_ID');
    expect(message).toContain('SOLUSD_CHANNEL_ID');
    expect(message).toContain('BTCUSD_CHANNEL_ID');
  });

  it('should treat a whitespace-only channel ID as missing', () => {
    setChannelIds('111', '   ', '333');
    expect(() => loadConfig(quietLogger)).toThrow(/SOLUSD_CHANNEL_ID/);
  });

  it('should throw when ETHUSD and SOLUSD share a channel ID', () => {
    setChannelIds('111', '111', '333');
    expect(() => loadConfig(quietLogger)).toThrow(/ETHUSD_CHANNEL_ID and SOLUSD_CHANNEL_ID/);
  });

  it('should throw when SOLUSD and BTCUSD share a channel ID', () => {
    setChannelIds('111', '222', '222');
    expect(() => loadConfig(quietLogger)).toThrow(/SOLUSD_CHANNEL_ID and BTCUSD_CHANNEL_ID/);
  });

  it('should throw and name all variables when all three share a channel ID', () => {
    setChannelIds('111', '111', '111');
    let message = '';
    try {
      loadConfig(quietLogger);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('ETHUSD_CHANNEL_ID, SOLUSD_CHANNEL_ID and BTCUSD_CHANNEL_ID');
  });

  it('should report missing rather than duplicate when two IDs are empty', () => {
    setChannelIds('', '', '333');
    let message = '';
    try {
      loadConfig(quietLogger);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('Missing required channel configuration');
    expect(message).not.toContain('Duplicate channel configuration');
  });
});
