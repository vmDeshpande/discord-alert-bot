import { Logger } from '../logger';
import { TradeStorage } from '../database/tradeStorage';
import { TradeRecord } from '../types';
import { buildTradeEmbed } from './dashboard';

export interface DashboardDiscordClient {
  sendMessage: (
    channelId: string,
    content?: string,
    embed?: unknown,
  ) => Promise<{ id: string } | null>;
  editMessage: (
    channelId: string,
    messageId: string,
    content?: string,
    embed?: unknown,
  ) => Promise<boolean>;
}

export interface DashboardService {
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  stop: () => void;
}

export function createDashboardService(
  tradeStorage: TradeStorage,
  discord: DashboardDiscordClient,
  channelId: string,
  throttleMs: number,
  logger: Logger,
): DashboardService {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastUpdate = 0;
  let running = false;
  let lastReconcileAt: string | null = null;

  function buildEmbedObject(trade: TradeRecord): unknown {
    const embed = buildTradeEmbed(trade);
    const fields = [...embed.fields];
    fields.push({
      name: 'Last Exchange Reconcile',
      value: lastReconcileAt ?? 'Unknown',
      inline: true,
    });
    fields.push({
      name: 'Data Freshness',
      value: lastReconcileAt ? 'Recent' : 'Stale/Unavailable',
      inline: true,
    });
    return {
      title: embed.title,
      fields,
      timestamp: new Date().toISOString(),
    };
  }

  async function upsertTrade(trade: TradeRecord): Promise<void> {
    try {
      if (trade.monitoringStatus === 'closed') {
        return;
      }
      if (!trade.discordMessageId) {
        const result = await discord.sendMessage(channelId, undefined, buildEmbedObject(trade));
        if (result && result.id) {
          const updated: TradeRecord = {
            ...trade,
            discordChannelId: channelId,
            discordMessageId: result.id,
            updatedAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
          };
          tradeStorage.upsert(updated);
          logger.info('Dashboard message created', { tradeId: trade.id, messageId: result.id });
        }
        return;
      }

      const ok = await discord.editMessage(
        channelId,
        trade.discordMessageId,
        undefined,
        buildEmbedObject(trade),
      );
      if (!ok) {
        const result = await discord.sendMessage(channelId, undefined, buildEmbedObject(trade));
        if (result && result.id) {
          const updated: TradeRecord = {
            ...trade,
            discordChannelId: channelId,
            discordMessageId: result.id,
            updatedAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
          };
          tradeStorage.upsert(updated);
          logger.info('Dashboard message recreated after edit failure', {
            tradeId: trade.id,
            messageId: result.id,
          });
        }
        return;
      }
    } catch (err) {
      logger.error('Dashboard update failed for trade', { error: String(err), tradeId: trade.id });
    }
  }

  async function refresh(): Promise<void> {
    if (running) return;
    const now = Date.now();
    if (now - lastUpdate < throttleMs) {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(
        () => {
          refresh().catch((e) => logger.error('Dashboard refresh error', { error: String(e) }));
        },
        throttleMs - (now - lastUpdate),
      );
      return;
    }
    running = true;
    try {
      const trades = tradeStorage.getAll();
      try {
        // Track reconciliation time if we can read trades successfully
        lastReconcileAt = new Date().toISOString();
      } catch {
        // Do not mark positions closed on dashboard read failures
      }
      for (const trade of trades) {
        await upsertTrade(trade);
      }
      lastUpdate = Date.now();
    } catch (err) {
      logger.error('Dashboard refresh failed', { error: String(err) });
      // Keep existing state, do not terminate
    } finally {
      running = false;
    }
  }

  return {
    initialize: async (): Promise<void> => {
      if (!channelId) {
        logger.error('Trade dashboard channel missing');
        return;
      }
      await refresh();
    },
    refresh,
    stop: (): void => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
