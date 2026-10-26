import { DeltaCandle, LevelRecord, TradeRecord, CandleDecision } from '../types';

export interface CandleDecisionInput {
  level: LevelRecord;
  trade: TradeRecord;
  triggerCandle: DeltaCandle;
  nextCandle: DeltaCandle;
}

export function evaluateCandleDecision(input: CandleDecisionInput): CandleDecision {
  const { level, trade, nextCandle } = input;
  const close = nextCandle.close;
  const lp = level.levelPrice;
  let action: 'close' | 'hold';
  let reason: string;
  if (level.condition === 'BUY') {
    if (close > lp) {
      action = 'close';
      reason = 'close above level';
    } else {
      action = 'hold';
      reason = close < lp ? 'close below level' : 'close equal level';
    }
  } else {
    if (close < lp) {
      action = 'close';
      reason = 'close below level';
    } else {
      action = 'hold';
      reason = close > lp ? 'close above level' : 'close equal level';
    }
  }
  return {
    levelId: level.id,
    tradeId: trade.id,
    candleTs: nextCandle.time,
    close,
    levelPrice: lp,
    condition: level.condition,
    action,
    reason,
  };
}

export function isTouch(candle: DeltaCandle, levelPrice: number): boolean {
  return candle.low <= levelPrice && levelPrice <= candle.high;
}

export function nextCandleTime(triggerTs: number): number {
  return triggerTs + 180;
}
