import { Logger } from '../logger';
import { TradeStorage } from '../database/tradeStorage';
import { LevelStorage } from '../database/levelStorage';
import { DeltaCandle } from '../types';
import { evaluateCandleDecision, isTouch, nextCandleTime } from './candleDecision';
import { executeCloseDecision, CloseExecutorDeps } from './closeExecutor';

export interface LevelMonitor {
  stop: () => void;
  tick: () => Promise<void>;
}

export function createLevelMonitor(
  tradeStorage: TradeStorage,
  levelStorage: LevelStorage,
  getCandles: (symbol: string, resolution: string, limit: number) => Promise<DeltaCandle[]>,
  closeDeps: CloseExecutorDeps,
  logger: Logger,
  dryRun: boolean,
): LevelMonitor {
  let stopped = false;
  let processing = false;
  const closingTrades = new Set<string>();

  async function tick() {
    if (stopped || processing) return;
    processing = true;
    try {
      const trades = tradeStorage.getAll();
      for (const trade of trades) {
        if (trade.monitoringStatus === 'closed') {
          const levels = levelStorage.getByTrade(trade.id);
          for (const l of levels) {
            try {
              levelStorage.deleteById(l.id);
            } catch {
              // ignore
            }
          }
          continue;
        }
        if (closingTrades.has(trade.id)) continue;
        if (trade.stopLossStatus !== 'verified') continue;
        if (trade.monitoringStatus !== 'active') continue;

        const levels = levelStorage.getByTrade(trade.id).filter((l: any) => l.status === 'active');
        if (levels.length === 0) continue;

        let candles: DeltaCandle[] = [];
        try {
          candles = await getCandles(trade.symbol, '3m', 10);
        } catch {
          continue;
        }
        if (candles.length < 2) continue;

        for (const level of levels as any[]) {
          if (stopped) break;
          try {
            let trigger: DeltaCandle | null = null;
            for (let i = 0; i < candles.length - 1; i++) {
              if (isTouch(candles[i], level.levelPrice)) {
                trigger = candles[i];
                break;
              }
            }
            if (!trigger) continue;
            const nextTs = nextCandleTime(trigger.time);
            const nextCandle =
              candles.find((c) => c.time === nextTs) || candles[candles.length - 1];
            if (!nextCandle) continue;
            if (level.lastProcessedCandleTs === nextCandle.time) continue;

            const decision = evaluateCandleDecision({
              level,
              trade,
              triggerCandle: trigger,
              nextCandle,
            } as any);
            const now = new Date().toISOString();
            if (decision.action === 'hold') {
              levelStorage.upsert({
                ...level,
                status: 'inactive',
                monitoringState: 'idle',
                lastProcessedCandleTs: nextCandle.time,
                updatedAt: now,
              });
              continue;
            }
            if (decision.action === 'close') {
              levelStorage.upsert({
                ...level,
                status: 'inactive',
                monitoringState: 'idle',
                lastProcessedCandleTs: nextCandle.time,
                updatedAt: now,
              });
              if (closingTrades.has(trade.id)) continue;
              closingTrades.add(trade.id);
              try {
                await executeCloseDecision(
                  closeDeps,
                  decision as any,
                  level as any,
                  trade as any,
                  dryRun,
                );
              } catch (err) {
                logger.error('Close execution failed', { error: String(err), tradeId: trade.id });
              }
              continue;
            }
          } catch (err) {
            logger.error('Level evaluation failed', {
              error: String(err),
              levelId: (level as any).id,
            });
          }
        }
      }
    } finally {
      processing = false;
    }
  }

  const timer = setInterval(() => {
    tick().catch(() => {});
  }, 15000);

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    tick,
  };
}
