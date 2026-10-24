import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  Collection,
  Events,
  ChatInputCommandInteraction,
  Interaction,
  StringSelectMenuInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { Logger } from '../logger';
import { AlertConfig } from '../alerts/types';
import { AlertStorage } from '../database/storage';
import { isValidTargetPrice } from '../alerts/validation';
import { routeInteraction } from './router';

const ETHUSD_SYMBOL = 'ETHUSD';
const SOLUSD_SYMBOL = 'SOLUSD';
const BTCUSD_SYMBOL = 'BTCUSD';

export interface DiscordClient {
  start: (token: string) => Promise<void>;
  stop: () => Promise<void>;
  isReady: () => boolean;
  sendAlert: (channelId: string, message: string) => Promise<boolean>;
  getClient?: () => Client;
}

export function createDiscordClient(
  logger: Logger,
  storage: AlertStorage,
  ethChannelId: string,
  solChannelId: string,
  btcChannelId: string,
): DiscordClient {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });
  (client as { commands?: Collection<string, unknown> }).commands = new Collection();

  const channelToSymbol: Record<string, string> = {
    [ethChannelId]: ETHUSD_SYMBOL,
    [solChannelId]: SOLUSD_SYMBOL,
    [btcChannelId]: BTCUSD_SYMBOL,
  };

  client.once(Events.ClientReady, (): void => {
    logger.info('Discord connected', { user: client.user?.tag });
    registerCommands(logger);
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction): Promise<void> => {
    await routeInteraction(interaction, {
      logger,
      storage,
      channelToSymbol,
    });
  });

  client.on('disconnect', (): void => {
    logger.warn('Discord disconnected');
  });

  client.on('reconnecting', (): void => {
    logger.info('Reconnecting to Discord');
  });

  client.on(Events.Error, (err: Error): void => {
    logger.error('Discord client error', { error: err.message });
  });

  async function registerCommands(logger: Logger): Promise<void> {
    if (!client.user) return;
    const commands = [
      new SlashCommandBuilder()
        .setName('alert')
        .setDescription('Manage price alerts')
        .addSubcommand((s) =>
          s
            .setName('set')
            .setDescription('Set a new price alert')
            .addStringOption((o) =>
              o.setName('price').setDescription('Target price').setRequired(true),
            ),
        )
        .addSubcommand((s) => s.setName('delete').setDescription('Delete an alert'))
        .addSubcommand((s) => s.setName('activate').setDescription('Activate an alert'))
        .addSubcommand((s) => s.setName('deactivate').setDescription('Deactivate an alert'))
        .addSubcommand((s) => s.setName('list').setDescription('List all alerts for this channel'))
        .toJSON(),
      new SlashCommandBuilder()
        .setName('level')
        .setDescription('Manage trade levels')
        .addSubcommand((s) =>
          s
            .setName('set')
            .setDescription('Add a level to a trade')
            .addStringOption((o) =>
              o.setName('trade_id').setDescription('Trade session ID').setRequired(false),
            )
            .addStringOption((o) =>
              o.setName('price').setDescription('Level price').setRequired(false),
            )
            .addStringOption((o) =>
              o.setName('condition').setDescription('BUY or SELL').setRequired(false),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('list')
            .setDescription('List levels')
            .addStringOption((o) =>
              o.setName('trade_id').setDescription('Trade session ID').setRequired(false),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('activate')
            .setDescription('Activate a level')
            .addStringOption((o) =>
              o.setName('trade_id').setDescription('Trade session ID').setRequired(false),
            )
            .addStringOption((o) =>
              o.setName('level_id').setDescription('Level ID').setRequired(false),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('deactivate')
            .setDescription('Deactivate a level')
            .addStringOption((o) =>
              o.setName('trade_id').setDescription('Trade session ID').setRequired(false),
            )
            .addStringOption((o) =>
              o.setName('level_id').setDescription('Level ID').setRequired(false),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('delete')
            .setDescription('Delete a level')
            .addStringOption((o) =>
              o.setName('trade_id').setDescription('Trade session ID').setRequired(false),
            )
            .addStringOption((o) =>
              o.setName('level_id').setDescription('Level ID').setRequired(false),
            ),
        )
        .toJSON(),
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN || '');
    try {
      await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
      logger.info('Discord commands registered');
    } catch (err) {
      logger.error('Failed to register Discord commands', { error: String(err) });
    }
  }

  return {
    start: async (token: string): Promise<void> => {
      if (!token) {
        logger.error('DISCORD_BOT_TOKEN is not set');
        throw new Error('DISCORD_BOT_TOKEN is not set');
      }
      await client.login(token);
    },
    stop: async (): Promise<void> => {
      await client.destroy();
      logger.info('Discord client stopped');
    },
    isReady: (): boolean => client.isReady(),
    sendAlert: async (channelId: string, message: string): Promise<boolean> => {
      try {
        const channel = await client.channels.fetch(channelId);
        if (channel && 'send' in channel) {
          await (channel as any).send(message);
          logger.info('Discord alert sent', { channelId });
          return true;
        }
        logger.warn('Discord channel not found or not sendable', { channelId });
        return false;
      } catch (err) {
        logger.error('Failed to send Discord alert', { error: String(err), channelId });
        return false;
      }
    },
    getClient: (): Client => client,
  };
}

export async function handleCommandExported(
  interaction: ChatInputCommandInteraction,
  storage: AlertStorage,
  logger: Logger,
  channelToSymbol: Record<string, string>,
): Promise<void> {
  const { commandName } = interaction;

  try {
    if (commandName === 'alert') {
      await handleAlertSubCommand(interaction, storage, logger, channelToSymbol);
    }
  } catch (err) {
    logger.error('Command handling error', { error: String(err), command: commandName });
    await interaction.reply({ content: 'An error occurred.' }).catch(() => {});
  }
}

function getSymbolForChannel(
  channelId: string | null,
  channelToSymbol: Record<string, string>,
): string | null {
  if (!channelId) return null;
  return channelToSymbol[channelId] ?? null;
}

function buildAlertSelectMenu(
  alerts: AlertConfig[],
  customId: string,
  placeholder: string,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .addOptions(
        alerts.map((a) => ({
          label: `${a.symbol} $${a.targetPrice.toLocaleString()} - ${a.active ? 'Active' : 'Inactive'}`,
          value: a.id,
        })),
      ),
  );
  return row;
}

async function handleAlertSubCommand(
  interaction: ChatInputCommandInteraction,
  storage: AlertStorage,
  logger: Logger,
  channelToSymbol: Record<string, string>,
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  const channelId = interaction.channelId;
  const symbol = getSymbolForChannel(channelId, channelToSymbol);

  if (!symbol) {
    await interaction.reply({
      content: 'Price alerts can only be configured in #ETHUSD, #SOLUSD or #BTCUSD.',
    });
    return;
  }

  switch (subcommand) {
    case 'set':
      await handleAlertSet(interaction, storage, logger, channelId, symbol);
      break;
    case 'delete':
      await handleAlertDelete(interaction, storage, logger, channelId);
      break;
    case 'activate':
      await handleAlertActivate(interaction, storage, logger, channelId);
      break;
    case 'deactivate':
      await handleAlertDeactivate(interaction, storage, logger, channelId);
      break;
    case 'list':
      await handleAlertList(interaction, storage, logger, channelId, symbol);
      break;
    default:
      await interaction.reply({ content: 'Unknown subcommand.' });
  }
}

export async function handleAlertSet(
  interaction: ChatInputCommandInteraction,
  storage: AlertStorage,
  logger: Logger,
  channelId: string | null,
  symbol: string,
): Promise<void> {
  const priceStr = interaction.options.getString('price', true);
  const targetPrice = parseFloat(priceStr);

  if (!isValidTargetPrice(targetPrice)) {
    await interaction.reply({
      content: 'price must be a positive finite number.',
    });
    return;
  }

  let baselinePrice: number | null = null;
  try {
    const response = await fetch(`https://api.india.delta.exchange/v2/tickers/${symbol}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = (await response.json()) as { result?: { close?: unknown } };
    const closeVal = data.result?.close;
    if (typeof closeVal === 'number') {
      baselinePrice = closeVal;
    } else if (typeof closeVal === 'string') {
      baselinePrice = parseFloat(closeVal);
    }
  } catch {
    // fall through
  }

  if (
    baselinePrice === null ||
    baselinePrice === undefined ||
    !Number.isFinite(baselinePrice) ||
    baselinePrice <= 0
  ) {
    await interaction.reply({
      content: 'Current price unavailable. Please try again shortly.',
    });
    return;
  }

  const direction: 'upward' | 'downward' = targetPrice >= baselinePrice ? 'upward' : 'downward';

  const alertConfig: AlertConfig = {
    id: generateId(),
    symbol,
    channelId: channelId ?? '',
    targetPrice,
    baselinePrice,
    direction,
    active: true,
    triggered: false,
    createdAt: new Date().toISOString(),
    triggeredAt: null,
  };

  storage.save(alertConfig);

  await interaction.reply({
    content: `? ${symbol} alert set\nTarget: $${targetPrice.toLocaleString()}\nStatus: Active`,
  });
  logger.info('Alert created via command', { id: alertConfig.id, symbol });
}

export async function handleAlertDelete(
  interaction: ChatInputCommandInteraction,
  storage: AlertStorage,
  logger: Logger,
  channelId: string | null,
): Promise<void> {
  const alerts = storage.getAllByChannel(channelId ?? '');

  if (alerts.length === 0) {
    await interaction.reply({ content: 'No alerts to delete in this channel.' });
    return;
  }

  const row = buildAlertSelectMenu(alerts, 'alert:delete', 'Select an alert to delete');
  await interaction.reply({ content: 'Select an alert to delete:', components: [row.toJSON()] });
  logger.info('Alert delete menu shown', { channelId, count: alerts.length });
}

export async function handleAlertActivate(
  interaction: ChatInputCommandInteraction,
  storage: AlertStorage,
  logger: Logger,
  channelId: string | null,
): Promise<void> {
  const alerts = storage.getAllByChannel(channelId ?? '').filter((a) => !a.active);

  if (alerts.length === 0) {
    await interaction.reply({ content: 'No inactive alerts to activate in this channel.' });
    return;
  }

  const row = buildAlertSelectMenu(alerts, 'alert:activate', 'Select an alert to activate');
  await interaction.reply({ content: 'Select an alert to activate:', components: [row.toJSON()] });
  logger.info('Alert activate menu shown', { channelId, count: alerts.length });
}

export async function handleAlertDeactivate(
  interaction: ChatInputCommandInteraction,
  storage: AlertStorage,
  logger: Logger,
  channelId: string | null,
): Promise<void> {
  const alerts = storage.getAllByChannel(channelId ?? '').filter((a) => a.active);

  if (alerts.length === 0) {
    await interaction.reply({ content: 'No active alerts to deactivate in this channel.' });
    return;
  }

  const row = buildAlertSelectMenu(alerts, 'alert:deactivate', 'Select an alert to deactivate');
  await interaction.reply({
    content: 'Select an alert to deactivate:',
    components: [row.toJSON()],
  });
  logger.info('Alert deactivate menu shown', { channelId, count: alerts.length });
}

export async function handleAlertList(
  interaction: ChatInputCommandInteraction,
  storage: AlertStorage,
  logger: Logger,
  channelId: string | null,
  channelSymbol: string,
): Promise<void> {
  const alerts = storage.getAllByChannel(channelId ?? '');
  const symbol = alerts.length > 0 ? alerts[0].symbol : channelSymbol;

  if (alerts.length === 0) {
    await interaction.reply({
      content: `?? ${symbol} Alerts\n\nNo alerts configured.`,
    });
    return;
  }

  let message = `?? ${symbol} Alerts\n\n`;
  for (const alert of alerts) {
    const status: string = alert.active ? '?? Active' : '?? Inactive';
    message += `$${alert.targetPrice.toLocaleString()}  ${status}\n`;
  }

  await interaction.reply({
    content: message,
  });
  logger.info('Alert list requested', { channelId, count: alerts.length });
}

export async function handleSelectMenu(
  interaction: StringSelectMenuInteraction,
  storage: AlertStorage,
  logger: Logger,
): Promise<void> {
  const { customId, values } = interaction;

  if (
    customId !== 'alert:delete' &&
    customId !== 'alert:activate' &&
    customId !== 'alert:deactivate'
  ) {
    return;
  }

  const alertId = values[0];
  const channelId = interaction.channelId;
  const existing = storage.getById(alertId);

  if (!existing) {
    await interaction
      .update({ content: 'Alert not found. It may have already been deleted.' })
      .catch(() => {});
    return;
  }

  if (existing.channelId !== channelId) {
    await interaction
      .update({ content: 'This alert does not belong to this channel.' })
      .catch(() => {});
    return;
  }

  try {
    if (customId === 'alert:delete') {
      storage.deleteById(alertId);
      await interaction.update({ content: `??? ${existing.symbol} alert deleted.` });
      logger.info('Alert deleted via select menu', { id: alertId, symbol: existing.symbol });
    } else if (customId === 'alert:activate') {
      existing.active = true;
      storage.update(existing);
      await interaction.update({ content: `? ${existing.symbol} alert activated.` });
      logger.info('Alert activated via select menu', { id: alertId, symbol: existing.symbol });
    } else if (customId === 'alert:deactivate') {
      existing.active = false;
      storage.update(existing);
      await interaction.update({ content: `?? ${existing.symbol} alert deactivated.` });
      logger.info('Alert deactivated via select menu', { id: alertId, symbol: existing.symbol });
    }
  } catch (err) {
    logger.error('Failed to process select menu action', { error: String(err), alertId });
    await interaction
      .update({ content: 'An error occurred while processing the action.' })
      .catch(() => {});
  }
}

function generateId(): string {
  return `alert_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function isFinitePositive(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

export async function createAndActivateLevel(
  interaction: any,
  trade: any,
  price: number,
  condition: string,
  levelStorage: any,
  logger: Logger,
): Promise<void> {
  const now = new Date().toISOString();
  const level: any = {
    id: `level_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    tradeId: trade.id,
    symbol: trade.symbol,
    side: trade.side,
    levelPrice: price,
    condition,
    status: 'active',
    monitoringState: 'monitoring',
    triggerCandleTs: null,
    nextCandleTs: null,
    lastProcessedCandleTs: null,
    holdCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  levelStorage.upsert(level);
  logger.info('Level added and activated', { id: level.id, tradeId: trade.id });
  await interaction
    .reply({
      content: `Level added and monitoring active for ${trade.symbol} ${trade.side} at ${price} (${condition}).`,
      ephemeral: true,
    })
    .catch(() => {});
}

export async function handleLevelCommand(
  interaction: ChatInputCommandInteraction,
  tradeStorage: any,
  levelStorage: any,
  logger: Logger,
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  try {
    if (subcommand === 'list') {
      const tradeId = interaction.options.getString('trade_id');
      if (tradeId) {
        const trade = tradeStorage.getById ? tradeStorage.getById(tradeId) : undefined;
        if (!trade) {
          await interaction.reply({ content: 'Trade not found.' });
          return;
        }
        const levels = levelStorage.getByTrade ? levelStorage.getByTrade(tradeId) : [];
        if (!levels || levels.length === 0) {
          await interaction.reply({ content: `No levels for trade ${tradeId}.` });
          return;
        }
        let msg = `Levels for ${trade.symbol} ${trade.side} (${tradeId}):\n`;
        for (const l of levels) {
          msg += `- ${l.id}: ${l.levelPrice} ${l.condition} [${l.status}/${l.monitoringState}]\n`;
        }
        await interaction.reply({ content: msg });
        return;
      }
      const trades = tradeStorage.getAll ? tradeStorage.getAll() : [];
      if (!trades || trades.length === 0) {
        await interaction.reply({ content: 'No trade sessions found.' });
        return;
      }
      if (trades.length > 1) {
        await interaction.reply({
          content: 'Multiple trades found. Specify trade_id.',
          ephemeral: true,
        });
        return;
      }
      const trade = trades[0];
      const levels = levelStorage.getByTrade ? levelStorage.getByTrade(trade.id) : [];
      if (!levels || levels.length === 0) {
        await interaction.reply({ content: `No levels for trade ${trade.id}.` });
        return;
      }
      let msg = `Levels for ${trade.symbol} ${trade.side} (${trade.id}):\n`;
      for (const l of levels) {
        msg += `- ${l.id}: ${l.levelPrice} ${l.condition} [${l.status}/${l.monitoringState}]\n`;
      }
      await interaction.reply({ content: msg });
      return;
    }
    if (subcommand === 'set') {
      const tradeId = interaction.options.getString('trade_id');
      const priceStr = interaction.options.getString('price');
      const condStr = interaction.options.getString('condition');

      if (!priceStr || !condStr) {
        await interaction.reply({
          content: 'Provide price and condition (BUY/SELL).',
          ephemeral: true,
        });
        return;
      }

      const price = parseFloat(priceStr);
      const condition = condStr.toUpperCase();
      if (!isFinitePositive(price)) {
        await interaction.reply({ content: 'Invalid price.' });
        return;
      }
      if (condition !== 'BUY' && condition !== 'SELL') {
        await interaction.reply({ content: 'Condition must be BUY or SELL.' });
        return;
      }

      if (tradeId) {
        const trade = tradeStorage.getById ? tradeStorage.getById(tradeId) : undefined;
        if (!trade || trade.monitoringStatus === 'closed') {
          await interaction.reply({ content: 'Trade not found or closed.' });
          return;
        }
        if (trade.stopLossStatus !== 'verified') {
          await interaction.reply({
            content: 'Stop must be verified before adding levels.',
            ephemeral: true,
          });
          return;
        }
        await createAndActivateLevel(interaction, trade, price, condition, levelStorage, logger);
        return;
      }

      // No trade_id: show a selectable list of open trades.
      const trades = tradeStorage.getAll ? tradeStorage.getAll() : [];
      const openTrades = trades.filter((t: any) => t.monitoringStatus !== 'closed');
      if (openTrades.length === 0) {
        await interaction.reply({
          content: 'No open trades found. Levels can only be added to open positions.',
          ephemeral: true,
        });
        return;
      }

      const customId = `level:set:select:${priceStr}:${condition}`;
      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(customId)
          .setPlaceholder('Select an open trade')
          .addOptions(
            openTrades.map((t: any) => ({
              label: `${t.symbol} ${t.side === 'BUY' ? 'LONG' : 'SHORT'} ${t.entryPrice}`,
              description: `size ${t.size} · ID ${t.id}`,
              value: t.id,
            })),
          ),
      );

      await interaction.reply({
        content: 'Select the trade to add this level to:',
        components: [row],
        ephemeral: true,
      });
      return;
    }
    if (subcommand === 'activate') {
      const tradeId = interaction.options.getString('trade_id');
      const levelId = interaction.options.getString('level_id');
      if (!tradeId || !levelId) {
        await interaction.reply({ content: 'Provide trade_id and level_id.' });
        return;
      }
      const trade = tradeStorage.getById ? tradeStorage.getById(tradeId) : undefined;
      if (!trade || trade.monitoringStatus === 'closed') {
        await interaction.reply({ content: 'Trade not found or closed.' });
        return;
      }
      if (trade.stopLossStatus !== 'verified') {
        await interaction.reply({
          content: 'Stop must be verified before activating levels.',
          ephemeral: true,
        });
        return;
      }
      const level = levelStorage.getById ? levelStorage.getById(levelId) : undefined;
      if (!level || level.tradeId !== tradeId) {
        await interaction.reply({ content: 'Invalid level.' });
        return;
      }
      const now = new Date().toISOString();
      levelStorage.upsert({
        ...level,
        status: 'active' as any,
        monitoringState: 'monitoring' as any,
        updatedAt: now,
      });
      await interaction.reply({ content: 'Level activated.' });
      return;
    }
    if (subcommand === 'deactivate') {
      const tradeId = interaction.options.getString('trade_id');
      const levelId = interaction.options.getString('level_id');
      if (!tradeId || !levelId) {
        await interaction.reply({ content: 'Provide trade_id and level_id.' });
        return;
      }
      const level = levelStorage.getById ? levelStorage.getById(levelId) : undefined;
      if (!level || level.tradeId !== tradeId) {
        await interaction.reply({ content: 'Invalid level.' });
        return;
      }
      const now = new Date().toISOString();
      levelStorage.upsert({
        ...level,
        status: 'inactive' as any,
        monitoringState: 'idle' as any,
        updatedAt: now,
      });
      await interaction.reply({ content: 'Level deactivated.' });
      return;
    }
    if (subcommand === 'delete') {
      const tradeId = interaction.options.getString('trade_id');
      const levelId = interaction.options.getString('level_id');
      if (!tradeId || !levelId) {
        await interaction.reply({ content: 'Provide trade_id and level_id.' });
        return;
      }
      const level = levelStorage.getById ? levelStorage.getById(levelId) : undefined;
      if (!level || level.tradeId !== tradeId) {
        await interaction.reply({ content: 'Invalid level.' });
        return;
      }
      levelStorage.deleteById(levelId);
      await interaction.reply({ content: 'Level deleted.' });
      return;
    }
    await interaction.reply({ content: 'Unknown subcommand.' });
  } catch (err) {
    logger.error('Level command error', { error: String(err) });
    await interaction.reply({ content: 'An error occurred.' }).catch(() => {});
  }
}
