import { Logger } from '../logger';
import { TradeStorage } from '../database/tradeStorage';
import { LevelStorage } from '../database/levelStorage';
import { DeltaCandle, LevelRecord, TradeRecord, CandleDecision } from '../types';
import { evaluateCandleDecision, isTouch, nextCandleTime } from './candleDecision';
import { executeCloseDecision, CloseExecutorDeps, CloseExecutionResult } from './closeExecutor';

export interface LevelMonitor {
  stop: () => void;
  tick: () => Promise<void>;
}

export interface LevelNotifier {
  channelId: string;
  sendMessage: (
    channelId: string,
    content?: string,
    embed?: unknown,
  ) => Promise<{ id: string } | null>;
}

function buildLevelHitEmbed(
  trade: TradeRecord,
  level: LevelRecord,
  currentPrice: number | null,
): unknown {
  const direction = trade.side === 'BUY' ? 'LONG' : 'SHORT';
  return {
    title: 'LEVEL HIT',
    color: 0xf1c40f,
    timestamp: new Date().toISOString(),
    fields: [
      { name: 'Event', value: 'LEVEL HIT', inline: true },
      { name: 'Symbol', value: trade.symbol, inline: true },
      { name: 'Direction', value: direction, inline: true },
      { name: 'Trade ID', value: trade.id, inline: true },
      { name: 'Level Price', value: String(level.levelPrice), inline: true },
      {
        name: 'Current Price',
        value: currentPrice !== null ? String(currentPrice) : 'Unavailable',
        inline: true,
      },
      { name: 'Status', value: 'Waiting for next completed 3-minute candle', inline: true },
    ],
  };
}

function buildLevelDecisionEmbed(
  trade: TradeRecord,
  level: LevelRecord,
  decision: CandleDecision,
  nextCandle: DeltaCandle,
): unknown {
  const direction = trade.side === 'BUY' ? 'LONG' : 'SHORT';
  const actionLabel = decision.action === 'close' ? 'CLOSE' : 'HOLD';
  return {
    title: 'LEVEL DECISION',
    color: decision.action === 'close' ? 0xe74c3c : 0x2ecc71,
    timestamp: new Date().toISOString(),
    fields: [
      { name: 'Event', value: 'LEVEL DECISION', inline: true },
      { name: 'Symbol', value: trade.symbol, inline: true },
      { name: 'Direction', value: direction, inline: true },
      { name: 'Trade ID', value: trade.id, inline: true },
      { name: 'Level Price', value: String(level.levelPrice), inline: true },
       { name: 'Candle Time', value: String(new Date(nextCandle.time * 1000).toISOString()), inline: true },
      { name: 'Candle Close', value: String(nextCandle.close), inline: true },
      { name: 'Decision', value: actionLabel, inline: true },
      { name: 'Rule', value: decision.reason, inline: false },
    ],
  };
}

function buildCloseOutcomeEmbed(
  trade: TradeRecord,
  level: LevelRecord,
  result: CloseExecutionResult,
): unknown {
  const direction = trade.side === 'BUY' ? 'LONG' : 'SHORT';
  let title = 'CLOSE RESULT';
  let color = 0x95a5a6;
  if (result.status === 'executed') {
    title = 'TRADE CLOSED';
    color = 0x2ecc71;
  } else if (result.status === 'failed') {
    title = 'CLOSE FAILED';
    color = 0xe74c3c;
  } else if (result.status === 'dry-run') {
    title = 'CLOSE SIMULATED';
    color = 0xf1c40f;
  } else if (result.status === 'skipped') {
    title = 'CLOSE SKIPPED';
    color = 0x95a5a6;
  }
  return {
    title,
    color,
    timestamp: new Date().toISOString(),
    fields: [
      { name: 'Event', value: title, inline: true },
      { name: 'Symbol', value: trade.symbol, inline: true },
      { name: 'Direction', value: direction, inline: true },
      { name: 'Trade ID', value: trade.id, inline: true },
      { name: 'Level Price', value: String(level.levelPrice), inline: true },
      { name: 'Result', value: result.status, inline: true },
      { name: 'Reason', value: result.reason, inline: false },
      ...(result.orderId
        ? [{ name: 'Order ID', value: String(result.orderId), inline: true }]
        : []),
    ],
  };
}

async function sendNotification(
  notifier: LevelNotifier | undefined,
  logger: Logger,
  embed: unknown,
  label: string,
  meta: { tradeId?: string; levelId?: string } = {},
): Promise<boolean> {
  if (!notifier) {
    logger.warn(`Notifier not configured, skipping ${label} notification`, {
      tradeId: meta.tradeId,
      levelId: meta.levelId,
      reason: 'notifier missing',
    });
    return false;
  }
  const correlationId = `${meta.tradeId || 'na'}-${meta.levelId || 'na'}-${Date.now()}`;
  logger.info('Discord notification attempt', {
    correlationId,
    eventType: label,
    tradeId: meta.tradeId,
    levelId: meta.levelId,
    channelId: notifier.channelId,
  });
  try {
    const msg = await notifier.sendMessage(notifier.channelId, undefined, embed);
    if (msg && msg.id) {
      logger.info('Discord notification success', {
        correlationId,
        eventType: label,
        tradeId: meta.tradeId,
        levelId: meta.levelId,
        channelId: notifier.channelId,
        messageId: msg.id,
      });
      return true;
    } else {
      logger.warn('Discord notification no message id returned', {
        correlationId,
        eventType: label,
        tradeId: meta.tradeId,
        levelId: meta.levelId,
        channelId: notifier.channelId,
      });
      return false;
    }
  } catch (err) {
    logger.error('Discord notification failed', {
      correlationId,
      eventType: label,
      tradeId: meta.tradeId,
      levelId: meta.levelId,
      channelId: notifier.channelId,
      error: String(err),
    });
    return false;
  }
}

export function createLevelMonitor(
  tradeStorage: TradeStorage,
  levelStorage: LevelStorage,
  getCandles: (symbol: string, resolution: string, limit: number) => Promise<DeltaCandle[]>,
  closeDeps: CloseExecutorDeps,
  logger: Logger,
  dryRun: boolean,
  notifier?: LevelNotifier,
): LevelMonitor {
  const debug = process.env.LEVEL_MONITOR_DEBUG === 'true';
  let stopped = false;
  let processing = false;
  const closingTrades = new Set<string>();

  async function tick() {
    if (stopped || processing) return;
    processing = true;
    try {
      const trades = tradeStorage.getAll();
      logger.debug('Level monitor tick started', { tradeCount: trades.length });
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
        if (closingTrades.has(trade.id)) {
          logger.debug('Trade is closing, skipping level monitoring', { tradeId: trade.id });
          continue;
        }
        if (trade.stopLossStatus !== 'verified') {
          logger.debug('Trade stop loss not verified, skipping levels', {
            tradeId: trade.id,
            stopLossStatus: trade.stopLossStatus,
          });
          continue;
        }
        if (trade.monitoringStatus !== 'active') {
          logger.debug('Trade not active, skipping levels', {
            tradeId: trade.id,
            monitoringStatus: trade.monitoringStatus,
          });
          continue;
        }

        const levels = levelStorage.getByTrade(trade.id).filter((l: any) => l.status === 'active');
        if (levels.length === 0) {
          logger.debug('No active levels for trade', { tradeId: trade.id });
          continue;
        }
        logger.info('Monitoring active levels for trade', {
          tradeId: trade.id,
          symbol: trade.symbol,
          levelCount: levels.length,
        });

        let candles: DeltaCandle[] = [];
        try {
           const rawCandles = await getCandles(trade.symbol, '3m', 10);
           logger.debug('Candle request', {
            tradeId: trade.id,
            symbol: trade.symbol,
            endpoint: 'delta candles',
            params: { symbol: trade.symbol, resolution: '3m', limit: 10 },
            rawCount: rawCandles.length,
            returnedOrder: rawCandles.map((c) => c.time),
           });
           candles = [...rawCandles].sort((a, b) => a.time - b.time);
           logger.debug('Candles normalized', {
            tradeId: trade.id,
            symbol: trade.symbol,
            normalizedOrder: candles.map((c) => c.time),
          });
        } catch (err) {
          logger.error('Failed to fetch candles for trade', {
            error: String(err),
            tradeId: trade.id,
            symbol: trade.symbol,
          });
          continue;
        }
        if (candles.length < 2) {
          logger.warn('Insufficient candle data for trade', {
            tradeId: trade.id,
            symbol: trade.symbol,
            candleCount: candles.length,
          });
          continue;
        }

        for (const level of levels as any[]) {
          if (stopped) break;
          try {
            const now = new Date().toISOString();

            // Already fully processed (decision reported). Skip.
            if (level.lastProcessedCandleTs !== null) continue;

            // Hit already detected and reported; waiting for the next candle.
            if (level.triggerCandleTs !== null) {
              const nextTs = level.nextCandleTs ?? nextCandleTime(level.triggerCandleTs);
              const nextCandle = candles.find((c) => c.time === nextTs);
              if (!nextCandle) {
                logger.debug('Waiting for next completed candle', {
                  tradeId: trade.id,
                  levelId: level.id,
                  levelPrice: level.levelPrice,
                  expectedCandleTs: nextTs,
                });
                continue; // candle still forming; keep waiting
              }
              const nowSec2 = Math.floor(Date.now() / 1000);
              if (nextCandle.time + 180 > nowSec2) {
                logger.debug('Next candle still forming, waiting', {
                  tradeId: trade.id,
                  levelId: level.id,
                  candleTime: nextCandle.time,
                });
                continue;
              }

              const triggerCandle: DeltaCandle = {
                time: level.triggerCandleTs,
                open: 0,
                high: 0,
                low: 0,
                close: 0,
                volume: 0,
              };

              const decision = evaluateCandleDecision({
                level,
                trade,
                triggerCandle,
                nextCandle,
              } as any);

              // Report the decision exactly once.
              await sendNotification(
                notifier,
                logger,
                buildLevelDecisionEmbed(trade, level, decision, nextCandle),
                'level decision',
                { tradeId: trade.id, levelId: level.id },
              );

              // Mark the level processed so the decision is never re-reported.
              levelStorage.upsert({
                ...level,
                status: 'inactive',
                monitoringState: 'idle',
                lastProcessedCandleTs: nextCandle.time,
                updatedAt: now,
              });
              logger.info('Level decision reported', {
                tradeId: trade.id,
                levelId: level.id,
                levelPrice: level.levelPrice,
                decision: decision.action,
                reason: decision.reason,
                candleTs: nextCandle.time,
                candleClose: nextCandle.close,
              });

              if (decision.action === 'close') {
                if (closingTrades.has(trade.id)) continue;
                closingTrades.add(trade.id);
                let result: CloseExecutionResult;
                try {
                  result = await executeCloseDecision(
                    closeDeps,
                    decision as any,
                    level as any,
                    trade as any,
                    dryRun,
                  );
                } catch (err) {
                  logger.error('Close execution failed', {
                    error: String(err),
                    tradeId: trade.id,
                  });
                  result = { status: 'failed', reason: String(err) };
                }
                await sendNotification(
                  notifier,
                  logger,
                  buildCloseOutcomeEmbed(trade, level, result),
                  'close outcome',
                  { tradeId: trade.id, levelId: level.id },
                );
              }
              continue;
            }

             // No hit detected yet: look for a touch in the completed candles.
             const activationTs = level.createdAt
               ? Math.floor(new Date(level.createdAt).getTime() / 1000)
               : (trade.createdAt
                   ? Math.floor(new Date(trade.createdAt).getTime() / 1000)
                   : 0);
             const nowSec = Math.floor(Date.now() / 1000);
             let trigger: DeltaCandle | null = null;
             for (let i = 0; i < candles.length; i++) {
               const candle = candles[i];
               // Exclude candles whose 3-minute interval hasn't completed.
               if (candle.time + 180 > nowSec) {
                 logger.debug('Skipping incomplete candle', { tradeId: trade.id, levelId: level.id, candleTime: candle.time });
                 continue;
               }
               if (activationTs && candle.time < activationTs) {
                 logger.debug('Skipping historical candle before activation', { tradeId: trade.id, levelId: level.id, candleTime: candle.time, activationTs });
                 continue;
               }
               (debug ? logger.info : logger.debug)('Evaluating candle touch', {
                 tradeId: trade.id,
                 levelId: level.id,
                 levelPrice: level.levelPrice,
                 candleTime: candle.time,
                 candleTimeUtc: new Date(candle.time * 1000).toISOString(),
                 open: candle.open,
                 high: candle.high,
                 low: candle.low,
                 close: candle.close,
                 condition: `low(${candle.low}) <= level(${level.levelPrice}) && high(${candle.high}) >= level(${level.levelPrice})`,
                 touched: candle.low <= level.levelPrice && level.levelPrice <= candle.high,
               });
               if (isTouch(candle, level.levelPrice)) {
                 trigger = candle;
                 break;
               }
             }
            if (!trigger) {
              logger.debug('No level touch detected', {
                tradeId: trade.id,
                levelId: level.id,
                levelPrice: level.levelPrice,
                currentPrice: candles[candles.length - 1].close,
              });
              continue;
            }

            // Report the level hit exactly once. Mark triggerCandleTs so the
            // hit is not re-reported on subsequent polls or after a restart.
            const triggerTime = trigger.time;
            const nextTs = nextCandleTime(triggerTime);
            levelStorage.upsert({
              ...level,
              triggerCandleTs: triggerTime,
              nextCandleTs: nextTs,
              monitoringState: 'triggered',
              updatedAt: now,
            });

            const currentPrice = candles[candles.length - 1].close;
            logger.info('Level hit detected', {
              tradeId: trade.id,
              levelId: level.id,
              symbol: trade.symbol,
              levelPrice: level.levelPrice,
              triggerCandleTs: triggerTime,
              currentPrice,
            });
            const notificationSent = await sendNotification(
              notifier,
              logger,
              buildLevelHitEmbed(trade, level, currentPrice),
              'level hit',
              { tradeId: trade.id, levelId: level.id },
            );
            if (!notificationSent) {
              // Roll back the trigger marker so a failed Discord send is retried
              // on the next tick instead of being treated as an already-reported hit.
              levelStorage.upsert({
                ...level,
                triggerCandleTs: null,
                nextCandleTs: null,
                monitoringState: 'idle',
                updatedAt: now,
              });
              logger.warn('Level hit notification will be retried', {
                tradeId: trade.id,
                levelId: level.id,
                triggerCandleTs: triggerTime,
              });
            }
            continue;
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
  }, 5000);
  timer.unref();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    tick,
  };
}
