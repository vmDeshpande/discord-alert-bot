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
import { validateAlertInput } from '../alerts/validation';
import { AlertStorage } from '../database/storage';

export interface DiscordClient {
  start: (token: string) => Promise<void>;
  stop: () => Promise<void>;
  isReady: () => boolean;
  sendAlert: (channelId: string, message: string) => Promise<boolean>;
}

export function createDiscordClient(logger: Logger, storage: AlertStorage): DiscordClient {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });
  (client as any).commands = new Collection();

  client.once(Events.ClientReady, (): void => {
    logger.info('Discord connected', { user: client.user?.tag });
    registerCommands(logger);
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction): Promise<void> => {
    if (!interaction.isChatInputCommand()) return;
    await handleCommand(interaction as ChatInputCommandInteraction, storage, logger);
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
        .setDescription('Create a new price alert')
        .addStringOption((o) =>
          o.setName('symbol').setDescription('Symbol e.g. BTCUSD').setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('condition')
            .setDescription('crossed_above, crossed_below, reaches_or_above, reaches_or_below')
            .setRequired(true),
        )
        .addNumberOption((o) =>
          o.setName('target_price').setDescription('Target price').setRequired(true),
        )
        .addStringOption((o) =>
          o.setName('channel_id').setDescription('Discord channel ID').setRequired(true),
        )
        .toJSON(),
      new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check bot and connection status')
        .toJSON(),
      new SlashCommandBuilder().setName('alerts').setDescription('List all alerts').toJSON(),
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
): Promise<void> {
  const { commandName } = interaction;

  try {
    if (commandName === 'alert') {
      await handleAlertCommand(interaction, storage, logger);
    } else if (commandName === 'status') {
      await handleStatusCommand(interaction);
    } else if (commandName === 'alerts') {
      await handleAlertsCommand(interaction, storage);
    }
  } catch (err) {
    logger.error('Command handling error', { error: String(err), command: commandName });
    await interaction.reply({ content: 'An error occurred.', ephemeral: true }).catch(() => {});
  }
}

async function handleAlertCommand(
  interaction: ChatInputCommandInteraction,
  storage: AlertStorage,
  logger: Logger,
): Promise<void> {
  const symbol = interaction.options.getString('symbol', true).toUpperCase();
  const condition = interaction.options.getString('condition', true);
  const targetPrice = interaction.options.getNumber('target_price', true);
  const discordChannelId = interaction.options.getString('channel_id', true);

  const { valid, errors } = validateAlertInput({
    symbol,
    condition,
    targetPrice,
    discordChannelId,
  });
  if (!valid) {
    await interaction.reply({ content: `Invalid input: ${errors.join(', ')}`, ephemeral: true });
    return;
  }

  const alert: AlertConfig = {
    id: generateId(),
    symbol,
    condition: condition as any,
    targetPrice,
    discordChannelId,
    enabled: true,
    triggered: false,
    createdAt: new Date().toISOString(),
    triggeredAt: null,
  };

  storage.save(alert);
  await interaction.reply({
    content: `Alert created: ${symbol} ${condition} ${targetPrice} on channel ${discordChannelId}`,
    ephemeral: true,
  });
  logger.info('Alert created via command', { id: alert.id, symbol });
}

async function handleStatusCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const uptime = process.uptime();
  const deltaConnected = (globalThis as any).deltaConnected ?? false;
  const lastDeltaUpdate = (globalThis as any).lastDeltaUpdate ?? 'never';

  const embed = new EmbedBuilder()
    .setTitle('Bot Status')
    .addFields(
      { name: 'Uptime', value: formatDuration(uptime), inline: true },
      { name: 'Delta Connected', value: deltaConnected ? 'Yes' : 'No', inline: true },
      { name: 'Last Delta Update', value: lastDeltaUpdate, inline: true },
    );

  await interaction.reply({ embeds: [embed] });
}

async function handleAlertsCommand(
  interaction: ChatInputCommandInteraction,
  storage: AlertStorage,
): Promise<void> {
  const alerts = storage.getAll();
  if (alerts.length === 0) {
    await interaction.reply({ content: 'No alerts configured.', ephemeral: true });
    return;
  }

  const lines = alerts
    .map(
      (a) =>
        `• \`${a.id}\` ${a.symbol} ${a.condition} ${a.targetPrice} | ${a.discordChannelId} | ${a.enabled ? 'enabled' : 'disabled'}${a.triggered ? ' | triggered' : ''}`,
    )
    .join('\n');

  await interaction.reply({ content: `Alerts (${alerts.length}):\n${lines}`, ephemeral: true });
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
