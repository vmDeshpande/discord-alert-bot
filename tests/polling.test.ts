import { initDatabase } from '../src/database/index';
import { createTradeStorage } from '../src/database/tradeStorage';
import { createPositionPoller } from '../src/tradeManagement/polling';
import { Logger } from '../src/logger';
import { AuthenticatedDeltaClient } from '../src/delta/authenticatedClient';

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

describe('position poller', () => {
  it('discovers new position', async () => {
    const db = initDatabase(':memory:', logger);
    const storage = createTradeStorage(db, logger);
    const client = {
      getPositions: async () => [{ product_id: 27, product_symbol: 'BTCUSD', size: 1, entry_price: '50000', user_id: 1, margin: '1', liquidation_price: '49000', bankruptcy_price: '48000', adl_level: 0 }],
      getProduct: async () => null,
      getOpenOrders: async () => [],
    } as unknown as AuthenticatedDeltaClient;
    const poller = createPositionPoller(1000, client, storage, logger);
    await poller.pollNow();
    expect(storage.getAll()).toHaveLength(1);
    expect(storage.getAll()[0].symbol).toBe('BTCUSD');
    db.close();
  });

  it('no duplicate on repeated poll', async () => {
    const db = initDatabase(':memory:', logger);
    const storage = createTradeStorage(db, logger);
    const client = {
      getPositions: async () => [{ product_id: 27, product_symbol: 'BTCUSD', size: 1, entry_price: '50000', user_id: 1, margin: '1', liquidation_price: '49000', bankruptcy_price: '48000', adl_level: 0 }],
      getProduct: async () => null,
      getOpenOrders: async () => [],
    } as unknown as AuthenticatedDeltaClient;
    const poller = createPositionPoller(1000, client, storage, logger);
    await poller.pollNow();
    await poller.pollNow();
    expect(storage.getAll()).toHaveLength(1);
    db.close();
  });

  it('marks closed only after successful poll missing position', async () => {
    const db = initDatabase(':memory:', logger);
    const storage = createTradeStorage(db, logger);
    const client1 = {
      getPositions: async () => [{ product_id: 27, product_symbol: 'BTCUSD', size: 1, entry_price: '50000', user_id: 1, margin: '1', liquidation_price: '49000', bankruptcy_price: '48000', adl_level: 0 }],
      getProduct: async () => null,
      getOpenOrders: async () => [],
    } as unknown as AuthenticatedDeltaClient;
    const poller = createPositionPoller(1000, client1, storage, logger);
    await poller.pollNow();
    const client2 = {
      getPositions: async () => [],
      getProduct: async () => null,
      getOpenOrders: async () => [],
    } as unknown as AuthenticatedDeltaClient;
    const poller2 = createPositionPoller(1000, client2, storage, logger);
    await poller2.pollNow();
    expect(storage.getAll()[0].monitoringStatus).toBe('closed');
    db.close();
  });

  it('api failure does not close', async () => {
    const db = initDatabase(':memory:', logger);
    const storage = createTradeStorage(db, logger);
    const client1 = {
      getPositions: async () => [{ product_id: 27, product_symbol: 'BTCUSD', size: 1, entry_price: '50000', user_id: 1, margin: '1', liquidation_price: '49000', bankruptcy_price: '48000', adl_level: 0 }],
      getProduct: async () => null,
      getOpenOrders: async () => [],
    } as unknown as AuthenticatedDeltaClient;
    const poller = createPositionPoller(1000, client1, storage, logger);
    await poller.pollNow();
    const client2 = {
      getPositions: async () => { throw new Error('network'); },
      getProduct: async () => null,
      getOpenOrders: async () => [],
    } as unknown as AuthenticatedDeltaClient;
    const poller2 = createPositionPoller(1000, client2, storage, logger);
    await poller2.pollNow();
    expect(storage.getAll()[0].monitoringStatus).not.toBe('closed');
    db.close();
  });

});
