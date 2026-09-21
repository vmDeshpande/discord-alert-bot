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
    if (!interaction.isChatInputCommand()) return;
    await handleCommand(
      interaction as ChatInputCommandInteraction,
      storage,
      logger,
      channelToSymbol,
    );
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
        .addSubcommand((s) =>
          s
            .setName('delete')
            .setDescription('Delete an alert')
            .addStringOption((o) => o.setName('id').setDescription('Alert ID').setRequired(true)),
        )
        .addSubcommand((s) =>
          s
            .setName('activate')
            .setDescription('Activate an alert')
            .addStringOption((o) => o.setName('id').setDescription('Alert ID').setRequired(true)),
        )
        .addSubcommand((s) =>
          s
            .setName('deactivate')
            .setDescription('Deactivate an alert')
            .addStringOption((o) => o.setName('id').setDescription('Alert ID').setRequired(true)),
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
    await interaction.reply({ content: 'An error occurred.', ephemeral: true }).catch(() => {});
  }
}

function getSymbolForChannel(
  channelId: string | null,
  channelToSymbol: Record<string, string>,
): string | null {
  if (!channelId) return null;
  return channelToSymbol[channelId] ?? null;
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
      ephemeral: true,
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
    default:
      await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
  }
}

async function handleAlertSet(
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
      ephemeral: true,
    });
    return;
  }

  let baselinePrice: number | null = null;
  try {
    const response = await fetch(`https://api.india.delta.exchange/v2/tickers/${symbol}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = (await response.json()) as { close?: unknown };
    if (typeof data.close === 'number') {
      baselinePrice = data.close;
    } else if (typeof data.close === 'string') {
      baselinePrice = parseFloat(data.close);
    }
  } catch {
    // fall through to error response
  }

  if (baselinePrice === null || baselinePrice === undefined || !Number.isFinite(baselinePrice)) {
    await interaction.reply({
      content: 'Current price unavailable. Please try again shortly.',
      ephemeral: true,
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
    ephemeral: true,
  });
  logger.info('Alert created via command', { id: alertConfig.id, symbol });
}

async function handleAlertDelete(
  interaction: ChatInputCommandInteraction,
  storage: AlertStorage,
  logger: Logger,
  channelId: string | null,
): Promise<void> {
  const id = interaction.options.getString('id', true);
  const existing = storage.getById(id);

  if (!existing) {
    await interaction.reply({ content: 'Alert not found.', ephemeral: true });
    return;
  }

  if (existing.channelId !== (channelId ?? '')) {
    await interaction.reply({
      content: 'This alert does not belong to this channel.',
      ephemeral: true,
    });
    return;
  }

  storage.deleteById(id);

  await interaction.reply({
    content: `🗑️ ${existing.symbol} alert deleted.`,
    ephemeral: true,
  });
  logger.info('Alert deleted via command', { id, symbol: existing.symbol });
}

async function handleAlertActivate(
  interaction: ChatInputCommandInteraction,
  storage: AlertStorage,
  logger: Logger,
  channelId: string | null,
): Promise<void> {
  const id = interaction.options.getString('id', true);
  const existing = storage.getById(id);

  if (!existing) {
    await interaction.reply({ content: 'Alert not found.', ephemeral: true });
    return;
  }

  if (existing.channelId !== (channelId ?? '')) {
    await interaction.reply({
      content: 'This alert does not belong to this channel.',
      ephemeral: true,
    });
    return;
  }

  existing.active = true;
  storage.update(existing);

  await interaction.reply({
    content: `✅ ${existing.symbol} alert activated.`,
    ephemeral: true,
  });
  logger.info('Alert activated via command', { id, symbol: existing.symbol });
}

async function handleAlertDeactivate(
  interaction: ChatInputCommandInteraction,
  storage: AlertStorage,
  logger: Logger,
  channelId: string | null,
): Promise<void> {
  const id = interaction.options.getString('id', true);
  const existing = storage.getById(id);

  if (!existing) {
    await interaction.reply({ content: 'Alert not found.', ephemeral: true });
    return;
  }

  if (existing.channelId !== (channelId ?? '')) {
    await interaction.reply({
      content: 'This alert does not belong to this channel.',
      ephemeral: true,
    });
    return;
  }

  existing.active = false;
  storage.update(existing);

  await interaction.reply({
    content: `⏸️ ${existing.symbol} alert deactivated.`,
    ephemeral: true,
  });
  logger.info('Alert deactivated via command', { id, symbol: existing.symbol });
}

function generateId(): string {
  return `alert_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}
