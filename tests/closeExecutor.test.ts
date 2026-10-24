import { executeCloseDecision } from '../src/tradeManagement/closeExecutor';
import { initDatabase } from '../src/database/index';
import { createTradeStorage } from '../src/database/tradeStorage';
import { createLevelStorage } from '../src/database/levelStorage';
import { Logger } from '../src/logger';
import { TradeManagementConfig } from '../src/config';

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;
const config = { demoMode: true, stopLossOffset: 100, enabled: true, apiKey: 'k', apiSecret: 's', apiBaseUrl: 'https://api.india.delta.exchange', pollIntervalMs: 1000, discordChannelId: 'c', dashboardThrottleMs: 1000 } as TradeManagementConfig;

describe('close executor', () => {
  it('dry-run never submits', async () => {
    const db = initDatabase(':memory:', logger);
    const tradeStorage = createTradeStorage(db, logger);
    const levelStorage = createLevelStorage(db, logger);
    const client = { getPositions: async () => [{ product_id: 27, product_symbol: 'BTCUSD', size: 1, entry_price: '50000', user_id: 1, margin: '1', liquidation_price: '49000', bankruptcy_price: '48000', adl_level: 0 }], placeOrder: async () => { throw new Error('should not call'); }, getOpenOrders: async () => [] } as any;
    const trade = { id: 't1', productId: 27, symbol: 'BTCUSD', side: 'BUY', size: 1, entryPrice: 50000, markPrice: null, unrealizedPnl: null, unrealizedPnlCurrency: null, liquidationPrice: null, stopLossOrderId: null, stopLossPrice: null, stopLossStatus: 'verified', monitoringStatus: 'active', discordChannelId: null, discordMessageId: null, lastEvent: null, lastEventAt: null, createdAt: '', updatedAt: '', lastSeenAt: '' } as any;
    const level = { id: 'l1', tradeId: 't1', symbol: 'BTCUSD', side: 'BUY', levelPrice: 100, condition: 'BUY', status: 'active', monitoringState: 'monitoring', triggerCandleTs: 1, nextCandleTs: 2, lastProcessedCandleTs: null, holdCount: 0, createdAt: '', updatedAt: '' } as any;
    const decision = { levelId: 'l1', tradeId: 't1', candleTs: 2, close: 105, levelPrice: 100, condition: 'BUY', action: 'close', reason: 'r' } as any;
    const res = await executeCloseDecision({ client, tradeStorage, levelStorage, logger, config }, decision, level, trade, true);
    expect(res.status).toBe('dry-run');
    db.close();
  });
});
