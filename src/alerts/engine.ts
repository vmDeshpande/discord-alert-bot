import { Logger } from '../logger';
import { AlertConfig, PriceUpdate, TriggerResult, AlertDirection } from '../alerts/types';
import { AlertStorage } from '../database/storage';
import { DiscordClient } from '../discord/client';
import { PriceUpdatePayload } from '../delta/client';

export interface AlertEngine {
  onPriceUpdate: (payload: PriceUpdatePayload) => void;
  getTriggeredAlerts: () => AlertConfig[];
  resetTriggeredAlert: (id: string) => void;
}

export function evaluateAlert(alert: AlertConfig, priceUpdate: PriceUpdate): TriggerResult {
  const currentPrice = priceUpdate.price;
  const targetPrice = alert.targetPrice;
  const baselinePrice = alert.baselinePrice;
  const direction: AlertDirection = alert.direction;

  if (baselinePrice === null || baselinePrice === undefined) {
    return {
      triggered: false,
      targetPrice,
      currentPrice,
      baselinePrice,
      direction,
    };
  }

  let triggered = false;

  if (direction === 'upward') {
    triggered =
      !alert.triggered &&
      alert.enabled &&
      baselinePrice < targetPrice &&
      currentPrice >= targetPrice;
  } else {
    triggered =
      !alert.triggered &&
      alert.enabled &&
      baselinePrice > targetPrice &&
      currentPrice <= targetPrice;
  }

  return {
    triggered,
    targetPrice,
    currentPrice,
    baselinePrice,
    direction,
  };
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
    logger.info(`Alert triggered: ${alert.symbol} target ${alert.targetPrice}`, {
      alertId: alert.id,
    });

    pendingSends.add(alert.id);

    try {
      const sent = await discordClient.sendAlert(alert.channelId, message);
      if (sent) {
        alert.triggered = true;
        alert.triggeredAt = new Date().toISOString();
        storage.update(alert);
        triggeredAlerts.push(alert);
        logger.info('Alert state updated', { id: alert.id, triggered: true });
      } else {
        logger.error('Discord alert delivery failed, alert remains active', {
          alertId: alert.id,
          channelId: alert.channelId,
        });
      }
    } catch (err) {
      logger.error('Failed to send alert notification', { error: String(err), alertId: alert.id });
    } finally {
      pendingSends.delete(alert.id);
    }
  }

  function onPriceUpdate(payload: PriceUpdatePayload): void {
    const { symbol, currentPrice, timestamp } = payload;

    const activeAlerts = storage.getActiveBySymbol(symbol);

    for (const alert of activeAlerts) {
      if (pendingSends.has(alert.id)) continue;

      const priceUpdate: PriceUpdate = { symbol, price: currentPrice, timestamp };
      const result = evaluateAlert(alert, priceUpdate);

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
  return (
    `🔔 **${alert.symbol} Price Alert**\n\n` +
    `Target: $${result.targetPrice.toLocaleString()}\n` +
    `Current: $${result.currentPrice.toLocaleString()}\n\n` +
    `Your ${alert.symbol} target price has been hit.`
  );
}
