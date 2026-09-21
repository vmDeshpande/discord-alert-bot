import { Logger } from '../logger';
import { AlertConfig, PriceUpdate, TriggerResult } from '../alerts/types';
import { AlertStorage } from '../database/storage';
import { DeltaClient } from '../delta/client';
import { DiscordClient } from '../discord/client';

export interface AlertEngine {
  onPriceUpdate: (symbol: string, price: number, timestamp: number) => void;
  getTriggeredAlerts: () => AlertConfig[];
  resetTriggeredAlert: (id: string) => void;
}

function priceCrossed(
  previousPrice: number,
  currentPrice: number,
  targetPrice: number,
): {
  crossedAbove: boolean;
  crossedBelow: boolean;
} {
  return {
    crossedAbove: previousPrice < targetPrice && currentPrice >= targetPrice,
    crossedBelow: previousPrice > targetPrice && currentPrice <= targetPrice,
  };
}

export function evaluateAlert(
  alert: AlertConfig,
  priceUpdate: PriceUpdate,
  previousPrice: number,
): TriggerResult {
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
  condition: AlertConfig['condition'],
  previousPrice: number,
  currentPrice: number,
  targetPrice: number,
): boolean {
  switch (condition) {
    case 'crossed_above': {
      const { crossedAbove } = priceCrossed(previousPrice, currentPrice, targetPrice);
      return crossedAbove;
    }
    case 'crossed_below': {
      const { crossedBelow } = priceCrossed(previousPrice, currentPrice, targetPrice);
      return crossedBelow;
    }
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
  deltaClient: DeltaClient,
  logger: Logger,
): AlertEngine {
  let triggeredAlerts: AlertConfig[] = [];

  function onPriceUpdate(symbol: string, price: number, timestamp: number): void {
    const priceUpdate: PriceUpdate = { symbol, price, timestamp };

    const activeAlerts = storage.getActiveBySymbol(symbol);

    for (const alert of activeAlerts) {
      const previousPriceData = deltaClient.getLastPrice(symbol);
      const previousPrice = previousPriceData?.price ?? price;

      if (previousPrice === price) continue;

      const result = evaluateAlertNow(alert, priceUpdate, previousPrice);

      if (result.triggered) {
        handleTriggeredAlert(alert, result);
      }
    }

    if (timestamp > (globalThis as any).lastDeltaUpdate) {
      (globalThis as any).lastDeltaUpdate = new Date(timestamp).toISOString();
    }
    (globalThis as any).deltaConnected = true;
  }

  function evaluateAlertNow(
    alert: AlertConfig,
    priceUpdate: PriceUpdate,
    previousPrice: number,
  ): TriggerResult {
    const { condition, targetPrice } = alert;
    let triggered = false;

    if (condition === 'crossed_above') {
      triggered = previousPrice < targetPrice && priceUpdate.price >= targetPrice;
    } else if (condition === 'crossed_below') {
      triggered = previousPrice > targetPrice && priceUpdate.price <= targetPrice;
    } else if (condition === 'reaches_or_above') {
      triggered = priceUpdate.price >= targetPrice;
    } else if (condition === 'reaches_or_below') {
      triggered = priceUpdate.price <= targetPrice;
    }

    return {
      triggered,
      condition,
      previousPrice,
      currentPrice: priceUpdate.price,
      targetPrice,
    };
  }

  function handleTriggeredAlert(alert: AlertConfig, result: TriggerResult): void {
    const now = new Date().toISOString();
    alert.triggered = true;
    alert.triggeredAt = now;
    storage.update(alert);
    triggeredAlerts.push(alert);

    const message = formatAlertMessage(alert, result);
    logger.info(`Alert triggered: ${alert.symbol} ${alert.condition} ${alert.targetPrice}`);

    discordClient.sendAlert(alert.discordChannelId, message).catch((err) => {
      logger.error('Failed to send alert notification', { error: String(err), alertId: alert.id });
    });

    logger.info('Alert state updated', { id: alert.id, triggered: true });
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
