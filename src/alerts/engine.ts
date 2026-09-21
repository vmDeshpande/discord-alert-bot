import { Logger } from '../logger';
import { AlertConfig, PriceUpdate, TriggerResult, AlertCondition } from '../alerts/types';
import { AlertStorage } from '../database/storage';
import { PriceUpdatePayload } from '../delta/client';
import { DiscordClient } from '../discord/client';

export interface AlertEngine {
  onPriceUpdate: (payload: PriceUpdatePayload) => void;
  getTriggeredAlerts: () => AlertConfig[];
  resetTriggeredAlert: (id: string) => void;
}

export interface TriggerContext {
  alert: AlertConfig;
  result: TriggerResult;
  discordSent: boolean;
}

export function evaluateAlert(
  alert: AlertConfig,
  priceUpdate: PriceUpdate,
  previousPrice: number | null,
): TriggerResult {
  if (previousPrice === null) {
    return {
      triggered: false,
      condition: alert.condition,
      previousPrice: 0,
      currentPrice: priceUpdate.price,
      targetPrice: alert.targetPrice,
    };
  }

  const triggered =
    !alert.triggered &&
    alert.enabled &&
    evaluateCondition(alert.condition, previousPrice, priceUpdate.price, alert.targetPrice);

  return {
    triggered,
    condition: alert.condition,
    previousPrice,
    currentPrice: priceUpdate.price,
    targetPrice: alert.targetPrice,
  };
}

function evaluateCondition(
  condition: AlertCondition,
  previousPrice: number,
  currentPrice: number,
  targetPrice: number,
): boolean {
  switch (condition) {
    case 'crossed_above':
      return previousPrice < targetPrice && currentPrice >= targetPrice;
    case 'crossed_below':
      return previousPrice > targetPrice && currentPrice <= targetPrice;
    case 'reaches_or_above':
      return currentPrice >= targetPrice;
    case 'reaches_or_below':
      return currentPrice <= targetPrice;
    default:
      return false;
  }
}

export function shouldMonitorSymbol(alert: AlertConfig, symbol: string): boolean {
  return alert.symbol === symbol && alert.enabled && !alert.triggered;
}

export function createAlertEngine(
  storage: AlertStorage,
  discordClient: DiscordClient,
  logger: Logger,
): AlertEngine {
  let triggeredAlerts: AlertConfig[] = [];
  let pendingSends: Set<string> = new Set();

  async function processAlert(alert: AlertConfig, result: TriggerResult): Promise<void> {
    if (alert.triggered) return;

    const message = formatAlertMessage(alert, result);
    logger.info(`Alert triggered: ${alert.symbol} ${alert.condition} ${alert.targetPrice}`, {
      alertId: alert.id,
    });

    pendingSends.add(alert.id);

    try {
      const sent = await discordClient.sendAlert(alert.discordChannelId, message);
      if (sent) {
        alert.triggered = true;
        alert.triggeredAt = new Date().toISOString();
        storage.update(alert);
        triggeredAlerts.push(alert);
        logger.info('Alert state updated', { id: alert.id, triggered: true });
      } else {
        logger.error('Discord alert delivery failed, alert remains active', {
          alertId: alert.id,
          channelId: alert.discordChannelId,
        });
      }
    } catch (err) {
      logger.error('Failed to send alert notification', { error: String(err), alertId: alert.id });
    } finally {
      pendingSends.delete(alert.id);
    }
  }

  function onPriceUpdate(payload: PriceUpdatePayload): void {
    const { symbol, currentPrice, previousPrice, timestamp } = payload;

    const activeAlerts = storage.getActiveBySymbol(symbol);

    for (const alert of activeAlerts) {
      if (pendingSends.has(alert.id)) continue;

      const priceUpdate: PriceUpdate = { symbol, price: currentPrice, timestamp };
      const result = evaluateAlert(alert, priceUpdate, previousPrice);

      if (result.triggered) {
        processAlert(alert, result).catch((err) => {
          logger.error('Error processing alert', { error: String(err), alertId: alert.id });
        });
      }
    }
  }

  return {
    onPriceUpdate,
    getTriggeredAlerts: (): AlertConfig[] => [...triggeredAlerts],
    resetTriggeredAlert: (id: string): void => {
      const idx = triggeredAlerts.findIndex((a) => a.id === id);
      if (idx >= 0) {
        triggeredAlerts.splice(idx, 1);
      }
    },
  };
}

function formatAlertMessage(alert: AlertConfig, result: TriggerResult): string {
  const emoji = alert.condition.includes('above')
    ? '📈'
    : alert.condition.includes('below')
      ? '📉'
      : '🎯';
  return (
    `${emoji} **Price Alert Triggered**\n` +
    `Symbol: ${alert.symbol}\n` +
    `Condition: ${alert.condition}\n` +
    `Target: ${alert.targetPrice}\n` +
    `Current: ${result.currentPrice}\n` +
    `Previous: ${result.previousPrice}\n` +
    `Time: ${new Date().toISOString()}`
  );
}
