import { createLevelMonitor } from '../src/tradeManagement/levelMonitor';
import { TradeRecord, LevelRecord, DeltaCandle } from '../src/types';

function makeCandle(time: number, close: number, low: number, high: number): DeltaCandle {
  return { time, open: close, high, low, close, volume: 100 };
}

function makeTrade(overrides: Partial<TradeRecord> = {}): TradeRecord {
  return {
    id: 't1',
    productId: 27,
    symbol: 'BTCUSD',
    side: 'BUY',
    size: 1,
    entryPrice: 50000,
    markPrice: 50500,
    unrealizedPnl: 500,
    unrealizedPnlCurrency: 'USDT',
    liquidationPrice: 49000,
    stopLossOrderId: 'ord-sl',
    stopLossPrice: 49900,
    stopLossStatus: 'verified',
    monitoringStatus: 'active',
    discordChannelId: null,
    discordMessageId: null,
    lastEvent: 'stop verified',
    lastEventAt: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    lastSeenAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeLevel(overrides: Partial<LevelRecord> = {}): LevelRecord {
  return {
    id: 'lvl1',
    tradeId: 't1',
    symbol: 'BTCUSD',
    side: 'BUY',
    levelPrice: 45000,
    condition: 'BUY',
    status: 'active',
    monitoringState: 'monitoring',
    triggerCandleTs: null,
    nextCandleTs: null,
    lastProcessedCandleTs: null,
    holdCount: 0,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function makeNotifier() {
  return {
    channelId: 'ch1',
    sendMessage: jest.fn().mockResolvedValue({ id: 'msg-1' }),
  };
}

function makeCloseDeps(overrides: {
  getPositions?: any;
  placeOrder?: any;
  markClosed?: any;
  upsertLevel?: any;
} = {}) {
  return {
    client: {
      getPositions: overrides.getPositions ?? jest.fn().mockResolvedValue([]),
      placeOrder: overrides.placeOrder ?? jest.fn().mockResolvedValue({ id: 'ord-1' }),
    },
    tradeStorage: {
      markClosed: overrides.markClosed ?? jest.fn(),
      getAll: jest.fn(),
      getById: jest.fn(),
      upsert: jest.fn(),
    },
    levelStorage: {
      upsert: overrides.upsertLevel ?? jest.fn(),
      getByTrade: jest.fn(),
      getById: jest.fn(),
      deleteById: jest.fn(),
    },
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    config: { demoMode: false, apiBaseUrl: 'https://api.india.delta.exchange' },
  };
}

function makeLevelMonitorDeps(overrides: {
  trades?: any[];
  levels?: any[];
  candles?: DeltaCandle[];
  notifier?: any;
  closeDeps?: any;
  levelStorage?: any;
  tradeStorage?: any;
}) {
  const notifier = overrides.notifier ?? makeNotifier();
  // Maintain mutable level state so upsert is reflected in getByTrade (persistence simulation)
  let currentLevels = (overrides.levels ?? []).map((l) => ({ ...l }));
  const levelStorage = overrides.levelStorage ?? {
    getByTrade: jest.fn((tradeId: string) =>
      currentLevels.filter((l: any) => l.tradeId === tradeId),
    ),
    upsert: jest.fn((l: any) => {
      const idx = currentLevels.findIndex((x: any) => x.id === l.id);
      if (idx >= 0) currentLevels[idx] = { ...currentLevels[idx], ...l };
      else currentLevels.push({ ...l });
    }),
    deleteById: jest.fn((id: string) => {
      currentLevels = currentLevels.filter((l: any) => l.id !== id);
    }),
    getById: jest.fn((id: string) => currentLevels.find((l: any) => l.id === id)),
    getAll: jest.fn(() => [...currentLevels]),
  };
  let currentTrades = (overrides.trades ?? []).map((t) => ({ ...t }));
  const tradeStorage = overrides.tradeStorage ?? {
    getAll: jest.fn(() => [...currentTrades]),
    getById: jest.fn((id: string) => currentTrades.find((t: any) => t.id === id)),
    upsert: jest.fn((t: any) => {
      const idx = currentTrades.findIndex((x: any) => x.id === t.id);
      if (idx >= 0) currentTrades[idx] = { ...currentTrades[idx], ...t };
      else currentTrades.push({ ...t });
    }),
    markClosed: jest.fn((id: string, ts: string) => {
      const t = currentTrades.find((x: any) => x.id === id);
      if (t) {
        t.monitoringStatus = 'closed';
        t.updatedAt = ts;
      }
    }),
  };
  const getCandles = jest.fn().mockResolvedValue(overrides.candles ?? []);
  const closeDeps = overrides.closeDeps ?? makeCloseDeps();

  const monitor = createLevelMonitor(
    tradeStorage,
    levelStorage,
    getCandles,
    closeDeps,
    { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    false,
    notifier,
  );

  return { monitor, getCandles, notifier, levelStorage, tradeStorage, closeDeps };
}

describe('level monitor notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clear any pending monitor timers
  });

  it('sends LEVEL HIT notification once when a level is touched', async () => {
    const trade = makeTrade();
    const level = makeLevel();
    // Candle 0 (completed) touches level 45000. Candle 1 is current/forming.
    const candles = [makeCandle(1000, 45500, 44000, 46000), makeCandle(2000, 45700, 45600, 45800)];
    const { monitor, notifier } = makeLevelMonitorDeps({
      trades: [trade],
      levels: [level],
      candles,
    });

    await monitor.tick();

    expect(notifier.sendMessage).toHaveBeenCalledTimes(1);
    const sent = (notifier.sendMessage as jest.Mock).mock.calls[0][2] as any;
    expect(sent.title).toBe('LEVEL HIT');
    expect(sent.fields.find((f: any) => f.name === 'Status').value).toBe(
      'Waiting for next completed 3-minute candle',
    );
  });

  it('does not re-send LEVEL HIT on repeated polling (duplicate prevention)', async () => {
    const trade = makeTrade();
    const level = makeLevel();
    const candles = [makeCandle(1000, 45500, 44000, 46000), makeCandle(2000, 45700, 45600, 45800)];
    const { monitor, notifier, levelStorage } = makeLevelMonitorDeps({
      trades: [trade],
      levels: [level],
      candles,
    });

    await monitor.tick();
    expect(notifier.sendMessage).toHaveBeenCalledTimes(1);

    await monitor.tick();
    expect(notifier.sendMessage).toHaveBeenCalledTimes(1);

    const upserted = (levelStorage.upsert as jest.Mock).mock.calls[0][0];
    expect(upserted.triggerCandleTs).toBe(1000);
  });

  it('sends LEVEL DECISION only after the next completed candle', async () => {
    const trade = makeTrade();
    const level = makeLevel({
      triggerCandleTs: 1000,
      nextCandleTs: 181000,
      monitoringState: 'triggered',
    });
    // close below level → HOLD (no close execution, no extra notification)
    const candles = [
      makeCandle(1000, 45500, 44000, 46000),
      makeCandle(181000, 44900, 44800, 45000),
    ];
    const closeDeps = makeCloseDeps({
      getPositions: jest.fn().mockResolvedValue([]),
    });
    const { monitor, notifier, closeDeps: cd } = makeLevelMonitorDeps({
      trades: [trade],
      levels: [level],
      candles,
      closeDeps,
    });

    await monitor.tick();

    expect(notifier.sendMessage).toHaveBeenCalledTimes(1);
    const sent = (notifier.sendMessage as jest.Mock).mock.calls[0][2] as any;
    expect(sent.title).toBe('LEVEL DECISION');
    expect(sent.fields.find((f: any) => f.name === 'Decision').value).toBe('HOLD');
    expect(sent.fields.find((f: any) => f.name === 'Rule').value).toBe('close below level');
    expect(cd.client.getPositions).not.toHaveBeenCalled();
  });

  it('sends HOLD when LONG close equals level', async () => {
    const trade = makeTrade({ side: 'BUY' });
    const level = makeLevel({
      triggerCandleTs: 1000,
      nextCandleTs: 181000,
      monitoringState: 'triggered',
    });
    const candles = [
      makeCandle(1000, 45500, 44000, 46000),
      makeCandle(181000, 45000, 44900, 45100),
    ];
    const { monitor, notifier } = makeLevelMonitorDeps({
      trades: [trade],
      levels: [level],
      candles,
    });

    await monitor.tick();

    expect(notifier.sendMessage).toHaveBeenCalledTimes(1);
    const sent = (notifier.sendMessage as jest.Mock).mock.calls[0][2] as any;
    expect(sent.fields.find((f: any) => f.name === 'Decision').value).toBe('HOLD');
    expect(sent.fields.find((f: any) => f.name === 'Rule').value).toBe('close equal level');
  });

  it('sends CLOSE for LONG when close strictly above level', async () => {
    const trade = makeTrade({ side: 'BUY' });
    const level = makeLevel({
      triggerCandleTs: 1000,
      nextCandleTs: 181000,
      monitoringState: 'triggered',
    });
    const candles = [
      makeCandle(1000, 45500, 44000, 46000),
      makeCandle(181000, 45100, 45000, 45200),
    ];
    const { monitor, notifier } = makeLevelMonitorDeps({
      trades: [trade],
      levels: [level],
      candles,
    });

    await monitor.tick();

    const sent = (notifier.sendMessage as jest.Mock).mock.calls[0][2] as any;
    expect(sent.fields.find((f: any) => f.name === 'Decision').value).toBe('CLOSE');
    expect(sent.fields.find((f: any) => f.name === 'Rule').value).toBe('close above level');
  });

  it('sends CLOSE for SHORT when close strictly below level', async () => {
    const trade = makeTrade({ side: 'SELL' });
    const level = makeLevel({
      side: 'SELL',
      condition: 'SELL',
      triggerCandleTs: 1000,
      nextCandleTs: 181000,
      monitoringState: 'triggered',
    });
    const candles = [
      makeCandle(1000, 45500, 44000, 46000),
      makeCandle(181000, 44900, 44800, 45000),
    ];
    const { monitor, notifier } = makeLevelMonitorDeps({
      trades: [trade],
      levels: [level],
      candles,
    });

    await monitor.tick();

    const sent = (notifier.sendMessage as jest.Mock).mock.calls[0][2] as any;
    expect(sent.fields.find((f: any) => f.name === 'Decision').value).toBe('CLOSE');
    expect(sent.fields.find((f: any) => f.name === 'Rule').value).toBe('close below level');
  });

  it('sends HOLD for SHORT when close equals level', async () => {
    const trade = makeTrade({ side: 'SELL' });
    const level = makeLevel({
      side: 'SELL',
      condition: 'SELL',
      triggerCandleTs: 1000,
      nextCandleTs: 181000,
      monitoringState: 'triggered',
    });
    const candles = [
      makeCandle(1000, 45500, 44000, 46000),
      makeCandle(181000, 45000, 44900, 45100),
    ];
    const { monitor, notifier } = makeLevelMonitorDeps({
      trades: [trade],
      levels: [level],
      candles,
    });

    await monitor.tick();

    const sent = (notifier.sendMessage as jest.Mock).mock.calls[0][2] as any;
    expect(sent.fields.find((f: any) => f.name === 'Decision').value).toBe('HOLD');
    expect(sent.fields.find((f: any) => f.name === 'Rule').value).toBe('close equal level');
  });

  it('sends TRADE CLOSED after verified close execution', async () => {
    const trade = makeTrade();
    const level = makeLevel({
      triggerCandleTs: 1000,
      nextCandleTs: 181000,
      monitoringState: 'triggered',
    });
    const candles = [
      makeCandle(1000, 45500, 44000, 46000),
      makeCandle(181000, 45600, 45400, 45800),
    ];
    const closeDeps = makeCloseDeps({
      getPositions: jest
        .fn()
        .mockResolvedValueOnce([{ product_id: 27, size: 1 }])
        .mockResolvedValueOnce([]),
      placeOrder: jest.fn().mockResolvedValue({ id: 'ord-close' }),
      markClosed: jest.fn(),
    });
    const { monitor, notifier, closeDeps: cd } = makeLevelMonitorDeps({
      trades: [trade],
      levels: [level],
      candles,
      closeDeps,
    });

    await monitor.tick();

    const messages = (notifier.sendMessage as jest.Mock).mock.calls.map((c) => c[2] as any);
    expect(messages[0].title).toBe('LEVEL DECISION');
    expect(messages[1].title).toBe('TRADE CLOSED');
    expect(messages[1].fields.find((f: any) => f.name === 'Result').value).toBe('executed');
    expect(cd.client.placeOrder).toHaveBeenCalled();
    expect(cd.tradeStorage.markClosed).toHaveBeenCalled();
  });

  it('sends CLOSE FAILED when close execution fails', async () => {
    const trade = makeTrade();
    const level = makeLevel({
      triggerCandleTs: 1000,
      nextCandleTs: 181000,
      monitoringState: 'triggered',
    });
    const candles = [
      makeCandle(1000, 45500, 44000, 46000),
      makeCandle(181000, 45600, 45400, 45800),
    ];
    const closeDeps = makeCloseDeps({
      getPositions: jest.fn().mockResolvedValue([{ product_id: 27, size: 1 }]),
      placeOrder: jest.fn().mockRejectedValue(new Error('exchange error')),
      markClosed: jest.fn(),
    });
    const { monitor, notifier } = makeLevelMonitorDeps({
      trades: [trade],
      levels: [level],
      candles,
      closeDeps,
    });

    await monitor.tick();

    const messages = (notifier.sendMessage as jest.Mock).mock.calls.map((c) => c[2] as any);
    expect(messages[1].title).toBe('CLOSE FAILED');
    expect(messages[1].fields.find((f: any) => f.name === 'Result').value).toBe('failed');
  });

  it('sends CLOSE SIMULATED in dry-run mode', async () => {
    const trade = makeTrade();
    const level = makeLevel({
      triggerCandleTs: 1000,
      nextCandleTs: 181000,
      monitoringState: 'triggered',
    });
    const candles = [
      makeCandle(1000, 45500, 44000, 46000),
      makeCandle(181000, 45600, 45400, 45800),
    ];
    const closeDeps = makeCloseDeps({
      getPositions: jest.fn().mockResolvedValue([{ product_id: 27, size: 1 }]),
      placeOrder: jest.fn(),
    });
    const notifier = makeNotifier();
    const levelStorage = {
      getAll: jest.fn(),
      getByTrade: jest.fn().mockReturnValue([level]),
      upsert: jest.fn(),
      deleteById: jest.fn(),
      getById: jest.fn(),
    };
    const tradeStorage = { getAll: jest.fn().mockReturnValue([trade]) };
    const monitor = createLevelMonitor(
      tradeStorage as any,
      levelStorage as any,
      jest.fn().mockResolvedValue(candles),
      closeDeps as any,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      true,
      notifier,
    );

    await monitor.tick();

    const messages = (notifier.sendMessage as jest.Mock).mock.calls.map((c) => c[2] as any);
    expect(messages[1].title).toBe('CLOSE SIMULATED');
  });

  it('does not send decision when next candle is still forming', async () => {
    const trade = makeTrade();
    const level = makeLevel({
      triggerCandleTs: 1000,
      nextCandleTs: 181000,
      monitoringState: 'triggered',
    });
    // Next candle at 181000 not yet formed; only current candle at 2000 exists
    const candles = [makeCandle(1000, 45500, 44000, 46000), makeCandle(2000, 45700, 45600, 45800)];
    const { monitor, notifier } = makeLevelMonitorDeps({
      trades: [trade],
      levels: [level],
      candles,
    });

    await monitor.tick();

    expect(notifier.sendMessage).toHaveBeenCalledTimes(0);
  });

  it('does not crash when Discord send fails', async () => {
    const trade = makeTrade();
    const level = makeLevel();
    const candles = [makeCandle(1000, 45500, 44000, 46000), makeCandle(2000, 45700, 45600, 45800)];
    const notifier = {
      channelId: 'ch1',
      sendMessage: jest.fn().mockRejectedValue(new Error('discord down')),
    };
    const { monitor, levelStorage } = makeLevelMonitorDeps({
      trades: [trade],
      levels: [level],
      candles,
      notifier,
    });

    await monitor.tick();

    expect(notifier.sendMessage).toHaveBeenCalledTimes(1);
    const upserted = (levelStorage.upsert as jest.Mock).mock.calls[0][0];
    expect(upserted.triggerCandleTs).toBe(1000);
  });

  it('reports decision only once (lastProcessedCandleTs prevents re-report)', async () => {
    const trade = makeTrade();
    const level = makeLevel({
      triggerCandleTs: 1000,
      nextCandleTs: 181000,
      lastProcessedCandleTs: 181000,
      monitoringState: 'idle',
      status: 'inactive',
    });
    const candles = [
      makeCandle(1000, 45500, 44000, 46000),
      makeCandle(181000, 45600, 45400, 45800),
    ];
    const { monitor, notifier } = makeLevelMonitorDeps({
      trades: [trade],
      levels: [level],
      candles,
    });

    await monitor.tick();

    expect(notifier.sendMessage).toHaveBeenCalledTimes(0);
  });

  it('skips trades without verified stop', async () => {
    const trade = makeTrade({ stopLossStatus: 'pending' });
    const level = makeLevel();
    const candles = [makeCandle(1000, 45500, 44000, 46000), makeCandle(2000, 45700, 45600, 45800)];
    const { monitor, notifier } = makeLevelMonitorDeps({
      trades: [trade],
      levels: [level],
      candles,
    });

    await monitor.tick();

    expect(notifier.sendMessage).toHaveBeenCalledTimes(0);
  });

  it('skips closed trades', async () => {
    const trade = makeTrade({ monitoringStatus: 'closed' });
    const level = makeLevel();
    const candles = [makeCandle(1000, 45500, 44000, 46000), makeCandle(2000, 45700, 45600, 45800)];
    const { monitor, notifier } = makeLevelMonitorDeps({
      trades: [trade],
      levels: [level],
      candles,
    });

    await monitor.tick();

    expect(notifier.sendMessage).toHaveBeenCalledTimes(0);
  });
});
