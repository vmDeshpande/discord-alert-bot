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
  SelectMenuInteraction,
  ActionRowBuilder,
  SelectMenuBuilder,
} from 'discord.js';
import { Logger } from '../logger';
import { AlertConfig } from '../alerts/types';
import { AlertStorage } from '../database/storage';
import { isValidTargetPrice } from '../alerts/validation';

const ETHUSD_SYMBOL = 'ETHUSD';
const SOLUSD_SYMBOL = 'SOLUSD';

export interface DiscordClient {
  start: (token: string) => Promise<void>;
  stop: () => Promise<void>;
  isReady: () => boolean;
  sendAlert: (channelId: string, message: string) => Promise<boolean>;
}

export function createDiscordClient(
  logger: Logger,
  storage: AlertStorage,
  ethChannelId: string,
  solChannelId: string,
): DiscordClient {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });
  (client as { commands?: Collection<string, unknown> }).commands = new Collection();

  const channelToSymbol: Record<string, string> = {
    [ethChannelId]: ETHUSD_SYMBOL,
    [solChannelId]: SOLUSD_SYMBOL,
  };

  client.once(Events.ClientReady, (): void => {
    logger.info('Discord connected', { user: client.user?.tag });
    registerCommands(logger);
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction): Promise<void> => {
    if (interaction.isChatInputCommand()) {
      await handleCommand(
        interaction as ChatInputCommandInteraction,
        storage,
        logger,
        channelToSymbol,
      );
    } else if (interaction.isSelectMenu()) {
      await handleSelectMenu(interaction as SelectMenuInteraction, storage, logger);
    }
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
          await channel.send(message);
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
  };
}

async function handleCommand(
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
): ActionRowBuilder<SelectMenuBuilder> {
  const row = new ActionRowBuilder<SelectMenuBuilder>().addComponents(
    new SelectMenuBuilder()
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
      content: 'Price alerts can only be configured in #ETHUSD or #SOLUSD.',
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
      await handleAlertList(interaction, storage, logger, channelId);
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
    // fall through to error response
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
    content: `✅ ${symbol} alert set\nTarget: $${targetPrice.toLocaleString()}\nStatus: Active`,
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
): Promise<void> {
  const alerts = storage.getAllByChannel(channelId ?? '');
  const symbol = alerts.length > 0 ? alerts[0].symbol : 'ETHUSD';

  if (alerts.length === 0) {
    await interaction.reply({
      content: `🔔 ${symbol} Alerts\n\nNo alerts configured.`,
    });
    return;
  }

  let message = `🔔 ${symbol} Alerts\n\n`;
  for (const alert of alerts) {
    const status: string = alert.active ? '🟢 Active' : '🔕 Inactive';
    message += `${alert.id}  $${alert.targetPrice.toLocaleString()}  ${status}\n`;
  }

  await interaction.reply({
    content: message,
  });
  logger.info('Alert list requested', { channelId, count: alerts.length });
}

export async function handleSelectMenu(
  interaction: SelectMenuInteraction,
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
      await interaction.update({ content: `🗑️ ${existing.symbol} alert deleted.` });
      logger.info('Alert deleted via select menu', { id: alertId, symbol: existing.symbol });
    } else if (customId === 'alert:activate') {
      existing.active = true;
      storage.update(existing);
      await interaction.update({ content: `✅ ${existing.symbol} alert activated.` });
      logger.info('Alert activated via select menu', { id: alertId, symbol: existing.symbol });
    } else if (customId === 'alert:deactivate') {
      existing.active = false;
      storage.update(existing);
      await interaction.update({ content: `⏸️ ${existing.symbol} alert deactivated.` });
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
