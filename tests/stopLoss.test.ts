import { createStopLossManager } from '../src/tradeManagement/stopLoss';
import { TradeManagementConfig } from '../src/config';
import { Logger } from '../src/logger';

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;
const config = {
  demoMode: false,
  stopLossOffset: 100,
  enabled: true,
  apiKey: 'k',
  apiSecret: 's',
  apiBaseUrl: 'https://api.india.delta.exchange',
  pollIntervalMs: 1000,
  discordChannelId: 'c',
  dashboardThrottleMs: 1000,
} as TradeManagementConfig;

const position = {
  product_id: 27,
  product_symbol: 'BTCUSD',
  size: 1,
  entry_price: '50000',
  user_id: 1,
  margin: '1',
  liquidation_price: '49000',
  bankruptcy_price: '48000',
  adl_level: 0,
  mark_price: '50000',
};

const trade = {
  id: 't1',
  productId: 27,
  symbol: 'BTCUSD',
  side: 'BUY',
  size: 1,
  entryPrice: 50000,
} as any;

function makeClient(overrides: { getOpenOrders?: any; placeBracketOrder?: any } = {}) {
  const getOpenOrders = overrides.getOpenOrders ?? (jest.fn().mockResolvedValue([]) as any);
  const placeBracketOrder = overrides.placeBracketOrder ?? (jest.fn() as any);
  const client = { getOpenOrders, placeBracketOrder, getPositions: jest.fn() } as any;
  return { client, placeBracketOrder };
}

function makeStorage() {
  return { upsert: jest.fn(), getById: jest.fn(), getAll: jest.fn(), getByProduct: jest.fn(), markClosed: jest.fn() };
}

describe('stop loss bracket order', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('places bracket order via POST /v2/orders/bracket with correct payload', async () => {
    const { client, placeBracketOrder } = makeClient({
      placeBracketOrder: jest.fn().mockResolvedValue({ id: 'ord-1' }),
      getOpenOrders: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([
        { id: 'ord-1', product_id: 27, stop_price: '49900', state: 'open' },
      ]),
    });
    const storage = makeStorage();
    const stopLossManager = createStopLossManager(config, client, storage, logger);

    const res = await stopLossManager.protect(trade, position, false);

    expect(placeBracketOrder).toHaveBeenCalledTimes(1);
    expect(placeBracketOrder).toHaveBeenCalledWith({
      product_id: 27,
      stop_loss_order: {
        order_type: 'market_order',
        stop_price: String(50000 - 100),
      },
      bracket_stop_trigger_method: 'mark_price',
    });
    expect(res.success).toBe(true);
    expect(res.reason).toBe('verified');
    expect(res.orderId).toBe('ord-1');
    expect(storage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ stopLossStatus: 'verified', monitoringStatus: 'active', stopLossOrderId: 'ord-1' }),
    );
  });

  it('does not send a take-profit leg', async () => {
    const { client, placeBracketOrder } = makeClient({
      placeBracketOrder: jest.fn().mockResolvedValue({ id: 'ord-1' }),
      getOpenOrders: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([
        { id: 'ord-1', product_id: 27, stop_price: '49900', state: 'open' },
      ]),
    });
    const storage = makeStorage();
    const stopLossManager = createStopLossManager(config, client, storage, logger);

    await stopLossManager.protect(trade, position, false);

    const payload = (placeBracketOrder as jest.Mock).mock.calls[0][0];
    expect(payload.take_profit_order).toBeUndefined();
    expect(payload.bracket_take_profit_price).toBeUndefined();
    expect(payload.stop_loss_order.order_type).toBe('market_order');
  });

  it('adopts existing stop and does not place a duplicate bracket', async () => {
    const { client, placeBracketOrder } = makeClient({
      getOpenOrders: jest.fn().mockResolvedValue([
        { id: 'ord-existing', product_id: 27, stop_price: '49900', state: 'open' },
      ]),
    });
    const storage = makeStorage();
    const stopLossManager = createStopLossManager(config, client, storage, logger);

    const res = await stopLossManager.protect(trade, position, false);

    expect(placeBracketOrder).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.reason).toBe('adopted existing');
    expect(res.orderId).toBe('ord-existing');
    expect(storage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ stopLossStatus: 'verified', stopLossOrderId: 'ord-existing' }),
    );
  });

  it('dry-run does not submit a bracket order', async () => {
    const { client, placeBracketOrder } = makeClient({});
    const storage = makeStorage();
    const stopLossManager = createStopLossManager(config, client, storage, logger);

    const res = await stopLossManager.protect(trade, position, true);

    expect(placeBracketOrder).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.reason).toBe('dry-run');
    expect(storage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ stopLossStatus: 'pending', monitoringStatus: 'pending' }),
    );
  });

  it('fails safely when placement API throws and never marks verified', async () => {
    const { client, placeBracketOrder } = makeClient({
      placeBracketOrder: jest.fn().mockRejectedValue(new Error('upstream error')),
    });
    const storage = makeStorage();
    const stopLossManager = createStopLossManager(config, client, storage, logger);

    const res = await stopLossManager.protect(trade, position, false);

    expect(placeBracketOrder).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(false);
    expect(res.reason).toContain('upstream error');
    expect(storage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ stopLossStatus: 'failed' }),
    );
  });

  it('fails safely when placement returns but bracket cannot be confirmed', async () => {
    const { client, placeBracketOrder } = makeClient({
      placeBracketOrder: jest.fn().mockResolvedValue({ id: 'ord-1', status: 'open' }),
      getOpenOrders: jest.fn().mockResolvedValue([]),
    });
    const storage = makeStorage();
    const stopLossManager = createStopLossManager(config, client, storage, logger);

    const res = await stopLossManager.protect(trade, position, false);

    expect(placeBracketOrder).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(false);
    expect(res.reason).toBe('verification failed');
    expect(res.orderId).toBe('ord-1');
    // Not verified: stop remains pending, not active/verified
    expect(storage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ stopLossStatus: 'pending', monitoringStatus: 'pending' }),
    );
    expect(storage.upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ stopLossStatus: 'verified' }),
    );
  });

  it('derives stop price from position side preserving the offset', async () => {
    const { client, placeBracketOrder } = makeClient({
      placeBracketOrder: jest.fn().mockResolvedValue({ id: 'ord-1' }),
      getOpenOrders: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([
        { id: 'ord-1', product_id: 27, stop_price: '50100', state: 'open' },
      ]),
    });
    const storage = makeStorage();
    const stopLossManager = createStopLossManager(config, client, storage, logger);

    const sellTrade = { ...trade, id: 't2', side: 'SELL', entryPrice: 50000 };
    const sellPosition = { ...position, size: -1 };
    await stopLossManager.protect(sellTrade, sellPosition, false);

    const payload = (placeBracketOrder as jest.Mock).mock.calls[0][0];
    expect(payload.stop_loss_order.stop_price).toBe(String(50000 + 100));
  });
});
