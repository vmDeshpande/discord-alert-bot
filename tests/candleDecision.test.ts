import { evaluateCandleDecision, isTouch } from '../src/tradeManagement/candleDecision';
import { LevelRecord, TradeRecord, DeltaCandle } from '../src/types';

const level = (condition: 'BUY' | 'SELL', price: number): LevelRecord => ({
  id: 'l1', tradeId: 't1', symbol: 'BTCUSD', side: condition, levelPrice: price, condition, status: 'active', monitoringState: 'monitoring', triggerCandleTs: 1000, nextCandleTs: 1000 + 180000, lastProcessedCandleTs: null, holdCount: 0, createdAt: '', updatedAt: '',
});
const trade = { id: 't1', productId: 27, symbol: 'BTCUSD', side: 'BUY', size: 1, entryPrice: 50000, markPrice: null, unrealizedPnl: null, unrealizedPnlCurrency: null, liquidationPrice: null, stopLossOrderId: null, stopLossPrice: null, stopLossStatus: 'verified', monitoringStatus: 'active', discordChannelId: null, discordMessageId: null, lastEvent: null, lastEventAt: null, createdAt: '', updatedAt: '', lastSeenAt: '' } as TradeRecord;

describe('candle decision', () => {
  it('BUY above -> close', () => {
    const c: DeltaCandle = { time: 1000 + 180000, open: 100, high: 110, low: 95, close: 105, volume: 1 };
    const d = evaluateCandleDecision({ level: level('BUY', 100), trade, triggerCandle: c, nextCandle: c });
    expect(d.action).toBe('close');
  });
  it('BUY below -> hold', () => {
    const c: DeltaCandle = { time: 1000 + 180000, open: 100, high: 110, low: 95, close: 95, volume: 1 };
    const d = evaluateCandleDecision({ level: level('BUY', 100), trade, triggerCandle: c, nextCandle: c });
    expect(d.action).toBe('hold');
  });
  it('BUY equal -> hold', () => {
    const c: DeltaCandle = { time: 1000 + 180000, open: 100, high: 110, low: 95, close: 100, volume: 1 };
    const d = evaluateCandleDecision({ level: level('BUY', 100), trade, triggerCandle: c, nextCandle: c });
    expect(d.action).toBe('hold');
  });
  it('SELL below -> close', () => {
    const c: DeltaCandle = { time: 1000 + 180000, open: 100, high: 110, low: 95, close: 95, volume: 1 };
    const d = evaluateCandleDecision({ level: level('SELL', 100), trade, triggerCandle: c, nextCandle: c });
    expect(d.action).toBe('close');
  });
  it('touch detection', () => {
    const c: DeltaCandle = { time: 1, open: 100, high: 105, low: 95, close: 100, volume: 1 };
    expect(isTouch(c, 100)).toBe(true);
    expect(isTouch(c, 106)).toBe(false);
  });
});
