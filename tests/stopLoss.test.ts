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

const makeStorage = () => ({
  upsert: jest.fn(),
  getById: jest.fn(),
  getAll: jest.fn(),
  getByProduct: jest.fn(),
  markClosed: jest.fn(),
});

describe('stop loss payload', () => {
  it('submits market_order stop-loss payload with reduce_only and correct side', async () => {
    let capturedPayload: unknown = null;
    let placeOrderCalls = 0;
    const storage = makeStorage();
    const client = {
      getPositions: async () => [
        {
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
        },
      ],
      getOpenOrders: async () => [],
      placeOrder: async (payload: unknown) => {
        capturedPayload = payload;
        placeOrderCalls += 1;
        return { id: 'ord-1' };
      },
    } as any;

    const stopLossManager = createStopLossManager(config, client, storage, logger);
    const trade = {
      id: 't1',
      productId: 27,
      symbol: 'BTCUSD',
      side: 'BUY',
      size: 1,
      entryPrice: 50000,
    } as any;
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
    } as any;

    // No existing matching stop order -> live placement path.
    const res = await stopLossManager.protect(trade, position, false);
    expect(placeOrderCalls).toBe(1);
    expect(res.success).toBe(false);
    expect(capturedPayload).toMatchObject({
      product_id: 27,
      size: 1,
      side: 'sell',
      order_type: 'market_order',
      stop_order_type: 'stop_loss_order',
      stop_price: String(50000 - 100),
      stop_trigger_method: 'last_traded_price',
      reduce_only: true,
    });
    expect(storage.upsert).toHaveBeenCalled();
  });
});
