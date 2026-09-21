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
  EmbedBuilder,
} from 'discord.js';
import { Logger } from '../logger';
import { AlertConfig } from '../alerts/types';
import { AlertStorage } from '../database/storage';
import { DeltaClient } from '../delta/client';
import { validateAlertInput } from '../alerts/validation';

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
  deltaClient: DeltaClient | null,
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
      deltaClient,
      channelToSymbol,
      ethChannelId,
      solChannelId,
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
        .setName('set-alert')
        .setDescription('Set a price alert for this crypto')
        .addStringOption((o) => o.setName('price').setDescription('Target price').setRequired(true))
        .toJSON(),
      new SlashCommandBuilder()
        .setName('remove-alert')
        .setDescription('Remove the alert for this crypto')
        .toJSON(),
      new SlashCommandBuilder()
        .setName('alert')
        .setDescription('Show the current alert for this crypto')
        .toJSON(),
      new SlashCommandBuilder()
        .setName('status')
        .setDescription('Show bot status and current prices')
        .toJSON(),
      new SlashCommandBuilder().setName('help').setDescription('Show available commands').toJSON(),
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
  deltaClient: DeltaClient | null,
  channelToSymbol: Record<string, string>,
  ethChannelId: string,
  solChannelId: string,
): Promise<void> {
  const { commandName } = interaction;

  try {
    if (commandName === 'set-alert') {
      await handleSetAlertCommand(
        interaction,
        storage,
        logger,
        deltaClient,
        channelToSymbol,
        ethChannelId,
        solChannelId,
      );
    } else if (commandName === 'remove-alert') {
      await handleRemoveAlertCommand(interaction, storage, logger, channelToSymbol);
    } else if (commandName === 'alert') {
      await handleAlertCommand(interaction, storage, channelToSymbol);
    } else if (commandName === 'status') {
      await handleStatusCommand(interaction, deltaClient);
    } else if (commandName === 'help') {
      await handleHelpCommand(interaction);
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

async function handleSetAlertCommand(
  interaction: ChatInputCommandInteraction,
  storage: AlertStorage,
  logger: Logger,
  deltaClient: DeltaClient | null,
  channelToSymbol: Record<string, string>,
  ethChannelId: string,
  solChannelId: string,
): Promise<void> {
  const channelId = interaction.channelId;
  const symbol = getSymbolForChannel(channelId, channelToSymbol);

  if (!symbol) {
    await interaction.reply({
      content: 'Price alerts can only be configured in #ETHUSD or #SOLUSD.',
      ephemeral: true,
    });
    return;
  }

  const priceStr = interaction.options.getString('price', true);
  const targetPrice = parseFloat(priceStr);

  const { valid, errors } = validateAlertInput({
    price: targetPrice,
    channelId: channelId ?? '',
    ethChannelId,
    solChannelId,
    symbol,
  });

  if (!valid) {
    await interaction.reply({ content: errors.join(', '), ephemeral: true });
    return;
  }

  const existing = storage.getByChannel(channelId ?? '');

  const now = new Date().toISOString();
  let baselinePrice: number | null = null;
  let direction: 'upward' | 'downward' = 'upward';

  if (deltaClient) {
    const priceSnapshot = deltaClient.getPrice(symbol);
    if (priceSnapshot) {
      baselinePrice = priceSnapshot.price;
      direction = targetPrice >= (baselinePrice as number) ? 'upward' : 'downward';
    }
  }

  const alertConfig: AlertConfig = existing
    ? {
        ...existing,
        symbol,
        channelId: channelId ?? '',
        targetPrice,
        baselinePrice,
        direction,
        enabled: true,
        triggered: false,
        createdAt: existing.createdAt,
        triggeredAt: null,
      }
    : {
        id: generateId(),
        symbol,
        channelId: channelId ?? '',
        targetPrice,
        baselinePrice,
        direction,
        enabled: true,
        triggered: false,
        createdAt: now,
        triggeredAt: null,
      };

  storage.save(alertConfig);

  const emoji = '✅';
  await interaction.reply({
    content: `${emoji} ${symbol} alert set\nTarget: $${targetPrice.toLocaleString()}\nStatus: Active`,
    ephemeral: true,
  });
  logger.info('Alert created via command', { id: alertConfig.id, symbol });
}

async function handleRemoveAlertCommand(
  interaction: ChatInputCommandInteraction,
  storage: AlertStorage,
  logger: Logger,
  channelToSymbol: Record<string, string>,
): Promise<void> {
  const channelId = interaction.channelId;
  const symbol = getSymbolForChannel(channelId, channelToSymbol);

  if (!symbol) {
    await interaction.reply({
      content: 'Price alerts can only be configured in #ETHUSD or #SOLUSD.',
      ephemeral: true,
    });
    return;
  }

  const existing = storage.getByChannel(channelId ?? '');

  if (!existing) {
    await interaction.reply({
      content: `No active alert in this channel.`,
      ephemeral: true,
    });
    return;
  }

  storage.deleteByChannel(channelId ?? '');

  await interaction.reply({
    content: `🗑️ ${symbol} alert removed.`,
    ephemeral: true,
  });
  logger.info('Alert removed via command', { symbol, channelId });
}

async function handleAlertCommand(
  interaction: ChatInputCommandInteraction,
  storage: AlertStorage,
  channelToSymbol: Record<string, string>,
): Promise<void> {
  const channelId = interaction.channelId;
  const symbol = getSymbolForChannel(channelId, channelToSymbol);

  if (!symbol) {
    await interaction.reply({
      content: 'Price alerts can only be configured in #ETHUSD or #SOLUSD.',
      ephemeral: true,
    });
    return;
  }

  const existing = storage.getByChannel(channelId ?? '');

  if (!existing) {
    await interaction.reply({
      content: `No active ${symbol} alert.`,
      ephemeral: true,
    });
    return;
  }

  const status = existing.triggered ? 'Triggered' : 'Active';

  await interaction.reply({
    content: `🔔 ${symbol} Alert\n\nTarget: $${existing.targetPrice.toLocaleString()}\nStatus: ${status}`,
    ephemeral: true,
  });
}

async function handleStatusCommand(
  interaction: ChatInputCommandInteraction,
  deltaClient: DeltaClient | null,
): Promise<void> {
  const uptime = process.uptime();
  const discordReady = true;
  const deltaState = deltaClient?.getConnectionState() ?? 'disconnected';
  const deltaConnected = deltaState === 'connected';
  const lastDeltaUpdate = deltaClient
    ? new Date(deltaClient.getLastUpdateTimestamp()).toISOString()
    : 'never';
  const ethPrice = deltaClient?.getPrice('ETHUSD');
  const solPrice = deltaClient?.getPrice('SOLUSD');

  const embed = new EmbedBuilder().setTitle('Bot Status').addFields(
    { name: 'Uptime', value: formatDuration(uptime), inline: true },
    { name: 'Discord Ready', value: discordReady ? 'Yes' : 'No', inline: true },
    { name: 'Delta Connected', value: deltaConnected ? 'Yes' : 'No', inline: true },
    { name: 'Delta State', value: deltaState, inline: true },
    { name: 'Last Delta Update', value: lastDeltaUpdate, inline: true },
    {
      name: 'ETHUSD Price',
      value: ethPrice ? `$${ethPrice.price.toLocaleString()}` : 'N/A',
      inline: true,
    },
    {
      name: 'SOLUSD Price',
      value: solPrice ? `$${solPrice.price.toLocaleString()}` : 'N/A',
      inline: true,
    },
  );

  await interaction.reply({ embeds: [embed] });
}

async function handleHelpCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({
    content: [
      '**Commands:**',
      '',
      '/set-alert price:<price>',
      'Set or replace the alert for this crypto.',
      '',
      '/alert',
      'Show the current alert.',
      '',
      '/remove-alert',
      'Remove the current alert.',
      '',
      '/status',
      'Show bot status and current prices.',
      '',
      '/help',
      'Show commands.',
    ].join('\n'),
    ephemeral: true,
  });
}

function generateId(): string {
  return `alert_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}
